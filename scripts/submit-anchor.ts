/**
 * CI helper: submit a precomputed tree hash (and optional SBOM hash) to every
 * configured deployment. Intended for the workflow templates under workflows/.
 *
 * Usage:
 *   npx ts-node scripts/submit-anchor.ts --tag v1.0.0 --tree-hash <40hex> [--sbom-hash <64hex>]
 *   npx ts-node scripts/submit-anchor.ts --tag v1.0.0 --tree-hash <40hex> --dry-run
 */
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import {
  findRepoRoot,
  getWriteContract,
  KIND_TAG,
  loadDeployments,
} from "../cli/src/lib/chain";
import { treeHashToBytes32 } from "../cli/src/lib/git-tree";
import { tryLoadManifest } from "../cli/src/lib/manifest";

dotenv.config();

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const tag = argValue("--tag");
  const treeHash = argValue("--tree-hash");
  const sbomRaw = argValue("--sbom-hash");
  if (!tag || !treeHash) {
    throw new Error("Required: --tag <tag> --tree-hash <hex>");
  }

  const root = findRepoRoot(path.resolve(__dirname, ".."));
  const manifest = tryLoadManifest(process.cwd()) ?? tryLoadManifest(root);
  const projectId = process.env.GPA_PROJECT_ID ?? manifest?.projectId;
  if (!projectId) {
    throw new Error("Set GPA_PROJECT_ID or provide .provenance-manifest.json");
  }

  const treeBytes32 = treeHashToBytes32(treeHash);
  const sbomBytes32 = sbomRaw
    ? sbomRaw.startsWith("0x") && sbomRaw.length === 66
      ? sbomRaw
      : ethers.zeroPadValue(`0x${sbomRaw.replace(/^0x/, "")}`, 32)
    : ethers.ZeroHash;

  const fromEnv = (process.env.GPA_NETWORKS ?? "").trim();
  const networks = fromEnv
    ? fromEnv.split(/[\s,]+/).filter(Boolean)
    : [...loadDeployments(root).keys()];

  const dryRun = hasFlag("--dry-run");
  console.log(`project   ${projectId}`);
  console.log(`tag       ${tag}`);
  console.log(`treeHash  ${treeBytes32}`);
  console.log(`sbomHash  ${sbomBytes32}`);
  console.log(`networks  ${networks.join(", ")}`);

  for (const network of networks) {
    const { contract, deployment, wallet } = getWriteContract(root, network);
    console.log(
      `anchor ${tag} on ${network} @ ${deployment.address} from ${wallet.address}`
    );

    const allowed = await contract.isAllowlisted(projectId, wallet.address);
    if (!allowed) {
      throw new Error(
        `${wallet.address} is not allowlisted for ${projectId} on ${network}`
      );
    }

    if (dryRun) {
      const gas = await contract.anchor.estimateGas(
        projectId,
        KIND_TAG,
        tag,
        treeBytes32,
        sbomBytes32
      );
      console.log(`  dry run ok, estimated gas ${gas}`);
      continue;
    }

    const tx = await contract.anchor(projectId, KIND_TAG, tag, treeBytes32, sbomBytes32);
    const receipt = await tx.wait();
    console.log(`  tx=${receipt.hash}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
