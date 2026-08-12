# How long an anchor takes to settle

Collected 2026-08-12 from the Phase A mainnet anchors of `v0.4.0-m4`.
Raw figures: `data/latency.json`.

Cost is only half of what operational viability means. This record measures the
other half: how long after a release the anchor is actually recorded, and how
long until that record is settled on Ethereum.

Read from each network's own accounting rather than inferred: `zks_getBlockDetails`
for zkSync Era, and the batch commitment fields Blockscout exposes for Arbitrum
One and OP Mainnet. Nothing was sent.

## Three different things get called "confirmed"

The distinction matters here more than it usually does, because the three answers
are seconds, minutes, and days apart.

**Inclusion on the L2.** The anchor is in a block and readable by `gpa verify`.
Bounded by the block time: roughly 0.25 s on Arbitrum, 2 s on OP and zkSync. The
CI job's submit step took about 12 seconds for all three chains together,
including signing.

**Data availability on Ethereum.** The batch containing the anchor has been posted
to L1, so the record survives the L2 operator disappearing.

**Full settlement.** The L1 contracts have accepted the state as final. For the
optimistic rollups this waits out the fraud-proof challenge window, about seven
days. For zkSync it waits for the validity proof to be verified and executed.

## Measured

| | Arbitrum One | OP Mainnet | zkSync Era |
| --- | --- | --- | --- |
| Anchor in an L2 block | 10:17:15Z | 10:17:45Z | 10:17:52Z |
| Posted to L1 | 10:20:11Z | 10:20:23Z | 10:50:30Z |
| **Time to L1 data availability** | **2 min 56 s** | **2 min 38 s** | **32 min 38 s** |
| Validity proof verified | n/a | n/a | 11:03:27Z (45 min 35 s) |
| Batch container | blob (4844) | blob (4844), 5 blobs | blob |
| Final settlement | ~7 day challenge window | ~7 day challenge window | pending execution at collection |

The two optimistic rollups posted to Ethereum in under three minutes. zkSync Era
took about half an hour to commit and three quarters of an hour to have its proof
verified, which is the expected shape: a validity proof has to be produced before
anything can be posted, and that costs real time.

## Why none of this delays a release

The anchoring workflow does not block the release. A maintainer pushes a tag, the
release proceeds, and the anchor is submitted alongside it. The only latency a
maintainer experiences is inclusion, which is seconds.

The longer horizons matter to a **verifier**, and they matter asymmetrically. A
consumer checking a release years later is reading a long-settled record, so the
seven-day window is irrelevant to them. It is only relevant in the narrow case of
someone verifying a release within days of it being cut, and even then the L2
record is already readable and already public. The window governs how long it
would take to *undo* a wrongly settled state, not how long until the anchor is
useful.

This is the practical difference between a provenance workload and a financial
one. A trade needs finality before value moves. An anchor needs only to exist,
publicly, before anyone consults it.

## Against the comparator

Chapter 3 names PineSU (Grilli and Speziali 2024) as the latency baseline, at
roughly 15 minutes to finality on Ethereum mainnet.

Both optimistic rollups reach L1 data availability in about a fifth of that.
zkSync Era is roughly twice PineSU's figure to commit. But the comparison is
looser than it looks, because the two systems are not measuring the same event:
PineSU's figure is mainnet inclusion and confirmation, whereas the numbers here
separate a fast L2 record from a slower L1 settlement. The honest reading is that
Layer-2 anchoring gives a usable record faster than mainnet anchoring did, while
deferring full settlement longer, and that for this workload the first property is
the one that affects a release pipeline.

## Limitations

- One anchor per network, all submitted within the same half hour. These are
  single observations, not a distribution, and batch posting intervals vary with
  network activity.
- The seven-day challenge window is a protocol constant, not something measured
  here.
- zkSync's execution step was still pending at collection. Re-reading
  `zks_getBlockDetails` for L2 block 71529888 later would complete the record.
- Inclusion latency is inferred from block times and the CI submit step rather
  than instrumented per chain. Timing a submission directly would sharpen it.
