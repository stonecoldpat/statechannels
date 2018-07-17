const BattleShips = artifacts.require('./BattleShips.sol')
const Web3 = require('web3')
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'))
const abi = require('ethereumjs-abi')
const BigNumber = require('bignumber.js')

const Commit = require('./helpers/commitments.js')

contract('BattleShips', function (accounts) {
    let battleship, boardcommitments, tx

    const player1 = accounts[1]
    const player2 = accounts[2]
    const p1ship4x1 = [0,0, 0,3]
    const p1ship3x1 = [2,0, 2,2]
    const p1ship3x2 = [4,0, 4,2]
    const p1ship2x1 = [6,0, 6,1]
    const p1ship2x2 = [8,0, 8,1]
    const p1ship2x3 = [0,8, 0,9]
    const p1ship1x1 = [2,9, 2,9]
    const p1ship1x2 = [4,9, 4,9]
    const p1ship1x3 = [6,9, 6,9]
    const p1ship1x4 = [8,9, 8,9]

    const p1ships =[[0,0, 0,3],
                    [2,0, 2,2],
                    [4,0, 4,2],
                    [6,0, 6,1],
                    [8,0, 8,1],
                    [0,8, 0,9],
                    [2,9, 2,9],
                    [4,9, 4,9],
                    [6,9, 6,9],
                    [8,9, 8,9]]
    const p1board = 
       [[1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
        [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
        [1, 0, 1, 0, 1, 0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 1, 0, 1, 0, 1, 0, 1, 0]]   

    let p1boardCommits = []
    let p1boardBits = []
    let p1shipCommits = []  
    let p1shipBits = []
    
    before( async () => {
        battleship = await BattleShips.new(player1, player2)

        // create board commitments
        for (var i = 0; i < p1board.length; i++) {
            var row = p1board[i]
            var commitRow = []
            var bitsRow = []
            for (var j = 0; j < row.length; j++) {
                var result = await Commit.squareCommit( row[j] == 1 )
                bitsRow.push( '0x' + result[0].toString('hex') )
                commitRow.push( '0x' + result[1].toString('hex') )
            }
            p1boardCommits.push(commitRow)
            p1boardBits.push(bitsRow)
        }

        // create ship commits
        for (var i = 0; i < p1ships.length; i++) {
            var ship = p1ships[i]
            var result = await Commit.shipCommit(ship[0], ship[1], ship[2], ship[3])
            p1shipCommits.push( '0x' + result[1].toString('hex') )
            p1shipBits.push( '0x' + result[0].toString('hex') )    
        }
    })

    it('should print row', async () => {
        tx = await battleship.commitBoard(p1boardCommits, p1shipCommits,{from: player1})
        console.log(tx)
        log = tx.logs.find(log => log.event == 'BoardCommit')
        assert.equal(log.args.player, player1)
        
        var committed = await battleship.isCommitted.call(0)
        assert.equal( committed, true )
    })

})
