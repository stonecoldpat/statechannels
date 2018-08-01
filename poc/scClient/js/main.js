import { StateChannel } from "./stateChannel";
import Web3 from "web3";
import { ec as EC } from "elliptic";
const web3 = new Web3("http://localhost:9545");
const ec = new EC("secp256k1");


const ACCOUNT_TRANSACTING = "0x627306090abab3a6e1400e9345bc60c78a8bef57";
const PLAYER1ADDRESS = "0xf17f52151ebef6c7334fad080c5704d77216b732";
const PLAYER1PRIVKEY = "ae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f";

const PLAYER2ADDRESS = "0xc5fdf4076b8f3a5357c5e395ab970b5b54098fef";
const PLAYER2PRIVKEY = "0dbbe8e4ae425a6d2687f1a7e3ba17bc98c673636790f1b8ad91193c05875ef1";

const DISPUTE_PERIOD = 10;
const stateChannel = new StateChannel(web3);
let currentCounter = 0;
const alphabet = "abcdefghijklmnopqrstuv";

const deployButton = () => document.getElementById("deployContract");
const deployedContractAddress = () => document.getElementById("deployedContractAddress");
const incrementCounterButton = () => document.getElementById("counterButton");
const counterContent = () => document.getElementById("counterContent");
const player1Round = () => document.getElementById("player1Round");
const player1State = () => document.getElementById("player1State");
const player1SignButton = () => document.getElementById("player1SignButton");
const player1Signatures = () => document.getElementById("player1Signatures");

const deployHandler = async () => {
    let deployedStateChannel = await stateChannel.deploy(
        ACCOUNT_TRANSACTING,
        [PLAYER1ADDRESS, PLAYER2ADDRESS],
        DISPUTE_PERIOD
    );
    deployedContractAddress().innerHTML = `<div>State channel deployed at: ${
        deployedStateChannel.options.address
    }<br/>Participants: ${PLAYER1ADDRESS}, ${PLAYER2ADDRESS}<br/>Dispute period: ${DISPUTE_PERIOD}</div>`;
    let face = await stateChannel.triggerDispute(PLAYER1ADDRESS);
};

const incrementCounterHandler = () => {
    const text = `round: ${currentCounter}, state: ${alphabet[currentCounter]}`;

    let div = document.createElement("div");
    div.appendChild(document.createElement("div").appendChild(document.createTextNode(text)));

    counterContent().appendChild(div);
    currentCounter++;
};


const signAndRecord = async (round, state, sigContentsBox, stateChannelAddress, playerAddress) => {
    const hStateAndSig = await hashAndSign(round, state, stateChannelAddress, playerAddress)
    
    const roundItem = document.createElement("li")
    roundItem.innerHTML = "round: " + round;
    
    const stateItem = document.createElement("li");
    stateItem.innerHTML = "state: " + state;

    const hStateItem = document.createElement("li");
    hStateItem.innerHTML = "hState: " + hStateAndSig.hState;

    const sigItem = document.createElement("li");
    sigItem.innerHTML = "sig: " + hStateAndSig.sig;

    const list = document.createElement("ul")
    list.appendChild(roundItem)
    list.appendChild(stateItem)
    list.appendChild(hStateItem)
    list.appendChild(sigItem)
    sigContentsBox.appendChild(list)

}

const hashAndSign = async (round, state, channelAddress, playerAddress) => {
    // to create a sig:
    // a) hstate := hash of state
    // b) h := keccak(hstate, round, stateChannel.address)
    // c) prefixedH := keccak256("\x19Ethereum Signed Message:\n32", h)
    // d) sign prefixedH with priv key
    console.log(round, state, channelAddress, playerAddress)

    const hState = web3.utils.sha3(state);
    console.log("hState", hState);
    const h = web3.utils.soliditySha3(hState, round, channelAddress);
    console.log("h", h);
    const prefixedH = web3.utils.soliditySha3("\x19Ethereum Signed Message:32", h);
    console.log("prefixedH", prefixedH);
    const sig = await web3.eth.sign(prefixedH, playerAddress);
    console.log("sig", sig);
    return { hState, sig };
}

// initialise
document.addEventListener("DOMContentLoaded", function(event) {
    deployButton().addEventListener("click", deployHandler);
    incrementCounterButton().addEventListener("click", incrementCounterHandler);
    player1SignButton().addEventListener("click", async () => {
        await signAndRecord(player1Round().value, player1State().value, player1Signatures(), stateChannel.address(), PLAYER1ADDRESS)
    });
});
