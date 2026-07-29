# Gas and cost measurements

Collected 2026-07-29 at commit `91835dc`.
Raw data: `data/on-chain-evidence.json`.
Regenerate with `npx ts-node --transpile-only scripts/collect-evidence.ts` (read-only; broadcasts nothing).

## Gas units are identical on both chains

| Operation | Gas units | Source |
| --- | --- | --- |
| Deploy `AnchorRegistry` | 879,549 | observed receipt, both chains |
| Anchor a new tag, no SBOM hash | 79,276 | observed receipt, both chains |
| Anchor a new tag with SBOM hash | 99,548 | observed receipt, both chains |
| Anchor a new tag (estimate) | 100,755 | `estimateGas`, both chains |
| Re-anchor an existing tag | 48,791 | `estimateGas`, both chains |
| `allowlistAdd` | 49,066 | `estimateGas`, both chains |
| Rejected anchor from an unauthorised account | 28,111 | observed failed receipt, both chains |

Every figure above matched to the digit across Arbitrum Sepolia and OP Sepolia.
That is the expected result — both are EVM-equivalent rollups executing identical
bytecode over identical calldata — but it is worth having observed rather than
assumed, because it is what licenses measuring gas on testnet and pricing it
elsewhere. Calldata for an anchor is 228 bytes; the deployment transaction
carries 3,856 bytes.

## Why the two anchor figures differ

The 20,272-gas gap between 79,276 and 99,548 is the SBOM hash. Tags `v0.1.0-m1`
and `v0.2.0-m2` were anchored manually with `sbomHash` left at zero; `v0.3.0-m3`
was anchored by CI with a real Syft digest
(`0x749860581b44f7977d7eb9e6f454acb8ed27f145593e849a019151c695d79389`). Writing a
non-zero word into a previously zero storage slot costs 20,000 gas, while writing
zero over zero costs nothing. So including an SBOM digest is close to a flat
20,000-gas surcharge per anchor, and the figure is a design cost of recording the
SBOM rather than noise.

The same mechanism explains why re-anchoring an existing reference (48,791) is
roughly half the cost of a first anchor (100,755): the slots already hold
non-zero values, so the writes are modifications rather than initialisations.

## Fees actually paid on testnet

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

These are testnet fees and carry no monetary meaning. They are recorded only to
show the spread: the same 79,276-gas operation cost 2.8× more on one Arbitrum
Sepolia block than another purely because of gas price movement between them.
A single fee observation is not a cost estimate.

## Not yet done: mainnet pricing

Gas units transfer from testnet to mainnet; prices do not. Converting the units
above into a currency figure needs the live fee environment on the target
network, and on a rollup that has two components — L2 execution and the L1 data
availability cost of publishing the batch, which depends on calldata size and the
prevailing blob base fee.

The intended method is to read current mainnet base fee and blob base fee from a
mainnet RPC without transacting, apply them to the gas units and the 228-byte
calldata figure, and report a range across observed fee conditions rather than a
single number. This is not implemented yet.

## Not yet done: zkSync Era

zkSync Era cannot be priced from the table above. It runs a different virtual
machine with its own gas accounting, charges separately for published data, and
compiles through `zksolc` rather than `solc`, so both the gas units and the fee
model differ. Those figures have to be measured on a zkSync Era deployment
directly. No zkSync deployment exists yet.
