import { combineReducers } from "redux";
import { ActionType, Action } from "./../action/rootAction";
import { IMove, IGame, ICounterpartyClient } from "./../store";
import Web3 = require("web3");
const defaultWeb3 = new Web3("ws://localhost:8545");

// TODO: the "any" in this reducer is bad - start using the typesafe actions, with getType

const currentActionTypeReducer = (
    state: ActionType = ActionType.SETUP_DEPLOY_AWAIT,
    action: ReturnType<typeof Action.updateCurrentActionType>
) => {
    if (action.type === ActionType.UPDATE_CURRENT_ACTION_TYPE) {
        // console.log(action.payload.actionType);
        return action.payload.actionType;
    }
    // TODO: subscribers need to update as the first thing they atm
    // TODO: this because they potentially call dispatch in subscribe()
    else if (
        action.type === ActionType.SETUP_STORE_SHIPS ||
        action.type === ActionType.ATTACK_INPUT ||
        action.type === ActionType.REVEAL_INPUT
    ) {
        return action.type;
    } else return state;
};

const web3Reducer = (state: Web3 = defaultWeb3, action) => {
    return state;
};

// TODO: all these defaults in here are bad, remove as many as possble and populate them later

const opponentReducer = (
    state: ICounterpartyClient = {
        sendAttack: () => {},
        sendContract: () => {},
        sendReveal: () => {},
        sendSig: () => {},
        sendReadyToPlay: () => {},
        address: "0xffcf8fdee72ac11b5c542428b35eef5769c409f0",
        isReadyToPlay: false,
        goesFirst: false
    },
    action
) => {
    if (action.type === ActionType.SETUP_OPPONENT_READY_TO_PLAY) {
        return {
            ...state,
            isReadyToPlay: true
        };
    } else return state;
};

const moves: IMove[] = [];

// TODO: Initialise here instead of in the preloaded state?
const gameReducer = (
    state: IGame = {
        player: { address: "never should show", isReadyToPlay: false, goesFirst: false },
        moves,
        round: 0
    },
    action
) => {
    if (action.type === ActionType.ATTACK_CREATE) {
        return { ...state, moves: [...state.moves, action.payload] };
    } else if (action.type === ActionType.STORE_BATTLESHIP_CONTRACT) {
        return { ...state, battleshipContract: action.payload.battleshipContract };
    } else if (action.type === ActionType.SETUP_STORE_SHIPS) {
        return { ...state, ships: [action.payload.message] };
    } else if (action.type === ActionType.SETUP_READY_TO_PLAY) {
        return { ...state, player: { ...state.player, isReadyToPlay: action.payload.isReadyToPlay } };
    } else return state;
};

const shipSizesReducer = (state: number[] = [5, 4, 3, 3, 2], action) => {
    return state;
};

const reducer = combineReducers({
    currentActionType: currentActionTypeReducer,
    web3: web3Reducer,
    game: gameReducer,
    opponent: opponentReducer,
    shipSizes: shipSizesReducer
});

export default reducer;
