/**
 * Deploy AnchorRegistry to zkSync Era (testnet or mainnet) without
 * hardhat-zksync-deploy's linker. That linker breaks on Windows paths containing
 * spaces; this contract has no factory dependencies, so ContractFactory is enough.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/deploy-zksync.ts --network zkSyncSepolia
 *   npx ts-node --transpile-only scripts/deploy-zksync.ts --network zkSyncEra
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { ContractFactory, Provider, Wallet } from "zksync-ethers";

dotenv.config();

const REPO_ROOT = path.join(__dirname, "..");
const DEPLOYMENTS_DIR = path.join(REPO_ROOT, "deployments");
const ARTIFACT = path.join(
  REPO_ROOT,
  "artifacts-zk",
  "contracts",
  "AnchorRegistry.sol",
  "AnchorRegistry.json"
);

const NETWORKS: Record<
  string,
  { chainId: number; rpcEnv: string; defaultRpc: string; compileNetwork: string }
> = {
  zkSyncSepolia: {
    chainId: 300,
    rpcEnv: "ZKSYNC_SEPOLIA_RPC_URL",
    defaultRpc: "https://sepolia.era.zksync.dev",
    compileNetwork: "zkSyncSepolia",
  },
  zkSyncEra: {
    chainId: 324,
    rpcEnv: "ZKSYNC_ERA_RPC_URL",
    defaultRpc: "https://mainnet.era.zksync.io",
    compileNetwork: "zkSyncEra",
  },
};

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

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

async function main(): Promise<void> {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) throw new Error("ANCHOR_DEPLOYER_KEY is required");

  const networkName = argValue("--network") ?? "zkSyncSepolia";
  const cfg = NETWORKS[networkName];
  if (!cfg) {
    throw new Error(`Unsupported network "${networkName}". Use: ${Object.keys(NETWORKS).join(", ")}`);
  }

  if (!fs.existsSync(ARTIFACT)) {
    console.log(`compiling for ${cfg.compileNetwork}...`);
    execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["hardhat", "compile", "--network", cfg.compileNetwork, "--force", "--no-typechain"],
      { cwd: REPO_ROOT, stdio: "inherit", env: process.env }
    );
  }

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, "utf8")) as {
    abi: unknown[];
    bytecode: string;
    factoryDeps?: Record<string, string>;
  };

  const deps = Object.keys(artifact.factoryDeps ?? {});
  if (deps.length > 0) {
    throw new Error(
      `AnchorRegistry unexpectedly has factoryDeps (${deps.join(", ")}); use hardhat-zksync-deploy`
    );
  }

  const rpc = process.env[cfg.rpcEnv] || cfg.defaultRpc;
  const provider = new Provider(rpc);
  const wallet = new Wallet(key, provider);
  const balance = await wallet.getBalance();
  const net = await provider.getNetwork();

  console.log(`network      ${networkName} (chainId ${cfg.chainId}, rpc reports ${net.chainId})`);
  console.log(`deployer     ${wallet.address}`);
  console.log(`balance      ${ethers.formatEther(balance)} ETH`);

  if (Number(net.chainId) !== cfg.chainId) {
    throw new Error(`RPC chainId mismatch: expected ${cfg.chainId}, got ${net.chainId}`);
  }

  if (balance === 0n) {
    throw new Error(`Deployer has no balance on ${networkName}`);
  }

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log("deploying...");
  const registry = await factory.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const tx = registry.deploymentTransaction();
  if (!tx) throw new Error("missing deployment transaction");
  const receipt = await tx.wait();
  const { sourceCommit, sourceClean } = sourceState();

  const record = {
    contract: "AnchorRegistry",
    address,
    network: networkName,
    chainId: cfg.chainId,
    deployer: wallet.address,
    transactionHash: tx.hash,
    blockNumber: receipt?.blockNumber ?? null,
    gasUsed: receipt?.gasUsed?.toString() ?? null,
    solcVersion: "0.8.28",
    zksolcVersion: "1.5.15",
    optimizer: { enabled: true, runs: 200 },
    deployedAt: new Date().toISOString(),
    sourceCommit,
    sourceClean,
    vm: "eraVM",
  };

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const outFile = path.join(DEPLOYMENTS_DIR, `${networkName}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`address      ${address}`);
  console.log(`tx           ${tx.hash}`);
  console.log(`block        ${record.blockNumber}`);
  console.log(`gas used     ${record.gasUsed}`);
  console.log(
    `source       ${sourceCommit ?? "unknown"}${
      sourceClean === false ? " (uncommitted changes in contracts/)" : ""
    }`
  );
  console.log(`recorded     ${path.relative(process.cwd(), outFile)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
