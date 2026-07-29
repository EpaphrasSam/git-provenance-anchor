# zkSync Era Sepolia deployment

Deployed 2026-07-29 at commit `ae0ba8d`.
Registry: `0x49eD55AD9Ae06f4652cA0082D861Cd4B0aB1fDAB` (chain ID 300).

## Why a separate deployment

Arbitrum and OP Sepolia are EVM-equivalent: the same `solc` bytecode runs on both,
and gas units match to the digit. zkSync Era runs EraVM. Contracts are compiled
with `zksolc`, deployed through a different path, and gas is accounted under a
different model. None of the Arbitrum/OP figures transfer. This deployment exists
so those differences are measured rather than assumed.

## Toolchain

| Component | Version |
| --- | --- |
| `@matterlabs/hardhat-zksync-solc` | 1.5.1 |
| `@matterlabs/hardhat-zksync-deploy` | 1.8.0 (installed; linker unused, see below) |
| `zksync-ethers` | 6.21.2 |
| `zksolc` | 1.5.15 |
| `zkvm-solc` | 0.8.28-1.0.2 |
| Solidity source | 0.8.28 |

Pinned together deliberately: the solc plugin validates `zksolc` against a remote
allow-list, so bumping one without the other can break compile with no source change.

## Dual compile

zkSync and EVM share one Hardhat project. Compiling for zkSync regenerates
TypeChain from EraVM artifacts, which then breaks the EVM test suite. The
workaround is mechanical:

```bash
npm run build      # EVM, regenerates typechain-types
npm run build:zk   # EraVM into artifacts-zk/, --no-typechain
npm test           # forces an EVM compile first
```

`artifacts-zk/` and `cache-zk/` are git-ignored, same as their EVM counterparts.

## Deploy path

`hardhat-zksync-deploy`'s linker shells out to `zksolc --link` without quoting the
artifact path. This repository lives under `MPhil Thesis`, and that space makes
the linker fail with "The system cannot find the file specified" even when the
`.zbin` is present.

`AnchorRegistry` has no factory dependencies, so linking is unnecessary.
`scripts/deploy-zksync.ts` deploys with `zksync-ethers` `ContractFactory` against
the compiled artifact directly. That is the supported path here; reintroduce the
Deployer linker only if a future contract gains factory deps, and then only from
a working directory whose path has no spaces.

## Observed

| | value |
| --- | --- |
| Deploy tx | `0xd22c5054b7857177d2fd125c8d73d1025005b7e2cf39cb1b40bcbff57c08687b` |
| Deploy gas used | 1,845,217 |
| Register project | `0x45dc79484a576562a004403f22097a2c4428c861b71a370b8f1b7885c9b7ea0a` |
| Allowlist CI key | `0x0646355d48509357db39ac2734c688fe66a8d039e7ce5e2681febc156256b61c` |
| Anchor `v0.3.0-m3` | `0x29b8eab8a43fb07fbda8ec95ee4729d33386be5db50ca2db163298962fb67f97` |
| Anchor gas used | 114,173 |
| Tree hash | `008e66dbe108d6bc46b9030b83f04af58187e5ca` |
| Access-control reject tx | `0x6071c58858ace47a5191942127a56bb12269f490ff6c2516be8f1c511608c80c` |
| Reject gas burned | 97,752 |

`gpa verify --tag v0.3.0-m3 --ref v0.3.0-m3 --network zkSyncSepolia` matches.
An unauthorised account reverts with `NotAllowlisted` on this deployment too.

## Gas units are not comparable to EVM

The deploy "gas used" figure is roughly twice the EVM deployment. That does not
mean zkSync is twice as expensive — EraVM gas units and fee markets are different
instruments. Report zkSync costs in their own column; do not ratio them against
Arbitrum or OP figures. Currency conversion still needs the live zkSync fee model
(L2 gas price plus the published-data component), which is not yet implemented.

## Funding

```bash
npx ts-node --transpile-only scripts/bridge-zksync.ts --amount 0.008
```

Bridges Sepolia ETH through the official deposit path. Credits typically appear
on L2 within a few minutes; the script polls balance rather than waiting on
finalization, which can hang.
