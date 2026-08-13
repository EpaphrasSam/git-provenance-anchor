"""
RQ2: which anchoring strategy gives better coverage of documented attack classes.

Re-runs the Chapter 3 rubric under three policies and reports which vectors change
classification as each mechanism is added, then grounds the result in the release
cadence measured across the repository sample and prices it from the observed fee
distribution.

  python3 evaluation/rq2-ablation.py

Reads:  data/ladisa-classification.csv, data/sample-results.json,
        data/fee-distribution.json, and the taxonomy at the pinned commit.
Writes: data/rq2-ablation.csv, data/rq2-ablation.json
"""
import csv, json, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

# ---------------------------------------------------------------------------
# Policies
#
# The published classification in ladisa-classification.csv is NOT the tag-only
# baseline. It credits AV-303 as detectable because re-verification catches a
# force-moved tag, so it already describes tag + re-verification. Treating it as
# the baseline would understate every delta, so the baseline is reconstructed
# here by removing that credit.
# ---------------------------------------------------------------------------
POLICIES = ["tag-only", "tag+snapshots", "tag+reverify"]

OVERRIDES = {
    # AV-303, tampering with the version control system after a release.
    "AV-303": {
        "tag-only": (
            "detectable-passive",
            "A moved tag still contradicts the anchored tree, so a consumer who "
            "verifies what they fetched sees the mismatch. Nothing looks for it, "
            "though: detection waits on someone happening to check, and the window "
            "is unbounded.",
        ),
        "tag+snapshots": (
            "detectable-passive",
            "Snapshots anchor the production branch, not existing tags, so they add "
            "nothing here. Identical to the baseline.",
        ),
        "tag+reverify": (
            "detectable",
            "Re-verification walks anchored tags on a schedule and flags a moved one "
            "without waiting for a consumer. Demonstrated on three live networks in "
            "tag-retargeting.md. Detection latency becomes the check interval.",
        ),
    },
    # AV-300 subtree: injection into the sources of a legitimate package.
    # AV-301 (hypocrite merge request) and AV-302 (contributing as maintainer) are
    # out of scope under the baseline because the code is inside the tree the
    # anchor commits to. Snapshots change what is recorded, not what is judged.
    "AV-301": {
        "tag+snapshots": (
            "out-of-scope-conditionally-recorded",
            "The injection is still faithfully anchored rather than caught: a "
            "scheduled snapshot records the poison only if the malicious branch state "
            "is present when that snapshot runs. Under that timing condition, "
            "branch-tip consumers gain something to verify against and a later revert "
            "or force-push cannot erase the snapshot record. Useful for forensics, "
            "not detection.",
        )
    },
    "AV-302": {
        "tag+snapshots": (
            "out-of-scope-conditionally-recorded",
            "As AV-301. Maintainer-level injection into sources is recorded only if "
            "its branch state overlaps a scheduled snapshot; it is not detected.",
        )
    },
}


def load_rows():
    with open(os.path.join(DATA, "ladisa-classification.csv"), newline="", encoding="utf8") as f:
        return list(csv.DictReader(f))


def classify(row, policy):
    node = row["decidedAtNode"]
    base = row["classification"]
    if node in OVERRIDES and policy in OVERRIDES[node]:
        return OVERRIDES[node][policy]
    if node == "AV-303" and policy not in OVERRIDES["AV-303"]:
        return base, ""
    return base, ""


def main():
    rows = load_rows()
    out_rows = []
    counts = {p: collections.Counter() for p in POLICIES}
    changed = collections.defaultdict(list)

    for r in rows:
        rec = {
            "avId": r["avId"],
            "avName": r["avName"],
            "path": r["path"],
            "decidedAtNode": r["decidedAtNode"],
            "mappedReferences": r["mappedReferences"],
        }
        seen = {}
        for p in POLICIES:
            cls, why = classify(r, p)
            rec[p] = cls
            rec[p + "_rationale"] = why
            counts[p][cls] += 1
            seen[p] = cls
        if len(set(seen.values())) > 1:
            changed[r["decidedAtNode"]].append(r["avId"])
        out_rows.append(rec)

    with open(os.path.join(DATA, "rq2-ablation.csv"), "w", newline="", encoding="utf8") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0]))
        w.writeheader()
        w.writerows(out_rows)

    sample = json.load(open(os.path.join(DATA, "sample-results.json"), encoding="utf8"))
    cadence = []
    for repo in sample["repositories"]:
        gap = repo.get("medianTagGapDays")
        if gap is None:
            continue
        cadence.append({
            "repo": repo["repo"],
            "medianTagGapDays": gap,
            "tagsSince2024": repo.get("tagsSince2024"),
            "heuristicTagIntervalDays": gap,
            "heuristicWeeklyComparisonDays": min(gap, 7),
            "heuristicIntervalDifferenceDays": max(0, gap - 7),
            "timingCondition": (
                "A malicious branch state is retained only if it overlaps a scheduled "
                "snapshot run. This compares a median tag interval with a weekly schedule; "
                "it is not a maximum-gap or capture-probability measurement."
            ),
        })
    cadence.sort(key=lambda c: -c["medianTagGapDays"])

    # --- cost: snapshots are real transactions, re-verification is a read ----
    fees = json.load(open(os.path.join(DATA, "fee-distribution.json"), encoding="utf8"))
    usd = fees.get("ethUsdApprox", 1900)
    per_anchor = {
        "arbitrumOne": 1.594e-6,
        "opMainnet": (79216 * (477 + 1_000_000) + 1_862_429_623) / 1e18,
        "zkSyncEra": 106249 * 45_250_000 / 1e18,
    }
    weekly = 52
    cost = {
        "assumedSnapshotsPerYear": weekly,
        "basis": {
            "arbitrumOne": "Explicit 1.594e-6 ETH p50 for the 79,708-gas no-SBOM Phase A shape",
            "opMainnet": "79,216-gas live snapshot at p50 base fee, plus 0.001-gwei tip and observed l1Fee",
            "zkSyncEra": "106,249-gas no-SBOM Phase A shape at the retained 0.04525-gwei fee",
        },
        "perAnchorEthP50": per_anchor,
        "annualSnapshotCostEth": {n: v * weekly for n, v in per_anchor.items()},
        "annualSnapshotCostUsdApprox": {n: round(v * weekly * usd, 4) for n, v in per_anchor.items()},
        "reverifyCost": "zero on-chain: reading a contract is free and requires no transaction",
    }

    summary = {
        "generatedAt": "2026-08-12",
        "question": "RQ2: is tag-only anchoring, or tag anchoring combined with periodic production-branch snapshots, more effective for coverage of documented supply chain attack classes?",
        "baselineNote": "The published classification in ladisa-classification.csv already credits re-verification at AV-303, so it describes tag+reverify rather than tag-only. The tag-only baseline is reconstructed here by withdrawing that credit.",
        "snapshotCountAssumption": "The 22 instances in the snapshot column are conditionally recorded, not guaranteed captures. Each moves only when the malicious branch state is present at a scheduled snapshot run.",
        "policies": POLICIES,
        "counts": {p: dict(counts[p]) for p in POLICIES},
        "vectorsThatChange": {k: sorted(set(v)) for k, v in changed.items()},
        "instancesThatChange": {k: len(v) for k, v in changed.items()},
        "cadence": cadence,
        "cost": cost,
    }
    json.dump(summary, open(os.path.join(DATA, "rq2-ablation.json"), "w", encoding="utf8"), indent=1)

    print("Instances by classification under each policy\n")
    labels = sorted({c for p in POLICIES for c in counts[p]})
    print(f"{'classification':26s} " + " ".join(f"{p:>16s}" for p in POLICIES))
    for lab in labels:
        print(f"{lab:26s} " + " ".join(f"{counts[p][lab]:16d}" for p in POLICIES))
    print("\nNodes whose classification changes between policies:")
    for k, v in changed.items():
        print(f"  {k}: {len(v)} instances")
    print("\nHeuristic median-tag interval versus weekly schedule (days)")
    for c in cadence:
        print(f"  {c['repo']:34s} {c['medianTagGapDays']:6.0f} -> {c['heuristicWeeklyComparisonDays']:3.0f}"
              f"   difference {c['heuristicIntervalDifferenceDays']:5.0f}")
    print("\nAnnual cost of weekly snapshots, per network (USD approx)")
    for n, v in cost["annualSnapshotCostUsdApprox"].items():
        print(f"  {n:14s} ${v}")


if __name__ == "__main__":
    main()
