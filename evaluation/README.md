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
| `deployed-bytecode.md` | The code at each recorded address is the compiled output of a named commit | `npm run verify:bytecode` |
| `zksync-sepolia.md` | EraVM deployment, toolchain pins, and why its gas is a separate column | `npm run deploy:zksync-sepolia` |
| `cross-platform-determinism.md` | The anchored tree hash is identical on Windows, Linux, a CI runner, and an independent reimplementation | `scripts/tree-hashes.sh` on each platform |
| `ci-end-to-end.md` | A tag push anchors on-chain with no human in the loop | push a `v*` tag; run URL recorded |
| `tag-retargeting.md` | Force-moving an anchored tag is flagged as `moved` by `gpa reverify` | retarget locally, then `gpa reverify` |
| `gas-and-cost.md` | Gas per operation, why anchoring with an SBOM costs ~20k more, and how these differ from the test-suite figures | `npm run evidence` |
| `mainnet.md` | Live registries on Arbitrum One, OP Mainnet, and zkSync Era, with fees actually paid for deploy / register / allowlist / smoke anchor | `gpa verify --tag v0.4.0-m4 --ref v0.4.0-m4 --network arbitrumOne --network opMainnet --network zkSyncEra` |
| `fee-distribution.md` | What an anchor would have cost at 365 points across a year on each production network, validated against the Phase A receipts | `npm run fees:all` |
| `latency.md` | How long after a release the anchor is readable, posted to L1, and settled, on each production network | `zks_getBlockDetails` and Blockscout batch fields, recorded in the file |
| `ladisa-coverage.md` | Which of the 117 attack vectors in the Ladisa et al. taxonomy this system would detect, and which it would not | `python3 evaluation/ladisa-classify.py` |
| `repository-sample.md` | Tree-hash reconstruction and verification time across twelve widely used projects, and the archive-based reconstruction defect it exposed | `npm run sample:clone`, then compare `hashGitRef` against `git rev-parse HEAD^{tree}` |
| `tarball-sweep.md` | Published release artifacts versus the anchored tree; curl/libarchive manifests clear undeclared extras; Windows `hashArtifact` mode loss on tarball verify | `npm run sample:tarballs`; diagnosis in `data/control-row-diagnosis.json` |
| `functional-validation.md` | The four properties Chapter 3 promises, as one table: unexpected content, no false positives, allowlist enforcement, tag retargeting | per-row records listed in the file |
| `workflow-impact.md` | What adopting the system costs a project: files added, config lines, manual steps, and why none of it varies by project | counts over the reference templates, plus `ci-end-to-end.md` |
| `sbom-coverage.md` | What Syft 1.51.0 plus CycloneDX actually inventories on the twelve sampled source trees, against each project's own lockfile | `npm run sample:sbom` |
| `rq2-strategies.md` | Tag-only versus tag-plus-snapshots versus tag-plus-re-verification: the rubric re-run three ways, grounded in release cadence and priced from observed fees | `python3 evaluation/rq2-ablation.py` |
| `network-tradeoffs.md` | Throughput, finality, cost and finality-security assumptions compared across the three production networks | figures drawn from `fee-distribution.md`, `latency.md`, and 30 daily block samples per network |
| `workflow-tamper-protection.md` | Which GitHub branch protection configuration actually prevents the anchoring workflow being edited, and which only appears to | manual `gh api` calls, recorded in the file |

## Raw data

| File | Produced by |
| --- | --- |
| `data/on-chain-evidence.json` | `npm run evidence` |
| `data/access-control.json` | `npm run check:access-control -- --send` |
| `data/mainnet-phase-a.json` | receipt walk after mainnet deploy / smoke (see `mainnet.md`) |
| `data/fee-distribution.json` | `npm run fees:all` (per-sample series regenerates with `npm run fees:history`) |
| `data/latency.json` | settlement timing read from each network's own batch records (see `latency.md`) |
| `data/ladisa-classification.csv` | `python3 evaluation/ladisa-classify.py`, one row per attack-tree node instance |
| `data/sample-results.json` | per-repository measurements behind `repository-sample.md` |
| `data/rq2-ablation.csv` and `data/rq2-ablation.json` | `python3 evaluation/rq2-ablation.py`, one row per vector per policy |
| `data/tarball-sweep.json` | `npm run sample:tarballs` (curl/libarchive rows after applying `fixtures/manifests/`) |
| `data/control-row-diagnosis.json` | Windows vs Linux (WSL) local `git archive` → `hashArtifact` vs `hashGitRef` for the mode-loss control rows |
| `data/sbom-coverage.json` | `npm run sample:sbom`, one Syft CycloneDX document summarised per sampled repository |

Both stamp the commit they were collected at, so a figure can be tied to a
specific state of the source. Neither requires a funded account, except for
`--send`, which broadcasts and therefore needs gas.

A simulated access-control run writes to `data/access-control-simulated.json`,
which is git-ignored. The two modes use separate filenames deliberately: a free
simulated run must not overwrite a broadcast record, whose transaction hashes
cannot be regenerated without spending again.

## Deployments measured

| Network | Chain ID | Registry | VM |
| --- | --- | --- | --- |
| Arbitrum Sepolia | 421614 | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` | EVM |
| OP Sepolia | 11155420 | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` | EVM |
| zkSync Sepolia | 300 | `0x49eD55AD9Ae06f4652cA0082D861Cd4B0aB1fDAB` | EraVM |
| Arbitrum One | 42161 | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` | EVM |
| OP Mainnet | 10 | `0x18600ECbC47aC362240b2CD87d92345eD426DC08` | EVM |
| zkSync Era | 324 | `0x49eD55AD9Ae06f4652cA0082D861Cd4B0aB1fDAB` | EraVM |

EVM deployments compiled with solc 0.8.28; zkSync with zksolc 1.5.15 / zkvm-solc
0.8.28-1.0.2. Optimizer enabled at 200 runs. Full records under `deployments/`.

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

- **Intraday fee peaks.** `fee-distribution.md` now covers a year at daily
  resolution. A denser pass over the worst days would tighten the tail, and
  Arbitrum's tail is a floor rather than a point estimate because gas units are
  held fixed there.
- **Verification latency.** Anchor settlement timing is now in `latency.md`, but
  the other side is still open: wall-clock time for `gpa verify` to check a
  release, and how tree hashing scales with repository size — partly answered by
  `repository-sample.md`, still worth a dedicated verify-path timing note.
- **Git LFS in the field.** Covered by a unit test, but no project in the sample
  used it, so real-world behaviour is unobserved.
- **Slow release cadences.** Nothing in the sample tags less often than every 98
  days, which is the case where periodic snapshots would matter most for RQ2.
