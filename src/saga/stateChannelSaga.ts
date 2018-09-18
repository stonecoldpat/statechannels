import { call, takeEvery, select, put } from "redux-saga/effects";
import { Action, ActionType } from "../action/rootAction";
import { Contract } from "web3-eth-contract";
import Web3 = require("web3");
const BattleShipWithoutBoardInChannel = require("./../../build/contracts/BattleShipWithoutBoardInChannel.json");
const StateChannelFactory = require("./../../build/contracts/StateChannelFactory.json");
import { BigNumber } from "bignumber.js";
import Web3Util from "web3-utils";
import { Selector, Reveal } from "../store";
import { placeBet } from "./setupSaga";
import { actionChannel } from "redux-saga-test-plan/matchers";

export default function* stateChannel() {
    yield takeEvery(ActionType.LOCK, lock);
    yield takeEvery(ActionType.REQUEST_LOCK_SIG, requestLockSig);
    yield takeEvery(ActionType.LOCK_SIG, lockSig);
    yield takeEvery(ActionType.DEPLOY_OFF_CHAIN, deployOffChain);
    yield takeEvery(ActionType.REQUEST_STATE_SIG, requestStateSig);
    yield takeEvery(ActionType.STATE_SIG, stateSig);
}

// start the locking process
export function* lock(action: ReturnType<typeof Action.lock>) {
    // TODO: this function should be removed, it doesnt serve much use
    // get the battleship contract
    const battleshipContract: Contract = yield select(Selector.getBattleshipContractByAddress(action.payload.address));

    const channelCounter = yield call(battleshipContract.methods.channelCounter().call);
    const round = yield call(battleshipContract.methods.round().call);

    // pass this to the counterparty for countersignature

    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    yield call(counterparty.sendRequestLockSig, Action.requestLockSig(action.payload.address, channelCounter, round));
}

function* requestLockSig(action: ReturnType<typeof Action.requestLockSig>) {
    // received a sig on a lock
    // should a) verify - not for now, only saves gas costs
    // b) create a hash ourselves and sign
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);

    // get the battleship contract
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);
    const sig: string = yield call(
        getLockMessageAndSign,
        web3,
        action.payload.address,
        player.address,
        action.payload.channelCounter,
        action.payload.round
    );

    // send the sig back
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    yield call(counterparty.sendLockSig, Action.lockSig(action.payload.address, sig));
}

function* lockSig(action: ReturnType<typeof Action.lockSig>) {
    // we've received a sig for the requested lock, so go ahead and complete the lock
    // get the relevant contract
    const battleshipContract: Contract = yield select(Selector.getBattleshipContractByAddress(action.payload.address));
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const channelCounter = yield call(battleshipContract.methods.channelCounter().call);
    const round = yield call(battleshipContract.methods.round().call);
    const sig: string = yield call(
        getLockMessageAndSign,
        web3,
        action.payload.address,
        player.address,
        channelCounter,
        round
    );

    // lock the contract
    // now that we have both sigs call lock on the contract
    yield call(battleshipContract.methods.lock([sig, action.payload.sig]).send, {
        from: player.address,
        gas: 13000000
    });

    // we've locked the contract, what do we want to do now?
    let onChainBattleshipContract: Contract = yield select(Selector.onChainBattleshipContract);

    if (onChainBattleshipContract && onChainBattleshipContract.options.address === action.payload.address) {
        // if we just locked the on chain contract, then we want to deploy an off chain contract and signal to the counterparty to deploy off chain
        const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
        yield call(counterparty.sendDeployOffChain, Action.deployOffChain());
        // deploy ourselves
        yield call(deployOffChain);
    } else {
        // if we just locked an off chain contract, then we want to instantly unlock it with new state
        const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);

        yield call(counterparty.sendRequestStateSig, Action.requestStateSig());
    }
}

// request state sig

const getStateRandom = 137;

// TODO: this hard coded to the address of the opponents bship contract
function* requestStateSig(action: ReturnType<typeof Action.requestStateSig>) {
    // a sig has been requested for current state, hashed with the address of the counterparty address

    // get the on chain contract
    const onChainBattleshipContract: Contract = yield select(Selector.onChainBattleshipContract);
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const stateHash = yield call(onChainBattleshipContract.methods.getState(getStateRandom).call, {
        from: player.address
    });
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const hashedWithAddress = Web3Util.soliditySha3({ t: "bytes32", v: stateHash._h }, { t: "address", v: counterparty.offChainBattleshipAddress });
    const web3 : ReturnType<typeof Selector.web3> = yield select(Selector.web3);
    
    // now sign it with the player address and send it back
    const sig: string = yield call(web3.eth.sign, hashedWithAddress, player.address);
    
    yield call(counterparty.sendStateSig, Action.stateSig(sig));
}

function* stateSig(action: ReturnType<typeof Action.stateSig>) {
    // received a state sig, get the hash and sign it ourselves, ask for a resolution
 

 
}

function* getLockMessageAndSign(
    web3: Web3,
    battleshipContractAddress: string,
    playerAddress: string,
    channelCounter: number,
    round: number
) {
    let msg = Web3Util.soliditySha3(
        { t: "string", v: "lock" },
        { t: "uint256", v: channelCounter },
        { t: "uint256", v: round },
        { t: "address", v: battleshipContractAddress }
    );
    const sig: string = yield call(web3.eth.sign, msg, playerAddress);
    return sig;
}

// deploy an offchain contract,
// lock it up
// resolve a shared state in the statechannel
// then unlock it

function* deployOffChain() {
    // TODO: this should require a different web3, but one will do for now

    // get web3 from the store
    const web3: ReturnType<typeof Selector.web3> = yield select(Selector.web3);
    const player: ReturnType<typeof Selector.player> = yield select(Selector.player);
    const counterparty: ReturnType<typeof Selector.counterparty> = yield select(Selector.counterparty);
    const onChainBattleshipContract: ReturnType<typeof Selector.onChainBattleshipContract> = yield select(
        Selector.onChainBattleshipContract
    );

    // we need to deploy a state channel factory for use by the application
    const stateChannelFactory = new web3.eth.Contract(StateChannelFactory.abi);
    const deployedStateChannelFactory = yield call(
        stateChannelFactory.deploy({
            data: StateChannelFactory.bytecode,
            arguments: []
        }).send,
        { from: player.address, gas: 10000000 }
    );

    // we need the abi
    const contract = new web3.eth.Contract(BattleShipWithoutBoardInChannel.abi);
    const deployedContract: ReturnType<typeof Selector.offChainBattleshipContract> = yield call(
        contract.deploy({
            data: BattleShipWithoutBoardInChannel.bytecode,
            arguments: [
                player.address,
                counterparty.address,
                // TODO: this should be timer_challenge + timer_dispute + time_toPlayInchannel
                10,
                deployedStateChannelFactory.options.address,
                onChainBattleshipContract.options.address
            ]
        }).send,
        { from: player.address, gas: 14000000 }
    );

    yield put(Action.storeOffChainBattleshipContract(deployedContract));

    // inform the other party of the off chain contract addess
    
    yield call(
        counterparty.sendOffChainBattleshipAddress,
        Action.offChainBattleshipAddress(deployedContract.options.address)
    );

    // lock up the off chain contract
    yield call(lock, Action.lock(deployedContract.options.address));
}

function* getStateChannelContract(battleshipContract: Contract) {
    let stateChannelContract = yield call(battleshipContract.methods.stateChannel().call);
    console.log(stateChannelContract);
}
