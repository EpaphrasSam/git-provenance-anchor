# End-to-end anchoring from CI

Primary evidence: [run 30483333326](https://github.com/EpaphrasSam/git-provenance-anchor/actions/runs/30483333326),
triggered 2026-07-29T19:11:53Z by pushing tag `v0.4.0-m4`.

Earlier two-chain run (before zkSync): [run 30469899916](https://github.com/EpaphrasSam/git-provenance-anchor/actions/runs/30469899916) for `v0.3.0-m3`.

## What this demonstrates

The claim being tested is that anchoring is unattended: a maintainer pushes a
tag, and everything else — computing the tree hash, generating an SBOM, signing
and submitting transactions to every configured chain — happens without a human
present or a developer's key on a developer's machine. If that only worked when
run by hand locally, the adoption argument would collapse, because the whole
point is that a release pipeline does it rather than a person remembering to.

## Result

The three-chain run succeeded. All steps green, 49 seconds wall-clock:

| Step | Duration |
| --- | --- |
| Set up job | ~1s |
| Resolve target tag | <1s |
| Checkout tagged state | ~1s |
| Setup Node.js | ~5s |
| Install dependencies (`npm ci`) | ~10s |
| Compute tree hash | <1s |
| Install Syft | ~2s |
| Generate CycloneDX SBOM | ~2s |
| Upload SBOM artifact | <1s |
| Submit anchors (three chains) | ~12s |
| Verify the anchor just written | ~2s |

`GPA_NETWORKS` was `opSepolia arbitrumSepolia zkSyncSepolia`. The submit step
logged all three networks and used the dedicated CI key
`0x1318dA3655688daeFc4DA89ABAeDA33eA4A6e341` on each. The verify step then
reported `match=true` on every network before the job finished.

## What it wrote

| | OP Sepolia | Arbitrum Sepolia | zkSync Sepolia |
| --- | --- | --- | --- |
| Registry | `0x253F20c2…72622` | `0x253F20c2…72622` | `0x49eD55AD…1fDAB` |
| Anchor transaction | `0x95cbe9599e765b9030c2b0eb08ba97f43c0036c22c9e4f2c485c856185ea8bfc` | `0xbacc202a94f573940e6046c2807329c0e5280a61cd508daf4414eecfddeaf952` | `0x34295b46d3646d9bf301da64f565c0f499deda928dc49a12d7fce60d6a733254` |
| Tree hash | `bfc4700b1f0376c4a19722440a3c132fea20681b` | same | same |
| Submitter | CI key | CI key | CI key |
| Revision | 1 | 1 | 1 |

Local re-check after the run:

```
status: pass
opSepolia: rev=1 match=true
arbitrumSepolia: rev=1 match=true
zkSyncSepolia: rev=1 match=true
```

## Key handling

The workflow signs with `ANCHOR_DEPLOYER_KEY`, a repository secret holding a key
generated solely for CI. It is allowlisted for this project identifier on every
target network and funded with only enough testnet ETH to submit anchors. It is
not the deployer key and is not the project owner, so it cannot change the
allowlist or transfer ownership — the most a compromise of it achieves is writing
a wrong anchor, which is attributable because the anchor records its submitter
address, and revocable via `allowlistRemove` by the owner.

zkSync required an extra funding step after the registry was deployed there
(`scripts/fund-ci-zksync.ts`), and `GPA_NETWORKS` had to be extended to include
`zkSyncSepolia`. Until both were done, CI continued to skip that chain even
though the deployment record existed.

## Scope

One successful three-chain run on this repository. It does not characterise
behaviour on a large repository, on a repository using Git LFS in earnest, or
under a concurrent-tag race, and it does not test the GitLab CI twin under
`workflows/provenance-anchor.gitlab-ci.yml`.
