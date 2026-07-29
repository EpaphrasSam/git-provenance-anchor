import { ethers, network } from "hardhat";
import { AnchorRegistry__factory } from "../typechain-types";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      `No signer available for network "${network.name}". Set ANCHOR_DEPLOYER_KEY in .env.`
    );
  }

  const chain = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`network      ${network.name} (chainId ${chain.chainId})`);
  console.log(`deployer     ${deployer.address}`);
  console.log(`balance      ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error("Deployer has no balance; fund the account before deploying.");
  }

  const registry = await new AnchorRegistry__factory(deployer).deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const tx = registry.deploymentTransaction();
  const receipt = tx ? await tx.wait() : null;

  const record = {
    contract: "AnchorRegistry",
    address,
    network: network.name,
    chainId: Number(chain.chainId),
    deployer: deployer.address,
    transactionHash: tx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    gasUsed: receipt?.gasUsed.toString() ?? null,
    // Recorded because the same source under different settings yields different bytecode.
    solcVersion: "0.8.28",
    optimizer: { enabled: true, runs: 200 },
    deployedAt: new Date().toISOString(),
  };

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const outFile = path.join(DEPLOYMENTS_DIR, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n");

  console.log(`address      ${address}`);
  console.log(`block        ${record.blockNumber}`);
  console.log(`gas used     ${record.gasUsed}`);
  console.log(`recorded     ${path.relative(process.cwd(), outFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
