# Generated-extra adversarial boundary (schema v1)

Collected 2026-09-16. Local fixture only. Raw ledger:
`data/generated-extra-adversary.json`.
Reproduce: `npm run extras:adversary`. Stubbed on-chain tree hash. No live
network. Tag `v1.0.1` is unchanged.

Row 1b in `functional-validation.md` swaps content at a path that already
exists in the anchored Git tree. This record does the case that row left open:
two different files at one manifest-declared generated-extra path.

## Method

Temporary Git repository with one tracked file, `hello.txt`. Anchored tree
`aaa96ced2d9a1c8e72c56b253a0e2fe78393feb7`. Schema v1 manifest declares
`payload.txt` (reason and source only). Two artifacts copy `hello.txt` and add
`payload.txt`:

| Artifact | `payload.txt` bytes | SHA-256 of those bytes |
| --- | --- | --- |
| A | `payload-one\n` | `0xd1c45e9e0a9b1710f41918f7f12a4316812dfaf0984612f0d176eb8f84b6b019` |
| B | `payload-TWO\n` | `0x8a97baacc203526216dfca7758ce2a4a39a4c331672f10364b1ea8c283498fe0` |

Controls: the same extra with an empty extras list, and a swap of `hello.txt`
with the extra declared.

## Result

| Case | Status |
| --- | --- |
| Artifact A, extra declared | `pass_with_extras` |
| Artifact B, extra declared | `pass_with_extras` |
| Artifact A, extra undeclared | `fail` |
| Tracked `hello.txt` swapped | `fail` |

After exclusion, both A and B reconstructed the same tree as Git. Schema v1
authorises the path, not the bytes. A substituted extra at an already declared
path is accepted. An undeclared extra is not. A changed tracked file is not.

That is the schema v1 boundary, measured. It is not a defect in the hasher. The
manifest schema stores path, reason, and source. There is no expected digest to
disagree with.

## Schema v2 (specified, not implemented)

Do not change `manifest-schema/provenance-manifest.schema.json`. Do not retag.
The fields below are a design note for a later schema version.

`schemaVersion` becomes `2`. A hashed extra is a concrete relative path (no glob
metacharacters) plus:

```json
{
  "path": "payload.txt",
  "reason": "generated file absent from the Git tree",
  "source": "release build",
  "digestAlgorithm": "sha256",
  "digest": "0xd1c45e9e0a9b1710f41918f7f12a4316812dfaf0984612f0d176eb8f84b6b019"
}
```

`digest` is SHA-256 of the file bytes, 0x-prefixed lowercase hex, 64 hex
characters. It is not a Git blob id. The extra is not in Git, so a Git object
header would add nothing. The digest lives in the anchored manifest, which is
how the expected extra is committed without putting the extra in the tree.

Verification would still strip extras and compare the remaining tree, then hash
each concrete extra path and fail on a digest mismatch. Under that rule,
artifact A would pass against the digest above and artifact B would fail.

Globs stay path-only, as in schema v1, unless each matched file has its own
digest row. Directory extras that need authentication are listed file by file.

Who writes the digest is a separate trust question (reproducible build,
attestation, or a human recording a known-good extra). Schema v2 only binds the
bytes once that digest is in the anchored tree. That work is not in this
evaluation and is not deployed.
