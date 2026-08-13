# What an anchor costs, across a year

Collected 2026-08-12. Raw figures: `data/fee-distribution.json`.
Regenerate with `npm run fees:all`.

`mainnet.md` records what four transactions cost on one afternoon. That is a
single observation, and a single observation says nothing about the tail. This
record prices an anchor at 365 points across the preceding year on each of the
three production networks, so the claim becomes a distribution rather than an
anecdote.

## Method

An anchor's gas units are a property of the code and are already measured from
the Phase A receipts: 79,708 on Arbitrum One, 79,276 on OP Mainnet, 106,249 on
zkSync Era, with 228 bytes of calldata. The gas price is a property of the
moment. Every historical price is still readable from block headers, so the
distribution is recovered backwards rather than accumulated forwards.

One block was sampled per day for 365 days on each network, matched to within ten
minutes of the target time, plus Ethereum L1 for context. No gaps: 365 of 365
samples on every network.

**These figures are counterfactual.** They are what an anchor would have cost had
it been submitted at that moment, not a fee anyone paid. The Phase A
transactions are what licenses them, and the check is below.

## Validation against transactions that were actually paid for

| Network | Paid | Reconstructed from that block's base fee | Error |
| --- | --- | --- | --- |
| Arbitrum One | 1.594478832e-6 ETH | 1.594478832e-6 ETH | 0.00% |
| zkSync Era | 4.80776725e-6 ETH | 4.80776725e-6 ETH | 0.00% |
| OP Mainnet | see below | see below | see below |

On Arbitrum and zkSync the sender paid exactly the block's base fee, so the
reconstruction reproduces the receipt to the digit. OP needs a paragraph of its
own.

## Results

### Arbitrum One

| | ETH | USD approx |
| --- | --- | --- |
| Minimum | 7.971e-7 | $0.0015 |
| p50 | 1.594e-6 | $0.0030 |
| p90 | 1.609e-6 | $0.0031 |
| p99 | 6.144e-6 | $0.0117 |
| Worst observed | 1.747e-5 | $0.0332 |

The worst day in the year was 25 December 2025, at roughly eleven times the
median. The tail is where congestion shows: p50 and p90 are almost identical,
then p99 is nearly four times the median. Even so, the worst single day of the
year prices an anchor at about three cents.

The monthly medians move once, from 7.971e-7 to about 1.596e-6 in January 2026.
That is not congestion. It is the network's minimum base fee moving from 0.01 to
0.02 gwei. Worth reading as a reminder that a rollup's pricing floor is a policy
setting that changes, and a figure quoted without its date has a shelf life.

### OP Mainnet

OP's base fee is negligible: a median of 477 wei, against a 1 gwei priority fee
the sender chose in Phase A. The cost of an anchor here is set almost entirely by
the tip policy of whoever submits it and by the L1 posting fee, not by network
demand. Reconstructed on the observed tip and the observed l1Fee:

| | ETH | USD approx |
| --- | --- | --- |
| p50 | 8.118e-8 | $0.00015 |
| p99 | 9.435e-8 | $0.00018 |
| Worst observed | 1.002e-7 | $0.00019 |

Worst over median is 1.23. There is effectively no congestion risk to report.

**A correction to `mainnet.md`.** The 7.9e-8 ETH recorded there is the L2
execution component only. ethers' `receipt.fee` is `gasUsed x gasPrice`, which on
OP Stack omits the separate `l1Fee` field covering the cost of posting to L1.
Reading the raw receipt gives `l1Fee` = 1.862429623e9 wei, so the true total is
8.118e-8 ETH and the L1 share is 2.29%. Small in absolute terms, but the earlier
figure was structurally incomplete rather than merely imprecise.

### zkSync Era

The base fee was **identical in all 365 samples**: 45,250,000 wei, or 0.04525
gwei, every day for a year. One distinct value across the whole window.

| | ETH | USD approx |
| --- | --- | --- |
| Every sample | 4.808e-6 | $0.0091 |

zkSync Era holds its L2 gas price at a floor rather than letting it float with
demand, so at daily resolution an anchor has no cost distribution at all. This is
a property of the network's pricing policy, not a flat line caused by bad
sampling: the same query on Arbitrum returns a spread across three orders of
magnitude.

It also means the three networks answer the cost question in three different
ways. Arbitrum's cost floats with demand and has a real tail. OP's is dominated
by the submitter's own tip. zkSync's is administratively fixed. Comparing a
single headline number across them would hide all of that.

### Ethereum L1, for context

Base fee across the same window: p50 0.116 gwei, p90 0.409, p99 2.191, worst
observed 8.41.

Blob base fee is deliberately absent. The derivation from `excessBlobGas`
returned values that cannot be right, most likely because the update fraction
changed in a fork after the version implemented here. Left out rather than
published wrong.

## What this settles

An anchor costs a fraction of a cent at the median on Arbitrum One and OP
Mainnet. The zkSync Era median is just under one cent. The worst sampled
Arbitrum day prices the transaction at approximately 3.3 cents. These remain
small absolute costs for an event submitted a handful of times per year, but the
daily series is not evidence about unsampled intraday peaks.

## Limitations

- Daily resolution can miss intraday peaks. A dense pass over the worst days
  would tighten the tail:
  `npm run fees:history -- --days 30 --interval 2 --out fee-history-dense.json`
- Arbitrum's figures hold gas units fixed. Nitro charges L1 posting as extra gas
  units inside `gasUsed`, and the Phase A anchor spent 432 of its 79,708 units
  that way. When L1 posting is expensive the real transaction burns more units,
  so the Arbitrum tail here is a floor rather than a point estimate.
- OP's `l1Fee` is held at its single observed value rather than reconstructed
  across time, so variation in L1 conditions is not reflected in its spread.
- The per-sample raw series is not archived in this file. It regenerates exactly
  with `npm run fees:history`.
- USD figures use one approximate rate of $1900/ETH and are illustrative.
