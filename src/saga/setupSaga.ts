import { takeEvery, select, call, put, fork, spawn } from "redux-saga/effects";
import { Selector } from "./../store";
import { ActionType, Action } from "./../action/rootAction";
const BattleShipWithoutBoard = require("./../../build/contracts/BattleShipWithoutBoard.json");
import { checkCurrentActionType } from "./checkCurrentActionType";
const Web3Util = require("web3-utils");
import { committedShips } from "./../utils/shipTools";

const depositAmount = Web3Util.toWei("0.1", "ether");
const betAmount = Web3Util.toWei("0.05", "ether");

export default function* setup() {
    yield takeEvery(ActionType.SETUP_DEPLOY, deployBattleship);
    yield takeEvery(ActionType.ADD_BATTLESHIP_ADDRESS, addBattleshipAddress);
    yield takeEvery(ActionType.SETUP_STORE_SHIPS, storeShips);
    yield takeEvery(ActionType.SETUP_OPPONENT_READY_TO_PLAY, opponentReadyToPlay);
}

// deploy a game
export function* deployBattleship(action: ReturnType<typeof Action.setupDeploy>) {
    // TODO: we should also set the goesFirst in here and in addBattleshipAddress - or it should be taken account of

    yield call(checkCurrentActionType, ActionType.SETUP_DEPLOY_AWAIT);
    // get web3 from the store
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);

    // we need the abi
    const contract = new web3.eth.Contract(BattleShipWithoutBoard.abi);
    const deployedContract: ReturnType<typeof Selector.battleshipContract> = yield call(
        contract.deploy({
            data: BattleShipWithoutBoard.bytecode,
            arguments: [player.address, counterparty.address, action.payload.timerChallenge]
        }).send,
        { from: player.address, gas: 13000000 }
    );

    // store the deployed contract, and pass the information to the counterparty
    yield put(Action.storeBattleshipContract(deployedContract));
    // TODO: should be a fork
    yield call(counterparty.sendContract, Action.setupAddBattleshipAddress(deployedContract.options.address));

    // complete the rest of the setup
    yield call(completeSetup);
}

export function* addBattleshipAddress(action: ReturnType<typeof Action.setupAddBattleshipAddress>) {
    yield call(checkCurrentActionType, ActionType.SETUP_DEPLOY_AWAIT);
    // create a battleship contract from the given address and store it
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);

    // TODO: check the existance of the contract at this address?
    const contract = new web3.eth.Contract(BattleShipWithoutBoard.abi, action.payload.battleshipContractAddress);
    yield put(Action.storeBattleshipContract(contract));

    // move on to the deposit phase
    yield call(completeSetup);
}

export function* completeSetup() {
    // TODO: phase check

    // deposit
    yield call(deposit, Action.setupDeposit(depositAmount));
    // place bet
    yield call(placeBet, Action.setupPlaceBet(betAmount));
    // now wait for ship input
    yield put(Action.updateCurrentActionType(ActionType.SETUP_STORE_SHIPS_AWAIT));
}

export function* deposit(action: ReturnType<typeof Action.setupDeposit>) {
    // TODO: check that all phases are being correctly set and checked
    // TODO: phase check

    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const battleshipContract: ReturnType<typeof Selector.battleshipContract> = yield select(
        Selector.battleshipContract
    );

    yield call(battleshipContract.methods.deposit().send, { from: player.address, value: action.payload.amount });
}

export function* placeBet(action: ReturnType<typeof Action.setupPlaceBet>) {
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const battleshipContract: ReturnType<typeof Selector.battleshipContract> = yield select(
        Selector.battleshipContract
    );

    yield call(battleshipContract.methods.placeBet(action.payload.amount).send, { from: player.address });
}

export function* storeShips(action: ReturnType<typeof Action.setupStoreShips>) {
    // TODO: check game phase

    const battleshipContract: ReturnType<typeof Selector.battleshipContract> = yield select(
        Selector.battleshipContract
    );
    const shipSizes: ReturnType<typeof Selector.shipSizes> = yield select(Selector.shipSizes);
    const round: ReturnType<typeof Selector.round> = yield select(Selector.round);
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);

    //create a commitment and update attack
    const ships = committedShips(
        battleshipContract.options.address,
        shipSizes,
        action.payload.ships.map(s => s.commitment),
        round,
        counterparty.address
    );
    // TODO: ths section should be the other way round - i sign my own boards then pass them to the counterparty for submission
    // sign the commitment
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);
    //  console.log(ships.commitment);
    const commitmentSig = yield call(web3.eth.sign, ships.commitment, counterparty.address);

    yield call(
        battleshipContract.methods.storeShips(shipSizes, action.payload.ships.map(s => s.commitment), commitmentSig)
            .send,
        { from: player.address, gas: 2000000 }
    );

    // signal that the player is ready
    yield call(readyToPlay)
}

// TODO: no error handling in any of the sagas
// TODO: no handling of failure midway through

export function* readyToPlay() {
    const battleshipContract: ReturnType<typeof Selector.battleshipContract> = yield select(
        Selector.battleshipContract
    );
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    yield call(battleshipContract.methods.readyToPlay().send, { from: player.address });
    // success, record that we were able to
    yield put(Action.setupReadyToPlay(true));

    // signal to the counterparty that we are ready to play
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    yield call(counterparty.sendReadyToPlay);

    // also check to see if the counteryparty is already ready to play, if so then we're ready to start
    if (counterparty.isReadyToPlay) {
        yield call(bothPlayersReady, player.goesFirst);
    }
    // else, do nothing, when the counterparty is ready we'll try to set state again
}

export function* opponentReadyToPlay() {
    // the opponent has signalled that they're ready to play

    // the store has already been updated
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player)
    // are we ready to play as well?
    if (player.isReadyToPlay) {
        yield call(bothPlayersReady, player.goesFirst);
    }
}

export function* bothPlayersReady(playerGoesFirst: boolean) {
    if (playerGoesFirst) {
        // transition to await attack
        yield put(Action.updateCurrentActionType(ActionType.ATTACK_INPUT_AWAIT));
    } else {
        // transition to await attack accept
        yield put(Action.updateCurrentActionType(ActionType.ATTACK_BROADCAST_AWAIT));
    }
}
