/**
 * Send a slice of mainnet ETH from the deployer to the CI key on Arbitrum One,
 * OP Mainnet, and zkSync Era so GitHub Actions can submit live anchors.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/fund-ci-mainnet.ts
 *   npx ts-node --transpile-only scripts/fund-ci-mainnet.ts --amount 0.0004
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { Provider, Wallet } from "zksync-ethers";
import { rpcFor } from "../cli/src/lib/chain";

dotenv.config();

const CI_ADDRESS = "0x1318dA3655688daeFc4DA89ABAeDA33eA4A6e341";

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function sendEvm(
  network: string,
  chainId: number,
  key: string,
  to: string,
  amount: bigint
): Promise<void> {
  const provider = new ethers.JsonRpcProvider(rpcFor(network), chainId);
  const wallet = new ethers.Wallet(key, provider);
  const before = await provider.getBalance(to);
  const deployerBal = await provider.getBalance(wallet.address);
  console.log(`${network}`);
  console.log(`  from ${wallet.address} ${ethers.formatEther(deployerBal)} ETH`);
  console.log(`  to   ${to} ${ethers.formatEther(before)} ETH`);
  if (deployerBal < amount + ethers.parseEther("0.0002")) {
    throw new Error(`Deployer balance too low on ${network}`);
  }
  const tx = await wallet.sendTransaction({ to, value: amount });
  console.log(`  tx   ${tx.hash}`);
  await tx.wait();
  const after = await provider.getBalance(to);
  console.log(`  CI   ${ethers.formatEther(after)} ETH`);
}

async function sendZkSync(key: string, to: string, amount: bigint): Promise<void> {
  const provider = new Provider(rpcFor("zkSyncEra"));
  const wallet = new Wallet(key, provider);
  const before = await provider.getBalance(to);
  const deployerBal = await wallet.getBalance();
  console.log(`zkSyncEra`);
  console.log(`  from ${wallet.address} ${ethers.formatEther(deployerBal)} ETH`);
  console.log(`  to   ${to} ${ethers.formatEther(before)} ETH`);
  if (deployerBal < amount + ethers.parseEther("0.0002")) {
    throw new Error("Deployer balance too low on zkSync Era");
  }
  const tx = await wallet.sendTransaction({ to, value: amount });
  console.log(`  tx   ${tx.hash}`);
  await tx.wait();
  const after = await provider.getBalance(to);
  console.log(`  CI   ${ethers.formatEther(after)} ETH`);
}

async function main(): Promise<void> {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) throw new Error("ANCHOR_DEPLOYER_KEY is required");
  const ciKeyPath = path.join(__dirname, "..", ".ci-key");
  const to = fs.existsSync(ciKeyPath)
    ? new ethers.Wallet(fs.readFileSync(ciKeyPath, "utf8").trim()).address
    : CI_ADDRESS;
  if (to.toLowerCase() !== CI_ADDRESS.toLowerCase()) {
    throw new Error(`.ci-key address ${to} is not the allowlisted CI key`);
  }
  const amount = ethers.parseEther(argValue("--amount") ?? "0.0004");
  await sendEvm("arbitrumOne", 42161, key, to, amount);
  await sendEvm("opMainnet", 10, key, to, amount);
  await sendZkSync(key, to, amount);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
