import * as fs from "fs";
import * as path from "path";
import Ajv, { type ErrorObject } from "ajv/dist/2020";
import micromatch from "micromatch";
import schema from "../../../manifest-schema/provenance-manifest.schema.json";

export interface ManifestExtra {
  path: string;
  reason: string;
  source: string;
}

export interface ProvenanceManifest {
  schemaVersion: 1;
  projectId: string;
  label?: string;
  networks?: string[];
  extras?: ManifestExtra[];
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile<ProvenanceManifest>(schema);

export function manifestPathFor(repoRoot: string): string {
  return path.join(repoRoot, ".provenance-manifest.json");
}

export function loadManifest(filePath: string): ProvenanceManifest {
  const raw = fs.readFileSync(filePath, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Manifest is not valid JSON: ${filePath}`);
  }
  if (!validate(data)) {
    const details = (validate.errors ?? [])
      .map((e: ErrorObject) => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    throw new Error(`Manifest failed schema validation: ${details}`);
  }
  return data;
}

export function tryLoadManifest(repoRoot: string): ProvenanceManifest | null {
  const p = manifestPathFor(repoRoot);
  if (!fs.existsSync(p)) return null;
  return loadManifest(p);
}

export function writeManifest(repoRoot: string, manifest: ProvenanceManifest): string {
  if (!validate(manifest)) {
    const details = (validate.errors ?? [])
      .map((e: ErrorObject) => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    throw new Error(`Refusing to write invalid manifest: ${details}`);
  }
  const p = manifestPathFor(repoRoot);
  fs.writeFileSync(p, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return p;
}

/** Resolve manifest extras against the set of relative paths present in an artifact. */
export function resolveExtraPaths(
  artifactPaths: string[],
  extras: ManifestExtra[] | undefined
): { matched: string[]; unmatchedPatterns: string[] } {
  if (!extras || extras.length === 0) {
    return { matched: [], unmatchedPatterns: [] };
  }
  const matched = new Set<string>();
  const unmatchedPatterns: string[] = [];
  for (const extra of extras) {
    const pattern = extra.path.replace(/\\/g, "/");
    const hits = micromatch(artifactPaths, pattern, { dot: true });
    if (hits.length === 0) {
      if (!/[$*?[\]{}]/.test(pattern)) {
        const asDir = micromatch(artifactPaths, `${pattern}/**`, { dot: true });
        if (asDir.length > 0) {
          for (const h of asDir) matched.add(h);
          matched.add(pattern);
          continue;
        }
      }
      unmatchedPatterns.push(pattern);
      continue;
    }
    for (const h of hits) matched.add(h);
  }
  return { matched: [...matched].sort(), unmatchedPatterns };
}
