# Functional validation: the four properties

Run 2026-08-12. Consolidates the results Chapter 3 promises as a single table.
Each row's evidence lives in its own record; this page exists because the evidence
was spread across five files and the promised table did not exist anywhere.

A Wieringa single-case mechanism experiment: pass or fail correctness
demonstrations, not statistical measurement.

## Results

| # | Property under test | How the condition was constructed | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1a | An artifact containing a file that is neither in the anchored tree nor declared in the manifest is flagged | Real published release tarballs for curl `curl-8_16_0` and libarchive `v3.8.9` compared against the anchored tree with no manifest present | Every build-added file reported as undeclared | 43 undeclared for curl, 237 for libarchive. Pass |
| 1b | A file whose content is swapped while its name is preserved is flagged | Fixture repository with one file's content replaced, same path | Tree hash differs from the anchored value | Hash differs. Pass (`test/cli/verify-local.test.ts`) |
| 2 | Legitimate releases do not false-positive | The same two tarballs re-run with precise manifests declaring their genuine build products; plus ten generated-archive controls | Zero undeclared extras, and no wildcard needed | 0 undeclared for both. Patterns specific (`configure`, `**/Makefile.in`, `build/autoconf/*`, `doc/html/**`); no blanket `**`. Controls produced no undeclared extras. Pass |
| 3a | The contract rejects an anchor from an account outside the project allowlist | Fresh keypair, never allowlisted, submitting a forged tree hash to the live testnet deployments, both simulated and broadcast | Revert with `NotAllowlisted`; stored anchor unchanged | Reverted on both deployments; permanent failed receipts recorded; stored anchor unmoved. Pass |
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

## Two qualifications

**Row 3b tests GitHub, not this system.** The registry cannot stop a workflow file
being edited; that is a hosting-platform capability. What the system contributes is
that the edit becomes visible, because the workflow file sits inside the anchored
tree. The row is retained because Chapter 3 lists it, but it justifies a
configuration recommendation rather than evidencing a feature, and
`workflow-tamper-protection.md` makes the same distinction.

**Rows 1a and 2 are the same experiment read twice**, once without a manifest and
once with. That is deliberate: the first pass establishes that the extras are
really there and would fail a naive check, and the second that a precise manifest
clears them. Reporting only the second would make the mechanism look untested.

## What this table does not cover

Both defects found during the evaluation were in code paths these four properties
do not exercise, which is worth recording rather than glossing over. The
archive-based reconstruction defect in `hashGitRef` and the Windows file-mode loss
in `hashArtifact` were each caught by the repository sample, not by validation
testing, because the fixtures behind rows 1b and 2 did not use submodules,
`export-ignore` attributes, `eol` attributes, or a filesystem that drops metadata.
Both are fixed and now carry regression tests. See `repository-sample.md` and
`data/control-row-diagnosis.json`.
