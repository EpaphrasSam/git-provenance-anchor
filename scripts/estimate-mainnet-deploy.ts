/**
 * Estimate AnchorRegistry deploy cost on funded mainnets (no broadcast).
 *
 *   npx ts-node --transpile-only scripts/estimate-mainnet-deploy.ts
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { Provider, Wallet, utils as zkUtils } from "zksync-ethers";

dotenv.config();

const REPO_ROOT = path.join(__dirname, "..");
const EVM_ARTIFACT = path.join(
  REPO_ROOT,
  "artifacts",
  "contracts",
  "AnchorRegistry.sol",
  "AnchorRegistry.json"
);
const ZK_ARTIFACT = path.join(
  REPO_ROOT,
  "artifacts-zk",
  "contracts",
  "AnchorRegistry.sol",
  "AnchorRegistry.json"
);

const EVM_NETS = [
  { name: "arbitrumOne", chainId: 42161, rpc: process.env.ARBITRUM_ONE_RPC_URL || "https://arb1.arbitrum.io/rpc" },
  { name: "opMainnet", chainId: 10, rpc: process.env.OP_MAINNET_RPC_URL || "https://mainnet.optimism.io" },
];

async function estimateEvm(
  name: string,
  chainId: number,
  rpc: string,
  key: string,
  bytecode: string
): Promise<void> {
  const provider = new ethers.JsonRpcProvider(rpc, chainId);
  const wallet = new ethers.Wallet(key, provider);
  const balance = await provider.getBalance(wallet.address);
  const fee = await provider.getFeeData();
  const gas = await provider.estimateGas({
    from: wallet.address,
    data: bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`,
  });
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
  const cost = gas * gasPrice;
  const ethUsd = 1900;
  console.log(
    `${name.padEnd(14)} bal=${ethers.formatEther(balance).padEnd(12)} gas=${gas.toString().padEnd(10)} ` +
      `gasPrice=${gasPrice.toString().padEnd(14)} costETH=${ethers.formatEther(cost).padEnd(18)} ` +
      `~$${(Number(ethers.formatEther(cost)) * ethUsd).toFixed(4)}`
  );
}

async function estimateZk(key: string): Promise<void> {
  if (!fs.existsSync(ZK_ARTIFACT)) {
    console.log("zkSyncEra     (skip — run npm run build:zk first, or compile --network zkSyncEra)");
    return;
  }
  const artifact = JSON.parse(fs.readFileSync(ZK_ARTIFACT, "utf8")) as {
    abi: unknown[];
    bytecode: string;
  };
  const rpc = process.env.ZKSYNC_ERA_RPC_URL || "https://mainnet.era.zksync.io";
  const provider = new Provider(rpc);
  const wallet = new Wallet(key, provider);
  const balance = await wallet.getBalance();
  const tx = {
    from: wallet.address,
    to: undefined as string | undefined,
    data: artifact.bytecode.startsWith("0x") ? artifact.bytecode : `0x${artifact.bytecode}`,
    value: 0n,
  };
  // zkSync estimate: use provider.estimateGas on deploy-like tx
  let gas: bigint;
  try {
    gas = await provider.estimateGas({ ...tx, type: 113 } as never);
  } catch {
    try {
      gas = await provider.estimateGas(tx as never);
    } catch (e) {
      console.log(`zkSyncEra     bal=${ethers.formatEther(balance)}  estimate failed: ${e instanceof Error ? e.message : e}`);
      return;
    }
  }
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice ?? 0n;
  const cost = gas * gasPrice;
  const ethUsd = 1900;
  console.log(
    `${"zkSyncEra".padEnd(14)} bal=${ethers.formatEther(balance).padEnd(12)} gas=${gas.toString().padEnd(10)} ` +
      `gasPrice=${gasPrice.toString().padEnd(14)} costETH=${ethers.formatEther(cost).padEnd(18)} ` +
      `~$${(Number(ethers.formatEther(cost)) * ethUsd).toFixed(4)} (EraVM units; fee model approximate)`
  );
  void zkUtils;
}

async function main(): Promise<void> {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) throw new Error("ANCHOR_DEPLOYER_KEY required");
  if (!fs.existsSync(EVM_ARTIFACT)) {
    throw new Error("Missing EVM artifact — run npm run build first");
  }
  const artifact = JSON.parse(fs.readFileSync(EVM_ARTIFACT, "utf8")) as { bytecode: string };
  console.log("Deploy estimates (no broadcast). ETH≈$1900 for rough USD only.\n");
  for (const n of EVM_NETS) {
    await estimateEvm(n.name, n.chainId, n.rpc, key, artifact.bytecode);
  }
  await estimateZk(key);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
