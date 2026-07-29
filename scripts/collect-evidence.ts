/**
 * Gathers the measurable facts about every live deployment into
 * evaluation/data/on-chain-evidence.json so the evaluation chapter can cite
 * figures that are re-derivable rather than copied from terminal output.
 *
 * Collects, per network: the deployment receipt, a receipt for every historical
 * anchor transaction, and gas estimates for each contract operation. Estimates
 * are simulations, so this script broadcasts nothing and costs nothing.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/collect-evidence.ts
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import {
  ANCHOR_REGISTRY_ABI,
  findRepoRoot,
  getReadContract,
  KIND_TAG,
  listAnchorsFromEvents,
  loadDeployments,
} from "../cli/src/lib/chain";
import { tryLoadManifest } from "../cli/src/lib/manifest";

dotenv.config();

interface TxMeasurement {
  label: string;
  transactionHash: string;
  blockNumber: number;
  status?: number;
  gasUsed: string;
  effectiveGasPrice?: string;
  feeWei?: string;
  feeEth?: string;
  calldataBytes?: number;
}

interface GasEstimate {
  operation: string;
  gasUnits: string | null;
  note?: string;
}

interface NetworkEvidence {
  network: string;
  chainId: number;
  registry: string;
  deployedAt: string;
  solcVersion: string;
  optimizer: { enabled: boolean; runs: number };
  deploymentGasUsed: string;
  currentGasPriceWei: string | null;
  transactions: TxMeasurement[];
  gasEstimates: GasEstimate[];
}

async function measureTx(
  provider: ethers.JsonRpcProvider,
  label: string,
  hash: string
): Promise<TxMeasurement | null> {
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) return null;
  const tx = await provider.getTransaction(hash);
  const feeWei =
    receipt.gasUsed && receipt.gasPrice ? receipt.gasUsed * receipt.gasPrice : undefined;

  return {
    label,
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status ?? undefined,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.gasPrice?.toString(),
    feeWei: feeWei?.toString(),
    feeEth: feeWei ? ethers.formatEther(feeWei) : undefined,
    calldataBytes: tx?.data ? (tx.data.length - 2) / 2 : undefined,
  };
}

async function estimateOperations(
  contract: ethers.Contract,
  projectId: string,
  from: string
): Promise<GasEstimate[]> {
  const out: GasEstimate[] = [];
  const sampleTree = ethers.keccak256(ethers.toUtf8Bytes("sample-tree"));
  const sampleSbom = ethers.keccak256(ethers.toUtf8Bytes("sample-sbom"));

  const cases: Array<{ operation: string; run: () => Promise<bigint> }> = [
    {
      operation: "anchor (re-anchor existing tag)",
      run: () =>
        contract.anchor.estimateGas(projectId, KIND_TAG, "v0.3.0-m3", sampleTree, sampleSbom, { from }),
    },
    {
      operation: "anchor (new tag, first revision)",
      run: () =>
        contract.anchor.estimateGas(projectId, KIND_TAG, "v9.9.9-estimate", sampleTree, sampleSbom, {
          from,
        }),
    },
    {
      operation: "allowlistAdd",
      run: () => contract.allowlistAdd.estimateGas(projectId, ethers.Wallet.createRandom().address, { from }),
    },
  ];

  for (const { operation, run } of cases) {
    try {
      const units = await run();
      out.push({ operation, gasUnits: units.toString() });
    } catch (err) {
      out.push({
        operation,
        gasUnits: null,
        note: err instanceof Error ? err.message.slice(0, 160) : String(err),
      });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const root = findRepoRoot(path.resolve(__dirname, ".."));
  const manifest = tryLoadManifest(root);
  const projectId = process.env.GPA_PROJECT_ID ?? manifest?.projectId;
  if (!projectId) throw new Error("Set GPA_PROJECT_ID or provide .provenance-manifest.json");

  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const networks: NetworkEvidence[] = [];

  for (const [network, deployment] of loadDeployments(root)) {
    console.log(`\n=== ${network} ===`);
    const { contract, provider } = getReadContract(root, network);
    const owner = (await contract.getProject(projectId))[0] as string;

    const transactions: TxMeasurement[] = [];
    const deployMeasurement = await measureTx(provider, "deployment", deployment.transactionHash);
    if (deployMeasurement) transactions.push(deployMeasurement);

    const anchors = await listAnchorsFromEvents(root, network, projectId);
    for (const a of anchors) {
      const m = await measureTx(provider, `anchor ${a.ref} rev${a.revision}`, a.transactionHash);
      if (m) transactions.push(m);
    }

    const readContract = new ethers.Contract(deployment.address, ANCHOR_REGISTRY_ABI, provider);
    const gasEstimates = await estimateOperations(readContract, projectId, owner);
    const fee = await provider.getFeeData();

    for (const t of transactions) {
      console.log(`  ${t.label.padEnd(28)} gas=${t.gasUsed.padEnd(9)} calldata=${t.calldataBytes ?? "?"}B`);
    }
    for (const g of gasEstimates) {
      console.log(`  est ${g.operation.padEnd(34)} ${g.gasUnits ?? `failed: ${g.note}`}`);
    }

    networks.push({
      network,
      chainId: deployment.chainId,
      registry: deployment.address,
      deployedAt: deployment.deployedAt,
      solcVersion: deployment.solcVersion,
      optimizer: deployment.optimizer,
      deploymentGasUsed: deployment.gasUsed,
      currentGasPriceWei: fee.gasPrice?.toString() ?? null,
      transactions,
      gasEstimates,
    });
  }

  const outDir = path.join(root, "evaluation", "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "on-chain-evidence.json");
  fs.writeFileSync(
    outFile,
    `${JSON.stringify({ collectedAt: new Date().toISOString(), commit, projectId, networks }, null, 2)}\n`,
    "utf8"
  );
  console.log(`\nwrote ${path.relative(root, outFile)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
