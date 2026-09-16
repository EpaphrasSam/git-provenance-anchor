# Git SHA-1 and SHA-256 object-format compatibility

Collected 2026-09-16. Local fixtures only. Raw ledger:
`data/sha256-compat.json`.
Reproduce: `npx hardhat run scripts/sha256-compat.ts --network hardhat`.

Two temporary repositories with the same files (`README.md` and `src/main.txt`),
one `git init --object-format=sha1` and one `--object-format=sha256`. Git
2.54.0. The contract run uses in-process Hardhat, not a live network, and does
not change `v1.0.1`.

SHA-1 was inherited from Git's default object format in the evaluated
repositories. It was not chosen as a preferred modern hash for a new protocol.
The contract stores `bytes32`, which is wide enough for a SHA-256 object id.
Width is not compatibility. The evaluated verifier rebuilds trees with SHA-1.

## Result

| Step | SHA-1 repo | SHA-256 repo |
| --- | --- | --- |
| `git rev-parse <tag>^{tree}` | pass (40 hex) | pass (64 hex) |
| Pack into `bytes32` | pass (12-byte left pad) | pass (raw 32 bytes) |
| Decode `bytes32` back to hex | pass | pass |
| `hashGitRef` matches Git | pass | fail |
| `hashDirectory` matches Git | pass | fail |
| `git archive` then `hashArtifact` matches Git | pass | fail |
| Local `AnchorRegistry.anchor` stores the packed id | pass | pass |

On the SHA-256 fixture, `git rev-parse` returned
`74ee973ab3d9bc3a9960adc33a77ab809178286dc17b0775bd4f9f27a436135d`. The contract
stored that value (79,408 gas locally). `hashGitRef` returned a 40-character
SHA-1 string (`bc8ecf7ea211a512f15262081956b47866457d36`). `hashDirectory` and
`hashArtifact` returned `5b0a5752fc3490cbc1ed2d0f62a3dc3b6eb67dd6`, which is the
SHA-1 tree hash of the same files in the SHA-1 fixture. The hasher ignored Git's
object format and hashed content the SHA-1 way.

A future SHA-256 Git repository can therefore have its id extracted and stored.
Verification that reconstructs a tree will not match that id. Supporting that
format later needs the object-format algorithm recorded with the identifier, not
a wider slot alone.

Git's own collision-detection for SHA-1 is a separate property of Git. It does
not make this commitment scheme equivalent to SHA-256.

## What this does not change

The twelve sampled projects and tag `v1.0.1` are SHA-1. Cost, latency, throughput,
and Ladisa results still describe that artefact. The deployed registries are
unchanged.
