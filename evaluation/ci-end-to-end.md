# End-to-end anchoring from CI

Recorded from [run 30469899916](https://github.com/EpaphrasSam/git-provenance-anchor/actions/runs/30469899916),
triggered 2026-07-29T16:15:47Z by pushing tag `v0.3.0-m3`.

## What this demonstrates

The claim being tested is that anchoring is unattended: a maintainer pushes a
tag, and everything else — computing the tree hash, generating an SBOM, signing
and submitting transactions to every configured chain — happens without a human
present or a developer's key on a developer's machine. If that only worked when
run by hand locally, the adoption argument would collapse, because the whole
point is that a release pipeline does it rather than a person remembering to.

## Result

The run succeeded on the first attempt. All eleven steps green, 35 seconds
wall-clock for the job:

| Step | Duration |
| --- | --- |
| Set up job | 1s |
| Resolve target tag | 1s |
| Checkout tagged state | <1s |
| Setup Node.js | 5s |
| Install dependencies (`npm ci`) | 9s |
| Compute tree hash | <1s |
| Install Syft | 2s |
| Generate CycloneDX SBOM | 2s |
| Upload SBOM artifact | <1s |
| Submit anchors (both chains) | 8s |
| Verify the anchor just written | 2s |

Anchoring to two chains took 8 seconds, and the pipeline then verified its own
work before finishing. Total overhead added to a release is well under a minute,
which is the number that matters for whether a team tolerates the tool.

## What it wrote

| | Arbitrum Sepolia | OP Sepolia |
| --- | --- | --- |
| Anchor transaction | `0xa6746211c2850f772e1588ea8fd7144f69cb52b4e063b2ac89aa2038a9e5119c` | `0xb4b718d291afe83de1dfa2176d509696edc815cf6705624a8a840631b2361997` |
| Tree hash | `008e66dbe108d6bc46b9030b83f04af58187e5ca` | same |
| SBOM hash | `0x749860581b44f7977d7eb9e6f454acb8ed27f145593e849a019151c695d79389` | same |
| Gas used | 99,548 | 99,548 |

Both anchors verify green today via
`gpa verify --tag v0.3.0-m3 --ref v0.3.0-m3 --network <network>`.

## Key handling

The workflow signs with `ANCHOR_DEPLOYER_KEY`, a repository secret holding a key
generated solely for CI. It is allowlisted for this project identifier and holds
only enough testnet ETH to submit anchors. It is not the deployer key and is not
the project owner, so it cannot change the allowlist or transfer ownership — the
most a compromise of it achieves is writing a wrong anchor, which is attributable
because the anchor records its submitter address, and revocable via
`allowlistRemove` by the owner.

## Cross-reference

The tree hash in this run is the same value Windows and WSL compute locally for
the same tag, which is recorded separately in `cross-platform-determinism.md`.
Since this run committed the value on-chain before either local check was made,
the agreement is not something that can be arranged after the fact.

## Scope

One successful run on one small repository. It does not characterise behaviour on
a large repository, on a repository using Git LFS in earnest, or under a
concurrent-tag race, and it does not test the GitLab CI twin under
`workflows/provenance-anchor.gitlab-ci.yml`, which remains untested against a
live GitLab instance.
