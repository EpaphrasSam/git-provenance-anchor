# Evaluation evidence

Every figure the evaluation chapter cites should be traceable to a file here, and
every file here should be regenerable by a command. Where a number came from a
one-off observation that cannot be re-run — a transaction already mined, a CI run
already finished — the transaction hash or run URL is recorded so a reader can
check it independently.

## Records

| File | Covers | Regenerate |
| --- | --- | --- |
| `validation-3a-unauthorized-submitter.md` | An account outside the allowlist cannot write an anchor to either live deployment | `scripts/validate-unauthorized-submitter.ts --send` |
| `validation-3b-branch-protection.md` | Branch protection on the anchoring workflow, and the default that silently permits admin bypass | manual, `gh api` calls recorded in the file |
| `cross-platform-determinism.md` | The anchored tree hash is identical on Windows, WSL Linux, a CI runner, and an independent reimplementation | `scripts/tree-hashes.sh` per platform |
| `ci-end-to-end.md` | Tag push to on-chain anchor with no human in the loop | push a tag; run URL recorded |
| `gas-and-cost.md` | Gas units per operation, fees paid, and why the two anchor figures differ | `scripts/collect-evidence.ts` |

## Raw data

| File | Produced by |
| --- | --- |
| `data/on-chain-evidence.json` | `scripts/collect-evidence.ts` |
| `data/validation-3a-unauthorized-submitter.json` | `scripts/validate-unauthorized-submitter.ts` |

Both record the commit they were collected at, so a figure can be tied to a
specific state of the source.

## Deployments under test

| Network | Chain ID | Registry |
| --- | --- | --- |
| Arbitrum Sepolia | 421614 | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` |
| OP Sepolia | 11155420 | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` |

Both compiled with solc 0.8.28, optimizer enabled at 200 runs. Full deployment
records, including gas and block numbers, are under `deployments/`.

## Still missing

Listed so the gaps are visible rather than discovered late.

- **zkSync Era.** No deployment. Requires the `@matterlabs/hardhat-zksync`
  toolchain with `zksolc` pinned to a compatible version, which is why Hardhat is
  held at 2.x. Its gas figures cannot be extrapolated from the two EVM rollups.
- **Mainnet cost model.** Gas units are measured; converting them to currency
  needs live mainnet base fee and blob base fee applied to the units and the
  228-byte calldata size. No mainnet transactions are needed for this.
- **Verification latency.** Never measured. Wall-clock time to verify a release,
  and how tree hashing scales with repository size, are both unrecorded.
- **Scale.** All measurements come from this repository, which is small. Behaviour
  on a large history, or on a repository using Git LFS substantially, is unknown.
- **GitLab CI.** The twin workflow under `workflows/` has never run against a live
  GitLab instance.
- **Comparison.** No side-by-side against Sigstore or in-toto.

## A note on what these records can and cannot support

Two of the items here are properties of the artifact: the allowlist check and the
determinism of the tree hash are things this code does, and they are verifiable by
anyone from the chain and the repository. Branch protection is not — it is a
property of the hosting platform, and the record exists to justify a
recommendation to adopters rather than to evidence a feature. Keeping that
distinction visible matters, because presenting a platform setting as a system
capability would overstate what the design achieves.
