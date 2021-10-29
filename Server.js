const express = require('express');
const app = express();
const http = require('http');
const chalk = require('chalk');
const prompt = require('prompt');
const EventEmitter = require('events');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const waitEmitter = new EventEmitter();
const clients = new Map();
let pendingTasks = new Set();

waitEmitter.on('task completed', (addr) => {
    pendingTasks.delete(addr);
    if(pendingTasks.size === 0)
        waitEmitter.emit('tasks ended');
});

waitEmitter.on('tasks ended', () => {
    console.log(chalk.green('\nAll pending tasks completed'));
    cmdPrompt();
});

const schema = {
    properties: {
        transactions: {
            type: 'integer',
            description: 'Number of transactions to execute\n'
        },
        frequency: {
            type: 'number',
            description: 'Frequency of measurements (meas/s)\n'
        },
        endpoint: {
            description: 'Blockchain endpoint (empty = leave to the client)\n'
        }
    }
}

async function getTaskParams(){
    try {
        prompt.start();
        let {transactions, frequency, endpoint} = await prompt.get(schema);
        if (transactions <= 0 || frequency < 0)
            return [-1, -1, undefined];
        let sleep = 0;
        if(frequency !== 0)
            sleep = 1/frequency;
        if(endpoint === '')
            endpoint = undefined;
        return [transactions, sleep, endpoint];
    }catch (e){
        console.log(chalk.red(e));
        return [-1, -1, undefined];
    }
}

async function broadcastTask(){
    const [txs, sleep, endpoint] = await getTaskParams();
    if(txs < 0) {
        cmdPrompt();
        return;
    }
    for(let k of clients.keys())
        pendingTasks.add(k);
    io.emit('task', {txs: txs, sleep: sleep, endpoint: endpoint});
}

async function setTasks(){
    let tasks = [];
    for(const [key, value] of clients.entries()){
        console.log(chalk.cyan(`==>${key}<==`));
        const [txs, sleep, endpoint] = await getTaskParams();
        if(txs < 0)
            continue;
        tasks.push([value, txs, sleep, endpoint]);
        pendingTasks.add(key);
    }
    if(pendingTasks.size === 0) {
        cmdPrompt();
        return;
    }

    tasks.forEach( task => task[0].emit('task', {txs: task[1], sleep: task[2], endpoint: task[3]}) );
}

function printClients(){
    console.log(chalk.cyan(`Clients connected: ${clients.size}`));
    for(const [key] of clients.entries()){
        console.log(chalk.cyan(`>${key}`));
    }
    cmdPrompt();
}

async function pauseClient(){
    const sleepSchema = {
        properties: {
            address: {
                required: true,
                description: 'Client address\n'
            },
            sleep: {
                required: true,
                type: 'number',
                description: 'Hours to sleep\n'
            }
        }
    };
    try {
        prompt.start();
        let {address, sleep} = await prompt.get(sleepSchema);
        if(!clients.has(address)){
            console.log(chalk.red(`Client ${address} not connected`));
            cmdPrompt();
            return;
        }
        if(sleep <= 0){
            console.log(chalk.red('Sleep time must be greater than zero'));
            cmdPrompt();
            return;
        }
        clients.get(address).emit('sleep', sleep);
    }catch (e){
        console.log(chalk.red(e));
    }
    cmdPrompt();
}

async function pauseAll(){
    const sleepSchema = {
        properties: {
            sleep: {
                required: true,
                type: 'number',
                description: 'Hours to sleep\n'
            }
        }
    };
    try {
        prompt.start();
        let {sleep} = await prompt.get(sleepSchema);
        if(sleep <= 0){
            console.log(chalk.red('Sleep time must be greater than zero'));
            cmdPrompt();
            return;
        }
	io.emit('sleep', sleep); 
    }catch (e){
        console.log(chalk.red(e));
    }
    cmdPrompt();
}

function printCmd() {
    console.log(chalk.underline('-a  -> broadcast task to all clients'));
    console.log(chalk.underline('-s  -> set task for every client'));
    console.log(chalk.underline('-c  -> print connected clients'));
    console.log(chalk.underline('-p  -> pause target client'));
    console.log(chalk.underline('-pa -> pause all clients'));
    console.log(chalk.underline('-e  -> exit'));
}

function shutdown(){
    server.close();
    io.close();
    waitEmitter.removeAllListeners();
}

function cmdPrompt(){
    prompt.start();
    prompt.get(['cmd'], function (err, result){
        if(!result || err) {
            shutdown();
            return;
        }
        switch (result.cmd){
            case '-e':
                shutdown();
                return;
            case '-a':
                broadcastTask();
                break;
            case '-s':
                setTasks();
                break;
            case '-c':
                printClients();
                break;
            case '-p':
                pauseClient();
                break;
            case '-pa':
                pauseAll();
                break;
            default:
                console.log(chalk.yellow(`${result.cmd} is not a valid command`));
                printCmd();
                cmdPrompt();
                break;
        }
    });
}

io.on('connection', function (socket){
    console.log(chalk.green('Client connected => ' + socket.handshake.query.addr));
    clients.set(socket.handshake.query.addr, socket);
    socket.on('results', (txs, duration) => {
        console.log(`Address ` + chalk.cyan(socket.handshake.query.addr) + `: ${txs} transactions executed in ${duration}s (${txs/duration}tx/s)`);
        waitEmitter.emit('task completed', socket.handshake.query.addr);
    });
    socket.on('err', (err) => {
        console.log(chalk.red(`Error at ${socket.handshake.query.addr}: ${err}`));
    })
    socket.on('disconnect', () => {
        console.log(chalk.yellow('Client disconnected => ' + socket.handshake.query.addr));
        if(pendingTasks.has(socket.handshake.query.addr))
            waitEmitter.emit('task completed', socket.handshake.query.addr);
        clients.delete(socket.handshake.query.addr);
    });
});

server.listen(8080, () => {
    console.log('Server connected at port 8080');
    printCmd();
    cmdPrompt();
});