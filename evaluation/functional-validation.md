# Functional validation: the four properties

Run 2026-08-12. Consolidates the results Chapter 3 promises as a single table.
Each row's evidence lives in its own record; this page exists because the evidence
was spread across five files and the promised table did not exist anywhere.

A Wieringa single-case mechanism experiment: pass or fail correctness
demonstrations, not statistical measurement.

## Results

| # | Property under test | How the condition was constructed | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1a | An artifact containing a file that is neither in the anchored tree nor declared in the manifest is flagged | Real published release tarballs for curl `curl-8_16_0` and libarchive `v3.8.9` compared against the anchored tree with no manifest present | Aggregate verification fails | Aggregate tree hashes differed. The sweep identified 43 additions for curl and 237 for libarchive. Pass |
| 1b | A file whose content is swapped while its name is preserved is flagged | Fixture repository with one file's content replaced, same path | Tree hash differs from the anchored value | Hash differs. Pass (`test/cli/verify-local.test.ts`) |
| 2 | Manifest declarations clear legitimate generated additions | The same two published tarballs re-run with precise manifests declaring their genuine build products | Declared additions are excluded without a blanket wildcard; any remaining aggregate difference fails verification | Declared additions were excluded for both. Omitted anchored paths remained, so both aggregate comparisons failed. Narrow pass for manifest resolution |
| 3a | The contract rejects an anchor from an account outside the project allowlist | Fresh keypair, never allowlisted, submitting a forged tree hash to the live testnet deployments, both simulated and broadcast | Revert with `NotAllowlisted`; stored anchor unchanged | Reverted on Arbitrum Sepolia, OP Sepolia and zkSync Sepolia; permanent failed receipts recorded; stored anchors unmoved. Pass |
| 3b | Branch protection blocks an unreviewed edit to the anchoring workflow | GitHub branch protection plus a CODEOWNERS entry scoped to the workflow file; direct push attempted | Direct push refused | Refused under the recorded configuration. One configuration that appeared to protect the file did not; both are documented. Pass, with the caveat below |
| 4 | A force-moved tag is detected | `v0.4.0-m4` retargeted locally to a different commit, then restored | `gpa reverify` reports `moved` on every network, unaffected tags stay `ok` | `moved` on Arbitrum Sepolia, OP Sepolia and zkSync Sepolia; `v0.1.0-m1` through `v0.3.0-m3` stayed `ok`; `ok` again after restore. Pass |

## Evidence

| Row | Record |
| --- | --- |
| 1a, 2 | `tarball-sweep.md`, `data/tarball-sweep.json` |
| 1b | `test/cli/verify-local.test.ts` |
| 3a | `access-control.md`, `data/access-control.json` |
| 3b | `workflow-tamper-protection.md` |
| 4 | `tag-retargeting.md` |

## Qualifications

**Row 3b tests GitHub, not this system.** The registry cannot stop a workflow file
being edited; that is a hosting-platform capability. What the system contributes is
that the edit becomes visible, because the workflow file sits inside the anchored
tree. The row is retained because Chapter 3 lists it, but it justifies a
configuration recommendation rather than evidencing a feature, and
`workflow-tamper-protection.md` makes the same distinction.

**Rows 1a and 2 are the same experiment read twice**, once without a manifest and
once with. The first establishes that the extras exist and produce an aggregate
mismatch. The second establishes only that a precise manifest excludes those
extras during the second reconstruction. Omitted anchored paths still cause
aggregate verification failure.

## What this table does not cover

Row 1b replaces content at a path that exists in the anchored Git tree. It does
not test replacement at a manifest-declared generated-extra path. Schema version
1 authorises those extras by path or glob and does not record an expected content
hash, so content substituted at an already declared extra path is outside the
same-name result above.

Both published tarballs legitimately omit paths that are present in the Git tree,
including export-ignored files. The current verifier has no separate
`missingFromArtifact` success condition: those omissions change the aggregate tree
hash and cause verification failure. Generated archives may also omit submodule
gitlinks. These legitimate omissions leave an unresolved semantic gap between an
archive and the anchored Git tree.

The two repository-sample verification defects were in code paths these rows did
not exercise. Archive-based reconstruction in `hashGitRef` and metadata loss in
the Windows extraction path of `hashArtifact` were found by the repository and
tarball samples. Both are fixed and carry regression tests. Pipeline and
deployment records separately document GitLab YAML, `NonceManager`, OP nonce and
unrestricted SBOM-scan defects.
