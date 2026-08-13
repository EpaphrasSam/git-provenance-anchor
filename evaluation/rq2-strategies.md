# RQ2: which anchoring strategy covers more

Run 2026-08-12. Per-vector table: `data/rq2-ablation.csv`. Summary figures:
`data/rq2-ablation.json`. Regenerate with `python3 evaluation/rq2-ablation.py`.

RQ2 asks whether anchoring only at release tags, or anchoring at tags plus
periodic production-branch snapshots, covers more of the documented attack
classes. The rubric from Chapter 3 is re-applied under three policies and the
result is grounded in the release cadences measured across the repository sample
and priced from the observed fee distribution.

## A correction to the baseline first

The classification published in `ladisa-coverage.md` is **not** the tag-only
baseline, though it is easy to mistake for one. It credits AV-303 as detectable
specifically because re-verification catches a force-moved tag. That is the
second mechanism under test, so the published figures already describe
tag-plus-re-verification.

Using them as the baseline would have made the deltas look smaller than they are
and put a wrong number in the first row. The baseline below is reconstructed by
withdrawing that credit.

## Instances by classification, under each policy

| Classification | tag-only | tag + snapshots | tag + re-verify |
| --- | --- | --- | --- |
| Detectable | 34 | 34 | **48** |
| Detectable, conditional on artifact type | 31 | 31 | 31 |
| Detectable but passive | 14 | 14 | 0 |
| Out of scope | 34 | **12** | 34 |
| Out of scope, conditionally recorded | 0 | **22** | 0 |
| Partially detectable | 1 | 1 | 1 |
| Internal category nodes | 4 | 4 | 4 |

Three nodes change classification, covering 36 of the 118 instances: AV-301 and
AV-302 under snapshots, and AV-303 under re-verification. The 22-instance
snapshot count assumes that the malicious branch state is present when a
scheduled snapshot runs. It is a conditional classification, not a claim that
all 22 instances would be captured. Everything else is identical across the
three policies.

## Re-verification: it changes who notices, and when

Under tag-only, a force-moved tag is **not** invisible. The moved tag still
contradicts the anchored tree, so a consumer who verifies what they fetched sees
the mismatch. What is missing is anyone looking. Detection waits on someone
happening to check, and the window is unbounded, which is why the baseline
classifies these 14 instances as detectable but passive rather than as detectable.

Re-verification walks the anchored tags on a schedule and flags a moved one
without waiting for a consumer to stumble into it. Detection latency stops being
unbounded and becomes the check interval.

That is a smaller change than "14 vectors become detectable" suggests, and the
distinction matters for honesty: the mechanism converts passive, consumer-side,
eventually-maybe detection into active, project-side, bounded detection. Against
the tj-actions incident, which was reverted after roughly a day, the difference
is whether anyone finds out inside that day.

The shipped template schedules re-verification **daily**
(`workflows/provenance-reverify.yml`, `cron: "0 5 * * *"`), which puts a
tj-actions-shaped incident inside one check interval rather than outside it. That
is the reason the two mechanisms carry different default cadences: snapshots are
weekly because they cost a transaction each, while re-verification is daily
because it incurs no on-chain transaction fee, so the interval can be set by how
fast you want to know rather than by what you are willing to spend.

**It incurs no on-chain transaction fee.** Reading a contract requires no
transaction. Running the check still consumes off-chain compute and network
access.

## Snapshots: a smaller gain than expected, and not the one advertised

The intuition behind snapshots is that a malicious commit landing on the main
branch and being reverted before the next release would otherwise leave no trace.
That intuition is half right, and the half that is wrong matters.

A snapshot taken while a poisoned branch state is present **records the
poison**. It does not detect it. If the malicious state appears and is reverted
between scheduled runs, no snapshot preserves it. The anchor faithfully commits
to whatever state the branch contains at the instant of the run, exactly as a
tag anchor commits to a poisoned release. Injection into sources therefore
remains out of scope under snapshots.

When a scheduled run overlaps the malicious state, consumers who take code from
the branch tip gain something to verify against, and a later revert or
force-push cannot erase the snapshot record. If there is no overlap, neither
benefit applies to that state.

That is why the 22 instances move from out of scope to out of scope
**conditionally recorded**, rather than to detectable. Calling them recorded
without the timing condition would overstate the mechanism.

## Cadence: interval between anchored states

The arithmetic below is a heuristic comparison between the median interval
between tag anchors and a weekly schedule, assuming those runs succeed. It does
not measure actual maximum tag gaps or calculate the probability of capturing a
malicious state. Capture also depends on when the state appears and how long it
remains present.

| Repository | Median tag gap | Weekly heuristic | Heuristic difference |
| --- | --- | --- | --- |
| spf13/cobra | 98 d | 7 d | 91 d |
| libarchive/libarchive | 50 d | 7 d | 43 d |
| curl/curl | 49 d | 7 d | 42 d |
| sharkdp/bat | 28 d | 7 d | 21 d |
| junegunn/fzf | 16 d | 7 d | 9 d |
| axios/axios | 12 d | 7 d | 5 d |
| pallets/click | 11 d | 7 d | 4 d |
| psf/requests | 8 d | 7 d | 1 d |
| expressjs/express | 4 d | 4 d | 0 d |
| BurntSushi/ripgrep | 0 d | 0 d | 0 d |

For a project releasing every few days, weekly snapshots do not add more frequent
scheduled opportunities than its typical tag cadence. For cobra, the heuristic
compares a 98-day median tag gap with a seven-day schedule, a difference of 91
days. This is evidence about observation opportunities, not a measured reduction
in a maximum gap or guaranteed preservation: a malicious state lasting less than
a week can still fall entirely between runs.

**The sample cannot speak to the case where this matters most.** Nothing here
releases yearly, and a project with a twelve-month gap is exactly where snapshots
would earn their cost. The trend across the ten measured projects is clear enough
to state the shape of the answer, but the extreme is extrapolation, not
measurement.

## Cost

Weekly snapshots are 52 additional no-SBOM transactions a year. The retained
prices use the no-SBOM snapshot shape, not the with-SBOM release shape used for
RQ1:

| Network | Annual cost of weekly snapshots |
| --- | --- |
| OP Mainnet | $0.008 |
| Arbitrum One | $0.16 |
| zkSync Era | $0.48 |

Re-verification adds no on-chain transaction or fee.

So cost does not decide this. The annual amounts remain modest for a release
workflow. The reason to be selective is that snapshots buy a narrow benefit,
branch-tip verifiability and a forensic record, rather than the broad one the
intuition promises.

## Answer to RQ2

Neither mechanism dominates, and the honest answer is a policy rather than a
winner.

**Re-verification should be on by default.** It needs no transaction, incurs no
on-chain transaction fee, and turns unbounded passive detection into bounded
active detection for the one attack class the tag-only design leaves waiting on
chance. There is no project for which it is a bad trade.

**Snapshots should be conditional on release cadence and the required observation
interval.** For fast-releasing projects, tags already provide more frequent
records. For slow-releasing projects, weekly snapshots create more observation
opportunities, but preserve a malicious branch state only when it overlaps a run.
Even then, they provide branch-tip verifiability and a forensic record, not
detection of the injection itself.

So the answer to "which strategy covers more" is that tag-plus-re-verification
covers more of what the taxonomy actually contains without an on-chain transaction
fee, while
tag-plus-snapshots covers a different and narrower thing that is worth having
only where the release cadence is slow.

## Limitations

- The classification is one analyst's application of the rubric, published per
  row so individual verdicts can be disputed. The three policies share that
  judgment, so the deltas are internally consistent even where a verdict is
  arguable.
- No project in the sample releases yearly, so the strongest case for snapshots is
  the one the data cannot demonstrate.
- Cadence is a median. A project with irregular releases has a worst-case window
  much wider than its median suggests.
- Cost uses the retained no-SBOM snapshot prices. At the worst retained OP fee
  for that shape, 52 anchors cost about $0.010; the fixed `l1Fee` caveat still
  applies.
- Snapshot anchoring has now been exercised on a live network, once: OP Mainnet
  transaction
  [`0x5fb9a342…1a73`](https://optimistic.etherscan.io/tx/0x5fb9a3421140f4d07e64e3c366d05958c3e6de2f3019ab82a36ab04690aa1a73),
  `KIND_SNAPSHOT` on ref `main`, 79,216 gas against the Phase A no-SBOM tag smoke
  anchor's 79,276, with identical 228-byte calldata. That confirms the cost basis
  this record uses. It does not price the 99,512-gas OP release anchor carrying a
  non-zero SBOM hash. No schedule is running, so the cadence figures remain
  arithmetic over historical release gaps rather than observed snapshot activity.
  Both templates exist (`workflows/provenance-snapshot.yml`, weekly, and
  `workflows/provenance-reverify.yml`, daily, with GitLab twins) and
  `scripts/submit-anchor.ts` takes `--kind tag|snapshot`. They are deliberately
  not copied into `.github/workflows/`, so this repository does not schedule or
  spend on its own.
  The adopting templates are in `workflows/provenance-snapshot.yml` and
  `workflows/provenance-reverify.yml` (with GitLab twins); enabling them in CI,
  and one live smoke, are operational follow-ups rather than research ones.
