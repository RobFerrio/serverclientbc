(async ()=>{
    require('dotenv').config();
const Web3 = require('web3');
const fs = require('fs-extra');

const url = process.env.WEB3_PROVIDER_URI
const web3 = new Web3(url);
let privateKey = process.env.SIGNER_LOCAL_PRIVATE_KEY;
let accAddr = process.env.SIGNER_LOCAL_ADDRESS;

let bytecode = fs.readFileSync('./Contract/SimpleTemp.bin', 'utf8');
let abi = JSON.parse(fs.readFileSync('./Contract/SimpleTemp.abi', 'utf8'));
let nonce = web3.utils.numberToHex(await web3.eth.getTransactionCount(accAddr));

let contract = new web3.eth.Contract(abi); 
let payload = {
    data: bytecode
}   
let data = await contract.deploy(payload).encodeABI();
const txData = {
              nonce: ""+nonce,           
              chainId:""+1337, //Dal file di genesi
              data: ""+data,
              gasPrice: web3.utils.toHex(0),
              gas:  web3.utils.toHex(3000000), //messo un valore abbastanza grande. Esiste anche un metodo per stimare il consumo di gas della tua transazione (simile a getGasPrice())
              from: ""+accAddr
      };

let transaction=await web3.eth.accounts.signTransaction(txData, privateKey);
      let result;
      try{
          result = await web3.eth.sendSignedTransaction(transaction.rawTransaction);
          //indirizzo del contratto salvato su file per interazioni future
          fs.writeFile('./Contract/address.txt', result.contractAddress , function (err) {
             if (err) console.log(err);
          });
          console.log(result.contractAddress);
          return result
      }
      catch(e){console.log(e); result=null}
})()
