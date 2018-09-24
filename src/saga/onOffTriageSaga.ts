import { call, takeEvery, select, put } from "redux-saga/effects";
import { Action, ActionType } from "../action/rootAction";
import { Selector } from "../store";
import { attackInput, attackBroadcast, revealInput, revealBroadcast } from "./attackRevealSaga";
import {
    // attackInput as offChainAttackInput,
    // attackBroadcast as offChainAttackBroadcast,
    // revealInput as offChainRevealInput,
    // revealBroadcast as offChainRevealBroadcast
} from "./offChainSaga";
import { PlayerStage } from "../entities/gameEntities";

export default function* onOffTriage() {
    yield takeEvery(ActionType.ATTACK_INPUT, attackInput);
    yield takeEvery(ActionType.ATTACK_BROADCAST, attackBroadcast);
    yield takeEvery(ActionType.REVEAL_INPUT, revealInput);
    yield takeEvery(ActionType.REVEAL_BROADCAST, revealBroadcast);
}

function createSwitch<T extends (...args: any[]) => any>(onChainSaga, offChainSaga) {
    return function* switcher(action: ReturnType<T>) {
        const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
        if (player.stage === PlayerStage.READY_TO_PLAY) {
            yield call(onChainSaga, action);
        } else if (player.stage === PlayerStage.READY_TO_PLAY_OFFCHAIN) {
            yield call(offChainSaga, action);
        } else throw new Error("Invalid player stage: " + player.stage);
    };
}
