import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const REVIEW_SNAPSHOT_SCHEMA = "ppirtv.review-snapshot.v2";

export function normalizeReviewPath(value: string): string {
  return normalizeReviewPathForPlatform(value, process.platform);
}

export function normalizeReviewPathForPlatform(value: string, platform: NodeJS.Platform): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\/+/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export async function fingerprintReviewedImplementation(
  workspace: string,
  changedFiles: string[],
  platform = process.platform,
  options: { requireReviewableFiles?: boolean; allowedMissingFiles?: string[] } = {}
): Promise<string> {
  const workspaceRoot = path.resolve(workspace);
  const canonicalPaths = [...new Set(changedFiles.map((item) => normalizeReviewPathForPlatform(item, platform)).filter(Boolean))].sort();
  const allowedMissing = new Set(
    (options.allowedMissingFiles ?? []).map((item) => normalizeReviewPathForPlatform(item, platform))
  );
  const entries: Array<{ path: string; state: "file" | "missing" | "non_file" | "deleted"; sha256?: string }> = [];

  for (const relativePath of canonicalPaths) {
    assertReviewSnapshotPathIsNotSensitive(relativePath);
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    assertInsideWorkspace(workspaceRoot, absolutePath, platform);
    try {
      const fileStat = await lstat(absolutePath);
      if (allowedMissing.has(relativePath)) {
        throw new Error(`REVIEW_SNAPSHOT_DECLARED_DELETION_STILL_EXISTS: ${relativePath}`);
      }
      if (!fileStat.isFile() && !fileStat.isSymbolicLink()) {
        if (options.requireReviewableFiles) {
          throw new Error(`REVIEW_SNAPSHOT_FILE_REQUIRED: ${relativePath}`);
        }
        entries.push({ path: relativePath, state: "non_file" });
        continue;
      }
      const resolvedPath = await realpath(absolutePath);
      const resolvedWorkspaceRoot = await realpath(workspaceRoot);
      assertInsideWorkspace(resolvedWorkspaceRoot, resolvedPath, platform);
      assertReviewSnapshotPathIsNotSensitive(
        normalizeReviewPathForPlatform(path.relative(resolvedWorkspaceRoot, resolvedPath), platform)
      );
      if (!(await stat(resolvedPath)).isFile()) {
        if (options.requireReviewableFiles) {
          throw new Error(`REVIEW_SNAPSHOT_FILE_REQUIRED: ${relativePath}`);
        }
        entries.push({ path: relativePath, state: "non_file" });
        continue;
      }
      const content = await readFile(resolvedPath);
      entries.push({
        path: relativePath,
        state: "file",
        sha256: createHash("sha256").update(content).digest("hex")
      });
    } catch (error) {
      if (isMissingPathError(error)) {
        if (options.requireReviewableFiles && !allowedMissing.has(relativePath)) {
          throw new Error(`REVIEW_SNAPSHOT_FILE_REQUIRED: ${relativePath}`);
        }
        entries.push({ path: relativePath, state: allowedMissing.has(relativePath) ? "deleted" : "missing" });
        continue;
      }
      throw error;
    }
  }

  return `sha256:${createHash("sha256").update(JSON.stringify({
    schema: REVIEW_SNAPSHOT_SCHEMA,
    entries
  }), "utf8").digest("hex")}`;
}

function assertReviewSnapshotPathIsNotSensitive(relativePath: string): void {
  if (isSensitiveWorkspacePath(relativePath)) {
    throw new Error(`REVIEW_SNAPSHOT_SENSITIVE_PATH: ${relativePath}`);
  }
}

export function isSensitiveWorkspacePath(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/").toLowerCase();
  const segments = normalizedPath.split("/");
  const basename = segments.at(-1) ?? "";
  const envTemplates = new Set([".env.example", ".env.sample", ".env.template"]);
  const sensitive =
    segments.some((segment) => segment === ".env" || (/^\.env\./.test(segment) && !envTemplates.has(segment)))
    || [".npmrc", ".netrc", ".pypirc"].includes(basename)
    || normalizedPath === "config.toml"
    || segments.some((segment, index) => segment === ".codex" && segments[index + 1] === "config.toml")
    || segments.some((segment, index) => segment === ".git" && segments[index + 1] === "config")
    || /^(?:credentials?|secrets?|tokens?|cookies?|authorization)$/.test(basename)
    || /^(?:credentials?|secrets?|tokens?|cookies?|authorization)\.(?:json|toml|ya?ml|ini|conf|txt|dat|db)$/.test(basename);
  return sensitive;
}

function assertInsideWorkspace(workspace: string, candidate: string, platform: NodeJS.Platform): void {
  const relative = path.relative(workspace, candidate);
  const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (outside) {
    throw new Error(`REVIEW_SNAPSHOT_OUTSIDE_WORKSPACE: ${normalizeReviewPathForPlatform(relative, platform)}`);
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
