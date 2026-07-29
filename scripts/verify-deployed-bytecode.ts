/**
 * Compares the locally compiled runtime bytecode of AnchorRegistry against the
 * code actually deployed at each recorded address.
 *
 * solc embeds a hash of the source in the bytecode's metadata, so editing even a
 * comment changes the output. A mismatch is therefore only alarming when the
 * contracts directory is identical to the commit the deployment records — which
 * is what `sourceCommit` in each deployment record exists to establish.
 *
 * Usage:
 *   npm run verify:bytecode
 *   npx hardhat run scripts/verify-deployed-bytecode.ts
 */
import * as path from "path";
import { execFileSync } from "child_process";
import * as dotenv from "dotenv";
import { artifacts } from "hardhat";
import { ethers } from "ethers";
import { findRepoRoot, loadDeployments, rpcFor } from "../cli/src/lib/chain";

dotenv.config();

/** True when contracts/ on disk is identical to that commit's contracts/. */
function contractsMatchCommit(root: string, commit: string): boolean | null {
  try {
    execFileSync("git", ["diff", "--quiet", commit, "--", "contracts/"], { cwd: root });
    return true;
  } catch (err) {
    if ((err as { status?: number }).status === 1) return false;
    return null;
  }
}

async function main(): Promise<void> {
  const root = findRepoRoot(path.resolve(__dirname, ".."));
  const artifact = await artifacts.readArtifact("AnchorRegistry");
  const local = artifact.deployedBytecode.toLowerCase();

  console.log(`local runtime bytecode  ${local.length / 2 - 1} bytes`);
  console.log(`keccak256               ${ethers.keccak256(local)}`);
  console.log();

  let unexpected = false;
  for (const [network, deployment] of loadDeployments(root)) {
    if (deployment.vm === "eraVM") {
      console.log(network);
      console.log(`  address       ${deployment.address}`);
      console.log("  skipped       EraVM bytecode is not comparable to an EVM solc artifact");
      console.log(`  source        ${deployment.sourceCommit ?? "unknown"}  zksolc=${deployment.zksolcVersion ?? "?"}`);
      continue;
    }

    const provider = new ethers.JsonRpcProvider(rpcFor(network), deployment.chainId);
    const onChain = (await provider.getCode(deployment.address)).toLowerCase();
    const match = onChain === local;

    console.log(network);
    console.log(`  address       ${deployment.address}`);
    console.log(`  on-chain      ${onChain.length / 2 - 1} bytes  keccak=${ethers.keccak256(onChain)}`);

    if (match) {
      console.log("  match         yes");
      continue;
    }

    const commit = deployment.sourceCommit;
    const sameSource = commit ? contractsMatchCommit(root, commit) : null;

    if (!commit) {
      console.log("  match         no — record has no sourceCommit, cannot tell whether this is expected");
      unexpected = true;
    } else if (sameSource === true) {
      console.log(`  match         NO — contracts/ is identical to ${commit}, so this is a real discrepancy`);
      unexpected = true;
    } else {
      console.log(`  match         no — expected, contracts/ has changed since ${commit}`);
      console.log(`  to compare:   git checkout ${commit} -- contracts/ && npx hardhat compile`);
    }
  }

  if (unexpected) {
    console.log();
    console.log("A deployment differs from the source it records. Investigate before trusting it.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
