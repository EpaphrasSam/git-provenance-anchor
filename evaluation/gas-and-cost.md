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

## Mainnet fees (one session)

Live deploy / register / allowlist / smoke-anchor fees paid on Arbitrum One,
OP Mainnet, and zkSync Era are recorded in `mainnet.md` and
`data/mainnet-phase-a.json` (2026-08-12). EVM gas units on those receipts match
the testnet column to normal calldata variation; zkSync remains its own column.

A **distribution** over time is no longer open. `fee-distribution.md` prices an
anchor at 365 daily points across a year on each production network, validated to
the digit against these same receipts, and `npm run fees:all` regenerates it.

Oracle-only pricing, reading historical base fees and multiplying by known gas
units without transacting, is what that record does and is implemented in
`scripts/fee-history.ts` and `scripts/fee-analyse.ts`.

One caveat that belongs with any OP figure quoted from a receipt: ethers'
`receipt.fee` is `gasUsed x gasPrice` and omits OP Stack's separate `l1Fee`, so an
OP anchor's true total is 8.118e-8 ETH rather than the 7.9e-8 the L2 component
alone suggests, with L1 at 2.29%. Arbitrum and zkSync price L1 costs inside
`gasUsed`, so their receipt figures are already complete.
