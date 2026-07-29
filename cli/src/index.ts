#!/usr/bin/env node
import { Command } from "commander";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import {
  findRepoRoot,
  getWriteContract,
  KIND_SNAPSHOT,
  KIND_TAG,
  latestAnchors,
  listAnchorsFromEvents,
  loadDeployments,
} from "./lib/chain";
import { hashArtifact, hashGitRef, treeHashToBytes32 } from "./lib/git-tree";
import { toJson } from "./lib/json";
import { gitTreeHash } from "./lib/git-exec";
import {
  loadManifest,
  tryLoadManifest,
  writeManifest,
  type ProvenanceManifest,
} from "./lib/manifest";
import { reverifyProject, verifyArtifact } from "./lib/verify";

dotenv.config();

const program = new Command();

program
  .name("gpa")
  .description("Git Provenance Anchor verifier and maintainer CLI")
  .version("0.1.0");

program
  .command("tree-hash")
  .description("Reconstruct a Git tree hash from a directory, archive, or Git ref")
  .argument("[artifact]", "Directory, .tar, .tar.gz, or .tgz")
  .option("--ref <ref>", "Hash a Git ref via object-store archive (ignores working-tree CRLF)")
  .option("--repo <path>", "Repository for --ref", ".")
  .option("--json", "Print machine-readable JSON", false)
  .action(async (artifact: string | undefined, opts: { ref?: string; repo: string; json?: boolean }) => {
    if (!opts.ref && !artifact) {
      throw new Error("Pass an artifact path or --ref <git-ref>");
    }
    const result = opts.ref
      ? await hashGitRef(opts.repo, opts.ref)
      : await hashArtifact(artifact!);
    try {
      if (opts.json) {
        console.log(
          toJson({
            treeHash: result.treeHashHex,
            bytes32: treeHashToBytes32(result.treeHashHex),
            lfsPointers: result.lfsPointers,
            pathCount: result.paths.length,
          })
        );
      } else {
        console.log(result.treeHashHex);
        if (result.lfsPointers.length > 0) {
          console.error(
            `warning: ${result.lfsPointers.length} Git LFS pointer file(s) detected (out of scope)`
          );
          for (const p of result.lfsPointers) console.error(`  ${p}`);
        }
      }
    } finally {
      if (result.cleanup) await result.cleanup();
    }
  });

program
  .command("init")
  .description("Scaffold .provenance-manifest.json in the current repository")
  .option("--label <label>", "Human-readable project label")
  .option("--project-id <id>", "bytes32 project id (default: keccak256 of label or folder name)")
  .option("--force", "Overwrite an existing manifest", false)
  .action((opts: { label?: string; projectId?: string; force?: boolean }) => {
    const root = process.cwd();
    const existing = tryLoadManifest(root);
    if (existing && !opts.force) {
      throw new Error(".provenance-manifest.json already exists (pass --force to overwrite)");
    }
    const label = opts.label ?? path.basename(root);
    const projectId = opts.projectId ?? ethers.id(label);
    const deployments = loadDeployments(findRepoRoot(root));
    const manifest: ProvenanceManifest = {
      schemaVersion: 1,
      projectId,
      label,
      networks: [...deployments.keys()],
      extras: [],
    };
    const written = writeManifest(root, manifest);
    console.log(`Wrote ${written}`);
    console.log(`projectId=${projectId}`);
  });

program
  .command("verify")
  .description("Verify an artifact against on-chain anchors")
  .argument("[artifact]", "Directory or archive to verify")
  .requiredOption("--tag <tag>", "Release tag that was anchored")
  .option("--ref <ref>", "Verify a Git ref (object-store bytes; recommended on Windows)")
  .option("--repo <path>", "Repository for --ref", ".")
  .option("--project <id>", "Project id (default: from .provenance-manifest.json)")
  .option("--manifest <path>", "Path to manifest file")
  .option("--network <name>", "Restrict to one network (repeatable)", (v, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .option("--json", "Print JSON report", false)
  .action(
    async (
      artifact: string | undefined,
      opts: {
        tag: string;
        ref?: string;
        repo: string;
        project?: string;
        manifest?: string;
        network: string[];
        json?: boolean;
      }
    ) => {
      if (!opts.ref && !artifact) {
        throw new Error("Pass an artifact path or --ref <git-ref>");
      }
      const cwd = process.cwd();
      const repoRoot = findRepoRoot(cwd);
      const manifest = opts.manifest
        ? loadManifest(path.resolve(opts.manifest))
        : tryLoadManifest(cwd) ?? tryLoadManifest(repoRoot);
      const projectId = opts.project ?? manifest?.projectId;
      if (!projectId) {
        throw new Error("Pass --project or provide .provenance-manifest.json with projectId");
      }
      const report = await verifyArtifact({
        artifact,
        gitRef: opts.ref,
        gitRepo: path.resolve(opts.repo),
        projectId,
        tag: opts.tag,
        repoRoot,
        manifest,
        networks: opts.network.length > 0 ? opts.network : undefined,
      });
      if (opts.json) {
        console.log(toJson(report));
      } else {
        console.log(`status: ${report.status}`);
        console.log(`project: ${report.projectId}`);
        console.log(`tag: ${report.tag}`);
        console.log(`computed: ${report.computedTreeHash}`);
        if (report.usedExtras.length > 0) {
          console.log(`extras used (${report.usedExtras.length}):`);
          for (const e of report.usedExtras) console.log(`  ${e}`);
        }
        if (report.lfsPointers.length > 0) {
          console.log(`lfs pointers (uncovered):`);
          for (const p of report.lfsPointers) console.log(`  ${p}`);
        }
        for (const n of report.networks) {
          if (!n.anchor.present) {
            console.log(`${n.network}: no anchor`);
            continue;
          }
          console.log(
            `${n.network}: rev=${n.anchor.revision} match=${n.matchesComputed} tree=${n.anchor.treeHash}`
          );
        }
        console.log(report.message);
      }
      if (report.status === "fail") process.exitCode = 1;
    }
  );

program
  .command("reverify")
  .description("Re-check every anchored tag against the live Git repository")
  .option("--project <id>", "Project id (default: from manifest)")
  .option("--repo <path>", "Git repository path", ".")
  .option("--network <name>", "Restrict to one network (repeatable)", (v, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .option("--json", "Print JSON report", false)
  .action(
    async (opts: {
      project?: string;
      repo: string;
      network: string[];
      json?: boolean;
    }) => {
      const gitRepo = path.resolve(opts.repo);
      const repoRoot = findRepoRoot(gitRepo);
      const manifest = tryLoadManifest(gitRepo) ?? tryLoadManifest(repoRoot);
      const projectId = opts.project ?? manifest?.projectId;
      if (!projectId) {
        throw new Error("Pass --project or provide .provenance-manifest.json with projectId");
      }
      const result = await reverifyProject({
        repoRoot,
        gitRepo,
        projectId,
        networks: opts.network.length > 0 ? opts.network : undefined,
        listAnchors: async (network) =>
          listAnchorsFromEvents(repoRoot, network, projectId),
      });
      if (opts.json) {
        console.log(toJson(result));
      } else {
        console.log(`status: ${result.status}`);
        for (const item of result.items) {
          console.log(
            `${item.network} ${item.kind === KIND_TAG ? "TAG" : "SNAPSHOT"} ${item.ref}: ${item.status}` +
              (item.currentTreeHash ? ` current=${item.currentTreeHash}` : "") +
              (item.anchoredTreeHash ? ` anchored=${item.anchoredTreeHash}` : "") +
              (item.detail ? ` (${item.detail})` : "")
          );
        }
      }
      if (result.status === "fail") process.exitCode = 1;
    }
  );

program
  .command("register")
  .description("Register a project id on one or more networks")
  .option("--project <id>", "Project id (default: from manifest)")
  .option("--label <label>", "Label (default: from manifest)")
  .option("--network <name>", "Network (repeatable; default: all deployments)", (v, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .action(async (opts: { project?: string; label?: string; network: string[] }) => {
    const root = findRepoRoot();
    const manifest = tryLoadManifest(process.cwd()) ?? tryLoadManifest(root);
    const projectId = opts.project ?? manifest?.projectId;
    const label = opts.label ?? manifest?.label ?? "unnamed";
    if (!projectId) throw new Error("Pass --project or create a manifest with gpa init");
    const networks =
      opts.network.length > 0 ? opts.network : [...loadDeployments(root).keys()];
    for (const network of networks) {
      const { contract, wallet, deployment } = getWriteContract(root, network);
      console.log(`registering on ${network} (${deployment.address}) as ${wallet.address}...`);
      const tx = await contract.registerProject(projectId, label);
      const receipt = await tx.wait();
      console.log(`  tx=${receipt.hash} status=${receipt.status}`);
    }
  });

const allowlist = program.command("allowlist").description("Manage per-project allowlists");

allowlist
  .command("add")
  .argument("<account>", "Address to allowlist")
  .option("--project <id>", "Project id (default: from manifest)")
  .option("--network <name>", "Network (repeatable)", (v, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .action(async (account: string, opts: { project?: string; network: string[] }) => {
    const root = findRepoRoot();
    const manifest = tryLoadManifest(process.cwd()) ?? tryLoadManifest(root);
    const projectId = opts.project ?? manifest?.projectId;
    if (!projectId) throw new Error("Pass --project or create a manifest");
    const networks =
      opts.network.length > 0 ? opts.network : [...loadDeployments(root).keys()];
    for (const network of networks) {
      const { contract } = getWriteContract(root, network);
      const tx = await contract.allowlistAdd(projectId, account);
      const receipt = await tx.wait();
      console.log(`${network}: allowlistAdd ${account} tx=${receipt.hash}`);
    }
  });

allowlist
  .command("remove")
  .argument("<account>", "Address to remove")
  .option("--project <id>", "Project id (default: from manifest)")
  .option("--network <name>", "Network (repeatable)", (v, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .action(async (account: string, opts: { project?: string; network: string[] }) => {
    const root = findRepoRoot();
    const manifest = tryLoadManifest(process.cwd()) ?? tryLoadManifest(root);
    const projectId = opts.project ?? manifest?.projectId;
    if (!projectId) throw new Error("Pass --project or create a manifest");
    const networks =
      opts.network.length > 0 ? opts.network : [...loadDeployments(root).keys()];
    for (const network of networks) {
      const { contract } = getWriteContract(root, network);
      const tx = await contract.allowlistRemove(projectId, account);
      const receipt = await tx.wait();
      console.log(`${network}: allowlistRemove ${account} tx=${receipt.hash}`);
    }
  });

program
  .command("anchor")
  .description("Submit a tree hash for a tag or snapshot ref")
  .option("--tag <tag>", "Tag to anchor (KIND_TAG)")
  .option("--ref <ref>", "Ref to anchor (use with --kind)")
  .option("--kind <kind>", "tag or snapshot", "tag")
  .option("--project <id>", "Project id (default: from manifest)")
  .option("--repo <path>", "Git repository used to read the tree hash", ".")
  .option("--sbom-hash <hash>", "Optional bytes32 SBOM hash", ethers.ZeroHash)
  .option("--tree-hash <hash>", "Override tree hash hex (default: git rev-parse)")
  .option("--network <name>", "Network (repeatable)", (v, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .action(
    async (opts: {
      tag?: string;
      ref?: string;
      kind: string;
      project?: string;
      repo: string;
      sbomHash: string;
      treeHash?: string;
      network: string[];
    }) => {
      const root = findRepoRoot();
      const gitRepo = path.resolve(opts.repo);
      const manifest = tryLoadManifest(gitRepo) ?? tryLoadManifest(root);
      const projectId = opts.project ?? manifest?.projectId;
      if (!projectId) throw new Error("Pass --project or create a manifest");

      const ref = opts.tag ?? opts.ref;
      if (!ref) throw new Error("Pass --tag or --ref");
      const kind =
        opts.tag || opts.kind === "tag"
          ? KIND_TAG
          : opts.kind === "snapshot"
            ? KIND_SNAPSHOT
            : (() => {
                throw new Error("--kind must be tag or snapshot");
              })();

      const treeHex = (opts.treeHash ?? gitTreeHash(gitRepo, ref)).replace(/^0x/, "");
      const treeBytes32 = treeHashToBytes32(treeHex);
      const sbom =
        opts.sbomHash === ethers.ZeroHash || opts.sbomHash.startsWith("0x")
          ? opts.sbomHash
          : treeHashToBytes32(opts.sbomHash);

      const networks =
        opts.network.length > 0 ? opts.network : [...loadDeployments(root).keys()];

      console.log(`ref=${ref} kind=${kind === KIND_TAG ? "TAG" : "SNAPSHOT"}`);
      console.log(`tree=${treeHex}`);
      console.log(`bytes32=${treeBytes32}`);

      for (const network of networks) {
        const { contract, deployment } = getWriteContract(root, network);
        console.log(`anchoring on ${network} (${deployment.address})...`);
        const tx = await contract.anchor(projectId, kind, ref, treeBytes32, sbom);
        const receipt = await tx.wait();
        console.log(`  tx=${receipt.hash} status=${receipt.status}`);
      }
    }
  );

program
  .command("anchors")
  .description("List anchored refs for a project from event logs")
  .option("--project <id>", "Project id (default: from manifest)")
  .option("--network <name>", "Network (repeatable)", (v, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .option("--json", "Print JSON", false)
  .action(async (opts: { project?: string; network: string[]; json?: boolean }) => {
    const root = findRepoRoot();
    const manifest = tryLoadManifest(process.cwd()) ?? tryLoadManifest(root);
    const projectId = opts.project ?? manifest?.projectId;
    if (!projectId) throw new Error("Pass --project or create a manifest");
    const networks =
      opts.network.length > 0 ? opts.network : [...loadDeployments(root).keys()];
    const all = [];
    for (const network of networks) {
      const events = await listAnchorsFromEvents(root, network, projectId);
      all.push(...latestAnchors(events));
    }
    if (opts.json) {
      console.log(toJson(all));
    } else {
      for (const a of all) {
        console.log(
          `${a.network} ${a.kind === KIND_TAG ? "TAG" : "SNAPSHOT"} ${a.ref} rev=${a.revision} tree=${a.treeHash}`
        );
      }
    }
  });

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
