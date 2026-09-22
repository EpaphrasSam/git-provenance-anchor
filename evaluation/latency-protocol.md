# Repeated production latency protocol

STATUS: complete. Fifteen references and 45 network observations were
collected. Results are in `latency-series.md`; the raw ledger is
`data/latency-series.json`. This protocol does not replace `latency.md`,
which retains the single 2026-08-12 observation for comparison.

## What is being measured

Each observation is one `anchor` call of kind `SNAPSHOT` on each of Arbitrum One,
OP Mainnet, and zkSync Era. For every transaction we record:

- wall-clock time at submission
- client-observed confirmation time (submission start until the receipt
  reaches the collector)
- L1 data-availability time, when the batch is posted (Blockscout for Arb/OP,
  `zks_getBlockDetails` for zkSync)
- zkSync prove and execute timestamps when they appear later

The second item corrects the protocol's original wording. The collector
implemented `(Date.now() - t0) / 1000` after receipt retrieval rather
than block timestamp minus submit time. `latency-series.md` records this
deviation and uses the implemented metric.

These probes are not release provenance. The tree hash is `sha1("gpa-latency-probe:" + network + ref)`
so a later reader cannot mistake them for tag anchors of `git-provenance-anchor`.

## Project isolation

Label: `gpa-latency-eval-2026`.
Project id: `0xd2b1379c5d52861068eb3c6ab0290f45322abf572df7d99bffc0acbdee050d16`
(`ethers.id` of the label), not the production manifest id `0xd5a2d84a…264e`.

The first live run registers that project from the CI address
`0x1318dA3655688daeFc4DA89ABAeDA33eA4A6e341`. Registration makes that address
the owner of the experiment project only. The production project stays owned by
the deployer `0x52eaE29937b149B7a0f3D7516C81aD561B96c043`. The collector refuses
to sign if the key in `ANCHOR_DEPLOYER_KEY` derives to the deployer.

## Windows

Five calendar days, three windows a day, UTC:

- 08:00
- 14:00
- 20:00

One transaction per network per window. Planned total: 45 anchors, plus at most
one three-network probe and three `registerProject` calls.

Scheduled GitHub Actions may start after the cron minute. The recorded timestamps
are the ones that matter, not the cron expression.

## Caps and stop rules

| Cap | Value |
| --- | --- |
| ETH per run (three networks) | 0.001 |
| ETH for the whole series | 0.01 |
| Reverts in one run | 2, then the run stops |
| Overlapping CI use of the same key | jobs share concurrency group `gpa-ci-wallet` |

Expected cost from the retained fee distribution is far under the cap: Arbitrum
anchors have historically stayed below `2.2e-5` ETH even at the recorded max,
OP below `1.3e-7`, zkSync about `5.7e-6`. Forty-five probes plus registration
should remain well under 0.002 ETH unless fees jump.

Live writes also require repository variable `GPA_LATENCY_LIVE=true`. Without it
the scheduled job exits without broadcasting.

## Commands

```
npm run latency:dry-run
npm run latency:preflight
npm run latency:probe
npm run latency:collect
npm run latency:settle
```

Raw ledger: `data/latency-series.json`. A follow-up settle job fills L1 fields
that were still pending when the submit job ended. zkSync posting often takes
longer than a GitHub Actions step should wait.

Recompute the retained summary without a live key or network write:

```
npm run latency:analyse
```

## What this is not

It is not a throughput experiment. It does not reconstruct the 365-point fee
series. It does not submit to the production project id.
