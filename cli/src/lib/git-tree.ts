import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as tar from "tar";
import * as os from "os";
import { spawnSync } from "child_process";

const SKIP_NAMES = new Set([".git"]);

export type GitMode = "100644" | "100755" | "120000" | "40000" | "160000";

export interface TreeHashResult {
  /** 20-byte SHA-1 tree hash as lowercase hex (no 0x). */
  treeHashHex: string;
  /** Paths whose contents look like Git LFS pointer files. */
  lfsPointers: string[];
  /** Relative paths included in the hashed tree. */
  paths: string[];
}

export interface HashOptions {
  /** Relative paths or globs already resolved to concrete relative paths to exclude. */
  excludePaths?: Set<string>;
}

function sha1(data: Buffer): Buffer {
  return crypto.createHash("sha1").update(data).digest();
}

export function hashBlob(content: Buffer): Buffer {
  const header = Buffer.from(`blob ${content.length}\0`, "utf8");
  return sha1(Buffer.concat([header, content]));
}

export function hashTreeObject(
  entries: Array<{ mode: GitMode; name: string; hash: Buffer }>
): Buffer {
  const sorted = [...entries].sort((a, b) => {
    const ka = a.mode === "40000" ? `${a.name}/` : a.name;
    const kb = b.mode === "40000" ? `${b.name}/` : b.name;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const parts: Buffer[] = [];
  for (const entry of sorted) {
    parts.push(Buffer.from(`${entry.mode} ${entry.name}\0`, "utf8"));
    parts.push(entry.hash);
  }
  const body = Buffer.concat(parts);
  const header = Buffer.from(`tree ${body.length}\0`, "utf8");
  return sha1(Buffer.concat([header, body]));
}

/** Git LFS pointer files start with this exact first line. */
export function isLfsPointer(content: Buffer): boolean {
  if (content.length > 1024) return false;
  const text = content.toString("utf8");
  return text.startsWith("version https://git-lfs.github.com/spec/v1\n");
}

function modeForFile(absPath: string, stat: fs.Stats): GitMode {
  if (stat.isSymbolicLink()) return "120000";
  const exec = (stat.mode & 0o111) !== 0;
  return exec ? "100755" : "100644";
}

function normalizeRel(rel: string): string {
  return rel.split(path.sep).join("/");
}

async function hashDirectoryRecursive(
  absDir: string,
  relDir: string,
  exclude: Set<string>,
  lfsPointers: string[],
  paths: string[]
): Promise<Buffer> {
  const dirents = await fs.promises.readdir(absDir, { withFileTypes: true });
  const entries: Array<{ mode: GitMode; name: string; hash: Buffer }> = [];

  for (const dirent of dirents) {
    if (SKIP_NAMES.has(dirent.name)) continue;

    const absChild = path.join(absDir, dirent.name);
    const relChild = normalizeRel(path.join(relDir, dirent.name));

    if (exclude.has(relChild)) continue;
    const excludedByPrefix = [...exclude].some(
      (e) => e.endsWith("/") && relChild.startsWith(e)
    );
    if (excludedByPrefix) continue;

    const lstat = await fs.promises.lstat(absChild);

    if (lstat.isDirectory() && !lstat.isSymbolicLink()) {
      const subtree = await hashDirectoryRecursive(
        absChild,
        relChild,
        exclude,
        lfsPointers,
        paths
      );
      entries.push({ mode: "40000", name: dirent.name, hash: subtree });
      continue;
    }

    if (lstat.isSymbolicLink()) {
      const target = await fs.promises.readlink(absChild);
      const content = Buffer.from(target, "utf8");
      paths.push(relChild);
      entries.push({
        mode: "120000",
        name: dirent.name,
        hash: hashBlob(content),
      });
      continue;
    }

    if (!lstat.isFile()) {
      continue;
    }

    const content = await fs.promises.readFile(absChild);
    if (isLfsPointer(content)) {
      lfsPointers.push(relChild);
    }
    paths.push(relChild);
    entries.push({
      mode: modeForFile(absChild, lstat),
      name: dirent.name,
      hash: hashBlob(content),
    });
  }

  return hashTreeObject(entries);
}

/**
 * Reconstruct a Git tree hash from a directory, matching `git write-tree`
 * for a clean index of those paths (`.git` skipped).
 */
export async function hashDirectory(
  directory: string,
  options: HashOptions = {}
): Promise<TreeHashResult> {
  const abs = path.resolve(directory);
  const exclude = options.excludePaths ?? new Set<string>();
  const lfsPointers: string[] = [];
  const paths: string[] = [];
  const hash = await hashDirectoryRecursive(abs, "", exclude, lfsPointers, paths);
  return {
    treeHashHex: hash.toString("hex"),
    lfsPointers: lfsPointers.sort(),
    paths: paths.sort(),
  };
}

/**
 * Unpack a `.tar` / `.tar.gz` / `.tgz` artifact into a temp directory and hash it.
 * Strips a single top-level folder when the archive contains exactly one.
 */
export async function hashArchive(
  archivePath: string,
  options: HashOptions = {}
): Promise<TreeHashResult & { extractedRoot: string; cleanup: () => Promise<void> }> {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gpa-artifact-"));
  await tar.x({
    file: path.resolve(archivePath),
    cwd: tmp,
  });

  const children = await fs.promises.readdir(tmp);
  const root =
    children.length === 1 &&
    (await fs.promises.stat(path.join(tmp, children[0]))).isDirectory()
      ? path.join(tmp, children[0])
      : tmp;

  const result = await hashDirectory(root, options);
  return {
    ...result,
    extractedRoot: root,
    cleanup: async () => {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    },
  };
}

export type ArtifactHashResult = TreeHashResult & {
  /** Directory that was hashed (archive extract root or the given folder). */
  contentRoot: string;
  cleanup?: () => Promise<void>;
};

export async function hashArtifact(
  artifactPath: string,
  options: HashOptions = {}
): Promise<ArtifactHashResult> {
  const abs = path.resolve(artifactPath);
  const stat = await fs.promises.stat(abs);
  if (stat.isDirectory()) {
    const result = await hashDirectory(abs, options);
    return { ...result, contentRoot: abs };
  }
  const lower = abs.toLowerCase();
  if (lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    const archived = await hashArchive(abs, options);
    return {
      treeHashHex: archived.treeHashHex,
      lfsPointers: archived.lfsPointers,
      paths: archived.paths,
      contentRoot: archived.extractedRoot,
      cleanup: archived.cleanup,
    };
  }
  throw new Error(
    `Unsupported artifact: ${artifactPath} (expected a directory, .tar, .tar.gz, or .tgz)`
  );
}

/**
 * Hash a Git reference by archiving object-store bytes (not the working tree).
 * Forces `core.autocrlf=false` so Windows checkouts do not rewrite line endings
 * into the temporary archive the way a default `git archive` can.
 */
export async function hashGitRef(
  repoPath: string,
  ref: string,
  options: HashOptions = {}
): Promise<ArtifactHashResult> {
  const absRepo = path.resolve(repoPath);
  const archive = path.join(
    os.tmpdir(),
    `gpa-ref-${Date.now()}-${Math.random().toString(16).slice(2)}.tar`
  );
  const result = spawnSync(
    "git",
    ["-c", "core.autocrlf=false", "archive", "--format=tar", "-o", archive, ref],
    { cwd: absRepo, encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0) {
    throw new Error(
      `git archive failed for ${ref}: ${result.stderr || result.stdout || "unknown error"}`
    );
  }
  try {
    const hashed = await hashArtifact(archive, options);
    return {
      ...hashed,
      cleanup: async () => {
        if (hashed.cleanup) await hashed.cleanup();
      },
    };
  } finally {
    await fs.promises.rm(archive, { force: true });
  }
}

/** Left-pad a 20-byte (or 32-byte) hex hash into a 32-byte `0x`-prefixed value. */
export function treeHashToBytes32(treeHashHex: string): string {
  const hex = treeHashHex.replace(/^0x/i, "").toLowerCase();
  if (hex.length !== 40 && hex.length !== 64) {
    throw new Error(`Expected 20- or 32-byte hex tree hash, got length ${hex.length / 2}`);
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length === 32) return `0x${hex}`;
  return `0x${Buffer.concat([Buffer.alloc(12, 0), buf]).toString("hex")}`;
}

export function bytes32ToTreeHashHex(bytes32: string): string {
  const hex = bytes32.replace(/^0x/i, "").toLowerCase();
  if (hex.length !== 64) {
    throw new Error(`Expected bytes32, got length ${hex.length / 2}`);
  }
  if (hex.startsWith("000000000000000000000000")) {
    return hex.slice(24);
  }
  return hex;
}
