import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  hashArchive,
  hashBlob,
  hashDirectory,
  isLfsPointer,
  treeHashToBytes32,
} from "../../cli/src/lib/git-tree";
import { assertGitOk, gitTreeHash, runGit, type GitHost } from "../../cli/src/lib/git-exec";
import { resolveExtraPaths } from "../../cli/src/lib/manifest";

async function mkTempRepo(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "gpa-fixture-"));
}

function writeFile(root: string, rel: string, content: string | Buffer): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

async function gitInitCommit(repo: string, host: GitHost = "windows"): Promise<void> {
  assertGitOk(runGit(["init"], { cwd: repo, host }), "git init");
  assertGitOk(runGit(["config", "user.email", "gpa@test.local"], { cwd: repo, host }), "config email");
  assertGitOk(runGit(["config", "user.name", "GPA Test"], { cwd: repo, host }), "config name");
  assertGitOk(runGit(["config", "core.autocrlf", "false"], { cwd: repo, host }), "config autocrlf");
  assertGitOk(runGit(["add", "."], { cwd: repo, host }), "git add");
  assertGitOk(runGit(["commit", "-m", "fixture"], { cwd: repo, host }), "git commit");
}

describe("git-tree hasher", function () {
  this.timeout(60_000);

  it("matches git blob hashing for a single file", async () => {
    const content = Buffer.from("hello provenance\n", "utf8");
    const ours = hashBlob(content).toString("hex");
    const tmp = await mkTempRepo();
    const file = path.join(tmp, "f.txt");
    fs.writeFileSync(file, content);
    const result = runGit(["hash-object", file], { cwd: tmp, host: "windows" });
    assertGitOk(result, "hash-object");
    expect(ours).to.equal(result.stdout.trim().toLowerCase());
  });

  it("matches git write-tree for a nested fixture (Windows git)", async () => {
    const repo = await mkTempRepo();
    writeFile(repo, "README.md", "# fixture\n");
    writeFile(repo, "src/main.ts", "export const x = 1;\n");
    writeFile(repo, "src/util/hash.ts", "export function h() { return 0; }\n");
    writeFile(repo, "docs/note.txt", "note\n");
    await gitInitCommit(repo, "windows");

    const expected = gitTreeHash(repo, "HEAD", "windows");
    const got = await hashDirectory(repo);
    expect(got.treeHashHex).to.equal(expected);
    expect(treeHashToBytes32(got.treeHashHex)).to.match(/^0x0{24}[0-9a-f]{40}$/);
  });

  it("matches Ubuntu git write-tree for the same fixture layout", async function () {
    const probe = runGit(["--version"], { cwd: process.cwd(), host: "wsl" });
    if (probe.status !== 0) {
      this.skip();
    }

    const repo = await mkTempRepo();
    writeFile(repo, "README.md", "# fixture\n");
    writeFile(repo, "src/main.ts", "export const x = 1;\n");
    writeFile(repo, "src/util/hash.ts", "export function h() { return 0; }\n");
    writeFile(repo, "docs/note.txt", "note\n");
    await gitInitCommit(repo, "wsl");

    const expected = gitTreeHash(repo, "HEAD", "wsl");
    const winExpected = gitTreeHash(repo, "HEAD", "windows");
    expect(expected).to.equal(winExpected);

    const got = await hashDirectory(repo);
    expect(got.treeHashHex).to.equal(expected);
  });

  it("same-name different-content produces a different tree hash", async () => {
    const a = await mkTempRepo();
    const b = await mkTempRepo();
    writeFile(a, "payload.bin", Buffer.from("aaaaaaaa"));
    writeFile(b, "payload.bin", Buffer.from("bbbbbbbb"));
    await gitInitCommit(a);
    await gitInitCommit(b);

    const ha = await hashDirectory(a);
    const hb = await hashDirectory(b);
    expect(ha.treeHashHex).to.not.equal(hb.treeHashHex);
    expect(ha.treeHashHex).to.equal(gitTreeHash(a));
    expect(hb.treeHashHex).to.equal(gitTreeHash(b));
    expect(ha.paths).to.deep.equal(hb.paths);
  });

  it("hashes a git archive tarball the same as the tagged tree", async () => {
    const repo = await mkTempRepo();
    writeFile(repo, "a.txt", "alpha\n");
    writeFile(repo, "dir/b.txt", "beta\n");
    await gitInitCommit(repo);
    assertGitOk(runGit(["tag", "v1"], { cwd: repo }), "tag");

    const archive = path.join(repo, "v1.tar");
    assertGitOk(
      runGit(["archive", "--format=tar", "-o", archive, "v1"], { cwd: repo }),
      "archive"
    );

    const expected = gitTreeHash(repo, "v1");
    const got = await hashArchive(archive);
    try {
      expect(got.treeHashHex).to.equal(expected);
    } finally {
      await got.cleanup();
    }
  });

  it("hashGitRef matches git rev-parse even when autocrlf would rewrite archives", async () => {
    const { hashGitRef } = await import("../../cli/src/lib/git-tree");
    const repo = await mkTempRepo();
    writeFile(repo, "note.txt", "line\n");
    await gitInitCommit(repo);
    assertGitOk(runGit(["tag", "v-ref"], { cwd: repo }), "tag");
    const expected = gitTreeHash(repo, "v-ref");
    const got = await hashGitRef(repo, "v-ref");
    try {
      expect(got.treeHashHex).to.equal(expected);
    } finally {
      if (got.cleanup) await got.cleanup();
    }
  });

  it("detects Git LFS pointer files without treating them as covered content", async () => {
    const pointer = Buffer.from(
      "version https://git-lfs.github.com/spec/v1\noid sha256:" +
        "a".repeat(64) +
        "\nsize 123\n",
      "utf8"
    );
    expect(isLfsPointer(pointer)).to.equal(true);

    const repo = await mkTempRepo();
    writeFile(repo, "large.bin", pointer);
    writeFile(repo, "ok.txt", "ok\n");
    await gitInitCommit(repo);
    const got = await hashDirectory(repo);
    expect(got.lfsPointers).to.deep.equal(["large.bin"]);
    expect(got.treeHashHex).to.equal(gitTreeHash(repo));
  });

  it("sorts trees as if their names had a trailing slash", async () => {
    const repo = await mkTempRepo();
    writeFile(repo, "foo/inner.txt", "in\n");
    writeFile(repo, "foo.bar", "file\n");
    await gitInitCommit(repo);
    const got = await hashDirectory(repo);
    expect(got.treeHashHex).to.equal(gitTreeHash(repo));
  });
});

describe("manifest extras", () => {
  it("matches path globs against artifact paths", () => {
    const paths = ["src/a.ts", "dist/index.js", "dist/chunk.js", "README.md"];
    const { matched } = resolveExtraPaths(paths, [
      { path: "dist/**", reason: "build output", source: "tsc" },
    ]);
    expect(matched).to.deep.equal(["dist/chunk.js", "dist/index.js"]);
  });
});
