# Choosing between the three networks

Run 2026-08-12. Consolidates the retained measurements behind RQ3:
per-transaction cost, observed finality timing, and the security assumptions under
each network's finality. Cost detail is in `fee-distribution.md`, timing in
`latency.md`. The planned throughput evidence was not retained.

## The four dimensions side by side

| | Arbitrum One | OP Mainnet | zkSync Era |
| --- | --- | --- | --- |
| Median release-anchor cost | 2.0016991e-6 ETH (~$0.0038) | 1.0181673e-7 ETH (~$0.000193) | 5.6635353e-6 ETH (~$0.0108) |
| Worst observed in a year | 2.1938320e-5 ETH (~11× median) | 1.2574060e-7 ETH (~1.23× median) | 5.6635353e-6 ETH (no variation) |
| To L1 data availability | 2 min 56 s | 2 min 38 s | 32 min 38 s |
| Validity proof verified | n/a | n/a | 45 min 35 s |
| Full settlement | ~7 day challenge window | ~7 day challenge window | proof plus execution |
| First-write release-anchor gas | 100,095 (EVM) | 99,512 (EVM) | 125,161 (EraVM) |
| Proof system | fraud proofs | fraud proofs | validity proofs |

## Throughput evidence gap

Chapter 3 proposed a capacity question, but no raw block sample, collection script
or stress-test result was retained. Throughput capacity was therefore not
delivered. The anchor gas row cannot repair that omission: EraVM and EVM gas
measure different execution models, so the zkSync value is not cross-network
comparable with the Arbitrum One and OP Mainnet values.

## Security assumptions behind each finality mechanism

The three networks do not merely differ in speed and price. They ask a verifier to
believe different things, and this is where the choice actually bites.

**The optimistic pair, Arbitrum One and OP Mainnet.** Finality rests on someone
being willing and able to submit a fraud proof during the challenge window. The
assumption is economic and adversarial: at least one honest, funded watcher exists.
Neiheiser et al.'s concern about sequencer centralisation applies directly, and it
shows in the network-layer design. A censoring sequencer cannot forge an anchor,
but it can refuse to include one. An expected anchor can be noticed as absent, but
this is not a Ladisa classification: the rubric's CSV contains no
denial-of-anchoring row.

**zkSync Era.** Finality rests on a validity proof verified on L1, which is a
cryptographic assumption rather than a game-theoretic one, and is stronger in
principle: no watcher needs to be paying attention. What it substitutes is a
dependence on the proof system continuing to operate, and on the administrative
keys that can pause it. Chaliasos et al. raise this in the abstract, and zkSync
Era supplied a concrete instance on 30 July 2025, when its proof system was
manually paused over a vulnerability, causing a partial liveness failure. That is
the admin-pause risk moving from a literature concern to something that has
happened on a network this thesis targets.

Two observations from this evaluation sharpen the comparison further.

zkSync Era's L2 gas price was identical in all 365 daily samples across a year, at
0.04525 gwei. It pegs rather than floats. For a user that is pleasant, because
cost becomes perfectly predictable, but it is a policy decision by the operator,
not a market outcome, and a policy can change. Arbitrum's own minimum base fee
moved from 0.01 to 0.02 gwei in January 2026, which is the same kind of change
observed on a network that otherwise floats.

The Polygon zkEVM episode from Chapter 2 remains the sharpest case: a network
selected during scoping for being a ZK rollup was later recategorised out of that
class entirely, having lost its validity-proof system and on-chain data
availability. Trust assumptions on Layer 2 are not static properties of a network.
They are current descriptions with an expiry date.

## What this implies for deployment

Anchoring to several networks at once is the intended configuration, and the
three networks fail differently. An optimistic rollup's weak point is a sequencer
that will not include a transaction. A validity rollup's weak point is a proof
system that can be paused. One network failure can create a contradiction with
the other two. Suppressing that signal at the network layer requires all three
networks to fail consistently, returning the same false record or omitting the
same expected record. Compromise of the shared submitting key remains outside
that redundancy because it can place the same false record on every network
without any network trust model failing.

If a project must choose one, OP Mainnet has the lowest retained median cost and
the shortest observed L1 posting interval in this single sample. There is no
capacity ranking.

## Limitations

- Throughput capacity is unresolved because the block-level inputs and collection
  procedure were not retained and no stress test was run.
- EraVM gas is not directly comparable with EVM gas.
- Settlement timings are single observations per network, taken within the same
  half hour, as recorded in `latency.md`.
