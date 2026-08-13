# Twelve real repositories

Run 2026-08-12. Raw figures: `data/sample-results.json`.

Every measurement before this one came from this repository, which is small,
tidy, and written by the same person who wrote the tool. This record runs
Git-reference tree-hash reconstruction against twelve widely used projects.

The first run found a correctness defect. It has since been fixed, and the sample
re-run. Both results are below, because the defect is the more interesting of the
two and hiding it would misrepresent how the figures were arrived at.

## Selection

Chapter 3 defines the axes and says to pick the actual projects at evaluation time
rather than in advance, because a project's characteristics drift. Candidates were
chosen for being widely used and actively maintained, following O'Donoghue et
al.'s precedent, then verified live.

| Repository | Ecosystem | Files | Size | Median gap between tags |
| --- | --- | --- | --- | --- |
| spf13/cobra | Go | 66 | 0.7 MB | 98 d |
| psf/requests | Python | 129 | 4.4 MB | 8 d |
| pallets/click | Python | 150 | 1.5 MB | 11 d |
| junegunn/fzf | Go | 155 | 1.8 MB | 16 d |
| BurntSushi/ripgrep | Rust | 213 | 3.0 MB | 0 d |
| expressjs/express | JavaScript | 234 | 0.8 MB | 4 d |
| axios/axios | JavaScript | 456 | 3.4 MB | 12 d |
| sharkdp/bat | Rust | 974 | 7.6 MB | 28 d |
| libarchive/libarchive | C, autotools | 1,476 | 20.4 MB | 50 d |
| godotengine/godot-demo-projects | binary assets | 4,018 | 312.8 MB | n/a |
| curl/curl | C, autotools | 4,127 | 17.3 MB | 49 d |
| microsoft/fluentui-system-icons | generated SVG assets | 118,432 | 238.9 MB | n/a |

Two axes are not covered, and saying so matters more than filling them badly.

**Git LFS.** No repository in the candidate pool used it. LFS turns out to be rare
in the widely used source projects this system targets, which is itself worth
reporting: the exclusion Chapter 1 states has a smaller practical footprint than
its prominence suggests. The mechanism is still covered by a unit test, but not by
a real project here.

**Slow release cadence.** The slowest project in the set tags every 98 days.
Nothing here releases yearly, which limits what RQ2 can say about wide blind
windows, since that is exactly the case where periodic snapshots earn their cost.

## The defect this sample found

`gpa`'s reconstructed tree hash was compared against `git rev-parse HEAD^{tree}`
at each project's release tag. On the first run, **three of eleven disagreed**, for
three unrelated reasons that all traced to one design choice.

`hashGitRef` reconstructed a tree by running `git archive` and hashing the result.
An archive is not a faithful rendering of a Git tree, because `git archive` applies
`.gitattributes` export rules and drops entries it cannot represent.

| Repository | Cause |
| --- | --- |
| sharkdp/bat | 92 submodule gitlinks. `git archive` omits submodule entries entirely, so 92 tree entries vanished. |
| libarchive/libarchive | `.gitattributes` marks `.git*` as `export-ignore`. Eight files present in the tree were absent from the archive. |
| curl/curl | `.gitattributes` sets `*.bat text eol=crlf`. Five blobs were rewritten on export, changing their hashes. |

Each cause was confirmed directly: gitlink modes counted with `ls-tree`, missing
files diffed between archive and tree listing, and the five altered blobs
identified by re-hashing archive output against the recorded object ids.

The existing unit suite did not catch this. It covers the working-tree CRLF case,
and `hashGitRef` passed `core.autocrlf=false` to handle exactly that. But
`core.autocrlf` does not govern `.gitattributes` export rules, and no fixture had
a submodule or an `export-ignore` line.

**Anchoring was never affected.** The CI workflow computes the anchor with
`git rev-parse "${TAG}^{tree}"`, straight from the object store, so every anchor
ever written is correct. The defect was on the verification side, in `reverify`,
which would have reported a healthy tag as `moved` on roughly a quarter of the
sample. It exposed a false-positive case missed by fixtures that lacked the
attributes that trigger it. Chapter 3 did not promise a zero-false-positive rate.

## The fix

`hashGitRef` now reconstructs from the object store: `git ls-tree -r -l -z` for the
entries, whose object ids are the stored ones, and `git cat-file --batch` for blobs
of a kilobyte or less, which is all that LFS pointer detection needs. Tree objects
are then rebuilt bottom-up from those entries. Export rules and EOL conversion
cannot apply, because nothing is exported, and gitlinks survive because they are
ordinary entries in the listing.

Three regression tests were added, one per cause: an `export-ignore` fixture, an
`eol=crlf` fixture, and a real submodule. All three fail against the previous
implementation and pass against this one. The existing suite still passes.

## Git-reference reconstruction results after the fix

**Twelve of twelve match.** The reconstruction now agrees with `git rev-parse`
on every project, including the three that previously failed.

| Repository | Files | MB | Archive impl. | Object store | Faster by |
| --- | --- | --- | --- | --- | --- |
| spf13/cobra | 66 | 0.7 | 91 ms | 13 ms | 7× |
| psf/requests | 129 | 4.4 | 212 ms | 14 ms | 15× |
| pallets/click | 150 | 1.5 | 188 ms | 14 ms | 13× |
| junegunn/fzf | 155 | 1.8 | 178 ms | 15 ms | 12× |
| BurntSushi/ripgrep | 213 | 3.0 | 356 ms | 15 ms | 24× |
| expressjs/express | 234 | 0.8 | 359 ms | 17 ms | 21× |
| axios/axios | 456 | 3.4 | 723 ms | 20 ms | 36× |
| sharkdp/bat | 974 | 7.6 | 2,226 ms | 27 ms | 82× |
| libarchive/libarchive | 1,476 | 20.4 | 1,584 ms | 34 ms | 47× |
| godotengine/godot-demo-projects | 4,018 | 312.8 | 9,341 ms | 62 ms | 151× |
| curl/curl | 4,127 | 17.3 | 4,495 ms | 58 ms | 78× |
| microsoft/fluentui-system-icons | 118,432 | 238.9 | did not finish | 1,967 ms | n/a |

The speedup was not the goal, but it follows from the same change: the old path
wrote a tar of the entire tree to disk, extracted it, and re-hashed every byte,
where the new one reads object ids that Git has already computed and only touches
content for blobs small enough to be LFS pointers.

These timings cover `hashGitRef()` only: they exclude artifact extraction,
manifest comparison, network access and the rest of `gpa verify`. The environment
recorded in the raw data is the Cowork Linux sandbox with local disk and Node 20.

The 66-to-234-file repositories all take 13 to 17 ms, which shows fixed startup
and process overhead. Above that range, time rises mainly with file count. curl
and godot-demo-projects both contain about 4,100 files; godot carries eighteen
times the bytes, yet both complete in about 60 ms. The 118,432-file repository
takes 1,967 ms. A single 15-to-17-microsecond per-file rate does not fit the whole
sample because fixed overhead dominates the smaller rows. This is an absolute
characterisation of Git-reference reconstruction in one sandbox, not an
end-to-end usability result.

## Limitations

- Timings come from the Cowork Linux sandbox, not a developer machine. The
  figures describe `hashGitRef()` scaling more reliably than absolute duration.
- The manifest-extra sweep against published release tarballs is recorded in
  `tarball-sweep.md`. Both autotools projects clear every undeclared addition
  with precise manifests, but legitimate omissions remain.
- No Git LFS project and no yearly-cadence project, as described above.
- `agreement` compares reconstruction against the object store. It does not
  exercise the on-chain path, which is covered separately.
