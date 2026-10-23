import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Flow } from "./domain.js";
import { isClientValueWrapper } from "./input-unwrap.js";

const execFileAsync = promisify(execFile);

const REVIEW_SNAPSHOT_SCHEMA = "ppirtv.review-snapshot.v2";

export function normalizeReviewPath(value: string): string {
  return normalizeReviewPathForPlatform(value, process.platform);
}

// SPT input-nunca-bloqueante-frentes-2 (GO do dono 2026-10-18): o valor pode
// vir embrulhado (artefato de cliente) ou como objeto de flow legado
// persistido sujo. Nunca lanca TypeError criptico: desembrulha o artefato
// conhecido, stringifica o resto (vira path inexistente -> state missing ->
// gate fail-closed honesto, sem loop).
export function normalizeReviewPathForPlatform(value: unknown, platform: NodeJS.Platform): string {
  const raw = isClientValueWrapper(value) ? value.value : value;
  const normalized = String(raw ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\/+/, "");
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
  const entries: Array<{ path: string; state: "file" | "missing" | "non_file" | "deleted" | "redacted_runtime"; sha256?: string }> = [];

  for (const relativePath of canonicalPaths) {
    // Trilho 2026-10-23-snapshot-fantasma (rodada adversarial): o prefixo de
    // runtime vale sobre o path RESOLVIDO lexicalmente — ".codex/../.env"
    // resolve para ".env" e continua fail-closed; e TODO path sob runtime e
    // redigido (independente de nome sensivel e de existir), porque conteudo
    // de terceiro nunca e produto: nem lido, nem hasheado, nem bloqueando o
    // verdict por arquivo ausente no modo strict do review. Aspas literais
    // envolvendo o path (persistido sujo por cliente velho, mesma familia do
    // input-unwrap 9a96e92) sao despilhadas ANTES do casamento de prefixo.
    const lexicalRelative = normalizeReviewPathForPlatform(
      path.relative(workspaceRoot, path.resolve(workspaceRoot, relativePath)),
      platform
    ).replace(/^["']+|["']+$/g, "");
    if (lexicalRelative === ".." || lexicalRelative.startsWith("../") || path.isAbsolute(lexicalRelative)) {
      throw new Error(`REVIEW_SNAPSHOT_OUTSIDE_WORKSPACE: ${normalizeReviewPathForPlatform(relativePath, platform)}`);
    }
    if (GIT_CORROBORATION_EXCLUDED_PREFIXES.some((prefix) => lexicalRelative.toLowerCase().startsWith(prefix))) {
      entries.push({ path: relativePath, state: "redacted_runtime" });
      continue;
    }
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



// SPT gate-integrity-hardening-3 (R6/NOVO-2): prefixos de runtime local do
// executor — nunca sao produto do workspace e nao podem contaminar a
// corroboration (.ppirtv/ vivo travava vereditos doc-only legitimos;
// .agents/ carrega SPT/receipts do proprio executor). Declaracao explicita
// em changed_files continua valendo: o filtro so remove o ruido automatico.
// Trilho 2026-10-23-snapshot-fantasma: dot-dirs de runtime de QUALQUER host
// (.codex/, .zcode/) sao o mesmo ruido — arquivo de terceiro nunca e
// produto; e path sensivel sob qualquer destes prefixos e REDIGIDO no
// snapshot, nunca bloqueante (pendencia
// PPIRTV-VEREDITO-TERMINAL-GATES-SNAPSHOT-FANTASMA, flows 0568/0602 do jev).
const GIT_CORROBORATION_EXCLUDED_PREFIXES = [".git/", ".ppirtv/", ".agents/", ".codex/", ".zcode/"];

function filterCorroborationFiles(files: string[]): string[] {
  const filtered = files
    .map((file) => normalizeReviewPath(file))
    .filter((file) => file.length > 0 && !GIT_CORROBORATION_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)));
  return [...new Set(filtered)];
}


// SPT gate-integrity-hardening-3 (R6): diff real do workspace quando ele e um
// repositorio Git. Retorna null quando nao ha .git ou o comando falha; nesse
// caso o chamador mantem a declaracao de changed_files e registra a limitacao.
export async function gitChangedFiles(workspace: string): Promise<string[] | null> {
  const workspaceRoot = path.resolve(workspace);
  try {
    await stat(path.join(workspaceRoot, ".git"));
  } catch (error) {
    if (isMissingPathError(error)) return null;
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", workspaceRoot, "status", "--porcelain", "--untracked-files=all"],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
    const files = stdout
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .flatMap((line) => {
        const renamed = line.split(" -> ");
        return renamed.length === 2 ? [renamed[1]] : [line];
      });
    return filterCorroborationFiles(files);
  } catch {
    return null;
  }
}

export async function gitHeadAt(workspace: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", path.resolve(workspace), "rev-parse", "HEAD"],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    const head = stdout.trim();
    return head.length > 0 ? head : null;
  } catch {
    return null;
  }
}

// SPT gate-integrity-hardening-3 (R6/NOVO-1): arquivos mudados por COMMITS
// feitos apos a base congelada no goal_start — fecha a janela
// commit-then-verdict que o `git status` (worktree limpo) nao enxerga.
// { files: null, diverged: true } = houve commits que o diff nao consegue
// inspecionar (base orfa por rebase/reset): o verdict fail-close exigindo
// review. Retorno null = sem base congelada (flow antigo ou sem .git).
export type GitCommittedFiles = { files: string[] | null; diverged: boolean };

export async function gitCommittedFilesSince(workspace: string, base?: string): Promise<GitCommittedFiles | null> {
  if (!base) return null;
  const head = await gitHeadAt(workspace);
  if (!head || head === base) return { files: [], diverged: false };
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", path.resolve(workspace), "diff", "--name-only", `${base}..HEAD`],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
    const files = filterCorroborationFiles(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    return { files, diverged: false };
  } catch {
    return { files: null, diverged: true };
  }
}



// SPT gate-integrity-hardening-3 (R6/NOVO-1): congelar o head Git do
// workspace no primeiro binding do flow; o verdict corrobora commits
// posteriores via diff base..HEAD. Idempotente em reuse — a base do inicio
// original e a referencia fiscal.
export async function freezeGitHeadBase(flow: Flow, workspace?: string): Promise<void> {
  if (!workspace || flow.git_head_base) return;
  flow.git_head_base = (await gitHeadAt(workspace)) ?? undefined;
}

// Extraida do monolito (SHRINK, pagamento FE-DEBT-003): fingerprint de
// implementacao corrente para o conjunto corrente de changed_files.
export async function withCurrentImplementationFingerprint(flow: Flow): Promise<Flow> {
  const workspace = flow.goal_binding?.envelope.workspace;
  if (!workspace || flow.status === "complete" || flow.status === "archived") {
    return flow;
  }
  const implementationFingerprint = await fingerprintReviewedImplementation(
    workspace,
    flow.changed_files,
    process.platform,
    { allowedMissingFiles: flow.deleted_files ?? [] }
  );
  return implementationFingerprint === flow.implementation_fingerprint
    ? flow
    : { ...flow, implementation_fingerprint: implementationFingerprint };
}

// SPT gate-integrity-hardening-3 (R6): aplica o diff Git ao flow antes da
// decisao fiscal; o chamador nao ganha decisao propria.
export async function withGitCorroboratedChangedFiles(flow: Flow): Promise<Flow> {
  const workspace = flow.goal_binding?.envelope.workspace;
  if (!workspace) return flow;
  const [statusFiles, committed] = await Promise.all([
    gitChangedFiles(workspace),
    gitCommittedFilesSince(workspace, flow.git_head_base)
  ]);
  const merged = [...new Set([...flow.changed_files, ...(statusFiles ?? []), ...(committed?.files ?? [])])];
  const unresolved = committed?.diverged === true;
  if (merged.length === flow.changed_files.length && unresolved === (flow.git_unresolved_commits === true)) {
    return flow;
  }
  return { ...flow, changed_files: merged, git_unresolved_commits: unresolved || undefined };
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
