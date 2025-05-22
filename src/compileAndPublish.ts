import fs from "fs";
import { HexString, SupraAccount, SupraClient } from "supra-l1-sdk";
import { execSync } from "child_process";


//TODO: - Add comments/document
//      - Update to new cli directory structure introduced with the new docker compose config.

function getPackageData(filePath: string) {
    const jsonData = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const packageMetadata = new HexString(jsonData.args[0].value).toUint8Array();
    const modulesCode = [];

    for(let e of jsonData.args[1].value){
      modulesCode.push(new HexString(e).toUint8Array())
    }
  
    return { packageMetadata, modulesCode };
}


async function compilePackage(packageName: string, namedAddresses: Array<{ name: string; address: string }>) {
  
    const namedAddressesArg = namedAddresses.map(({ name, address }) => `${name}=${address}`).join(" ");

    const compileCommand = `docker exec supra_cli /supra/supra move tool build-publish-payload --json-output-file ./configs/move_workspace/${packageName}/output.json --package-dir /supra/configs/move_workspace/${packageName} --named-addresses ${namedAddressesArg} --assume-yes`;
    const data = execSync(compileCommand);
    console.log(data.toString())
  }

async function main(hostDirectory: string, packageName: string, namedAddresses: Array<{ name: string; address: string }>){
    await compilePackage(packageName, namedAddresses);

    const { packageMetadata, modulesCode } = getPackageData(`${hostDirectory}/${packageName}/output.json`);

  let supraClient = await SupraClient.init(
    "https://rpc-testnet.supra.com/"
  );

  let senderAccount = new SupraAccount(
    new HexString("PRIVATE_KEY").toUint8Array()
  );

  const publshTxn = await supraClient.publishPackage(senderAccount, packageMetadata, modulesCode)

  console.log(publshTxn);

}

main("C:/Users/Nolan/Documents/supra/supra_configs/move_workspace", "womp", [{name: "exampleAddress", address: "NAMED_ADDRESS_VALUE"}])