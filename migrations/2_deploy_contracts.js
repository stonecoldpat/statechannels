const BattleShip = artifacts.require('./BattleShips.sol')

module.exports = async (deployer, network, accounts) => {
    deployer.deploy(BattleShip)
}
