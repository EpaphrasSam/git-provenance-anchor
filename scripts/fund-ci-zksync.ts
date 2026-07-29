/**
 * Send a small amount of zkSync Sepolia ETH from the deployer to the CI key.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/fund-ci-zksync.ts
 *   npx ts-node --transpile-only scripts/fund-ci-zksync.ts --amount 0.002
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { Provider, Wallet } from "zksync-ethers";

dotenv.config();

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) throw new Error("ANCHOR_DEPLOYER_KEY is required");

  const ciKeyPath = path.join(__dirname, "..", ".ci-key");
  if (!fs.existsSync(ciKeyPath)) throw new Error(".ci-key not found");
  const ciAddress = new ethers.Wallet(fs.readFileSync(ciKeyPath, "utf8").trim()).address;
  const amount = ethers.parseEther(argValue("--amount") ?? "0.002");

  const provider = new Provider(process.env.ZKSYNC_SEPOLIA_RPC_URL || "https://sepolia.era.zksync.dev");
  const wallet = new Wallet(key, provider);
  const before = await provider.getBalance(ciAddress);
  const deployerBal = await wallet.getBalance();

  console.log(`from       ${wallet.address} (${ethers.formatEther(deployerBal)} ETH)`);
  console.log(`to         ${ciAddress} (${ethers.formatEther(before)} ETH)`);
  console.log(`sending    ${ethers.formatEther(amount)} ETH`);

  if (deployerBal < amount + ethers.parseEther("0.0005")) {
    throw new Error("Deployer balance too low on zkSync");
  }

  const tx = await wallet.sendTransaction({ to: ciAddress, value: amount });
  console.log(`tx         ${tx.hash}`);
  await tx.wait();
  const after = await provider.getBalance(ciAddress);
  console.log(`CI after   ${ethers.formatEther(after)} ETH`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
