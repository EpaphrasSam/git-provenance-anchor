import { expect } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ethers } from "ethers";
import { hashArchive, hashDirectory, treeHashToBytes32 } from "../../cli/src/lib/git-tree";
import { assertGitOk, runGit } from "../../cli/src/lib/git-exec";
import { verifyArtifact, reverifyProject } from "../../cli/src/lib/verify";

const repoRoot = path.resolve(__dirname, "../..");
const projectId = ethers.id("verify-regression");
const tag = "v1";

function anchor(treeHash: string, sbomHash: string, present = true) {
  return {
    treeHash: present ? treeHashToBytes32(treeHash) : ethers.ZeroHash,
    sbomHash,
    timestamp: 1n,
    submitter: ethers.ZeroAddress,
    revision: present ? 1 : 0,
    present,
    address: ethers.ZeroAddress,
    chainId: 1,
  };
}

async function artifactFixture(): Promise<{ directory: string; treeHash: string }> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gpa-verify-unit-"));
  await fs.promises.writeFile(path.join(directory, "file.txt"), "verified\n");
  return { directory, treeHash: (await hashDirectory(directory)).treeHashHex };
}

describe("verify report regressions", function () {
  this.timeout(60_000);

  it("reports matching and mismatching SBOM hashes", async () => {
    const fixture = await artifactFixture();
    const sbomPath = path.join(fixture.directory, "..", `sbom-${Date.now()}.json`);
    fs.writeFileSync(sbomPath, '{"bomFormat":"CycloneDX"}\n');
    const sbomHash = `0x${crypto.createHash("sha256").update(fs.readFileSync(sbomPath)).digest("hex")}`;

    const matching = await verifyArtifact({
      artifact: fixture.directory,
      projectId,
      tag,
      repoRoot,
      manifest: null,
      networks: ["alpha"],
      sbomPath,
      fetchAnchor: async () => anchor(fixture.treeHash, sbomHash),
    });
    expect(matching.status).to.equal("pass");
    expect(matching.computedSbomHash).to.equal(sbomHash);
    expect(matching.networks[0].matchesSbom).to.equal(true);

    const mismatching = await verifyArtifact({
      artifact: fixture.directory,
      projectId,
      tag,
      repoRoot,
      manifest: null,
      networks: ["alpha"],
      sbomPath,
      fetchAnchor: async () => anchor(fixture.treeHash, ethers.ZeroHash),
    });
    expect(mismatching.status).to.equal("fail");
    expect(mismatching.networks[0].matchesSbom).to.equal(false);
    expect(mismatching.message).to.include("SBOM hash mismatch");
  });

  it("fails when any configured network lacks the anchor", async () => {
    const fixture = await artifactFixture();
    const report = await verifyArtifact({
      artifact: fixture.directory,
      projectId,
      tag,
      repoRoot,
      manifest: null,
      networks: ["alpha", "beta"],
      fetchAnchor: async (_root, network) =>
        anchor(fixture.treeHash, ethers.ZeroHash, network === "alpha"),
    });

    expect(report.status).to.equal("fail");
    expect(report.networks.map((item) => [item.network, item.anchor.present])).to.deep.equal([
      ["alpha", true],
      ["beta", false],
    ]);
    expect(report.message).to.include("beta");
  });

  it("fails when configured networks anchor different tree hashes", async () => {
    const fixture = await artifactFixture();
    const report = await verifyArtifact({
      artifact: fixture.directory,
      projectId,
      tag,
      repoRoot,
      manifest: null,
      networks: ["alpha", "beta"],
      fetchAnchor: async (_root, network) =>
        anchor(network === "alpha" ? fixture.treeHash : "f".repeat(40), ethers.ZeroHash),
    });

    expect(report.status).to.equal("fail");
    expect(report.networks.map((item) => item.matchesComputed)).to.deep.equal([true, false]);
    expect(report.message).to.include("Networks disagree on the anchored tree hash");
  });

  it("fails reverify when a configured network lacks an expected anchor", async () => {
    const fixture = await artifactFixture();
    assertGitOk(runGit(["init"], { cwd: fixture.directory }), "init");
    assertGitOk(runGit(["config", "user.email", "gpa@test.local"], { cwd: fixture.directory }), "email");
    assertGitOk(runGit(["config", "user.name", "GPA"], { cwd: fixture.directory }), "name");
    assertGitOk(runGit(["add", "."], { cwd: fixture.directory }), "add");
    assertGitOk(runGit(["commit", "-m", "fixture"], { cwd: fixture.directory }), "commit");
    assertGitOk(runGit(["tag", tag], { cwd: fixture.directory }), "tag");
    const treeHash = runGit(["rev-parse", `${tag}^{tree}`], { cwd: fixture.directory }).stdout.trim();

    const result = await reverifyProject({
      repoRoot,
      gitRepo: fixture.directory,
      projectId,
      networks: ["alpha", "beta"],
      listAnchors: async (network) =>
        network === "alpha"
          ? [{ network, kind: 0, ref: tag, treeHash: treeHashToBytes32(treeHash), revision: 1 }]
          : [],
    });

    expect(result.status).to.equal("fail");
    expect(result.items).to.deep.include({
      network: "beta",
      kind: 0,
      ref: tag,
      anchoredTreeHash: "",
      currentTreeHash: null,
      status: "missing_anchor",
      detail: "Configured network has no corresponding anchor",
    });
  });

  it("preserves archive modes when manifest extras are excluded", async () => {
    const repository = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gpa-archive-manifest-"));
    fs.mkdirSync(path.join(repository, "tools"));
    fs.writeFileSync(path.join(repository, "README.md"), "archive fixture\n");
    fs.writeFileSync(path.join(repository, "tools", "run.sh"), "#!/bin/sh\necho ok\n");
    fs.writeFileSync(path.join(repository, "generated.txt"), "generated\n");
    assertGitOk(runGit(["init"], { cwd: repository }), "init");
    assertGitOk(runGit(["config", "user.email", "gpa@test.local"], { cwd: repository }), "email");
    assertGitOk(runGit(["config", "user.name", "GPA"], { cwd: repository }), "name");
    assertGitOk(runGit(["add", "."], { cwd: repository }), "add");
    assertGitOk(runGit(["update-index", "--chmod=+x", "tools/run.sh"], { cwd: repository }), "chmod");
    assertGitOk(runGit(["commit", "-m", "archive"], { cwd: repository }), "commit");
    assertGitOk(runGit(["tag", tag], { cwd: repository }), "tag");

    const archivePath = path.join(repository, "fixture.tar");
    assertGitOk(
      runGit(["archive", "--format=tar", "-o", archivePath, tag], { cwd: repository }),
      "archive"
    );
    assertGitOk(runGit(["rm", "generated.txt"], { cwd: repository }), "remove extra");
    assertGitOk(runGit(["commit", "-m", "without extra"], { cwd: repository }), "commit expected");
    const expectedArchivePath = path.join(repository, "expected.tar");
    assertGitOk(
      runGit(["archive", "--format=tar", "-o", expectedArchivePath, "HEAD"], { cwd: repository }),
      "expected archive"
    );
    const expected = await hashArchive(expectedArchivePath);

    const report = await verifyArtifact({
      artifact: archivePath,
      projectId,
      tag,
      repoRoot,
      manifest: {
        schemaVersion: 1,
        projectId,
        extras: [{ path: "generated.txt", reason: "generated output", source: "test" }],
      },
      networks: ["alpha"],
      fetchAnchor: async () => anchor(expected.treeHashHex, ethers.ZeroHash),
    });

    expect(report.computedTreeHash).to.equal(expected.treeHashHex);
    expect(report.status).to.equal("pass_with_extras");
    expect(report.usedExtras).to.deep.equal(["generated.txt"]);
    await expected.cleanup();
  });
});
