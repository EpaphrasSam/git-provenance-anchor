# Release tarball sweep

Collected 2026-08-12. Raw data: `data/tarball-sweep.json`.
Manifests used for the autotools rows:
`fixtures/manifests/curl.provenance-manifest.json` and
`fixtures/manifests/libarchive.provenance-manifest.json`.

## Claim

Precise manifest entries can clear legitimate files added to a published release
tarball. This sweep tests added paths. It does not establish that a legitimate
archive reproduces the anchored Git tree without other differences.

## Method

Against the twelve clones already measured in `repository-sample.md`, download
each project's release artifact and compare it to the tree that would be
anchored for the same tag (`hashGitRef` on `HEAD` versus `hashArtifact` on the
tarball), using the same manifest resolver as `gpa verify`.

```bash
npm run sample:tarballs
```

Two projects publish a real built tarball (curl, libarchive). The other ten use
GitHub's auto-generated archive, which is a snapshot of the tree and therefore a
control: it cannot introduce build-added files by construction.

Neither curl nor libarchive ships a `.provenance-manifest.json`. For those two
rows, the script automatically loads the checked-in fixture manifest when a
clean sample clone has no project manifest. A manifest already present in a
clone takes precedence. Each row records the manifest path it used, and the
top-level `fixtureManifests` field lists both defaults.

## Observed

### Published release tarballs

| Repository | Extras in artifact | After fixture manifest |
| --- | --- | --- |
| curl/curl (`curl-8_16_0`) | 43 undeclared (autotools / generated help and test sources) | **0 undeclared**; all 43 matched named patterns |
| libarchive/libarchive (`v3.8.9`) | 237 undeclared (autotools auxiliaries, generated `list.h`, prebuilt man pages under `doc/{html,man,text,wiki,pdf}`) | **0 undeclared**; all 237 matched named patterns |

Neither manifest needed a blanket `**`. Patterns are specific (`**/Makefile.in`,
`configure`, `build/autoconf/*`, `doc/html/**`, and similarly scoped entries).
Both rows still differ from the anchored tree hash, and both still omit files
that `.gitattributes` marks `export-ignore` (CI configs, `.gitignore`, and so
on). The measured pass is limited to resolving generated additions. Export
omissions remain a legitimate difference between these archives and their anchored
trees, and that aggregate difference causes verifier failure.

### Generated-archive controls

| Repository | Result |
| --- | --- |
| spf13/cobra | Identical tree hash |
| psf/requests | Differs: 2 paths missing from the archive (certificate directory entries) |
| pallets/click, junegunn/fzf, expressjs/express, axios/axios, godotengine/godot-demo-projects | Path sets match, tree hash differs (content / mode encoding in the archive path versus the object store) |
| BurntSushi/ripgrep | Differs: `HomebrewFormula` missing from the archive |
| sharkdp/bat | Differs: 92 submodule gitlinks absent from the archive |
| microsoft/fluentui-system-icons | Differs: 1 path missing from the archive; no undeclared extras |

The brief expected every generated-archive row to report `identical: true`. That
holds only for cobra. None of the others produced undeclared extras, which supports
the narrower manifest-extra result. It does not support a zero-false-positive
claim for whole-archive comparison because legitimate omissions and metadata
differences remain.

**bat** loses 92 submodule gitlinks, which `git archive` omits by construction.
That one is understood, and it is the same behaviour documented in
`repository-sample.md`.

**requests, ripgrep and fluentui** each lose one or two paths, and these turn out
not to be a separate puzzle. The counts match their symlinks exactly: requests has
two (`tests/certs/mtls/client/ca`, `tests/certs/valid/ca`) and lost two, ripgrep
has one (`HomebrewFormula`) and lost one, fluentui has one
(`FluentIcons.podspec`) and lost one. The Windows extraction path used in this
evaluation did not materialise those symlinks, so the entries vanished from the
extracted tree. Under Ubuntu 24.04 in WSL, requests and ripgrep hashed identically
to the object store through the artifact path.

**click, fzf, express, axios and godot-demo-projects** have identical path sets,
no extras and no missing files, and still hash differently. The cause is this
project's own artifact path, and it is platform-dependent.

The original tarball path extracted the archive and read file modes back from the
directory. In the Windows evaluation path, extraction did not preserve Unix
executable bits, so every `100755` entry was read as `100644` and the tree hash
changed although no regular-file content differed. Each of the five repositories
carries a handful of executable entries: one in click, five in fzf, one in
express, two in axios and nine in godot-demo-projects.

Two runs pin it down. On Windows, a local `git archive` fed through `hashArtifact`
mismatches, and produces **the same hashes as the GitHub downloads**, which rules
out anything specific to GitHub's archive generation. On Linux the same five extract and hash identically to the object-store tree
(confirmed under Ubuntu 24.04 WSL: `hashGitRef` and `hashArtifact(local git
archive)` matched for click, fzf, express, and axios). On Windows, every
`100755` bit was lost after extract (`kept=0` on those repos), and the resulting
hashes matched the GitHub-download mismatches from the sweep.

The artifact verification path did not preserve Git file modes after extraction
in the Windows evaluation environment. A tarball could therefore disagree with
an object-store anchor without tampering. `data/control-row-diagnosis.json`
records the Windows mismatch and Linux/WSL match.

**Fix (applied).** `hashArchive` now reads executable bits and symlink targets
from tar headers rather than from the filesystem after extract. A regression test
(`preserves 100755 from tar headers even when the filesystem drops +x`) covers
it. Local `git archive` → `hashArtifact` on Windows now matches `hashGitRef` for
the previously failing sample repos (click, fzf, express, axios). Hashing a plain
directory on Windows remains unreliable when modes were already lost before the
tool sees the files. The verifier's manifest-adjusted second pass rehashes the
original archive with the resolved exclusions, so it uses the same tar-header
metadata as the first pass. The plain-directory case is unchanged.

## A second conclusion, about the verification path

The control rows carry a finding of their own, separate from the manifest result
and arrived at by accident.

GitHub's automatically generated "Source code (tar.gz)" is the artifact a consumer
is most likely to download. Ten of the twelve rows here used it (the other two are
published release tarballs), and nine of those ten did not reproduce the anchored
tree hash. No tampering was involved in any of them.

So a verifier who takes the convenient artifact and checks it against an anchor
recorded from the object store will usually see a mismatch that means nothing.
That is a false positive in the most probable verification path, and it is a
different failure from the one this sweep set out to test.

Part of that gap was a defect rather than a fact of life: the Windows evaluation
path lost executable bits after extraction. That cause is **fixed**. Modes and
symlink targets are taken from tar headers. Re-running the local
archive comparison on Windows for click, fzf, express, and axios now matches.

What remains is a genuine semantic gap, and documentation is the right answer to
it. An archive is not a tree. `git archive` legitimately omits `export-ignore`
paths and submodule entries, so an archive of a repository can be faithful and
still hash differently from that repository's tree. Verification should therefore
prefer a clone at the tag, or a project's real published release artifact with a
manifest, and this should be stated plainly rather than left for a user to
discover through a failed check.

## What this supports

On the two published distributions that ship build products, a precise manifest
clears every undeclared extra without a wildcard. This supports path-based
declarations for generated additions. It does not establish whole-archive
equivalence or an end-to-end false-positive rate because legitimate omissions
remain.

## Limitations

- Only two projects in the sample publish a built release tarball. The other ten
  are controls, not further autotools cases.
- Export-ignored paths change the reconstructed aggregate tree hash and therefore
  cause verification failure even when the omission is legitimate.
- Fixture manifests are evaluation artifacts, not files the upstream projects
  maintain.
- Absolute download and hash times depend on the machine and network; they are
  not the claim under test here.
- On Windows, `hashArtifact` previously lost executable bits after tar extract.
  That is fixed by reading modes from tar headers (see regression test in
  `test/cli/git-tree.test.ts`). `data/control-row-diagnosis.json` records the
  pre-fix diagnosis. Hashing a **plain directory** on Windows can still lose
  modes if they were never present on disk. Auto-archives may still differ from
  the object-store tree when `export-ignore` or submodules apply. That is archive
  semantics, not the mode bug.

## Reproduce

```bash
npm run sample:clone
npm run sample:tarballs
```

No fixture files need to be copied into the clones.
