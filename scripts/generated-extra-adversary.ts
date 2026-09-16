/**
 * Schema v1 generated-extra adversarial boundary. Two artifacts place different
 * bytes at the same declared extra path. Local verify with a stubbed anchor.
 *
 *   npx ts-node --transpile-only scripts/generated-extra-adversary.ts
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ethers } from "ethers";
import { hashDirectory } from "../cli/src/lib/git-tree";
import { treeHashToBytes32 } from "../cli/src/lib/git-tree";
import { assertGitOk, gitTreeHash, runGit } from "../cli/src/lib/git-exec";
import { verifyArtifact } from "../cli/src/lib/verify";
import { type ProvenanceManifest } from "../cli/src/lib/manifest";

const PROJECT_ID = ethers.id("gpa-generated-extra-adversary");
const TAG = "v-extra";
const EXTRA_PATH = "payload.txt";

function writeTree(root: string, extraBody: string | null, trackedHello = "hello\n"): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "hello.txt"), trackedHello);
  if (extraBody !== null) {
    fs.writeFileSync(path.join(root, EXTRA_PATH), extraBody);
  }
}

function gitRepo(dir: string): void {
  assertGitOk(runGit(["init"], { cwd: dir }), "init");
  assertGitOk(runGit(["config", "user.email", "gpa@test.local"], { cwd: dir }), "email");
  assertGitOk(runGit(["config", "user.name", "GPA"], { cwd: dir }), "name");
  assertGitOk(runGit(["config", "core.autocrlf", "false"], { cwd: dir }), "crlf");
  assertGitOk(runGit(["add", "."], { cwd: dir }), "add");
  assertGitOk(runGit(["commit", "-m", "fixture"], { cwd: dir }), "commit");
  assertGitOk(runGit(["tag", TAG], { cwd: dir }), "tag");
}

function sha256Hex(body: string): string {
  return `0x${crypto.createHash("sha256").update(body, "utf8").digest("hex")}`;
}

async function main() {
  const temps: string[] = [];
  const mk = (prefix: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temps.push(dir);
    return dir;
  };

  const repo = mk("gpa-gx-repo-");
  writeTree(repo, null);
  gitRepo(repo);
  const gitTree = gitTreeHash(repo, TAG);
  const fromDir = await hashDirectory(repo);
  if (fromDir.treeHashHex !== gitTree) {
    throw new Error(`fixture hashDirectory ${fromDir.treeHashHex} != git ${gitTree}`);
  }

  const extraA = "payload-one\n";
  const extraB = "payload-TWO\n";
  const manifest: ProvenanceManifest = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    extras: [
      {
        path: EXTRA_PATH,
        reason: "generated file absent from the Git tree",
        source: "adversary fixture",
      },
    ],
  };

  const stubAnchor = {
    treeHash: treeHashToBytes32(gitTree),
    sbomHash: ethers.ZeroHash,
    timestamp: 0n,
    submitter: ethers.ZeroAddress,
    revision: 1,
    present: true,
    address: ethers.ZeroAddress,
    chainId: 31337,
  };

  const artifactA = mk("gpa-gx-a-");
  const artifactB = mk("gpa-gx-b-");
  const trackedSwap = mk("gpa-gx-s-");
  writeTree(artifactA, extraA);
  writeTree(artifactB, extraB);
  writeTree(trackedSwap, null, "HELLO\n");

  const verify = (artifact: string, extras: ProvenanceManifest["extras"]) =>
    verifyArtifact({
      artifact,
      projectId: PROJECT_ID,
      tag: TAG,
      repoRoot: repo,
      manifest: { ...manifest, extras },
      networks: ["local"],
      fetchAnchor: async () => stubAnchor,
    });

  const a = await verify(artifactA, manifest.extras);
  const b = await verify(artifactB, manifest.extras);
  const withoutManifest = await verify(artifactA, []);
  const swappedTracked = await verify(trackedSwap, manifest.extras);

  const out = {
    collectedAt: new Date().toISOString(),
    method:
      "Local Git fixture with hello.txt tracked. Schema v1 manifest declares payload.txt. " +
      "Two artifacts differ only at that path. Stubbed on-chain tree hash. No live network.",
    gitTree,
    extraPath: EXTRA_PATH,
    extraA: { body: extraA.replace("\n", "\\n"), sha256: sha256Hex(extraA) },
    extraB: { body: extraB.replace("\n", "\\n"), sha256: sha256Hex(extraB) },
    artifactA: {
      status: a.status,
      computedTreeHash: a.computedTreeHash,
      usedExtras: a.usedExtras,
      message: a.message,
    },
    artifactB: {
      status: b.status,
      computedTreeHash: b.computedTreeHash,
      usedExtras: b.usedExtras,
      message: b.message,
    },
    undeclaredExtra: { status: withoutManifest.status, message: withoutManifest.message },
    trackedContentSwap: { status: swappedTracked.status, message: swappedTracked.message },
    schemaV1AcceptsBothDeclaredPayloads: a.status === "pass_with_extras" && b.status === "pass_with_extras",
    schemaV1RejectsUndeclaredExtra: withoutManifest.status === "fail",
    schemaV1RejectsTrackedSwap: swappedTracked.status === "fail",
    schemaV2NotImplemented: true,
  };

  const outPath = path.join(__dirname, "..", "evaluation", "data", "generated-extra-adversary.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);

  for (const dir of temps) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
