/**
 * Supplementary Git LFS measurement. Clones a pinned public repo with smudge
 * disabled, then compares hashGitRef to git rev-parse.
 *
 *   npx ts-node --transpile-only scripts/lfs-supplement.ts
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { hashDirectory, hashGitRef } from "../cli/src/lib/git-tree";
import { gitTreeHash } from "../cli/src/lib/git-exec";
import { findRepoRoot } from "../cli/src/lib/chain";

const REPO = "cbeams/lfs-test";
const CLONE_URL = "https://github.com/cbeams/lfs-test.git";
const PINNED_COMMIT = "42222296478b15c48bcb72cbf06db68606269bbb";
const POINTER_PATH = "sample.pdf";
const POINTER_OID = "sha256:b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553";
const POINTER_DECLARED_SIZE = 184292;

function run(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  }
  return (result.stdout || "").trim();
}

async function main() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-lfs-"));
  const clone = spawnSync(
    "git",
    ["-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false", "clone", "--depth", "1", CLONE_URL, dest],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
    },
  );
  if (clone.status !== 0) {
    throw new Error(clone.stderr || clone.stdout || "clone failed");
  }

  const commit = run(dest, ["rev-parse", "HEAD"]);
  if (commit !== PINNED_COMMIT) {
    throw new Error(`HEAD moved: expected ${PINNED_COMMIT}, got ${commit}`);
  }

  const gitTree = gitTreeHash(dest, "HEAD");
  const fromRef = await hashGitRef(dest, "HEAD");
  const fromDir = await hashDirectory(dest);
  const pointerOnDisk = fs.readFileSync(path.join(dest, POINTER_PATH), "utf8");
  const pointerBytes = fs.statSync(path.join(dest, POINTER_PATH)).size;

  const out = {
    collectedAt: new Date().toISOString(),
    role: "supplementary; not a member of the 12-repository sample",
    eligibility: {
      publicHttps: true,
      gitattributesLfs: "*.pdf filter=lfs diff=lfs merge=lfs -text",
      pointerInTree: true,
      skipSmudgeClone: true,
      notInOriginalTwelve: true,
      pinnedCommit: PINNED_COMMIT,
    },
    repo: REPO,
    cloneUrl: CLONE_URL,
    commit,
    gitTree,
    hashGitRef: fromRef.treeHashHex,
    hashGitRefMatch: fromRef.treeHashHex === gitTree,
    hashDirectory: fromDir.treeHashHex,
    hashDirectoryMatch: fromDir.treeHashHex === gitTree,
    lfsPointersFromRef: fromRef.lfsPointers,
    lfsPointersFromDir: fromDir.lfsPointers,
    pointerPath: POINTER_PATH,
    pointerBytesOnDisk: pointerBytes,
    pointerDeclaredSize: POINTER_DECLARED_SIZE,
    pointerOid: POINTER_OID,
    pointerHead: pointerOnDisk.split(/\r?\n/).slice(0, 3),
    note:
      "hashGitRef reads the object store and matches git. hashDirectory hashed the Windows checkout, where README.md has CRLF; that mismatch is core.autocrlf, not LFS. The tree hash covers the 131-byte pointer, not the 184292-byte PDF.",
  };

  const outPath = path.join(findRepoRoot(), "evaluation", "data", "lfs-supplement.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
