import { HexString, SupraAccount, SupraClient, BCS, TxnBuilderTypes } from "supra-l1-sdk";
import axios from "axios";

//Written to explore/better understand auth keys/key rotation.

/**
   * Rotate an account's auth key. After rotation, only the new private key can be used to sign txns for
   * the account.
   * WARNING: You must create a new instance of AptosAccount after using this function.
   * 
   * 
   * @param forAccount Account of which the auth key will be rotated
   * @param toPrivateKeyBytes New private key
   * @param supraClient SupraClient to send transaction -- (Would not need to pass this once implemented in SupraClient class)
   * @returns PendingTransaction
   */
async function rotateAuthKeyEd25519(
  forAccount: SupraAccount,
  toAccount: SupraAccount,
  supraClient: SupraClient
) {

    //Get the sequence number and current authentication key of the "forAccount"
  const { sequence_number: sequenceNumber, authentication_key: authKey } = await supraClient.getAccountInfo(
    forAccount.address(),
  );


  //Create the rotation proof challenge that must be signed by both accounts to execute a "proven" transaction
  const challenge = new TxnBuilderTypes.RotationProofChallenge(
    TxnBuilderTypes.AccountAddress.CORE_CODE_ADDRESS,
    "account",
    "RotationProofChallenge",
    BigInt(sequenceNumber),
    TxnBuilderTypes.AccountAddress.fromHex(forAccount.address()),
    new TxnBuilderTypes.AccountAddress(new HexString(authKey).toUint8Array()),
    toAccount.pubKey().toUint8Array(),
  );

  //Hex of challenge
  const challengeHex = HexString.fromUint8Array(BCS.bcsToBytes(challenge));


  //Sign by current account (forAccount)
  const proofSignedByCurrentPrivateKey = forAccount.signHexString(challengeHex);

  //Sign by new account (toAccount)
  const proofSignedByNewPrivateKey = toAccount.signHexString(challengeHex);

 
  //Create serialized raw tx object
  //We will be calling the rotate_auth_key function of account module in supra framework
  //https://github.com/Entropy-Foundation/aptos-core/blob/6645242f3934cd3c6bf2673f27cb6d2901d2fae8/aptos-move/framework/supra-framework/sources/account.move#L298
  //
  //params of the rotate_authentication_key functions are
    //  from_scheme: u8,
    //  from_public_key_bytes: vector<u8>,
    //  to_scheme: u8,
    //  to_public_key_bytes: vector<u8>,
    //  cap_rotate_key: vector<u8>,
    //  cap_update_table: vector<u8>

  let serializedRaw = await supraClient.createSerializedRawTxObject(
    new HexString(forAccount.address().toString()),
    (await supraClient.getAccountInfo(forAccount.address())).sequence_number,
    "0000000000000000000000000000000000000000000000000000000000000001",
    "account",
    "rotate_authentication_key",
    [],
    [
      BCS.bcsSerializeU8(0), // ed25519 scheme
      BCS.bcsSerializeBytes(forAccount.pubKey().toUint8Array()),
      BCS.bcsSerializeU8(0), // ed25519 scheme
      BCS.bcsSerializeBytes(toAccount.pubKey().toUint8Array()),
      BCS.bcsSerializeBytes(proofSignedByCurrentPrivateKey.toUint8Array()),
      BCS.bcsSerializeBytes(proofSignedByNewPrivateKey.toUint8Array()),
    ]
  )

    // send the serialzed raw txn and return pending txn
    return(
      await supraClient.sendTxUsingSerializedRawTransaction(
        forAccount,
        serializedRaw,
        {
            enableTransactionSimulation: true,
            enableWaitForTransaction: true,
            
        }
      )
    );


}

/*
* Resource from account module, stored at 0x1
* OriginatingAddress is a table that is used for reverse lookup to find the address of a given authentication key
* Review comment here: https://github.com/Entropy-Foundation/aptos-core/blob/6645242f3934cd3c6bf2673f27cb6d2901d2fae8/aptos-move/framework/supra-framework/sources/account.move#L59
*/
async function viewOriginatingAddress(
    supraClient: SupraClient,
    account: SupraAccount
){

    //obtain table handle, needed to query items within the table
    const tableHandle = (
        await supraClient.getResourceData(new HexString('0x1'), '0x1::account::OriginatingAddress')
    ).address_map.handle;

    //call the api to get the stored value for the passed auth key
    //the returned value will be the address associated with the passed auth key (if any)
    const resData = await axios({
        method: "post",
        baseURL: "https://rpc-testnet.supra.com",
        url: `/rpc/v1/tables/${tableHandle}/item`,
        data:{
            key_type: "address",
            value_type: "address",
            key: account.authKey().toString()
            },
        headers: {
          "Content-Type": "application/json",
        },
      });

      return resData.data;

}

//The auth key derived from the keys can be different than the auth key stored in the account resource if the key has been rotated
//SupraAccount.authKey() returns the derived auth key, not the current on-chain one in the account resource
//
//SDK already has this functionality through the SupraClient.getAccountInfo method, but I already wrote this so I am leaving it as is
//https://sdk-docs.supra.com/classes/SupraClient.html#getAccountInfo
async function getAuthKey(address: string){
    const resData = await axios({
        method:"get",
        baseURL:"https://rpc-testnet.supra.com",
        url:`/rpc/v1/accounts/${address}`
    })

    if(resData.data == null){
        return null
    }

    return resData.data.authentication_key;
}

//just used to build log output to see what changes at each step
async function buildLog(note: string, account: SupraAccount, supraClient: SupraClient){
    let temp = Object(account.toPrivateKeyObject());
    temp.derivedAuthKey = account.authKey().toString();
    temp.accountResourceAuthKey = await getAuthKey(account.address().toString());
    temp.originatingAddress = await viewOriginatingAddress(supraClient, account);


    return [note, temp];
}



async function main(){

    //useful link aptos guide on key rotation
    //https://aptos.dev/en/build/guides/key-rotation
    //refer to authentication key section for more info on derived auth key:
    //https://aptos.dev/en/network/blockchain/accounts

    //init the supraclient
    const supraClient = await SupraClient.init(
        "https://rpc-testnet.supra.com/"
      );
  
    //sloppy log arrays to track change in data
    const aLog = [];
    const bLog = [];
    

    //This example will generate Account A, register an account resource, and then rotate the authentication key to that of Account B
    //As such, private key of account A will no longer work for address A. 
    //          Private key of account B will gain control 
    //
    // This example is for PROVEN auth key rotations, where both keys must sign to prove ownership before the rotation can be completed


    //Create account A - for account
    const accountA = new SupraAccount();
    //Create account B - new account
    const accountB = new SupraAccount();

    //Log values after key generation
    //note that the account is not yet registered on-chain so no account resource will exist for it
    //as such, we can expect a null account.authentication_key value for the value stored on-chain
    //additionally, we can expect a null originatingAddress value -- note that the OriginatingAddress table is ONLY updated upon key rotation
    aLog.push(await buildLog('keys generated',accountA, supraClient));
    bLog.push(await buildLog('keys generated',accountB, supraClient));

    //Fund both accounts
    //funding an account registers an account resource at the address on-chain
    //Note how we are currently only funding accountA 
    //If interested, comment one out, or uncomment both to see what happens 
    await supraClient.fundAccountWithFaucet(accountA.address())
    //await supraClient.fundAccountWithFaucet(accountB.address())

    //Log values fater funding/registering account
    //now that an account is registered on-chain for account A, the account resource is present at the address of account A
    //we can now expect a populated account.authentication_key value for account A
    //      Account B has not been registered, no account resource exists, account.authentication_key will be null
    //however, we still expect a null originatingAddress value for both as it is only ever updated upon key rotation
    aLog.push(await buildLog('accounts funded',accountA, supraClient));
    bLog.push(await buildLog('accounts funded',accountB, supraClient));


    //Execute the authentication key rotation
    await rotateAuthKeyEd25519(accountA, accountB, supraClient)

    //Log values after authentication key rotation
    //now that the rotation has occured, note how:
    //  - The authentication key of account A has changed to the derived authentication key of account B
    //  - The OriginatingAddress value for the derived authentication key of account B is now set to the address of account A
    // We have successfully rotated the keys
    // Account B private key can now be used to sign for address A
    // Account A keys are stale
    //Can now use OriginatingAddress to reverse lookup address associated with Account B derived authentication key
    aLog.push(await buildLog('keys rotated', accountA, supraClient));
    bLog.push(await buildLog('keys rotated', accountB, supraClient));



     /*
     * NOTES
     * from guide: https://aptos.dev/en/build/guides/key-rotation
     * 
     * in theory, an account can authenticate two addresses at any time with PROVEN rotations
     *      1: initial account created from derived key
     *      2: another account that has been rotated to same key
     * 
     * 
     * this is due to originatingaddress value only being updated during key rotations
     * it is best practice to only authenticate a single account with any auth key at any given time
     * to mitigate the above issue, aptos introduced a function account::set_originating_address to be called after account generation
     * 
     * however, we do not currently have this function in our account module (along with other useful functions associated with auth key rotation/originating address)
     * i believe this is because they were recently added to the aptos account module in August of this year
     * we forked before it was added
     * 
     * 
     * 
     * It is important to note that there are also unproven key rotations through the 'account::rotate_authentication_key_call' function
     *      This type of rotation does NOT need the signature of the second key, it only needs the signature of the originating key. (account A)
     *      This type of rotation does NOT update the OriginatingAddress table due to this
     *      This type of rotation can result in ANY number of accounts being authenticated by a single key
     * 
     * 
     * 
     * 
     * 
     * 
     * StarKey does not currently support KeyRotation (I am not sure if Petra wallet handles key rotations)
     * 
     * From what I can tell, StarKey wallet assumes that the account associated with the key is that of the derived auth key
     * However, this is not the case when keys are rotated
     * 
     * The OriginatingAddress table can be used for reverse lookup and would help StarKey wallet identify the associated account for an imported key
     * However, this does not solve instances where there is >1 account authenticated by a single key
     * 
     * Perhaps the solution to this is to enable an "advanced" setting where the user can CHANGE the address associated with their key in the wallet
     * 
     * Similar feature is currently in our typescript SDK when creating a new instance of a SupraAccount
     * https://sdk-docs.supra.com/classes/SupraAccount.html#constructor
     * SupraAccount constructor accepts two option parameters:
     *  privateKeyBytes and an address
     * 
     * In instances where a key can be used on multiple accounts, passing any given address value (that the private key is valid for) will function as expected
     * In instances where no  address is passed, the SupraAccount assumes the address is that of the derived auth key
     */

    //OUTPUT
    console.log('\n\nOUTPUT:\n------------------------------------------------------------\n')
    console.log('Account A')
    console.log(aLog)
    console.log('\nAccount B')
    console.log(bLog)
}


main();


