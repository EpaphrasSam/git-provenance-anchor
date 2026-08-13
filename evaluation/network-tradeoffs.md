# Choosing between the three networks

Run 2026-08-12. Consolidates the measurements behind RQ3: throughput, finality,
per-transaction cost, and the security assumptions under each network's finality.
Cost detail is in `fee-distribution.md`, timing in `latency.md`. Utilisation
figures come from 30 daily block samples per network taken on 2026-08-12.

## The four dimensions side by side

| | Arbitrum One | OP Mainnet | zkSync Era |
| --- | --- | --- | --- |
| Median anchor cost | 1.594e-6 ETH (~$0.003) | 8.118e-8 ETH | 4.808e-6 ETH (~$0.009) |
| Worst observed in a year | 1.747e-5 ETH (~11× median) | 1.002e-7 ETH (1.23× median) | 4.808e-6 ETH (no variation) |
| To L1 data availability | 2 min 56 s | 2 min 38 s | 32 min 38 s |
| Validity proof verified | n/a | n/a | 45 min 35 s |
| Full settlement | ~7 day challenge window | ~7 day challenge window | proof plus execution |
| Observed throughput | 2.57 M gas/s | 5.55 M gas/s | 0.08 M gas/s |
| Anchor gas | 79,708 (EVM) | 79,276 (EVM) | 106,249 (EraVM) |
| Proof system | fraud proofs | fraud proofs | validity proofs |

## Throughput, as a capacity argument

Chapter 3 scopes this deliberately as a capacity question rather than a stress
test, because saturating a public network to see where it breaks is neither
possible nor useful here. The question is whether provenance anchoring could ever
represent a meaningful load.

One anchor is roughly 80,000 gas. Against observed throughput that is 32 anchors
per second on Arbitrum One and 70 on OP Mainnet before anchoring would equal the
network's entire current activity. On zkSync Era it is about one per second,
because that network is running at a fraction of the other two's volume.

A deliberately absurd upper bound makes the point better than a plausible one. npm
alone hosts around 3.4 million packages. If every one of them cut a release every
week, that is 5.6 releases per second, or about 448,000 gas per second of
anchoring. That would be 17.5% of Arbitrum One's current observed throughput and
8.1% of OP Mainnet's. It would exceed zkSync Era's present activity several times
over, though that is a statement about how quiet zkSync currently is rather than
about a ceiling.

Real anchoring load is orders of magnitude below that, because most packages do
not release weekly and most releases are not anchored. Throughput is not a
constraint on either optimistic network, and the honest form of the claim is a
headroom argument, not a benchmark.

One measurement note: Arbitrum One and zkSync Era both report a nominal block gas
limit of 2^50, a placeholder rather than a real capacity bound, so block
utilisation percentages are meaningless on those chains. Gas per second is used
instead, which is comparable across all three. OP Mainnet does expose a real
40 M limit and ran at about 28% median utilisation.

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

Anchoring to several networks at once is the intended configuration, and these
results support it for a reason beyond redundancy: the three fail differently. An
optimistic rollup's weak point is a sequencer that will not include your
transaction. A validity rollup's weak point is a proof system that can be paused.
When the same tree hash is anchored on all three, all three network trust models
would need to fail for the verifier to receive a network-layer contradiction.
Compromise of the shared submitting key remains outside that redundancy because it
can place the same false record on every network without any network trust model
failing.

If a project must choose one, the measurements suggest OP Mainnet on cost and
latency, Arbitrum One if the priority is the deepest activity and the most mature
fraud-proof ecosystem, and zkSync Era where a cryptographic finality argument is
worth the extra half hour and the higher per-anchor cost.

## Limitations

- Throughput figures are observed activity, not measured capacity ceilings.
  Neither optimistic network was anywhere near saturation during sampling.
- Utilisation is unavailable on two of the three networks because their reported
  gas limits are placeholders.
- Settlement timings are single observations per network, taken within the same
  half hour, as recorded in `latency.md`.
- The npm figure is an order-of-magnitude bound used to make a headroom argument,
  not an adoption estimate.
