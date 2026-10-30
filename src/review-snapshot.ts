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
  options: { requireReviewableFiles?: boolean; allowedMissingFiles?: string[]; redactedSensitivePaths?: string[] } = {}
): Promise<string> {
  const workspaceRoot = path.resolve(workspace);
  const canonicalPaths = [...new Set(changedFiles.map((item) => normalizeReviewPathForPlatform(item, platform)).filter(Boolean))].sort();
  const allowedMissing = new Set(
    (options.allowedMissingFiles ?? []).map((item) => normalizeReviewPathForPlatform(item, platform))
  );
  // PPIRTV-ENV-SNAPSHOT-001 (decisão do owner 2026-10-29): sensível NÃO
  // declarado (vítima do sweep de corroboração legado) é ruído de terceiro —
  // REDIGIDO como o redacted_runtime, antes de lstat/readFile: conteúdo nunca
  // lido nem hasheado. Sensível fora da lista segue fail-closed (produto
  // próprio declarado).
  const redactedSensitive = new Set(
    (options.redactedSensitivePaths ?? []).map((item) => normalizeReviewPathForPlatform(item, platform))
  );
  const entries: Array<{ path: string; state: "file" | "missing" | "non_file" | "deleted" | "redacted_runtime" | "redacted_sensitive"; sha256?: string }> = [];

  for (let relativePath of canonicalPaths) {
    // PPIRTV-GIT-QUOTING-UNWRAP-001 (ponte legacy, 2026-10-30): entry
    // congelada com aspas pelo parser pré--z — path EXATO primeiro (nome
    // real quotado é possível no Linux e nunca é mis-hash); se o exato não
    // existe e o despido existe, processa o DESPIDO: entry registrada com o
    // path real e o sha do conteúdo real; ambas ausentes segue o contrato
    // atual (missing / FILE_REQUIRED fail-closed).
    const unquotedLegacy = relativePath.replace(/^["']+|["']+$/g, "");
    if (unquotedLegacy !== relativePath && unquotedLegacy.length > 0) {
      const exactExists = await lstat(path.resolve(workspaceRoot, relativePath)).then(() => true, () => false);
      if (!exactExists) {
        const unquotedExists = await lstat(path.resolve(workspaceRoot, unquotedLegacy)).then(() => true, () => false);
        if (unquotedExists) relativePath = unquotedLegacy;
      }
    }
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
    if (isSensitiveWorkspacePath(relativePath)) {
      if (redactedSensitive.has(normalizeReviewPathForPlatform(relativePath, platform))) {
        entries.push({ path: relativePath, state: "redacted_sensitive" });
        continue;
      }
      throw new Error(`REVIEW_SNAPSHOT_SENSITIVE_PATH: ${relativePath}`);
    }
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
      const resolvedRelative = normalizeReviewPathForPlatform(
        path.relative(resolvedWorkspaceRoot, resolvedPath), platform
      );
      if (isSensitiveWorkspacePath(resolvedRelative)) {
        if (redactedSensitive.has(resolvedRelative)) {
          entries.push({ path: relativePath, state: "redacted_sensitive" });
          continue;
        }
        throw new Error(`REVIEW_SNAPSHOT_SENSITIVE_PATH: ${relativePath}`);
      }
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
// PPIRTV-ENV-SNAPSHOT-001 (2026-10-29): sensivel por nome (.env e irmaos) e
// o mesmo ruido automatico na corroboration — nunca entra no merge; a rota
// de declaracao (provided/revision_set) continua sendo a unica porta e la o
// sensivel segue fail-closed.
const GIT_CORROBORATION_EXCLUDED_PREFIXES = [".git/", ".ppirtv/", ".agents/", ".codex/", ".zcode/"];

function filterCorroborationFiles(files: string[]): string[] {
  const filtered = files
    .map((file) => normalizeReviewPath(file))
    .filter((file) => file.length > 0
      && !GIT_CORROBORATION_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))
      && !isSensitiveWorkspacePath(file));
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
      ["-C", workspaceRoot, "status", "--porcelain", "-z", "--untracked-files=all"],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
    // PPIRTV-GIT-QUOTING-UNWRAP-001 (2026-10-30): saída -z é NUL-delimited e
    // o git NUNCA quoteia paths nela (imunidade estrutural ao C-quoting de
    // espaços e non-ASCII que congelava entries com aspas no changed_files).
    // Rename/copy (R/C) traz a ORIGEM como campo NUL extra logo após o alvo —
    // consumir mantendo o ALVO NOVO (mesma semântica do antigo split " -> ").
    // NÃO trim na entry inteira: o código XY pode começar com espaço (" M")
    // e o trim comeria o ponto do ".ppirtv/..." — slice(3) PRIMEIRO (ordem
    // do parser antigo), trim só no path extraído.
    const entries = stdout.split("\0").filter((line) => line.trim().length > 0);
    const files: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const status = entries[index].slice(0, 2);
      const filePath = entries[index].slice(3).trim();
      if (filePath.length > 0) files.push(filePath);
      if (status.includes("R") || status.includes("C")) index += 1;
    }
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
        ["-C", path.resolve(workspace), "diff", "--name-only", "-z", `${base}..HEAD`],
        { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
      );
      // PPIRTV-GIT-QUOTING-UNWRAP-001: o diff --name-only também C-quoteia
      // non-ASCII (escapes octais) na saída LF; no -z NUNCA quoteia.
      const files = filterCorroborationFiles(stdout.split("\0").map((line) => line.trim()).filter(Boolean));
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
  const implementationFingerprint = await strictReviewSnapshotFingerprint(flow);
  return implementationFingerprint === flow.implementation_fingerprint
    ? flow
    : { ...flow, implementation_fingerprint: implementationFingerprint };
}

// PPIRTV-ENV-SNAPSHOT-001 (emenda barata 2): a rota CORRENTE e a rota ESTRITA
// de atestação de review compartilham a MESMA verdade — o fingerprint do flow
// com redação de sensível não-declarado. A fachada só delega (visita CONTAIN
// ao camping; debt FE-DEBT-005).
export async function strictReviewSnapshotFingerprint(
  flow: Flow,
  options: { requireReviewableFiles?: boolean } = {}
): Promise<string> {
  const workspace = flow.goal_binding?.envelope.workspace;
  if (!workspace) {
    throw new Error("REVIEW_SNAPSHOT_WORKSPACE_REQUIRED: strict review snapshot requires a flow workspace binding");
  }
  const redactedSensitivePaths = redactableSensitivePaths(flow);
  return fingerprintReviewedImplementation(workspace, flow.changed_files, process.platform, {
    requireReviewableFiles: options.requireReviewableFiles,
    allowedMissingFiles: flow.deleted_files ?? [],
    ...(redactedSensitivePaths.length > 0 ? { redactedSensitivePaths } : {})
  });
}

// PPIRTV-ENV-SNAPSHOT-001 (2026-10-29): sensível congelado no changed_files
// que NÃO consta no universo declarado do flow (provided.changed_files de
// qualquer gate + revision_set de criterion_proof) é ruído de terceiro
// varrido pela corroboração legada — redigido no snapshot, nunca bloqueante.
// Sensível declarado segue fail-closed: a diferença terceiro × produto é por
// PROVENIÊNCIA de declaração (decisão explícita do owner, laudo §17).
function redactableSensitivePaths(flow: Flow): string[] {
  const declared = new Set<string>();
  for (const gate of Object.values(flow.gates ?? {})) {
    const changed = (gate as { provided?: { changed_files?: unknown } }).provided?.changed_files;
    if (Array.isArray(changed)) {
      for (const item of changed) {
        if (typeof item === "string") declared.add(normalizeReviewPath(item));
      }
    }
  }
  for (const evidence of flow.evidence ?? []) {
    const revisionSet = (evidence as unknown as { criterion_proof?: { revision_set?: Array<{ paths?: Array<{ path: unknown }> }> } }).criterion_proof?.revision_set;
    for (const revision of revisionSet ?? []) {
      for (const entry of revision.paths ?? []) {
        if (typeof entry.path === "string") declared.add(normalizeReviewPath(entry.path));
      }
    }
  }
  // Leitura tolerante a dado persistido sujo (input-nunca-bloqueante): item
  // embrulhado/objeto vira string pela MESMA normalização do pipeline do
  // snapshot antes do casamento de sensibilidade — redigir só o que é path
  // sensível de verdade; sujeira segue o destino antigo (missing/non_file).
  return flow.changed_files
    .map((item) => normalizeReviewPath(item))
    .filter((normalized) => normalized.length > 0
      && isSensitiveWorkspacePath(normalized)
      && !declared.has(normalized));
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
