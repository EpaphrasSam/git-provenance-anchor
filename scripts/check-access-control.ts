/**
 * Confirms a live deployment refuses anchors from an account the project owner
 * never allowlisted. Run this against your own registry after deploying it.
 *
 * Two observations per network. The simulated call decodes the custom error and
 * costs nothing; --send additionally broadcasts, leaving a failed receipt that
 * anyone can look up on a block explorer.
 *
 * Usage:
 *   npm run check:access-control
 *   npm run check:access-control -- --send
 *   npm run check:access-control -- --network arbitrumSepolia
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import {
  ANCHOR_REGISTRY_ABI,
  findRepoRoot,
  getReadContract,
  KIND_TAG,
  loadDeployments,
} from "../cli/src/lib/chain";
import { tryLoadManifest } from "../cli/src/lib/manifest";

dotenv.config();

const GAS_LIMIT = 200_000n;
const FUND_WEI = ethers.parseEther("0.0004");

interface ArmResult {
  attempted: boolean;
  reverted: boolean;
  errorName?: string;
  errorArgs?: Record<string, string>;
  rawData?: string;
  transactionHash?: string;
  status?: number;
  gasUsed?: string;
  note?: string;
}

interface NetworkResult {
  network: string;
  chainId: number;
  registry: string;
  projectId: string;
  ref: string;
  unauthorizedAddress: string;
  allowlistedBeforeAttempt: boolean;
  anchorUnchanged: boolean;
  simulated: ArmResult;
  sent: ArmResult;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function decodeRevert(err: unknown): ArmResult {
  const iface = new ethers.Interface(ANCHOR_REGISTRY_ABI as unknown as string[]);
  const data =
    (err as { data?: string })?.data ??
    (err as { info?: { error?: { data?: string } } })?.info?.error?.data;

  if (typeof data === "string" && data.length >= 10) {
    const parsed = iface.parseError(data);
    if (parsed) {
      const args: Record<string, string> = {};
      parsed.fragment.inputs.forEach((input, i) => {
        args[input.name] = String(parsed.args[i]);
      });
      return { attempted: true, reverted: true, errorName: parsed.name, errorArgs: args, rawData: data };
    }
    return { attempted: true, reverted: true, rawData: data };
  }

  const message = err instanceof Error ? err.message : String(err);
  return { attempted: true, reverted: true, note: message };
}

async function runNetwork(
  root: string,
  network: string,
  projectId: string,
  ref: string,
  send: boolean
): Promise<NetworkResult> {
  const { contract, provider, deployment } = getReadContract(root, network);
  const intruder = ethers.Wallet.createRandom().connect(provider);

  const allowlisted: boolean = await contract.isAllowlisted(projectId, intruder.address);
  const before = await contract.getAnchor(projectId, KIND_TAG, ref);

  const forgedTree = ethers.keccak256(ethers.toUtf8Bytes(`forged-${network}`));
  const asIntruder = new ethers.Contract(deployment.address, ANCHOR_REGISTRY_ABI, intruder);

  let simulated: ArmResult = { attempted: true, reverted: false };
  try {
    await asIntruder.anchor.staticCall(projectId, KIND_TAG, ref, forgedTree, ethers.ZeroHash);
    simulated = { attempted: true, reverted: false, note: "call succeeded, access control did not hold" };
  } catch (err) {
    simulated = decodeRevert(err);
  }

  let sent: ArmResult = { attempted: false, reverted: false, note: "skipped, pass --send to broadcast" };
  if (send) {
    const funder = process.env.ANCHOR_DEPLOYER_KEY
      ? new ethers.Wallet(process.env.ANCHOR_DEPLOYER_KEY, provider)
      : undefined;
    if (!funder) {
      sent = { attempted: false, reverted: false, note: "ANCHOR_DEPLOYER_KEY unset, cannot fund the intruder" };
    } else {
      const fundTx = await funder.sendTransaction({ to: intruder.address, value: FUND_WEI });
      await fundTx.wait();

      try {
        const tx = await asIntruder.anchor(projectId, KIND_TAG, ref, forgedTree, ethers.ZeroHash, {
          gasLimit: GAS_LIMIT,
        });
        const receipt = await provider.waitForTransaction(tx.hash);
        sent = {
          attempted: true,
          reverted: receipt?.status === 0,
          transactionHash: tx.hash,
          status: receipt?.status ?? undefined,
          gasUsed: receipt?.gasUsed?.toString(),
        };
      } catch (err) {
        const decoded = decodeRevert(err);
        const hash = (err as { transaction?: { hash?: string }; receipt?: { hash?: string } })?.receipt?.hash;
        sent = { ...decoded, transactionHash: hash };
      }
    }
  }

  const after = await contract.getAnchor(projectId, KIND_TAG, ref);

  return {
    network,
    chainId: deployment.chainId,
    registry: deployment.address,
    projectId,
    ref,
    unauthorizedAddress: intruder.address,
    allowlistedBeforeAttempt: allowlisted,
    anchorUnchanged: before.treeHash === after.treeHash && before.revision === after.revision,
    simulated,
    sent,
  };
}

async function main(): Promise<void> {
  const root = findRepoRoot(path.resolve(__dirname, ".."));
  const manifest = tryLoadManifest(root);
  const projectId = process.env.GPA_PROJECT_ID ?? manifest?.projectId;
  if (!projectId) {
    throw new Error("Set GPA_PROJECT_ID or provide .provenance-manifest.json");
  }

  const only = argValue("--network");
  const networks = only ? [only] : [...loadDeployments(root).keys()];
  const ref = argValue("--ref") ?? "v0.3.0-m3";
  const send = process.argv.includes("--send");

  const results: NetworkResult[] = [];
  for (const network of networks) {
    console.log(`\n=== ${network} ===`);
    const result = await runNetwork(root, network, projectId, ref, send);
    console.log(`  intruder            ${result.unauthorizedAddress}`);
    console.log(`  allowlisted         ${result.allowlistedBeforeAttempt}`);
    console.log(
      `  simulated call      ${result.simulated.reverted ? "reverted" : "SUCCEEDED"}` +
        (result.simulated.errorName ? ` ${result.simulated.errorName}` : "")
    );
    if (result.simulated.errorArgs) {
      console.log(`  error args          ${JSON.stringify(result.simulated.errorArgs)}`);
    }
    if (result.sent.attempted) {
      console.log(`  sent tx             ${result.sent.transactionHash ?? "n/a"}`);
      console.log(`  receipt status      ${result.sent.status ?? "n/a"} (0 = reverted)`);
      console.log(`  gas burned          ${result.sent.gasUsed ?? "n/a"}`);
    }
    console.log(`  stored anchor intact ${result.anchorUnchanged}`);
    results.push(result);
  }

  const outDir = path.join(root, "evaluation", "data");
  fs.mkdirSync(outDir, { recursive: true });
  // Separate filenames per mode: a simulated run must not overwrite the record of
  // a broadcast one, whose transaction hashes cannot be regenerated for free.
  const defaultName = send ? "access-control.json" : "access-control-simulated.json";
  const outFile = argValue("--out") ?? path.join(outDir, defaultName);

  // Merge by network so `--network zkSyncSepolia` does not erase other chains.
  let merged = results;
  if (fs.existsSync(outFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outFile, "utf8")) as { results?: NetworkResult[] };
      const byNet = new Map((prev.results ?? []).map((r) => [r.network, r]));
      for (const r of results) byNet.set(r.network, r);
      merged = [...byNet.values()];
    } catch {
      merged = results;
    }
  }

  fs.writeFileSync(
    outFile,
    `${JSON.stringify({ collectedAt: new Date().toISOString(), results: merged }, null, 2)}\n`,
    "utf8"
  );
  console.log(`\nwrote ${path.relative(root, outFile)}`);

  const held = results.every((r) => !r.allowlistedBeforeAttempt && r.simulated.reverted && r.anchorUnchanged);
  if (!held) {
    throw new Error("access control did not hold on at least one network");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
