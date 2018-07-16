const BattleShip = artifacts.require('./BattleShips.sol')

module.exports = async (deployer, network, accounts) => {
    deployer.deploy(BattleShip, accounts[1], accounts[2])
}
