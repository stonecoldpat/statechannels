import { call, takeEvery, select, put } from "redux-saga/effects";
import { Action, ActionType } from "../action/rootAction";
import { Contract } from "web3-eth-contract";
import Web3 = require("web3");
import { BigNumber } from "bignumber.js";
import Web3Util from "web3-utils";
import { Selector, Reveal } from "../store";
import { checkCurrentActionType } from "./checkCurrentActionType";

// export function* attackReceiveInputChannel(action: ReturnType<typeof Action.attackInput>) {
//     // check that the local store is awaiting this action
//     yield call(checkCurrentActionType, ActionType.ATTACK_INPUT_AWAIT);

//     // TODO: transition current action type to 'attacking' or something?
//     const battleshipContract: ReturnType<typeof Selector.battleshipContract> = yield select(
//         Selector.battleshipContract
//     );
//     const player: ReturnType<typeof Selector.player> = yield select(Selector.player);

//     // sign the x,y,move_ctr,round,address hash

//     const moveCtr: BigNumber = yield call(battleshipContract.methods.move_ctr().call);

//     const round: BigNumber = yield call(battleshipContract.methods.round().call);

//     const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);

//     const sig: string = yield call(
//         hashAndSignAttack,
//         action.payload.x,
//         action.payload.y,
//         moveCtr,
//         round,
//         player.address,
//         battleshipContract.options.address,
//         web3
//     );

//     const { hashState, hashStateSig } = yield call(
//         attackApplyAndGetHashState,
//         battleshipContract,
//         action.payload.x,
//         action.payload.y,
//         sig,
//         player.address,
//         web3
//     );

//     // // create a hash for the opponents address
//     const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
//     if (!counterparty.contractAddress) throw new Error("counterparty contract address not populated");
//     const sigOnCounterPartyHash: string = yield call(
//         hashAndSignAttack,
//         action.payload.y,
//         action.payload.y,
//         moveCtr,
//         round,
//         player.address,
//         counterparty.contractAddress,
//         web3
//     );

//     // update the counterparty
//     const attackAccept = Action.attackBroadcast(
//         action.payload.x,
//         action.payload.y,

//         // TODO: add these back in
//         // moveCtr.toNumber(),
//         // sigOnCounterPartyHash,
//         hashState,
//         hashStateSig
//     );
//     yield call(counterparty.sendAttack, attackAccept);

//     // attack input complete, await accept update
//     // TODO: reducer for this
//     yield put(
//         Action.attackCreate({
//             // TODO: add this ack in
//             // id: moveCtr.toNumber(),
//             x: action.payload.x,
//             y: action.payload.y,
//             // phase: Phase.ATTACK,
//             hashState,
//             hashStateSig: hashStateSig
//         })
//     );
//     // TODO: reducer for this
//     yield put(Action.updateCurrentActionType(ActionType.ATTACK_ACCEPT_AWAIT));

//     // TODO: all "call" can throw errors
// }


// TODO: dont rely on latest move in an async system! seems insecure. USe a move id

// TODO: check that everywhere that we have moveCtr, we should also have round

// TODO: do we need to ensure that these operations are atomic?
// TODO: untested, unused currently
function* attackReceiveBroadcastChannel(action: ReturnType<typeof Action.attackBroadcast>) {
    yield call(checkCurrentActionType, ActionType.ATTACK_BROADCAST_AWAIT);

    // needs to be round and counter!

    const battleshipContract: ReturnType<typeof Selector.onChainBattleshipContract> = yield select(
        Selector.onChainBattleshipContract
    );
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    // sign the x,y,move_ctr,round,address hash
    const moveCtr: BigNumber = yield call(battleshipContract.methods.move_ctr().call);
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);

    //TODO: we shouldnt sign if we dont hashState !==
    const { hashState, hashStateSig } = yield call(
        attackApplyAndGetHashState,
        battleshipContract,
        action.payload.x,
        action.payload.y,
        "fake sig",
        // action.payload.sig,
        player.address,
        web3
    );
    if (hashState !== action.payload.hashState) {
        // TODO: throw - communitcate? - unexpected state
    }
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const recoveredAddress = yield call(web3.eth.accounts.recover, hashState, action.payload.hashStateSig);
    if (counterparty.address !== recoveredAddress) {
        // TODO: throw - unexpected recovered address
    }

    // update the local record
    // TODO: should this been append? and update sig only? seems tighter but less flexible
    yield put(
        Action.attackCreate({
            // TODO:
            // id: moveCtr.toNumber(),
            x: action.payload.x,
            y: action.payload.y,
            // TODO:
            // phase: Phase.ATTACK,
            hashState,
            hashStateSig: hashStateSig,
            hashStateCounterPartySig: action.payload.hashStateSig
        })
    );

    // send our sig to counterparty
    // TODO: do we need to wait for acknowledgement? yes if we want to avoid getting out of sync with one another
    // TODO: but not for now
    yield call(counterparty.sendSig, Action.attackAccept(hashStateSig));

    // move to the new state - reveal
    yield put(Action.updateCurrentActionType(ActionType.REVEAL_INPUT));
}


function* attackApplyAndGetHashState(
    contract: Contract,
    x: number,
    y: number,
    sig: string,
    player: string,
    web3: Web3
) {
    const attack = contract.methods.attack(x, y, sig);
    // TODO: this has TransactionReceipt type
    // TODO: this could throw exception
    yield call(attack.send, { from: player, gas: 300000 });
    // get the state hash
    // TODO: this should be properly random
    const dummyRandom = 1;
    // TODO: this should have a 'hash' type
    const { _h } = yield call(contract.methods.getState(dummyRandom).call);
    // sign this hash
    const hashStateSig: string = yield call(web3.eth.sign, _h, player);
    return { hashState: _h, hashStateSig };
}


// TODO: type or interface?

// use redux/saga system for this, should be good for testing
// eg. A 1.) ATTACK instructions received
//       2.) if in state AWAIT_ATTACK_INPUT
//       2.) translate to ATTACK transaction
//       3.) apply transaction
//       4.) verify result, gethashstate
//       5.) sign state hash, broadcast transaction + signed hash
//       6.) transition to AWAIT_ATTACK_SIG
//       7.) upon receiving sig, verify
//       6.) transition to AWAIT_REVEAL

// B 1) receives ATTACK transaction
//   2) if currently in state AWAIT_ATTACK_TRANSACTION
//   3) apply transaction, call gethashcode and verify the result
//   4) sign state and broadcast the sig
//   4) transition to AWAIT_REVEAL_INPUT

//

// order

// matchmake

// choose leader

// run setup - how
// i) leader deploys contract
// ii) leader deposits
// iii) counterparty should notice that deposit has occured - after all they're monitoring the bchain?
//      a) How does this happen. CP knows to wait for a received message, how? they move through a generator
//      b) Message could come from other party, or it could come from own monitoring
// iv) upon noticing that deposit has occured then they should make their own deposit

// saga:

// take every move
// put it through blockchain, if no error then requst signature of result and send result to opponent
// ALWAYS, at any time
// upon receiving a signed move + transaction, ALWAYS apply and verify

// how to choose whether to make a move or not?
// game engine, receives verified moves, applies them to local state?
// state is then reduced and action is replayed on the screen
