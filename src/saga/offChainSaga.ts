import { call, takeEvery, select, put } from "redux-saga/effects";
import { Action, ActionType } from "../action/rootAction";
import { Contract } from "web3-eth-contract";
import Web3 = require("web3");
const BattleShipWithoutBoardInChannel = require("./../../build/contracts/BattleShipWithoutBoardInChannel.json");
const StateChannelFactory = require("./../../build/contracts/StateChannelFactory.json");
const StateChannel = require("./../../build/contracts/StateChannel.json");
import Web3Util from "web3-utils";
import ethereumjs from "ethereumjs-util";
import { dummyRandom } from "./sagaGlobals";
import { BigNumber } from "bignumber.js";
import { Selector } from "../store";
import { hashAndSignAttack, hashAttack, hashAndSignReveal, hashReveal, hashRevealSunk } from "./attackRevealSaga";
import { hashWithAddress } from "./stateChannelSaga";
import { Reveal } from "../entities/gameEntities";
import { TimeLogger } from "./../utils/TimeLogger";

export default function* offChain() {
    yield takeEvery(ActionType.BOTH_PLAYERS_READY_OFF_CHAIN, bothPlayersReadyToPlayOffChain);
    yield takeEvery(ActionType.ACKNOWLEDGE_ATTACK_BROADCAST, acknowledgeAttackBroadcast);
    yield takeEvery(ActionType.ACKNOWLEDGE_REVEAL_BROADCAST, acknowledgeRevealBroadcast);
}

export function* bothPlayersReadyToPlayOffChain() {
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    if (player.goesFirst) {
        // transition to await attack
        TimeLogger.theLogger.log(player.address)("Await attack input");
        yield put(Action.updateCurrentActionType(ActionType.ATTACK_INPUT_AWAIT));
    } else {
        // TODO: put in awaits later transition to await attack accept
        //yield put(Action.updateCurrentActionType(ActionType.ATTACK_BROADCAST_AWAIT));
    }
}

export function* attackInput(action: ReturnType<typeof Action.attackInput>) {
    
    const offChainBattleshipContract: ReturnType<typeof Selector.offChainBattleshipContract> = yield select(
        Selector.offChainBattleshipContract
    );
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    TimeLogger.theLogger.log(player.address)(`Attack ${action.payload.x},${action.payload.y}`);

    // sign the x,y,move_ctr,round,address hash
    const moveCtr = yield call(offChainBattleshipContract.methods.move_ctr().call);
    const round = yield call(offChainBattleshipContract.methods.round().call);
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);

    const sig: string = yield call(
        hashAndSignAttack,
        action.payload.x,
        action.payload.y,
        moveCtr,
        round,
        player.address,
        offChainBattleshipContract.options.address,
        web3
    );

    const attack = offChainBattleshipContract.methods.attack(action.payload.x, action.payload.y, sig);
    
    yield call(attack.send, { from: player.address, gas: 300000 });

    // create an attack for the opponent's contract

    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const counterpartyAttackSig: string = yield call(
        hashAndSignAttack,
        action.payload.x,
        action.payload.y,
        moveCtr,
        round,
        player.address,
        counterparty.offChainBattleshipAddress!,
        web3
    );
    const onChainBattleshipContract: ReturnType<typeof Selector.onChainBattleshipContract> = yield select(
        Selector.onChainBattleshipContract
    );
    const onChainAttackSig: string = yield call(
        hashAndSignAttack,
        action.payload.x,
        action.payload.y,
        moveCtr,
        round,
        player.address,
        onChainBattleshipContract.options.address,
        web3
    );

    // we also want to get the state of the contract for verification by the counterparty
    const state = yield call(offChainBattleshipContract.methods.getState(dummyRandom).call);
    // wrap it in the address of the on chain battleship contract, and sign it
    const hashedWithAddress = hashWithAddress(state._h, onChainBattleshipContract.options.address);

    //TODO: current round
    const currentRound = moveCtr;

    // also generate a channel sig for use in set state
    const onChainStateChannel = yield call(onChainBattleshipContract.methods.stateChannel().call);
    const channelHash = yield call(hashForSetState, hashedWithAddress, currentRound, onChainStateChannel);
    const channelSig = yield call(web3.eth.sign, channelHash, player.address);

    // store this move
    yield put(
        Action.attackCreate({
            x: action.payload.x,
            y: action.payload.y,
            moveCtr: moveCtr,
            round: round,
            attackSig: onChainAttackSig,
            hashState: hashedWithAddress,
            channelSig: channelSig
        })
    );

    // TODO: we also need to send an attack that is valid on chain - for later use in fraud proofs
    TimeLogger.theLogger.log(player.address)(`Send attack ${action.payload.x},${action.payload.y}`)
    yield call(
        counterparty.sendAttack,
        Action.attackBroadcast(
            action.payload.x,
            action.payload.y,
            counterpartyAttackSig,
            onChainAttackSig,
            hashedWithAddress,
            channelSig
        )
    );
}

export function* attackBroadcast(action: ReturnType<typeof Action.attackBroadcast>) {
    // received an attack broadcast from counterparty, apply it to the player's off chain contract and verify the state before sending back a sig
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    TimeLogger.theLogger.log(player.address)(`Receive attack ${action.payload.x},${action.payload.y}`)
    const offChainBattleshipContract: Contract = yield select(Selector.offChainBattleshipContract);
    const onChainBattleshipContract: Contract = yield select(Selector.onChainBattleshipContract);
    const moveCtr = yield call(offChainBattleshipContract.methods.move_ctr().call);
    const round = yield call(offChainBattleshipContract.methods.round().call);
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    //TODO: current round
    const currentRound = moveCtr;

    //verify the onchain attack sig
    const attackHash = hashAttack(
        action.payload.x,
        action.payload.y,
        //TODO: try just +1
        moveCtr,
        round,
        onChainBattleshipContract.options.address
    );
    const attackSigner = recover(attackHash, action.payload.onChainAttackSig);
    if (attackSigner !== counterparty.address) {
        throw new Error(`Attack hash state signed by: ${attackSigner}, not by counteryparty: ${counterparty.address}`);
    }

    // apply the attack
    const attack = offChainBattleshipContract.methods.attack(
        action.payload.x,
        action.payload.y,
        action.payload.counterpartyAttackSig
    );
    yield call(attack.send, { from: player.address, gas: 300000 });

    // get the state
    const state = yield call(offChainBattleshipContract.methods.getState(dummyRandom).call);
    // hash it with the address of the on chain contract

    const hashedWithOnChainAddress = hashWithAddress(state._h, onChainBattleshipContract.options.address);
    // compare it to the other state
    // TODO: this can happen beacuse the getstate contains challenge time - this hard to keep in sync
    if (hashedWithOnChainAddress !== action.payload.hashState) {
        throw new Error(
            `Calculated hash: ${hashedWithOnChainAddress} does not equal supplied hash: ${action.payload.hashState}`
        );
    }

    // verify the channel sig
    const onChainStateChannel = yield call(onChainBattleshipContract.methods.stateChannel().call);
    const channelHash = hashForSetState(hashedWithOnChainAddress, moveCtr, onChainStateChannel);

    const channelHashSigner = recover(channelHash, action.payload.channelSig!);
    if (channelHashSigner !== counterparty.address) {
        throw new Error(
            `Channel hash state signed by: ${channelHashSigner}, not by counteryparty: ${counterparty.address}`
        );
    }

    // successful move, sign the state, pass it back to the counterparty, then store the move
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);
    const channelSig = yield call(web3.eth.sign, channelHash, player.address);
    yield put(
        Action.attackCreate({
            x: action.payload.x,
            y: action.payload.y,
            moveCtr: moveCtr,
            round: round,
            hashState: action.payload.hashState,
            attackSig: action.payload.onChainAttackSig,
            channelSig: channelSig,
            counterPartyChannelSig: action.payload.channelSig
        })
    );

    // acknowledge braoadcast
    TimeLogger.theLogger.log(player.address)(`Send acknowledge attack ${action.payload.x},${action.payload.y}`)
    yield call(counterparty.sendAction, Action.acknowledgeAttackBroadcast(channelSig));

    // now await the reveal
    yield put(Action.updateCurrentActionType(ActionType.REVEAL_INPUT_AWAIT));
}

function* acknowledgeAttackBroadcast(action: ReturnType<typeof Action.acknowledgeAttackBroadcast>) {

    const latestMove: ReturnType<typeof Selector.latestMove> = yield select(Selector.latestMove);
    const player : ReturnType<typeof Selector.player> = yield select(Selector.player);
    TimeLogger.theLogger.log(player.address)(`Receive acknowledge attack`)
    // verify that the counterparty did actually sign this move
    const onChainBattleshipContract: Contract = yield select(Selector.onChainBattleshipContract);
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const channelAddress = yield call(onChainBattleshipContract.methods.stateChannel().call);
    //TODO: current round
    const currentRound = latestMove.moveCtr;

    const channelHash = hashForSetState(latestMove.hashState, currentRound, channelAddress);
    const signer = recover(channelHash, action.payload.channelSig);
    if (signer !== counterparty.address) {
        throw new Error(`Channel hash state signed by: ${signer}, not by counteryparty: ${counterparty.address}`);
    }

    // TODO: dont modify state directly like this, create an action for it
    latestMove.counterPartyChannelSig = action.payload.channelSig;

    // receive an attack acknowledgement, we now wait for the reveal
}

export function* revealInput(action: ReturnType<typeof Action.revealInput>) {
    // user reveals a value
    const offChainBattleshipContract: Contract = yield select(Selector.offChainBattleshipContract);
    const onChainBattleshipContract: Contract = yield select(Selector.onChainBattleshipContract);
    const latestMove: ReturnType<typeof Selector.latestMove> = yield select(Selector.latestMove);
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    TimeLogger.theLogger.log(player.address)(`Reveal ${action.payload.reveal} at ${latestMove.x},${latestMove.y}`);
    const channelAddress = yield call(onChainBattleshipContract.methods.stateChannel().call);
    
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const moveCtr = yield call(offChainBattleshipContract.methods.move_ctr().call);
    const round = yield call(offChainBattleshipContract.methods.round().call);
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);
    //TODO: current round
    const currentRound = moveCtr;

    if (action.payload.reveal === Reveal.Hit || action.payload.reveal === Reveal.Miss) {
        const hit = action.payload.reveal === Reveal.Hit;
        const offChainRevealSig: string = yield call(
            hashAndSignReveal,
            latestMove.x,
            latestMove.y,
            moveCtr,
            round,
            player.address,
            hit,
            offChainBattleshipContract.options.address,
            web3
        );
        yield call(offChainBattleshipContract.methods.revealslot(hit, offChainRevealSig).send, {
            from: player.address,
            gas: 300000
        });

        // 1. Call ourselves
        // 2. Create a call for the opponent
        // 3. Create a call for the on chain contract
        // 4. Get the state, hash it with the on chain address
        // 5. Hash that with the channel details, and sign it

        // create the call again but for the opponents contract
        const counterpartyOffChainRevealSig: string = yield call(
            hashAndSignReveal,
            latestMove.x,
            latestMove.y,
            moveCtr,
            round,
            player.address,
            hit,
            counterparty.offChainBattleshipAddress,
            web3
        );
        const onChainRevealSig: string = yield call(
            hashAndSignReveal,
            latestMove.x,
            latestMove.y,
            moveCtr,
            round,
            player.address,
            hit,
            onChainBattleshipContract.options.address,
            web3
        );
        // current state, hashed with on chain address, hashed with channel details, signed
        const { _h } = yield call(offChainBattleshipContract.methods.getState(dummyRandom).call);
        const hashedWithAddress = hashWithAddress(_h, onChainBattleshipContract.options.address);
        const hashedForSetState = hashForSetState(hashedWithAddress, currentRound, channelAddress);
        const channelSig = yield call(web3.eth.sign, hashedForSetState, player.address);

        //TODO: update the latest move:  should be less - and add a state channel round update
        yield put(
            Action.attackCreate({
                // TODO: hack - should be this or reveal sig - depending on the move
                attackSig: "",
                channelSig: channelSig,
                hashState: hashedWithAddress,
                moveCtr: moveCtr,
                round: round,
                x: latestMove.x,
                y: latestMove.y
            })
        );

        TimeLogger.theLogger.log(player.address)(`Send reveal ${action.payload.reveal} at ${latestMove.x},${latestMove.y}`);
        yield call(
            counterparty.sendAction,    
            Action.revealBroadcastOffChain({
                data: { reveal: action.payload.reveal, x: latestMove.x, y: latestMove.y },
                counterpartyDataSig: counterpartyOffChainRevealSig,
                onChainDataSig: onChainRevealSig,
                onChainStateHash: hashedWithAddress,
                onChainStateHashSig: channelSig
            })
        );
    }
}

export function* revealBroadcast(action: ReturnType<typeof Action.revealBroadcastOffChain>) {
    const dataHasher = ({ x, y, reveal, moveCtr, round, contractAddress }) =>
        hashReveal(x, y, moveCtr, round, reveal === Reveal.Hit, contractAddress);
    const makeMove = ({ reveal, moveSig }) => {
        return offChainBattleshipContract.methods.revealslot(reveal === Reveal.Hit, moveSig);
    };

    // received an attack broadcast from counterparty, apply it to the player's off chain contract and verify the state before sending back a sig
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    TimeLogger.theLogger.log(player.address)(`Receive reveal ${action.payload.data.reveal} at ${action.payload.data.x},${action.payload.data.y}`);
    const offChainBattleshipContract: Contract = yield select(Selector.offChainBattleshipContract);
    const onChainBattleshipContract: Contract = yield select(Selector.onChainBattleshipContract);
    const onChainStateChannel = yield call(onChainBattleshipContract.methods.stateChannel().call);
    const moveCtr = yield call(offChainBattleshipContract.methods.move_ctr().call);
    const round = yield call(offChainBattleshipContract.methods.round().call);
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);
    //TODO: current round
    const currentRound = moveCtr;

    //verify the onchain move data sig
    const dataHash = dataHasher({
        ...action.payload.data,
        moveCtr,
        round,
        contractAddress: onChainBattleshipContract.options.address
    });
    const dataSigner = recover(dataHash, action.payload.onChainDataSig);
    if (dataSigner !== counterparty.address) {
        throw new Error(`Data hash state signed by: ${dataSigner}, not by counteryparty: ${counterparty.address}`);
    }

    // apply the move
    const move = makeMove({ reveal: action.payload.data.reveal, moveSig: action.payload.counterpartyDataSig });
    yield call(move.send, { from: player.address, gas: 300000 });

    // get the state
    const state = yield call(offChainBattleshipContract.methods.getState(dummyRandom).call);
    // hash it with the address of the on chain contract
    const hashedWithOnChainAddress = hashWithAddress(state._h, onChainBattleshipContract.options.address);
    // compare it to the other state
    // TODO: this can happen beacuse the getstate contains challenge time - this hard to keep in sync
    if (hashedWithOnChainAddress !== action.payload.onChainStateHash) {
        throw new Error(
            `Calculated hash: ${hashedWithOnChainAddress} does not equal supplied hash: ${
                action.payload.onChainStateHash
            }`
        );
    }

    // verify the channel sig
    const channelHash = hashForSetState(hashedWithOnChainAddress, currentRound, onChainStateChannel);
    const channelHashSigner = recover(channelHash, action.payload.onChainStateHashSig);
    if (channelHashSigner !== counterparty.address) {
        throw new Error(
            `Channel hash state signed by: ${channelHashSigner}, not by counteryparty: ${counterparty.address}`
        );
    }

    // create a signature over this state as well
    const channelSig: string = yield call(web3.eth.sign, channelHash, player.address);

    yield put(
        Action.attackCreate({
            // TODO: hack - should be this or reveal sig - depending on the move
            attackSig: "",
            counterPartyChannelSig: action.payload.onChainStateHashSig,
            channelSig: channelSig,
            hashState: hashedWithOnChainAddress,
            moveCtr: moveCtr,
            round: round,
            x: action.payload.data.x,
            y: action.payload.data.y
        })
    );

    TimeLogger.theLogger.log(player.address)(`Send acknowledge reveal ${action.payload.data.reveal} at ${action.payload.data.x},${action.payload.data.y}`);
    yield call(counterparty.sendAction, Action.acknowledgeRevealBroadcast(channelSig));
}

function* acknowledgeRevealBroadcast(action: ReturnType<typeof Action.acknowledgeRevealBroadcast>) {

    const latestMove: ReturnType<typeof Selector.latestMove> = yield select(Selector.latestMove);
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    TimeLogger.theLogger.log(player.address)(`Send acknowledge reveal ${latestMove.reveal} at ${latestMove.x},${latestMove.y}`);
    //TODO: current round
    const currentRound = latestMove.moveCtr;

    // verify that the counterparty did actually sign this move
    const onChainBattleshipContract: Contract = yield select(Selector.onChainBattleshipContract);
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const channelAddress = yield call(onChainBattleshipContract.methods.stateChannel().call);

    const channelHash = hashForSetState(latestMove.hashState, currentRound, channelAddress);
    const signer = recover(channelHash, action.payload.channelSig);
    if (signer !== counterparty.address) {
        throw new Error(`Channel hash state signed by: ${signer}, not by counteryparty: ${counterparty.address}`);
    }

    // TODO: dont modify state directly like this, create an action for it
    // TODO: do something
    latestMove.counterPartyChannelSig = action.payload.channelSig;

    // receive an reveal acknowledgement, we now wait for the attack input
    yield put(Action.updateCurrentActionType(ActionType.ATTACK_INPUT_AWAIT));
}

function recover(message: string, signature: string) {
    // buffer and prefix the message
    const prefixedMessage = hashWithPrefix(message);
    const messageBuffer = Buffer.from(prefixedMessage.split("x")[1], "hex");
    // break the sig
    const splitSignature = signature.split("x")[1];
    const r = Buffer.from(splitSignature.substring(0, 64), "hex");
    const s = Buffer.from(splitSignature.substring(64, 128), "hex");
    const v = parseInt(splitSignature.substring(128, 130)) + 27;
    // we use ethereumjs because web3.eth.personal.ecrecover doesnt work with ganache
    const pub = ethereumjs.ecrecover(messageBuffer, v, r, s);
    const recoveredAddress = "0x" + (ethereumjs.pubToAddress(pub) as any).toString("hex");
    return recoveredAddress;
}

function hashWithPrefix(hash: string) {
    return Web3Util.soliditySha3(
        {
            t: "string",
            v: "\u0019Ethereum Signed Message:\n32"
        },
        {
            t: "bytes32",
            v: hash
        }
    );
}

function hashForSetState(hash: string, round: number, channelAddress: string) {
    return Web3Util.soliditySha3(
        {
            t: "bytes32",
            v: hash
        },
        {
            t: "uint",
            v: round
        },
        {
            t: "address",
            v: channelAddress
        }
    );
}
