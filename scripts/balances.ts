/**
 * Reports the funding account's balance and current fee data on every known
 * target network, whether or not a deployment record exists yet.
 */
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { findRepoRoot, loadDeployments, rpcFor } from "../cli/src/lib/chain";

dotenv.config();

const KNOWN: Array<{ network: string; chainId: number }> = [
  { network: "arbitrumSepolia", chainId: 421614 },
  { network: "opSepolia", chainId: 11155420 },
  { network: "zkSyncSepolia", chainId: 300 },
  { network: "arbitrumOne", chainId: 42161 },
  { network: "opMainnet", chainId: 10 },
  { network: "zkSyncEra", chainId: 324 },
];

async function main(): Promise<void> {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) throw new Error("ANCHOR_DEPLOYER_KEY is required");

  const root = findRepoRoot(path.resolve(__dirname, ".."));
  const deployments = loadDeployments(root);
  const wallet = new ethers.Wallet(key);
  console.log(`account ${wallet.address}`);

  for (const { network, chainId } of KNOWN) {
    const provider = new ethers.JsonRpcProvider(rpcFor(network), chainId);
    const balance = await provider.getBalance(wallet.address);
    const fee = await provider.getFeeData();
    const deployed = deployments.has(network) ? "deployed" : "no deployment";
    console.log(
      `${network.padEnd(18)} ${ethers.formatEther(balance).padEnd(22)} ETH  gasPrice=${fee.gasPrice?.toString() ?? "n/a"}  (${deployed})`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
