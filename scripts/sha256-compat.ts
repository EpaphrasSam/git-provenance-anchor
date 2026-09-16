/**
 * SHA-1 vs SHA-256 Git object-format compatibility for the evaluated CLI and
 * contract. Local only: in-process Hardhat chain, no broadcast, no key.
 *
 *   npx hardhat run scripts/sha256-compat.ts --network hardhat
 */
import { ethers } from "hardhat";
import { AnchorRegistry__factory } from "../typechain-types";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import {
  bytes32ToTreeHashHex,
  hashArtifact,
  hashDirectory,
  hashGitRef,
  treeHashToBytes32,
} from "../cli/src/lib/git-tree";
import { gitTreeHash, runGit } from "../cli/src/lib/git-exec";
import { findRepoRoot, KIND_TAG } from "../cli/src/lib/chain";

const KIND = KIND_TAG;

function gitOk(repo: string, args: string[], what: string): string {
  const result = runGit(args, { cwd: repo });
  if (result.status !== 0) {
    throw new Error(`${what}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function initRepo(objectFormat: "sha1" | "sha256"): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `gpa-${objectFormat}-`));
  const initArgs =
    objectFormat === "sha256"
      ? ["init", "--object-format=sha256"]
      : ["init", "--object-format=sha1"];
  gitOk(repo, initArgs, "git init");
  gitOk(repo, ["config", "user.email", "gpa@test.local"], "email");
  gitOk(repo, ["config", "user.name", "GPA compat"], "name");
  gitOk(repo, ["config", "core.autocrlf", "false"], "autocrlf");
  fs.writeFileSync(path.join(repo, "README.md"), "# sha compat fixture\n");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "main.txt"), "hello\n");
  gitOk(repo, ["add", "."], "add");
  gitOk(repo, ["commit", "-m", "fixture"], "commit");
  gitOk(repo, ["tag", "v-compat"], "tag");
  return repo;
}

function probe(label: string, fn: () => unknown): { label: string; ok: boolean; detail: string } {
  try {
    const value = fn();
    return { label, ok: true, detail: String(value) };
  } catch (error) {
    return { label, ok: false, detail: (error as Error).message };
  }
}

async function probeAsync(
  label: string,
  fn: () => Promise<unknown>,
): Promise<{ label: string; ok: boolean; detail: string }> {
  try {
    const value = await fn();
    return { label, ok: true, detail: String(value) };
  } catch (error) {
    return { label, ok: false, detail: (error as Error).message };
  }
}

async function exercise(objectFormat: "sha1" | "sha256") {
  const repo = initRepo(objectFormat);
  const format = gitOk(repo, ["rev-parse", "--show-object-format"], "object-format");
  const treeHex = gitTreeHash(repo, "v-compat");
  const steps: { label: string; ok: boolean; detail: string }[] = [];

  steps.push({
    label: "workflow hash extraction (git rev-parse <tag>^{tree})",
    ok: (objectFormat === "sha1" && treeHex.length === 40) || (objectFormat === "sha256" && treeHex.length === 64),
    detail: `${treeHex} (len ${treeHex.length}) object-format=${format}`,
  });

  const packed = probe("bytes32 transport (treeHashToBytes32)", () => treeHashToBytes32(treeHex));
  steps.push(packed);
  const packedHex = packed.ok ? packed.detail : "";

  const decoded = probe("CLI decoding (bytes32ToTreeHashHex)", () => {
    if (!packed.ok) throw new Error("no packed value");
    const back = bytes32ToTreeHashHex(packedHex);
    if (back !== treeHex) throw new Error(`round-trip ${back} != ${treeHex}`);
    return back;
  });
  steps.push(decoded);

  const reconstructed = await probeAsync("tree reconstruction (hashGitRef vs rev-parse)", async () => {
    const got = await hashGitRef(repo, "v-compat");
    if (got.treeHashHex !== treeHex) {
      throw new Error(`hashGitRef=${got.treeHashHex} git=${treeHex}`);
    }
    return got.treeHashHex;
  });
  steps.push(reconstructed);

  const directory = await probeAsync("working-tree hash (hashDirectory vs rev-parse)", async () => {
    const got = await hashDirectory(repo);
    if (got.treeHashHex !== treeHex) {
      throw new Error(`hashDirectory=${got.treeHashHex} git=${treeHex}`);
    }
    return got.treeHashHex;
  });
  steps.push(directory);

  const archivePath = path.join(repo, "fixture.tar");
  const archived = await probeAsync("artifact verification (git archive then hashArtifact)", async () => {
    const listed = spawnSync("git", ["archive", "--format=tar", "-o", archivePath, "v-compat"], {
      cwd: repo,
      encoding: "utf8",
      windowsHide: true,
    });
    if (listed.status !== 0) {
      throw new Error(listed.stderr || listed.stdout || "git archive failed");
    }
    const got = await hashArtifact(archivePath);
    try {
      await got.cleanup?.();
    } catch {
      /* ignore */
    }
    if (got.treeHashHex !== treeHex) {
      throw new Error(`hashArtifact=${got.treeHashHex} git=${treeHex}`);
    }
    return got.treeHashHex;
  });
  steps.push(archived);

  let storage: { label: string; ok: boolean; detail: string } = {
    label: "contract storage (local Hardhat AnchorRegistry.anchor)",
    ok: false,
    detail: "skipped",
  };
  if (packed.ok) {
    storage = await probeAsync(storage.label, async () => {
      const [signer] = await ethers.getSigners();
      const registry = await new AnchorRegistry__factory(signer).deploy();
      await registry.waitForDeployment();
      const projectId = ethers.id(`gpa-sha-compat-${objectFormat}`);
      await (await registry.registerProject(projectId, `sha-compat-${objectFormat}`)).wait();
      const tx = await registry.anchor(projectId, KIND, "v-compat", packedHex, ethers.ZeroHash);
      const receipt = await tx.wait();
      const stored = await registry.getAnchor(projectId, KIND, "v-compat");
      if (stored.treeHash.toLowerCase() !== packedHex.toLowerCase()) {
        throw new Error(`stored ${stored.treeHash} != packed ${packedHex}`);
      }
      const fromChain = bytes32ToTreeHashHex(stored.treeHash);
      return `gas=${receipt?.gasUsed?.toString()} stored=${stored.treeHash} decoded=${fromChain}`;
    });
  }
  steps.push(storage);

  return {
    objectFormat,
    reportedFormat: format,
    repo,
    treeHex,
    steps,
  };
}

async function main() {
  const version = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
  const sha1 = await exercise("sha1");
  const sha256 = await exercise("sha256");

  const out = {
    collectedAt: new Date().toISOString(),
    gitVersion: version.stdout.trim(),
    method:
      "Local Git fixtures, one SHA-1 and one SHA-256 object format. Same tree layout. " +
      "In-process Hardhat AnchorRegistry. No live network, no private key.",
    sha1,
    sha256,
  };

  const repoRoot = findRepoRoot();
  const outPath = path.join(repoRoot, "evaluation", "data", "sha256-compat.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
