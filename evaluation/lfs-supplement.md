# Supplementary Git LFS repository

STATUS: eligibility locked before clone. This is not a thirteenth member of the
2026-08-12 sample of twelve. It is extra evidence for the LFS boundary already
named in Chapter 1.

## Eligibility (written before clone)

A candidate must meet all of these:

1. Public HTTPS clone, no credentials.
2. `.gitattributes` has an LFS filter rule (`filter=lfs`).
3. At least one blob in the pinned tree is a Git LFS pointer (first line
   `version https://git-lfs.github.com/spec/v1`).
4. Shallow clone of the pinned ref stays under 500 MB without downloading LFS
   objects (`GIT_LFS_SKIP_SMUDGE=1`).
5. Not one of the twelve repositories in `sample-clone.sh`.
6. A named commit is recorded so the measurement can be repeated.

If several candidates pass, pick the smallest clone that still has a real LFS
pointer, not a hand-written fixture in this repo.

What we will measure: `hashGitRef` against `git rev-parse <ref>^{tree}`, pointer
count, and that the tree hash is the pointer file, not the LFS object bytes.
We will not pull LFS objects unless needed to show a working-tree smudge, and we
will not add this repository to the original twelve.

## Chosen repository

`cbeams/lfs-test`, commit `42222296478b15c48bcb72cbf06db68606269bbb`.
`.gitattributes` tracks `*.pdf`. `sample.pdf` in the tree is a 131-byte pointer
declaring oid `sha256:b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553`
and size 184292. Clone used `GIT_LFS_SKIP_SMUDGE=1`. Raw ledger:
`data/lfs-supplement.json`. Reproduce: `npx ts-node --transpile-only scripts/lfs-supplement.ts`.

## Result

`hashGitRef` matched `git rev-parse HEAD^{tree}`:
`2349eeb201ceeacfc86a3c4de7a57158aea5f5f7`. It reported `sample.pdf` as an LFS
pointer. The object store holds the pointer, not the PDF. Replacing the LFS
object behind that oid would not change this tree hash.

`hashDirectory` did not match, because the Windows checkout rewrote `README.md`
to CRLF. The pointer file itself stayed LF. That is `core.autocrlf`, already
documented for working-tree hashing, not an LFS miss.

This does not put LFS objects inside the commitment. It shows the boundary on a
real public repository: reconstruction follows Git, and Git is following the
pointer. The original twelve are unchanged. Do not cite this clone as evidence
that LFS is common or rare.
