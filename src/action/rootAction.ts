//  import { ActionsUnion, createAction } from "@martin_hotell/rex-tils";
import * as TypesafeActions from "typesafe-actions";
// TODO: remove circular dependency here
import { Reveal, IMove } from "../store";
import { Contract } from "web3-eth-contract";
import { IShip } from "./../entities/gameEntities";

export enum ActionType {
    // input from a user
    ATTACK_INPUT = "ATTACK_INPUT",
    ATTACK_INPUT_AWAIT = "ATTACK_INPUT_AWAIT",

    // broadcast attack to counterparty
    ATTACK_BROADCAST = "ATTACK_BROADCAST",
    ATTACK_BROADCAST_AWAIT = "ATTACK_BROADCAST_AWAIT",

    // attack accepted by counterparty
    ATTACK_ACCEPT = "ATTACK_ACCEPT",
    ATTACK_ACCEPT_AWAIT = "ATTACK_ACCEPT_AWAIT",

    // input from a user
    REVEAL_INPUT = "REVEAL_INPUT",
    REVEAL_INPUT_AWAIT = "REVEAL_INPUT_AWAIT",
    REVEAL_BROADCAST = "REVEAL_BROADCAST",
    REVEAL_BROADCAST_AWAIT = "REVEAL_BROADCAST_AWAIT",

    /// SETUP ////////////////////////////////////
    SETUP_DEPLOY = "SETUP_DEPLOY",
    SETUP_DEPLOY_AWAIT = "SETUP_DEPLOY_AWAIT",
    SETUP_DEPOSIT = "SETUP_DEPOSIT",
    SETUP_PLACE_BET = "SETUP_PLACE_BET",
    SETUP_STORE_SHIPS_AWAIT = "SETUP_AWAIT_SHIPS",
    SETUP_STORE_SHIPS = "SETUP_STORE_SHIPS",
    SETUP_READY_TO_PLAY = "SETUP_READY_TO_PLAY",
    SETUP_OPPONENT_READY_TO_PLAY = "SETUP_OPPONENT_READY_TO_PLAY",
    ADD_BATTLESHIP_ADDRESS = "ADD_BATTLESHIP_ADDRESS",

    /// STORE ////////////////////////////////////
    STORE_BATTLESHIP_CONTRACT = "STORE_CONTRACT",
    ATTACK_CREATE = "ATTACK_CREATE_OR_UPDATE",
    UPDATE_CURRENT_ACTION_TYPE = "UPDATE_CURRENT_ACTION_TYPE"
}

const createAction = <P>(type: string, payload: P) => {
    return {
        type,
        payload
    };
};

export const Action = {
    attackInput: (x: number, y: number) => createAction(ActionType.ATTACK_INPUT, { x, y }),
    attackBroadcast: (
        x: number,
        y: number,
        // TODO: weird
        // moveCtr: number,
        // sig: string,
        hashState: string,
        hashStateSig: string
    ) => createAction(ActionType.ATTACK_BROADCAST, { x, y, hashState, hashStateSig }),
    attackCreate: (payload: IMove) => createAction(ActionType.ATTACK_CREATE, payload),
    attackAccept: (hashStateSignature: string) => createAction(ActionType.ATTACK_ACCEPT, { hashStateSignature }),

    // TODO: IShipCoordinates ?
    // TODO: split this reveal into two different actions, reveal and reveal sunk
    revealInput: (reveal: Reveal, r?: number, x1?: number, y1?: number, x2?: number, y2?: number, shipIndex?: number) =>
        createAction(ActionType.REVEAL_INPUT, { reveal, x1, y1, x2, y2, shipIndex, r }),
    revealBroadcast: (reveal: Reveal) => createAction(ActionType.REVEAL_BROADCAST, { reveal }),

    /// SETUP /////////////////////////////////////////////
    setupDeploy: (timerChallenge: number) => createAction(ActionType.SETUP_DEPLOY, { timerChallenge }),
    setupAddBattleshipAddress: (battleshipContractAddress: string) =>
        createAction(ActionType.ADD_BATTLESHIP_ADDRESS, { battleshipContractAddress }),
    setupDeposit: (amount: number) => createAction(ActionType.SETUP_DEPOSIT, { amount }),
    setupPlaceBet: (amount: number) => createAction(ActionType.SETUP_PLACE_BET, { amount }),
    setupStoreShips: (ships: IShip[], board: string[][]) => createAction(ActionType.SETUP_STORE_SHIPS, { ships, board }),
    // TODO: hack because we havent sorted out the proper nullabe type for payload, or use the typesafe-actions
    setupOpponentReadytoPlay: () => createAction(ActionType.SETUP_OPPONENT_READY_TO_PLAY, {}),
    setupReadyToPlay: (isReadyToPlay: boolean) => createAction(ActionType.SETUP_READY_TO_PLAY, { isReadyToPlay }),

    /// STORE /////////////////////////////////////////////
    storeBattleshipContract: (battleshipContract: Contract) =>
        createAction(ActionType.STORE_BATTLESHIP_CONTRACT, { battleshipContract }),
    updateCurrentActionType: (actionType: ActionType) =>
        createAction(ActionType.UPDATE_CURRENT_ACTION_TYPE, { actionType })
};

export type Action = TypesafeActions.ActionType<typeof Action>;
