const BattleShipWithoutBoard = artifacts.require("./BattleShipWithoutBoard.sol");
const Web3Util = require("web3-utils");
const Web3 = require("web3");
const web32 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));
const { createGasProxy, logGasLib } = require("./gasProxy");

const deposit = async (contract, player, amount, expectedContractBalance) => {
    const deposit = await contract.deposit({ from: player, value: amount });
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

const shipSizes = [5, 4, 3, 3, 2];
const random = "0x61";

const constructBasicShips = async (contract, player) => {
    const round = await contract.round();
    const emptyBoard = createEmptyBoard();

    const ships = shipSizes.map((element, index) => {
        const id = alphabet[index];
        const size = element;
        const x1 = index;
        const y1 = 0;
        const x2 = index;
        const y2 = element - 1;

        addShipToBoard(id, x1, y1, x2, y2, emptyBoard);

        return committedShip(id, size, x1, y1, x2, y2, random, player, round, contract.address);
    });

    return { sizes: shipSizes, ships, board: emptyBoard };
};

const constructSameCellShips = async (contract, player) => {
    const round = await contract.round();
    const emptyBoard = createEmptyBoard();
    // reverse the ships so that the largest one is placed last

    const reversedShipSizes = [...shipSizes].reverse();
    const ships = reversedShipSizes.map((element, index) => {
        const id = alphabet[index];
        const size = element;
        const x1 = 0;
        const y1 = 0;
        const x2 = 0;
        const y2 = element - 1;

        addShipToBoard(id, x1, y1, x2, y2, emptyBoard);

        return committedShip(id, size, x1, y1, x2, y2, random, player, round, contract.address);
    });

    // reverse the ships back into their original order
    ships.reverse();
    return { sizes: shipSizes, ships, board: emptyBoard };
};

const committedShips = async (contract, size, ships, player) => {
    const round = await contract.round();
    const commitment = Web3Util.soliditySha3(
        { t: "uint[]", v: size },
        { t: "bytes32[]", v: ships },
        { t: "address", v: player },
        { t: "uint", v: round },
        { t: "address", v: contract.address }
    );

    return {
        size,
        ships,
        player,
        round: round,
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
    let moveCtr = await contract.move_ctr();
    console.log(`\t${player} move ${moveCtr} attack (${x}, ${y})`);

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
    let moveCtr = await contract.move_ctr();
    console.log(`\t${player} move ${moveCtr} reveal (${x}, ${y}) as ${hit ? "hit" : "miss"}`);
    let round = await contract.round();
    let turnBefore = await contract.turn();

    const revealHash = Web3Util.soliditySha3(
        { t: "uint8", v: x },
        { t: "uint8", v: y },
        { t: "bool", v: hit },
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
    return { x, y, hit, moveCtr, round, gameAddress: contract.address, revealHash, sig };
};

const revealSunk = async (contract, player, shipIndex, x1, y1, x2, y2, r, isWin) => {
    let moveCtr = await contract.move_ctr();
    console.log(`\t${player} move ${moveCtr} reveal sunk at (${x}, ${y})`);
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

const testForHitAndReveal = async (contract, player, board, x, y, ships, currentSinks, overrides) => {
    const hit = overrides && overrides.hitSupplied ? overrides.hit : board[x][y];
    if (hit === 0) {
        // miss, reveal it
        const sig = await reveal(contract, player, x, y, false);
        return sig;
    } else {
        const indexAndId = recordHitAndTestForSink(hit, ships);
        let sink;
        if (overrides && overrides.sunkSupplied) {
            sink = overrides.sunk;
        } else sink = indexAndId;

        if (sink) {
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
            const sig = await reveal(contract, player, x, y, true);
            return sig;
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

    assert.equal(playerBalanceBefore - playerBalanceAfter, amount);
    assert.equal(contractBalanceBefore - contractBalanceAfter, amount);
};

const timerChallenge = 20;
const depositValue = Web3Util.toWei("0.1", "ether");

const setupGame = async (contract, player0, player1, boardBuilder0, boardBuilder1) => {
    console.log("\t// SETUP //");

    assert.equal(await web32.eth.getBalance(contract.address), 0);

    console.log("\tdeposit");
    await deposit(contract, player0, depositValue, depositValue);
    await deposit(contract, player1, depositValue, 2 * depositValue);

    console.log("\tplace bet");
    await placeBet(contract, player0, depositValue);
    await placeBet(contract, player1, depositValue);

    console.log("\tconstruct and sign ships");
    const player0Ships = await boardBuilder0(contract, player0);
    const player1Ships = await boardBuilder1(contract, player1);
    const player0Sigs = await signShips(
        contract,
        player0Ships.sizes,
        player0Ships.ships.map(s => s.commitment),
        player0
    );
    const player1Sigs = await signShips(
        contract,
        player1Ships.sizes,
        player1Ships.ships.map(s => s.commitment),
        player1
    );

    console.log("\tstore ships");
    // submit each others ships
    await storeShips(
        contract,
        player1Ships.sizes,
        player1Ships.ships.map(s => s.commitment),
        player1Sigs.signature,
        player0,
        1,
        player1Sigs.shipsCommitment
    );
    await storeShips(
        contract,
        player0Ships.sizes,
        player0Ships.ships.map(s => s.commitment),
        player0Sigs.signature,
        player1,
        0,
        player0Sigs.shipsCommitment
    );

    console.log("\tstart play");
    await playerReady(contract, player0, 0);
    await playerReady(contract, player1, 1);
    console.log("\t// SETUP //\n");

    return { player0: player0Ships, player1: player1Ships };
};

const attackAndReveal = async (
    contract,
    attackPlayer,
    attackPlayerCurrentSinks,
    x,
    y,
    revealPlayer,
    revealPlayerBoard,
    revealPlayerShips,
    overrides
) => {
    await attack(contract, attackPlayer, x, y);
    let attackMoveCtr = await contract.move_ctr();
    let revealSink = await testForHitAndReveal(
        contract,
        revealPlayer,
        revealPlayerBoard,
        x,
        y,
        revealPlayerShips,
        attackPlayerCurrentSinks,
        (overrides.hitSupplied || overrides.sinkSupplied) && overrides
    );
    if (revealSink === "sink") {
        return { sink: true };
    } else {
        assert.equal(attackMoveCtr.toNumber(), revealSink.moveCtr.toNumber());
        return revealSink;
    }
};

const playThrough5x5 = async (contract, player0, player1, gameState, neverRevealPlayer0, neverSinkPlayer0) => {
    console.log("\t// PLAY //");
    let player0Sinks = 0;
    let player1Sinks = 0;
    let winner;
    const reveals = [];

    for (x = 0; x < 5; x++) {
        for (y = 0; y < 5; y++) {
            let player0Move = await attackAndReveal(
                contract,
                player0,
                player0Sinks,
                x,
                y,
                player1,
                gameState.player1.board,
                gameState.player1.ships,
                {}
            );
            if (player0Move.sink) player0Sinks++;
            else {
                reveals[player0Move.moveCtr] = player0Move;
            }
            if (player0Sinks === 5) {
                winner = player0;
                break;
            }

            let player0Overrides = {};
            if (neverRevealPlayer0) player0Overrides = { ...player0Overrides, ...{ hit: 0, hitSupplied: true } };
            if (neverSinkPlayer0) player0Overrides = { ...player0Overrides, ...{ sunk: false, sunkSupplied: true } };

            // now switch over and reveal the other player
            let player1Move = await attackAndReveal(
                contract,
                player1,
                player1Sinks,
                x,
                y,
                player0,
                gameState.player0.board,
                gameState.player0.ships,
                player0Overrides
            );
            if (player1Move.sink) player1Sinks++;
            else {
                reveals[player1Move.moveCtr] = player1Move;
            }
            if (player1Sinks === 5) {
                winner = player1;
                break;
            }
        }
    }
    if (!winner) throw new Error("No winner reached!");
    console.log("\t// PLAY //\n");
    return { winner, reveals };
};

contract("BattleShips", function(accounts) {
    const player0 = accounts[0];
    const player1 = accounts[1];
    const gasLibs = [];
    const config = {
        endToEnd: true,
        fraudShipsSameCell: false,
        fraudAttackSameCell: false,
        fraudDeclaredNotHit: false,
        fraudDeclaredNotSunk: false
    };  

    it("simple end to end", async () => {
        if (!config.endToEnd) return;

        console.log("\tconstruct");
        const gasLib = [];
        const BattleShipGamePre = createGasProxy(BattleShipWithoutBoard, gasLib, web32);
        const BattleShipGame = await BattleShipGamePre.new(player0, player1, timerChallenge);
        
        // setup with basic boards
        let gameState = await setupGame(BattleShipGame, player0, player1, constructBasicShips, constructBasicShips);

        // play
        let { winner } = await playThrough5x5(BattleShipGame, player0, player1, gameState);

        console.log("\t// FINALISE //");

        console.log(`\twinner ${winner} opening ships`);
        await openShips(BattleShipGame, winner, winner === player0 ? gameState.player0.ships : gameState.player1.ships);
        console.log("\tfinish game");
        await increaseTimeStamp(30);
        await finishGame(BattleShipGame, winner);
        console.log("\twinner withdraws");
        await withdraw(BattleShipGame, winner, depositValue);

        console.log("\t// FINALISE //");
        gasLibs.push({ test: "end-to-end", gasLib });
    });

    it("simple test fraud ships same cell", async () => {
        if (!config.fraudShipsSameCell) return;
        console.log("\tconstruct");
        const gasLib = [];
        const BattleShipGame = await createGasProxy(BattleShipWithoutBoard, gasLib, web32).new(
            player0,
            player1,
            timerChallenge
        );

        // player 0 puts all ships on top of each other, so player 1 will not be able to win
        // they should be able to commit a fraud proof after though
        let gameState = await setupGame(BattleShipGame, player0, player1, constructSameCellShips, constructBasicShips);
        let { winner } = await playThrough5x5(BattleShipGame, player0, player1, gameState);
        assert.equal(winner, player0);
        console.log("\t// FINALISE //");

        let notWinner = winner === player0 ? player1 : player0;
        console.log(`\twinner ${winner} opening ships`);
        await openShips(BattleShipGame, winner, winner === player0 ? gameState.player0.ships : gameState.player1.ships);

        console.log("\tpresent fraud at (0, 0)");
        await fraudShipsSameCell(BattleShipGame, notWinner, 0, 1, 0, 0);

        console.log("\tfinish game");
        console.log("\twinner withdraws");
        await withdraw(BattleShipGame, notWinner, depositValue);

        console.log("\t// FINALISE //");
        gasLibs.push({ test: "fraud-ships-same-cell", gasLib });
    });

    it("simple test fraud attack same cell", async () => {
        if (!config.fraudAttackSameCell) return;
        console.log("\tconstruct");
        const gasLib = [];
        const BattleShipGamePre = createGasProxy(BattleShipWithoutBoard, gasLib, web32);
        const BattleShipGame = await BattleShipGamePre.new(player0, player1, timerChallenge);

        // setup with basic boards
        let gameState = await setupGame(BattleShipGame, player0, player1, constructBasicShips, constructBasicShips);

        let move0 = await attackAndReveal(
            BattleShipGame,
            player0,
            0,
            0,
            0,
            player1,
            gameState.player1.board,
            gameState.player1.ships,
            {}
        );
        let move1 = await attackAndReveal(
            BattleShipGame,
            player1,
            0,
            0,
            0,
            player0,
            gameState.player0.board,
            gameState.player0.ships,
            {}
        );
        let move2 = await attackAndReveal(
            BattleShipGame,
            player0,
            0,
            0,
            0,
            player1,
            gameState.player1.board,
            gameState.player1.ships,
            {}
        );

        console.log("\t// FINALISE //");
        // player 0 has no played at the same location twice, fraud
        console.log("player 1 calls fraudAttackSameCell");
        await fraudAttackSameCell(contract, player1, move0.moveCtr, move2.moveCtr, x, y, move0.sig, move1.sig);
        console.log("\twinner withdraws");
        await withdraw(BattleShipGame, player1, depositValue);

        console.log("\t// FINALISE //");
        gasLibs.push({ test: "fraud-attack-same-cell", gasLib });
    });

    it("simple test fraud declared not hit", async () => {
        if (!config.fraudDeclaredNotHit) return;
        console.log("\tconstruct");
        const gasLib = [];
        const BattleShipGame = await createGasProxy(BattleShipWithoutBoard, gasLib, web32).new(
            player0,
            player1,
            timerChallenge
        );

        // player 0 puts all ships on top of each other, so player 1 will not be able to win
        // they should be able to commit a fraud proof after though
        let gameState = await setupGame(BattleShipGame, player0, player1, constructSameCellShips, constructBasicShips);
        let { winner, reveals } = await playThrough5x5(BattleShipGame, player0, player1, gameState, true);
        assert.equal(winner, player0);
        console.log("\t// FINALISE //");

        let notWinner = winner === player0 ? player1 : player0;
        console.log(`\twinner ${winner} opening ships`);
        await openShips(BattleShipGame, winner, winner === player0 ? gameState.player0.ships : gameState.player1.ships);

        console.log("\tpresent fraud at move 1");
        await fraudDeclaredNotHit(BattleShipGame, notWinner, 0, 0, 0, 3, reveals[3].sig);

        console.log("\tfinish game");
        console.log("\twinner withdraws");
        await withdraw(BattleShipGame, notWinner, depositValue);

        console.log("\t// FINALISE //");
        gasLibs.push({ test: "fraud-declared-not-hit", gasLib });
    });

    it("simple test fraud declared not sunk", async () => {
        // we need web3 1.0.0-beta.36 to run this test, as we need abiencoderv2 support
        if (!config.fraudDeclaredNotSunk) return;
        console.log("\tconstruct");
        const gasLib = [];
        const BattleShipGame = await createGasProxy(BattleShipWithoutBoard, gasLib, web32).new(
            player0,
            player1,
            timerChallenge
        );

        // player 0 puts all ships on top of each other, so player 1 will not be able to win
        // they should be able to commit a fraud proof after though
        let gameState = await setupGame(BattleShipGame, player0, player1, constructSameCellShips, constructBasicShips);
        let { winner, reveals } = await playThrough5x5(BattleShipGame, player0, player1, gameState, false, true);

        assert.equal(winner, player0);
        console.log("\t// FINALISE //");

        let notWinner = winner === player0 ? player1 : player0;
        console.log(`\twinner ${winner} opening ships`);
        await openShips(BattleShipGame, winner, winner === player0 ? gameState.player0.ships : gameState.player1.ships);

        console.log("\tpresent fraud at move 3, 7, 11, 15, 19");
        let moves = [3, 7, 11, 15, 19];

        await fraudDeclaredNotSunk(BattleShipGame, notWinner, 0, moves, moves.map(m => reveals[m].sig));
        return;

        console.log("\tfinish game");
        console.log("\twinner withdraws");
        await withdraw(BattleShipGame, notWinner, depositValue);

        console.log("\t// FINALISE //");
        gasLibs.push({ test: "fraud-declared-not-sunk", gasLib });
    });
    after(() => {
        gasLibs.forEach(g => {
            console.log();
            console.log(g.test);
            logGasLib(g.gasLib);
            console.log();
        });
    });
});

const Phase = Object.freeze({
    Setup: 0,
    Attack: 1,
    Reveal: 2,
    Win: 3,
    Fraud: 4
});

const fraudAttackSameCell = async (contract, player, move1, move2, x, y, move1Sig, move2Sig) => {
    await contract.fraudAttackSameCell(move1.moveCtr, move2.moveCtr, x, y, [move1Sig, move2Sig], { from: player });
    let phase = await contract.phase();
    assert.equal(phase.toNumber(), Phase.Setup);
};

const fraudShipsSameCell = async (contract, player, shipIndex1, shipIndex2, x, y) => {
    await contract.fraudShipsSameCell(shipIndex1, shipIndex2, x, y, { from: player });
    let phase = await contract.phase();
    // after fraud is declard we expect to have reset
    assert.equal(phase.toNumber(), Phase.Setup);
};

const fraudDeclaredNotHit = async (contract, player, shipIndex1, x, y, moveCtr, signature) => {
    await contract.fraudDeclaredNotHit(shipIndex1, x, y, moveCtr, signature, { from: player });
    let phase = await contract.phase();
    // after fraud is declard we expect to have reset
    assert.equal(phase.toNumber(), Phase.Setup);
};

const fraudDeclaredNotSunk = async (contract, player, shipIndex, moves, signatures) => {
    await contract.contract.methods.fraudDeclaredNotSunk(shipIndex, moves, signatures).send({ from: player });
    // await contract.fraudDeclaredNotSunk(shipIndex, moves, signatures, { from: player, gas: 2000000 });
    return;
    let phase = await contract.phase();
    // after fraud is declard we expect to have reset
    assert.equal(phase.toNumber(), Phase.Setup);
};
