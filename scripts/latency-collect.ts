/**
 * Repeated production-network latency observations for the supervisor revision.
 *
 * Timing probes use a dedicated project id so they cannot overwrite release
 * anchors. The deployer address is refused. Live writes require GPA_LATENCY_LIVE=true.
 *
 *   npx ts-node --transpile-only scripts/latency-collect.ts --mode dry-run
 *   npx ts-node --transpile-only scripts/latency-collect.ts --mode preflight
 *   npx ts-node --transpile-only scripts/latency-collect.ts --mode probe
 *   npx ts-node --transpile-only scripts/latency-collect.ts --mode collect
 *   npx ts-node --transpile-only scripts/latency-collect.ts --mode settle
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import {
  findRepoRoot,
  getReadContract,
  getWriteContract,
  KIND_SNAPSHOT,
  rpcFor,
} from "../cli/src/lib/chain";
import { treeHashToBytes32 } from "../cli/src/lib/git-tree";
import { submitWithNonceRetry } from "../cli/src/lib/nonce-retry";

dotenv.config();

export const CI_ADDRESS = "0x1318dA3655688daeFc4DA89ABAeDA33eA4A6e341";
export const DEPLOYER_ADDRESS = "0x52eaE29937b149B7a0f3D7516C81aD561B96c043";
export const LATENCY_LABEL = "gpa-latency-eval-2026";
export const LATENCY_NETWORKS = ["arbitrumOne", "opMainnet", "zkSyncEra"] as const;
export const DEFAULT_MAX_ETH_PER_RUN = "0.001";
export const DEFAULT_MAX_ETH_SERIES = "0.01";
export const DEFAULT_MAX_REVERTS = 2;
export const DEFAULT_SETTLE_WAIT_MS = 90_000;

const BLOCKSCOUT: Record<string, string> = {
  arbitrumOne: "https://arbitrum.blockscout.com/api/v2",
  opMainnet: "https://optimism.blockscout.com/api/v2",
};

export type LatencyMode = "dry-run" | "preflight" | "probe" | "collect" | "settle";
export type LatencyNetwork = (typeof LATENCY_NETWORKS)[number];

export interface LatencyObservation {
  id: string;
  mode: "probe" | "collect";
  network: string;
  ref: string;
  projectId: string;
  submitter: string;
  submittedAt: string;
  txHash: string | null;
  l2Block: number | null;
  l2BlockIso: string | null;
  inclusionSeconds: number | null;
  feeEth: string | null;
  gasUsed: string | null;
  l1PostedAt: string | null;
  secondsToL1DataAvailability: number | null;
  l1TxHash: string | null;
  zkCommittedAt: string | null;
  zkProvenAt: string | null;
  zkExecutedAt: string | null;
  status: "planned" | "included" | "reverted" | "skipped" | "error";
  detail: string | null;
}

export interface LatencyLedger {
  schemaVersion: 1;
  label: string;
  projectId: string;
  status: "not-started" | "armed" | "collecting" | "complete" | "stopped";
  caps: {
    maxEthPerRun: string;
    maxEthSeries: string;
    maxRevertsPerRun: number;
    plannedDays: number;
    txsPerNetworkPerWindow: number;
  };
  seriesSpentEth: string;
  setup: Array<{
    network: string;
    action: string;
    txHash: string;
    at: string;
    feeEth: string;
  }>;
  observations: LatencyObservation[];
}

export function experimentProjectId(label: string = LATENCY_LABEL): string {
  return ethers.id(label);
}

export function observationRef(at: Date): string {
  const iso = at.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `lat-${iso.replace(/[-:]/g, "")}`;
}

export function probeTreeHash(ref: string): string {
  return crypto.createHash("sha1").update(`gpa-latency-probe:${ref}`).digest("hex");
}

export function parseMode(raw: string | undefined): LatencyMode {
  const mode = (raw ?? "dry-run").toLowerCase();
  if (
    mode === "dry-run" ||
    mode === "preflight" ||
    mode === "probe" ||
    mode === "collect" ||
    mode === "settle"
  ) {
    return mode;
  }
  throw new Error("--mode must be dry-run, preflight, probe, collect, or settle");
}

export function liveWritesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.GPA_LATENCY_LIVE ?? "").trim().toLowerCase() === "true";
}

export function parseEthCap(raw: string | undefined, fallback: string): bigint {
  return ethers.parseEther(raw && raw.length > 0 ? raw : fallback);
}

export function spendWouldExceed(spentWei: bigint, nextWei: bigint, capWei: bigint): boolean {
  return spentWei + nextWei > capWei;
}

export function seriesWindowClosed(ledger: LatencyLedger, now: Date = new Date()): boolean {
  const first = ledger.observations.find((row) => row.status === "included" && row.submittedAt);
  if (!first?.submittedAt) return false;
  const elapsedMs = now.getTime() - Date.parse(first.submittedAt);
  return elapsedMs >= ledger.caps.plannedDays * 24 * 60 * 60 * 1000;
}

export function assertSignerAllowed(address: string): void {
  if (address.toLowerCase() === DEPLOYER_ADDRESS.toLowerCase()) {
    throw new Error("Refusing to sign latency probes with the registry deployer");
  }
}

export function ledgerPath(root: string): string {
  return path.join(root, "evaluation", "data", "latency-series.json");
}

export function emptyLedger(): LatencyLedger {
  return {
    schemaVersion: 1,
    label: LATENCY_LABEL,
    projectId: experimentProjectId(),
    status: "not-started",
    caps: {
      maxEthPerRun: DEFAULT_MAX_ETH_PER_RUN,
      maxEthSeries: DEFAULT_MAX_ETH_SERIES,
      maxRevertsPerRun: DEFAULT_MAX_REVERTS,
      plannedDays: 5,
      txsPerNetworkPerWindow: 1,
    },
    seriesSpentEth: "0",
    setup: [],
    observations: [],
  };
}

export function loadLedger(root: string): LatencyLedger {
  const file = ledgerPath(root);
  if (!fs.existsSync(file)) return emptyLedger();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as LatencyLedger;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported latency ledger schema ${parsed.schemaVersion}`);
  }
  return parsed;
}

export function saveLedger(root: string, ledger: LatencyLedger): void {
  const file = ledgerPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 1)}\n`, "utf8");
}

export function seriesSpentWei(ledger: LatencyLedger): bigint {
  let total = 0n;
  for (const row of ledger.setup) {
    total += ethers.parseEther(row.feeEth || "0");
  }
  for (const row of ledger.observations) {
    if (row.feeEth) total += ethers.parseEther(row.feeEth);
  }
  return total;
}

export function paidWeiFromRpcReceipt(raw: {
  gasUsed?: string;
  effectiveGasPrice?: string;
  gasPrice?: string;
  l1Fee?: string;
}): bigint {
  const gasUsed = BigInt(raw.gasUsed ?? "0");
  const price = BigInt(raw.effectiveGasPrice ?? raw.gasPrice ?? "0");
  const l1 = BigInt(raw.l1Fee ?? "0");
  return gasUsed * price + l1;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonGet(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "git-provenance-anchor-latency" },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function secondsBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000);
}

export async function fetchSettlement(
  network: string,
  txHash: string,
  l2Block: number | null,
  l2BlockIso: string | null
): Promise<Partial<LatencyObservation>> {
  if (network === "zkSyncEra") {
    if (l2Block == null) return {};
    const provider = new ethers.JsonRpcProvider(rpcFor(network), 324);
    const details = (await provider.send("zks_getBlockDetails", [l2Block])) as {
      commitTxHash?: string | null;
      committedAt?: string | null;
      proveTxHash?: string | null;
      provenAt?: string | null;
      executeTxHash?: string | null;
      executedAt?: string | null;
    } | null;
    if (!details) return {};
    const committed = isoOrNull(details.committedAt ?? undefined);
    return {
      l1TxHash: details.commitTxHash ?? null,
      l1PostedAt: committed,
      secondsToL1DataAvailability: secondsBetween(l2BlockIso, committed),
      zkCommittedAt: committed,
      zkProvenAt: isoOrNull(details.provenAt ?? undefined),
      zkExecutedAt: isoOrNull(details.executedAt ?? undefined),
    };
  }

  if (!txHash) return {};
  const base = BLOCKSCOUT[network];
  if (!base) return {};

  if (network === "arbitrumOne") {
    const body = await jsonGet(`${base}/transactions/${txHash}`);
    const commit = (
      body?.arbitrum as { commitment_transaction?: { hash?: string; timestamp?: string } } | undefined
    )?.commitment_transaction;
    const posted = isoOrNull(commit?.timestamp);
    return {
      l1TxHash: commit?.hash ?? null,
      l1PostedAt: posted,
      secondsToL1DataAvailability: secondsBetween(l2BlockIso, posted),
    };
  }

  if (network === "opMainnet") {
    if (l2Block == null) return {};
    const block = await jsonGet(`${base}/blocks/${l2Block}`);
    const optimism = block?.optimism as
      | { l1_timestamp?: string; l1_transaction_hashes?: string[] }
      | undefined;
    const posted = isoOrNull(optimism?.l1_timestamp);
    return {
      l1TxHash: optimism?.l1_transaction_hashes?.[0] ?? null,
      l1PostedAt: posted,
      secondsToL1DataAvailability: secondsBetween(l2BlockIso, posted),
    };
  }

  return {};
}

async function receiptFeeWei(
  provider: ethers.JsonRpcProvider,
  hash: string,
  receipt: ethers.TransactionReceipt
): Promise<bigint> {
  const raw = (await provider.send("eth_getTransactionReceipt", [hash])) as {
    gasUsed?: string;
    effectiveGasPrice?: string;
    gasPrice?: string;
    l1Fee?: string;
  };
  const fromRaw = paidWeiFromRpcReceipt(raw);
  if (fromRaw > 0n) return fromRaw;
  return receipt.fee;
}

async function checkAddress(
  network: LatencyNetwork,
  address: string,
  projectId: string
): Promise<{
  network: string;
  balanceEth: string;
  owner: string;
  registered: boolean;
  allowlisted: boolean;
  nonce: number;
  pendingNonce: number;
}> {
  const { contract, provider, deployment } = getReadContract(findRepoRoot(), network);
  void deployment;
  const [balance, project, nonce, pendingNonce] = await Promise.all([
    provider.getBalance(address),
    contract.getProject(projectId),
    provider.getTransactionCount(address, "latest"),
    provider.getTransactionCount(address, "pending"),
  ]);
  const owner = (project.owner ?? project[0]) as string;
  const registered = owner !== ethers.ZeroAddress;
  const allowlisted = registered ? Boolean(await contract.isAllowlisted(projectId, address)) : false;
  return {
    network,
    balanceEth: ethers.formatEther(balance),
    owner,
    registered,
    allowlisted,
    nonce,
    pendingNonce,
  };
}

async function ensureProject(
  root: string,
  ledger: LatencyLedger,
  network: LatencyNetwork,
  runCapLeft: { wei: bigint }
): Promise<void> {
  const projectId = experimentProjectId();
  const { contract, wallet, deployment } = await getWriteContract(root, network);
  assertSignerAllowed(wallet.address);
  const project = await contract.getProject(projectId);
  const owner = (project.owner ?? project[0]) as string;
  if (owner !== ethers.ZeroAddress) {
    const allowed = await contract.isAllowlisted(projectId, wallet.address);
    if (!allowed) {
      throw new Error(`${wallet.address} is not allowlisted for ${LATENCY_LABEL} on ${network}`);
    }
    console.log(`${network} project already registered @ ${deployment.address}`);
    return;
  }
  const gas = await contract.registerProject.estimateGas(projectId, LATENCY_LABEL);
  const feeData = await wallet.provider!.getFeeData();
  const worst = gas * (feeData.maxFeePerGas ?? feeData.gasPrice ?? 1n) * 3n;
  if (spendWouldExceed(0n, worst, runCapLeft.wei)) {
    throw new Error(`Registering on ${network} would exceed the per-run cap`);
  }
  console.log(`registering ${LATENCY_LABEL} on ${network} from ${wallet.address}`);
  const tx = await submitWithNonceRetry(
    () => wallet.getNonce("pending"),
    (nonce) => contract.registerProject(projectId, LATENCY_LABEL, { nonce })
  );
  const receipt = await tx.wait();
  if (!receipt) throw new Error(`No receipt for register on ${network}`);
  const feeWei = await receiptFeeWei(wallet.provider as ethers.JsonRpcProvider, receipt.hash, receipt);
  runCapLeft.wei -= feeWei;
  ledger.setup.push({
    network,
    action: "registerProject",
    txHash: receipt.hash,
    at: new Date().toISOString(),
    feeEth: ethers.formatEther(feeWei),
  });
  ledger.seriesSpentEth = ethers.formatEther(seriesSpentWei(ledger));
  saveLedger(root, ledger);
  console.log(`  tx=${receipt.hash} fee=${ethers.formatEther(feeWei)} ETH`);
}

async function submitProbe(
  root: string,
  ledger: LatencyLedger,
  network: LatencyNetwork,
  mode: "probe" | "collect",
  at: Date,
  runSpent: { wei: bigint },
  runCap: bigint,
  revertCount: { n: number },
  settleWaitMs: number
): Promise<LatencyObservation> {
  const projectId = experimentProjectId();
  const ref = observationRef(at);
  const tree = probeTreeHash(`${network}:${ref}`);
  const id = `${ref}-${network}`;
  const observation: LatencyObservation = {
    id,
    mode,
    network,
    ref,
    projectId,
    submitter: "",
    submittedAt: new Date().toISOString(),
    txHash: null,
    l2Block: null,
    l2BlockIso: null,
    inclusionSeconds: null,
    feeEth: null,
    gasUsed: null,
    l1PostedAt: null,
    secondsToL1DataAvailability: null,
    l1TxHash: null,
    zkCommittedAt: null,
    zkProvenAt: null,
    zkExecutedAt: null,
    status: "planned",
    detail: null,
  };

  const { contract, wallet, deployment } = await getWriteContract(root, network);
  assertSignerAllowed(wallet.address);
  observation.submitter = wallet.address;
  const allowed = await contract.isAllowlisted(projectId, wallet.address);
  if (!allowed) {
    observation.status = "error";
    observation.detail = `${wallet.address} is not allowlisted on ${network} @ ${deployment.address}`;
    return observation;
  }

  const treeBytes32 = treeHashToBytes32(tree);
  const t0 = Date.now();
  const gas = await contract.anchor.estimateGas(
    projectId,
    KIND_SNAPSHOT,
    ref,
    treeBytes32,
    ethers.ZeroHash
  );
  const feeData = await wallet.provider!.getFeeData();
  const predicted = gas * (feeData.maxFeePerGas ?? feeData.gasPrice ?? 1n) * 3n;
  if (spendWouldExceed(runSpent.wei, predicted, runCap)) {
    observation.status = "skipped";
    observation.detail = "per-run cap";
    return observation;
  }
  if (spendWouldExceed(seriesSpentWei(ledger), predicted, parseEthCap(ledger.caps.maxEthSeries, DEFAULT_MAX_ETH_SERIES))) {
    observation.status = "skipped";
    observation.detail = "series cap";
    return observation;
  }

  try {
    const tx = await submitWithNonceRetry(
      () => wallet.getNonce("pending"),
      (nonce) =>
        contract.anchor(projectId, KIND_SNAPSHOT, ref, treeBytes32, ethers.ZeroHash, { nonce })
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error("missing receipt");
    if (receipt.status === 0) {
      revertCount.n += 1;
      observation.status = "reverted";
      observation.txHash = receipt.hash;
      observation.detail = "status=0";
      return observation;
    }
    const provider = wallet.provider as ethers.JsonRpcProvider;
    const block = await provider.getBlock(receipt.blockNumber);
    const feeWei = await receiptFeeWei(provider, receipt.hash, receipt);
    runSpent.wei += feeWei;
    observation.txHash = receipt.hash;
    observation.l2Block = receipt.blockNumber;
    observation.l2BlockIso = block ? new Date(block.timestamp * 1000).toISOString() : null;
    observation.inclusionSeconds = (Date.now() - t0) / 1000;
    observation.feeEth = ethers.formatEther(feeWei);
    observation.gasUsed = receipt.gasUsed.toString();
    observation.status = "included";
    observation.submittedAt = new Date(t0).toISOString();

    const deadline = Date.now() + settleWaitMs;
    while (Date.now() < deadline && !observation.l1PostedAt) {
      const settlement = await fetchSettlement(
        network,
        receipt.hash,
        receipt.blockNumber,
        observation.l2BlockIso
      );
      Object.assign(observation, settlement);
      if (observation.l1PostedAt) break;
      await sleep(15_000);
    }
    return observation;
  } catch (err) {
    revertCount.n += 1;
    observation.status = "error";
    observation.detail = err instanceof Error ? err.message : String(err);
    return observation;
  }
}

async function runPreflight(root: string): Promise<number> {
  const projectId = experimentProjectId();
  const realProjectId =
    JSON.parse(fs.readFileSync(path.join(root, ".provenance-manifest.json"), "utf8")).projectId as string;
  console.log(`label     ${LATENCY_LABEL}`);
  console.log(`projectId ${projectId}`);
  console.log(`signer    ${CI_ADDRESS}`);
  console.log(`deployer  ${DEPLOYER_ADDRESS} (refused)`);
  console.log(`live      ${liveWritesEnabled()}`);
  console.log(`per-run   ${DEFAULT_MAX_ETH_PER_RUN} ETH`);
  console.log(`series    ${DEFAULT_MAX_ETH_SERIES} ETH`);
  let failed = 0;
  for (const network of LATENCY_NETWORKS) {
    const row = await checkAddress(network, CI_ADDRESS, projectId);
    const real = await checkAddress(network, CI_ADDRESS, realProjectId);
    const realOwner = real.owner.toLowerCase() === CI_ADDRESS.toLowerCase();
    console.log(
      `${network.padEnd(14)} balance=${row.balanceEth} ETH  registered=${row.registered} allowlisted=${row.allowlisted} nonce=${row.nonce}/${row.pendingNonce} realProjectOwner=${realOwner}`
    );
    if (realOwner) {
      console.error(`${network}: CI key owns the production project; abort`);
      failed += 1;
    }
    if (row.pendingNonce !== row.nonce) {
      console.error(`${network}: pending nonce gap ${row.nonce} -> ${row.pendingNonce}`);
      failed += 1;
    }
    if (ethers.parseEther(row.balanceEth) === 0n) {
      console.error(`${network}: CI wallet has zero balance`);
      failed += 1;
    }
  }
  const ledger = loadLedger(root);
  console.log(`spent     ${ethers.formatEther(seriesSpentWei(ledger))} ETH`);
  console.log(`obs       ${ledger.observations.length}`);
  return failed;
}

async function runDryRun(root: string): Promise<void> {
  const at = new Date();
  const ref = observationRef(at);
  const projectId = experimentProjectId();
  console.log(`mode      dry-run (no broadcast)`);
  console.log(`projectId ${projectId}`);
  console.log(`ref       ${ref}`);
  console.log(`networks  ${LATENCY_NETWORKS.join(", ")}`);
  console.log(`tree      ${probeTreeHash(`${LATENCY_NETWORKS[0]}:${ref}`)}`);
  console.log(`caps      ${DEFAULT_MAX_ETH_PER_RUN} ETH/run, ${DEFAULT_MAX_ETH_SERIES} ETH/series`);
  const ledger = loadLedger(root);
  if (ledger.observations.length === 0 && ledger.status === "not-started") {
    const fresh = emptyLedger();
    saveLedger(root, fresh);
  }
  for (const network of LATENCY_NETWORKS) {
    const { contract, deployment } = getReadContract(root, network);
    const project = await contract.getProject(projectId);
    const owner = (project.owner ?? project[0]) as string;
    console.log(
      `${network} registry=${deployment.address} owner=${owner === ethers.ZeroAddress ? "unregistered" : owner}`
    );
  }
}

async function runLive(root: string, mode: "probe" | "collect"): Promise<number> {
  if (!liveWritesEnabled()) {
    console.log("GPA_LATENCY_LIVE is not true; refusing to broadcast");
    return 0;
  }
  const ledger = loadLedger(root);
  const runCap = parseEthCap(process.env.LATENCY_MAX_ETH_PER_RUN, ledger.caps.maxEthPerRun);
  const seriesCap = parseEthCap(process.env.LATENCY_MAX_ETH_SERIES, ledger.caps.maxEthSeries);
  if (seriesSpentWei(ledger) >= seriesCap) {
    ledger.status = "stopped";
    saveLedger(root, ledger);
    console.log("series cap already reached");
    return 0;
  }
  if (mode === "collect" && seriesWindowClosed(ledger, new Date())) {
    ledger.status = "complete";
    saveLedger(root, ledger);
    console.log(`planned ${ledger.caps.plannedDays}-day window is closed`);
    return 0;
  }
  const settleWaitMs = Number(process.env.LATENCY_SETTLE_WAIT_MS ?? DEFAULT_SETTLE_WAIT_MS);
  const at = new Date();
  const runSpent = { wei: 0n };
  const runCapLeft = { wei: runCap };
  const revertCount = { n: 0 };
  ledger.status = "collecting";
  saveLedger(root, ledger);

  for (const network of LATENCY_NETWORKS) {
    await ensureProject(root, ledger, network, runCapLeft);
  }
  runSpent.wei = runCap - runCapLeft.wei;

  for (const network of LATENCY_NETWORKS) {
    if (revertCount.n >= ledger.caps.maxRevertsPerRun) {
      console.log("revert limit reached; stopping this run");
      break;
    }
    const observation = await submitProbe(
      root,
      ledger,
      network,
      mode,
      at,
      runSpent,
      runCap,
      revertCount,
      settleWaitMs
    );
    ledger.observations.push(observation);
    ledger.seriesSpentEth = ethers.formatEther(seriesSpentWei(ledger));
    saveLedger(root, ledger);
    const l1 =
      observation.secondsToL1DataAvailability == null
        ? "pending"
        : `${observation.secondsToL1DataAvailability}s`;
    console.log(
      `${network} ${observation.status} tx=${observation.txHash ?? "-"} inclusion=${observation.inclusionSeconds ?? "-"}s l1=${l1} fee=${observation.feeEth ?? "-"} ETH`
    );
    if (observation.detail) console.log(`  ${observation.detail}`);
  }
  return 0;
}

async function runSettle(root: string): Promise<void> {
  const ledger = loadLedger(root);
  let changed = 0;
  for (const observation of ledger.observations) {
    if (observation.status !== "included" || !observation.txHash) continue;
    if (observation.l1PostedAt && (observation.network !== "zkSyncEra" || observation.zkExecutedAt)) {
      continue;
    }
    const settlement = await fetchSettlement(
      observation.network,
      observation.txHash,
      observation.l2Block,
      observation.l2BlockIso
    );
    const before = JSON.stringify(observation);
    Object.assign(observation, settlement);
    if (JSON.stringify(observation) !== before) changed += 1;
  }
  saveLedger(root, ledger);
  console.log(`updated ${changed} observation(s)`);
}

async function main(): Promise<void> {
  const root = findRepoRoot(path.resolve(__dirname, ".."));
  const mode = parseMode(argValue("--mode"));
  if (mode === "dry-run") {
    await runDryRun(root);
    return;
  }
  if (mode === "preflight") {
    const failed = await runPreflight(root);
    if (failed > 0) process.exitCode = 1;
    return;
  }
  if (mode === "settle") {
    await runSettle(root);
    return;
  }
  await runLive(root, mode);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
