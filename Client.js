require('dotenv').config();
const SensorHub = require('dockerpi-sensorhub')
const Web3 = require('web3');
const fs = require('fs-extra');
const EventEmitter = require('events');
const { io } = require('socket.io-client');

const measureEmitter = new EventEmitter();
const hub = new SensorHub();
if(!hub || !hub.read()) throw new Error('Unable to init the hub');

const url = process.env.WEB3_PROVIDER_URI
const privateKey = process.env.SIGNER_LOCAL_PRIVATE_KEY;
const accAddr = process.env.SIGNER_LOCAL_ADDRESS;

const abi = JSON.parse(fs.readFileSync('./Contract/SimpleTemp.abi', 'utf8'));
const contractAddr = fs.readFileSync('./Contract/address.txt', 'utf8');

let web3 = new Web3();
let contract;
let nonce;
let socket;

let txCount = 0;
let completedTxs = 0;
let startTime;

measureEmitter.on('measure', async function send(temp, time, nonce){
    let encodedABI = contract.methods.storeMeasurement(temp, time).encodeABI();
    let tx;
    let txData = {
        nonce: ""+nonce,
        data: ""+encodedABI,
        from: ""+accAddr,
        to: ""+contract.options.address,
        gas: web3.utils.toHex(300000),
        gasPrice: web3.utils.toHex(0)
    };
    try {
        tx = await web3.eth.accounts.signTransaction(txData, privateKey);
    }catch (err){
        console.log(`Failed signTransaction => ${err}`);
        socket.emit('err', `Failed signTransaction => ${err}`);
        txCount--;
        console.log(txCount);
	if(txCount === 0){
            console.log('Task completed');
            socket.emit('results', completedTxs, (Date.now() - startTime)/1000);
        }
        return;
    }

    web3.eth.sendSignedTransaction(tx.rawTransaction)
        .then(receipt => {
            console.log(receipt);
            completedTxs++;
            txCount--;
	    console.log(txCount);
            if(txCount === 0){
                console.log('Task completed');
                socket.emit('results', completedTxs, (Date.now() - startTime)/1000);
            }
        })
        .catch(error => {
            console.log(error);
            socket.emit('err', error.toString());
            txCount--;
	    console.log(txCount);
            if(txCount === 0){
                console.log('Task completed');
                socket.emit('results', completedTxs, (Date.now() - startTime)/1000);
            }
        });
});

function sleep(s) {
    return new Promise(resolve => setTimeout(resolve, s*1000));
}

async function start(txs, s) {
    startTime = Date.now();
    try {
        nonce = web3.utils.numberToHex(await web3.eth.getTransactionCount(accAddr));
    }catch (err){
        console.log(`Failed getTransactionCount => ${err}`);
        socket.emit('err', `Failed getTransactionCount => ${err}`);
        socket.emit('results', 0, (Date.now() - startTime)/1000);
        return;
    }
    for (let i = 0; i < txs; i++) {
        const wait = sleep(s);
        const measurements = await hub.read();
        const now = Math.floor(Date.now() / 1000);
        console.log("temp: " + measurements.externalTemp + " time: " + new Date(now * 1000).toLocaleString());
        measureEmitter.emit('measure', measurements.externalTemp, now, nonce++);
        await wait;
    }
}

function connect(server_url) {
    socket = io(server_url, {
        query: {
            'addr': accAddr
        }
    });

    socket.on('task', (task) => {
        console.log(`txs: ${task.txs} sleep: ${task.sleep} endpoint: ${task.endpoint}`);

        let providerUrl;
        if(task.endpoint)
            providerUrl = task.endpoint;
        else
            providerUrl = url;
        //Per il keepalive serve websocket, se non serve rpc http si può impostare il provider così:
        /*new Web3.providers.WebsocketProvider(providerUrl, {
            clientConfig:{
                keepalive: true,
                keepaliveInterval: 60000
            }
        })*/
        web3.setProvider(providerUrl);
        contract = new web3.eth.Contract(abi, contractAddr);
        txCount = task.txs;
        completedTxs = 0;
        start(task.txs, task.sleep);
    });

    socket.on('sleep', async (time) => {
        console.log(`Sleeping for ${time} hours`);
        socket.disconnect();
        await sleep(time*60*60);
        connect(server_url);
    });
}

const serverUrl = 'http://localhost:8080';  //Si potrebbe mettere come arg o nell'.env
connect(serverUrl);
