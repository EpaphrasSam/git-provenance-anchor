# Bounded production throughput burst

Collected 2026-09-16T15:37Z to 15:40Z. Raw ledger: `data/throughput-burst.json`.
Reproduce: `npm run throughput:send` (broadcasts; spend cap 0.001 ETH).

Ten sequential no-SBOM snapshot anchors on each of Arbitrum One, OP Mainnet, and
zkSync Era, signed by the CI key against the latency experiment project
`gpa-latency-eval-2026`. Dummy tree hashes, not `v1.0.1`. Ethereum mainnet was
not included.

This is the submitting client's confirmed-inclusion rate under a cap. It is not
a saturation test of sequencer or network capacity.

## Result

All 30 transactions included. No revert. Total fees 0.00006640 ETH.

| Network | Included | Wall time | Confirmed per minute | Fee (ETH) |
| --- | --- | --- | --- | --- |
| Arbitrum One | 10/10 | 64.8 s | 9.26 | 0.00001624 |
| OP Mainnet | 10/10 | 46.2 s | 12.99 | 0.00000085 |
| zkSync Era | 10/10 | 41.2 s | 14.58 | 0.00004931 |

Per-transaction inclusion was a few seconds on every chain. The rate difference
is mostly how long this script waited between receipts, not a ranking of the
three networks' maximum TPS.

## Method

Sequential `anchor` calls, unique refs `tp-{utc}-{i}`, `KIND_SNAPSHOT`, zero
SBOM hash. Cap 0.001 ETH, stop after two reverts (neither triggered). Same CI
address as GitHub Actions, run locally in a gap before the 20:00 UTC latency
window so the two jobs do not share a nonce at the same time.

## What this does not show

A 10-transaction burst does not fill Arbitrum, OP, or zkSync. EraVM and EVM gas
are still not a shared capacity unit. The figure to quote is confirmed anchors
per minute for this client, at the fees above.
