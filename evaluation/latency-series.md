# Five-day production latency series

Collected from 2026-09-16 to 2026-09-21. The ledger is complete. Raw
observations: `data/latency-series.json`. Recomputed summary:
`data/latency-series-summary.json`.

Reproduce the summary without sending a transaction:

```bash
npm run latency:analyse
```

This series supplements the single 2026-08-12 settlement observation in
`latency.md`. It does not replace or alter any `v1.0.1` release anchor. The
probes used the separate project `gpa-latency-eval-2026`, the CI account,
and snapshot references that cannot be mistaken for release tags.

## Completeness

The first probe was submitted at 2026-09-16T14:04:16Z. After five elapsed
days, the 2026-09-21 14:00 job changed the ledger status to `complete`
without sending another transaction.

- 15 observation references: five each for the 08:00, 14:00, and 20:00
  UTC windows.
- One transaction per network per reference: 45 observations.
- 45 included, zero reverted, skipped, or errored.
- No missing transaction hash, L2 block, or L1 posting field.
- All 15 zkSync observations have commit, proof, and execution times.
- Total spend, including three project-registration transactions:
  0.000117706844998007 ETH, or 1.177% of the 0.01 ETH series cap.

## Metric correction

The protocol initially described L2 inclusion as the L2 block timestamp
minus the local submission timestamp. The collector actually stores
`(Date.now() - t0) / 1000` after the transaction receipt arrives. This is
the wall-clock delay observed by the submitting client. It includes
submission, RPC communication, inclusion, and receipt retrieval.

The field is therefore reported as **client-observed confirmation time**.
It is not a pure block-production interval. The 26.086-second zkSync
maximum illustrates the difference: the L2 block timestamp is in the same
second as submission, while the client waited longer for the receipt.

L1 data-availability time is a different metric. It is the recorded L1
posting timestamp minus the L2 block timestamp.

All percentiles below use nearest rank over 15 observations per network.

## Client-observed confirmation

| Network | Minimum | Median | p90 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Arbitrum One | 4.511 s | 4.960 s | 5.646 s | 7.344 s |
| OP Mainnet | 2.651 s | 6.261 s | 6.898 s | 7.555 s |
| zkSync Era | 0.779 s | 4.856 s | 5.127 s | 26.086 s |

All 45 transactions produced receipts. For this submitting client, a
verifier could query the newly written L2 record within seconds. The
three networks did not separate operationally at this stage.

## Posting to Ethereum

| Network | Minimum | Median | p90 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Arbitrum One | 34 s | 94 s | 145 s | 154 s |
| OP Mainnet | 26 s | 70 s | 172 s | 222 s |
| zkSync Era commit | 1,452 s | 2,244 s | 2,482 s | 2,671 s |

Arbitrum and OP posted every observed batch within four minutes. Their
ranges overlap, so these 15 observations do not justify a stable
latency ranking between them. zkSync commitment took 24 minutes 12
seconds to 44 minutes 31 seconds, with a median of 37 minutes 24
seconds.

## zkSync validity stages

Times below run from the L2 block timestamp.

| Stage | Minimum | Median | p90 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Committed | 1,451.887 s | 2,244.166 s | 2,482.204 s | 2,671.050 s |
| Proven | 2,217.611 s | 3,189.633 s | 3,992.030 s | 5,442.479 s |
| Executed | 13,356.622 s | 14,277.878 s | 14,569.073 s | 14,719.131 s |

The median proof time was about 53 minutes 10 seconds. Median execution
was about 3 hours 58 minutes. The August record had no execution time;
this series supplies 15 complete executions.

Arbitrum and OP full settlement still follows their optimistic challenge
period, approximately seven days. That period is a protocol property,
not an elapsed time measured by this five-day collector.

## Comparison with the August observation

| Stage | August single observation | Five-day range | Within range? |
| --- | ---: | ---: | --- |
| Arbitrum to L1 | 176 s | 34 to 154 s | No, August was 22 s slower than the series maximum |
| OP to L1 | 158 s | 26 to 222 s | Yes |
| zkSync commit | 1,958 s | 1,452 to 2,671 s | Yes |
| zkSync proof | 2,735 s | 2,218 to 5,442 s | Yes |

The August observation had the right network-level shape. Arbitrum and
OP posted in minutes, while zkSync committed in tens of minutes. The
five-day data show the variation hidden by the first observation and
complete zkSync's execution stage.

## What can be compared with Ethereum L1

The paid Ethereum `v1.0.1` anchor in `ethereum-mainnet.md` is a
same-shape **cost** comparator. No repeated direct-Ethereum submission
latency series was collected, so this record does not turn that receipt
into a latency distribution.

Chapter 3 also names PineSU's approximate 15-minute Ethereum-mainnet
finality as a literature comparator. The events are not identical:

- L2 client confirmation here is receipt availability, not Ethereum
  finality.
- Arbitrum and OP L1 posting occurred sooner than 15 minutes in every
  observation, but their optimistic challenge periods remained.
- zkSync commitment often took longer than 15 minutes, and proof and
  execution were later again.

The supported conclusion is stage-specific. L2 anchoring makes a
queryable record available within seconds and defers Ethereum-backed
posting and settlement according to the rollup design. It does not show
that every L2 finality stage is faster than a direct L1 transaction.

## Implication

The result strengthens the operational evidence. The evaluation now has
a balanced, short distribution rather than one settlement example. It
supports median, p90, and range statements for the submitting client,
L1 posting, and zkSync validity stages.

The claim remains bounded. Fifteen observations per network over five
days do not establish annual or congestion-tail latency, direct
same-shape Ethereum latency, or a universal network ranking. The series
also measures one CI account, RPC configuration, and sequential
submission path. Cost, L1 posting, and finality assumptions remain the
meaningful network-selection criteria for this workload.
