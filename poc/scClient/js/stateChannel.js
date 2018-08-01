// for a known statechannel provide javascript interaction via a client lib

// need to interact via web3 - bundle with webpack
// need abi definition provided by the build output
// create this using by assuming globals? import via fs? no, load using require

const statechannelArtifact = require("./../../../build/contracts/StateChannel.json");
const scAbi = statechannelArtifact.abi;
const scBytecode = statechannelArtifact.bytecode;
export class StateChannel {
    constructor(_web3) {
        this.web3 = _web3;
    }

    address() {
        return this.deployedChannel.options.address;
    }

    async deploy(transactingAccount, addresses, disputePeriod) {
        const stateChannel = new this.web3.eth.Contract(scAbi);
        console.log("Deploying channel contract...", { transactingAccount, addresses, disputePeriod });
        const deployedChannel = await stateChannel
            .deploy({
                data: scBytecode,
                arguments: [addresses, disputePeriod]
            })
            .send({
                from: transactingAccount,
                gas: 2000000,
                gasPrice: 1
            });
        this.deployedChannel = deployedChannel;
        console.log("Channel deployed at", deployedChannel.options.address);
        return deployedChannel;
    }

    async triggerDispute(player) {
        console.log("Tiggering dispute by player: ", player);
        const result = await this.deployedChannel.methods.triggerDispute().send({
            from: player
        });
        console.log("EventDispute: ", result.events.EventDispute.returnValues);
    }

    async setState(player, sigs, i, hstate) {
        console.log("Setting state", { sigs, i, hstate });
        const result = await this.deployedChannel.methods.setstate(sigs, i, hstate).send({
            from: player
        });
        console.log("EventEvidence", result.events.EventEvidence.returnValues);
    }
}
