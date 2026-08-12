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

/** Map a tar entry's type/mode into the Git mode we should hash with. */
export function gitModeFromTarEntry(entry: {
  type: string;
  mode?: number | null;
}): GitMode | null {
  const type = entry.type;
  if (type === "Directory" || type === "GNUDumpDir") return null;
  if (type === "SymbolicLink") return "120000";
  // Regular files (and old/contiguous variants). Ignore char devices, etc.
  if (
    type === "File" ||
    type === "OldFile" ||
    type === "ContiguousFile" ||
    type === "GNUSparseFile" ||
    type === "" ||
    type === "0"
  ) {
    const mode = entry.mode ?? 0o644;
    return (mode & 0o111) !== 0 ? "100755" : "100644";
  }
  return null;
}

function normalizeRel(rel: string): string {
  return rel.split(path.sep).join("/");
}

function stripTarPath(p: string): string {
  return p.replace(/^\.\/+/, "").replace(/\/+$/, "");
}

interface TarLeafMeta {
  mode: GitMode;
  linkTarget?: string;
}

/**
 * Walk tar headers and record Git modes (and symlink targets) keyed by path.
 * Content still comes from the extracted files; modes must not come from the
 * filesystem, because Windows drops the executable bit on extract.
 */
async function collectTarLeafMeta(archivePath: string): Promise<Map<string, TarLeafMeta>> {
  const meta = new Map<string, TarLeafMeta>();
  await tar.t({
    file: path.resolve(archivePath),
    onReadEntry: (entry) => {
      const rel = stripTarPath(entry.path);
      if (!rel || rel === ".") return;
      const mode = gitModeFromTarEntry(entry);
      if (!mode) return;
      if (mode === "120000") {
        meta.set(rel, { mode, linkTarget: entry.linkpath || "" });
        return;
      }
      meta.set(rel, { mode });
    },
  });
  return meta;
}

function stripTopPrefix(meta: Map<string, TarLeafMeta>, prefix: string): Map<string, TarLeafMeta> {
  if (!prefix) return meta;
  const out = new Map<string, TarLeafMeta>();
  const head = prefix.endsWith("/") ? prefix : `${prefix}/`;
  for (const [p, v] of meta) {
    if (p === prefix) continue;
    if (p.startsWith(head)) out.set(p.slice(head.length), v);
    else out.set(p, v);
  }
  return out;
}

async function hashDirectoryRecursive(
  absDir: string,
  relDir: string,
  exclude: Set<string>,
  lfsPointers: string[],
  paths: string[],
  tarMeta?: Map<string, TarLeafMeta>
): Promise<Buffer> {
  const dirents = await fs.promises.readdir(absDir, { withFileTypes: true });
  const entries: Array<{ mode: GitMode; name: string; hash: Buffer }> = [];
  const seen = new Set<string>();

  for (const dirent of dirents) {
    if (SKIP_NAMES.has(dirent.name)) continue;

    const absChild = path.join(absDir, dirent.name);
    const relChild = normalizeRel(path.join(relDir, dirent.name));

    if (exclude.has(relChild)) continue;
    const excludedByPrefix = [...exclude].some(
      (e) => e.endsWith("/") && relChild.startsWith(e)
    );
    if (excludedByPrefix) continue;

    const leaf = tarMeta?.get(relChild);
    const lstat = await fs.promises.lstat(absChild);

    if (lstat.isDirectory() && !lstat.isSymbolicLink() && leaf?.mode !== "120000") {
      const subtree = await hashDirectoryRecursive(
        absChild,
        relChild,
        exclude,
        lfsPointers,
        paths,
        tarMeta
      );
      entries.push({ mode: "40000", name: dirent.name, hash: subtree });
      seen.add(dirent.name);
      continue;
    }

    // Prefer tar symlink metadata: Windows often materialises links as plain files.
    if (leaf?.mode === "120000" || lstat.isSymbolicLink()) {
      const target =
        leaf?.linkTarget ??
        (lstat.isSymbolicLink() ? await fs.promises.readlink(absChild) : "");
      const content = Buffer.from(target, "utf8");
      paths.push(relChild);
      entries.push({
        mode: "120000",
        name: dirent.name,
        hash: hashBlob(content),
      });
      seen.add(dirent.name);
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
      mode: leaf?.mode ?? modeForFile(absChild, lstat),
      name: dirent.name,
      hash: hashBlob(content),
    });
    seen.add(dirent.name);
  }

  // Symlinks that tar recorded but the filesystem could not create (common on Windows).
  if (tarMeta) {
    const prefix = relDir === "" ? "" : `${relDir}/`;
    for (const [rel, leaf] of tarMeta) {
      if (leaf.mode !== "120000") continue;
      if (prefix) {
        if (!rel.startsWith(prefix)) continue;
        if (rel.slice(prefix.length).includes("/")) continue;
      } else if (rel.includes("/")) {
        continue;
      }
      const name = prefix ? rel.slice(prefix.length) : rel;
      if (!name || seen.has(name)) continue;
      if (exclude.has(rel)) continue;
      paths.push(rel);
      entries.push({
        mode: "120000",
        name,
        hash: hashBlob(Buffer.from(leaf.linkTarget ?? "", "utf8")),
      });
    }
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
 *
 * File modes and symlink targets come from tar headers, not from the filesystem
 * after extract — Windows drops executable bits (and often cannot create
 * symlinks), which would otherwise false-positive against an object-store anchor.
 */
export async function hashArchive(
  archivePath: string,
  options: HashOptions = {}
): Promise<TreeHashResult & { extractedRoot: string; cleanup: () => Promise<void> }> {
  const absArchive = path.resolve(archivePath);
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gpa-artifact-"));
  const headerMeta = await collectTarLeafMeta(absArchive);
  await tar.x({
    file: absArchive,
    cwd: tmp,
  });

  const children = await fs.promises.readdir(tmp);
  const root =
    children.length === 1 &&
    (await fs.promises.stat(path.join(tmp, children[0]))).isDirectory()
      ? path.join(tmp, children[0])
      : tmp;

  const topPrefix =
    root !== tmp ? children[0] : "";
  const tarMeta = stripTopPrefix(headerMeta, topPrefix);

  const exclude = options.excludePaths ?? new Set<string>();
  const lfsPointers: string[] = [];
  const paths: string[] = [];
  const hash = await hashDirectoryRecursive(root, "", exclude, lfsPointers, paths, tarMeta);
  const result: TreeHashResult = {
    treeHashHex: hash.toString("hex"),
    lfsPointers: lfsPointers.sort(),
    paths: paths.sort(),
  };
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
interface RefEntry {
  mode: GitMode;
  type: string;
  oid: string;
  size: number | null;
  relPath: string;
}

/** Enumerate a ref's tree from the object store. */
function listRefEntries(absRepo: string, ref: string): RefEntry[] {
  const listed = spawnSync(
    "git",
    ["ls-tree", "-r", "-l", "-z", "--full-tree", ref],
    { cwd: absRepo, encoding: "buffer", windowsHide: true, maxBuffer: 1 << 30 }
  );
  if (listed.status !== 0) {
    const err = listed.stderr?.toString("utf8") || "unknown error";
    throw new Error(`git ls-tree failed for ${ref}: ${err}`);
  }
  const entries: RefEntry[] = [];
  for (const record of listed.stdout.toString("utf8").split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const [mode, type, oid, size] = record.slice(0, tab).split(/\s+/);
    entries.push({
      mode: mode as GitMode,
      type,
      oid,
      size: size === "-" ? null : Number(size),
      relPath: record.slice(tab + 1),
    });
  }
  return entries;
}

/** Read the contents of specific blobs in one pass, for LFS pointer detection. */
function readBlobs(absRepo: string, oids: string[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (oids.length === 0) return out;
  // `input` must be a Buffer here: passing a string alongside buffer output makes
  // Node try to encode it with an encoding named "buffer".
  const batch = spawnSync("git", ["cat-file", "--batch"], {
    cwd: absRepo,
    input: Buffer.from(oids.join("\n") + "\n", "utf8"),
    windowsHide: true,
    maxBuffer: 1 << 30,
  });
  if (batch.status !== 0) return out;
  let buf: Buffer = batch.stdout;
  let cursor = 0;
  while (cursor < buf.length) {
    const nl = buf.indexOf("\n", cursor);
    if (nl === -1) break;
    const header = buf.slice(cursor, nl).toString("utf8");
    const [oid, , sizeText] = header.split(" ");
    const size = Number(sizeText);
    if (!oid || Number.isNaN(size)) break;
    const start = nl + 1;
    out.set(oid, buf.slice(start, start + size));
    cursor = start + size + 1;
  }
  return out;
}

/**
 * Reconstruct the tree hash of a Git ref directly from the object store.
 *
 * An earlier implementation reconstructed through `git archive`. That was wrong
 * for real repositories: `git archive` applies `.gitattributes` export rules
 * (`export-ignore` drops files, `eol`/`text` rewrite blob contents) and omits
 * submodule entries entirely, so the reconstructed hash disagreed with the tree
 * hash the anchor actually commits to. It disagreed on 3 of the 11 projects in
 * evaluation/repository-sample.md. Reading `ls-tree` output avoids every one of
 * those, because the object ids it reports are the stored ones.
 */
export async function hashGitRef(
  repoPath: string,
  ref: string,
  options: HashOptions = {}
): Promise<ArtifactHashResult> {
  const absRepo = path.resolve(repoPath);
  const exclude = options.excludePaths ?? new Set<string>();
  const entries = listRefEntries(absRepo, ref).filter((e) => {
    if (exclude.has(e.relPath)) return false;
    return ![...exclude].some((x) => x.endsWith("/") && e.relPath.startsWith(x));
  });

  // Git LFS pointers are never larger than a kilobyte, so only small blobs are read.
  const candidates = entries.filter(
    (e) => e.type === "blob" && e.size !== null && e.size <= 1024
  );
  const blobs = readBlobs(absRepo, candidates.map((e) => e.oid));
  const lfsPointers: string[] = [];
  for (const entry of candidates) {
    const content = blobs.get(entry.oid);
    if (content && isLfsPointer(content)) lfsPointers.push(entry.relPath);
  }

  // Rebuild every tree object bottom-up from the leaf entries.
  interface Dir { dirs: Map<string, Dir>; files: Array<{ mode: GitMode; name: string; hash: Buffer }>; }
  const root: Dir = { dirs: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.relPath.split("/");
    let node = root;
    for (const segment of parts.slice(0, -1)) {
      let next = node.dirs.get(segment);
      if (!next) { next = { dirs: new Map(), files: [] }; node.dirs.set(segment, next); }
      node = next;
    }
    node.files.push({
      mode: entry.mode,
      name: parts[parts.length - 1],
      hash: Buffer.from(entry.oid, "hex"),
    });
  }
  const collapse = (node: Dir): Buffer => {
    const all = [...node.files];
    for (const [name, child] of node.dirs) {
      all.push({ mode: "40000", name, hash: collapse(child) });
    }
    return hashTreeObject(all);
  };

  return {
    treeHashHex: collapse(root).toString("hex"),
    lfsPointers: lfsPointers.sort(),
    paths: entries.map((e) => e.relPath).sort(),
    contentRoot: absRepo,
  };
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
