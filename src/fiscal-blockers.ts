// Onda 5 (maratona ESCOTEIRO-ONDA, Trilho 2026-11-09-onda5-fiscal-blockers):
// politica de diagnostico de bloqueio fiscal + acoes diretas mora FORA do
// monolito — familia librarian/blocked-action/memory-mining-blocked/
// loop-escalation coesa por eixo de mudanca (SRP cap.10; maintaining cohesion
// results in many small classes). O motor fica com a avaliacao
// (evaluateFiscalPolicy) e consome o diagnostico por import.
import type {
  AnyPhase, Cooperator, Flow, GateRecord, HygieneFinding, Meeting,
  MemoryMiningSummary, MemoryCandidateResolution, Phase, PresentationEnvelope,
  StructuredLibrarianStatus,
} from "./domain.js";
import type { LoopMonitor } from "./meeting-policy.js";
import {
  inputMeetingIds, hasVerdictRecordedAfterIndex, hasClosedMeetingSatisfying,
  latestOpenMeeting, loopEscalationAction, requiredCooperationDiagnostics,
  requiredCooperationSequence, requiredCooperationStillActive,
  requiredMeetingKind, requiredMeetingParticipants, reviewRequiredSequence,
} from "./meeting-policy.js";
import {
  latestFiscalBlockEvent, MEMORY_MINING_BLOCKED_VERDICT_REASON,
  hasReviewEvidenceWithDeps, countRegressions, countHistory,
  type FiscalPolicyDeps, type FiscalPolicyResult,
} from "./verdict-fiscal-policy.js";
import {
  changedFilesMatchReview, officialGoalNeedsCanonicalVerdict,
  reviewedChangedFilesForVerdict, reviewRemainsCurrent,
} from "./gate-resolution.js";
import {
  memoryRequiredByFlow, noMemoryWasPromoted, memoryMiningRequiredSequence,
  memoryMiningCompletedWithNoCandidates, memoryPostWriteValidationBlocks,
  numericMemoryField, blockerSignature, loopWindowEvents,
  type FiscalVerdictInput,
} from "./memory/index.js";
import type {
  DexMemoriaV2CanonicalReceipt, DexMemoriaV2Destination,
  DexMemoriaV2ValidationReceiptRef,
} from "./memory/dex-memoria-v2-adapter.js";
import { FISCAL_CONFIG, graphifyRecallConfigured } from "./config.js";
import { goalStartTaughtArgs } from "./error-envelope.js";
import { profileFor } from "./phase-profile.js";
import { stringArray, unique, truthy } from "./lang-utils.js";

export type RecallVisualStatus = NonNullable<PresentationEnvelope["display"]["librarian"]>;

export type BlockerDiagnostics = {
  source: "goal_status";
  phase?: AnyPhase;
  policy: "none" | "phase_gate_requirements" | "fiscal_material_policy" | "mixed";
  fiscal_mode_active: boolean;
  gate_status: GateRecord["status"];
  gate_blockers: string[];
  fiscal_blockers: string[];
  persisted_fiscal_blockers: string[];
  memory_mining_blockers: string[];
  effective_blockers: string[];
  blocker_families: Array<{
    blocker: string;
    family: string;
    source: string[];
  }>;
  interpretation: string;
  why_fiscal_mode_not_active: string[];
  required_cooperation?: Record<string, unknown>;
  memory_required?: Record<string, unknown>;
  memory_mining?: Record<string, unknown>;
};

export type MemoryMiningV2Summary = MemoryMiningSummary & {
  memory_profile: "v2";
  estacionamento_count: number;
  v2_status: "complete" | "classify_only" | "classification_required" | "partial_pending" | "resume_pending_sibling";
  v2_ledger_status?: "pending" | "confirmed";
  v2_reconciliation_id?: string;
  v2_receipts: DexMemoriaV2CanonicalReceipt[];
  v2_validation_receipts: DexMemoriaV2ValidationReceiptRef[];
  v2_pending_destinations: Array<Record<string, unknown>>;
  v2_failures: Array<Record<string, unknown>>;
};

export type V2MemoryCandidateResolution = MemoryCandidateResolution & {
  candidate_tags?: string[];
  candidate_density?: "light" | "deep";
  candidate_destinations?: DexMemoriaV2Destination[];
  candidate_theme?: string;
  candidate_owner_skill?: string;
};

export function hasReviewEvidence(flow: Flow, input: FiscalVerdictInput): boolean {
  return hasReviewEvidenceWithDeps(flow, input, FISCAL_POLICY_DEPS);
}

export function librarianRequired(flow: Flow, input: FiscalVerdictInput): boolean {
  const text = [input.rationale, input.next_step, ...(input.residual_risks ?? [])].filter(Boolean).join("\n");
  if (librarianExplicitlyOutOfScope(flow, text)) {
    return false;
  }
  return /bibliotec|graphify|retorno visual/i.test(text);
}

export function librarianExplicitlyOutOfScope(flow: Flow, inputText: string): boolean {
  const scopeOutText = flow.scope.out.join("\n");
  const combined = [scopeOutText, inputText].filter(Boolean).join("\n");
  if (!/bibliotec|graphify|retorno visual/i.test(scopeOutText)) {
    return false;
  }
  if (!/(fora do escopo|fora de escopo|out[-_ ]?of[-_ ]?scope|p2|estacionad|rodada futura|rodada propria|nao exigid|nao requerido)/i.test(combined)) {
    return false;
  }
  return !/(obrigatorio agora|exigido agora|required now|bloqueia p1|bloquear p1|gate p1)/i.test(inputText);
}

export function hasHygieneBlocking(flow: Flow): boolean {
  const latest = [...flow.history].reverse().find((event) => event.type === "hygiene_scanned");
  return Boolean(latest && typeof latest.data.blocking_findings_count === "number" && latest.data.blocking_findings_count > 0);
}

export function hasHygieneScan(flow: Flow): boolean {
  return flow.history.some((event) => event.type === "hygiene_scanned");
}

export function hasMemoryMiningRun(flow: Flow): boolean {
  return flow.history.some((event) => event.type === "memory_mined") || Boolean(flow.memory_mining?.last_run_at);
}

export function isMaterialHygieneFinding(finding: HygieneFinding): boolean {
  return finding.severity === "warning" || finding.severity === "error";
}

export function needsReviewCoherence(flow: Flow, phase: AnyPhase, provided: Record<string, unknown>): boolean {
  const changedFilesVisible = flow.changed_files.length > 0 || stringArray(provided.changed_files).length > 0;
  if (phase !== "revisao" || !flow.goal_binding || !changedFilesVisible) {
    return false;
  }
  return (
    truthy(provided.diff_reviewed) &&
    !truthy(provided.review_artifact_path) &&
    !truthy(provided.review_findings) &&
    !hasReviewEvidence(flow, {})
  );
}

export function latestFiscalBlock(flow: Flow): Pick<FiscalPolicyResult, "blocking_reasons" | "required_cooperation"> {
  const latest = latestFiscalBlockEvent(flow);
  if (!latest) {
    return { blocking_reasons: [], required_cooperation: [] };
  }
  const verdictRecordedAfterBlock = flow.history
    .slice(latest.index + 1)
    .some((event) => event.type === "verdict_recorded");
  if (verdictRecordedAfterBlock) {
    return { blocking_reasons: [], required_cooperation: [] };
  }
  const event = latest.event;
  const required = Array.isArray(event.data.required_cooperation) ? (event.data.required_cooperation as Cooperator[]) : [];
  const blockingReasons = reconciledBlockers(flow, stringArray(event.data.blocking_reasons));
  return {
    blocking_reasons: blockingReasons,
    required_cooperation: blockingReasons.includes("required_cooperation") ? required : []
  };
}

export function reconciledBlockers(flow: Flow, blockers: string[]): string[] {
  return unique(blockers).filter((reason) => isBlockerStillActive(flow, reason));
}

export function isBlockerStillActive(flow: Flow, reason: string): boolean {
  if (reason === "required_cooperation") {
    return requiredCooperationStillActive(flow);
  }
  if (reason === "memory_required_but_empty") {
    return memoryRequiredByFlow(flow) && noMemoryWasPromoted(flow);
  }
  if (reason === MEMORY_MINING_BLOCKED_VERDICT_REASON) {
    return memoryMiningVerdictStillBlocked(flow);
  }
  if (reason === "review_required" || reason === "review_evidence_coherent") {
    return !hasReviewEvidence(flow, {});
  }
  return true;
}
export function blockerDiagnosticsFor(
  flow: Flow,
  meetings: Meeting[],
  gate: GateRecord,
  gateBlockers: string[],
  fiscal: FiscalPolicyResult,
  persistedFiscal: Pick<FiscalPolicyResult, "blocking_reasons" | "required_cooperation">,
  effectiveBlockers: string[],
  memoryMiningBlockers: string[] = []
): BlockerDiagnostics {
  const fiscalBlockers = reconciledBlockers(flow, fiscal.blocking_reasons);
  const persistedFiscalBlockers = reconciledBlockers(flow, persistedFiscal.blocking_reasons);
  const activeMemoryMiningBlockers = reconciledBlockers(flow, memoryMiningBlockers);
  const fiscalModeActive = fiscal.material || persistedFiscalBlockers.length > 0 || activeMemoryMiningBlockers.length > 0;
  const hasGateBlockers = gateBlockers.length > 0;
  const hasFiscalBlockers = fiscalBlockers.length > 0 || persistedFiscalBlockers.length > 0 || activeMemoryMiningBlockers.length > 0;
  const policy = hasGateBlockers && hasFiscalBlockers
    ? "mixed"
    : hasFiscalBlockers
      ? "fiscal_material_policy"
      : hasGateBlockers
        ? "phase_gate_requirements"
        : "none";

  const diagnostics: BlockerDiagnostics = {
    source: "goal_status",
    phase: flow.phase,
    policy,
    fiscal_mode_active: fiscalModeActive,
    gate_status: gate.status,
    gate_blockers: gateBlockers,
    fiscal_blockers: fiscalBlockers,
    persisted_fiscal_blockers: persistedFiscalBlockers,
    memory_mining_blockers: activeMemoryMiningBlockers,
    effective_blockers: effectiveBlockers,
    blocker_families: effectiveBlockers.map((blocker) => ({
      blocker,
      family: blockerFamily(blocker),
      source: blockerSources(blocker, gateBlockers, fiscalBlockers, persistedFiscalBlockers, activeMemoryMiningBlockers)
    })),
    interpretation: blockerInterpretation(policy, fiscalModeActive),
    why_fiscal_mode_not_active: fiscalModeActive ? [] : whyFiscalModeNotActive(flow)
  };
  if (effectiveBlockers.includes("required_cooperation")) {
    diagnostics.required_cooperation = requiredCooperationDiagnostics(flow, meetings, effectiveBlockers);
  }
  if (effectiveBlockers.includes("memory_required_but_empty")) {
    diagnostics.memory_required = memoryRequiredDiagnostics(flow);
  }
  if (effectiveBlockers.includes(MEMORY_MINING_BLOCKED_VERDICT_REASON)) {
    diagnostics.memory_mining = memoryMiningBlockedDiagnostics(flow);
  }
  return diagnostics;
}

export function blockerSources(
  blocker: string,
  gateBlockers: string[],
  fiscalBlockers: string[],
  persistedFiscalBlockers: string[],
  memoryMiningBlockers: string[] = []
): string[] {
  const sources: string[] = [];
  if (gateBlockers.includes(blocker)) {
    sources.push("phase_gate");
  }
  if (fiscalBlockers.includes(blocker)) {
    sources.push("current_fiscal_policy");
  }
  if (persistedFiscalBlockers.includes(blocker)) {
    sources.push("persisted_fiscal_block");
  }
  if (memoryMiningBlockers.includes(blocker)) {
    sources.push("memory_mining");
  }
  return sources;
}

export function blockerFamily(blocker: string): string {
  if (["scope_in", "scope_out", "tasks", "expected_evidence", "done_criteria"].includes(blocker)) {
    return "planning_requirement";
  }
  if (["context", "risks", "uncertainties", "goal"].includes(blocker)) {
    return "thought_requirement";
  }
  if (["implementation_done", "changed_files"].includes(blocker)) {
    return "implementation_requirement";
  }
  if (["diff_reviewed", "barata_scan", "regression_risks"].includes(blocker)) {
    return "review_requirement";
  }
  if (blocker === "test_executed") {
    return "test_requirement";
  }
  if (["verdict", "residual_risks", "next_step", "memoria_viva_reconciled"].includes(blocker)) {
    return blocker === "verdict" ? "canonical_verdict" : "validation_requirement";
  }
  if (blocker === "required_cooperation") {
    return "fiscal_cooperation";
  }
  if (blocker === "memory_required_but_empty") {
    return "fiscal_memory";
  }
  if (blocker === MEMORY_MINING_BLOCKED_VERDICT_REASON) {
    return "fiscal_memory";
  }
  if (["hygiene_blocking", "review_required", "librarian_status", "attempt_regress_count"].includes(blocker)) {
    return "fiscal_material";
  }
  return "unknown";
}

export function blockerInterpretation(policy: BlockerDiagnostics["policy"], fiscalModeActive: boolean): string {
  if (policy === "mixed") {
    return "ha requisitos de fase e bloqueios fiscais ativos; resolver ambos antes de declarar pronto";
  }
  if (policy === "fiscal_material_policy") {
    return "bloqueio vem da politica fiscal/material; nao e falta comum de campo de fase";
  }
  if (policy === "phase_gate_requirements") {
    return fiscalModeActive
      ? "bloqueio atual vem do gate de fase, embora a politica fiscal esteja em modo material sem blocker ativo"
      : "bloqueio vem de requisito do gate da fase atual; completar campos exigidos antes de avancar";
  }
  return "sem bloqueio efetivo no status atual";
}

export function whyFiscalModeNotActive(flow: Flow): string[] {
  const reasons: string[] = [];
  if (!flow.goal_binding) {
    reasons.push("flow sem goal_binding oficial");
  }
  reasons.push("sem sinal material ativo no texto, evidencias, memoria, higiene, review, regressao ou bibliotecario");
  return reasons;
}

export function memoryRequiredDiagnostics(flow: Flow): Record<string, unknown> {
  const status = flow.memory_mining;
  const candidates = Array.isArray(status?.candidates) ? status.candidates : [];
  const writtenCount = typeof status?.written_count === "number" ? status.written_count : 0;
  const candidatesCount = typeof status?.candidates_count === "number" ? status.candidates_count : 0;
  return {
    required: memoryRequiredByFlow(flow),
    mined: hasMemoryMiningRun(flow),
    last_run_at: status?.last_run_at ?? null,
    write_policy: status?.write_policy ?? null,
    written_count: writtenCount,
    memory_written: status?.memory_written === true,
    memory_validated: status?.memory_validated === true,
    memory_consolidated: status?.memory_consolidated === true,
    memory_review_status: status?.memory_review_status ?? null,
    post_write_validation: status?.memory_post_write_validation ?? null,
    candidates_count: candidatesCount,
    candidates_visible: candidates.length,
    memory_required_but_empty: noMemoryWasPromoted(flow),
    clears_when: [
      "mm_memory_mining roda no flow",
      "memory_written=true e memory_validated=true com memory_review_status pendente ou aprovado quando auto_write escreveu memoria",
      "goal_status deixa de listar memory_required_but_empty antes de novo goal_verdict positivo"
    ],
    executable_route: memoryMiningRequiredSequence(flow).slice(0, 2)
  };
}

export function memoryMiningVerdictBlockers(flow: Flow): string[] {
  return memoryMiningVerdictStillBlocked(flow) ? [MEMORY_MINING_BLOCKED_VERDICT_REASON] : [];
}

export function memoryMiningVerdictStillBlocked(flow: Flow): boolean {
  const status = flow.memory_mining;
  const postWriteBlocked = memoryPostWriteValidationBlocks(status?.memory_post_write_validation);
  if (memoryMiningCompletedWithNoCandidates(status)) {
    return false;
  }
  if (!status?.blocked_verdict && !postWriteBlocked) {
    return false;
  }
  return (
    numericMemoryField(status, "strong_unwritten_count") > 0 ||
    numericMemoryField(status, "blocked_count") > 0 ||
    status?.memory_required_but_empty === true ||
    postWriteBlocked
  );
}

export function memoryMiningBlockedDiagnostics(flow: Flow): Record<string, unknown> {
  const status = flow.memory_mining;
  const editQueue = Array.isArray(status?.edit_queue) ? status.edit_queue : [];
  const destinationWarnings = Array.isArray(status?.destination_warnings) ? status.destination_warnings.map(String) : [];
  const writeDecisions = Array.isArray(status?.write_decisions) ? status.write_decisions : [];
  return {
    blocked_verdict: status?.blocked_verdict === true,
    last_run_at: status?.last_run_at ?? null,
    write_policy: status?.write_policy ?? null,
    strong_unwritten_count: numericMemoryField(status, "strong_unwritten_count"),
    resolved_candidate_ids: Array.isArray(status?.resolved_candidate_ids) ? status.resolved_candidate_ids : [],
    resolved_strong_unwritten_count: numericMemoryField(status, "resolved_strong_unwritten_count"),
    memory_written: status?.memory_written === true,
    memory_validated: status?.memory_validated === true,
    memory_consolidated: status?.memory_consolidated === true,
    memory_review_status: status?.memory_review_status ?? null,
    post_write_validation: status?.memory_post_write_validation ?? null,
    ledger_only_count: numericMemoryField(status, "ledger_only_count"),
    blocked_count: numericMemoryField(status, "blocked_count"),
    edit_queue_count: editQueue.length,
    destination_warnings: destinationWarnings,
    write_decisions: writeDecisions,
    clears_when: [
      "candidatos fortes recebem destino claro via mm_memory_candidate_resolve: memoria, estacionamento com quando, descarte justificado ou ledger-only aceito com regra",
      "memoria auto_write passa na validacao pos-write L1<->L2/L3 com marcador PPIRTV-MM-AUTO-WRITE-REVIEW",
      "mm_memory_mining retorna blocked_verdict=false",
      "goal_status deixa de listar memory_mining_blocked_verdict antes de novo goal_verdict positivo"
    ],
    executable_route: memoryMiningBlockedSequence(flow)
  };
}

export function latestLibrarianStatus(flow: Flow): RecallVisualStatus | null {
  const eventIndex = lastIndexWhere(
    flow.history,
    (item) => item.type === "memory_recalled" || item.type === "memory_recall_reused" || item.type === "memory_hook_warning"
  );
  const event = eventIndex >= 0 ? flow.history[eventIndex] : undefined;
  if (!event) {
    return null;
  }
  const consumption = [...flow.history.slice(eventIndex + 1)].reverse().find((item) =>
    item.type === "memory_recall_consumed" && item.data.recall_phase === event.data.phase
  );
  return {
    status: statusValue(event.data.librarian_status),
    graphify_status: statusValue(event.data.graphify_status),
    warnings: stringArray(event.data.warnings ?? event.data.message),
    recalled_count: typeof event.data.recalled_count === "number" ? event.data.recalled_count : 0,
    recall_executed: event.data.recall_executed === true || (event.data.recall_executed === undefined && event.type === "memory_recalled"),
    consumption_confirmed: consumption?.data.consumption_confirmed === true,
    graphify_consumption_confirmed: consumption?.data.graphify_consumption_confirmed === true
  };
}

export function latestLibrarianStatusFromLedger(events: Array<{ type: string; data: Record<string, unknown> }>): RecallVisualStatus | null {
  const eventIndex = lastIndexWhere(
    events,
    (item) => item.type === "memory_recalled" || item.type === "memory_recall_reused" || item.type === "memory_hook_warning"
  );
  const event = eventIndex >= 0 ? events[eventIndex] : undefined;
  if (!event) {
    return null;
  }
  const consumption = [...events.slice(eventIndex + 1)].reverse().find((item) =>
    item.type === "memory_recall_consumed" && item.data.recall_phase === event.data.phase
  );
  return {
    status: statusValue(event.data.librarian_status),
    graphify_status: statusValue(event.data.graphify_status),
    warnings: stringArray(event.data.warnings ?? event.data.message),
    recalled_count: typeof event.data.recalled_count === "number" ? event.data.recalled_count : 0,
    recall_executed: event.data.recall_executed === true || (event.data.recall_executed === undefined && event.type === "memory_recalled"),
    consumption_confirmed: consumption?.data.consumption_confirmed === true,
    graphify_consumption_confirmed: consumption?.data.graphify_consumption_confirmed === true
  };
}

export function lastIndexWhere<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }
  return -1;
}

export function blockedDirectAction(blockers: string[]): { available: boolean; action: string } {
  return {
    available: true,
    action: `Bloqueado: ${blockers.join(", ")}`
  };
}

export function phaseAdvanceDirectAction(blockers: string[], nextPhase: AnyPhase): { available: boolean; action: string } {
  return {
    available: true,
    action: blockers.length > 0
      ? `Avanco de fase permitido para ${nextPhase}; pendencias fiscais de fechamento: ${blockers.join(", ")}`
      : `Avanco de fase permitido para ${nextPhase}`
  };
}

export function blockedArchiveDirectAction(blockers: string[]): { available: boolean; action: string } {
  return {
    available: true,
    action: `Arquivado com bloqueios preservados: ${blockers.join(", ")}`
  };
}

export function withDirectAction<T extends { display?: Record<string, unknown> }>(
  value: T,
  directAction: { available: boolean; action: string }
): T {
  return {
    ...value,
    display: {
      ...(value.display ?? {}),
      direct_action: directAction
    }
  };
}

export function fiscalBackTo(flow: Flow): AnyPhase {
  // Patch D (modo compact wire-up): regresso fiscal segundo o perfil do flow.
  // P3b (hardening): fallback mode-aware para nao enviar compact flow para
  // fase full-only ("pensamentos") em caso de dados corrompidos.
  const fallback = flow.mode === "compact" ? "concepcao" : "pensamentos";
  return (profileFor(flow.mode).defaultBackTo[flow.phase] as Phase | null) ?? (fallback as Phase);
}
export const MEETING_RESOLVABLE_BLOCKERS = new Set(["required_cooperation"]);
export function blockerOwner(blocker: string): string {
  if (blocker === "review_required") return "evidence_add";
  if (blocker === "memory_required_but_empty") return "mm_memory_mining";
  if (blocker === "hygiene_blocking") return "hygiene_scan";
  if (blocker === "librarian_status") return "memory_recall";
  return "unknown/unregistered";
}

export function nextRequiredActionFor(
  flow: Flow,
  meetings: Meeting[],
  blockers: string[],
  backTo: AnyPhase | null,
  regressCount: number,
  regressLimitReached: boolean,
  loopMonitor: LoopMonitor | null
): Record<string, unknown> | null {
  if (blockers.length === 0) {
    return null;
  }
  const loopAction = loopEscalationAction(flow, blockers, backTo, loopMonitor);
  if (loopAction) {
    return loopAction;
  }
  if (blockers.includes("verdict") && officialGoalNeedsCanonicalVerdict(flow)) {
    return {
      type: "goal_verdict_required",
      tool: "goal_verdict",
      reason: "validacao exige veredito canonico registrado por goal_verdict antes de completar GOAL oficial",
      other_blockers: blockers.filter((blocker) => blocker !== "verdict"),
      back_to: backTo,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      can_retry_verdict: true,
      required_tool_sequence: [
        {
          order: 1,
          tool: "goal_verdict",
          purpose: "registrar veredito canonico com evidence_ids antes de completar ou arquivar",
          args: {
            flow_id: flow.flow_id,
            status: "pronto_com_ressalvas",
            rationale: "<racional com evidencia>",
            evidence_ids: ["<evidence_id>"],
            residual_risks: ["<risco residual ou nenhum>"],
            next_step: "<proximo passo com quando>"
          }
        },
        { order: 2, tool: "goal_status", purpose: "confirmar current_verdict antes de qualquer archive", args: { flow_id: flow.flow_id } }
      ]
    };
  }
  if (regressLimitReached) {
    // Terminal por desenho (decisao do dono 2026-11-02, opcao b): o teto nao e
    // desbloqueavel por reuniao — a saida provada e encerrar com ressalva
    // registrada (veredito nao-positivo), arquivar preservando os blockers e
    // abrir flow novo carregando o aprendizado. Nunca prescrever repetir
    // goal_verdict aqui (contradizia can_retry_verdict=false).
    return {
      type: "close_flow_with_reservation",
      tool: "flow_archive",
      reason: "limite de regressos fiscal atingido: este flow e terminal por desenho; registre veredito nao-positivo documentando a ressalva, arquive preservando os blockers e abra um flow novo com o aprendizado",
      back_to: backTo,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      locked_by_limit: true,
      can_retry_verdict: false,
      required_tool_sequence: [
        {
          order: 1,
          tool: "goal_verdict",
          purpose: "registrar veredito nao-positivo documentando a ressalva do limite (positivo permanece impossivel com locked_by_limit)",
          args: {
            flow_id: flow.flow_id,
            status: "nao_pronto",
            rationale: "<ressalva: limite de regressos fiscal atingido; aprendizado do flow>",
            evidence_ids: ["<evidence_id>"],
            residual_risks: ["teto de regressoes terminal por desenho"],
            next_step: "abrir flow novo carregando o aprendizado quando <quando>"
          }
        },
        {
          order: 2,
          tool: "flow_archive",
          purpose: "encerrar o flow terminal com reason; blockers ficam preservados no historico",
          args: { flow_id: flow.flow_id, reason: "limite de regressos fiscal (teto terminal por desenho); flow novo carrega o aprendizado" }
        },
        {
          order: 3,
          tool: "goal_start",
          purpose: "abrir flow novo com o aprendizado do flow arquivado",
          args: goalStartTaughtArgs(flow.flow_id, "nova para o corte novo — nunca reusar a key do flow arquivado")
        }
      ]
    };
  }
  if (blockers.includes("required_cooperation")) {
    const cooperationDiagnostics = requiredCooperationDiagnostics(flow, meetings, blockers);
    const meetingKind = requiredMeetingKind(flow, blockers, regressLimitReached);
    const eligibleMeetingIds = stringArray(cooperationDiagnostics.eligible_meeting_ids);
    const openMeetingIds = new Set(stringArray(cooperationDiagnostics.open_meeting_ids));
    const relevantOpenMeetings = meetings.filter((meeting) => openMeetingIds.has(meeting.meeting_id));
    const openMeeting = latestOpenMeeting(relevantOpenMeetings, meetingKind) ?? latestOpenMeeting(relevantOpenMeetings);
    const missingForVerdict = stringArray(cooperationDiagnostics.missing_for_verdict);
    if (eligibleMeetingIds.length > 0 && missingForVerdict.includes("meeting_id")) {
      return {
        type: "provide_meeting_id_for_verdict",
        tool: "goal_verdict",
        reason: "required_cooperation ja tem reuniao elegivel; repetir goal_verdict informando meeting_id",
        back_to: backTo,
        eligible_meeting_ids: eligibleMeetingIds,
        required_satisfies_blockers: ["required_cooperation"],
        regress_count: regressCount,
        max_regressions: FISCAL_CONFIG.maxRegressions,
        can_retry_verdict: true,
        loop_guard: "nao abrir nova reuniao; usar um eligible_meeting_id no goal_verdict",
        required_tool_sequence: [
          {
            order: 1,
            tool: "goal_verdict",
            purpose: "repetir veredito positivo com meeting_id da reuniao que satisfez required_cooperation",
            args: {
              flow_id: flow.flow_id,
              meeting_id: eligibleMeetingIds[0],
              status: "pronto_com_ressalvas",
              rationale: "<racional com evidencia>",
              evidence_ids: ["<evidence_id>"],
              residual_risks: ["<risco residual ou nenhum>"],
              next_step: "<proximo passo com quando>"
            }
          },
          { order: 2, tool: "goal_status", purpose: "confirmar ausencia de required_cooperation", args: { flow_id: flow.flow_id } }
        ]
      };
    }
    if (blockers.includes("required_cooperation") && openMeeting) {
      return {
        type: "close_existing_meeting",
        tool: "goal_meeting_close",
        reason: "required_cooperation ja tem reuniao aberta; nao abra outra, registre turno material e feche com satisfies_blockers",
        back_to: backTo,
        meeting_id: openMeeting.meeting_id,
        meeting_kind: openMeeting.kind,
        required_participants: requiredMeetingParticipants(blockers),
        required_satisfies_blockers: ["required_cooperation"],
        regress_count: regressCount,
        max_regressions: FISCAL_CONFIG.maxRegressions,
        can_retry_verdict: false,
        loop_guard: "nao chamar goal_verdict e nao abrir nova reuniao enquanto esta reuniao aberta nao for fechada com materialidade",
        required_tool_sequence: requiredCooperationSequence(flow, openMeeting.meeting_id, openMeeting.kind, blockers, backTo, true)
      };
    }
    return {
      type: "open_meeting",
      tool: "goal_meeting_open",
      reason: blockers.includes("required_cooperation")
        ? "required_cooperation material exige reuniao/regresso rastreavel antes de novo veredito positivo"
        : `bloqueio material ainda exige reuniao ${meetingKind} antes de nova tentativa`,
      back_to: backTo,
      meeting_kind: meetingKind,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      can_retry_verdict: false,
      required_satisfies_blockers: blockers.includes("required_cooperation") ? ["required_cooperation"] : [],
      loop_guard: "execute a sequencia completa e confirme goal_status antes de repetir goal_verdict",
      required_tool_sequence: requiredCooperationSequence(flow, "<meeting_id>", meetingKind, blockers, backTo, false)
    };
  }
  if (blockers.includes("review_required")) {
    return {
      type: "attach_review",
      tool: "evidence_add",
      reason: "review_required exige review_artifact_path, review_findings ou evidencia de revisao",
      back_to: backTo,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      can_retry_verdict: false,
      loop_guard: "nao abrir nova reuniao nem repetir goal_verdict enquanto a evidencia de review nao estiver anexada e goal_status nao confirmar a remocao de review_required",
      required_tool_sequence: reviewRequiredSequence(flow)
    };
  }
  if (blockers.includes("memory_required_but_empty")) {
    return {
      type: "run_memory_mining",
      tool: "mm_memory_mining",
      reason: "memory_required_but_empty exige garimpo/classificacao de memoria antes de veredito positivo",
      back_to: backTo,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      can_retry_verdict: false,
      required_tool_sequence: memoryMiningRequiredSequence(flow)
    };
  }
  if (blockers.includes(MEMORY_MINING_BLOCKED_VERDICT_REASON)) {
    return memoryMiningBlockedAction(flow, backTo, regressCount, regressLimitReached);
  }
  return {
    type: "resolve_blockers",
    tool: "goal_gate_check",
    reason: `resolver blockers: ${blockers.join(", ")}`,
    back_to: backTo,
    regress_count: regressCount,
    max_regressions: FISCAL_CONFIG.maxRegressions,
    can_retry_verdict: false
  };
}
export function memoryMiningBlockedAction(
  flow: Flow,
  backTo: AnyPhase | null,
  regressCount: number,
  regressLimitReached: boolean
): Record<string, unknown> {
  const status = flow.memory_mining;
  return {
    type: "resolve_memory_candidates",
    tool: "mm_memory_candidate_resolve",
    reason:
      `memory_mining bloqueou veredito: strong_unwritten_count=${numericMemoryField(status, "strong_unwritten_count")}, ` +
      `ledger_only_count=${numericMemoryField(status, "ledger_only_count")}, blocked_count=${numericMemoryField(status, "blocked_count")}. ` +
      "Dar destino explicito aos candidatos antes de repetir goal_verdict.",
    back_to: backTo,
    regress_count: regressCount,
    max_regressions: FISCAL_CONFIG.maxRegressions,
    can_retry_verdict: false,
    locked_by_limit: regressLimitReached,
    candidate_resolution_options: [
      "promover para memoria L1/L2/L3 quando houver destino claro",
      "estacionar com quando/gatilho quando ainda nao for memoria canonica",
      "descartar com justificativa depois do garimpo",
      "aceitar como ledger-only nao bloqueante somente com regra e justificativa rastreaveis"
    ],
    required_tool_sequence: memoryMiningBlockedSequence(flow)
  };
}

export function memoryMiningBlockedSequence(flow: Flow): Array<Record<string, unknown>> {
  return [
    {
      order: 1,
      tool: "goal_status",
      purpose: "inspecionar memory_mining.edit_queue, write_decisions, destination_warnings e strong_unwritten_count",
      args: { flow_id: flow.flow_id }
    },
    {
      order: 2,
      tool: "mm_memory_candidate_resolve",
      purpose: "registrar destino rastreavel para cada candidato forte sem rota canonica",
      args: {
        flow_id: flow.flow_id,
        candidate_ids: ["<candidate_id>"],
        action: "promote|park|discard|accept_ledger_only",
        rationale: "<justificativa rastreavel>",
        when: "<obrigatorio se action=park>",
        target_scope: "<global|tema|projeto se action=promote>"
      },
      capture: "memory_candidate_resolution"
    },
    {
      order: 3,
      tool: "mm_memory_mining",
      purpose: "reexecutar a mineracao apos dar destino claro aos candidatos fortes sem rota canonica",
      args: { flow_id: flow.flow_id, auto_classify: true, write_policy: "auto_write" },
      capture: "memory_mining_summary"
    },
    {
      order: 4,
      tool: "goal_status",
      purpose: "confirmar que memory_mining_blocked_verdict saiu dos effective_blockers",
      args: { flow_id: flow.flow_id }
    },
    {
      order: 5,
      tool: "goal_verdict",
      purpose: "somente se goal_status nao listar memory_mining_blocked_verdict nem outros blockers efetivos",
      only_if: "goal_status.blocker_diagnostics.effective_blockers vazio",
      args: {
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        evidence_ids: ["<evidence_ids_obrigatorias>"],
        rationale: "Veredito apos candidatos fortes de memoria receberem destino rastreavel.",
        residual_risks: ["<risco residual ou nenhum>"],
        next_step: "<proximo passo com quando>"
      }
    }
  ];
}

export function blockerResolutionGuidance(
  blockers: string[],
  nextRequiredAction: Record<string, unknown> | null,
  loopMonitor: LoopMonitor | null
): Record<string, unknown> | null {
  if (blockers.length === 0 || !nextRequiredAction) {
    return null;
  }
  return {
    summary: loopMonitor?.escalation.active
      ? "loop fiscal detectado; nao repetir a mesma acao, executar escalonamento por loop_monitor"
      : "nao repetir goal_verdict enquanto can_retry_verdict=false; executar next_required_action.required_tool_sequence na ordem",
    blockers,
    loop_guard: "se required_cooperation reaparecer, verificar reuniao aberta/fechada e satisfies_blockers antes de abrir nova reuniao",
    loop_monitor: loopMonitor,
    next_required_action: nextRequiredAction
  };
}

export function fiscalLoopMonitor(flow: Flow, blockers: string[]): LoopMonitor | null {
  const activeBlockers = unique(blockers).sort();
  if (activeBlockers.length === 0) {
    return null;
  }
  const signature = blockerSignature(activeBlockers);
  const loopId = blockerLoopId(activeBlockers);
  const windowEvents = loopWindowEvents(flow, signature);
  const terminalWindowEvents = loopWindowEvents(flow, signature, false);
  const fiscalBlockCount = windowEvents.filter(
    (event) => event.type === "fiscal_policy_blocked" && String(event.data.loop_signature ?? blockerSignature(stringArray(event.data.blocking_reasons))) === signature
  ).length;
  const gateBlockCount = windowEvents.filter(
    (event) => event.type === "gate_checked" && event.data.status === "blocked" && blockerSignature(stringArray(event.data.missing)) === signature
  ).length;
  const terminalBlockCount = terminalWindowEvents.filter(
    (event) =>
      event.type === "goal_terminal_blocked" &&
      String(event.data.loop_signature ?? blockerSignature(stringArray(event.data.blocking_reasons))) === signature
  ).length;
  const reviewRegressCount = windowEvents.filter((event) => {
    if (event.type !== "phase_returned" || String(event.data.to) !== "revisao") {
      return false;
    }
    const text = [event.data.reason, ...(Array.isArray(event.data.evidence_ids) ? event.data.evidence_ids : [])].filter(Boolean).join("\n");
    return /review|revis|block|fiscal/i.test(text);
  }).length;
  const count = Math.max(fiscalBlockCount, gateBlockCount, terminalBlockCount, reviewRegressCount);
  return {
    loop_id: loopId,
    signature,
    blockers: activeBlockers,
    count,
    fiscal_block_count: fiscalBlockCount,
    gate_block_count: gateBlockCount,
    terminal_block_count: terminalBlockCount,
    review_regress_count: reviewRegressCount,
    reset_policy: "contagem considera apenas a janela desde o ultimo progresso: evidencia, reuniao fechada, memoria minerada, fase avancada, veredito ou blocker diferente; gate passado reseta loops de gate/fiscal, mas nao apaga retries terminais com a mesma assinatura",
    escalation: loopEscalationFor(count)
  };
}

export function strongestLoopMonitor(flow: Flow, ...blockerSets: string[][]): LoopMonitor | null {
  const monitors = blockerSets
    .map((blockers) => fiscalLoopMonitor(flow, blockers))
    .filter((monitor): monitor is LoopMonitor => monitor !== null);
  return monitors.reduce<LoopMonitor | null>(
    (strongest, monitor) => !strongest || monitor.count > strongest.count ? monitor : strongest,
    null
  );
}

export function loopEscalationFor(count: number): LoopMonitor["escalation"] {
  if (count >= 9) {
    return { active: true, level: "bad_loop_review_work", threshold: 9, label: "LOOP RUIM REVISAR TRABALHO" };
  }
  if (count >= 8) {
    return { active: true, level: "emergency_meeting", threshold: 8, label: "reuniao de emergencia com mais especialistas" };
  }
  if (count >= 6) {
    return { active: true, level: "research_subagent", threshold: 6, label: "acionar pesquisador organizado/subagente" };
  }
  if (count >= 5) {
    return { active: true, level: "divergence_transversal", threshold: 5, label: "reunioes divergente e transversal" };
  }
  if (count >= 3) {
    return { active: true, level: "convergence_transversal", threshold: 3, label: "reunioes convergente e transversal" };
  }
  return { active: false, level: "monitoring", threshold: null, label: "monitorando repeticao sem escalonamento" };
}

export function blockerLoopId(blockers: string[]): string {
  const token = blockerSignature(blockers)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return `loop_${token || "unknown"}`;
}

export function structuredLibrarianStatus(raw: RecallVisualStatus | null): StructuredLibrarianStatus {
  const librarianStatus = raw?.status ?? "disabled";
  const graphifyConfigured = graphifyRecallConfigured();
  const graphifyStatus = raw?.graphify_status ?? (graphifyConfigured ? "empty" : "disabled");
  const librarianFunctionalTested = raw !== null && librarianStatus !== "disabled" && (raw.recalled_count > 0 || raw.warnings.length > 0);
  const graphifyFunctionalTested =
    raw !== null && graphifyStatus !== "disabled" && (raw.recalled_count > 0 || raw.warnings.some((warning) => /graphify/i.test(warning)));
  const recallExecuted = raw?.recall_executed === true;
  const consumptionConfirmed = raw?.consumption_confirmed === true;
  const graphifyConsumptionConfirmed = raw?.graphify_consumption_confirmed === true;
  return {
    bibliotecario: {
      enabled: librarianStatus !== "disabled",
      status: librarianStatus,
      reason: raw ? librarianReason(librarianStatus) : "await_beforePhase_or_report_disabled",
      visible: true,
      functional_tested: librarianFunctionalTested,
      recall_executed: recallExecuted,
      consumption_confirmed: consumptionConfirmed
    },
    graphify: {
      enabled: graphifyConfigured || graphifyStatus !== "disabled",
      configured: graphifyConfigured,
      status: graphifyStatus,
      reason: raw ? graphifyReason(graphifyStatus) : graphifyConfigured ? "configured_awaiting_beforePhase_functional_test" : "optional_disabled_reported",
      visible: true,
      functional_tested: graphifyFunctionalTested,
      recall_executed: recallExecuted && graphifyStatus !== "disabled",
      consumption_confirmed: graphifyConsumptionConfirmed
    },
    warnings: raw?.warnings ?? [],
    recalled_count: raw?.recalled_count ?? 0,
    functional_tested: librarianFunctionalTested || graphifyFunctionalTested,
    recall_executed: recallExecuted,
    consumption_confirmed: consumptionConfirmed
  };
}

export function librarianReason(status: StructuredLibrarianStatus["bibliotecario"]["status"]): string {
  if (status === "disabled") {
    return "await_beforePhase_or_report_disabled";
  }
  if (status === "recalled") {
    return "beforePhase_recalled_memory";
  }
  if (status === "empty") {
    return "beforePhase_ran_without_recall_items";
  }
  return `beforePhase_${status}`;
}

export function graphifyReason(status: StructuredLibrarianStatus["graphify"]["status"]): string {
  if (status === "disabled") {
    return "optional_disabled_reported";
  }
  if (status === "recalled") {
    return "graphify_recalled";
  }
  if (status === "empty") {
    return "graphify_enabled_no_hits";
  }
  return `graphify_${status}`;
}


export function librarianCheckoutAccountability(librarianStatus: StructuredLibrarianStatus): Record<string, unknown> {
  const worked = librarianStatus.consumption_confirmed === true;
  const graphifyWorked = librarianStatus.graphify.consumption_confirmed === true;
  return {
    worked,
    recall_executed: librarianStatus.recall_executed,
    consumption_confirmed: librarianStatus.consumption_confirmed,
    bibliotecario_worked: librarianStatus.bibliotecario.consumption_confirmed,
    bibliotecario_recall_executed: librarianStatus.bibliotecario.recall_executed,
    graphify_worked: graphifyWorked,
    graphify_recall_executed: librarianStatus.graphify.recall_executed,
    status: librarianStatus,
    summary: worked
      ? "Consumo de recall confirmado por referencias rastreaveis"
      : librarianStatus.recall_executed
        ? "Recall executado; consumo pelo executor ainda nao confirmado"
        : `Recall nao executado; graphify=${librarianStatus.graphify.status}, bibliotecario=${librarianStatus.bibliotecario.status}`
  };
}

export function statusValue(value: unknown): RecallVisualStatus["status"] {
  const allowed = ["disabled", "recalled", "empty", "missing_graph", "timeout", "failed"] as const;
  return allowed.includes(value as RecallVisualStatus["status"]) ? (value as RecallVisualStatus["status"]) : "failed";
}

export const FISCAL_POLICY_DEPS: FiscalPolicyDeps = {
  memoryMiningBlockedReason: MEMORY_MINING_BLOCKED_VERDICT_REASON,
  maxRegressions: FISCAL_CONFIG.maxRegressions,
  hasHygieneBlocking,
  librarianRequired,
  latestLibrarianStatus,
  inputMeetingIds,
  hasVerdictRecordedAfterIndex,
  latestFiscalBlockEvent,
  hasClosedMeetingSatisfying,
  requiredCooperationStillActive,
  countRegressions,
  countHistory,
  truthy,
  stringArray,
  unique,
  changedFilesMatchReview,
  reviewedChangedFilesForVerdict,
  reviewRemainsCurrent
};
