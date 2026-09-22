import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ethers } from "ethers";
import { parseTimeoutMs } from "../scripts/sbom-coverage";
import { comparisonVerdict, manifestForRepo } from "../scripts/tarball-sweep";
import { buildSummary, nearestRankPercentile } from "../scripts/latency-analyse";
import {
  assertSignerAllowed,
  CI_ADDRESS,
  DEPLOYER_ADDRESS,
  experimentProjectId,
  LATENCY_LABEL,
  liveWritesEnabled,
  observationRef,
  paidWeiFromRpcReceipt,
  parseMode,
  probeTreeHash,
  seriesWindowClosed,
  spendWouldExceed,
} from "../scripts/latency-collect";

describe("evaluation sample scripts", function () {
  it("uses a 900-second SBOM timeout by default", function () {
    expect(parseTimeoutMs(undefined)).to.equal(900_000);
    expect(parseTimeoutMs("30")).to.equal(30_000);
    expect(() => parseTimeoutMs("0")).to.throw("positive number");
  });

  it("applies checked-in tarball fixtures to clean clones", function () {
    const root = path.resolve(__dirname, "..");
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-clean-clone-"));
    try {
      expect(manifestForRepo(root, clone, "curl/curl")).to.equal(
        path.join(root, "evaluation", "fixtures", "manifests", "curl.provenance-manifest.json")
      );
      expect(manifestForRepo(root, clone, "libarchive/libarchive")).to.equal(
        path.join(
          root,
          "evaluation",
          "fixtures",
          "manifests",
          "libarchive.provenance-manifest.json"
        )
      );
      expect(manifestForRepo(root, clone, "spf13/cobra")).to.equal(undefined);
    } finally {
      fs.rmSync(clone, { recursive: true, force: true });
    }
  });

  it("prefers a project's own manifest", function () {
    const root = path.resolve(__dirname, "..");
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-project-manifest-"));
    const manifest = path.join(clone, ".provenance-manifest.json");
    try {
      fs.writeFileSync(manifest, "{}");
      expect(manifestForRepo(root, clone, "curl/curl")).to.equal(manifest);
    } finally {
      fs.rmSync(clone, { recursive: true, force: true });
    }
  });

  it("does not describe missing paths as every extra file being declared", function () {
    const verdict = comparisonVerdict(false, 0, 2);
    expect(verdict).to.equal(
      "0 undeclared extra file(s), 2 missing path(s); aggregate mismatch"
    );
    expect(verdict).not.to.include("every extra file is declared");
  });
});

describe("latency collector", function () {
  it("uses nearest-rank percentiles in the latency summary", function () {
    expect(nearestRankPercentile([1, 2, 3, 4, 5], 50)).to.equal(3);
    expect(nearestRankPercentile([1, 2, 3, 4, 5], 90)).to.equal(5);
  });

  it("derives a stable experiment project id from the label", function () {
    expect(experimentProjectId()).to.equal(ethers.id(LATENCY_LABEL));
    expect(experimentProjectId()).to.match(/^0x[0-9a-f]{64}$/);
    expect(experimentProjectId()).to.not.equal(
      "0xd5a2d84a505835208164492fb3b9cf1331b361eed0e7ad977639f2a7aae6264e"
    );
  });

  it("names observations from UTC timestamps", function () {
    expect(observationRef(new Date("2026-09-16T14:00:00.000Z"))).to.equal(
      "lat-20260916T140000Z"
    );
  });

  it("uses a 20-byte probe hash rather than a release tree", function () {
    const hex = probeTreeHash("arbitrumOne:lat-20260916T140000Z");
    expect(hex).to.match(/^[0-9a-f]{40}$/);
    expect(hex).to.not.equal("bfc4700b1f0376c4a19722440a3c132fea20681b");
  });

  it("refuses the deployer and keeps the live gate closed by default", function () {
    expect(() => assertSignerAllowed(DEPLOYER_ADDRESS)).to.throw("deployer");
    expect(() => assertSignerAllowed(CI_ADDRESS)).to.not.throw();
    expect(liveWritesEnabled({})).to.equal(false);
    expect(liveWritesEnabled({ GPA_LATENCY_LIVE: "true" })).to.equal(true);
    expect(parseMode("preflight")).to.equal("preflight");
    expect(() => parseMode("broadcast")).to.throw("dry-run");
  });

  it("stops a run before the ETH cap is crossed", function () {
    expect(spendWouldExceed(8n, 3n, 10n)).to.equal(true);
    expect(spendWouldExceed(8n, 2n, 10n)).to.equal(false);
    expect(paidWeiFromRpcReceipt({ gasUsed: "100", effectiveGasPrice: "2", l1Fee: "5" })).to.equal(
      205n
    );
  });

  it("closes collect after the planned number of days", function () {
    const ledger = {
      schemaVersion: 1 as const,
      label: LATENCY_LABEL,
      projectId: experimentProjectId(),
      status: "collecting" as const,
      caps: {
        maxEthPerRun: "0.001",
        maxEthSeries: "0.01",
        maxRevertsPerRun: 2,
        plannedDays: 5,
        txsPerNetworkPerWindow: 1,
      },
      seriesSpentEth: "0",
      setup: [],
      observations: [
        {
          id: "x",
          mode: "probe" as const,
          network: "arbitrumOne",
          ref: "lat-1",
          projectId: experimentProjectId(),
          submitter: CI_ADDRESS,
          submittedAt: "2026-09-16T14:04:16.149Z",
          txHash: "0x1",
          l2Block: 1,
          l2BlockIso: "2026-09-16T14:04:17.000Z",
          inclusionSeconds: 5,
          feeEth: "0",
          gasUsed: "1",
          l1PostedAt: null,
          secondsToL1DataAvailability: null,
          l1TxHash: null,
          zkCommittedAt: null,
          zkProvenAt: null,
          zkExecutedAt: null,
          status: "included" as const,
          detail: null,
        },
      ],
    };
    expect(seriesWindowClosed(ledger, new Date("2026-09-21T14:04:16.149Z"))).to.equal(true);
    expect(seriesWindowClosed(ledger, new Date("2026-09-20T14:04:16.148Z"))).to.equal(false);
  });

  it("labels the implemented inclusion metric as client receipt wait", function () {
    const ledger = {
      schemaVersion: 1 as const,
      label: LATENCY_LABEL,
      projectId: experimentProjectId(),
      status: "complete" as const,
      caps: {
        maxEthPerRun: "0.001",
        maxEthSeries: "0.01",
        maxRevertsPerRun: 2,
        plannedDays: 5,
        txsPerNetworkPerWindow: 1,
      },
      seriesSpentEth: "0.0001",
      setup: [],
      observations: [],
    };
    const summary = buildSummary(ledger);
    expect(summary.measurement.clientConfirmation).to.include("transaction receipt");
    expect(summary.measurement.protocolDeviation).to.include("client receipt wait");
  });
});
