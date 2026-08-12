# Attack coverage against the Ladisa et al. taxonomy

Run 2026-08-12. Full classification: `data/ladisa-classification.csv`, one row per
node instance. Regenerate with `python3 evaluation/ladisa-classify.py` from the
taxonomy source named below.

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
credential-compromise and system-compromise subtree (`AV-600`–`AV-608`,
`AV-700`–`AV-703`, `AV-800`, `AV-801`), are shared: the same vector hangs under
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
convention for assigning safeguards. **Eleven decision points cover all 117
vectors.** Four nodes are internal categories whose children genuinely diverge, so
the rubric descends through them without classifying them.

| Decided at | Vector | Classification |
| --- | --- | --- |
| AV-100 | Develop and advertise distinct malicious package | out of scope |
| AV-200 | Create name confusion with legitimate package | out of scope |
| AV-301 | Introduce malicious code through hypocrite merge request | out of scope |
| AV-302 | Contribute as maintainer | out of scope |
| AV-303 | Tamper with version control system | **detectable** |
| AV-400 | Inject during the build | **detectable, conditional** |
| AV-501 | Dangling reference | out of scope |
| AV-502 | Mask legitimate package | **detectable** |
| AV-503 | Prevent update to non-vulnerable version | partial |
| AV-504 | Distribute as package maintainer | **detectable** |
| AV-505 | Inject into hosting system | **detectable** |

Internal, descended through: AV-000, AV-001, AV-300, AV-500.

## Result by vector count

| Classification | Node instances | Share of 114 classified |
| --- | --- | --- |
| Detectable | 48 | 42.1% |
| Detectable, conditional on artifact type | 31 | 27.2% |
| Partially detectable | 1 | 0.9% |
| Out of scope | 34 | 29.8% |

Read conservatively, treating the conditional group as undetected, **43% of the
tree is detectable**. Read at its most generous, counting the conditional group,
**70%**. The honest figure is the conservative one, and the reason the two differ
by so much is worth more than either number.

## The conditional group, and where the taxonomy and the system disagree

Everything under AV-400, injection during the build, splits on a distinction the
taxonomy does not model: what kind of artifact the build produces.

A build that alters a **source-level distributed artifact** produces a tarball
that no longer matches the anchored tree, so comparison flags it. That is the XZ
Utils shape, and it is detected. A build that alters only a **compiled binary**
produces no mismatch, because nothing verifies that a binary corresponds to its
source. That is the SolarWinds shape, and it is not detected; it needs
reproducible builds or build attestation, both out of scope by Chapter 1.

Ladisa et al. organise the tree by attacker action. This system's detection
boundary is drawn by artifact type. The two axes cross rather than align, which is
why 31 vectors cannot be resolved to a single answer without adding a distinction
the taxonomy does not carry. Stating that is more useful than picking whichever
number flatters the system.

## Reference-weighted coverage

Step 5 of the rubric asks for a weighted figure alongside the raw count, because
catching 43% of the tree means something different depending on which 43%.

The taxonomy ships 269 references mapped to vectors, 371 vector-to-reference
links. Fifteen shared identifiers classify differently depending on which parent
they hang under, so each identifier's references are split evenly across its
instances rather than assigned to whichever occurrence comes first. Root-level
mappings are excluded.

| Classification | Weighted references | Share |
| --- | --- | --- |
| Detectable | 72.5 | 24.1% |
| Detectable, conditional | 63.7 | 21.2% |
| Partially detectable | 5.0 | 1.7% |
| Out of scope | 123.8 | 41.1% |
| Internal category nodes | 36.0 | 12.0% |

**The weighted picture is worse than the vector count, and the reason matters.**
The documented incident literature is dominated by name confusion and by packages
that were malicious from creation: AV-200 carries 18 references, AV-100 another
18, typosquatting alone 11, dangling references 10. All are out of scope here, and
not by oversight. A system that verifies a project's releases against that
project's own history cannot help someone who installed a different package
entirely. Nothing anchored is contradicted, because nothing anchored was involved.

That is the honest limitation to state in Chapter 4: this system addresses
subversion of a legitimate package, which is the smaller share of documented
incidents but the harder one to detect by other means, and it says nothing about
package selection, which is the larger share and is addressed by other controls.

## What it does catch, stated plainly

Tampering with version control after a release is anchored, including the
force-moved tag pattern of the tj-actions incident, which is demonstrated working
on three live networks in `tag-retargeting.md`. Interception, DNS poisoning, URL
tampering and dependency-resolution abuse, because each delivers an artifact that
does not match the anchored tree. Malicious publication by someone holding
registry credentials, and substitution inside the hosting system, for the same
reason. Source-level build injection. And, partially, update-blocking: a consumer
frozen on an older genuine release sees no hash mismatch, but the anchor history
is public and append-only, so a newer release is visible on chain even when a
registry hides it.

## Against Sigstore, which RQ4 names directly

The comparison is narrower than a coverage table suggests, because the two systems
fail differently rather than at different rates.

Sigstore establishes that an artifact was signed by a given identity through a
given workflow, and records it in Rekor. On the vectors above it performs
comparably: a substituted artifact fails signature verification much as it fails
anchor comparison. The difference is not which attacks are covered but what a
verifier must assume. Sigstore's verification terminates at a transparency log
operated by one organisation, and a verifier has no external means of checking
that the log is showing them true records. Anchor comparison terminates at a
public chain, where the record is readable without permission and cannot be
rewritten by any single party, including the project or its author.

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
- The 31 conditional vectors are reported as a single group. Splitting them would
  require classifying each project's release artifact type, which belongs to the
  repository sample rather than to the taxonomy.
- Vectors are classified against the system as built, three L2 networks with tag
  and snapshot anchoring. The RQ2 comparison re-runs this rubric under the three
  anchoring strategies and is not part of this record.
