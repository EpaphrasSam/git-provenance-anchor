# Tag retargeting detected by re-verification

Run on 2026-08-03 against the live testnet anchors for tag `v0.4.0-m4`.
This is Chapter 3 functional validation test 4 (the tj-actions pattern).

## What is being tested

An attacker who can force-update a Git tag can point a previously released name
at a different commit. Consumers who trust the tag name then receive different
code. The on-chain anchor still holds the original tree hash, so comparing the
tag's *current* tree to the anchored value should flag the move.

`gpa reverify` walks every anchored reference on each network, recomputes
`git rev-parse <ref>^{tree}` in the local repository, and reports `moved` when
the hashes disagree. No transaction is sent; the check is read-only.

## Method

1. Confirm baseline: `gpa reverify` reports `ok` for `v0.4.0-m4` on Arbitrum
   Sepolia, OP Sepolia, and zkSync Sepolia (anchored tree `bfc4700b…`).
2. Locally retarget the tag only — no push to origin:
   `git tag -f v0.4.0-m4 ae0ba8d`
   New tree: `f28f459e08dcd3f9eaca646153e5e215601cd8b8`.
3. Run
   `gpa reverify --network arbitrumSepolia --network opSepolia --network zkSyncSepolia`.
4. Restore the tag from origin: `git fetch origin tag v0.4.0-m4 --force`.
5. Re-run reverify and confirm `v0.4.0-m4` is `ok` again.

## Observed

### Baseline (honest tag)

| Network | `v0.4.0-m4` | current = anchored |
| --- | --- | --- |
| Arbitrum Sepolia | `ok` | `bfc4700b1f0376c4a19722440a3c132fea20681b` |
| OP Sepolia | `ok` | `bfc4700b1f0376c4a19722440a3c132fea20681b` |
| zkSync Sepolia | `ok` | `bfc4700b1f0376c4a19722440a3c132fea20681b` |

### After local force-move

```
status: fail
arbitrumSepolia TAG v0.4.0-m4: moved
  current=f28f459e08dcd3f9eaca646153e5e215601cd8b8
  anchored=bfc4700b1f0376c4a19722440a3c132fea20681b
opSepolia TAG v0.4.0-m4: moved
  current=f28f459e08dcd3f9eaca646153e5e215601cd8b8
  anchored=bfc4700b1f0376c4a19722440a3c132fea20681b
zkSyncSepolia TAG v0.4.0-m4: moved
  current=f28f459e08dcd3f9eaca646153e5e215601cd8b8
  anchored=bfc4700b1f0376c4a19722440a3c132fea20681b
```

Unaffected tags (`v0.1.0-m1` … `v0.3.0-m3`) stayed `ok` on every network that listed them.

### After restore from origin

```
status: pass
opSepolia TAG v0.4.0-m4: ok
  current=bfc4700b1f0376c4a19722440a3c132fea20681b
  anchored=bfc4700b1f0376c4a19722440a3c132fea20681b
```

(Arbitrum and zkSync restored identically; tag ref fetched from origin.)

## Result

Re-verification detects the tj-actions-style tag retarget on all three live
deployments. The on-chain record did not change; the local tag did. That
mismatch is exactly the detective control Chapter 3 describes: prevention of a
force-push is a hosting-platform concern, while detection is what this system
contributes.

Reproduce:

```bash
gpa reverify --network arbitrumSepolia --network opSepolia --network zkSyncSepolia
git tag -f v0.4.0-m4 <other-commit-with-different-tree>
gpa reverify --network arbitrumSepolia --network opSepolia --network zkSyncSepolia
git fetch origin tag v0.4.0-m4 --force
```
