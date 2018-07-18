const BattleShip = artifacts.require('./BattleShips.sol')
const StateChannel = artifacts.require('./StateChannel.sol')

module.exports = async (deployer, network, accounts) => {
    await deployer.deploy(StateChannel, [accounts[1], accounts[2]], 20, {from: accounts[6]})
    await deployer.deploy(BattleShip, accounts[1], accounts[2], StateChannel.address), {from: accounts[5]}
}
