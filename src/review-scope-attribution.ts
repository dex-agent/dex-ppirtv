import path from "node:path";
import { lstat } from "node:fs/promises";
import { z } from "zod";
import type { Evidence, Flow, VerdictStatus } from "./domain.js";
import { isPositiveVerdict } from "./domain.js";
import { declaredReviewPaths, fingerprintReviewedImplementation, normalizeReviewPath, withCurrentImplementationFingerprint, withGitCorroboratedChangedFiles } from "./review-snapshot.js";

export type GoalVerdictInput = {
  flow_id: string;
  status: VerdictStatus;
  rationale: string;
  evidence_ids?: string[];
  scope_attribution_evidence_ids?: string[];
  residual_risks?: string[];
  review_artifact_path?: string;
  review_findings?: string[];
  verdict_parking_lot?: string[];
  verdict_gold_mining?: string[];
  attempt_count?: number;
  regress_count?: number;
  recurring_risk?: boolean;
  meeting_id?: string;
  meeting_ids?: string[];
  next_step: string;
};

const attributionSchema = z.object({
  reviewer: z.string().trim().min(1),
  excluded_paths: z.array(z.object({
    path: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    source: z.string().trim().min(1)
  })).min(1)
});

const bindingSchema = z.object({
  version: z.literal(1),
  git_head_base: z.string().nullable(),
  fingerprint: z.string().startsWith("sha256:")
});

// Issue #21 P1-1 (2026-11-18): TODO veredito positivo carrega o flow avaliado
// para a gravação — a conferência de versão do prepareVerdictSnapshot não pode
// existir só na citação explícita (o modo automático avaliava uma revisão e
// gravava outra). Com arquivos estáveis ambos os modos gravam o mesmo resultado.
export function attributedVerdictSnapshot(input: GoalVerdictInput, flow: Flow): Flow | undefined {
  return isPositiveVerdict(input.status) ? flow : undefined;
}

export async function prepareVerdictSnapshot(current: Flow, validated?: Flow): Promise<Flow> {
  const flow = await withCurrentImplementationFingerprint(validated ?? current);
  if (validated && flow.implementation_fingerprint !== validated.implementation_fingerprint) {
    throw new Error("REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH: implementation changed after verdict evaluation");
  }
  return flow;
}

async function excludedPathsFingerprint(workspace: string, paths: string[]): Promise<string> {
  const missing: string[] = [];
  for (const relative of paths) {
    try {
      await lstat(path.resolve(workspace, relative));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(relative);
    }
  }
  return fingerprintReviewedImplementation(workspace, paths, process.platform, {
    requireReviewableFiles: true, allowedMissingFiles: missing
  });
}

function canonicalPath(workspace: string, value: string): string {
  const relative = path.relative(workspace, path.resolve(workspace, value));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`REVIEW_SCOPE_OUTSIDE_WORKSPACE: ${value}`);
  }
  return normalizeReviewPath(relative);
}

// ISSUE-LOCAL-0003 (2026-11-09): os erros de escopo NOMEIAM os paths
// ofensivos (molde da irmã STALE, que já nomeia o evidence_id) — o some()
// achava o culpado e o jogava fora, e fechar verdict no repo compartilhado
// exigia probe externo do motor (4 rodadas no flow 136). Truncagem com
// contador preserva o envelope (R9: erro explícito, nunca silêncio).
// Emenda adversarial D-34 (P3 ambiguidade/injeção): cada path citado entre
// aspas com quebras de linha achatadas — vírgula no nome de path não gera
// contagem ambígua e conteúdo crú não fabrica linhas na mensagem.
const OFFENDING_PATHS_LIMIT = 10;

function quoteOffendingPath(value: string): string {
  return `"${value.replace(/"/g, "'").replace(/[\r\n]+/g, " ")}"`;
}

function offendingPathsSuffix(offending: string[]): string {
  const shown = offending.slice(0, OFFENDING_PATHS_LIMIT);
  const omitted = offending.length - shown.length;
  return `; offending_paths: ${shown.map(quoteOffendingPath).join(", ")}${omitted > 0 ? ` (+${omitted} more)` : ""}`;
}

function protectedReviewPaths(flow: Flow): Set<string> {
  const workspace = flow.goal_binding!.envelope.workspace;
  return new Set([...flow.changed_files, ...declaredReviewPaths(flow)]
    .map((value) => canonicalPath(workspace, value)));
}

function assertExternalPaths(flow: Flow, paths: string[]): void {
  const protectedPaths = protectedReviewPaths(flow);
  // Issue #21 C-06: o erro nomeia os paths ofensivos (molde 0003/D-34) — erro
  // acionável em vez de bloqueio mudo. A chave do reason permanece exata.
  const offending = paths.filter((value) => protectedPaths.has(value));
  if (offending.length > 0) {
    throw new Error("REVIEW_SCOPE_DECLARED_PATH: a declared or frozen flow path cannot be excluded"
      + "; offending_paths: " + offending.slice(0, OFFENDING_PATHS_LIMIT).map(quoteOffendingPath).join(", ")
      + "; incorporate the path into the reviewed scope or attach a fresh review_scope_attribution excluding only external paths");
  }
}

// Attribution is an explicit reviewer attestation. The server binds its file
// identities; it does not infer ownership from a hash or a filename.
export async function bindReviewScopeAttribution(
  flow: Flow,
  input: Pick<Evidence, "kind" | "scope_classification" | "observed_result">
): Promise<Record<string, unknown> | undefined> {
  if (input.kind !== "review_scope_attribution") return input.observed_result;
  if (input.scope_classification !== "outside" || !flow.goal_binding) {
    throw new Error("REVIEW_SCOPE_ATTRIBUTION_INVALID: requires outside classification and a bound GOAL");
  }
  const parsed = attributionSchema.safeParse(input.observed_result);
  if (!parsed.success) {
    throw new Error("REVIEW_SCOPE_ATTRIBUTION_INVALID: provide reviewer and excluded_paths with path, reason and source");
  }
  const workspace = flow.goal_binding.envelope.workspace;
  const excludedPaths = parsed.data.excluded_paths.map((entry) => ({ ...entry, path: canonicalPath(workspace, entry.path) }));
  const paths = excludedPaths.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error("REVIEW_SCOPE_DUPLICATE_PATH: repeated exclusion");
  assertExternalPaths(flow, paths);
  const corroborated = await withGitCorroboratedChangedFiles(flow);
  const discovered = new Set(corroborated.changed_files.map((value) => canonicalPath(workspace, value)));
  const undiscovered = paths.filter((value) => !discovered.has(value));
  if (undiscovered.length > 0) {
    throw new Error("REVIEW_SCOPE_UNDISCOVERED_PATH: exclusions must come from current Git corroboration" + offendingPathsSuffix(undiscovered));
  }
  return {
    reviewer: parsed.data.reviewer,
    excluded_paths: excludedPaths,
    attribution_binding: {
      version: 1,
      git_head_base: flow.git_head_base ?? null,
      fingerprint: await excludedPathsFingerprint(workspace, paths)
    }
  };
}

// ISSUE-LOCAL-0012 (2026-11-17): o binding aprovado é o predicado de validade
// já exigido para citação explícita (abaixo, no loop). Extraído em função
// pequena para o reuso automático do early-return — a adoção NUNCA promove
// attribution stale; sem válida, o comportamento atual permanece.
async function attributionBindingCurrent(
  evidence: Evidence,
  workspace: string,
  flow: Flow
): Promise<boolean> {
  const attribution = attributionSchema.safeParse(evidence.observed_result);
  const binding = bindingSchema.safeParse(evidence.observed_result?.attribution_binding);
  if (!attribution.success || !binding.success) return false;
  if (binding.data.git_head_base !== (flow.git_head_base ?? null)) return false;
  const paths = attribution.data.excluded_paths.map((entry) => canonicalPath(workspace, entry.path));
  return binding.data.fingerprint === await excludedPathsFingerprint(workspace, paths);
}

// Issue #21 P3-9 (2026-11-18): os ids adotáveis são o resultado do MESMO crivo
// async da adoção automática — extraídos em função pequena para o hint do
// fiscal oferecer somente o que a validação aceitaria (nunca um ID vencido).
// Issue #21 P2-5: exclusão histórica que colide com path AGORA declarado não é
// adotável — o arquivo foi incorporado ao escopo e a exclusão virou história.
export async function collectAdoptableAttributionIds(flow: Flow): Promise<string[]> {
  const workspace = flow.goal_binding!.envelope.workspace;
  const protectedPaths = protectedReviewPaths(flow);
  const adotaveis: string[] = [];
  for (const evidence of flow.evidence) {
    if (evidence.flow_id !== flow.flow_id || evidence.kind !== "review_scope_attribution" || evidence.scope_classification !== "outside") continue;
    if (!(await attributionBindingCurrent(evidence, workspace, flow))) continue;
    const attribution = attributionSchema.safeParse(evidence.observed_result);
    if (!attribution.success) continue;
    const colide = attribution.data.excluded_paths
      .some((entry) => protectedPaths.has(canonicalPath(workspace, entry.path)));
    if (!colide) adotaveis.push(evidence.evidence_id);
  }
  return adotaveis;
}

export async function applyReviewScopeAttributions(
  flow: Flow,
  corroborated: Flow,
  evidenceIds: string[] = []
): Promise<Flow> {
  const workspace = flow.goal_binding!.envelope.workspace;
  if (evidenceIds.length === 0) {
    // ISSUE-LOCAL-0012: verdict sem citação reutiliza attribution aprovada
    // com binding válido (janela paralela não re-traz alheios). As adotadas
    // passam pelo MESMO crivo do loop abaixo — duplicata intencional.
    // Issue #21 P2-5: colidentes com path agora declarado não são adotadas —
    // o arquivo incorporado PERMANECE no escopo (a ampliação vira revisa
    // pendente, nunca exclusão silenciosa).
    evidenceIds = await collectAdoptableAttributionIds(flow);
    if (evidenceIds.length === 0) {
      // Issue #21 P1-1: o fingerprint devolvido é o do conjunto corroborado
      // ATUAL (pós-ampliação git) — a asserção da gravação (prepareVerdictSnapshot,
      // Introduzir Asserção) compara avaliado↔gravado sem falso positivo.
      return withCurrentImplementationFingerprint(corroborated);
    }
  }
  const exclusions = new Set<string>();
  for (const evidenceId of new Set(evidenceIds)) {
    const evidence = flow.evidence.find((item) => item.evidence_id === evidenceId);
    if (!evidence || evidence.flow_id !== flow.flow_id || evidence.kind !== "review_scope_attribution" || evidence.scope_classification !== "outside") {
      throw new Error(`REVIEW_SCOPE_ATTRIBUTION_REQUIRED: ${evidenceId}`);
    }
    const attribution = attributionSchema.safeParse(evidence.observed_result);
    const binding = bindingSchema.safeParse(evidence.observed_result?.attribution_binding);
    if (!attribution.success || !binding.success) throw new Error(`REVIEW_SCOPE_ATTRIBUTION_INVALID: ${evidenceId}`);
    const paths = attribution.data.excluded_paths.map((entry) => canonicalPath(workspace, entry.path));
    assertExternalPaths(flow, paths);
    if (binding.data.git_head_base !== (flow.git_head_base ?? null)
      || binding.data.fingerprint !== await excludedPathsFingerprint(workspace, paths)) {
      throw new Error(`REVIEW_SCOPE_ATTRIBUTION_STALE: ${evidenceId}; recheck provenance and attach a fresh attribution`);
    }
    paths.forEach((value) => exclusions.add(value));
  }
  const changedFiles = corroborated.changed_files.filter((value) => !exclusions.has(canonicalPath(workspace, value)));
  const protectedPaths = protectedReviewPaths(flow);
  const unattributed = changedFiles.filter((value) => !protectedPaths.has(canonicalPath(workspace, value)));
  if (unattributed.length > 0) {
    throw new Error("REVIEW_SCOPE_UNATTRIBUTED_PATH: declare legitimate additions through the gate or attribute external paths before retrying" + offendingPathsSuffix(unattributed));
  }
  return withCurrentImplementationFingerprint({
    ...corroborated,
    changed_files: changedFiles
  });
}

// Corte B' (issues #22-#25, 2026-11-18): com bloqueio fiscal pendente, o
// anexo de review consulta a MESMA fonte que o fiscal vai exigir no retry —
// corroboração Git + attribution VIGENTE (adotáveis pelo mesmo crivo), e não
// o escopo congelado do primeiro bloqueio (#25). Quando o recompute lança
// (attribution insuficiente, binding vencido), cai na união persistido∪pending
// — o comportamento da Emenda A2, com o verdict seguindo como autoridade.
export async function pendingAttachScope(
  flow: Flow,
  pendingScope: { changed_files: string[]; fingerprint: string } | null
): Promise<Flow> {
  if (!pendingScope) return flow;
  try {
    return await applyReviewScopeAttributions(flow, await withGitCorroboratedChangedFiles(flow));
  } catch {
    return {
      ...flow,
      changed_files: Array.from(new Set([...flow.changed_files, ...pendingScope.changed_files]))
    };
  }
}
