import { createStore, applyMiddleware, compose } from "redux";
import createSagaMiddleware from "redux-saga";
import rootSaga from "./saga/rootSaga";
import reducer from "./reducer/rootReducer";
import { Contract } from "web3-eth-contract";
import { Action, ActionType } from "./action/rootAction";
import { IShip }  from "./entities/gameEntities"
import Web3 = require("web3");

export function generateStore(initialStore: IStore) {
    // Redux DevTools
    //    const composeEnhancers = (window && (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) || compose;
    const composeEnhancers = compose;

    // create the saga middleware
    const sagaMiddleware = createSagaMiddleware();
    const store = createStore<IStore, Action, {}, {}>(reducer, initialStore, composeEnhancers(applyMiddleware(sagaMiddleware)));
    sagaMiddleware.run(rootSaga);

    return store;
}

export class Selector {
    static readonly currentActionType = (store: IStore) => store.currentActionType;
    static readonly onChainBattleshipContract = (store: IStore) => {        
        if (!store.game.onChainBattleshipContract) throw new Error("on chain battleshipContract not populated");
        return store.game.onChainBattleshipContract;
    };
    static readonly offChainBattleshipContract = (store: IStore) => {
        if (!store.game.offChainBattleshipContract) throw new Error("off chain battleshipContract not populated");
        return store.game.offChainBattleshipContract;
    };
    static readonly getBattleshipContractByAddress = (address : string) => (store: IStore) => {
        if(store.game.onChainBattleshipContract && store.game.onChainBattleshipContract.options.address == address) return store.game.onChainBattleshipContract;
        if(store.game.offChainBattleshipContract && store.game.offChainBattleshipContract.options.address == address) return store.game.offChainBattleshipContract;
        throw new Error("no battleship contract found for address " + address);
    }
    static readonly player = (store: IStore) => store.game.player;
    static readonly counterparty = (store: IStore) => store.opponent;
    static readonly web3 = (store: IStore) => store.web3;
    static readonly latestMove = (store: IStore) => store.game.moves[store.game.moves.length - 1];
    static readonly shipSizes = (store: IStore) => store.shipSizes;
    static readonly round = (store: IStore) => store.game.round;
}

// TODO: organise this store - it's currently a mess
// TODO: doesnt the shipsizes give away which ship has been hit, by the index number - raise this with partrick

export interface IStore {
    currentActionType: ActionType;
    web3: Web3;
    opponent: ICounterpartyClient;
    game: IGame,
    shipSizes: number[]
}

export interface IGame {
    onChainBattleshipContract?: Contract;
    offChainBattleshipContract?: Contract;
    player: IPlayer;
    moves: IMove[];
    // TODO: any
    ships?: IShip[]
    round: number
}

export interface IPlayer {
    address: string;
    isReadyToPlay: boolean;
    goesFirst: boolean;
}

export enum Phase {
    SETUP = 0,
    ATTACK = 1,
    REVEAL = 2,
    WIN = 3,
    FRAUD = 4
}

export enum Reveal {
    Miss = 1,
    Hit = 2,
    Sink = 3
}

export interface IMove {
    x: number;
    y: number;
    hashState: string;
    hashStateSig: string;
    hashStateCounterPartySig?: string;
    reveal?: Reveal;
}

export interface ICounterpartyClient extends IPlayer {
    sendAttack(action: ReturnType<typeof Action.attackBroadcast>): void;
    sendReveal(action: ReturnType<typeof Action.revealBroadcast>): void;
    sendSig(action: ReturnType<typeof Action.attackAccept>);
    sendRequestLockSig(action: ReturnType<typeof Action.requestLockSig>) : void;
    sendLockSig(action: ReturnType<typeof Action.lockSig>) : void;
    sendDeployOffChain(action: ReturnType<typeof Action.deployOffChain>): void
    sendOffChainBattleshipAddress(action: ReturnType<typeof Action.offChainBattleshipAddress>): void
    sendOffChainStateChannelAddress(action: ReturnType<typeof Action.offChainStateChannelAddress>): void
    sendRequestStateSig(action: ReturnType<typeof Action.requestStateSig>): void
    sendStateSig(action: ReturnType<typeof Action.stateSig>): void;
    sendContract(action: ReturnType<typeof Action.setupAddBattleshipAddress>);
    sendReadyToPlay();
    offChainBattleshipAddress?: string;
    offChainStateChannelAddress?: string;
}