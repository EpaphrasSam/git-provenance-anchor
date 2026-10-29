# Attack coverage against the Ladisa et al. taxonomy

Run 2026-08-12. Full classification: `data/ladisa-classification.csv`, one row per
node instance. Run `python3 evaluation/ladisa-classify.py` from the repository
root. If `taxonomy.json` and `references.json` are not available locally, the
script requires network access and fetches both files from the pinned SAP commit
named below. It writes `evaluation/data/ladisa-classification.csv`.

This applies the five-step rubric from Chapter 3 to the attack tree in Ladisa et
al., "SoK: Taxonomy of Attacks on Open-Source Software Supply Chains" (IEEE S&P
2023), and answers RQ4: which documented attack classes would this system detect.

The system is treated throughout as a **detective** control, in the paper's own
vocabulary. The question asked of every vector is not "does this stop the attack"
but "would this produce a detectable signal".

## Which version of the taxonomy, and why the count is not 107

The paper states 107 unique vectors. The taxonomy is also maintained as a live
artifact, and it has changed since publication.

Source used: `github.com/SAP/risk-explorer-for-software-supply-chains`, file
`src/data/taxonomy.json`, at commit `79e2a3946a24cde1755809a50e54ee15e3af893e`
(2026-05-27). That tree has **118 node instances, 117 excluding the root, built
from 52 distinct vector identifiers**.

The gap is structural rather than a disagreement. Fifteen identifiers, the
credential-compromise and system-compromise subtree (`AV-600` to `AV-608`,
`AV-700` to `AV-703`, `AV-800`, `AV-801`), are shared: the same vector hangs under
six different parents, because taking over an account is a means to several
different ends. Counting identifiers gives 52; counting positions in the tree
gives 117. Neither is 107, and walking the repository's history does not produce
107 at any commit either: it reads 112 non-root instances at the first commit in
March 2022, 116 by September 2022, and 117 from June 2023 onward, when AI package
hallucination was added.

Rather than force a match, every figure below states its denominator. This is the
same discipline the network substitution taught in Chapter 2: record when a fact
was true, not only that it was true.

## What the rubric decided, and where

The rubric's third step classifies at the highest node where the answer is uniform
across everything beneath it, following Ladisa et al.'s own least-possible-depth
convention for assigning safeguards. **Twelve decision points cover all 117
non-root node instances.** Three further internal category nodes receive no
classification, leaving 114 classified nodes as the denominator for the coverage
percentages. Four nodes including the root are internal categories whose children
genuinely diverge, so the rubric descends through them without classifying them.

| Decided at | Vector | Classification |
| --- | --- | --- |
| AV-100 | Develop and advertise distinct malicious package | out of scope |
| AV-200 | Create name confusion with legitimate package | out of scope |
| AV-301 | Introduce malicious code through hypocrite merge request | out of scope |
| AV-302 | Contribute as maintainer | out of scope |
| AV-303 | Tamper with version control system | **detectable** |
| AV-400 | Inject during the build | **detectable, conditional** |
| AV-501 | Dangling reference | out of scope |
| AV-502 | Mask legitimate package | **detectable, conditional** |
| AV-503 | Prevent update to non-vulnerable version | partial |
| AV-504 | Distribute as package maintainer | **detectable, conditional** |
| AV-505 | Inject into hosting system | **detectable, conditional** |
| AV-509 | Abuse dependency resolution mechanism | out of scope |

Internal, descended through: AV-000, AV-001, AV-300, AV-500.

## Result by vector count

| Classification | Node instances | Share of 114 classified |
| --- | --- | --- |
| Detectable | 14 | 12.3% |
| Detectable, conditional on artifact type and manifest boundary | 64 | 56.1% |
| Partially detectable | 1 | 0.9% |
| Out of scope | 35 | 30.7% |

These figures assume tag anchoring plus scheduled re-verification, matching the
recommended policy. Read conservatively, treating the conditional group as
undetected, **12.3% of the 114 classified nodes is detectable**. Tag-only
anchoring has no unconditional detectable class under the same rules. Counting
the conditional group under the recommended policy gives **68.4%**. The
conservative figure is the one defended here.

An earlier sheet labelled 48 positions detectable (42.1%) and 34 of those as the
tag-only baseline (29.8%). Thirty-three distribution and hosting positions moved
to conditional because the node does not fix artifact type. AV-509 moved to out
of scope because it selects a different package. The second-rater comparison
was scored against that earlier sheet.

## The conditional group, and where the taxonomy and the system disagree

Everything under AV-400, injection during the build, is conditional on two
distinctions the taxonomy does not model: what kind of artifact the build produces
and whether the changed content crosses the manifest boundary.

Source-level build tampering is detectable when it changes tracked content or
introduces an undeclared path, because the distributed artifact then conflicts
with the anchored tree and its manifest. This covers an XZ Utils-shaped attack
only under that condition. Schema v1 does not authenticate content substituted at
a manifest-declared generated-extra path, so that case can pass comparison even
when the distributed artifact is source-level. The two-contents run in
`generated-extra-adversary.md` is that case: both payloads returned
`pass_with_extras`. A build that alters only a
**compiled binary** also produces no mismatch, because nothing verifies that a
binary corresponds to its source. That is the SolarWinds shape, and it is not
detected; it needs reproducible builds or build attestation, both out of scope by
Chapter 1.

Ladisa et al. organise the tree by attacker action. This system's detection
boundary is drawn by artifact type. The two axes cross rather than align, which is
why 31 node instances cannot be resolved to a single answer without adding distinctions
the taxonomy does not carry. Stating that is more useful than picking whichever
number flatters the system.

## Reference-weighted coverage

Step 5 of the rubric asks for a weighted figure alongside the raw count, because
catching 12% of the tree means something different depending on which 12%.

The taxonomy ships 269 references mapped to vectors, 371 vector-to-reference
links. Fifteen shared identifiers classify differently depending on which parent
they hang under, so each identifier's references are split evenly across its
instances rather than assigned to whichever occurrence comes first. Root-level
mappings are excluded. The resulting weighted denominator is 301 reference
units. Unlike the 114-node classification denominator, it retains the internal
category nodes.

| Classification | Weighted references | Share |
| --- | --- | --- |
| Detectable | 15.8 | 5.3% |
| Detectable, conditional | 112.3 | 37.3% |
| Partially detectable | 5.0 | 1.7% |
| Out of scope | 131.8 | 43.8% |
| Internal category nodes | 36.0 | 12.0% |

Unrounded, the five rows sum to 301 weighted units. The table rounds each row to one decimal place. Internal category nodes account for 36
units and 12.0%, so omitting that row would leave the weighted percentages without
their full denominator.

**The weighted picture is worse than the vector count, and the reason matters.**
The documented incident literature is dominated by name confusion and by packages
that were malicious from creation: AV-200 carries 18 references, AV-100 another
18, typosquatting alone 11, dangling references 10. All are out of scope here, and
not by oversight. A system that verifies a project's releases against that
project's own history cannot help someone who installed a different package
entirely. Nothing anchored is contradicted, because nothing anchored was involved.

The limitation for Chapter 4 is narrower: this system can address some forms of
subversion within a legitimate project's release history, subject to the manifest
boundary above. It says nothing about selecting the correct package in the first
place, which requires different controls.

## What it does catch, stated plainly

Tampering with version control after a release is anchored, including the
force-moved tag pattern of the tj-actions incident, which is demonstrated working
on Arbitrum Sepolia, OP Sepolia and zkSync Sepolia in `tag-retargeting.md`.
Interception, DNS poisoning, URL tampering, publication with registry
credentials, and substitution inside the hosting system are conditional: a
source archive can mismatch, and a binary or declared generated extra does not.
Dependency-resolution abuse selects a different package and is out of scope.
Source-level build injection when it changes tracked content or introduces an
undeclared path is conditional for the same artifact-type reason. And, partially, update-blocking:
a consumer frozen on an older genuine release sees no hash mismatch, but the
anchor history is public and append-only, so a newer release is visible on chain
even when a registry hides it.

## Against Sigstore, which RQ4 names directly

The comparison is narrower than a coverage table suggests, because the two systems
fail differently rather than at different rates.

Sigstore establishes that an artifact was signed by a given identity through a
given workflow, and records verification material through Rekor. On the vectors
above it performs comparably: a substituted artifact fails signature
verification much as it fails anchor comparison. The difference is not which
attacks are covered but what a verifier must assume. Rekor provides Merkle
inclusion and consistency proofs with signed checkpoints. Rekor v2 can obtain
co-signatures from synchronous witnesses that check a checkpoint against their
previously observed state, while monitors independently observe log behaviour
and scan entries. These mechanisms make split views and inconsistency auditable;
they do not turn the log into a consensus network or remove omission and
availability risks. Anchor comparison instead uses a public chain whose event
history is ordered through an incentive-bearing consensus protocol.

Both share the same blind spot, and it is the one this rubric names at step 1: an
attacker holding the signing credential produces records that verify correctly in
either system.

## Limitations

- The classification is one analyst's application of the rubric. It is published
  in full, per row, with the rationale attached, so that individual verdicts can
  be disputed without re-deriving the whole table.
- Reference counts measure how much a vector has been written about, which is a
  proxy for prevalence rather than severity. The paper's own severity data is not
  in the machine-readable export.
- The conditional vectors are reported as one group. Splitting them would
  require classifying each project's release artifact type and manifest boundary,
  which belong to the repository sample rather than to the taxonomy.
- The 12.3% result describes tag anchoring plus scheduled re-verification.
  Tag-only anchoring has no unconditional detectable class. The earlier 42.1%
  sheet is the one used in the second-rater comparison.
