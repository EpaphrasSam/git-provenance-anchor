# Cross-platform determinism of the anchored tree hash

Recorded 2026-07-29 at commit `91835dc`.
Regenerate the per-platform figures with `scripts/tree-hashes.sh v0.1.0-m1 v0.2.0-m2 v0.3.0-m3`.

## Why this matters

The anchored value is a Git tree hash. If that hash depended on the operating
system computing it, verification would fail for legitimate users: a developer on
Windows would compute one value, the Linux CI runner would anchor another, and
the mismatch would be indistinguishable from tampering. Line-ending translation
is the specific hazard, because Git on Windows commonly rewrites LF to CRLF in
the working tree.

## Four independent computations

| Platform | Git | `core.autocrlf` | v0.1.0-m1 | v0.2.0-m2 | v0.3.0-m3 |
| --- | --- | --- | --- | --- | --- |
| Windows, native Git | 2.x | `true` | `17a33046…` | `0fd3e55b…` | `008e66db…` |
| WSL2 Ubuntu 24.04, Linux Git | 2.43.0 | unset | `17a33046…` | `0fd3e55b…` | `008e66db…` |
| Windows, `gpa tree-hash --ref` | — | `true` | `17a33046…` | `0fd3e55b…` | `008e66db…` |
| GitHub Actions `ubuntu-latest` | — | default | — | — | `008e66db…` |

Full values:

```
v0.1.0-m1  17a33046a3d677bfad1f25874a1bb1d6f81ce6f7
v0.2.0-m2  0fd3e55bd3e0800c175eb4fca9372c8c73947b7e
v0.3.0-m3  008e66dbe108d6bc46b9030b83f04af58187e5ca
```

The two host platforms disagree on line-ending configuration — Windows has
`core.autocrlf=true`, the Ubuntu checkout leaves it unset — and still produce
identical hashes. That is expected, because Git stores blobs in normalised form
and the tree hash is computed over stored objects rather than working-tree
bytes, but it is the assumption most likely to be wrong in practice and worth
demonstrating rather than asserting.

## The fourth row is the strongest one

The `v0.3.0-m3` value was not computed locally. It was computed by the GitHub
Actions runner during [run 30469899916](https://github.com/EpaphrasSam/git-provenance-anchor/actions/runs/30469899916)
and written on-chain, where it now sits as `0x…008e66dbe108d6bc46b9030b83f04af58187e5ca`
on both Arbitrum Sepolia and OP Sepolia. Windows and WSL agreeing with each other
is a local observation; both agreeing with a value a third machine committed to a
public ledger before either was consulted is not something that can be adjusted
after the fact.

## Independent reimplementation

The third row is the CLI's own hasher, not a wrapper around `git rev-parse`. It
reconstructs tree objects from their entries, which means it agrees with Git only
if it reproduces Git's rules exactly. Two of those rules cost real effort to get
right and are covered by regression tests in `test/cli/git-tree.test.ts`:

- Directory entries use mode `40000`, not the `040000` that `git ls-tree` prints.
  The leading zero is display padding; including it changes the hash.
- Tree entries sort as though directory names carried a trailing slash, which
  places `foo.txt` and `foo/` in a non-obvious order.

Reimplementing rather than shelling out matters for verification: a verifier can
compute the hash from a release archive with no `.git` directory present, so the
tool cannot assume Git is available or that the repository history is.

## Result

The anchored identifier is stable across Windows, Linux, and a hosted CI runner,
across differing line-ending configuration, and across two independent
implementations of the hashing rules. Verification does not require the verifier
to match the publisher's platform.
