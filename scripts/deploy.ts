import { ethers, network } from "hardhat";
import { AnchorRegistry__factory } from "../typechain-types";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");
const REPO_ROOT = path.join(__dirname, "..");

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function sourceState(): { sourceCommit: string | null; sourceClean: boolean | null } {
  try {
    const sourceCommit = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--", "contracts/").length > 0;
    return { sourceCommit, sourceClean: !dirty };
  } catch {
    return { sourceCommit: null, sourceClean: null };
  }
}

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

  const { sourceCommit, sourceClean } = sourceState();

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
    // Without these, nothing ties the deployed bytecode to a state of the repository.
    sourceCommit,
    sourceClean,
  };

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const outFile = path.join(DEPLOYMENTS_DIR, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n");

  console.log(`address      ${address}`);
  console.log(`block        ${record.blockNumber}`);
  console.log(`gas used     ${record.gasUsed}`);
  console.log(`source       ${sourceCommit ?? "unknown"}${sourceClean === false ? " (uncommitted changes in contracts/)" : ""}`);
  console.log(`recorded     ${path.relative(process.cwd(), outFile)}`);

  if (sourceClean === false) {
    console.warn(
      "warning: contracts/ had uncommitted changes, so sourceCommit does not fully describe this bytecode"
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
