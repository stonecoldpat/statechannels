import { all, fork } from "redux-saga/effects";
import attackReveal from "./attackRevealSaga";
import setup from "./setupSaga";

export default function* root() {
    yield all([fork(attackReveal), fork(setup)]);
}
