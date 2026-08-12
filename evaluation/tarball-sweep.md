# Release tarball sweep

Collected 2026-08-12. Raw data: `data/tarball-sweep.json`.
Manifests used for the autotools rows:
`fixtures/manifests/curl.provenance-manifest.json` and
`fixtures/manifests/libarchive.provenance-manifest.json`.

## Claim

Verification does not cry wolf on legitimate releases: files a project
deliberately ships outside its Git tree can be declared in the provenance
manifest, and undeclared extras remain the only path that fails.

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

Neither curl nor libarchive ships a `.provenance-manifest.json`. The first pass
therefore reports every build product as undeclared. The second pass drops the
fixture manifests into the local clones (copies live under `fixtures/manifests/`
so the evaluation is reproducible without those clones) and re-runs those two
rows only.

## Observed

### Published release tarballs

| Repository | Extras in artifact | After fixture manifest |
| --- | --- | --- |
| curl/curl (`curl-8_16_0`) | 43 undeclared (autotools / generated help and test sources) | **0 undeclared** — all 43 matched named patterns |
| libarchive/libarchive (`v3.8.9`) | 237 undeclared (autotools auxiliaries, generated `list.h`, prebuilt man pages under `doc/{html,man,text,wiki,pdf}`) | **0 undeclared** — all 237 matched named patterns |

Neither manifest needed a blanket `**`. Patterns are specific (`**/Makefile.in`,
`configure`, `build/autoconf/*`, `doc/html/**`, and similarly scoped entries).
Both rows still differ from the anchored tree hash, and both still omit files
that `.gitattributes` marks `export-ignore` (CI configs, `.gitignore`, and so
on). That is expected for a release tarball: the false-positive claim is about
**extras**, not about export omissions.

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
holds only for cobra. None of the others produced undeclared **extras**, which is
the failure mode the manifest exists to stop, so the sweep's own claim is
unaffected. But the mismatches are worth separating rather than grouping, because
they do not share a cause and one group is not yet explained.

**bat** loses 92 submodule gitlinks, which `git archive` omits by construction.
That one is understood, and it is the same behaviour documented in
`repository-sample.md`.

**requests, ripgrep and fluentui** each lose one or two paths, and these turn out
not to be a separate puzzle. The counts match their symlinks exactly: requests has
two (`tests/certs/mtls/client/ca`, `tests/certs/valid/ca`) and lost two, ripgrep
has one (`HomebrewFormula`) and lost one, fluentui has one
(`FluentIcons.podspec`) and lost one. Windows does not materialise symlinks from a
tar extraction by default, so those entries vanish from the extracted tree
altogether. On Linux both requests and ripgrep hash **identically** to the object
store through the artifact path. Same root cause as the group below, different
symptom: metadata that a Windows filesystem cannot carry.

**click, fzf, express, axios and godot-demo-projects** have identical path sets,
no extras and no missing files, and still hash differently. The cause is this
project's own artifact path, and it is platform-dependent.

Hashing a tarball means extracting it and reading file modes back from the
filesystem. A Windows filesystem does not carry the executable bit, so every
`100755` entry in the tree becomes `100644` after extraction and the tree hash
changes, though no byte of content differs. Each of the five carries a handful of
executable files: one in click, five in fzf, one in express, two in axios, nine in
godot-demo-projects. That is enough.

Two runs pin it down. On Windows, a local `git archive` fed through `hashArtifact`
mismatches, and produces **the same hashes as the GitHub downloads**, which rules
out anything specific to GitHub's archive generation. On Linux the same five extract and hash identically to the object-store tree
(confirmed under Ubuntu 24.04 WSL: `hashGitRef` and `hashArtifact(local git
archive)` matched for click, fzf, express, and axios). On Windows, every
`100755` bit was lost after extract (`kept=0` on those repos), and the resulting
hashes matched the GitHub-download mismatches from the sweep.

So the honest statement is narrower and less comfortable than blaming the archive:
**the artifact verification path did not preserve Git file modes on Windows**, and
verifying a tarball against an object-store anchor there could fail with no
tampering present. `data/control-row-diagnosis.json` records the diagnosis
(Windows mismatch, Linux/WSL match).

**Fix (applied).** `hashArchive` now reads executable bits and symlink targets
from tar headers rather than from the filesystem after extract. A regression test
(`preserves 100755 from tar headers even when the filesystem drops +x`) covers
it. Local `git archive` → `hashArtifact` on Windows now matches `hashGitRef` for
the previously failing sample repos (click, fzf, express, axios). Hashing a plain
directory on Windows remains unreliable when modes were already lost before the
tool sees the files — that case is unchanged.

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

Part of that gap was a defect rather than a fact of life: on Windows the
artifact path lost executable bits after extract. That cause is **fixed** —
modes (and symlink targets) are taken from tar headers. Re-running the local
archive comparison on Windows for click, fzf, express, and axios now matches.

What remains is a genuine semantic gap, and documentation is the right answer to
it. An archive is not a tree. `git archive` legitimately omits `export-ignore`
paths and submodule entries, so an archive of a repository can be faithful and
still hash differently from that repository's tree. Verification should therefore
prefer a clone at the tag, or a project's real published release artifact with a
manifest, and this should be stated plainly rather than left for a user to
discover through a failed check.

## What this supports

Chapter 3's validation test 2 needs more than fixtures. On the two real
distributions that ship build products, a precise manifest clears every
undeclared extra without a wildcard. The control rows did not invent autotools
files. Together that is the field evidence that the manifest does the job it was
designed for.

## Limitations

- Only two projects in the sample publish a built release tarball. The other ten
  are controls, not further autotools cases.
- Export-ignored paths still appear as `missingFromArtifact`; the system does not
  treat those as failures today, and this sweep does not argue that it should.
- Fixture manifests are evaluation artifacts, not files the upstream projects
  maintain.
- Absolute download and hash times depend on the machine and network; they are
  not the claim under test here.
- On Windows, `hashArtifact` previously lost executable bits after tar extract.
  That is fixed by reading modes from tar headers (see regression test in
  `test/cli/git-tree.test.ts`). `data/control-row-diagnosis.json` records the
  pre-fix diagnosis. Hashing a **plain directory** on Windows can still lose
  modes if they were never present on disk. Auto-archives may still differ from
  the object-store tree when `export-ignore` or submodules apply — that is
  archive semantics, not the mode bug.

## Reproduce

```bash
# clones already present from repository-sample.md; rebuild only if missing:
# npm run sample:clone

cp evaluation/fixtures/manifests/curl.provenance-manifest.json \
  sample/curl_curl/.provenance-manifest.json
cp evaluation/fixtures/manifests/libarchive.provenance-manifest.json \
  sample/libarchive_libarchive/.provenance-manifest.json

npm run sample:tarballs
```
