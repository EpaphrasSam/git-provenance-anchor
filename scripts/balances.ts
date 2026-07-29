/**
 * Reports the funding account's balance and current fee data on every configured
 * deployment. Used before broadcasting validation transactions.
 */
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { findRepoRoot, loadDeployments, rpcFor } from "../cli/src/lib/chain";

dotenv.config();

async function main(): Promise<void> {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) throw new Error("ANCHOR_DEPLOYER_KEY is required");

  const root = findRepoRoot(path.resolve(__dirname, ".."));
  const wallet = new ethers.Wallet(key);
  console.log(`account ${wallet.address}`);

  for (const [network, deployment] of loadDeployments(root)) {
    const provider = new ethers.JsonRpcProvider(rpcFor(network), deployment.chainId);
    const balance = await provider.getBalance(wallet.address);
    const fee = await provider.getFeeData();
    console.log(
      `${network.padEnd(18)} ${ethers.formatEther(balance).padEnd(22)} ETH  gasPrice=${fee.gasPrice?.toString() ?? "n/a"}`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
