/**
 * Reconstructs what an anchor transaction would have cost, at intervals across a
 * historical window, on each mainnet the project targets.
 *
 * Why reconstruction rather than live sampling: a release anchor's gas units are
 * measured from real first-write receipts, while the gas price is a property of
 * the moment. Every historical gas price is still readable from block headers,
 * so the distribution can be recovered backwards instead of accumulated forwards.
 *
 * Broadcasts nothing, needs no funded account and no private key. Reads block
 * headers and existing transaction receipts only.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/fee-history.ts
 *   npx ts-node --transpile-only scripts/fee-history.ts --days 365 --interval 24
 *   npx ts-node --transpile-only scripts/fee-history.ts --end 2026-08-12T10:44:09Z
 *   npx ts-node --transpile-only scripts/fee-history.ts --days 30 --interval 6 --out fee-history-dense.json
 *
 * Flags:
 *   --days N        length of the lookback window in days (default 365)
 *   --interval H    hours between samples (default 24)
 *   --end ISO        pin the final target time (default current time)
 *   --delay MS      pause between RPC calls (default 120)
 *   --networks a,b  restrict to named networks
 *   --out FILE      filename under evaluation/data (default fee-history.json)
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { findRepoRoot, loadDeployments, rpcFor } from "../cli/src/lib/chain";

dotenv.config();

/**
 * Gas units observed in the v0.5.4 first-write mainnet release anchors, each with
 * a non-zero SBOM hash.
 */
const ANCHOR_GAS_UNITS: Record<string, number> = {
  arbitrumOne: 100048,
  opMainnet: 99524,
  zkSyncEra: 106722,
};

/** Approximate block times, used only to seed the search for a block. */
const APPROX_BLOCK_SECONDS: Record<string, number> = {
  arbitrumOne: 0.25,
  opMainnet: 2,
  zkSyncEra: 1,
  ethereum: 12,
};

/**
 * How each chain's receipt fee relates to the L1 data cost it ultimately pays.
 * Recorded in the output so the reconstruction is read with the right caveat
 * rather than being silently treated as identical across chains.
 */
const FEE_MODEL_NOTE: Record<string, string> = {
  arbitrumOne:
    "Nitro charges the L1 posting cost as additional gas units inside gasUsed, so gasUsed x effectiveGasPrice is the whole fee. Holding gas units fixed therefore understates cost when L1 posting is expensive: the real transaction would have burned more units, not just paid a higher price.",
  opMainnet:
    "OP Stack splits the fee: gasUsed x effectiveGasPrice covers L2 execution, and a separate l1Fee field on the receipt covers posting to L1. Analysis adds the observed 1,000,000 wei priority fee and 1,862,429,623 wei l1Fee. Historical variation in those fixed inputs is not reconstructed.",
  zkSyncEra:
    "EraVM prices execution and published data together through its own gas model, so gasUsed x effectiveGasPrice is the whole fee. Units are not comparable with the EVM chains.",
};

const ETHEREUM_RPC = process.env.ETHEREUM_RPC_URL || "https://ethereum.publicnode.com";

interface Sample {
  targetIso: string;
  blockNumber: number;
  blockIso: string;
  driftSeconds: number;
  baseFeePerGasWei: string | null;
  gasUsed?: string;
  gasLimit?: string;
  /** L1 only. Derived from excessBlobGas, so blob-driven spikes are visible. */
  blobBaseFeeWei?: string | null;
  excessBlobGas?: string | null;
}

interface NetworkResult {
  network: string;
  chainId?: number;
  rpc: string;
  anchorGasUnits?: number;
  feeModelNote?: string;
  requested: number;
  collected: number;
  failures: { targetIso: string; error: string }[];
  samples: Sample[];
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildTargets(days: number, intervalHours: number, endSeconds: number): number[] {
  const stepSeconds = Math.round(intervalHours * 3600);
  const sampleCount = Math.ceil((days * 24) / intervalHours);
  return Array.from(
    { length: sampleCount },
    (_, index) => endSeconds - (sampleCount - 1 - index) * stepSeconds,
  );
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await sleep(500 * (i + 1) * (i + 1));
    }
  }
  throw new Error(`${label}: ${(lastError as Error)?.message ?? String(lastError)}`);
}

/** EIP-4844 blob base fee, derived from a header's excessBlobGas. */
function blobBaseFeeFromExcess(excessBlobGas: bigint): bigint {
  const MIN = 1n;
  const UPDATE_FRACTION = 3338477n;
  // Faithful integer evaluation of MIN * e^(excess / UPDATE_FRACTION).
  let i = 1n;
  let output = 0n;
  let numeratorAccum = MIN * UPDATE_FRACTION;
  while (numeratorAccum > 0n) {
    output += numeratorAccum;
    numeratorAccum = (numeratorAccum * excessBlobGas) / (UPDATE_FRACTION * i);
    i += 1n;
  }
  return output / UPDATE_FRACTION;
}

interface RawBlock {
  number: string;
  timestamp: string;
  baseFeePerGas?: string;
  gasUsed?: string;
  gasLimit?: string;
  excessBlobGas?: string;
}

async function getBlock(provider: ethers.JsonRpcProvider, tag: string | number): Promise<RawBlock> {
  const param = typeof tag === "number" ? "0x" + tag.toString(16) : tag;
  const block = await provider.send("eth_getBlockByNumber", [param, false]);
  if (!block) throw new Error(`no block at ${param}`);
  return block as RawBlock;
}

/**
 * Finds a block near a target timestamp by estimating from the average block
 * time and correcting, rather than binary searching the whole chain. Arbitrum
 * produces blocks four times a second, so a full search would cost far more
 * calls than a public endpoint will tolerate.
 */
async function findBlockNearTimestamp(
  provider: ethers.JsonRpcProvider,
  targetSeconds: number,
  blockSeconds: number,
  latest: RawBlock,
  delayMs: number,
  toleranceSeconds = 300,
): Promise<RawBlock> {
  const latestNumber = Number(BigInt(latest.number));
  const latestTs = Number(BigInt(latest.timestamp));
  if (targetSeconds >= latestTs) return latest;

  let guess = latestNumber - Math.floor((latestTs - targetSeconds) / blockSeconds);
  guess = Math.max(1, Math.min(latestNumber, guess));

  let block = await getBlock(provider, guess);
  for (let probe = 0; probe < 8; probe++) {
    const ts = Number(BigInt(block.timestamp));
    const drift = ts - targetSeconds;
    if (Math.abs(drift) <= toleranceSeconds) return block;

    const step = Math.trunc(drift / blockSeconds);
    let next = Number(BigInt(block.number)) - (step === 0 ? (drift > 0 ? 1 : -1) : step);
    next = Math.max(1, Math.min(latestNumber, next));
    if (next === Number(BigInt(block.number))) return block;

    await sleep(delayMs);
    block = await getBlock(provider, next);
  }
  return block;
}

async function sampleNetwork(
  network: string,
  rpc: string,
  targets: number[],
  delayMs: number,
): Promise<NetworkResult> {
  const provider = new ethers.JsonRpcProvider(rpc);
  const result: NetworkResult = {
    network,
    rpc,
    anchorGasUnits: ANCHOR_GAS_UNITS[network],
    feeModelNote: FEE_MODEL_NOTE[network],
    requested: targets.length,
    collected: 0,
    failures: [],
    samples: [],
  };

  try {
    const net = await withRetry(`${network} chainId`, () => provider.getNetwork());
    result.chainId = Number(net.chainId);
  } catch {
    /* chain id is a convenience, not a requirement */
  }

  const latest = await withRetry(`${network} latest block`, () => getBlock(provider, "latest"));
  const blockSeconds = APPROX_BLOCK_SECONDS[network] ?? 2;

  for (const target of targets) {
    const targetIso = new Date(target * 1000).toISOString();
    try {
      const block = await findBlockNearTimestamp(provider, target, blockSeconds, latest, delayMs);
      const blockTs = Number(BigInt(block.timestamp));
      const sample: Sample = {
        targetIso,
        blockNumber: Number(BigInt(block.number)),
        blockIso: new Date(blockTs * 1000).toISOString(),
        driftSeconds: blockTs - target,
        baseFeePerGasWei: block.baseFeePerGas ? BigInt(block.baseFeePerGas).toString() : null,
        gasUsed: block.gasUsed ? BigInt(block.gasUsed).toString() : undefined,
        gasLimit: block.gasLimit ? BigInt(block.gasLimit).toString() : undefined,
      };
      if (block.excessBlobGas !== undefined) {
        const excess = BigInt(block.excessBlobGas);
        sample.excessBlobGas = excess.toString();
        sample.blobBaseFeeWei = blobBaseFeeFromExcess(excess).toString();
      }
      result.samples.push(sample);
      result.collected += 1;
    } catch (error) {
      result.failures.push({ targetIso, error: (error as Error).message });
    }
    await sleep(delayMs);
    if (result.samples.length % 25 === 0 && result.samples.length > 0) {
      process.stdout.write(`  ${network}: ${result.collected}/${targets.length}\n`);
    }
  }

  return result;
}

/**
 * Re-reads the Phase A transactions as raw receipts. ethers' convenience `fee`
 * omits the OP Stack l1Fee, so the raw JSON is what the validation step needs.
 */
async function collectReceipts(repoRoot: string, delayMs: number) {
  const phaseAPath = path.join(repoRoot, "evaluation", "data", "mainnet-phase-a.json");
  if (!fs.existsSync(phaseAPath)) return { note: "mainnet-phase-a.json not found", receipts: [] };

  const phaseA = JSON.parse(fs.readFileSync(phaseAPath, "utf8"));
  const receipts: Record<string, unknown>[] = [];

  for (const [network, entry] of Object.entries<any>(phaseA.networks ?? {})) {
    const provider = new ethers.JsonRpcProvider(rpcFor(network));
    for (const [label, tx] of Object.entries<any>(entry.txs ?? {})) {
      try {
        const raw = await provider.send("eth_getTransactionReceipt", [tx.hash]);
        const block = await getBlock(provider, Number(BigInt(raw.blockNumber)));
        receipts.push({
          network,
          label,
          hash: tx.hash,
          blockNumber: Number(BigInt(raw.blockNumber)),
          blockIso: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
          gasUsed: BigInt(raw.gasUsed).toString(),
          effectiveGasPrice: raw.effectiveGasPrice ? BigInt(raw.effectiveGasPrice).toString() : null,
          blockBaseFeePerGas: block.baseFeePerGas ? BigInt(block.baseFeePerGas).toString() : null,
          // OP Stack extras. Absent on other chains, which is itself informative.
          l1Fee: raw.l1Fee ? BigInt(raw.l1Fee).toString() : null,
          l1GasUsed: raw.l1GasUsed ? BigInt(raw.l1GasUsed).toString() : null,
          l1GasPrice: raw.l1GasPrice ? BigInt(raw.l1GasPrice).toString() : null,
          l1BlobBaseFee: raw.l1BlobBaseFee ? BigInt(raw.l1BlobBaseFee).toString() : null,
          // Arbitrum reports the L1 share of gasUsed here when present.
          gasUsedForL1: raw.gasUsedForL1 ? BigInt(raw.gasUsedForL1).toString() : null,
        });
      } catch (error) {
        receipts.push({ network, label, hash: tx.hash, error: (error as Error).message });
      }
      await sleep(delayMs);
    }
  }
  return { note: "raw receipts, including fields ethers' receipt.fee omits", receipts };
}

async function main() {
  const repoRoot = findRepoRoot();
  const days = Number(arg("days", "365"));
  const intervalHours = Number(arg("interval", "24"));
  const delayMs = Number(arg("delay", "120"));
  const outName = arg("out", "fee-history.json")!;
  const only = arg("networks");
  const endArg = arg("end");

  if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be greater than zero");
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    throw new Error("--interval must be greater than zero");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("--delay must not be negative");

  const deployments = loadDeployments(repoRoot);
  let networks = [...deployments.keys()].filter((n) => n in ANCHOR_GAS_UNITS);
  if (only) {
    const wanted = new Set(only.split(/[,\s]+/).filter(Boolean));
    networks = networks.filter((n) => wanted.has(n));
  }
  if (networks.length === 0) {
    throw new Error("No mainnet deployments found. Expected arbitrumOne, opMainnet or zkSyncEra.");
  }

  const endMillis = endArg === undefined ? Date.now() : Date.parse(endArg);
  if (!Number.isFinite(endMillis)) {
    throw new Error(`Invalid --end value: ${endArg}. Use an ISO-8601 timestamp.`);
  }
  const endSeconds = Math.floor(endMillis / 1000);
  const targets = buildTargets(days, intervalHours, endSeconds);

  console.log(
    `Reconstructing ${targets.length} sample points per network over ${days} days ` +
      `(every ${intervalHours}h) across: ${networks.join(", ")}, plus Ethereum L1.`,
  );
  console.log("Read-only. No transactions are sent and no key is used.\n");

  const results: NetworkResult[] = [];
  for (const network of networks) {
    console.log(`Sampling ${network} ...`);
    results.push(await sampleNetwork(network, rpcFor(network), targets, delayMs));
  }

  console.log("Sampling ethereum (L1 base fee and blob base fee) ...");
  const l1 = await sampleNetwork("ethereum", ETHEREUM_RPC, targets, delayMs);
  results.push(l1);

  console.log("Re-reading Phase A receipts for validation ...");
  const receipts = await collectReceipts(repoRoot, delayMs);

  const outPath = path.join(repoRoot, "evaluation", "data", outName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        method:
          "Release-anchor gas units are held at the values observed in the v0.5.4 first-write mainnet " +
          "receipts with non-zero SBOM hashes and priced at historical block base fees. Figures are " +
          "counterfactual: what a release anchor would have cost had it been submitted at that moment, " +
          "not a fee that was paid. Phase A no-SBOM receipts validate the fee arithmetic only.",
        window: {
          days,
          intervalHours,
          samplesPerNetwork: targets.length,
          end: new Date(endSeconds * 1000).toISOString(),
        },
        anchorGasUnits: ANCHOR_GAS_UNITS,
        anchorCalldataBytes: 228,
        feeModelNotes: FEE_MODEL_NOTE,
        networks: results,
        phaseAReceipts: receipts,
      },
      null,
      1,
    ) + "\n",
  );

  console.log(`\nWrote ${outPath}`);
  for (const r of results) {
    console.log(`  ${r.network}: ${r.collected}/${r.requested} samples, ${r.failures.length} failures`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
