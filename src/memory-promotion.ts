// Onda 7 (maratona ESCOTEIRO-ONDA, Trilho 2026-11-09-onda7-memory-promotion):
// eixo memory-v2/promotion/write/candidates mora FORA do monolito — a
// politica de candidatos/promocao (contrato dex-memoria v2) e eixo de mudanca
// proprio; a orquestracao fica no motor. Ultima familia da maratona: depois
// desta, resta o nucleo de orquestracao por desenho.
import { createHash } from "node:crypto";
import path from "node:path";
import {
  classifyDexMemoriaV2Intent,
  type DexMemoriaV2CanonicalReceipt, type DexMemoriaV2Destination,
  type DexMemoriaV2MiningClassification,
} from "./memory/dex-memoria-v2-adapter.js";
import type {
  Flow, MemoryCandidate, MemoryCandidatePromoteScope, MemoryCandidateResolution,
  MemoryCandidateScope,
  MemoryWritePolicy,
} from "./domain.js";
import type { V2MemoryCandidateResolution } from "./fiscal-blockers.js";
import { isWritableCandidate, memoryCandidateLedgerData } from "./memory/mining-policy.js";
import { errorMessage, requireText, unique } from "./lang-utils.js";
import { sameRuntimePath } from "./config.js";

export type V2CommittedBoundaryError = Error & {
  v2_committed_effect: true;
};

export function latestTraceableCandidateResolutionMap(flow: Flow): Map<string, MemoryCandidateResolution> {
  const result = new Map<string, MemoryCandidateResolution>();
  for (const resolution of flow.memory_candidate_resolutions ?? []) {
    if (isTraceableCandidateResolution(resolution)) {
      result.set(resolution.candidate_id, resolution);
    }
  }
  return result;
}

function isTraceableCandidateResolution(resolution: MemoryCandidateResolution): boolean {
  if (!resolution.traceable || !resolution.candidate_id || !resolution.rationale?.trim()) {
    return false;
  }
  if (resolution.action === "park") {
    return Boolean(resolution.when?.trim());
  }
  if (resolution.action === "promote") {
    return isPromotionScope(resolution.target_scope ?? "projeto") && (resolution.target_scope !== "tema" || Boolean(resolution.theme?.trim()));
  }
  return resolution.action === "discard" || resolution.action === "accept_ledger_only";
}

export function applyMemoryCandidateResolution(
  candidate: MemoryCandidate,
  resolution: MemoryCandidateResolution | undefined,
  workspace: string,
  dexMemoriaHome: string
): MemoryCandidate {
  if (!resolution || !isTraceableCandidateResolution(resolution)) {
    return candidate;
  }
  if (resolution.action === "promote") {
    const scope = resolution.target_scope ?? "projeto";
    const theme = scope === "tema" ? resolution.theme ?? candidate.theme : candidate.theme;
    return {
      ...candidate,
      scope,
      theme,
      target_files: memoryTargetFilesForResolution(scope, theme, workspace, dexMemoriaHome),
      blocked: false,
      blocked_reason: null,
      has_l1: true
    };
  }
  if (resolution.action === "park") {
    return { ...candidate, scope: "estacionamento", target_files: [], blocked: false, blocked_reason: null };
  }
  if (resolution.action === "discard") {
    return { ...candidate, scope: "descartar", target_files: [], blocked: false, blocked_reason: null };
  }
  return candidate;
}

function memoryTargetFilesForResolution(scope: MemoryCandidatePromoteScope, theme: string | undefined, workspace: string, dexMemoriaHome: string): string[] {
  if (scope === "global") {
    return [path.join(dexMemoriaHome, "global", "LEMBRANCA.md"), path.join(dexMemoriaHome, "global", "MEMORIA.md")];
  }
  if (scope === "tema" && theme) {
    return [path.join(dexMemoriaHome, "temas", theme, "LEMBRANCA.md"), path.join(dexMemoriaHome, "temas", theme, "MEMORIA.md")];
  }
  return [path.join(workspace, ".agents", "LEMBRANCA.md"), path.join(workspace, ".agents", "MEMORIA.md")];
}

export function memoryV2Slug(item: string, fallback: string): string {
  const base = item
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const identitySuffix = fallback.toLowerCase().replace(/[^a-f0-9]/g, "").slice(-12);
  const readablePrefix = base.slice(0, 51).replace(/-+$/g, "") || "memory";
  return identitySuffix ? `${readablePrefix}-${identitySuffix}` : readablePrefix.slice(0, 64);
}

export function memoryV2CandidateId(item: string): string {
  const normalized = item.normalize("NFC").replace(/\s+/g, " ").trim();
  return `mc_${createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 24)}`;
}

export function memoryV2OperationId(item: string, classification: ReturnType<typeof classifyDexMemoriaV2Intent>): string {
  const materialUnit = {
    item: item.normalize("NFC").replace(/\s+/g, " ").trim(),
    target_layer: classification.route.target,
    owner_skill: classification.route.target === "L3" ? classification.route.owner_skill : null,
    tags: [...classification.tags],
    destinations: classification.destinations.map((destination) => destination.scope === "theme"
      ? { scope: destination.scope, theme: destination.theme }
      : { scope: destination.scope })
  };
  return `mmv2_${createHash("sha256").update(JSON.stringify(materialUnit), "utf8").digest("hex")}`;
}

// ISSUE-LOCAL-0007 (2026-11-10, emenda D-37 P1 — adversarial com 2 revisores
// convergentes por probe): memoryV2OperationId é determinístico pelo item —
// o retry do resolve reutilizava o id PRESO e a dex-memoria responde "use a
// new operation_id". A FAMÍLIA do id é o prefixo (base + "-retry-N"): o
// julgamento conta TODOS os receipts da família, não só os do id exato (o
// primeiro desenho regenerava id já queimado na 3ª tentativa — loop
// base↔retry-1). Regras: (1) se o ÚLTIMO receipt da família é
// PARTIAL_PENDING, devolve o MESMO id — o adapter retoma pelo RESUME
// canônico (contrato "persists PARTIAL_PENDING and consumes it through
// canonical resume", preservado pela suíte); (2) se há id PRESO na família
// (status FAILED — o vocabulário real do receipt canônico é
// "COMMITTED"|"PARTIAL_PENDING"|"FAILED"), sufixo MONOTÔNICO
// retry-(total-de-receipts-da-família + 1): id novo por tentativa, nunca
// colide com id já usado (mesmo um COMMITTED intermediário); (3) sem preso,
// o id base. Separador HÍFEN (não "::"): receipt paths derivam do
// operation_id e ":" é proibido em nome de arquivo no Windows.
export function freshOperationIdForRetry(
  baseOperationId: string,
  previousReceipts: Array<Pick<DexMemoriaV2CanonicalReceipt, "operation_id" | "status">>
): string {
  const suffixOf = (operationId: string): number =>
    operationId === baseOperationId ? 0 : Number(/-retry-(\d+)$/.exec(operationId)?.[1] ?? 0);
  const family = previousReceipts.filter((receipt) =>
    receipt.operation_id === baseOperationId
    || receipt.operation_id.startsWith(`${baseOperationId}-retry-`));
  if (family.length === 0) return baseOperationId;
  // v2_receipts é SUBSTITUÍDO a cada mineração: o contador mora no SUFIXO
  // numérico do maior id da família — monotônico sob replace (a contagem
  // por receipts regenerava id queimado na 3ª tentativa).
  const latest = [...family].sort((left, right) => suffixOf(right.operation_id) - suffixOf(left.operation_id))[0]!;
  if (latest.status === "PARTIAL_PENDING") return latest.operation_id;
  const stuck = family.some((receipt) => receipt.status !== "COMMITTED");
  return stuck ? `${baseOperationId}-retry-${suffixOf(latest.operation_id) + 1}` : baseOperationId;
}

export function v2ReceiptsProveCommittedEffect(receipts: DexMemoriaV2CanonicalReceipt[]): boolean {
  return receipts.some((receipt) =>
    receipt.status === "COMMITTED"
    || Object.values(receipt.route_receipts ?? {}).some((routeReceipt) => routeReceipt?.status === "COMMITTED")
  );
}

export function v2CommittedBoundaryError(error: unknown): V2CommittedBoundaryError {
  return Object.assign(
    new Error(`PPIRTV_V2_COMMITTED_STATE_PERSISTENCE_FAILED: ${errorMessage(error)}`),
    { v2_committed_effect: true as const }
  );
}

export function isV2CommittedBoundaryError(error: unknown): error is V2CommittedBoundaryError {
  return error instanceof Error
    && (error as Partial<V2CommittedBoundaryError>).v2_committed_effect === true;
}

export function memoryV2ReconciliationId(input: {
  flowId: string;
  writePolicy: MemoryWritePolicy;
  candidates: Array<Record<string, unknown>>;
  receipts: DexMemoriaV2CanonicalReceipt[];
  candidateResolutions: MemoryCandidateResolution[];
}): string {
  const operationIds = unique([
    ...input.candidates
      .map((candidate) => typeof candidate.operation_id === "string" ? candidate.operation_id : "")
      .filter(Boolean),
    ...input.receipts.map((receipt) => receipt.operation_id)
  ]).sort();
  const receiptIds = unique(input.receipts.flatMap((receipt) =>
    Object.values(receipt.route_receipts ?? {})
      .map((routeReceipt) => routeReceipt?.receipt_id ?? "")
      .filter(Boolean)
  )).sort();
  const resolutionIds = unique(input.candidateResolutions.map((resolution) => resolution.resolution_id)).sort();
  const candidateIds = unique(input.candidates.map((candidate) => memoryCandidateIdentity(candidate))).sort();
  const materialAttempt = {
    flow_id: input.flowId,
    write_policy: input.writePolicy,
    operation_ids: operationIds,
    receipt_ids: receiptIds,
    resolution_ids: resolutionIds,
    candidate_ids: candidateIds
  };
  return `mmv2_ledger_${createHash("sha256").update(JSON.stringify(materialAttempt), "utf8").digest("hex")}`;
}

export function requireConfiguredV2Root(value: string | undefined, field: "MEMORY_HOME" | "WORKSPACE"): string {
  if (!value?.trim()) throw new Error(`PPIRTV_DEX_MEMORIA_V2_${field}_REQUIRED`);
  if (!path.isAbsolute(value)) throw new Error(`PPIRTV_DEX_MEMORIA_V2_${field}_MUST_BE_ABSOLUTE`);
  return path.resolve(value);
}

export function confinedV2Workspace(input: {
  storeWorkspace: string;
  writerWorkspace: string | undefined;
  envelopeWorkspace?: string;
}): string {
  const storeWorkspace = requireConfiguredV2Root(input.storeWorkspace, "WORKSPACE");
  const writerWorkspace = requireConfiguredV2Root(input.writerWorkspace, "WORKSPACE");
  const envelopeWorkspace = input.envelopeWorkspace
    ? requireConfiguredV2Root(input.envelopeWorkspace, "WORKSPACE")
    : undefined;
  if (!sameRuntimePath(storeWorkspace, writerWorkspace)
    || (envelopeWorkspace && !sameRuntimePath(storeWorkspace, envelopeWorkspace))) {
    throw new Error(
      `PPIRTV_DEX_MEMORIA_V2_WORKSPACE_MISMATCH: store=${storeWorkspace}; writer=${writerWorkspace}; envelope=${envelopeWorkspace ?? "not_bound"}`
    );
  }
  return storeWorkspace;
}

export function requestedV2MiningClassification(input: {
  v2_destinations?: DexMemoriaV2Destination[];
  v2_density?: "light" | "deep";
  v2_owner_skill?: string;
  v2_tags?: string[];
}): DexMemoriaV2MiningClassification | undefined {
  const hasAnyDirective = Boolean(input.v2_destinations || input.v2_density || input.v2_owner_skill || input.v2_tags);
  if (!hasAnyDirective) return undefined;
  if (!input.v2_destinations?.length) return { status: "unresolved", reason: "destinations_required" };
  if (!input.v2_tags?.length) return { status: "unresolved", reason: "tags_required" };
  const requestedDestinations = input.v2_destinations as [DexMemoriaV2Destination, ...DexMemoriaV2Destination[]];
  const tags = input.v2_tags as [string, ...string[]];
  if (input.v2_density === "deep") {
    if (!input.v2_owner_skill?.trim()) return { status: "unresolved", reason: "owner_skill_required" };
    return { status: "resolved", density: "deep", requested_destinations: requestedDestinations, tags, owner_skill: input.v2_owner_skill };
  }
  return { status: "resolved", density: "light", requested_destinations: requestedDestinations, tags };
}

export function memoryCandidateLedgerDataWithResolution(candidate: MemoryCandidate, resolution: MemoryCandidateResolution | undefined): Record<string, unknown> {
  return {
    ...memoryCandidateLedgerData(candidate),
    ...(resolution ? { resolution: candidateResolutionLedgerData(resolution) } : {})
  };
}

export function candidateResolutionLedgerData(resolution: MemoryCandidateResolution): Record<string, unknown> {
  const v2Resolution = resolution as V2MemoryCandidateResolution;
  return {
    resolution_id: resolution.resolution_id,
    candidate_id: resolution.candidate_id,
    action: resolution.action,
    rationale: resolution.rationale,
    when: resolution.when,
    target_scope: resolution.target_scope,
    theme: resolution.theme,
    candidate_tags: v2Resolution.candidate_tags,
    candidate_density: v2Resolution.candidate_density,
    candidate_destinations: v2Resolution.candidate_destinations,
    candidate_theme: v2Resolution.candidate_theme,
    candidate_owner_skill: v2Resolution.candidate_owner_skill,
    traceable: resolution.traceable,
    created_at: resolution.created_at,
    source: resolution.source
  };
}

export function isPromotionScope(value: unknown): value is MemoryCandidatePromoteScope {
  return value === "global" || value === "tema" || value === "projeto";
}

export function isMemoryCandidateScope(value: unknown): value is MemoryCandidateScope {
  return value === "global" || value === "tema" || value === "projeto" || value === "ledger_only" || value === "estacionamento" || value === "descartar";
}

export function candidateScoreTotal(candidate: Record<string, unknown>): number | undefined {
  const score = candidate.score;
  if (!score || typeof score !== "object") {
    return undefined;
  }
  const total = (score as Record<string, unknown>).total;
  return typeof total === "number" ? total : undefined;
}

export function memoryCandidateIdentity(candidate: Record<string, unknown>): string {
  const legacyIdentity = typeof candidate.id === "string" ? candidate.id : undefined;
  const v2Identity = typeof candidate.candidate_id === "string" ? candidate.candidate_id : undefined;
  if (legacyIdentity !== undefined && v2Identity !== undefined && legacyIdentity !== v2Identity) {
    throw new Error(`MEMORY_CANDIDATE_IDENTITY_CONFLICT: id=${legacyIdentity}; candidate_id=${v2Identity}`);
  }
  const identity = (v2Identity ?? legacyIdentity ?? "").trim();
  if (!identity) {
    throw new Error("MEMORY_CANDIDATE_IDENTITY_REQUIRED: candidate must contain id or candidate_id");
  }
  return identity;
}

export function memoryCandidateLookup(candidates: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const lookup = new Map<string, Record<string, unknown>>();
  for (const candidate of candidates) {
    const identity = memoryCandidateIdentity(candidate);
    if (lookup.has(identity)) {
      throw new Error(`MEMORY_CANDIDATE_IDENTITY_DUPLICATE: ${identity}`);
    }
    lookup.set(identity, candidate);
  }
  return lookup;
}

export function hasV2CandidateIdentity(candidate: Record<string, unknown>): boolean {
  return typeof candidate.candidate_id === "string" && candidate.candidate_id.trim().length > 0;
}

export function requireV2CandidateDestinations(candidate: Record<string, unknown>): DexMemoriaV2Destination[] {
  if (!Array.isArray(candidate.destinations) || candidate.destinations.length === 0) {
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: classified V2 candidate destinations are incomplete");
  }
  return candidate.destinations.map((destination) => {
    if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: classified V2 candidate destination is invalid");
    }
    const record = destination as Record<string, unknown>;
    if (record.scope === "project" || record.scope === "global") {
      return { scope: record.scope };
    }
    if (record.scope === "theme" && typeof record.theme === "string" && record.theme.trim()) {
      return { scope: "theme", theme: record.theme.trim() };
    }
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: classified V2 candidate destination is invalid");
  });
}

export function v2PromotionClassification(resolution: MemoryCandidateResolution): DexMemoriaV2MiningClassification {
  const v2Resolution = resolution as V2MemoryCandidateResolution;
  const tags = v2Resolution.candidate_tags?.filter((tag) => typeof tag === "string" && tag.trim().length > 0) ?? [];
  const density = v2Resolution.candidate_density;
  if (tags.length === 0 || !density || (density === "deep" && !v2Resolution.candidate_owner_skill?.trim())) {
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: persisted V2 promotion metadata is incomplete");
  }
  const destinations = v2Resolution.candidate_destinations?.length
    ? v2Resolution.candidate_destinations
    : resolution.target_scope
      ? [promotionDestination(resolution.target_scope, resolution.theme)]
      : undefined;
  if (!destinations?.length) {
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: persisted V2 promotion destinations are incomplete");
  }
  return density === "deep"
    ? {
        status: "resolved",
        density,
        requested_destinations: destinations as [DexMemoriaV2Destination, ...DexMemoriaV2Destination[]],
        tags: tags as [string, ...string[]],
        owner_skill: v2Resolution.candidate_owner_skill!.trim()
      }
    : {
        status: "resolved",
        density,
        requested_destinations: destinations as [DexMemoriaV2Destination, ...DexMemoriaV2Destination[]],
        tags: tags as [string, ...string[]]
      };
}

export function promotionDestination(scope: MemoryCandidatePromoteScope, theme?: string): DexMemoriaV2Destination {
  if (scope === "global") return { scope: "global" };
  if (scope === "tema") {
    requireText(theme, "theme");
    return { scope: "theme", theme: theme!.trim() };
  }
  return { scope: "project" };
}

export function promotionScopeForDestinations(
  destinations: DexMemoriaV2Destination[]
): MemoryCandidatePromoteScope | undefined {
  if (destinations.length !== 1) return undefined;
  if (destinations[0].scope === "global") return "global";
  if (destinations[0].scope === "theme") return "tema";
  return "projeto";
}

export function promotionThemeForDestinations(destinations?: DexMemoriaV2Destination[]): string | undefined {
  if (destinations?.length !== 1 || destinations[0].scope !== "theme") return undefined;
  return destinations[0].theme;
}

export function sameCandidateResolution(existing: MemoryCandidateResolution, proposed: V2MemoryCandidateResolution): boolean {
  const current = existing as V2MemoryCandidateResolution;
  return existing.candidate_id === proposed.candidate_id
    && existing.action === proposed.action
    && existing.rationale === proposed.rationale
    && (existing.when ?? "") === (proposed.when ?? "")
    && (existing.target_scope ?? "") === (proposed.target_scope ?? "")
    && (existing.theme ?? "") === (proposed.theme ?? "")
    && JSON.stringify([...(current.candidate_tags ?? [])].sort()) === JSON.stringify([...(proposed.candidate_tags ?? [])].sort())
    && (current.candidate_density ?? "") === (proposed.candidate_density ?? "")
    && JSON.stringify(current.candidate_destinations ?? []) === JSON.stringify(proposed.candidate_destinations ?? [])
    && (current.candidate_owner_skill ?? "") === (proposed.candidate_owner_skill ?? "");
}

export function memoryWriteDecision(
  candidate: MemoryCandidate,
  writePolicy: MemoryWritePolicy,
  writtenIds: Set<string>,
  resolution?: MemoryCandidateResolution
): Record<string, unknown> {
  const written = writtenIds.has(candidate.id);
  const resolved = Boolean(resolution && isTraceableCandidateResolution(resolution));
  return {
    candidate_id: candidate.id,
    title: candidate.title,
    action: written ? "written" : resolved ? `resolved_${resolution?.action}` : memoryNonWriteAction(candidate, writePolicy, writtenIds),
    reason: written ? "written_by_auto_write_policy" : resolved ? "traceable_resolution_registered" : memoryNonWriteReason(candidate, writePolicy, writtenIds),
    scope: candidate.scope,
    score: candidate.score.total,
    editable: !written && !resolved,
    ...(resolution ? { resolution: candidateResolutionLedgerData(resolution) } : {})
  };
}

function memoryNonWriteAction(candidate: MemoryCandidate, writePolicy: MemoryWritePolicy, writtenIds: Set<string>): string {
  if (writtenIds.has(candidate.id)) {
    return "written";
  }
  if (candidate.blocked) {
    return "blocked";
  }
  if (writePolicy === "classify_only") {
    return "classify_only";
  }
  if (candidate.scope === "ledger_only") {
    return "ledger_only";
  }
  if (candidate.scope === "estacionamento") {
    return "estacionamento";
  }
  if (candidate.scope === "descartar") {
    return "descartar";
  }
  return isWritableCandidate(candidate) ? "not_written_unexpected" : "not_writable";
}

export function memoryNonWriteReason(candidate: MemoryCandidate, writePolicy: MemoryWritePolicy, writtenIds: Set<string>): string {
  if (writtenIds.has(candidate.id)) {
    return "written_by_auto_write_policy";
  }
  if (candidate.blocked) {
    return candidate.blocked_reason ?? "candidate_blocked";
  }
  if (writePolicy === "classify_only") {
    return "classify_only_policy_requires_user_review_before_write";
  }
  if (candidate.scope === "ledger_only") {
    return "ledger_only_needs_better_scope_or_destination";
  }
  if (candidate.scope === "estacionamento") {
    return "parked_for_later_decision";
  }
  if (candidate.scope === "descartar") {
    return "discard_scope_detected";
  }
  return isWritableCandidate(candidate) ? "writable_candidate_not_written" : "score_or_scope_not_writable";
}

export function memoryEditSuggestion(candidate: MemoryCandidate, writePolicy: MemoryWritePolicy): string {
  if (candidate.blocked) {
    return `corrigir bloqueio antes de gravar: ${candidate.blocked_reason}`;
  }
  if (writePolicy === "classify_only") {
    return "revisar candidato e aprovar uma rodada auto_write se for memoria canonica";
  }
  if (candidate.scope === "ledger_only") {
    return "dar destino claro: memoria, estacionamento ou descarte justificado";
  }
  if (candidate.scope === "estacionamento") {
    return "decidir se fica pendencia, vira garimpo ou deve ser descartado";
  }
  if (candidate.scope === "descartar") {
    return "confirmar descarte depois de garimpar se ha ouro";
  }
  return "melhorar gatilho L1/L2 se o candidato for util";
}

