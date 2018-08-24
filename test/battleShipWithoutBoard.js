const BattleShipWithoutBoard = artifacts.require("./BattleShipWithoutBoard.sol");
const Web3Util = require("web3-utils");
const Web3 = require("web3");
const web32 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));

// ganache-cli -d -l 15000000 --allowUnlimitedContractSize

// const Web3 = require('web3')
// const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'))
// const abi = require('ethereumjs-abi')
// const BigNumber = require('bignumber.js')
// const StateChannel = artifacts.require('./StateChannel.sol')

// const Commit = require('./helpers/commitments.js')
const deposit = async (contract, player, amount, expectedContractBalance) => {
    const deposit0 = await contract.deposit({ from: player, value: amount });
    const balance = await contract.player_balance(player);
    assert.equal(balance, amount);
    assert.equal(await web32.eth.getBalance(contract.address), expectedContractBalance);
};

const placeBet = async (contract, player, amount) => {
    const pastDeposit = await contract.player_balance(player);
    const bet0 = await contract.placeBet(amount, { from: player });
    const balance = await contract.player_balance(player);
    assert.equal(pastDeposit - balance, amount);
    const bet = await contract.bets(player);
    assert.equal(bet, amount);
};

const committedShip = (id, size, x1, y1, x2, y2, r, player, round, gameAddress) => {
    // ship is commitment to...
    // x1, y1, x2, y2, random, player, game round, contract address(this)
    const commitment = Web3Util.soliditySha3(
        { t: "uint8", v: x1 },
        { t: "uint8", v: y1 },
        { t: "uint8", v: x2 },
        { t: "uint8", v: y2 },
        { t: "uint", v: r },
        { t: "address", v: player },
        { t: "uint", v: round },
        { t: "address", v: gameAddress }
    );

    return {
        id,
        size,
        x1,
        y1,
        x2,
        y2,
        r,
        player,
        round,
        gameAddress,
        commitment,
        hits: 0
    };
};

// ASIDE on how to construct a board
// at any given point(x).
// can I go <dir> <size> spots?
// answer this by by asking question of point(<dir> + 1), then ask can I go <dir> (<size> - 1) spots.
// when <size> - (i) == 0, and answer is yes, then total answer is yes
// if answer is ever no? then total answer is no.

let createArray = (size, elementCreator) => Array.apply(null, Array(size)).map(elementCreator);
let createEmptyBoard = () => createArray(10, () => createArray(10, () => 0));
const alphabet = "abcde";

const addShipToBoard = (id, x1, y1, x2, y2, board) => {
    for (i = x1; i <= x2; i++) {
        for (j = y1; j <= y2; j++) {
            board[i][j] = id;
        }
    }
};

const constructBasicShips = async (contract, player) => {
    const sizes = [5, 4, 3, 3, 2];
    const r = "0x61";
    const round = await contract.round();
    const emptyBoard = createEmptyBoard();

    const ships = sizes.map((element, index) => {
        const id = alphabet[index];
        const size = element;
        const x1 = index;
        const y1 = 0;
        const x2 = index;
        const y2 = element - 1;

        addShipToBoard(id, x1, y1, x2, y2, emptyBoard);

        return committedShip(id, size, x1, y1, x2, y2, r, player, round, contract.address);
    });

    return { sizes, ships, board: emptyBoard };
};

const committedShips = async (contract, size, ships, player) => {
    const round = await contract.round();
    const commitment = Web3Util.soliditySha3(
        { t: "uint[]", v: size },
        { t: "bytes32[]", v: ships },
        { t: "address", v: player },
        { t: "uint", v: 0 },
        { t: "address", v: contract.address }
    );

    return {
        size,
        ships,
        player,
        round: 0,
        gameAddress: contract.address,
        commitment
    };
};

const signShips = async (contract, size, ships, player) => {
    const shipsCommitment = await committedShips(contract, size, ships, player);
    const signature = await web32.eth.sign(shipsCommitment.commitment, player);
    return { shipsCommitment, signature };
};

const storeShips = async (
    contract,
    sizes,
    shipCommitments,
    signature,
    player,
    counterPartyIndex,
    shipsTotalCommitment
) => {
    await contract.storeShips(sizes, shipCommitments, signature, { from: player, gas: 2000000 });
    const playerShipsRecieved = await contract.playerShipsReceived(counterPartyIndex);
    assert.equal(playerShipsRecieved, true);
};

const playerReady = async (contract, player, expectedPhase) => {
    await contract.readyToPlay({ from: player });
    let phase = await contract.phase();
    assert.equal(phase, expectedPhase);
};

const attack = async (contract, player, x, y) => {
    console.log(`\t${player} attack (${x}, ${y})`);
    let moveCtr = await contract.move_ctr();
    let round = await contract.round();

    const attackHash = Web3Util.soliditySha3(
        { t: "uint8", v: x },
        { t: "uint8", v: y },
        { t: "uint", v: moveCtr },
        { t: "uint", v: round },
        { t: "address", v: contract.address }
    );

    let sig = await web32.eth.sign(attackHash, player);
    await contract.attack(x, y, sig, { from: player });
    const phase = await contract.phase();
    assert.equal(phase.toNumber(), 2);
};

const reveal = async (contract, player, x, y, hit) => {
    console.log(`\t${player} reveal (${x}, ${y}) as ${hit ? "hit" : "miss"}`);
    let moveCtr = await contract.move_ctr();
    let round = await contract.round();
    let turnBefore = await contract.turn();

    const revealHash = Web3Util.soliditySha3(
        { t: "uint8", v: x },
        { t: "uint8", v: y },
        { t: "bool", v: hit },
        { t: "address", v: player },
        { t: "uint", v: moveCtr },
        { t: "uint", v: round },
        { t: "address", v: contract.address }
    );

    let sig = await web32.eth.sign(revealHash, player);
    await contract.revealslot(hit, sig, { from: player });

    // check that phase is now attack, and that turn has incremented
    const turnAfter = await contract.turn();
    const phase = await contract.phase();
    assert.equal(phase.toNumber(), 1);
    assert.equal(turnAfter.toNumber(), (turnBefore.toNumber() + 1) % 2);
};

const revealSunk = async (contract, player, shipIndex, x1, y1, x2, y2, r, isWin) => {
    console.log(`\t${player} reveal sunk at (${x}, ${y})`);
    let moveCtr = await contract.move_ctr();
    let round = await contract.round();
    let turnBefore = await contract.turn();

    const revealHash = Web3Util.soliditySha3(
        { t: "uint8", v: x1 },
        { t: "uint8", v: y1 },
        { t: "uint8", v: x2 },
        { t: "uint8", v: y2 },
        { t: "uint", v: r },
        { t: "uint", v: shipIndex },
        { t: "uint", v: moveCtr },
        { t: "uint", v: round },
        { t: "address", v: contract.address }
    );

    let sig = await web32.eth.sign(revealHash, player);
    await contract.revealsunk(shipIndex, x1, y1, x2, y2, r, sig, { from: player });

    // check that phase is now attack, and that turn has incremented
    const turnAfter = await contract.turn();
    const phase = await contract.phase();
    assert.equal(phase.toNumber(), isWin ? 3 : 1);
    assert.equal(turnAfter.toNumber(), isWin ? turnBefore.toNumber() : (turnBefore.toNumber() + 1) % 2);
};

const recordHitAndTestForSink = (shipId, ships) => {
    const shipIndex = ships.findIndex(s => s.id === shipId);
    const hitShip = ships[shipIndex];
    hitShip.hits = hitShip.hits + 1;

    // we've hit all the spots
    return hitShip.size === hitShip.hits ? { shipIndex, shipId } : false;
};

const testForHitAndReveal = async (contract, player, board, x, y, ships, currentSinks) => {
    const hit = board[x][y];
    if (hit === 0) {
        // miss, reveal it
        await reveal(contract, player, x, y, false);
    } else {
        const indexAndId = recordHitAndTestForSink(hit, ships);

        if (indexAndId) {
            // sunk, reveal it
            const ship = ships[indexAndId.shipIndex];
            await revealSunk(
                contract,
                player,
                indexAndId.shipIndex,
                ship.x1,
                ship.y1,
                ship.x2,
                ship.y2,
                ship.r,
                currentSinks == 4
            );
            return "sink";
        } else {
            // hit but not sunk, reveal it
            await reveal(contract, player, x, y, true);
        }
    }
};

const openShips = async (contract, winner, winnerShips) => {
    await contract.openships(
        winnerShips.map(s => s.x1),
        winnerShips.map(s => s.y1),
        winnerShips.map(s => s.x2),
        winnerShips.map(s => s.y2),
        winnerShips.map(s => s.r),
        // remove gas
        { from: winner }
    );
    const phase = await contract.phase();
    assert.equal(phase.toNumber(), 4);
};

const finishGame = async (contract, player) => {
    await contract.finishGame({ from: player });
    const phase = await contract.phase();
    assert.equal(phase.toNumber(), 0);
};

const increaseTimeStamp = seconds => {
    return new Promise((resolve, reject) => {
        web32.currentProvider.send(
            {
                jsonrpc: "2.0",
                method: "evm_increaseTime",
                params: [seconds],
                id: new Date().getSeconds()
            },
            (err, rep) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rep);
                }
            }
        );
    });
};

const withdraw = async (contract, player, amount) => {
    const playerBalanceBefore = await contract.player_balance(player);
    const contractBalanceBefore = await web32.eth.getBalance(contract.address);
    await contract.withdraw(amount, { from: player });
    const playerBalanceAfter = await contract.player_balance(player);
    const contractBalanceAfter = await web32.eth.getBalance(contract.address);

    assert.equal(playerBalanceBefore.toNumber() - playerBalanceAfter.toNumber(), amount);
    assert.equal(contractBalanceBefore - contractBalanceAfter, amount);
};

contract("BattleShips", function(accounts) {
    const player0 = accounts[0];
    const player1 = accounts[1];
    const timerChallenge = 20;
    const depositValue = Web3Util.toWei("0.1", "ether");

    it("simple end to end", async () => {
        console.log("\t// SETUP //");

        console.log("\tconstruct");
        const BattleShipGame = await BattleShipWithoutBoard.new(player0, player1, timerChallenge);
        assert.equal(await web32.eth.getBalance(BattleShipGame.address), 0);

        console.log("\tdeposit");
        await deposit(BattleShipGame, player0, depositValue, depositValue);
        await deposit(BattleShipGame, player1, depositValue, 2 * depositValue);

        console.log("\tplace bet");
        await placeBet(BattleShipGame, player0, depositValue);
        await placeBet(BattleShipGame, player1, depositValue);

        console.log("\tconstruct and sign ships");
        const player0Ships = await constructBasicShips(BattleShipGame, player0);
        const player1Ships = await constructBasicShips(BattleShipGame, player1);
        const player0Sigs = await signShips(
            BattleShipGame,
            player0Ships.sizes,
            player0Ships.ships.map(s => s.commitment),
            player0
        );
        const player1Sigs = await signShips(
            BattleShipGame,
            player1Ships.sizes,
            player1Ships.ships.map(s => s.commitment),
            player1
        );

        console.log("\tstore ships");
        // submit each others ships
        await storeShips(
            BattleShipGame,
            player1Ships.sizes,
            player1Ships.ships.map(s => s.commitment),
            player1Sigs.signature,
            player0,
            1,
            player1Sigs.shipsCommitment
        );
        await storeShips(
            BattleShipGame,
            player0Ships.sizes,
            player0Ships.ships.map(s => s.commitment),
            player0Sigs.signature,
            player1,
            0,
            player0Sigs.shipsCommitment
        );

        console.log("\tstart play");
        await playerReady(BattleShipGame, player0, 0);
        await playerReady(BattleShipGame, player1, 1);
        console.log("\t// SETUP //\n");

        console.log("\t// PLAY //");
        let player0Sinks = 0;
        let player1Sinks = 0;
        let winner;

        for (x = 0; x < 5; x++) {
            for (y = 0; y < 5; y++) {
                await attack(BattleShipGame, player0, x, y);
                let player0Sink = await testForHitAndReveal(
                    BattleShipGame,
                    player1,
                    player1Ships.board,
                    x,
                    y,
                    player1Ships.ships,
                    player0Sinks
                );
                if (player0Sink === "sink") player0Sinks++;
                if (player0Sinks === 5) {
                    winner = player0;
                    break;
                }

                // now switch over and reveal the other player
                await attack(BattleShipGame, player1, x, y);
                let player1Sink = await testForHitAndReveal(
                    BattleShipGame,
                    player0,
                    player0Ships.board,
                    x,
                    y,
                    player0Ships.ships,
                    player1Sinks
                );
                if (player1Sink === "sink") player1Sinks++;
                if (player1Sinks === 5) {
                    winner = player1;
                    break;
                }
            }
        }
        if (!winner) throw new Error("No winner reached!");
        console.log("\t// PLAY //\n");

        console.log("\t// FINALISE //");

        console.log(`\twinner ${winner} opening ships`);
        await openShips(BattleShipGame, winner, winner === player0 ? player0Ships.ships : player1Ships.ships);
        console.log("\tfinish game");
        await increaseTimeStamp(30);
        await finishGame(BattleShipGame, winner);
        console.log("\twinner withdraws");
        await withdraw(BattleShipGame, winner, depositValue);

        console.log("\t// FINALISE //");
    });
});
