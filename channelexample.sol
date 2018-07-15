pragma solidity ^0.4.7;

// Example implementation of a state channel contract for simplified Sprites. There are two contracts:
// 1. State channel contract: Responsible for managing the dispute process and agreeing to the final authorised state hash
// 2. Simplified Sprites (Application) contract: Normal contract, full of functionality. Additional functions to support "channelisation".
//
// Both parties can use simplifiedsprites.createChannel() to create the state channel (and its contract), and lock down all functionality in the application.
// Both parties can execute the contract off-chain to authorise state transitions. For every state update, both parties sign the HASH of a state.
// Eventually, the dispute process can be used to "turn off" the channel.
// Dispute process has a fixed time period for both parties to send the latest state hash.
// Once finished, the plaintext state is sent to the application contract (SimplifiedSprites). The application confirms this is the latest state
// by hashing it, and comparing it with the "final state hash" stored in the state channel.
// Once happy, it'll store plaintext state and re-activate all functionality in the state channel contract.
//
// This contract provides a practical demonstration of converting a smart contract into a "state channel" for optimistic scaling.
//
// Author: Patrick McCorry



// State channel is responsible for handling the dispute process
// - One party can trigger a dispute
// - Fixed time period for all parties to send the "latest agreed state", determined by version
// - To send state, any party can send latest state hash, version, and signature from each party in the channel.
// - After time period, any party can resolve dispute. This closes channel and allows state hash to be retrieved.
//
// In this design - there can only be a single dispute in order to negotiate the latest state hash authorised off-chain.
// Once StateChannel has accepted the final state hash, one party can publish the full state to the application contract.
// The application contract (SimplifiedSprites) fetches state hash and confirms it is indeed the latesst state.
// Afterwards, it stores the state, turns off the channel, and re-activates all functionality. All commands can be executed
// on-chain to finish the contract.
contract StateChannel {
    address[] public plist;
    mapping (address => bool) pmap; // List of players in this channel!

    enum Status { ON, DISPUTE, OFF }

    // Configuration for state channel
    uint256 public disputePeriod;  // Minimum time for dispute process (time all parties have to submit a command)
    address public owner; // Application we are interested in.

    // Current status for channel
    Status public status;
    uint256 public bestRound = 0;
    uint256 public t_start;
    uint256 public deadline;
    bytes32 public hstate;

    // List of disputes (i.e. successful state transitions on-chain)
    struct Dispute {
        uint256 round;
        uint256 t_start;
        uint256 t_settle;
    }

    Dispute dispute;

    event EventDispute (uint256 indexed deadline);
    event EventResolve (uint256 indexed bestround);
    event EventEvidence (uint256 indexed bestround, bytes32 hstate);

    modifier onlyowner { if(owner == msg.sender) _; else revert(); }
    modifier onlyplayers { if (pmap[msg.sender]) _; else revert(); }


    // The application creates this state channel and updates it with the list of players.
    // Also sets a fixed dispute period.
    constructor(address[] _plist, uint _disputePeriod) public {

        for (uint i = 0; i < _plist.length; i++) {
            plist.push(_plist[i]);
            pmap[_plist[i]] = true;
        }

        owner = msg.sender;
        disputePeriod = _disputePeriod;
    }

    // Trigger the dispute
    function triggerDispute() onlyplayers public {

        // Only accept a single command during a dispute
        require( status == Status.ON );
        status = Status.DISPUTE;
        t_start = block.timestamp + t_start;

    }

    // Store a state hash that was authorised by all parties in the state channel
    // This cancels any disputes in progress if it is associated with the largest nonce seen so far.
    // ANYONE can relay a message! Important for PISA.
    function setstate(uint256[] sigs, uint256 _i, bytes32 _hstate) public {
        require(_i > bestRound);
        require( status == Status.DISPUTE);

        // Commitment to signed message for new state hash.
        bytes32 h = keccak256(_hstate, _i, address(this));

        // Check all parties in channel have signed it.
        for (uint i = 0; i < plist.length; i++) {
            uint8 V = uint8(sigs[i*3+0])+27;
            bytes32 R = bytes32(sigs[i*3+1]);
            bytes32 S = bytes32(sigs[i*3+2]);
            verifySignature(plist[i], h, V, R, S);
        }

        // Store new state!
        bestRound = _i;
        hstate = _hstate;

        // Tell the world about the new state!
        emit EventEvidence(bestRound, hstate);
    }

    function resolve() onlyplayers public {
        require(block.number > deadline); // Dispute process should be finished?
        require(status == Status.DISPUTE);

        // Return to normal operations and update bestRound
        status = Status.OFF;
        bestRound = bestRound + 1;

        // Store dispute... due to successful on-chain transition
        dispute = Dispute(bestRound, t_start, deadline);

        emit EventResolve(bestRound);
    }


    // Fetch a dispute.
    function getDispute() public view returns (uint256, uint256, uint256) {
        require(status == Status.OFF);

        return (dispute.round, dispute.t_start, dispute.t_settle);
    }

    // Helper function to verify signatures
    function verifySignature(address pub, bytes32 h, uint8 v, bytes32 r, bytes32 s) public pure {
        address _signer = ecrecover(h,v,r,s);
        if (pub != _signer) revert();
    }

    // Fetch latest state hash, only fetchable once dispute process has concluded.
    function getStateHash() public view returns (bytes32) {
        require(status == Status.OFF);

        return hstate;
    }

    // Latest round in contract
    function latestClaim() public view returns(uint) {
        return bestRound;
    }
}

// Simplified Sprites - We can support deposits / withdrawals / transfers
// Full sprites can handle "asynchronous deposits", where the deposit function can be called at any time; and off-chain state updates can take it into account.
// Whereas here, all deposits must be processed via the dispute process.

contract SimplifiedSprites {
    mapping (address => bool) public players;
    mapping (address => uint) public balance; // List of players in this channel!
    address[] public playerslist;


    event EventWithdrawal(address receiver, uint amount);
    event EventTransfer(address receiver, address to, uint amount);
    event EventDeposit(address receiver, uint amount);

    modifier onlyplayers { require(players[msg.sender]); _; }

    // Set up the simplified Sprites Channel
    constructor(address[] _players) public {

        // Register players in the contract
        players[_players[0]] = true;
        players[_players[1]] = true;
        playerslist = _players;

        // TODO: Instantiate state channel here (and store address!)
    }

    // Allow a player to withdraw coins from the contract!
    // NOTE: This function cannot be executed off-chain via the state channel due to its
    // "side-effects". i.e. you cannot "send" coins off-chain.
    // Think: If channel is ON - this should not work - needs to be client side?
    function withdraw(uint _coins) public channel_turnedoff onlyplayers returns (bool) {

        // Only accept a single command during a dispute
        require(balance[msg.sender] >= _coins);

        // Update state!
        balance[msg.sender] = balance[msg.sender] - _coins;

        // Sending must be successful to continue
        require(msg.sender.send(_coins));

        // Tell the world about withdrawal
        emit EventWithdrawal(msg.sender, _coins);

        return true;

    }

    // Allow a player to withdraw coins from the contract!
    function transfer(address _to, uint _coins)  public channel_turnedoff onlyplayers returns (bool) {

        // Only accept a single command during a dispute
        require(balance[msg.sender] >= _coins);// Having a balance implies signer is in the contract
        require(players[_to]); // Receiver should be in the contract

        // Update state!
        balance[msg.sender] = balance[msg.sender] - _coins;

        // Transfer coins
        balance[_to] = balance[_to] + _coins;

        // Sending must be successful to continue
        require(msg.sender.send(_coins));

        // Tell the world about withdrawal
        emit EventTransfer(msg.sender, _to, _coins);

        return true;

    }

     // Sprites can support asynchronous deposits.
     // Our example here cannot - which is why it is "simplified".
     // NOTE: This function cannot be executed off-chain via the state channel due to its
     // "side-effects". i.e. you cannot "send" coins off-chain.
     // Think: If channel is ON - this should not work - needs to be client side?
    function deposit(uint _coins) payable public channel_turnedoff onlyplayers returns (bool) {

        // Only accept a single command during a dispute
        require(players[msg.sender]);
        require(_coins >= msg.value);

        // Update state!
        balance[msg.sender] = balance[msg.sender] + _coins;

        // Tell the world about withdrawal
        emit EventDeposit(msg.sender, msg.value);

        return true;
    }


    /********************/
    // State channel add-ons
    // State channel variables (address, on/off) + modifiers.
    // Create channel: Creates the state channel and locks down functionality Here
    // Set state: Update contract's state and re-enable functionality - assuming dispute process is finished.
    /********************/

    // State channel information
    address public channel;
    bool public channelon;
    uint public channelinstance;

    modifier channel_turnedoff { if(channelon) revert(); else _; } // Checks if channel is turned off before executing

    // Create state channel and lock down functions
    function createChannel(uint256[3] sigs, uint _disputeTime) public onlyplayers {

        // Channel cannot already be turned on!
        require(!channelon);

        // Commitment to signed message for new state hash.
        bytes32 h = keccak256("createchannel", channelinstance + 1, address(this));

        // Check all parties in channel have signed it.
        // Possible to save 1 signature; not worried about it for now.
        for (uint i = 0; i < playerslist.length; i++) {
            uint8 V = uint8(sigs[i*3+0])+27;
            bytes32 R = bytes32(sigs[i*3+1]);
            bytes32 S = bytes32(sigs[i*3+2]);

            // Check signature for this player!
            address _signer = ecrecover(h,V,R,S);
            if (playerslist[i] != _signer) revert();
          }

          // Create channel
          channelon = true;
          channel = new StateChannel(playerslist, _disputeTime);
          channelinstance = channelinstance + 1; // increment channel instance

    }
    // Update state
    function setState(uint[2] _balances, uint r) public onlyplayers {

        // Reverts if there is no hstate!
        bytes32 hstate = StateChannel(channel).getStateHash();

        // Check - was there any activity in the channel?
        if(StateChannel(channel).latestClaim() == 0) {
          channelon = false;
          channel = 0;
          return;
        }

        // OK there was activity - does this represent the committed state?
        require(hstate == sha256(_balances, r));

        // Awesome! Turn off state channel and update state
        channel = 0; // Remove reference...
        channelon = false; // Turn off

        // We assume p1 = index 0, and p2 = index 1
        address p1 = playerslist[0];
        address p2 = playerslist[1];

        // Just update their balance as normal
        balance[p1] = _balances[0];
        balance[p2] = _balances[1];
    }
}
