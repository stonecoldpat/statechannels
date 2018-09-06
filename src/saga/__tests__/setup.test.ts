import * as chai from "chai";
import "mocha";
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;
import { expectSaga } from "redux-saga-test-plan";
import rootReducer from "./../../reducer/rootReducer";
import { BoardBuilder } from "../../utils/boardBuilder";

import { deployBattleship } from "./../setupSaga";
import { Action, ActionType } from "./../../action/rootAction";
import { generateStore, IStore, IPlayer, Reveal } from "./../../store";
import { IShip } from "./../../entities/gameEntities";
import Web3 = require("web3");

const shipSizes = [5, 4, 3, 3, 2];

// TODO: why is the state necessary? why not simply
const state1: IStore = {
    currentActionType: ActionType.SETUP_DEPLOY_AWAIT,
    web3: new Web3("ws://localhost:8545"),
    game: {
        player: { address: "0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1", isReadyToPlay: false, goesFirst: true },
        moves: [],
        round: 0
    },
    opponent: {
        address: "0xffcf8fdee72ac11b5c542428b35eef5769c409f0",
        sendAttack: (action: ReturnType<typeof Action.attackBroadcast>) => {
            store2.dispatch(action);
        },
        sendReveal: (action: ReturnType<typeof Action.revealBroadcast>) => {
            store2.dispatch(action);
        },
        sendSig: () => {},
        sendContract: (action: ReturnType<typeof Action.setupAddBattleshipAddress>) => {
            store2.dispatch(action);
        },
        sendReadyToPlay: () => {
            store2.dispatch(Action.setupOpponentReadytoPlay());
        },
        isReadyToPlay: false,
        goesFirst: false
    },
    shipSizes
};

let store1 = generateStore(state1);

const state2: IStore = {
    currentActionType: ActionType.SETUP_DEPLOY_AWAIT,
    web3: new Web3("ws://localhost:8545"),
    game: {
        player: { address: "0xffcf8fdee72ac11b5c542428b35eef5769c409f0", isReadyToPlay: false, goesFirst: false },
        moves: [],
        round: 0
    },
    opponent: {
        address: "0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1",
        sendAttack: (action: ReturnType<typeof Action.attackBroadcast>) => {
            store1.dispatch(action);
        },
        // TODO: rename these to broadcast
        sendReveal: (action: ReturnType<typeof Action.revealBroadcast>) => {
            store1.dispatch(action);
        },
        sendSig: () => {},
        sendContract: (action: ReturnType<typeof Action.setupAddBattleshipAddress>) => {
            store1.dispatch(action);
        },
        sendReadyToPlay: () => {
            store1.dispatch(Action.setupOpponentReadytoPlay());
        },
        isReadyToPlay: false,
        goesFirst: true
    },
    shipSizes
};

let store2 = generateStore(state2);

class TestBot {
    private mUnsubsribe;
    public complete: boolean = false;
    public FINAL_STATE = ActionType.ATTACK_INPUT_AWAIT;
    private readonly player: IPlayer;
    // TODO: we should be reading this dynamically from the contract
    public readonly round = 0;

    constructor(public readonly store) {
        const initialState: IStore = store.getState();
        this.player = initialState.game.player;

        this.FINAL_STATE = initialState.game.player.goesFirst
            ? ActionType.REVEAL_BROADCAST_AWAIT
            : ActionType.ATTACK_ACCEPT_AWAIT;
        let i = 0;

        // TODO: this should be a class not a function
        let gameState;
        let attackIterator;
        // we need to subscribe to the store to watch for certain events
        this.mUnsubsribe = store.subscribe(() => {
            if (this.complete) return;

            const state: IStore = store.getState();
            console.log(state.currentActionType);
            switch (state.currentActionType) {
                case ActionType.SETUP_STORE_SHIPS_AWAIT:
                    const contractAddress = state.game.battleshipContract!.options.address;
                    const boardAndShips = BoardBuilder.constructBasicShips(
                        contractAddress,
                        this.player.address,
                        this.round
                    );
                    // TODO: should the game state, and the associated decisions be in the store?
                    // TODO: they could be, but they should be in a seperate part - as really a user should
                    // TODO: get to decide whatever game state they want
                    gameState = new GameState(boardAndShips.board, boardAndShips.ships);
                    attackIterator = gameState.nextAttack();
                    store.dispatch(Action.setupStoreShips(boardAndShips.ships, boardAndShips.board));
                    break;
                case ActionType.ATTACK_INPUT_AWAIT:
                    // we're awaiting an attack, so lets make one
                    let attack = attackIterator.next().value;
                    console.log("attack", attack);
                    store.dispatch(Action.attackInput(attack.x, attack.y));

                    break;
                case ActionType.REVEAL_INPUT_AWAIT:
                    const latestMove = state.game.moves[state.game.moves.length - 1];
                    const revealResult = gameState.squareState(latestMove.x, latestMove.y);
                    console.log("reveal: ", revealResult);
                    store.dispatch(Action.revealInput(revealResult));
                    break;
                case this.FINAL_STATE:
                    this.complete = true;
                    break;

                default:
                    break;
            }
        });
    }

    unsubscribe() {
        if (this.mUnsubsribe) this.mUnsubsribe();
    }
}

class GameState {
    constructor(readonly board: string[][], readonly ships: IShip[]) {}

    public squareState(x: number, y: number): Reveal {
        /// lookup the position on the board. and find if it's a hit or miss
        const square = this.board[x][y];
        // TODO: magic strings here
        if (square == "0") return Reveal.Miss;
        else {
            // decide if it's a normal hit or a sink

            // find the ship with this id
            const ship = this.ships.filter(ship => ship.id === square)[0];
            if (!ship) throw new Error(`Could not find ship at position ${x}:${y}.`);

            // increment the hits
            ship.hits++;

            // are the hits equal to the size of the ship?
            return ship.hits === ship.size ? Reveal.Sink : Reveal.Hit;
        }
    }

    x = 0;
    y = 0;

    public *nextAttack() {
        while (this.x < 10 && this.y < 10) {
            yield { x: this.x, y: this.y };
            this.x++;
            if (this.x % 5 == 0) {
                this.y++;
                this.x = 0;
            }
        }
    }
}

describe("Saga setup", () => {
    const actionSetupDeploy = Action.setupDeploy(10);

    // it("deployBattleship should end in await for ships", async () => {
    //     return;
    //     const { storeState } = await expectSaga(deployBattleship, actionSetupDeploy)
    //         .withReducer(rootReducer, state1)
    //         .run(10000);
    //     expect((storeState as IStore).game.battleshipContract).to.exist;
    //     expect((storeState as IStore).game.battleshipContract!.options.address).to.exist;
    //     expect((storeState as IStore).game.battleshipContract!.options.address).to.equal(
    //         store2.getState().game.battleshipContract!.options.address
    //     );

    //     console.log((storeState as IStore).currentActionType);
    //     console.log(store2.getState().currentActionType);
    //     // expect((storeState as IStore).currentActionType).to.equal(ActionType.SETUP_AWAIT_SHIPS);
    //     // expect(store2.getState().currentActionType).to.equal(ActionType.SETUP_AWAIT_SHIPS);

    //     //console.log(store1.getState().game.battleshipContract!.options.address)
    //     // expect(store2.getState().game.battleshipContract!.options.address)
    // });

    it("is my next test", async () => {
        let timeStamp = Date.now();

        const bot1 = new TestBot(store1);
        const bot2 = new TestBot(store2);

        store1.dispatch(actionSetupDeploy);

        while (!bot1.complete || !bot2.complete) {
            if (Date.now() - timeStamp > 5000) throw new Error("exceeded timeout");
            await delay(1000);
        }

        bot1.unsubscribe();
        bot2.unsubscribe();
    }).timeout(5000);

    const delay = time =>
        new Promise(resolve => {
            setTimeout(resolve, time);
        });

    // it("should run total gameengine ", async () => {
    //     testBot1.dispatch(actionSetupDeploy);
    //     const { storeState } = await expectSaga(deployBattleship, actionSetupDeploy)
    //         .withReducer(rootReducer, state1)
    //         .run(500);
    //     expect((storeState as IStore).game.battleshipContract).to.exist;
    //     expect((storeState as IStore).game.battleshipContract!.options.address).to.exist;
    // });
});
