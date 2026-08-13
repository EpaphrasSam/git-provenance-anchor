# What a first-write release anchor costs across a year

Collected 2026-08-12. Retained aggregate figures:
`data/fee-distribution.json`.
To reconstruct a new raw-compatible series over the same window, run
`npm run fees:history -- --end 2026-08-12T10:44:09Z`, then
`npm run fees:analyse`.

The archived arithmetic fixture can be checked without network access:
`npm run fees:analyse -- --in fee-arithmetic-input.json --out fee-arithmetic-output.json`.
It reproduces the v1.0.1 revision-1 OP receipt total of 1.01805679742e-7 ETH from
99,512 gas, the 366-wei block base fee, the observed 0.001-gwei priority fee, and
the separate 2,257,258,350-wei `l1Fee`.

`mainnet.md` records what four transactions cost on one afternoon. That is a
single observation, and a single observation says nothing about the tail. This
record prices an anchor at 365 points across the preceding year on each of the
three production networks, so the claim becomes a distribution rather than an
anecdote.

## Method

A release anchor's gas units are a property of the code and calldata. The v1.0.1
revision-1 receipts with non-zero SBOM hashes used 100,095 gas on Arbitrum One,
99,512 on OP Mainnet and 125,161 on zkSync Era. Those are the
transaction shapes priced here. The gas price is a property of the moment.
Every historical price is still readable from block headers, so the distribution
is recovered backwards rather than accumulated forwards.

One block was sampled per day for 365 days on each network, matched to within ten
minutes of the target time, plus Ethereum L1 for context. No gaps: 365 of 365
samples were reported on every network. The original block-level series was not
archived, so these completeness and distribution figures survive as aggregate
records rather than independently inspectable sample rows.

**These figures are counterfactual.** They are what a first-write release anchor
with a non-zero SBOM hash would have cost had it been submitted at that moment,
not a fee anyone paid. The v1.0.1 revision-1 receipts validate the fee arithmetic
below using their own gas usage.

## Validation against v1.0.1 revision-1 transactions

| Network | Paid | Reconstructed from that block's base fee | Error |
| --- | --- | --- | --- |
| Arbitrum One | 2.00550342e-6 ETH | 2.00550342e-6 ETH | 0.00% |
| zkSync Era | 5.66353525e-6 ETH | 5.66353525e-6 ETH | 0.00% |
| OP Mainnet | 1.01805679742e-7 ETH total | 1.01805679742e-7 ETH | 0.00% |

These checks use the final revision-1 gas values: 100,095, 99,512 and 125,161.
On Arbitrum and zkSync the sender paid exactly the block's base fee. OP used an
effective gas price of 1,000,366 wei against a 366-wei block base fee, giving a
1,000,000-wei priority fee. Adding the separate `l1Fee` reproduces the total:
`99512 * (366 + 1000000) + 2257258350 = 101805679742` wei.

## Results

### Arbitrum One

| | ETH | USD approx |
| --- | --- | --- |
| Minimum | 1.001e-6 | $0.0019 |
| p50 | 2.002e-6 | $0.0038 |
| p90 | 2.021e-6 | $0.0038 |
| p99 | 7.715e-6 | $0.0147 |
| Worst observed | 2.194e-5 | $0.0417 |

The worst day in the year was 25 December 2025, at roughly eleven times the
median. The tail is where congestion shows: p50 and p90 are almost identical,
then p99 is nearly four times the median. Even so, the worst single day of the
year prices a release anchor at about four cents.

The monthly medians move once, from 1.001e-6 to about 2.003e-6 in January 2026.
That is not congestion. It is the network's minimum base fee moving from 0.01 to
0.02 gwei. Worth reading as a reminder that a rollup's pricing floor is a policy
setting that changes, and a figure quoted without its date has a shelf life.

### OP Mainnet

The historical reconstruction uses 99,512 gas from the v1.0.1 revision-1 write,
the observed priority fee of 1,000,000 wei
(0.001 gwei) and the observed `l1Fee` of 2,257,258,350 wei. Both are fixed across
the series. The retained block base fees vary from 272 to 240,889 wei, with a
median of 477 wei.

| | ETH | USD approx |
| --- | --- | --- |
| Minimum | 1.0179633e-7 | $0.000193 |
| p50 | 1.0181673e-7 | $0.000193 |
| p90 | 1.0223577e-7 | $0.000194 |
| p99 | 1.1835482e-7 | $0.000225 |
| Worst observed | 1.2574060e-7 | $0.000239 |

Worst over median is 1.23. This spread reflects the archived base-fee aggregates
only. The fixed `l1Fee` means the result does not capture historical variation
in OP's Layer-1 posting charge.

The OP receipt's `l1Fee` is 2.257258350e9 wei, so the true total is
1.01805679742e-7 ETH and the L1 share is 2.22%. Its effective gas price was
1,000,366 wei against a 366-wei base fee, so its priority fee was 1,000,000 wei,
or 0.001 gwei. These are the fixed inputs used in the historical counterfactual.

### zkSync Era

The base fee was **identical in all 365 samples**: 45,250,000 wei, or 0.04525
gwei, every day for a year. One distinct value across the whole window.

| | ETH | USD approx |
| --- | --- | --- |
| Every sample | 5.66353525e-6 | $0.0108 |

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

Release anchoring costs about 0.019 cents at the median on OP Mainnet, 0.38 cents
on Arbitrum One, and 1.08 cents on zkSync Era. The worst sampled Arbitrum day
prices the transaction at approximately 4.17 cents. The daily series is not
evidence about unsampled intraday peaks.

## Limitations

- Daily resolution can miss intraday peaks. A dense pass over the worst days
  would tighten the tail:
  `npm run fees:history -- --days 30 --interval 2 --out fee-history-dense.json`
- Arbitrum's figures hold the v1.0.1 100,095-gas release shape fixed. Nitro
  charges L1 posting as extra gas units inside `gasUsed`. When L1 posting is
  expensive the real transaction burns more units, so the Arbitrum tail here is
  a floor rather than a point estimate.
- OP's priority fee is fixed at the observed 1,000,000 wei and `l1Fee` is held
  at its single observed value rather than reconstructed across time, so the
  spread does not capture variation in either input.
- The original per-sample raw series and exact block identifiers were not
  archived. A pinned `--end` reconstructs a 365-point series over the same window,
  but it does not independently reproduce the original block selection.
- USD figures use one approximate rate of $1900/ETH and are illustrative.
