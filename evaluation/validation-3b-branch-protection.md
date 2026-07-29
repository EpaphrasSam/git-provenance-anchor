# Validation 3b — branch protection as a control on the anchoring definition

Run on 2026-07-29 against `github.com/EpaphrasSam/git-provenance-anchor`.

## What is being tested

The anchoring job is the only thing that writes a tree hash on-chain, so its
definition is the obvious thing for an attacker to neuter. Disabling the trigger
is enough: no anchor is ever submitted, and a downstream verifier that only asks
"does this tag have an anchor?" learns nothing was recorded rather than that
something was altered.

Branch protection is the platform-side control for that. This test asks whether
the intuitive configuration is actually sufficient, and separately whether the
tampering is detectable through the anchor itself if the control is absent.

## Arm 1 — protection on, admin bypass at its default

Settings applied via `PUT /repos/{owner}/{repo}/branches/main/protection`:

| setting | value |
| --- | --- |
| `required_pull_request_reviews` | enabled |
| `required_approving_review_count` | 1 |
| `require_code_owner_reviews` | true |
| `enforce_admins` | **false** (GitHub's default) |

`.github/CODEOWNERS` covers `/workflows/`, `/.github/` and `/contracts/`.

Attack: edit `workflows/provenance-anchor.yml` so the tag trigger matches
nothing (`v*` → `zzz-never-matches-*`), commit, push directly to `main` as the
repository admin.

Observed:

```
remote: Bypassed rule violations for refs/heads/main:
remote: - Changes must be made through a pull request.
   2bf052b..793c4da  main -> main
```

Exit code 0. **The push succeeded.** GitHub recorded the violation and allowed
it anyway, because a repository admin is exempt unless `enforce_admins` is set.
The commit reached the default branch with no review and no code-owner approval.

## Arm 2 — same configuration, admin bypass disabled

Single change: `POST /repos/{owner}/{repo}/branches/main/protection/enforce_admins`.

Attack: identical direct push to `main` (here, the revert of the tamper).

Observed:

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Changes must be made through a pull request.
 ! [remote rejected] main -> main (protected branch hook declined)
```

Exit code 1. **The push was refused server-side.** The only remaining route to
the anchoring definition is a pull request carrying a code-owner approval.

## Detection when the control is absent

The tampered workflow is inside the tree that gets anchored, so the edit moves
the tree hash:

| state | commit | `gpa tree-hash --ref` |
| --- | --- | --- |
| pre-tamper | `2bf052b` | `ff9367ce29618888289e6aadd9569004fc31bb4d` |
| tampered | `793c4da` | `ae4e7c2ec9a5ea8b1f397584727b4b577d6cdce4` |

A verifier holding the pre-tamper anchor sees a mismatch. This is the detective
half of the pair, and it holds whether or not branch protection is configured.

## Result

Both arms behaved as the design assumes, and the failure mode in arm 1 is the
point of running it: the configuration a maintainer would reach for first —
require pull requests, require code-owner review — does not survive a
compromised maintainer account, because the exemption is on by default and has
to be turned off explicitly. Arm 2 is the configuration adopters need.

The registry cannot enforce any of this. Preventing a workflow edit is a
platform capability, and the recommendation in Ch. 3 is scoped accordingly:
branch protection with `enforce_admins` enabled is advice to adopters, not a
property the system verifies. What the system contributes is that the edit
cannot be made quietly, since the workflow file is inside the anchored tree.
