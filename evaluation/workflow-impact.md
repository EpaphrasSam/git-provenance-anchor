# What it costs a project to adopt this

Run 2026-08-12. Measures Objective 3's commitment to assess the system's impact on
developer release workflows, using the three proxies Chapter 3 specifies.

The comparator, also from Chapter 3, is Tamanna et al.'s finding that
implementation complexity is the primary reason adoption of frameworks such as
SLSA stalls, with more than half of surveyed developers reporting difficulty
implementing hermetic builds. The claim here is a comparison against that
documented barrier, not a claim of zero friction.

## Integration effort

| Measure | Value |
| --- | --- |
| New files a project must add | 2 (one workflow file, one manifest) |
| Existing project files that must change | 0 |
| Lines of CI configuration added | 53 effective, 76 including comments |
| Lines of manifest for a project with no build extras | 7 |
| Repository secrets required | 1 (`ANCHOR_DEPLOYER_KEY`) |
| Repository variables required | 1 (`GPA_NETWORKS`) |
| One-time on-chain transactions | 2 (`registerProject`, `allowlistAdd`) |
| Time from tag push to verified anchor | 49 s on this repository, of which ~12 s is submission to three chains. Not constant: see below |

Adding the optional mechanisms from `rq2-strategies.md` costs a further 55
effective lines for weekly snapshots and 33 for daily re-verification, plus one
variable (`GPA_SNAPSHOT_REF`). Neither is required.

## What is fixed and what varies

The workflow, secret, variable and transaction counts are properties of the
reference template. They do not depend on repository size or language because
the anchoring path does not invoke the project's build. The seven-line manifest
is only the baseline for a project with no generated extras. A project that
publishes generated files needs additional, project-specific declarations.

Runtime also varies. `sbom-coverage.md` measured
Syft over the same sample and it ranges across three orders of magnitude: 2.7 s
for cobra, 59.5 s for curl, and 15 minutes for fluentui-system-icons, where
`syft dir:.` as the shipped workflow writes it did not finish at all. Excluding
`*.svg` brought that to roughly four minutes.

The core workflow configuration is fixed, but manifest work and pipeline runtime
are not. Scanning dominates runtime, and the reference workflow needs an
exclusion option on repositories with many generated assets. `sbom-coverage.md`
records that template defect.

That is worth stating plainly because it is the specific contrast with the
comparator. Tamanna et al.'s respondents struggled with hermetic builds, and a
hermetic build is hard in a way that depends entirely on what a project builds and
how: its toolchain, its dependencies, its assumptions about the machine. The
integration cost measured here has no such dependency. The anchoring workflow
does not invoke the project's build. This isolates commitment generation from
project build scripts, but it does not close every part of the XZ Utils attack.
Artifact verification still permits manifest-declared generated paths, and
schema version 1 does not authenticate the contents of those paths. See
`ladisa-coverage.md` for the resulting conditional classification.

The sampled repositories carry between 2 and 16 existing workflow files each.
Adoption adds one more alongside them and leaves the rest untouched.

## Ongoing per-release friction

| Measure | Result |
| --- | --- |
| New manual steps per release | 0. The workflow triggers on tag push. |
| Must a release wait for anchor confirmation? | No. Anchoring runs alongside the release and blocks nothing. |
| Noise burden | Zero false positives on two real release tarballs and ten constructed controls, per `tarball-sweep.md` |

The asynchrony point is load-bearing and is supported by `latency.md` rather than
asserted here. An anchor reaches Ethereum in about three minutes on the optimistic
networks and settles over days, but a maintainer waits for none of it: inclusion on
the L2 is bounded by block time, and the release itself never depends on the
anchor at all.

Noise burden reuses the false-positive result rather than measuring separately,
as Chapter 3 specifies, since a checker that cries wolf is precisely what would
impose friction. Two real distributions that ship build products, curl and
libarchive, produce zero undeclared extras once a precise manifest is written, and
neither manifest needed a blanket wildcard.

## Against the comparator

The honest comparison is structural rather than numerical, because Tamanna et al.
report adoption difficulty rather than a line count.

What their respondents found hard was making an existing build reproducible, which
means changing how a project builds. Nothing here asks that. A project keeps its
build exactly as it is, adds a workflow that does not touch it, and declares any
files its build legitimately adds. The starting point is two files and two
one-off transactions. The manifest grows when a project has generated extras.

The structural comparison is that this workflow avoids the hermetic-build
requirement. It is not a measured maintainer-adoption result, and it does not
show that adoption is free.

## Limitations

- These are properties of the artefact measured against the sample's
  characteristics, not observations of real maintainers adopting it. No project in
  the sample has adopted the system; the workflow was exercised on this repository.
- Time to first anchor comes from one CI run on testnets, recorded in
  `ci-end-to-end.md`. It excludes the human time to generate a key, add a secret,
  and register a project, which is not instrumented.
- The maintainer-perception survey Chapter 3 names as a stretch goal was not
  attempted, and Chapter 3 does not treat it as a required result.
- Line counts are of the reference templates. A project could write a shorter or
  longer equivalent.
- The reference workflow's `syft dir:.` has no exclusions and did not complete
  within 15 minutes on a 118,432-file asset repository. The template needs an
  exclusion option before it is safe to recommend for asset-heavy projects.
