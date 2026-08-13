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

**GitHub only.** The two-configuration experiment above, `enforce_admins` false
against true, was run on GitHub. Nothing equivalent has been run on GitLab, even
though the anchoring flow itself now runs on both platforms Objective 2 names
(`ci-end-to-end.md`).

Three separate properties are easy to collapse into one here, and they are not the
same:

**Isolation from the project's build pipeline** is structural and does not depend
on branch protection at all. The anchoring job never invokes the project's build or
release scripts, so an attacker who compromises those scripts cannot influence what
the anchor records. That property holds on both platforms and the GitLab run
exercises it.

**Refusal of an admin editing the anchoring definition** is what this record
actually tests, and it is what the two configurations differ on. A maintainer with
sufficient permissions can otherwise disable the trigger or point the job at a
different hash. Shown on GitHub only.

**Detection of such an edit** is platform-independent, because the workflow file
sits inside the anchored tree, as the section above already establishes. Blocking
and detecting are different guarantees, and the protection configuration provides
the first while the anchor provides the second regardless of platform.

On GitLab the nearest controls are protected branches and protected tags, which are
not a translation of the JSON payload above. Enforced Code Owner approval requires
Premium or Ultimate: a `CODEOWNERS` file can exist on Free, but approvals do not
block a merge. The admin-bypass path is not mysterious either, and should not be
described as unknown. GitLab documents it: if "Allowed to push and merge" includes
Maintainers or Owners, those roles skip merge requests much as GitHub admins skip
protection without `enforce_admins`. It simply has not been exercised on this
project.

So the accurate summary is that isolation from the build pipeline is shown on both
platforms, refusal of an admin editing the anchoring workflow is shown on GitHub
only, and the recommendation in this record should be read as GitHub-specific until
the same attack is pushed on a GitLab project.
