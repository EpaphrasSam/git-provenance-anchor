import * as fs from "fs";
import * as path from "path";
import { findRepoRoot } from "../cli/src/lib/chain";
import type { LatencyLedger, LatencyObservation } from "./latency-collect";

const NETWORKS = ["arbitrumOne", "opMainnet", "zkSyncEra"] as const;
const UTC_WINDOWS = [8, 14, 20];

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

export function nearestRankPercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function describe(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    p50: nearestRankPercentile(sorted, 50),
    p90: nearestRankPercentile(sorted, 90),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

function elapsedSeconds(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  return (Date.parse(to) - Date.parse(from)) / 1000;
}

function numeric(
  rows: LatencyObservation[],
  select: (row: LatencyObservation) => number | null,
): number[] {
  return rows.map(select).filter((value): value is number => value !== null);
}

function scheduleWindow(iso: string): number | null {
  const hour = new Date(iso).getUTCHours();
  return UTC_WINDOWS.includes(hour) ? hour : null;
}

function summarizeNetwork(network: string, rows: LatencyObservation[]) {
  const included = rows.filter((row) => row.status === "included");
  const fees = numeric(included, (row) => (row.feeEth ? Number(row.feeEth) : null));
  const summary: Record<string, unknown> = {
    observations: rows.length,
    included: included.length,
    clientConfirmationSeconds: describe(
      numeric(included, (row) => row.inclusionSeconds),
    ),
    l1DataAvailabilitySeconds: describe(
      numeric(included, (row) => row.secondsToL1DataAvailability),
    ),
    feeEth: {
      ...describe(fees),
      total: fees.reduce((total, value) => total + value, 0),
    },
    missing: {
      transactionHash: rows.filter((row) => !row.txHash).length,
      l2Block: rows.filter((row) => row.l2Block === null).length,
      l1Posting: rows.filter((row) => !row.l1PostedAt).length,
    },
  };

  if (network === "zkSyncEra") {
    summary.validitySettlementSecondsFromL2Block = {
      committed: describe(
        numeric(included, (row) => elapsedSeconds(row.l2BlockIso, row.zkCommittedAt)),
      ),
      proven: describe(
        numeric(included, (row) => elapsedSeconds(row.l2BlockIso, row.zkProvenAt)),
      ),
      executed: describe(
        numeric(included, (row) => elapsedSeconds(row.l2BlockIso, row.zkExecutedAt)),
      ),
    };
    (summary.missing as Record<string, number>).proof = rows.filter(
      (row) => !row.zkProvenAt,
    ).length;
    (summary.missing as Record<string, number>).execution = rows.filter(
      (row) => !row.zkExecutedAt,
    ).length;
  }

  return summary;
}

export function buildSummary(ledger: LatencyLedger) {
  const included = ledger.observations.filter((row) => row.status === "included");
  const refs = [...new Set(included.map((row) => row.ref))].sort();
  const windowCounts = Object.fromEntries(
    UTC_WINDOWS.map((hour) => [
      `${hour.toString().padStart(2, "0")}:00`,
      new Set(
        included
          .filter((row) => scheduleWindow(row.submittedAt) === hour)
          .map((row) => row.ref),
      ).size,
    ]),
  );
  const expectedRefs = ledger.caps.plannedDays * UTC_WINDOWS.length;
  const expectedObservations = expectedRefs * NETWORKS.length;
  const seriesCapEth = Number(ledger.caps.maxEthSeries);
  const spentEth = Number(ledger.seriesSpentEth);

  return {
    generatedAt: new Date().toISOString(),
    source: "evaluation/data/latency-series.json",
    status: ledger.status,
    projectId: ledger.projectId,
    measurement: {
      clientConfirmation:
        "Wall-clock time from submission start until the client received the transaction receipt.",
      l1DataAvailability:
        "L1 posting timestamp minus the L2 block timestamp, in seconds.",
      protocolDeviation:
        "The protocol initially described L2 inclusion as block timestamp minus submit time. The collector stored client receipt wait instead. Results use the implemented metric.",
    },
    completeness: {
      expectedRefs,
      observedRefs: refs.length,
      expectedObservations,
      observedObservations: ledger.observations.length,
      includedObservations: included.length,
      statuses: Object.fromEntries(
        [...new Set(ledger.observations.map((row) => row.status))].map((status) => [
          status,
          ledger.observations.filter((row) => row.status === status).length,
        ]),
      ),
      refs,
      utcWindowRefCounts: windowCounts,
      firstSubmittedAt: included.map((row) => row.submittedAt).sort()[0],
      lastSubmittedAt: included.map((row) => row.submittedAt).sort().at(-1),
    },
    spend: {
      setupTransactions: ledger.setup.length,
      seriesSpentEth: spentEth,
      capEth: seriesCapEth,
      capUsedPercent: (spentEth / seriesCapEth) * 100,
    },
    networks: Object.fromEntries(
      NETWORKS.map((network) => [
        network,
        summarizeNetwork(
          network,
          ledger.observations.filter((row) => row.network === network),
        ),
      ]),
    ),
    interpretationBounds: {
      directEthereumLatencySeriesCollected: false,
      optimisticChallengeWindowMeasured: false,
      supports:
        "A bounded five-day distribution for client confirmation, L1 posting, and zkSync commit/prove/execute timing.",
      doesNotSupport:
        "Annual latency, congestion extremes, direct same-shape Ethereum latency, or a universal network ranking.",
    },
  };
}

function withAugustComparison(
  summary: ReturnType<typeof buildSummary>,
  baseline: {
    networks: {
      arbitrumOne: { secondsToL1DataAvailability: number };
      opMainnet: { secondsToL1DataAvailability: number };
      zkSyncEra: { secondsToCommit: number; secondsToProof: number };
    };
  },
) {
  const networks = summary.networks as Record<
    string,
    {
      l1DataAvailabilitySeconds: ReturnType<typeof describe>;
      validitySettlementSecondsFromL2Block?: {
        proven: ReturnType<typeof describe>;
      };
    }
  >;
  const compare = (value: number, range: { min: number; max: number }) => ({
    augustSeconds: value,
    seriesMinSeconds: range.min,
    seriesMaxSeconds: range.max,
    withinSeriesRange: value >= range.min && value <= range.max,
  });

  return {
    ...summary,
    augustSingleObservationComparison: {
      arbitrumL1DataAvailability: compare(
        baseline.networks.arbitrumOne.secondsToL1DataAvailability,
        networks.arbitrumOne.l1DataAvailabilitySeconds,
      ),
      opL1DataAvailability: compare(
        baseline.networks.opMainnet.secondsToL1DataAvailability,
        networks.opMainnet.l1DataAvailabilitySeconds,
      ),
      zkSyncCommit: compare(
        baseline.networks.zkSyncEra.secondsToCommit,
        networks.zkSyncEra.l1DataAvailabilitySeconds,
      ),
      zkSyncProof: compare(
        baseline.networks.zkSyncEra.secondsToProof,
        networks.zkSyncEra.validitySettlementSecondsFromL2Block!.proven,
      ),
    },
  };
}

function main() {
  const root = findRepoRoot();
  const input = path.join(root, "evaluation", "data", arg("in", "latency-series.json"));
  const output = path.join(
    root,
    "evaluation",
    "data",
    arg("out", "latency-series-summary.json"),
  );
  const ledger = JSON.parse(fs.readFileSync(input, "utf8")) as LatencyLedger;
  const baseline = JSON.parse(
    fs.readFileSync(path.join(root, "evaluation", "data", "latency.json"), "utf8"),
  );
  const summary = withAugustComparison(buildSummary(ledger), baseline);
  fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${output}`);
}

if (require.main === module) {
  main();
}
