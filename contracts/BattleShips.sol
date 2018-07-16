pragma solidity ^0.4.24;

contract Battleship {
   
    /*
    After game is Created, both players commit to their boards
    During the game, the state is either Attack or Reveal
    */
    enum GameState { Created, Attack, Reveal, WinClaimed, Finished }
    
    uint8 turn; //0 if players[0] turn, 1 if players[1] turn
    GameState gameState;
    
    address[2] players;
    address winner;
    Board[2] boards;
    
    uint256 lastUpdateHeight;
    
    /*
    coordinates of the last tile that has been attacked
    */
    uint8 lastX;
    uint8 lastY;
 
    constructor (address player0, address player1) public {
        players[0] = player0;
        players[1] = player1;
        gameState = GameState.Created;
    }
    
    /*
    commitment is a hash of (randomness,ship)
    randomness, ship are revealed during the game if Tile is hit
    */
    struct Tile {
        bytes32 commitment;
        uint128 randomness;
        bool ship;
    }
    
    /*
    commitment is hash of (randomness, x1, y1, x2, y2) 
    where (x1, y1) is the starting coordinate and (x2,y2) is the end coordinate
    x1 <= x2, y1 <= y2
    */
    struct Ship {
        bytes32 commitment;
        uint128 randomness;
        uint8 x1;
        uint8 y1;
        uint8 x2;
        uint8 y2;
        bool sunk;
    }
    
    struct Board {
        Tile[10][10] board;
        Ship[10] ships;
        bool committed;
    }
    
    /*
    restrict access to players
    */ 
    modifier onlyPlayers() {
        require(msg.sender == players[0] || msg.sender == players[1]);
        _;
    }
    
    /*
    restrict access to player whose turn it is
    */
    modifier onlyPlayerTurn() {
        require(msg.sender == players[turn]);
        _;
    }
    
    /*
    only allow in `state`
    */
    modifier onlyState(GameState state) {
        require(gameState == state);
        _;
    }
    
    function declareWinner(uint8 idx) internal {
        winner = players[idx];
        gameState = GameState.Finished;
    }
    
    /*
    attacks tile at coordinate (x,y)
    */ 
    function attack(uint8 x, uint8 y) onlyPlayerTurn() onlyState(GameState.Attack) public {
        require(0<=x && x<10 && 0<=y && y<10);
        lastY = y;
        lastX = x;
        turn = 1 - turn;
        gameState = GameState.Reveal;
    }
    
    /*
    reveal last attacked tile if no ship has been sunk by a hit
    */ 
    function reveal(uint128 randomness, bool ship) onlyPlayerTurn() onlyState(GameState.Reveal) public {
        if (keccak256(abi.encodePacked(randomness, ship)) == boards[turn].board[lastX][lastY].commitment) {
             boards[turn].board[lastX][lastY].ship = ship;
             boards[turn].board[lastX][lastY].randomness = randomness;
             if (ship) {
                 turn = turn - 1;
             }
             gameState = GameState.Attack;
        } else {
            declareWinner(turn -1);
        }
    }
    
    /*
    reveal last attacked tile if a ship has been sunk by a hit
    in that case, the ship also has to be revealed
    */ 
    function reveal(uint128 fieldRandomness, uint128 shipRandomness, uint8 shipIdx, uint8 shipx1, uint8 shipy1, uint8 shipx2, uint8 shipy2) onlyPlayerTurn() onlyState(GameState.Reveal) public {
         if (keccak256(abi.encodePacked(fieldRandomness, true)) == boards[turn].board[lastX][lastY].commitment
                 && keccak256(abi.encodePacked(shipRandomness, shipx1, shipy1, shipx2, shipy2)) == boards[turn].ships[shipIdx].commitment
                 && lastX >= shipx1 && lastX <= shipx2
                 && lastY >= shipy1 && lastY <= shipy2
                 && (shipx1 == shipx2 || shipy1 == shipy2)) {
             boards[turn].board[lastX][lastY].ship = true;
             boards[turn].board[lastX][lastY].randomness = fieldRandomness;
             
             boards[turn].ships[shipIdx].randomness = shipRandomness;
             boards[turn].ships[shipIdx].x1 = shipx1;
             boards[turn].ships[shipIdx].y1 = shipy1;
             boards[turn].ships[shipIdx].x2 = shipx2;
             boards[turn].ships[shipIdx].y2 = shipy2;
             boards[turn].ships[shipIdx].sunk = true;
             
             //TODO: check that all tiles of the ship have been hit
             
             turn = turn - 1;
             gameState = GameState.Attack;
        } else {
            declareWinner(turn -1);
        }
    }
    
    function claimWin( ) onlyPlayers() public {
         uint8 idx = 0;
         if(msg.sender == players[1]) {
            idx = 1;
         }
         for (uint8 i = 0; i<10; i++) {
             require(boards[1-idx].ships[i].sunk);
         }
         // TODO: check board of winner
         declareWinner(idx);
    }
    
    /* currently allows players to change the commitments to their board until the other player has also committed */
    function commitBoard(bytes32[10][10] boardCommitments, bytes32[10] shipCommitments) onlyPlayers() onlyState(GameState.Created) public {
        uint8 idx = 0;
        if(msg.sender == players[1]) {
            idx = 1;
        }
        for (uint8 i = 0; i<10; i++) {
             for (uint8 j = 0; j<10;j++) {
                 boards[idx].board[i][j].commitment = boardCommitments[i][j];
             }
         }
         for (i = 0; i<10;i++) {
             boards[idx].ships[i].commitment = shipCommitments[i];
         }
         boards[idx].committed = true;
         if (boards[0].committed && boards[1].committed) {
            gameState = GameState.Attack;
         }
    }
    
    /*
    checks whether a player has actually placed all ships on the committed board
    the player reveals the ship locations and the blinding factors for all commitments for tiles that contain a ship
    */
    function checkBoard(uint8 idx, uint128[20] shipFieldRandomness, uint128[10] shipRandomness, uint8[10] shipX1, uint8[10] shipY1, uint8[10] shipX2, uint8[10] shipY2)  public {
        uint8 size;
        uint8 x;
        uint8 y;
        bool cheating;
        for (uint8 i = 0; i<10 && !cheating; i++) {
            if (!boards[idx].ships[i].sunk) {
                size = 0;
                cheating = false;
                // if the ship has been sunk, the locations have already been checked, otherwise check that they are actually on the board
                if (!(shipX1[i] <= shipX2[i] && shipY1[i] <= shipY2[i] && (shipX1[i] == shipX2[i] || shipY1[i] == shipY2[i]))) {
                    cheating = true;
                    break;
                }
                // check ship commitment
                if (keccak256(abi.encodePacked(shipRandomness[i], shipX1[i], shipY1[i], shipX2[i], shipY2[i])) != boards[idx].ships[i].commitment) {
                     cheating = true;   
                     break;
                }
                if (i < 4) {
                    if (!(shipX1[i] == shipX2[i] && shipY1[i] == shipY2[i] && keccak256(abi.encodePacked(shipFieldRandomness[i], true)) == boards[idx].board[shipX1[i]][shipY1[i]].commitment)) {
                         cheating = true;
                         break;
                     }
                } else if (i < 7) {
                    // ship of size 2
                    for (x = shipX1[i]; x <= shipX2[i]; x++){
                         for (y = shipY1[i]; y <= shipY2[i]; y++){
                             size++;
                             if (keccak256(abi.encodePacked(shipFieldRandomness[4+(i-4)*2+size], true)) != boards[idx].board[shipX1[i]][shipY1[i]].commitment){
                                 cheating = true;
                             }
                         }   
                     }
                     if (size != 2) {
                         cheating = true;
                     }
                } else if (i < 9) {
                    // ship of size 3
                    for (x = shipX1[i]; x <= shipX2[i]; x++){
                         for (y = shipY1[i]; y <= shipY2[i]; y++){
                             size++;
                             if (keccak256(abi.encodePacked(shipFieldRandomness[10+(i-7)*3+size], true)) != boards[idx].board[shipX1[i]][shipY1[i]].commitment){
                                 cheating = true;
                             }
                         }   
                     }
                     if (size != 3) {
                         cheating = true;
                     }
                } else {
                     // ship of size 4
                    for (x = shipX1[i]; x <= shipX2[i]; x++){
                         for (y = shipY1[i]; y <= shipY2[i]; y++){
                             size++;
                             if (keccak256(abi.encodePacked(shipFieldRandomness[16+size], true)) != boards[idx].board[shipX1[i]][shipY1[i]].commitment){
                                 cheating = true;
                             }
                         }   
                     }
                     if (size != 4) {
                         cheating = true;
                     }
                }
                
            }
        }
        if (cheating) {
            declareWinner(1-idx);
        }
    }
    
    /*
    Fraud proof for adjacent or overlapping ships
    Can be called during the game or once one player has claimed to win the game
    */
    function adjacentOrOverlapping(uint8 shipIdx1, uint8 shipIdx2) onlyPlayers() {
        require(gameState != GameState.Finished);
        
        // idx of other player
        uint8 playerIdx = 1;
        if(msg.sender == players[1]) {
            playerIdx = 0;
        }
        require(gameState == GameState.WinClaimed || (boards[playerIdx].ships[shipIdx1].sunk && boards[playerIdx].ships[shipIdx2].sunk));
        bool cheated = (boards[playerIdx].ships[shipIdx2].x1 >= boards[playerIdx].ships[shipIdx1].x1 - 1
                    &&  boards[playerIdx].ships[shipIdx2].x1 <= boards[playerIdx].ships[shipIdx1].x1 + 1
                    &&  boards[playerIdx].ships[shipIdx2].y1 >= boards[playerIdx].ships[shipIdx1].y1 - 1
                    &&  boards[playerIdx].ships[shipIdx2].y1 <= boards[playerIdx].ships[shipIdx1].y1 + 1);
        cheated = cheated || 
                       (boards[playerIdx].ships[shipIdx2].x1 >= boards[playerIdx].ships[shipIdx1].x2 - 1
                    &&  boards[playerIdx].ships[shipIdx2].x1 <= boards[playerIdx].ships[shipIdx1].x2 + 1
                    &&  boards[playerIdx].ships[shipIdx2].y1 >= boards[playerIdx].ships[shipIdx1].y2 - 1
                    &&  boards[playerIdx].ships[shipIdx2].y1 <= boards[playerIdx].ships[shipIdx1].y2 + 1);
        cheated = cheated || 
                       (boards[playerIdx].ships[shipIdx2].x2 >= boards[playerIdx].ships[shipIdx1].x1 - 1
                    &&  boards[playerIdx].ships[shipIdx2].x2 <= boards[playerIdx].ships[shipIdx1].x1 + 1
                    &&  boards[playerIdx].ships[shipIdx2].y2 >= boards[playerIdx].ships[shipIdx1].y1 - 1
                    &&  boards[playerIdx].ships[shipIdx2].y2 <= boards[playerIdx].ships[shipIdx1].y1 + 1);
        cheated = cheated || 
                       (boards[playerIdx].ships[shipIdx2].x2 >= boards[playerIdx].ships[shipIdx1].x2 - 1
                    &&  boards[playerIdx].ships[shipIdx2].x2 <= boards[playerIdx].ships[shipIdx1].x2 + 1
                    &&  boards[playerIdx].ships[shipIdx2].y2 >= boards[playerIdx].ships[shipIdx1].y2 - 1
                    &&  boards[playerIdx].ships[shipIdx2].y2 <= boards[playerIdx].ships[shipIdx1].y2 + 1);
        if (cheated) {
            declareWinner(1-playerIdx);
        }
        
    }
    
    /*
    Allows the players to claim the win if the other player takes too long to take his turn
    */
    function timeout() public onlyPlayers() {
        require(gameState == GameState.Attack || gameState == GameState.Reveal);
        if (block.number > lastUpdateHeight + 20) {
            declareWinner(1-turn);
        }
    }
    
    /*
    Allows the players to finalize the game after the period for fraud proof submission is over
    */
    function finishGame() public onlyPlayers() onlyState(GameState.WinClaimed) {
        if (block.number > lastUpdateHeight + 20) {
            gameState = GameState.Finished;
        }
    }
    
    /* 
    Notes:
    - TODO: fraud proof for overlapping/adjacent ships
    - TODO: add ships to board in checkBoard function
    - TODO: in checking functon, check if ship has not been revealed but all tiles of the ship have been
    */
}
