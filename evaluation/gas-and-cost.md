# Gas and cost

Collected 2026-07-29. Raw data: `data/on-chain-evidence.json`.
Re-run with `npm run evidence` — read-only, broadcasts nothing, needs no funded account.

## EVM chains: gas units are identical

| Operation | Gas units | Source |
| --- | --- | --- |
| Deploy `AnchorRegistry` | 879,549 | observed receipt, Arb + OP |
| Anchor a new tag, no SBOM hash | 79,276 | observed receipt, Arb + OP |
| Anchor a new tag with SBOM hash | 99,548 | observed receipt, Arb + OP |
| Anchor a new tag (estimate, 15-char ref) | 100,755 | `estimateGas`, Arb + OP |
| Re-anchor an existing tag | 48,791 | `estimateGas`, Arb + OP |
| `allowlistAdd` | 49,066 | `estimateGas`, Arb + OP |
| Anchor rejected as unauthorised | 28,111 | observed failed receipt, Arb + OP |

Every figure matched to the digit across Arbitrum Sepolia and OP Sepolia. That is
the expected result for two EVM-equivalent rollups running identical bytecode over
identical calldata, but having observed it is what licenses measuring gas on a
testnet and pricing it elsewhere: units are a property of the code, prices are a
property of the moment.

Calldata for an anchor is 228 bytes. The EVM deployment transaction carries 3,856.

## zkSync Era: a separate column

| Operation | EraVM gas units | Source |
| --- | --- | --- |
| Deploy `AnchorRegistry` | 1,845,217 | observed receipt |
| Anchor a new tag, no SBOM hash | 114,173 | observed receipt (`v0.3.0-m3`) |
| Anchor rejected as unauthorised | 97,752 | observed failed receipt |

These are not comparable to the EVM table. EraVM gas accounting and the fee market
(execution plus published data) are different instruments. Report them side by
side; do not form ratios. Detail of the deployment is in `zksync-sepolia.md`.

## Why the two anchor figures differ

The 20,272-gas gap between 79,276 and 99,548 is the SBOM hash. Tags `v0.1.0-m1`
and `v0.2.0-m2` were anchored by hand with `sbomHash` left at zero; `v0.3.0-m3`
was anchored by CI with a real Syft digest
(`0x749860581b44f7977d7eb9e6f454acb8ed27f145593e849a019151c695d79389`). Writing a
non-zero word into a previously zero storage slot costs 20,000 gas, while writing
zero over zero costs nothing. Recording an SBOM digest is therefore close to a
flat 20,000-gas surcharge per anchor — a design cost, not measurement noise.

The same mechanism explains why re-anchoring a reference (48,791) is roughly half
the cost of a first anchor (100,755): the slots already hold non-zero values, so
the writes are modifications rather than initialisations.

## Reconciling these with the figures from the test suite

The gas table in the main README comes from the local test suite via
`npm run test:gas`, and its numbers are slightly lower than the ones here — for
example 45,424 for a re-anchor against 48,791. The difference is calldata, not
behaviour. The reference name is passed as a string and is part of the call, so a
short fixture reference in a test costs less to submit than a real tag name. The
figures here use live tag names, and are the ones to quote for a realistic
release.

Neither set is wrong; they measure the same code with different inputs. If you
need a figure for your own repository, run `npm run evidence` against your
deployment and use the reference names you actually tag with.

## Fees paid on testnet

| Transaction | Chain | Gas price (wei) | Fee (ETH) |
| --- | --- | --- | --- |
| Deployment | Arbitrum Sepolia | 151,046,000 | 0.000132852358254 |
| Deployment | OP Sepolia | 1,000,250 | 0.00000087976888725 |
| Anchor `v0.1.0-m1` | Arbitrum Sepolia | 25,334,000 | 0.000002008378184 |
| Anchor `v0.2.0-m2` | Arbitrum Sepolia | 71,236,000 | 0.000005647305136 |
| Anchor `v0.3.0-m3` | Arbitrum Sepolia | 24,710,000 | 0.00000245983108 |
| Anchor `v0.1.0-m1` | OP Sepolia | 1,000,250 | 0.000000079295819 |
| Anchor `v0.2.0-m2` | OP Sepolia | 1,000,250 | 0.000000079295819 |
| Anchor `v0.3.0-m3` | OP Sepolia | 1,000,250 | 0.000000099572887 |

Testnet fees carry no monetary meaning. They are recorded to show the spread: the
same 79,276-gas operation cost 2.8× more in one Arbitrum Sepolia block than
another, purely because gas price moved between them. A single fee observation is
not a cost estimate.

## Not yet measured

**Mainnet pricing.** Gas units transfer from testnet to mainnet; prices do not.
Converting the units above into currency needs the live fee environment on the
target network, and on a rollup that has two components — L2 execution, and the
L1 data availability cost of publishing the batch, which depends on calldata size
and the prevailing blob base fee. The intended method reads current base fee and
blob base fee from a mainnet RPC without transacting, applies them to the gas
units and the 228-byte calldata figure, and reports a range across observed fee
conditions. Not implemented.

**zkSync fee pricing.** EraVM gas units are measured above; converting them to
currency needs zkSync's live fee model (L2 gas price plus published-data cost),
which is not yet implemented.
