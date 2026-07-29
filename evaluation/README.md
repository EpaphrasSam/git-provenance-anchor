# Measured properties

Claims this project makes about itself, with the evidence behind them and a
command to reproduce each one. Where a figure came from an event that cannot be
re-run — a transaction already mined, a CI run already finished — the transaction
hash or run URL is recorded so it can be checked independently.

If you deploy your own registry, the scripts here work against it too. They are
operator tooling, not just documentation of this deployment.

## Records

| File | Claim | Reproduce |
| --- | --- | --- |
| `access-control.md` | A live deployment refuses anchors from accounts outside the project allowlist | `npm run check:access-control -- --send` |
| `cross-platform-determinism.md` | The anchored tree hash is identical on Windows, Linux, a CI runner, and an independent reimplementation | `scripts/tree-hashes.sh` on each platform |
| `ci-end-to-end.md` | A tag push anchors on-chain with no human in the loop | push a `v*` tag; run URL recorded |
| `gas-and-cost.md` | Gas per operation, why anchoring with an SBOM costs ~20k more, and how these differ from the test-suite figures | `npm run evidence` |
| `workflow-tamper-protection.md` | Which GitHub branch protection configuration actually prevents the anchoring workflow being edited, and which only appears to | manual `gh api` calls, recorded in the file |

## Raw data

| File | Produced by |
| --- | --- |
| `data/on-chain-evidence.json` | `npm run evidence` |
| `data/access-control.json` | `npm run check:access-control -- --send` |

Both stamp the commit they were collected at, so a figure can be tied to a
specific state of the source. Neither requires a funded account, except for
`--send`, which broadcasts and therefore needs gas.

A simulated access-control run writes to `data/access-control-simulated.json`,
which is git-ignored. The two modes use separate filenames deliberately: a free
simulated run must not overwrite a broadcast record, whose transaction hashes
cannot be regenerated without spending again.

## Deployments measured

| Network | Chain ID | Registry |
| --- | --- | --- |
| Arbitrum Sepolia | 421614 | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` |
| OP Sepolia | 11155420 | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` |

Both compiled with solc 0.8.28, optimizer enabled at 200 runs. Full deployment
records, including gas and block numbers, are under `deployments/`.

## Two kinds of claim

Most of what is recorded here is a property of this software: the allowlist check
and the determinism of the tree hash are things the code does, and anyone can
verify them from the chain and the repository.

`workflow-tamper-protection.md` is different. It documents a property of GitHub,
and exists to justify a configuration recommendation rather than to evidence a
feature. The registry cannot prevent a workflow file being edited — that is a
hosting-platform capability. What it can do is make the edit visible, because the
workflow file sits inside the anchored tree. Presenting the platform setting as a
capability of this system would overstate what the design achieves.

## Not yet measured

Listed so the gaps are visible rather than discovered late.

- **zkSync Era.** No deployment. Needs the `@matterlabs/hardhat-zksync` toolchain
  with `zksolc` pinned to a compatible version, which is why Hardhat is held at
  2.x. Its gas figures cannot be extrapolated from the two EVM rollups.
- **Mainnet cost.** Gas units are measured; converting them to currency needs live
  mainnet base fee and blob base fee applied to the units and the 228-byte
  calldata size. No mainnet transactions required.
- **Verification latency.** Wall-clock time to verify a release, and how tree
  hashing scales with repository size, are both unrecorded.
- **Scale.** Every measurement comes from this repository, which is small.
  Behaviour on a large history, or one using Git LFS substantially, is unknown.
- **GitLab CI.** The twin workflow under `workflows/` has never run against a live
  GitLab instance.
