# Protecting the anchoring workflow from silent edits

Measured 2026-07-29 on `github.com/EpaphrasSam/git-provenance-anchor`.

## The problem this addresses

The anchoring job is the only thing that writes a tree hash on-chain, so it is the
obvious thing for an attacker with repository write access to disable. They do not
need to break the cryptography — changing the tag pattern so the trigger never
fires is enough. No anchor is submitted, and a consumer who only asks "does this
tag have an anchor?" learns that nothing was recorded, which is not the same as
learning that something was altered.

Preventing that edit is a hosting-platform capability, not something this registry
can do. So the question worth answering is which platform configuration actually
prevents it. The intuitive one does not.

## Two configurations, one attack

The attack in both cases is identical: edit the workflow so its tag trigger
matches nothing, commit, and push directly to `main` as a repository admin.

### Requiring pull requests and code-owner review is not enough

| setting | value |
| --- | --- |
| `required_pull_request_reviews` | enabled |
| `required_approving_review_count` | 1 |
| `require_code_owner_reviews` | true |
| `enforce_admins` | **false** — this is GitHub's default |

With `.github/CODEOWNERS` covering the workflow path, the push still succeeded:

```
remote: Bypassed rule violations for refs/heads/main:
remote: - Changes must be made through a pull request.
   2bf052b..793c4da  main -> main
```

Exit code 0. GitHub recorded the violation and permitted it, because a repository
admin is exempt from branch protection unless `enforce_admins` is explicitly set.
The commit reached the default branch with no review and no code-owner approval.

This is the configuration a maintainer setting up protection would most likely
arrive at, and it does not defend against the case that matters — a compromised
maintainer account, which is precisely the account that holds admin.

### Disabling admin bypass blocks it

One field changed, `enforce_admins` set to true. Same push:

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Changes must be made through a pull request.
 ! [remote rejected] main -> main (protected branch hook declined)
```

Exit code 1. Refused server-side. The only remaining route to the anchoring
definition is a pull request carrying a code-owner approval.

## The edit is detectable either way

The workflow file lives inside the tree that gets anchored, so tampering with it
moves the tree hash:

| state | commit | tree hash |
| --- | --- | --- |
| before the edit | `2bf052b` | `ff9367ce29618888289e6aadd9569004fc31bb4d` |
| after the edit | `793c4da` | `ae4e7c2ec9a5ea8b1f397584727b4b577d6cdce4` |

A verifier holding an anchor from before the edit sees a mismatch. This holds
regardless of how the branch is configured, and it is the part the registry
contributes: the edit cannot be made quietly, even where it cannot be blocked.

## What to configure

Apply this to the branch your workflow lives on:

```sh
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
JSON
```

`enforce_admins` is the field that matters. Everything else in that payload was
already true in the configuration where the attack succeeded.

Note the practical cost: with one required approval and `enforce_admins` set, a
solo maintainer cannot merge, because an author cannot approve their own pull
request. A single-maintainer project needs either a second reviewer or
`required_approving_review_count` at zero, which still blocks direct pushes while
allowing self-merge through a pull request. This repository currently runs with
protection removed during development, and the payload above is what to restore.

## Scope

This is a property of GitHub, not of this software. It is documented here because
adopting the system without it leaves the anchoring definition writable by exactly
the account the threat model is concerned with — but no part of the registry
verifies or depends on it.
