export interface IShip {
    id: string;
    size: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    r: number;
    player: string;
    round: number;
    gameAddress: string;
    hits: number;
    commitment: string;
}
