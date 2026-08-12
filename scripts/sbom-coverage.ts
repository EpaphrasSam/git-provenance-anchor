/**
 * Runs Syft the same way the anchoring workflow does (`syft dir:. -o cyclonedx-json`)
 * against each clone in the repository sample, and records what the resulting
 * CycloneDX document actually contains.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/sbom-coverage.ts --sample ./sample
 *   npx ts-node --transpile-only scripts/sbom-coverage.ts --sample ./sample --only curl/curl
 *
 * Flags:
 *   --sample DIR   directory from evaluation/sample-clone.sh (default ./sample)
 *   --syft PATH    syft binary (default: tools/syft.exe, then PATH)
 *   --only REPO    restrict to one repository
 *   --out FILE     filename under evaluation/data (default sbom-coverage.json)
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { findRepoRoot } from "../cli/src/lib/chain";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}

interface SampleRepo {
  repo: string;
  tag: string;
  commit: string;
  ecosystem: string;
  files: number;
}

interface SampleFile {
  repositories: SampleRepo[];
}

interface BomComponent {
  type?: string;
  name?: string;
  version?: string;
  purl?: string;
  bomRef?: string;
}

interface CycloneDx {
  bomFormat?: string;
  specVersion?: string;
  serialNumber?: string;
  metadata?: {
    timestamp?: string;
    tools?: unknown;
    component?: { name?: string; type?: string };
  };
  components?: BomComponent[];
}

interface Row {
  repo: string;
  tag: string;
  commit: string;
  ecosystem: string;
  clone: string;
  syftMs: number;
  bomFormat?: string;
  specVersion?: string;
  componentCount: number;
  purlTypes: Record<string, number>;
  componentTypes: Record<string, number>;
  sampleNames: string[];
  declared: Record<string, number | string | boolean>;
  notes: string[];
  error?: string;
}

function resolveSyft(root: string): string {
  const override = arg("syft");
  if (override) return path.resolve(override);
  const local = path.join(root, "tools", process.platform === "win32" ? "syft.exe" : "syft");
  if (fs.existsSync(local)) return local;
  return "syft";
}

function syftVersion(bin: string): string {
  const out = execFileSync(bin, ["version"], { encoding: "utf8" });
  const m = out.match(/^Version:\s+(\S+)/m);
  return m ? m[1] : out.trim().split(/\r?\n/)[0];
}

function cloneDir(sampleRoot: string, repo: string): string {
  return path.join(sampleRoot, repo.replace("/", "_"));
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

function readIf(p: string): string | undefined {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : undefined;
}

function jsonIf<T>(p: string): T | undefined {
  const t = readIf(p);
  if (!t) return undefined;
  try {
    return JSON.parse(t) as T;
  } catch {
    return undefined;
  }
}

function declaredSignals(clone: string): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  const goMod = readIf(path.join(clone, "go.mod"));
  if (goMod) {
    out.goMod = true;
    out.goDirectRequires = countMatches(goMod, /^\t[^\s/]/gm);
  }
  const cargoLock = readIf(path.join(clone, "Cargo.lock"));
  if (cargoLock) {
    out.cargoLock = true;
    out.cargoPackages = countMatches(cargoLock, /^\[\[package\]\]/gm);
  }
  const pkg = jsonIf<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: unknown;
  }>(path.join(clone, "package.json"));
  if (pkg) {
    out.packageJson = true;
    out.npmDirectDeps = Object.keys(pkg.dependencies ?? {}).length;
    out.npmDevDeps = Object.keys(pkg.devDependencies ?? {}).length;
    out.npmWorkspaces = Boolean(pkg.workspaces);
  }
  if (fs.existsSync(path.join(clone, "package-lock.json"))) out.packageLock = true;
  if (fs.existsSync(path.join(clone, "yarn.lock"))) out.yarnLock = true;
  const uvLock = readIf(path.join(clone, "uv.lock"));
  if (uvLock) {
    out.uvLock = true;
    out.uvPackages = countMatches(uvLock, /^\[\[package\]\]/gm);
  }
  const pyproject = readIf(path.join(clone, "pyproject.toml"));
  if (pyproject) {
    out.pyproject = true;
    const depsBlock = pyproject.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
    out.pyprojectDeps = depsBlock ? countMatches(depsBlock[1], /"[^"]+"/g) : 0;
  }
  const gitmodules = readIf(path.join(clone, ".gitmodules"));
  if (gitmodules) {
    out.gitmodules = true;
    out.submoduleEntries = countMatches(gitmodules, /^\[submodule /gm);
  }
  const cmake = readIf(path.join(clone, "CMakeLists.txt"));
  if (cmake) {
    out.cmakeLists = true;
    out.cmakeFindPackage = countMatches(cmake, /find_package\s*\(/gi);
  }
  if (fs.existsSync(path.join(clone, "configure.ac"))) out.configureAc = true;
  try {
    const ls = execFileSync("git", ["ls-tree", "-r", "HEAD"], {
      cwd: clone,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    out.gitlinks = countMatches(ls, /^160000 /gm);
  } catch {
    out.gitlinks = 0;
  }
  return out;
}

function purlType(purl: string | undefined): string {
  if (!purl) return "(no purl)";
  const m = purl.match(/^pkg:([^/]+)\//);
  return m ? m[1] : "(unparsed purl)";
}

function summariseBom(bom: CycloneDx): Pick<
  Row,
  "bomFormat" | "specVersion" | "componentCount" | "purlTypes" | "componentTypes" | "sampleNames"
> {
  const components = bom.components ?? [];
  const purlTypes: Record<string, number> = {};
  const componentTypes: Record<string, number> = {};
  for (const c of components) {
    const pt = purlType(c.purl);
    purlTypes[pt] = (purlTypes[pt] ?? 0) + 1;
    const ct = c.type ?? "(none)";
    componentTypes[ct] = (componentTypes[ct] ?? 0) + 1;
  }
  const sampleNames = components
    .slice()
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    .slice(0, 8)
    .map((c) => `${c.name ?? "?"}${c.version ? `@${c.version}` : ""}`);
  return {
    bomFormat: bom.bomFormat,
    specVersion: bom.specVersion,
    componentCount: components.length,
    purlTypes,
    componentTypes,
    sampleNames,
  };
}

function notesFor(row: Row): string[] {
  const n: string[] = [];
  const d = row.declared;
  if (d.goMod && typeof d.goDirectRequires === "number") {
    const found = row.purlTypes.golang ?? 0;
    n.push(
      `go.mod lists ${d.goDirectRequires} direct require lines; CycloneDX has ${found} pkg:golang components`
    );
  }
  if (d.cargoLock && typeof d.cargoPackages === "number") {
    const found = row.purlTypes.cargo ?? 0;
    n.push(
      `Cargo.lock has ${d.cargoPackages} [[package]] entries; CycloneDX has ${found} pkg:cargo components`
    );
  }
  if (d.packageJson) {
    const found = row.purlTypes.npm ?? 0;
    n.push(
      `package.json has ${d.npmDirectDeps} dependencies and ${d.npmDevDeps} devDependencies` +
        `${d.packageLock ? ", with package-lock.json" : ""}${d.yarnLock ? ", with yarn.lock" : ""}${
          d.npmWorkspaces ? ", workspaces" : ""
        }; CycloneDX has ${found} pkg:npm components`
    );
  }
  if (d.pyproject && typeof d.pyprojectDeps === "number") {
    const found = row.purlTypes.pypi ?? 0;
    n.push(
      `pyproject.toml [project] dependencies lists ${d.pyprojectDeps} entries; CycloneDX has ${found} pkg:pypi components`
    );
  }
  if (d.configureAc || d.cmakeLists) {
    n.push(
      `C/autotools tree (configure.ac=${Boolean(d.configureAc)}, CMakeLists find_package=${d.cmakeFindPackage ?? 0}); ` +
        `no language lockfile. CycloneDX component count ${row.componentCount}`
    );
  }
  if (d.gitmodules) {
    n.push(
      `.gitmodules has ${d.submoduleEntries} entries, git ls-tree reports ${d.gitlinks} gitlinks; ` +
        `sample clone is depth-1 without recurse-submodules`
    );
  }
  if (row.componentCount === 0) {
    n.push("Syft emitted an empty components list");
  }
  return n;
}

function main(): void {
  const root = findRepoRoot(path.resolve(__dirname, ".."));
  const sampleRoot = path.resolve(arg("sample", path.join(root, "sample"))!);
  const only = arg("only");
  const outName = arg("out", "sbom-coverage.json")!;
  const syft = resolveSyft(root);
  const version = syftVersion(syft);

  const sample = JSON.parse(
    fs.readFileSync(path.join(root, "evaluation", "data", "sample-results.json"), "utf8")
  ) as SampleFile;

  const rows: Row[] = [];
  for (const repo of sample.repositories) {
    if (only && repo.repo !== only) continue;
    const clone = cloneDir(sampleRoot, repo.repo);
    const row: Row = {
      repo: repo.repo,
      tag: repo.tag,
      commit: repo.commit,
      ecosystem: repo.ecosystem,
      clone: path.relative(root, clone).replace(/\\/g, "/"),
      syftMs: 0,
      componentCount: 0,
      purlTypes: {},
      componentTypes: {},
      sampleNames: [],
      declared: {},
      notes: [],
    };
    if (!fs.existsSync(clone)) {
      row.error = "clone missing";
      rows.push(row);
      continue;
    }
    row.declared = declaredSignals(clone);
    const tmp = path.join(os.tmpdir(), `gpa-sbom-${repo.repo.replace("/", "-")}.cdx.json`);
    const started = Date.now();
    try {
      execFileSync(syft, ["dir:" + clone, "-o", `cyclonedx-json=${tmp}`], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60 * 60 * 1000,
        windowsHide: true,
      });
      row.syftMs = Date.now() - started;
      const bom = JSON.parse(fs.readFileSync(tmp, "utf8")) as CycloneDx;
      Object.assign(row, summariseBom(bom));
      row.notes = notesFor(row);
    } catch (err) {
      row.syftMs = Date.now() - started;
      row.error = err instanceof Error ? err.message : String(err);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
    console.log(
      `${repo.repo.padEnd(36)} components=${String(row.componentCount).padStart(4)}  ${row.syftMs}ms` +
        (row.error ? `  ERROR ${row.error}` : "")
    );
    rows.push(row);
  }

  const payload = {
    collectedAt: new Date().toISOString(),
    syftVersion: version,
    syftBinary: syft,
    invocation: "syft dir:<clone> -o cyclonedx-json=<tmp>  (same as workflows/provenance-anchor.yml)",
    sampleSource: "evaluation/data/sample-results.json",
    repositories: rows,
  };
  const dest = path.join(root, "evaluation", "data", outName);
  fs.writeFileSync(dest, JSON.stringify(payload, null, 1) + "\n");
  console.log(`wrote ${dest}`);
}

main();
