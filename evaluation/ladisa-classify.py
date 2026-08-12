import json, csv, collections

TAX = json.load(open("taxonomy.json"))
REFS = json.load(open("references.json"))

# Decision table. Key = avId at which the rubric reaches a uniform answer.
# Every descendant inherits unless it appears here itself (rubric step 3).
DECIDE = {
 "AV-100": ("out-of-scope", "no-counterpart",
   "A package that is malicious from creation has no honest anchored counterpart to diverge from. Its author can anchor it faithfully."),
 "AV-200": ("out-of-scope", "no-counterpart",
   "Name confusion substitutes a different package rather than altering a legitimate one. Nothing anchored is contradicted. Verification is bound to a project identifier rather than a name, which removes the name as the trust anchor, but the system offers no signal at selection time."),
 "AV-301": ("out-of-scope", "pre-anchor",
   "Malicious code merged into the source before the release tag is inside the tree the anchor commits to. The anchor records it faithfully."),
 "AV-302": ("out-of-scope", "pre-anchor",
   "Acting as or impersonating a maintainer to inject into sources places the code inside the anchored tree. Where the same credential compromise reaches the anchoring key, the vector falls under the named blind spot instead, which is also out of scope."),
 "AV-303": ("detectable", "post-anchor-vcs",
   "Tampering with the version control system after an anchor exists is what re-verification catches: a force-moved tag or rewritten history no longer matches the anchored tree hash. Demonstrated on three live networks in tag-retargeting.md. Tampering before the tag is anchored is out of scope, so this node is split by timing rather than by child."),
 "AV-400": ("detectable-conditional", "build-stage",
   "Detection depends on the artifact type, which the taxonomy does not model. A build that alters a source-level distributed artifact produces a mismatch against the anchored tree, the XZ Utils case. A build that alters only a compiled binary produces no mismatch, the SolarWinds case, and needs reproducible builds or build attestation, both out of scope."),
 "AV-501": ("out-of-scope", "no-counterpart",
   "Claiming an unclaimed or removed reference supplies a package that was never anchored by the legitimate project."),
 "AV-502": ("detectable", "artifact-mismatch",
   "Interception, DNS poisoning, URL tampering and resolution abuse all deliver an artifact that differs from the anchored tree. Detection requires the consumer to verify against the intended project identifier."),
 "AV-503": ("partial", "detectable-by-presence",
   "Blocking an update leaves the consumer on a genuine older release, so there is no hash mismatch. The anchor history is public and append-only, so a newer anchored release is visible on chain even when the registry hides it. Detection requires an active check rather than a passive one."),
 "AV-504": ("detectable", "artifact-mismatch",
   "Publishing a malicious version with registry credentials produces an artifact that does not match the anchored tree, unless the same attacker also holds the anchoring key, which is the named blind spot."),
 "AV-505": ("detectable", "artifact-mismatch",
   "Swapping the artifact in the hosting system leaves the on-chain anchor untouched, so the substituted artifact fails comparison."),
}
INTERNAL = {"AV-000", "AV-001", "AV-300", "AV-500"}

rows = []
def walk(node, path, decision):
    avid, name = node["avId"], node["avName"]
    here = DECIDE.get(avid)
    if here:
        decision = (avid, *here)
    p = path + [avid]
    if avid in INTERNAL and not here:
        cls, basis, why, at = "internal", "structural", "Category node; its children do not share one answer, so the rubric descends.", ""
    elif decision:
        at, cls, basis, why = decision
    else:
        at, cls, basis, why = "", "unclassified", "", ""
    rows.append({
        "avId": avid, "avName": name, "depth": len(path),
        "path": " > ".join(p),
        "classification": cls, "basis": basis,
        "decidedAtNode": at, "rationale": why,
    })
    for c in node.get("children") or []:
        walk(c, p, decision)

walk(TAX, [], None)

# evidence weighting: documented references mapped to each vector
refcount = collections.Counter()
for r in REFS:
    for v in r.get("vectors") or []:
        refcount[v["avId"]] += 1
for row in rows:
    row["mappedReferences"] = refcount.get(row["avId"], 0)

with open("/tmp/ladisa/ladisa-classification.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader(); w.writerows(rows)

inst = collections.Counter(r["classification"] for r in rows)
uniq = collections.defaultdict(set)
for r in rows: uniq[r["classification"]].add(r["avId"])
print("NODE INSTANCES:", dict(inst), "total", len(rows))
print("UNIQUE IDS:", {k: len(v) for k, v in uniq.items()})
decided = [r for r in rows if r["classification"] not in ("internal",)]
print("decided instances:", len(decided))
for c in ["detectable","detectable-conditional","partial","out-of-scope"]:
    n = inst[c]; print(f"  {c}: {n} ({100*n/len(decided):.1f}% of decided)")
print("distinct decision points:", len(DECIDE))
# evidence weighting excluding the root node's generic mappings
ew = collections.Counter()
seen=set()
for r in rows:
    if r["avId"] in seen or r["avId"]=="AV-000": continue
    seen.add(r["avId"]); ew[r["classification"]] += r["mappedReferences"]
tot=sum(ew.values())
print("\nREFERENCE-WEIGHTED (excl. root, unique ids):", dict(ew), "total", tot)
for c in ["detectable","detectable-conditional","partial","out-of-scope"]:
    print(f"  {c}: {ew[c]} ({100*ew[c]/tot:.1f}%)")

# --- corrected evidence weighting -------------------------------------------
# A shared vector id (the credential/system-compromise subtree) is attached under
# several parents, and its classification differs by parent. Deduplicating by
# first occurrence would silently assign all of its references to whichever
# parent happened to come first. Each id's references are therefore split evenly
# across its instances and summed by classification.
inst_count = collections.Counter(r["avId"] for r in rows)
alloc = collections.defaultdict(float)
for r in rows:
    if r["avId"] == "AV-000":
        continue
    alloc[r["classification"]] += refcount.get(r["avId"], 0) / inst_count[r["avId"]]
tot = sum(alloc.values())
print("\nREFERENCE-WEIGHTED, proportional allocation (root excluded), total %.0f" % tot)
for c in ["detectable", "detectable-conditional", "partial", "out-of-scope", "internal"]:
    print(f"  {c}: {alloc[c]:.1f} ({100*alloc[c]/tot:.1f}%)")

mixed = {i for i in inst_count if len({r['classification'] for r in rows if r['avId']==i}) > 1}
print("\nvector ids whose classification depends on where they attach:", len(mixed))
print(" ", sorted(mixed))

print("\nMost-referenced vectors and how they land:")
for avid, n in refcount.most_common(14):
    if avid == "AV-000": continue
    cls = sorted({r["classification"] for r in rows if r["avId"] == avid})
    nm = next(r["avName"] for r in rows if r["avId"] == avid)
    print(f"  {avid} {nm[:46]:48s} refs={n:3d}  {'/'.join(cls)}")
