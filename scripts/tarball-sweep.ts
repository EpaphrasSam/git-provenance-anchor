/**
 * Compares each sampled project's published release tarball against the Git tree
 * that would have been anchored for the same tag.
 *
 * This is the false-positive half of Chapter 3's validation test 2. Everything
 * else in the sample compares a repository against itself; this compares what a
 * project actually ships against what its repository contains, which is where a
 * naive implementation cries wolf. Autotools projects ship a generated
 * `configure` that is not in the tree, and a comparison that flags it is useless
 * in practice, whatever it proves in a fixture.
 *
 * Needs network access to the release hosts, which the analysis sandbox does not
 * have; that is the only reason this is a separate script.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/tarball-sweep.ts --sample ./sample
 *   npx ts-node --transpile-only scripts/tarball-sweep.ts --sample ./sample --only curl/curl
 *
 * Flags:
 *   --sample DIR   directory produced by evaluation/sample-clone.sh (default ./sample)
 *   --only REPO    restrict to one repository
 *   --keep         leave downloaded tarballs in place for inspection
 *   --out FILE     output filename under evaluation/data (default tarball-sweep.json)
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { hashArtifact, hashGitRef } from "../cli/src/lib/git-tree";
import { findRepoRoot } from "../cli/src/lib/chain";
import { loadManifest, resolveExtraPaths } from "../cli/src/lib/manifest";

/**
 * Where each project publishes its release. GitHub's auto-generated archive is
 * the default, but it is only a snapshot of the tree, so it cannot exhibit the
 * behaviour this sweep exists to test. Projects that publish a real, built
 * tarball are listed explicitly, and those are the interesting rows.
 */
const RELEASE_URL: Record<string, (tag: string) => string> = {
  "curl/curl": (t) =>
    `https://github.com/curl/curl/releases/download/${t}/${t.replace("curl-", "curl-").replace(/_/g, ".")}.tar.gz`,
  "libarchive/libarchive": (t) =>
    `https://github.com/libarchive/libarchive/releases/download/${t}/libarchive-${t.replace(/^v/, "")}.tar.gz`,
};

const autoArchive = (repo: string, tag: string) =>
  `https://github.com/${repo}/archive/refs/tags/${tag}.tar.gz`;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

interface Row {
  repo: string;
  tag: string;
  source: "published release tarball" | "generated archive";
  url: string;
  downloaded: boolean;
  anchoredTreeHash?: string;
  artifactTreeHash?: string;
  identical?: boolean;
  extraInArtifact?: string[];
  missingFromArtifact?: string[];
  declaredByManifest?: string[];
  undeclared?: string[];
  verdict?: string;
  error?: string;
}

function download(url: string, dest: string): boolean {
  try {
    execFileSync("curl", ["-sSL", "--fail", "--max-time", "300", "-o", dest, url], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return fs.existsSync(dest) && fs.statSync(dest).size > 0;
  } catch {
    return false;
  }
}

async function main() {
  const repoRoot = findRepoRoot();
  const sampleDir = path.resolve(arg("sample", "./sample")!);
  const only = arg("only");
  const outName = arg("out", "tarball-sweep.json")!;

  const resultsPath = path.join(repoRoot, "evaluation", "data", "sample-results.json");
  const sample = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-sweep-"));
  const rows: Row[] = [];

  for (const entry of sample.repositories) {
    const repo: string = entry.repo;
    const tag: string = entry.tag;
    if (only && repo !== only) continue;

    const dir = path.join(sampleDir, repo.replace("/", "_"));
    if (!fs.existsSync(dir)) {
      rows.push({ repo, tag, source: "generated archive", url: "", downloaded: false,
        error: `clone not found at ${dir}; run evaluation/sample-clone.sh first` });
      continue;
    }

    const custom = RELEASE_URL[repo];
    const url = custom ? custom(tag) : autoArchive(repo, tag);
    const source = custom ? "published release tarball" : "generated archive";
    const tarball = path.join(work, `${repo.replace("/", "_")}.tar.gz`);

    process.stderr.write(`${repo} @ ${tag}\n  ${url}\n`);
    if (!download(url, tarball)) {
      rows.push({ repo, tag, source, url, downloaded: false, error: "download failed" });
      continue;
    }

    try {
      const anchored = await hashGitRef(dir, "HEAD");
      const artifact = await hashArtifact(tarball);

      const inTree = new Set(anchored.paths);
      const inArtifact = new Set(artifact.paths);
      const extra = [...inArtifact].filter((p) => !inTree.has(p)).sort();
      const missing = [...inTree].filter((p) => !inArtifact.has(p)).sort();

      // Apply the project's manifest if it has one, through the same resolver
      // `gpa verify` uses, so this sweep cannot disagree with the real tool.
      let declared: string[] = [];
      const manifestPath = path.join(dir, ".provenance-manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = loadManifest(manifestPath);
          declared = resolveExtraPaths(extra, manifest.extras).matched;
        } catch { /* manifest unreadable; treat as absent */ }
      }
      const undeclared = extra.filter((p) => !declared.includes(p));

      const identical = anchored.treeHashHex === artifact.treeHashHex;
      rows.push({
        repo, tag, source, url, downloaded: true,
        anchoredTreeHash: anchored.treeHashHex,
        artifactTreeHash: artifact.treeHashHex,
        identical,
        extraInArtifact: extra.slice(0, 200),
        missingFromArtifact: missing.slice(0, 200),
        declaredByManifest: declared,
        undeclared: undeclared.slice(0, 200),
        verdict: identical
          ? "artifact reproduces the anchored tree exactly"
          : undeclared.length === 0
            ? "differs, but every extra file is declared"
            : `${undeclared.length} undeclared extra file(s), ${missing.length} missing`,
      });
      if (artifact.cleanup) await artifact.cleanup();
      process.stderr.write(`  ${rows[rows.length - 1].verdict}\n`);
    } catch (e) {
      rows.push({ repo, tag, source, url, downloaded: true, error: (e as Error).message });
      process.stderr.write(`  ERROR ${(e as Error).message}\n`);
    }
  }

  if (!flag("keep")) fs.rmSync(work, { recursive: true, force: true });

  const outPath = path.join(repoRoot, "evaluation", "data", outName);
  fs.writeFileSync(outPath, JSON.stringify({
    collectedAt: new Date().toISOString(),
    note: "Compares each project's published release artifact against the tree hash that would be anchored for the same tag. Rows sourced from a generated archive cannot show build-added files by construction; rows from a published release tarball can.",
    sampleDir, rows,
  }, null, 1) + "\n");

  const real = rows.filter((r) => r.source === "published release tarball" && r.downloaded && !r.error);
  const clean = real.filter((r) => r.identical || (r.undeclared?.length ?? 0) === 0);
  console.log(`\nWrote ${outPath}`);
  console.log(`Published tarballs compared: ${real.length}, of which ${clean.length} produced no undeclared extras.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
