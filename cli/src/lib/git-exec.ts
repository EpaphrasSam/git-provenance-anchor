import { spawnSync } from "child_process";
import * as path from "path";

export type GitHost = "windows" | "wsl";

export interface GitResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

function toWslPath(windowsPath: string): string {
  const resolved = path.resolve(windowsPath);
  const m = /^([A-Za-z]):\\(.*)$/.exec(resolved);
  if (!m) {
    return resolved.replace(/\\/g, "/");
  }
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

export function runGit(
  args: string[],
  options: { cwd: string; host?: GitHost }
): GitResult {
  const host = options.host ?? "windows";
  if (host === "windows") {
    const result = spawnSync("git", args, {
      cwd: options.cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      status: result.status,
    };
  }

  const wslCwd = toWslPath(options.cwd);
  const quotedArgs = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
  const result = spawnSync(
    "wsl",
    ["-d", "Ubuntu-24.04", "-e", "bash", "-lc", `cd '${wslCwd.replace(/'/g, `'\\''`)}' && git ${quotedArgs}`],
    { encoding: "utf8", windowsHide: true }
  );
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    status: result.status,
  };
}

export function gitTreeHash(
  repo: string,
  ref: string = "HEAD",
  host: GitHost = "windows"
): string {
  const result = runGit(["rev-parse", `${ref}^{tree}`], { cwd: repo, host });
  if (result.status !== 0) {
    throw new Error(`git rev-parse failed (${host}): ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim().toLowerCase();
}

export function assertGitOk(result: GitResult, what: string): void {
  if (result.status !== 0) {
    throw new Error(`${what} failed: ${result.stderr || result.stdout}`);
  }
}
