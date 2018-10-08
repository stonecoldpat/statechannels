import { call, takeEvery, select, put } from "redux-saga/effects";
import { Action, ActionType } from "../action/rootAction";
import { Contract } from "web3-eth-contract";

// const BattleShipWithoutBoardInChannel = require("./../../build/contracts/BattleShipWithoutBoardInChannel.json");
// const StateChannelFactory = require("./../../build/contracts/StateChannelFactory.json");
// const StateChannel = require("./../../build/contracts/StateChannel.json");
import Web3Util from "web3-utils";
import ethereumjs from "ethereumjs-util";
import { dummyRandom } from "./sagaGlobals";
import { Selector } from "../store";
import { hashWithAddress } from "./stateChannelSaga";
import { TimeLogger } from "./../utils/TimeLogger";
import { IVerifyStateUpdate, IStateUpdate } from "./../entities/stateUpdates";

export default function* offChain() {
    yield takeEvery(ActionType.BOTH_PLAYERS_READY_OFF_CHAIN, bothPlayersReadyToPlayOffChain);
    //yield takeEvery(ActionType.ACKNOWLEDGE_ATTACK_BROADCAST, acknowledgeAttackBroadcast);
    //yield takeEvery(ActionType.VERIFY_STATE_UPDATE, verifyStateUpdate);
    yield takeEvery(ActionType.ACKNOWLEDGE_STATE_UPDATE, acknowledgeStateUpdate);
    yield takeEvery(ActionType.PROPOSE_STATE_UPDATE, proposeStateUpdate);
}

export function* bothPlayersReadyToPlayOffChain() {
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    if (player.goesFirst) {
        // transition to await attack
        TimeLogger.theLogger.messageLog(player.address)("Await attack input");
        yield put(Action.updateCurrentActionType(ActionType.ATTACK_INPUT_AWAIT));
    } else {
        // TODO: put in awaits later transition to await attack accept
        //yield put(Action.updateCurrentActionType(ActionType.ATTACK_BROADCAST_AWAIT));
    }
}

export function* proposeStateUpdate(action: ReturnType<typeof Action.proposeState>) {
    // user reveals a value
    const offChainBattleshipContract: Contract = yield select(Selector.offChainBattleshipContract);
    const onChainBattleshipContract: Contract = yield select(Selector.onChainBattleshipContract);
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const log = TimeLogger.theLogger.dataLog(
        player.address,
        "propose-start",
        action.payload.name,
        action.payload.serialiseData()
    );
    const channelAddress = yield call(onChainBattleshipContract.methods.stateChannel().call);

    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const moveCtr = yield call(offChainBattleshipContract.methods.move_ctr().call);
    const round = yield call(offChainBattleshipContract.methods.round().call);
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);

    // get hash data
    const hashData = action.payload.hashData(moveCtr, round, offChainBattleshipContract.options.address);
    // sign that data and submit it
    const sig = yield call(web3.eth.sign, hashData, player.address);
    yield call(action.payload.getFunction(offChainBattleshipContract, sig).send, { from: player.address, gas: 300000 });

    // success, create a sig for the opponent
    const counterpartyData = action.payload.hashData(moveCtr, round, counterparty.offChainBattleshipAddress!);
    const counterpartySig = yield call(web3.eth.sign, counterpartyData, player.address);

    // create a sig against the onchain contract, to be used by the counterparty in a fraud proof
    const onChainData = action.payload.hashData(moveCtr, round, onChainBattleshipContract.options.address);
    const onChainSig = yield call(web3.eth.sign, onChainData, player.address);

    // create a state update and sign it
    const { _h } = yield call(offChainBattleshipContract.methods.getState(dummyRandom).call);

    const hashedWithAddress = hashWithAddress(_h, onChainBattleshipContract.options.address);
    // TODO: this state round hasnt been populated!
    const channelHash = hashForSetState(hashedWithAddress, action.payload.stateRound, channelAddress);
    const channelSig = yield call(web3.eth.sign, channelHash, player.address);

    // TODO: this needs to contain both channel sigs
    let storeUpdate = action.payload.storeUpdateAction(channelHash, channelSig, moveCtr, round, onChainSig);
    if (storeUpdate) yield put(storeUpdate);
    TimeLogger.theLogger.dataLog(
        player.address,
        "propose-end",
        action.payload.name,
        action.payload.serialiseData(),
        log.id
    );

    // TODO: remvoe this whole file in favour of the transaction workflow
    const dummyTransaction = ""
    yield call(
        counterparty.sendAction,
        Action.verifyState(action.payload.createVerifyStateUpdate(dummyTransaction, onChainSig, counterpartySig, channelSig))
    );
}

export function* verifyStateUpdate(action: ReturnType<typeof Action.verifyState>) {
    // verify a sig of the data hashed with the onchain address
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const log = TimeLogger.theLogger.dataLog(
        player.address,
        "verify-start",
        action.payload.name,
        action.payload.serialiseData()
    );
    const offChainBattleshipContract: Contract = yield select(Selector.offChainBattleshipContract);
    const onChainBattleshipContract: Contract = yield select(Selector.onChainBattleshipContract);
    const onChainStateChannel = yield call(onChainBattleshipContract.methods.stateChannel().call);
    const moveCtr = yield call(offChainBattleshipContract.methods.move_ctr().call);
    const round = yield call(offChainBattleshipContract.methods.round().call);
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);

    //verify the onchain move data sig
    const dataHash = action.payload.hashData(moveCtr, round, onChainBattleshipContract.options.address);
    const dataSigner = recover(dataHash, action.payload.onChainDataSig);
    if (dataSigner !== counterparty.address) {
        throw new Error(`Data hash state signed by: ${dataSigner}, not by counteryparty: ${counterparty.address}`);
    }

    // apply the move
    const contractFunction = action.payload.getFunction(offChainBattleshipContract, action.payload.offChainDataSig);
    yield call(contractFunction.send, { from: player.address, gas: 300000 });

    // get the state
    const state = yield call(offChainBattleshipContract.methods.getState(dummyRandom).call);

    // hash it with the address of the on chain contract
    const hashedWithOnChainAddress = hashWithAddress(state._h, onChainBattleshipContract.options.address);
    // verify the channel sig
    const channelHash = hashForSetState(hashedWithOnChainAddress, action.payload.stateRound, onChainStateChannel);
    //console.log(channelHash)
    const channelHashSigner = recover(channelHash, action.payload.stateUpdateSig);
    if (channelHashSigner !== counterparty.address) {
        throw new Error(
            `Channel hash state signed by: ${channelHashSigner}, not by counteryparty: ${counterparty.address}`
        );
    }
    // create a signature over this state as well
    const channelSig: string = yield call(web3.eth.sign, channelHash, player.address);

    // TODO: this needs to contain both channel sigs
    let storeUpdate = action.payload.storeUpdateAction(channelHash, channelSig, moveCtr, round, dataHash);
    if (storeUpdate) yield put(storeUpdate);

    TimeLogger.theLogger.dataLog(
        player.address,
        "verify-end",
        action.payload.name,
        action.payload.serialiseData(),
        log.id
    );

    yield call(actionAfterVerify, action.payload);

    yield call(
        counterparty.sendAction,
        Action.acknowledgeStateUpdate(action.payload.createAcknowledgeStateUpdate(channelSig))
    );
}

export function* acknowledgeStateUpdate(action: ReturnType<typeof Action.acknowledgeStateUpdate>) {
    //const latestMove: ReturnType<typeof Selector.latestMove> = yield select(Selector.latestMove);
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const log = TimeLogger.theLogger.dataLog(
        player.address,
        "acknowledge-start",
        action.payload.name,
        action.payload.serialiseData()
    );
    const offChainBattleshipContract: ReturnType<typeof Selector.offChainBattleshipContract> = yield select(
        Selector.offChainBattleshipContract
    );
    const onChainBattleshipContract: ReturnType<typeof Selector.onChainBattleshipContract> = yield select(
        Selector.onChainBattleshipContract
    );
    const channelAddress: string = yield call(onChainBattleshipContract.methods.stateChannel().call);
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const moveCtr = yield call(offChainBattleshipContract.methods.move_ctr().call);
    const round = yield call(offChainBattleshipContract.methods.round().call);
    const state = yield call(offChainBattleshipContract.methods.getState(dummyRandom).call);

    // hash it with the address of the on chain contract
    const hashedWithOnChainAddress = hashWithAddress(state._h, onChainBattleshipContract.options.address);
    // verify the channel sig
    const channelHash = hashForSetState(hashedWithOnChainAddress, action.payload.stateRound, channelAddress);

    // verify that the counterparty did actually sign this move
    const signer = recover(channelHash, action.payload.stateUpdateSig);
    if (signer !== counterparty.address) {
        throw new Error(`Channel hash state signed by: ${signer}, not by counteryparty: ${counterparty.address}`);
    }

    // TODO: these args dont make sense
    const storeAction = action.payload.storeUpdateAction(channelHash, action.payload.stateUpdateSig, moveCtr, round);
    if (storeAction) yield put(storeAction);

    TimeLogger.theLogger.dataLog(
        player.address,
        "acknowledge-end",
        action.payload.name,
        action.payload.serialiseData(),
        log.id
    );
    yield call(actionAfterAcknowledge, action.payload);
}

export function* actionAfterAcknowledge(state: IStateUpdate) {
    if (state.name === "revealslot" || state.name === "revealsunk") {
        // // we've sunk a ship, count how many have been sunk already
        // const totalSinks = yield select(Selector.totalSinks)
        // // TODO: this 9 is a hack, we should be checking our own open revealed ships
        // if(totalSinks === 4) {
        //     // do nothing, we've lost
        // }

        yield put(Action.updateCurrentActionType(ActionType.ATTACK_INPUT_AWAIT));
    }
}

// TODO: move this into the class structure
export function* actionAfterVerify(state: IVerifyStateUpdate) {
    if (state.name === "attack") {
        yield put(Action.updateCurrentActionType(ActionType.REVEAL_INPUT_AWAIT));
    }
    // else if(verifyState.name === "revealsunk") {
    //     // we've sunk a ship, count how many have been sunk already
    //     const totalSinks = yield select(Selector.totalSinks)
    //     // TODO: this 9 is a hack, we should be checking our own open revealed ships
    //     if(totalSinks === 9) {
    //         // a win - move on to the opening the ships
    //         yield put(Action.updateCurrentActionType(ActionType.PROPOSE_OPEN_SHIPS))
    //     }
    // }
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
