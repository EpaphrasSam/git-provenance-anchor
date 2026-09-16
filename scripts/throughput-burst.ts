/**
 * Bounded production throughput burst: sequential snapshot anchors on the three
 * L2s, using the latency experiment project and the CI key.
 *
 *   npx ts-node --transpile-only scripts/throughput-burst.ts --dry-run
 *   npx ts-node --transpile-only scripts/throughput-burst.ts --send --count 10
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
} from "../cli/src/lib/chain";
import { treeHashToBytes32 } from "../cli/src/lib/git-tree";
import { submitWithNonceRetry } from "../cli/src/lib/nonce-retry";
import {
  CI_ADDRESS,
  DEPLOYER_ADDRESS,
  LATENCY_LABEL,
  LATENCY_NETWORKS,
  assertSignerAllowed,
  experimentProjectId,
} from "./latency-collect";

dotenv.config();

const DEFAULT_COUNT = 10;
const DEFAULT_MAX_ETH = "0.001";
const MAX_REVERTS = 2;

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function loadCiKey(root: string): string {
  const fromEnv = (process.env.GPA_CI_KEY ?? "").trim();
  if (fromEnv) return fromEnv;
  const file = path.join(root, ".ci-key");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  throw new Error("Set GPA_CI_KEY or provide .ci-key");
}

function probeTree(ref: string): string {
  return crypto.createHash("sha1").update(`gpa-throughput:${ref}`).digest("hex");
}

function ledgerPath(root: string): string {
  return path.join(root, "evaluation", "data", "throughput-burst.json");
}

async function paidWei(provider: ethers.JsonRpcProvider, hash: string, fee: bigint): Promise<bigint> {
  const raw = (await provider.send("eth_getTransactionReceipt", [hash])) as {
    gasUsed?: string;
    effectiveGasPrice?: string;
    gasPrice?: string;
    l1Fee?: string;
  };
  const gasUsed = BigInt(raw.gasUsed ?? "0");
  const price = BigInt(raw.effectiveGasPrice ?? raw.gasPrice ?? "0");
  const l1 = BigInt(raw.l1Fee ?? "0");
  const fromRaw = gasUsed * price + l1;
  return fromRaw > 0n ? fromRaw : fee;
}

async function main(): Promise<void> {
  const root = findRepoRoot(path.resolve(__dirname, ".."));
  const dryRun = process.argv.includes("--dry-run");
  const send = process.argv.includes("--send");
  if (dryRun === send) {
    throw new Error("Pass exactly one of --dry-run or --send");
  }
  const count = Number(argValue("--count") ?? DEFAULT_COUNT);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error("--count must be an integer from 1 to 20");
  }
  const cap = ethers.parseEther(argValue("--max-eth") ?? DEFAULT_MAX_ETH);
  const projectId = experimentProjectId();
  const startedAt = new Date();
  const batch = startedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");

  process.env.ANCHOR_DEPLOYER_KEY = loadCiKey(root);
  const signer = new ethers.Wallet(process.env.ANCHOR_DEPLOYER_KEY);
  assertSignerAllowed(signer.address);
  if (signer.address.toLowerCase() !== CI_ADDRESS.toLowerCase()) {
    throw new Error(`Expected CI key ${CI_ADDRESS}, got ${signer.address}`);
  }

  console.log(`project   ${projectId}`);
  console.log(`signer    ${signer.address}`);
  console.log(`count     ${count} per network`);
  console.log(`cap       ${ethers.formatEther(cap)} ETH`);
  console.log(`mode      ${dryRun ? "dry-run" : "send"}`);
  void DEPLOYER_ADDRESS;

  const networks = [...LATENCY_NETWORKS];
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    label: LATENCY_LABEL,
    projectId,
    submitter: signer.address,
    startedAt: startedAt.toISOString(),
    countPerNetwork: count,
    capEth: ethers.formatEther(cap),
    mode: dryRun ? "dry-run" : "send",
    networks: {} as Record<string, unknown>,
  };

  let spent = 0n;
  for (const network of networks) {
    const { contract, deployment } = getReadContract(root, network);
    const allowed = await contract.isAllowlisted(projectId, signer.address);
    console.log(`${network} registry=${deployment.address} allowlisted=${allowed}`);
    if (dryRun) {
      const ref = `tp-${batch}-0`;
      const gas = await contract.anchor.estimateGas(
        projectId,
        KIND_SNAPSHOT,
        ref,
        treeHashToBytes32(probeTree(`${network}:${ref}`)),
        ethers.ZeroHash,
        { from: signer.address }
      );
      console.log(`  estimateGas ${gas}`);
      (report.networks as Record<string, unknown>)[network] = {
        allowlisted: allowed,
        estimateGas: gas.toString(),
      };
      continue;
    }
    if (!allowed) throw new Error(`${signer.address} not allowlisted on ${network}`);

    const { contract: write, wallet } = await getWriteContract(root, network);
    const observations: Array<Record<string, unknown>> = [];
    const t0 = Date.now();
    let included = 0;
    let reverts = 0;
    for (let i = 0; i < count; i++) {
      if (spent >= cap) {
        console.log(`  cap reached`);
        break;
      }
      if (reverts >= MAX_REVERTS) {
        console.log(`  revert limit`);
        break;
      }
      const ref = `tp-${batch}-${i}`;
      const tree = treeHashToBytes32(probeTree(`${network}:${ref}`));
      const submitAt = new Date();
      try {
        const tx = await submitWithNonceRetry(
          () => wallet.getNonce("pending"),
          (nonce) =>
            write.anchor(projectId, KIND_SNAPSHOT, ref, tree, ethers.ZeroHash, { nonce })
        );
        const receipt = await tx.wait();
        if (!receipt || receipt.status === 0) {
          reverts += 1;
          observations.push({ i, ref, status: "reverted", txHash: receipt?.hash ?? null });
          continue;
        }
        const provider = wallet.provider as ethers.JsonRpcProvider;
        const block = await provider.getBlock(receipt.blockNumber);
        const feeWei = await paidWei(provider, receipt.hash, receipt.fee);
        spent += feeWei;
        included += 1;
        observations.push({
          i,
          ref,
          status: "included",
          txHash: receipt.hash,
          l2Block: receipt.blockNumber,
          l2BlockIso: block ? new Date(block.timestamp * 1000).toISOString() : null,
          inclusionSeconds: (Date.now() - submitAt.getTime()) / 1000,
          feeEth: ethers.formatEther(feeWei),
          gasUsed: receipt.gasUsed.toString(),
        });
        console.log(
          `  ${i + 1}/${count} included ${receipt.hash} ${(Date.now() - submitAt.getTime()) / 1000}s fee=${ethers.formatEther(feeWei)}`
        );
      } catch (err) {
        reverts += 1;
        observations.push({
          i,
          ref,
          status: "error",
          detail: err instanceof Error ? err.message : String(err),
        });
        console.log(`  ${i + 1}/${count} error ${err instanceof Error ? err.message : err}`);
      }
    }
    const elapsedMs = Date.now() - t0;
    const confirmedPerMinute = elapsedMs > 0 ? included / (elapsedMs / 60000) : 0;
    (report.networks as Record<string, unknown>)[network] = {
      included,
      attempted: observations.length,
      elapsedMs,
      confirmedPerMinute,
      spentEth: ethers.formatEther(
        observations.reduce((acc, row) => acc + ethers.parseEther(String(row.feeEth ?? "0")), 0n)
      ),
      observations,
    };
    console.log(
      `${network} included=${included}/${count} elapsed=${(elapsedMs / 1000).toFixed(1)}s rate=${confirmedPerMinute.toFixed(2)}/min`
    );
  }

  report.finishedAt = new Date().toISOString();
  report.seriesSpentEth = ethers.formatEther(spent);
  if (!dryRun) {
    fs.writeFileSync(ledgerPath(root), `${JSON.stringify(report, null, 1)}\n`);
    console.log(`wrote ${ledgerPath(root)}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
