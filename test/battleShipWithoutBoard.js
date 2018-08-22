const BattleShipWithoutBoard = artifacts.require("./BattleShipWithoutBoard.sol");

// const Web3 = require('web3')
// const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'))
// const abi = require('ethereumjs-abi')
// const BigNumber = require('bignumber.js')
// const StateChannel = artifacts.require('./StateChannel.sol')

// const Commit = require('./helpers/commitments.js')

contract("BattleShips", function(accounts) {
    const player0 = accounts[0];
    const player1 = accounts[1];
    const timerChallenge = 20;

    before(async () => {
        console.log("hello");
        // statechannel = await StateChannel.new([player1, player2], 20)
        // battleship = await BattleShips.new(player1, player2, '0x0')
        // battleship2 = await BattleShips.new(player1, player2, statechannel.address)

    });

    it("test deposit", async () => {
        const BattleShipGame = await BattleShipWithoutBoard.new(player0, player1, timerChallenge);

        let deposit = await BattleShipGame.deposit({from: player0, gas: 300000, value: web3.toWei(0.1, "ether") })
    })

    // constructor sets correct properties

    // order
    // 1. constructor
    // 2. deposit by both players
    // 3. withdraw can occur at any time
    // 4. increment bet by both players , placeBet (can game be cancelled here?)
    // 5. Both players sign ship hashes off-chain
    // 6. The ships are submitted
    // 7. Ready to play is called

    // 8. Up until ready to play, any player can cancel the game with doNotPlay()
    
    // Both players must exchange signed ship hashes off-chain. Counterparty submits a player’s list of ships: 
    // BattleShipWithoutBoard.storeShips(uint8[] _size, bytes32[] _ships, bytes _signature)
    
    // Both players must signal that they are “ready to play” - only works after ships are submitted
    // BattleShipWithoutBoard.readyToPlay() 
    
    // Any player can cancel the game setup and get back their bets 
    //     BattleShipWithoutBoard.doNotPlay()
    
    // 
    

});
