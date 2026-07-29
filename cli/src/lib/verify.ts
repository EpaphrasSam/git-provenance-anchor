import {
  bytes32ToTreeHashHex,
  hashArtifact,
  hashDirectory,
  hashGitRef,
  treeHashToBytes32,
  type TreeHashResult,
} from "./git-tree";
import {
  resolveExtraPaths,
  tryLoadManifest,
  type ProvenanceManifest,
} from "./manifest";
import { fetchAnchor, KIND_TAG, loadDeployments, type AnchorView } from "./chain";
import { gitTreeHash } from "./git-exec";

export type VerifyStatus = "pass" | "pass_with_extras" | "fail";

export interface NetworkAnchorResult {
  network: string;
  address: string;
  chainId: number;
  anchor: AnchorView;
  matchesComputed: boolean | null;
}

export interface VerifyReport {
  status: VerifyStatus;
  projectId: string;
  tag: string;
  computedTreeHash: string;
  computedBytes32: string;
  usedExtras: string[];
  lfsPointers: string[];
  networks: NetworkAnchorResult[];
  message: string;
}

export async function verifyArtifact(options: {
  artifact?: string;
  gitRef?: string;
  gitRepo?: string;
  projectId: string;
  tag: string;
  repoRoot: string;
  manifest?: ProvenanceManifest | null;
  networks?: string[];
}): Promise<VerifyReport> {
  const manifest =
    options.manifest === undefined
      ? tryLoadManifest(options.repoRoot)
      : options.manifest;

  const deployments = loadDeployments(options.repoRoot);
  const networks =
    options.networks ??
    manifest?.networks ??
    [...deployments.keys()];

  if (networks.length === 0) {
    throw new Error("No networks to query: add deployments/ records or pass --network");
  }

  const full = options.gitRef
    ? await hashGitRef(options.gitRepo ?? options.repoRoot, options.gitRef)
    : await hashArtifact(options.artifact!);
  try {
    const excludeResolved = resolveExtraPaths(full.paths, manifest?.extras);
    let computed: TreeHashResult = full;
    let usedExtras: string[] = [];

    const fullBytes32 = treeHashToBytes32(full.treeHashHex);

    const networkResults: NetworkAnchorResult[] = [];
    for (const network of networks) {
      const anchor = await fetchAnchor(
        options.repoRoot,
        network,
        options.projectId,
        KIND_TAG,
        options.tag
      );
      networkResults.push({
        network,
        address: anchor.address,
        chainId: anchor.chainId,
        anchor,
        matchesComputed: null,
      });
    }

    const present = networkResults.filter((n) => n.anchor.present);
    if (present.length === 0) {
      return {
        status: "fail",
        projectId: options.projectId,
        tag: options.tag,
        computedTreeHash: full.treeHashHex,
        computedBytes32: fullBytes32,
        usedExtras: [],
        lfsPointers: full.lfsPointers,
        networks: networkResults,
        message: `No anchor found for tag ${options.tag} on any network`,
      };
    }

    const expectedHexes = new Set(
      present.map((n) => bytes32ToTreeHashHex(n.anchor.treeHash))
    );

    const matchFull = expectedHexes.has(full.treeHashHex);
    if (matchFull) {
      for (const n of networkResults) {
        if (n.anchor.present) {
          n.matchesComputed =
            bytes32ToTreeHashHex(n.anchor.treeHash) === full.treeHashHex;
        }
      }
      const disagree = present.some(
        (n) => bytes32ToTreeHashHex(n.anchor.treeHash) !== full.treeHashHex
      );
      return {
        status: disagree ? "fail" : "pass",
        projectId: options.projectId,
        tag: options.tag,
        computedTreeHash: full.treeHashHex,
        computedBytes32: fullBytes32,
        usedExtras: [],
        lfsPointers: full.lfsPointers,
        networks: networkResults,
        message: disagree
          ? "Networks disagree on the anchored tree hash"
          : "Artifact tree hash matches the on-chain anchor",
      };
    }

    if (excludeResolved.matched.length > 0) {
      const exclude = new Set(excludeResolved.matched);
      for (const extra of manifest?.extras ?? []) {
        const p = extra.path.replace(/\\/g, "/").replace(/\/\*\*$/, "").replace(/\*$/, "");
        if (p && !/[$*?[\]{}]/.test(extra.path)) {
          exclude.add(p);
        }
      }
      computed = await hashDirectory(full.contentRoot, { excludePaths: exclude });
      usedExtras = excludeResolved.matched;
    }

    const matchStripped = expectedHexes.has(computed.treeHashHex);
    for (const n of networkResults) {
      if (n.anchor.present) {
        n.matchesComputed =
          bytes32ToTreeHashHex(n.anchor.treeHash) === computed.treeHashHex;
      }
    }

    if (matchStripped) {
      const disagree = present.some(
        (n) => bytes32ToTreeHashHex(n.anchor.treeHash) !== computed.treeHashHex
      );
      return {
        status: disagree ? "fail" : "pass_with_extras",
        projectId: options.projectId,
        tag: options.tag,
        computedTreeHash: computed.treeHashHex,
        computedBytes32: treeHashToBytes32(computed.treeHashHex),
        usedExtras,
        lfsPointers: full.lfsPointers,
        networks: networkResults,
        message: disagree
          ? "Networks disagree on the anchored tree hash"
          : `Artifact matches after allowing ${usedExtras.length} declared extra path(s)`,
      };
    }

    return {
      status: "fail",
      projectId: options.projectId,
      tag: options.tag,
      computedTreeHash: computed.treeHashHex,
      computedBytes32: treeHashToBytes32(computed.treeHashHex),
      usedExtras,
      lfsPointers: full.lfsPointers,
      networks: networkResults,
      message:
        "Artifact tree hash does not match any on-chain anchor (undeclared extras or content mismatch)",
    };
  } finally {
    if (full.cleanup) await full.cleanup();
  }
}

export interface ReverifyItem {
  network: string;
  kind: number;
  ref: string;
  anchoredTreeHash: string;
  currentTreeHash: string | null;
  status: "ok" | "moved" | "missing_ref" | "network_error";
  detail?: string;
}

export async function reverifyProject(options: {
  repoRoot: string;
  gitRepo: string;
  projectId: string;
  networks?: string[];
  listAnchors: (network: string) => Promise<
    Array<{ network: string; kind: number; ref: string; treeHash: string; revision: number }>
  >;
}): Promise<{ items: ReverifyItem[]; status: "pass" | "fail" }> {
  const deployments = loadDeployments(options.repoRoot);
  const networks = options.networks ?? [...deployments.keys()];
  const items: ReverifyItem[] = [];

  for (const network of networks) {
    let listed: Array<{
      network: string;
      kind: number;
      ref: string;
      treeHash: string;
      revision: number;
    }>;
    try {
      listed = await options.listAnchors(network);
    } catch (err) {
      items.push({
        network,
        kind: KIND_TAG,
        ref: "*",
        anchoredTreeHash: "",
        currentTreeHash: null,
        status: "network_error",
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const latest = new Map<string, (typeof listed)[number]>();
    for (const a of listed) {
      const key = `${a.kind}:${a.ref}`;
      const prev = latest.get(key);
      if (!prev || a.revision >= prev.revision) latest.set(key, a);
    }

    for (const a of latest.values()) {
      try {
        const current = gitTreeHash(options.gitRepo, a.ref, "windows");
        const anchored = bytes32ToTreeHashHex(a.treeHash);
        items.push({
          network: a.network,
          kind: a.kind,
          ref: a.ref,
          anchoredTreeHash: anchored,
          currentTreeHash: current,
          status: current === anchored ? "ok" : "moved",
        });
      } catch (err) {
        items.push({
          network: a.network,
          kind: a.kind,
          ref: a.ref,
          anchoredTreeHash: bytes32ToTreeHashHex(a.treeHash),
          currentTreeHash: null,
          status: "missing_ref",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const status = items.every((i) => i.status === "ok") ? "pass" : "fail";
  return { items, status };
}
