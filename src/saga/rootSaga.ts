import { all, fork } from "redux-saga/effects";
import attackReveal from "./attackRevealSaga";
import setup from "./setupSaga";
import stateChannel from "./stateChannelSaga";
import offChain from "./offChainSaga";
import onOffTriage from "./onOffTriageSaga";

export default function* root() {
    yield all([fork(attackReveal), fork(setup), fork(stateChannel), fork(offChain), fork(onOffTriage)]);
}
