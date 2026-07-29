import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AnchorRegistry, AnchorRegistry__factory } from "../../typechain-types";
import { hashDirectory, treeHashToBytes32, bytes32ToTreeHashHex } from "../../cli/src/lib/git-tree";
import { assertGitOk, gitTreeHash, runGit } from "../../cli/src/lib/git-exec";
import { KIND_TAG, parseAnchor } from "../../cli/src/lib/chain";

describe("verify against local chain", function () {
  this.timeout(120_000);

  let registry: AnchorRegistry;
  let fixture: string;
  let tag: string;
  let treeHex: string;
  let projectId: string;

  before(async () => {
    const [owner] = await ethers.getSigners();
    registry = await new AnchorRegistry__factory(owner).deploy();
    await registry.waitForDeployment();

    projectId = ethers.id("verify-fixture");
    await (await registry.registerProject(projectId, "verify-fixture")).wait();

    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-verify-"));
    fs.writeFileSync(path.join(fixture, "hello.txt"), "hello verify\n");
    fs.mkdirSync(path.join(fixture, "pkg"));
    fs.writeFileSync(path.join(fixture, "pkg", "mod.txt"), "mod\n");

    assertGitOk(runGit(["init"], { cwd: fixture }), "init");
    assertGitOk(runGit(["config", "user.email", "gpa@test.local"], { cwd: fixture }), "email");
    assertGitOk(runGit(["config", "user.name", "GPA"], { cwd: fixture }), "name");
    assertGitOk(runGit(["config", "core.autocrlf", "false"], { cwd: fixture }), "crlf");
    assertGitOk(runGit(["add", "."], { cwd: fixture }), "add");
    assertGitOk(runGit(["commit", "-m", "v"], { cwd: fixture }), "commit");
    tag = "v1.0.0-fixture";
    assertGitOk(runGit(["tag", tag], { cwd: fixture }), "tag");
    treeHex = gitTreeHash(fixture, tag);

    const hashed = await hashDirectory(fixture);
    expect(hashed.treeHashHex).to.equal(treeHex);

    await (
      await registry.anchor(
        projectId,
        KIND_TAG,
        tag,
        treeHashToBytes32(treeHex),
        ethers.ZeroHash
      )
    ).wait();

    const onchain = parseAnchor(await registry.getAnchor(projectId, KIND_TAG, tag));
    expect(onchain.present).to.equal(true);
    expect(bytes32ToTreeHashHex(onchain.treeHash)).to.equal(treeHex);
  });

  it("tree hash of fixture matches the anchored value", async () => {
    const got = await hashDirectory(fixture);
    expect(got.treeHashHex).to.equal(treeHex);
  });

  it("content swap is visible as a hash mismatch", async () => {
    const swapped = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-swap-"));
    fs.writeFileSync(path.join(swapped, "hello.txt"), "HELLO VERIFY\n");
    fs.mkdirSync(path.join(swapped, "pkg"));
    fs.writeFileSync(path.join(swapped, "pkg", "mod.txt"), "mod\n");
    const got = await hashDirectory(swapped);
    expect(got.treeHashHex).to.not.equal(treeHex);
  });

  it("declared extras can be stripped to recover the anchored tree", async () => {
    const withExtra = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-extra-"));
    fs.writeFileSync(path.join(withExtra, "hello.txt"), "hello verify\n");
    fs.mkdirSync(path.join(withExtra, "pkg"));
    fs.writeFileSync(path.join(withExtra, "pkg", "mod.txt"), "mod\n");
    fs.mkdirSync(path.join(withExtra, "dist"));
    fs.writeFileSync(path.join(withExtra, "dist", "out.js"), "built\n");

    const full = await hashDirectory(withExtra);
    expect(full.treeHashHex).to.not.equal(treeHex);

    const stripped = await hashDirectory(withExtra, {
      excludePaths: new Set(["dist/out.js", "dist"]),
    });
    expect(stripped.treeHashHex).to.equal(treeHex);
  });
});
