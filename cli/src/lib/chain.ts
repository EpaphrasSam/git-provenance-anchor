import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

export interface DeploymentRecord {
  contract: string;
  address: string;
  network: string;
  chainId: number;
  deployer: string;
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  solcVersion: string;
  zksolcVersion?: string;
  optimizer: { enabled: boolean; runs: number };
  deployedAt: string;
  sourceCommit?: string;
  sourceClean?: boolean;
  vm?: "evm" | "eraVM";
}

export interface NetworkEndpoints {
  [network: string]: { chainId: number; rpcUrl: string };
}

const DEFAULT_RPC: NetworkEndpoints = {
  arbitrumSepolia: {
    chainId: 421614,
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
  },
  opSepolia: {
    chainId: 11155420,
    rpcUrl: process.env.OP_SEPOLIA_RPC_URL || "https://sepolia.optimism.io",
  },
  zkSyncSepolia: {
    chainId: 300,
    rpcUrl: process.env.ZKSYNC_SEPOLIA_RPC_URL || "https://sepolia.era.zksync.dev",
  },
  arbitrumOne: {
    chainId: 42161,
    rpcUrl: process.env.ARBITRUM_ONE_RPC_URL || "https://arb1.arbitrum.io/rpc",
  },
  opMainnet: {
    chainId: 10,
    rpcUrl: process.env.OP_MAINNET_RPC_URL || "https://mainnet.optimism.io",
  },
  zkSyncEra: {
    chainId: 324,
    rpcUrl: process.env.ZKSYNC_ERA_RPC_URL || "https://mainnet.era.zksync.io",
  },
};

export const KIND_TAG = 0;
export const KIND_SNAPSHOT = 1;

export const ANCHOR_REGISTRY_ABI = [
  "function registerProject(bytes32 projectId, string label)",
  "function anchor(bytes32 projectId, uint8 kind, string ref, bytes32 treeHash, bytes32 sbomHash)",
  "function allowlistAdd(bytes32 projectId, address account)",
  "function allowlistRemove(bytes32 projectId, address account)",
  "function transferOwnership(bytes32 projectId, address newOwner)",
  "function getAnchor(bytes32 projectId, uint8 kind, string ref) view returns (tuple(bytes32 treeHash, bytes32 sbomHash, uint64 timestamp, address submitter, uint32 revision))",
  "function getProject(bytes32 projectId) view returns (address owner, string label)",
  "function isAllowlisted(bytes32 projectId, address account) view returns (bool)",
  "function anchorKey(bytes32 projectId, uint8 kind, string ref) pure returns (bytes32)",
  "event AnchorSubmitted(bytes32 indexed projectId, uint8 indexed kind, string ref, bytes32 treeHash, bytes32 sbomHash, address submitter, uint32 revision)",
  "event ProjectRegistered(bytes32 indexed projectId, address indexed owner, string label)",
  "error ProjectIdZero()",
  "error ProjectAlreadyRegistered(bytes32 projectId)",
  "error ProjectNotRegistered(bytes32 projectId)",
  "error NotProjectOwner(bytes32 projectId, address caller)",
  "error NotAllowlisted(bytes32 projectId, address caller)",
  "error UnknownKind(uint8 kind)",
  "error TreeHashZero()",
  "error EmptyRef()",
  "error ZeroAddress()",
] as const;

export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "deployments")) && fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".provenance-manifest.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function loadDeployments(repoRoot: string): Map<string, DeploymentRecord> {
  const dir = path.join(repoRoot, "deployments");
  const map = new Map<string, DeploymentRecord>();
  if (!fs.existsSync(dir)) return map;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as DeploymentRecord;
    if (record.network === "hardhat") continue;
    map.set(record.network, record);
  }
  return map;
}

export function rpcFor(network: string): string {
  const envKey = `${network.replace(/([A-Z])/g, "_$1").toUpperCase()}_RPC_URL`;
  if (network === "arbitrumSepolia" && process.env.ARBITRUM_SEPOLIA_RPC_URL) {
    return process.env.ARBITRUM_SEPOLIA_RPC_URL;
  }
  if (network === "opSepolia" && process.env.OP_SEPOLIA_RPC_URL) {
    return process.env.OP_SEPOLIA_RPC_URL;
  }
  if (network === "zkSyncSepolia" && process.env.ZKSYNC_SEPOLIA_RPC_URL) {
    return process.env.ZKSYNC_SEPOLIA_RPC_URL;
  }
  if (network === "arbitrumOne" && process.env.ARBITRUM_ONE_RPC_URL) {
    return process.env.ARBITRUM_ONE_RPC_URL;
  }
  if (network === "opMainnet" && process.env.OP_MAINNET_RPC_URL) {
    return process.env.OP_MAINNET_RPC_URL;
  }
  if (network === "zkSyncEra" && process.env.ZKSYNC_ERA_RPC_URL) {
    return process.env.ZKSYNC_ERA_RPC_URL;
  }
  if (process.env[envKey]) return process.env[envKey]!;
  const fallback = DEFAULT_RPC[network];
  if (!fallback) {
    throw new Error(`No RPC URL configured for network ${network}`);
  }
  return fallback.rpcUrl;
}

export function getReadContract(repoRoot: string, network: string): {
  contract: ethers.Contract;
  provider: ethers.JsonRpcProvider;
  deployment: DeploymentRecord;
} {
  const deployments = loadDeployments(repoRoot);
  const deployment = deployments.get(network);
  if (!deployment) {
    throw new Error(`No deployment record for ${network} under deployments/`);
  }
  const provider = new ethers.JsonRpcProvider(rpcFor(network), deployment.chainId);
  const contract = new ethers.Contract(deployment.address, ANCHOR_REGISTRY_ABI, provider);
  return { contract, provider, deployment };
}

export async function getWriteContract(repoRoot: string, network: string): Promise<{
  contract: ethers.Contract;
  wallet: ethers.Wallet;
  deployment: DeploymentRecord;
}> {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) {
    throw new Error("ANCHOR_DEPLOYER_KEY is required for write commands");
  }
  const { provider, deployment } = getReadContract(repoRoot, network);
  await provider.getNetwork();
  const signer = new ethers.Wallet(key, provider);
  const wallet = new ethers.NonceManager(signer);
  await wallet.getNonce("pending");
  const contract = new ethers.Contract(deployment.address, ANCHOR_REGISTRY_ABI, wallet);
  return { contract, wallet: wallet as unknown as ethers.Wallet, deployment };
}

export interface AnchorView {
  treeHash: string;
  sbomHash: string;
  timestamp: bigint;
  submitter: string;
  revision: number;
  present: boolean;
}

export function parseAnchor(raw: {
  treeHash: string;
  sbomHash: string;
  timestamp: bigint;
  submitter: string;
  revision: bigint | number;
}): AnchorView {
  const revision = Number(raw.revision);
  const present = raw.treeHash !== ethers.ZeroHash && revision > 0;
  return {
    treeHash: raw.treeHash,
    sbomHash: raw.sbomHash,
    timestamp: raw.timestamp,
    submitter: raw.submitter,
    revision,
    present,
  };
}

export async function fetchAnchor(
  repoRoot: string,
  network: string,
  projectId: string,
  kind: number,
  ref: string
): Promise<AnchorView & { address: string; chainId: number }> {
  const { contract, deployment } = getReadContract(repoRoot, network);
  const raw = await contract.getAnchor(projectId, kind, ref);
  return {
    ...parseAnchor(raw),
    address: deployment.address,
    chainId: deployment.chainId,
  };
}

export interface ListedAnchor {
  network: string;
  kind: number;
  ref: string;
  treeHash: string;
  sbomHash: string;
  submitter: string;
  revision: number;
  blockNumber: number;
  transactionHash: string;
}

export async function listAnchorsFromEvents(
  repoRoot: string,
  network: string,
  projectId: string,
  fromBlock?: number
): Promise<ListedAnchor[]> {
  const { contract, provider, deployment } = getReadContract(repoRoot, network);
  const start = fromBlock ?? Math.max(0, deployment.blockNumber);
  const latest = await provider.getBlockNumber();
  const filter = contract.filters.AnchorSubmitted(projectId);
  const chunk = 50_000;
  const out: ListedAnchor[] = [];
  for (let from = start; from <= latest; from += chunk) {
    const to = Math.min(from + chunk - 1, latest);
    let logs: ethers.Log[];
    try {
      logs = await contract.queryFilter(filter, from, to);
    } catch {
      const small = 5_000;
      for (let s = from; s <= to; s += small) {
        const e = Math.min(s + small - 1, to);
        const part = await contract.queryFilter(filter, s, e);
        for (const log of part) {
          out.push(decodeAnchorLog(network, log));
        }
      }
      continue;
    }
    for (const log of logs) {
      out.push(decodeAnchorLog(network, log));
    }
  }
  return out;
}

function decodeAnchorLog(network: string, log: ethers.Log | ethers.EventLog): ListedAnchor {
  const ev = log as ethers.EventLog;
  const args = ev.args;
  return {
    network,
    kind: Number(args.kind),
    ref: args.ref as string,
    treeHash: args.treeHash as string,
    sbomHash: args.sbomHash as string,
    submitter: args.submitter as string,
    revision: Number(args.revision),
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
  };
}

/** Latest revision per (kind, ref) from an event list. */
export function latestAnchors(events: ListedAnchor[]): ListedAnchor[] {
  const map = new Map<string, ListedAnchor>();
  for (const ev of events) {
    const key = `${ev.kind}:${ev.ref}`;
    const prev = map.get(key);
    if (!prev || ev.revision >= prev.revision) {
      map.set(key, ev);
    }
  }
  return [...map.values()].sort((a, b) => a.ref.localeCompare(b.ref) || a.kind - b.kind);
}
