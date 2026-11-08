import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Flow, GateRecord } from "./domain.js";
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
    // Trilho 2026-11-05-snapshot-unborn-aninhado (issue #6): repo UNBORN (sem
    // HEAD) não tem corroboração por status — em unborn TODO arquivo é
    // untracked, então o status não discrimina produto de ruído e ingere o
    // checkout inteiro (8.075 paths vs 105 declarados no consumidor). Sem base
    // não há diff atribuível: mantém a declaração e registra a limitação
    // (mesmo contrato do "sem .git / comando falhou" acima).
    if (!(await gitHeadAt(workspaceRoot))) return null;
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
      // Trilho 2026-11-05-snapshot-unborn-aninhado (issue #6): entrada com
      // barra final é DIRETÓRIO no porcelain -z (repo aninhado untracked ou
      // dir untracked) — nunca foi revisável, e o git do workspace jamais
      // lista o conteúdo de um repo aninhado; sem o descarte o entry congela
      // o verdict com REVIEW_SNAPSHOT_FILE_REQUIRED para sempre.
      if (filePath.length > 0 && !filePath.endsWith("/")) files.push(filePath);
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
  const recovered = await recoverLegacyReviewScope(flow, workspace);
  const implementationFingerprint = await strictReviewSnapshotFingerprint(recovered);
  return implementationFingerprint === recovered.implementation_fingerprint
    ? recovered
    : { ...recovered, implementation_fingerprint: implementationFingerprint };
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
export function declaredReviewPaths(flow: Flow): Set<string> {
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
  for (const event of flow.history ?? []) {
    const provided = event.type === "flow_facts_updated"
      ? event.data
      : event.type === "gate_checked" ? event.data.provided : undefined;
    if (provided && typeof provided === "object" && "changed_files" in provided && Array.isArray(provided.changed_files)) {
      for (const item of provided.changed_files) {
        if (typeof item === "string") declared.add(normalizeReviewPath(item));
      }
    }
  }
  return declared;
}

function redactableSensitivePaths(flow: Flow): string[] {
  const declared = declaredReviewPaths(flow);
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

async function isLegacyNestedRepository(workspace: string, relativePath: string): Promise<boolean> {
  const normalized = normalizeReviewPath(relativePath);
  if (!normalized.endsWith("/") || isSensitiveWorkspacePath(normalized)) return false;
  const absolutePath = path.resolve(workspace, normalized);
  assertInsideWorkspace(workspace, absolutePath, process.platform);
  try {
    if (!(await lstat(absolutePath)).isDirectory()) return false;
    assertInsideWorkspace(await realpath(workspace), await realpath(absolutePath), process.platform);
    const gitEntry = await lstat(path.join(absolutePath, ".git"));
    return gitEntry.isDirectory() || gitEntry.isFile();
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

async function isUnbornGitWorkspace(workspace: string): Promise<boolean> {
  if (await gitHeadAt(workspace)) return false;
  try {
    const { stdout } = await execFileAsync("git", ["-C", workspace, "rev-parse", "--is-inside-work-tree"], { windowsHide: true });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function isLegacyUnbornFile(workspace: string, relativePath: string): Promise<boolean> {
  const normalized = normalizeReviewPath(relativePath);
  if (isSensitiveWorkspacePath(normalized)) return false;
  const absolutePath = path.resolve(workspace, normalized);
  assertInsideWorkspace(workspace, absolutePath, process.platform);
  try {
    if (!(await lstat(absolutePath)).isFile()) return false;
    assertInsideWorkspace(await realpath(workspace), await realpath(absolutePath), process.platform);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

// Status only projects; existing mutators persist this scope and its recovery record.
async function recoverLegacyReviewScope(flow: Flow, workspace: string): Promise<Flow> {
  const identityOf = (item: string) => normalizeReviewPathForPlatform(item, process.platform).replace(/\/+$/, "");
  const declared = new Set([...declaredReviewPaths(flow), ...(flow.deleted_files ?? [])].map(identityOf));
  // No Git base means status never identified this flow's delta. Recover only
  // while still unborn, with positive declaration provenance; invalid paths stay visible.
  const recoverUnbornFiles = declared.size > 0 && !flow.git_head_base && await isUnbornGitWorkspace(workspace);
  const excluded: string[] = [];
  const excludedFiles: string[] = [];
  const changedFiles: string[] = [];
  for (const file of flow.changed_files) {
    const identity = identityOf(file);
    if (!declared.has(identity) && await isLegacyNestedRepository(workspace, file)) excluded.push(normalizeReviewPath(file));
    else if (!declared.has(identity) && recoverUnbornFiles && await isLegacyUnbornFile(workspace, file)) excludedFiles.push(normalizeReviewPath(file));
    else changedFiles.push(file);
  }
  const uniqueChangedFiles = dedupeChangedFilesByFsIdentity(changedFiles.map(normalizeReviewPath));
  if (excluded.length === 0 && excludedFiles.length === 0 && uniqueChangedFiles.length === flow.changed_files.length) return flow;
  return {
    ...flow,
    changed_files: uniqueChangedFiles,
    review_scope_recovery: {
      excluded_legacy_directories: [...new Set([...(flow.review_scope_recovery?.excluded_legacy_directories ?? []), ...excluded])],
      ...(excludedFiles.length > 0 || flow.review_scope_recovery?.excluded_legacy_unborn_files
        ? { excluded_legacy_unborn_files: [...new Set([...(flow.review_scope_recovery?.excluded_legacy_unborn_files ?? []), ...excludedFiles])] }
        : {})
    }
  };
}

// Identity deduplication preserves the first spelling; exclusion needs provenance.
export function dedupeChangedFilesByFsIdentity(
  files: string[],
  platform: NodeJS.Platform = process.platform
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const file of files) {
    const trimmed = file.trim();
    if (trimmed.length === 0) continue;
    const identity = normalizeReviewPathForPlatform(trimmed, platform);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(trimmed);
  }
  return merged;
}

// SPT gate-integrity-hardening-3 (R6): aplica o diff Git ao flow antes da
// decisao fiscal; o chamador nao ganha decisao propria.
export async function withGitCorroboratedChangedFiles(flow: Flow): Promise<Flow> {
  const workspace = flow.goal_binding?.envelope.workspace;
  if (!workspace) return flow;
  const recovered = await recoverLegacyReviewScope(flow, workspace);
  const [statusFiles, committed] = await Promise.all([
    gitChangedFiles(workspace),
    gitCommittedFilesSince(workspace, flow.git_head_base)
  ]);
  const merged = dedupeChangedFilesByFsIdentity([...recovered.changed_files, ...(statusFiles ?? []), ...(committed?.files ?? [])]);
  const unresolved = committed?.diverged === true;
  // Equal counts can hide a removed legacy entry and a newly discovered file.
  const unchanged = merged.length === recovered.changed_files.length
    && merged.every((item, index) => item === recovered.changed_files[index]);
  if (unchanged && unresolved === (flow.git_unresolved_commits === true)) {
    return recovered;
  }
  return { ...recovered, changed_files: merged, git_unresolved_commits: unresolved || undefined };
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

export interface BlockedVerdictRestoration {
  changed_files: string[];
  deleted_files: string[];
  pending_additions: string[];
  restored_from: string | null;
}

/**
 * Issue #11: um goal_verdict REJEITADO nao persiste o changed_files ampliado
 * pela corroboracao git (em worktree compartilhado isso engole commits alheios
 * e trava o flow num snapshot que nenhuma review viavel cobre). Restaura o
 * snapshot do ultimo gate APROVADO como evidencia historica e devolve os
 * acrescimos da corroboracao como pendentes auditaveis. Sem nenhum gate
 * aprovado com snapshot, mantem o conjunto corroborado (nao inventa snapshot)
 * e devolve pendentes vazios com restored_from nulo.
 */
export function restoreBlockedVerdictSnapshot(
  persisted: Pick<Flow, "gates" | "deleted_files">,
  corroborated: Pick<Flow, "changed_files" | "deleted_files">
): BlockedVerdictRestoration {
  const lastApproved = Object.values(persisted.gates ?? {})
    .filter((gate): gate is GateRecord => gate?.status === "passed" && Array.isArray(gate.changed_files_snapshot))
    .sort((a, b) => (a.checked_at < b.checked_at ? 1 : -1))[0];
  if (!lastApproved) {
    return {
      changed_files: corroborated.changed_files ?? [],
      deleted_files: corroborated.deleted_files ?? [],
      pending_additions: [],
      restored_from: null
    };
  }
  const restored = [...(lastApproved.changed_files_snapshot ?? [])];
  const pending = (corroborated.changed_files ?? []).filter((item) => !restored.includes(item));
  return {
    changed_files: restored,
    deleted_files: persisted.deleted_files ?? [],
    pending_additions: pending,
    restored_from: `${lastApproved.phase}@${lastApproved.checked_at}`
  };
}

/**
 * Issue #11 (recuperacao publica no mesmo flow): expoe os acrescimos da
 * corroboracao git que o ultimo veredito REJEITADO deixou como pending
 * auditavel (evento fiscal_policy_blocked). Modo "lean" devolve count + receita
 * (teto <5KB da frota); "full" inclui o array completo para atribuicao.
 */
export function pendingReviewAdditionsFor(
  flow: Flow,
  detail: "lean" | "full"
): { count: number; restored_from: string | null; attribution_hint: string; additions?: string[] } | null {
  let latestIndex = -1;
  let latestEvent: Flow["history"][number] | null = null;
  for (let index = flow.history.length - 1; index >= 0; index -= 1) {
    const event = flow.history[index];
    if (event.type === "fiscal_policy_blocked") {
      latestEvent = event;
      latestIndex = index;
      break;
    }
  }
  if (!latestEvent) {
    return null;
  }
  const verdictRecordedAfterBlock = flow.history
    .slice(latestIndex + 1)
    .some((event) => event.type === "verdict_recorded");
  if (verdictRecordedAfterBlock) {
    return null;
  }
  const raw = latestEvent.data.pending_review_additions;
  const additions = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  if (additions.length === 0) {
    return null;
  }
  const restoredFrom = latestEvent.data.restored_changed_files_from;
  return {
    count: additions.length,
    restored_from: typeof restoredFrom === "string" ? restoredFrom : null,
    attribution_hint:
      "acrescimos da corroboracao git rejeitados no ultimo veredito: declare os legitimos como provided.changed_files no proximo gate_check; os alheios ao flow ficam aqui como registro auditavel",
    ...(detail === "full" ? { additions } : {})
  };
}
