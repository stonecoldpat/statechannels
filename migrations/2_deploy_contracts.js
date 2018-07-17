const BattleShip = artifacts.require('./BattleShips.sol')
const SimpleSprites = artifacts.require('./SimplifiedSprites.sol')
const StateChannel = artifacts.require('./StateChannel.sol')

module.exports = async (deployer, network, accounts) => {
    await deployer.deploy(BattleShip, accounts[1], accounts[2])
}
