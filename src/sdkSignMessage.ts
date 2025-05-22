import { HexString, SupraAccount } from "supra-l1-sdk";
import nacl from "tweetnacl";


async function main(){
    
    //Generate a new account
    let signingAccount = new SupraAccount();

    //Message to sign
    const message = new HexString(Buffer.from("hello","utf8").toString("hex"));

    //Sign the hex string with SupraAccount private key
    const signed_message = signingAccount.signHexString(message);

    //Verify with the SupraAccount object and stored pubKey for verification,
    //Great for when we have the private key to create the SupraAccount object
    const verifyWithAccount = signingAccount.verifySignature(message,signed_message);

    //pubKeyOfSigner that we wish to verify
    //const pubKeyOfSigner = new HexString("0x00000.....").toUint8Array();
    const pubKeyOfSigner = signingAccount.pubKey().toUint8Array();

    //Manual approach, passing the pubKey manually - Useful in instances where you do not have the privateKey to construct the SupraAccount object
    const verifyManually = nacl.sign.detached.verify(message.toUint8Array(), signed_message.toUint8Array(), pubKeyOfSigner);

    console.log(verifyWithAccount);
    console.log(verifyManually);
}


main()