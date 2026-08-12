/**
 * Turns the raw samples from fee-history.ts into the distribution figures the
 * cost claim needs, and checks the reconstruction against transactions that were
 * actually paid for.
 *
 * The validation matters more than the percentiles. A counterfactual figure is
 * only worth reading if the same arithmetic reproduces a real receipt, so the
 * script recomputes each Phase A transaction from its block's base fee and
 * reports the error against the fee that was charged.
 *
 * Reads and writes local files only; no network access.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/fee-analyse.ts
 *   npx ts-node --transpile-only scripts/fee-analyse.ts --in fee-history-dense.json --eth-usd 1900
 */
import * as fs from "fs";
import * as path from "path";
import { findRepoRoot } from "../cli/src/lib/chain";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}

const WEI_PER_ETH = 1e18;

/** Nearest-rank percentile over an ascending array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function describe(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

function fmtEth(v: number): string {
  if (!isFinite(v)) return "n/a";
  return v.toExponential(3);
}

function fmtUsd(v: number): string {
  if (!isFinite(v)) return "n/a";
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}

interface Sample {
  targetIso: string;
  blockIso: string;
  blockNumber: number;
  baseFeePerGasWei: string | null;
  blobBaseFeeWei?: string | null;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function main() {
  const repoRoot = findRepoRoot();
  const inName = arg("in", "fee-history.json")!;
  const ethUsd = Number(arg("eth-usd", "1900"));
  const inPath = path.join(repoRoot, "evaluation", "data", inName);

  if (!fs.existsSync(inPath)) {
    throw new Error(`${inPath} not found. Run: npm run fees:history`);
  }
  const raw = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const gasUnits: Record<string, number> = raw.anchorGasUnits ?? {};

  const perNetwork: Record<string, unknown> = {};
  const lines: string[] = [];

  for (const net of raw.networks ?? []) {
    const samples: Sample[] = (net.samples ?? []).filter((s: Sample) => s.baseFeePerGasWei);
    if (samples.length === 0) continue;

    const isL1 = net.network === "ethereum";
    const units = gasUnits[net.network];

    const priceGwei = samples.map((s) => Number(BigInt(s.baseFeePerGasWei!)) / 1e9);
    const priceStats = describe(priceGwei);

    const entry: Record<string, unknown> = {
      network: net.network,
      chainId: net.chainId,
      collected: net.collected,
      requested: net.requested,
      failures: (net.failures ?? []).length,
      windowFrom: samples[0]?.blockIso,
      windowTo: samples[samples.length - 1]?.blockIso,
      baseFeeGwei: priceStats,
    };

    if (!isL1 && units) {
      const costEth = samples.map((s) => (Number(BigInt(s.baseFeePerGasWei!)) * units) / WEI_PER_ETH);
      const costStats = describe(costEth);
      entry.anchorGasUnits = units;
      entry.anchorCostEth = costStats;
      entry.anchorCostUsd = Object.fromEntries(
        Object.entries(costStats).map(([k, v]) => [k, k === "n" ? v : (v as number) * ethUsd]),
      );
      entry.spikeRatioP99OverP50 = costStats.p50 > 0 ? costStats.p99 / costStats.p50 : null;
      entry.spikeRatioMaxOverP50 = costStats.p50 > 0 ? costStats.max / costStats.p50 : null;

      // Worst individual sample, so the tail has a date attached rather than
      // being a bare number.
      let worstIdx = 0;
      costEth.forEach((c, i) => {
        if (c > costEth[worstIdx]) worstIdx = i;
      });
      entry.worstSample = {
        blockIso: samples[worstIdx].blockIso,
        blockNumber: samples[worstIdx].blockNumber,
        costEth: costEth[worstIdx],
        costUsd: costEth[worstIdx] * ethUsd,
      };

      // Monthly medians, to locate the documented congestion windows.
      const byMonth: Record<string, number[]> = {};
      samples.forEach((s, i) => {
        (byMonth[monthKey(s.blockIso)] ??= []).push(costEth[i]);
      });
      entry.monthlyMedianCostEth = Object.fromEntries(
        Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([m, v]) => [m, percentile([...v].sort((a, b) => a - b), 50)]),
      );

      lines.push(
        `${net.network.padEnd(12)} p50 ${fmtEth(costStats.p50)} ETH (${fmtUsd(costStats.p50 * ethUsd)})  ` +
          `p90 ${fmtEth(costStats.p90)}  p99 ${fmtEth(costStats.p99)}  ` +
          `max ${fmtEth(costStats.max)} (${fmtUsd(costStats.max * ethUsd)})  n=${costStats.n}`,
      );
    }

    if (isL1) {
      const blobs = samples
        .filter((s) => s.blobBaseFeeWei)
        .map((s) => Number(BigInt(s.blobBaseFeeWei!)) / 1e9);
      if (blobs.length > 0) entry.blobBaseFeeGwei = describe(blobs);
      lines.push(
        `${"ethereum L1".padEnd(12)} base fee p50 ${priceStats.p50.toFixed(3)} gwei  ` +
          `p99 ${priceStats.p99.toFixed(3)}  max ${priceStats.max.toFixed(3)}  n=${priceStats.n}`,
      );
    }

    perNetwork[net.network] = entry;
  }

  // Validation: recompute each Phase A transaction from its own block's base fee.
  const validation: Record<string, unknown>[] = [];
  for (const r of raw.phaseAReceipts?.receipts ?? []) {
    if (r.error || !r.gasUsed) continue;
    const gasUsed = Number(r.gasUsed);
    const effective = r.effectiveGasPrice ? Number(r.effectiveGasPrice) : null;
    const baseFee = r.blockBaseFeePerGas ? Number(r.blockBaseFeePerGas) : null;
    const paidEth = effective ? (gasUsed * effective) / WEI_PER_ETH : null;
    const l1FeeEth = r.l1Fee ? Number(r.l1Fee) / WEI_PER_ETH : null;
    const totalPaidEth = paidEth === null ? null : paidEth + (l1FeeEth ?? 0);
    const reconstructedEth = baseFee ? (gasUsed * baseFee) / WEI_PER_ETH : null;

    validation.push({
      network: r.network,
      label: r.label,
      hash: r.hash,
      blockIso: r.blockIso,
      gasUsed,
      effectiveGasPriceWei: effective,
      blockBaseFeePerGasWei: baseFee,
      l2FeeEth: paidEth,
      l1FeeEth,
      totalPaidEth,
      reconstructedFromBaseFeeEth: reconstructedEth,
      reconstructionErrorPct:
        reconstructedEth && paidEth ? ((reconstructedEth - paidEth) / paidEth) * 100 : null,
      l1ShareOfTotalPct:
        totalPaidEth && l1FeeEth !== null ? (l1FeeEth / totalPaidEth) * 100 : null,
      gasUsedForL1: r.gasUsedForL1 ?? null,
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: inName,
    sourceCollectedAt: raw.collectedAt,
    ethUsdAssumed: ethUsd,
    method: raw.method,
    window: raw.window,
    feeModelNotes: raw.feeModelNotes,
    networks: perNetwork,
    phaseAValidation: validation,
  };

  const outPath = path.join(repoRoot, "evaluation", "data", "fee-distribution.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");

  console.log(`\nAnchor cost distribution (ETH at ~$${ethUsd}/ETH):\n`);
  lines.forEach((l) => console.log("  " + l));

  console.log(`\nValidation against Phase A receipts:\n`);
  for (const v of validation as any[]) {
    if (v.reconstructionErrorPct === null) continue;
    console.log(
      `  ${String(v.network).padEnd(12)} ${String(v.label).padEnd(10)} ` +
        `paid(L2) ${fmtEth(v.l2FeeEth)}  reconstructed ${fmtEth(v.reconstructedFromBaseFeeEth)}  ` +
        `error ${v.reconstructionErrorPct.toFixed(2)}%` +
        (v.l1FeeEth ? `  +L1 ${fmtEth(v.l1FeeEth)} (${v.l1ShareOfTotalPct.toFixed(1)}% of total)` : ""),
    );
  }

  console.log(`\nWrote ${outPath}`);
}

main();
