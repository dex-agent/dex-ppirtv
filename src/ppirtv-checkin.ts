// Onda 6 (maratona ESCOTEIRO-ONDA, Trilho 2026-11-09-onda6-ppirtv-checkin):
// familia de apresentacao de status ppirtv_checkin/checkout mora FORA do
// monolito — check-in/check-out + accountability (evidence/learning/loop/
// memory/utility) + evidence-quality + work-progress coesas por eixo de
// mudanca (SRP cap.10; a apresentacao de status muda com o envelope, a
// orquestracao fica no motor). Motor consome por import.
import path from "node:path";
import { FISCAL_CONFIG, RUNTIME_ENV } from "./config.js";
import type {
  Cooperator, Evidence, EvidenceQuality, Flow, GoalEnvelope,
  MemoryMiningSummary, StructuredLibrarianStatus,
  WorkProgressEvent, WorkProgressStatus, WorkProgressSummary,
} from "./domain.js";
import {
  type BlockerDiagnostics,
  librarianCheckoutAccountability, loopEscalationFor, strongestLoopMonitor,
} from "./fiscal-blockers.js";
import { requireText, stringArray, unique } from "./lang-utils.js";
import {
  defaultWorkflow, earlySecurityProportionalityPolicy, finalReportModel,
  gateFinalOutput, operationalContractMeta, readyDefinition,
  secretEnvConsumptionPolicy,
} from "./principles.js";
import { blockerSignature } from "./memory/index.js";
import { countRegressions, countHistory } from "./verdict-fiscal-policy.js";
import { meetingOutcomeSummaries, cooperationCheckoutAccountability } from "./meeting-policy.js";
import type { RuntimeLayoutStatus } from "./store.js";

export function checkInTrailAlignment(flow: Flow): Record<string, unknown> {
  const envelope = flow.goal_binding?.envelope;
  const mcpCwd = process.cwd();
  const workspace = envelope?.workspace;
  return {
    mcp_cwd: mcpCwd,
    workspace: workspace ?? null,
    spt_path: envelope?.spt_path ?? null,
    goal: flow.goal,
    evidence_required: envelope?.evidence_required ?? false,
    required_evidence_count: envelope?.required_evidence.length ?? 0,
    cwd_matches_workspace: workspace ? path.resolve(mcpCwd) === path.resolve(workspace) : null,
    adjustment_targets: [
      "mcp_cwd",
      "workspace",
      "spt_path",
      "goal",
      "required_evidence",
      "visible_components",
      "blockers"
    ]
  };
}

export function ppirtvCheckIn(
  flow: Flow,
  requiredCooperation: Cooperator[],
  librarianStatus: StructuredLibrarianStatus,
  blockers: string[],
  resolutionGuidance: Record<string, unknown> | null = null
): Record<string, unknown> {
  const graphifyStatus = librarianStatus.graphify.status;
  const meetingRequired = blockers.includes("required_cooperation");
  const cooRequired = meetingRequired || requiredCooperation.length > 0;
  const cooVisible = requiredCooperation.length > 0 || flow.cooperators.length > 0;
  const meetingToolAvailable = true;
  const librarianGraphifyRequired = blockers.includes("librarian_status");
  const graphifyConfigured = librarianStatus.graphify.configured === true;
  const graphifyFunctionalPending =
    (librarianGraphifyRequired || graphifyConfigured) && librarianStatus.graphify.status !== "failed" && !librarianStatus.graphify.functional_tested;
  const graphifyConfigMismatch = graphifyConfigured && librarianStatus.graphify.status === "disabled";
  const librarianConfiguredButUntested =
    librarianGraphifyRequired && librarianStatus.bibliotecario.status !== "failed" && !librarianStatus.bibliotecario.functional_tested;
  const checkinBlockers = unique([
    ...blockers,
    ...(meetingRequired && !meetingToolAvailable ? ["meeting_tool_unavailable"] : []),
    ...(librarianGraphifyRequired && !librarianStatus.functional_tested ? ["librarian_or_graphify_not_functional"] : []),
    ...(graphifyConfigMismatch ? ["graphify_config_mismatch"] : []),
    ...(librarianConfiguredButUntested ? ["bibliotecario_config_mismatch"] : [])
  ]);
  const ppiRequired =
    (cooRequired && !cooVisible) ||
    librarianStatus.bibliotecario.status === "failed" ||
    librarianStatus.graphify.status === "failed" ||
    checkinBlockers.length > 0;
  return {
    phase: flow.phase,
    mode: flow.goal_binding ? (checkinBlockers.length > 0 ? "goal_fiscal_blocked" : "goal_fiscal_capable") : "advisory",
    blockers: checkinBlockers,
    meeting_required: meetingRequired,
    meeting_tool_available: meetingToolAvailable,
    regress_required: checkinBlockers.length > 0 && countRegressions(flow) < FISCAL_CONFIG.maxRegressions,
    resolution_guidance: resolutionGuidance,
    initial_adjustment_required: ppiRequired || checkinBlockers.length > 0,
    trail_alignment: checkInTrailAlignment(flow),
    components: [
      { name: "ppirtv", status: "online", visible: true, auto_repair: "already_visible" },
      {
        name: "coo",
        status: cooVisible ? "visible" : cooRequired ? "needs_visibility" : "not_required",
        visible: cooVisible,
        auto_repair: cooVisible ? "already_visible" : cooRequired ? "required_cooperation_generated" : "not_required_without_required_cooperation"
      },
      {
        name: "bibliotecario",
        status: librarianStatus.bibliotecario.status,
        visible: librarianStatus.bibliotecario.visible,
        functional_required: librarianGraphifyRequired,
        functional_tested: librarianStatus.bibliotecario.functional_tested,
        needs_adjustment: librarianGraphifyRequired && !librarianStatus.bibliotecario.functional_tested,
        auto_repair:
          librarianGraphifyRequired && !librarianStatus.bibliotecario.functional_tested
            ? "executar beforePhase/recall funcional ou corrigir configuracao antes do trabalho real"
            : librarianStatus.bibliotecario.reason
      },
      {
        name: "graphify",
        status: graphifyStatus,
        visible: librarianStatus.graphify.visible,
        configured: graphifyConfigured,
        functional_required: librarianGraphifyRequired,
        functional_tested: librarianStatus.graphify.functional_tested,
        needs_adjustment: graphifyFunctionalPending || graphifyConfigMismatch,
        auto_repair:
          graphifyFunctionalPending || graphifyConfigMismatch
            ? `validar Graphify Recall funcional ou corrigir ${RUNTIME_ENV.graphifyRecall} antes do trabalho real`
            : librarianStatus.graphify.reason
      },
      {
        name: "meeting_tools",
        status: meetingToolAvailable ? "available" : "unavailable",
        visible: meetingToolAvailable,
        auto_repair: meetingToolAvailable ? "goal_meeting_open_add_turn_close_and_goal_regress_exported" : "exportar_tools_de_reuniao_regresso"
      },
      {
        name: "ppi",
        status: ppiRequired ? "required" : "ready",
        visible: true,
        auto_repair: ppiRequired ? "acionar_ppi_para_resolver_visibilidade_ou_configuracao" : "standing_by"
      }
    ],
    ppi_action_required: ppiRequired,
    direct_action: ppiRequired
      ? `check-in bloqueado: ${checkinBlockers.join(", ")}`
      : checkinBlockers.length > 0
        ? `check-in visivel com bloqueios fiscais: ${checkinBlockers.join(", ")}`
        : "check-in visivel"
  };
}

// BUG 5 (detail compact): helper para omitir arrays grandes do checkout
// quando detail=compact. Mantem contagem para preservar sinal diagnostico.
export function compactPpirtvCheckout(checkout: Record<string, unknown>, detail: "compact" | "full"): Record<string, unknown> {
  if (detail !== "compact") {
    return checkout;
  }
  const prestacao = checkout.prestacao_de_contas;
  // prestacao_de_contas pode ser array (legado) ou objeto com chaves
  // (utilidade, memoria, evidencias, etc.). Contar de forma compativel.
  const prestacaoCount = Array.isArray(prestacao)
    ? prestacao.length
    : (prestacao && typeof prestacao === "object" ? Object.keys(prestacao).length : 0);
  const meetingAccountability = checkout.meeting_outcome_accountability as Record<string, unknown> | undefined;
  const compactMeetingAccountability = meetingAccountability
    ? Object.fromEntries(Object.entries(meetingAccountability).filter(([key]) => key !== "outcomes"))
    : undefined;
  const { prestacao_de_contas, ready_definition, gate_final_output, final_report_model, ...rest } = checkout;
  return {
    ...rest,
    meeting_outcome_accountability: compactMeetingAccountability,
    prestacao_de_contas_count: prestacaoCount
  };
}

export function ppirtvCheckOut(
  flow: Flow,
  librarianStatus: StructuredLibrarianStatus,
  blockers: string[],
  resolutionGuidance: Record<string, unknown> | null = null,
  blockerDiagnostics: BlockerDiagnostics | null = null,
  runtimeLayoutStatus: RuntimeLayoutStatus | null = null,
  phaseState: {
    phase_blockers: string[];
    closure_blockers: string[];
    phase_advance_allowed: boolean;
  } = { phase_blockers: [], closure_blockers: [], phase_advance_allowed: false }
): Record<string, unknown> {
  const latestVerdict = flow.verdicts.at(-1);
  const closed = flow.status === "complete" || flow.status === "archived";
  const memoryMining = memoryMiningStatus(flow);
  const memoryAccountability = memoryCheckoutAccountability(flow, memoryMining);
  const learningAccountability = learningCheckoutAccountability(flow);
  const cooperationAccountability = cooperationCheckoutAccountability(flow);
  const librarianAccountability = librarianCheckoutAccountability(librarianStatus);
  const loopAccountability = loopCheckoutAccountability(flow, blockers);
  const evidenceAccountability = evidenceCheckoutAccountability(flow);
  const meetingOutcomes = meetingOutcomeSummaries(flow);
  const meetingOutcomeAccountability = {
    outcomes: meetingOutcomes,
    consumed_count: meetingOutcomes.filter((item) => item.consumed === true).length,
    closed_unconsumed_count: meetingOutcomes.filter((item) => item.traceability_status === "closed_unconsumed").length,
    unattributed_legacy_count: meetingOutcomes.filter((item) => item.traceability_status === "unattributed_legacy").length,
    semantic_effectiveness: "not_measured",
    rule: "traceable downstream consumption is measurable; semantic effectiveness requires independent product evidence"
  };
  const contractAccountability = {
    ...operationalContractMeta(),
    ready_definition: readyDefinition(),
    gate_final_output: gateFinalOutput(),
    final_report_model: finalReportModel(),
    default_workflow: defaultWorkflow(),
    secret_env_consumption_policy: secretEnvConsumptionPolicy(),
    early_security_proportionality_policy: earlySecurityProportionalityPolicy()
  };
  const utilityAccountability = utilityCheckoutAccountability({
    flow,
    memory: memoryAccountability,
    learning: learningAccountability,
    cooperation: cooperationAccountability,
    librarian: librarianAccountability,
    loop: loopAccountability
  });
  return {
    complete: closed,
    status: flow.status,
    phase_blockers: phaseState.phase_blockers,
    closure_blockers: phaseState.closure_blockers,
    phase_advance_allowed: phaseState.phase_advance_allowed,
    verdict: latestVerdict?.status ?? null,
    project_root: runtimeLayoutStatus?.project_root ?? null,
    ppirtv_home: runtimeLayoutStatus?.ppirtv_home ?? null,
    runtime_layout_status: runtimeLayoutStatus,
    meetings_count: flow.meetings.length,
    meeting_outcome_accountability: meetingOutcomeAccountability,
    evidence_count: flow.evidence.length,
    evidence_accountability: evidenceAccountability,
    review_visible: flow.evidence.some((evidence) => /review|revisor|diff/i.test([evidence.kind, evidence.title, evidence.note, evidence.content].filter(Boolean).join("\n"))),
    tests_visible: flow.evidence.some((evidence) => /test|teste|vitest|npm run check/i.test([evidence.kind, evidence.title, evidence.note, evidence.content].filter(Boolean).join("\n"))),
    garimpo_count: flow.gold_mining.length,
    estacionamento_count: flow.parking_lot.length,
    memory_mining: memoryMining,
    librarian_status: librarianStatus,
    memory_accountability: memoryAccountability,
    learning_accountability: learningAccountability,
    cooperation_accountability: cooperationAccountability,
    librarian_accountability: librarianAccountability,
    work_progress: workProgressSummary(flow),
    loop_accountability: loopAccountability,
    contract_accountability: contractAccountability,
    ready_definition: contractAccountability.ready_definition,
    gate_final_output: contractAccountability.gate_final_output,
    final_report_model: contractAccountability.final_report_model,
    default_workflow: contractAccountability.default_workflow,
    utility_accountability: utilityAccountability,
    prestacao_de_contas: {
      utilidade: utilityAccountability,
      memoria: memoryAccountability,
      evidencias: evidenceAccountability,
      garimpo: learningAccountability.garimpado,
      estacionamento: learningAccountability.estacionado,
      pontos_cegos: learningAccountability.pontos_cegos,
      cooperadores: cooperationAccountability,
      reunioes: meetingOutcomeAccountability,
      bibliotecario: librarianAccountability,
      loops: loopAccountability,
      contrato_operacional: contractAccountability
    },
    residual_risks: latestVerdict?.residual_risks ?? [],
    resolution_guidance: resolutionGuidance,
    blocker_diagnostics: blockerDiagnostics,
    direct_action: blockers.length > 0
      ? `check-out bloqueado: ${blockers.join(", ")}; executar resolution_guidance.next_required_action antes de veredito positivo`
      : closed
        ? "fechamento_total_registrado"
        : "check-out pendente ate veredito/arquivo"
  };
}

export function evidenceCheckoutAccountability(flow: Flow): Record<string, unknown> {
  const items = flow.evidence.map((evidence) => ({
    evidence_id: evidence.evidence_id,
    title: evidence.title,
    kind: evidence.kind,
    quality: classifyEvidenceQuality(evidence)
  }));
  const weakCount = items.filter((item) => item.quality.status === "weak").length;
  const missingContextCount = items.filter((item) => item.quality.status === "missing_context").length;
  const strongCount = items.filter((item) => item.quality.status === "strong").length;
  return {
    total: items.length,
    strong_count: strongCount,
    weak_count: weakCount,
    missing_context_count: missingContextCount,
    legacy_unclassified_count: items.filter((item) => item.quality.status === "legacy_unclassified").length,
    blocks_ready: items.some((item) => item.quality.blocking),
    policy: "aditivo: evidencia fraca e visivel como WARN; nao bloqueia legado neste corte",
    items
  };
}

export function classifyEvidenceQuality(evidence: Evidence): EvidenceQuality {
  if (!evidence.created_at) {
    return {
      status: "legacy_unclassified",
      blocking: false,
      reasons: ["evidencia legada sem metadados suficientes para classificacao forte"],
      missing_fields: []
    };
  }
  const text = [evidence.kind, evidence.title, evidence.uri, evidence.content, evidence.note, ...evidence.gold_mining].filter(Boolean).join("\n");
  const checks = {
    origin: /origem|origin|source/i.test(text),
    objective: /objetivo|objective|goal/i.test(text),
    phase: /fase|phase|pensamentos|planejamento|implementacao|revisao|teste|validacao/i.test(text),
    procedure: /procedimento|procedure|comando|command|npm|vitest|teste|test/i.test(text),
    observed_result: /resultado|result|observado|observed|pass|passed|fail|failed|falh/i.test(text),
    limitation: /limitacao|limitação|limitation|risco|ressalva|residual/i.test(text),
    flow_reference: Boolean(evidence.flow_id)
  };
  const missingFields = Object.entries(checks)
    .filter(([, checked]) => !checked)
    .map(([field]) => field);
  const hasTrace = Boolean(evidence.uri || evidence.content || evidence.note || evidence.gold_mining.length > 0);
  const status = !hasTrace || missingFields.length >= 4 ? "weak" : missingFields.length <= 1 ? "strong" : "missing_context";
  return {
    status,
    blocking: false,
    reasons: evidenceQualityReasons(status, hasTrace, missingFields),
    missing_fields: missingFields
  };
}

export function evidenceQualityReasons(status: EvidenceQuality["status"], hasTrace: boolean, missingFields: string[]): string[] {
  const reasons: string[] = [];
  if (!hasTrace) {
    reasons.push("sem conteudo, nota, uri ou satisfacao rastreavel");
  }
  if (missingFields.length > 0) {
    reasons.push(`campos ausentes: ${missingFields.join(", ")}`);
  }
  if (status === "strong") {
    reasons.push("evidencia contem contexto operacional suficiente para auditoria inicial");
  }
  return reasons;
}

export function goalEvidenceMetadataNote(flow: Flow, input: { title: string; content?: string; uri?: string; note?: string }): string | undefined {
  if (!input.content && !input.uri && !input.note) {
    return undefined;
  }
  return [
    "Metadados PPIRTV:",
    "Origem: evidence_add.",
    "Objetivo: declarado no GoalEnvelope/flow.",
    `Fase: ${flow.phase}.`,
    `Procedimento: ${input.title}.`,
    "Limitacao: nao informada pelo operador; revisar risco residual no veredito."
  ].join(" ");
}

export function mergeEvidenceNotes(note: string | undefined, metadata: string | undefined): string | undefined {
  return [note, metadata].filter(Boolean).join("\n") || undefined;
}

const FUTURE_ACTION_PATTERN = /\b(resolv|corrig|implement|valid|revis|test|cri|abr|execut|fa[cz]|ajust|migr|refator|document|submet|envia|public|deploy|build|compil|rodar?|investig|diagnostic|analis|medir|monitor|otimiz|limp|remove|substitu|atualiz|configur|instal|deslig|liga)\w*\b|depois|mais tarde|futuro|pr[oó]ximo|em breve|oportunamente|quando der|abrir issue|criar PR|submeter PR|ver iss|olhar iss|pensar em/i;
const QUANDO_INDICATOR = /\b(202[0-9]|20[3-9][0-9]|janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|semana que vem|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|quando|ao receber|assim que|no momento em que|semanalmente|diariamente|a cada|todo dia|toda semana|depende de|bloqueado por|revisar em|validar ap[óo]s|daqui a|vence|prazo|at[ée] |respons[áa]vel|gatilho|cad[êe]ncia|janela de|condi[çc][ãa]o de|crit[ée]rio de|desbloquead|retomad)/i;

export function hasFutureAction(text: string): boolean {
  return FUTURE_ACTION_PATTERN.test(text);
}

export function hasQuando(text: string): boolean {
  return QUANDO_INDICATOR.test(text);
}

export function missingQuandoGate(nextStep: string): string | null {
  if (!nextStep || !hasFutureAction(nextStep)) {
    return null;
  }
  if (hasQuando(nextStep)) {
    return null;
  }
  return "Gate do Quando: next_step promete acao futura sem quando verificavel (data, gatilho, cadencia, condicao, janela, vencimento, dependencia ou responsavel). Veredito rebaixado para pronto_com_ressalvas.";
}


export function utilityCheckoutAccountability(input: {
  flow: Flow;
  memory: Record<string, unknown>;
  learning: Record<string, unknown>;
  cooperation: Record<string, unknown>;
  librarian: Record<string, unknown>;
  loop: Record<string, unknown>;
}): Record<string, unknown> {
  const memoryEditQueue = Array.isArray(input.memory.edit_queue) ? (input.memory.edit_queue as Array<Record<string, unknown>>) : [];
  const warnings = Array.isArray(input.memory.destination_warnings) ? input.memory.destination_warnings.map(String) : [];
  const garimpado = stringArray(input.learning.garimpado);
  const estacionado = stringArray(input.learning.estacionado);
  const pontosCegos = stringArray(input.learning.pontos_cegos);
  const materialCount = typeof input.cooperation.material_count === "number" ? input.cooperation.material_count : 0;
  const worked = input.librarian.worked === true;
  const loopCurrent = input.loop.current as Record<string, unknown> | null;
  const loopCount = typeof loopCurrent?.count === "number" ? loopCurrent.count : 0;
  const loopLevel = typeof loopCurrent?.escalation === "object" && loopCurrent.escalation
    ? String((loopCurrent.escalation as Record<string, unknown>).level ?? "none")
    : "none";
  return {
    painel: [
      `M memoria: candidates=${input.memory.candidates_count ?? 0}, written=${input.memory.written_count ?? 0}, editaveis=${memoryEditQueue.length}`,
      `G garimpo: ${garimpado.length}`,
      `E estacionamento: ${estacionado.length}`,
      `P pontos_cegos: ${pontosCegos.length}`,
      `C cooperadores_materiais: ${materialCount}`,
      `B bibliotecario_graphify: ${worked ? "worked" : "not_confirmed"}`,
      `L loops: atual=${loopCount}, nivel=${loopLevel}`
    ],
    edit_queue_count: memoryEditQueue.length,
    edit_queue_sample: memoryEditQueue.slice(0, 8),
    warnings,
    samples: {
      garimpado: garimpado.slice(0, 8),
      estacionamento: estacionado.slice(0, 8),
      pontos_cegos: pontosCegos.slice(0, 8)
    },
    next_use:
      memoryEditQueue.length > 0
        ? "revisar edit_queue antes de nova auto_write ou promocao L1/L2"
        : warnings.length > 0
          ? "resolver destination_warnings antes de positivo"
          : "checkout tem prestacao de contas consultavel para retomada"
  };
}

export function loopCheckoutAccountability(flow: Flow, blockers: string[]): Record<string, unknown> {
  const phaseGate = flow.gates[flow.phase];
  const phaseBlockers = phaseGate?.status === "blocked" ? phaseGate.missing : [];
  const current = strongestLoopMonitor(flow, phaseBlockers, blockers);
  const gateChecks = flow.history.filter((event) => event.type === "gate_checked");
  const blockedGateChecks = gateChecks.filter((event) => event.data.status === "blocked");
  const gateBlocksBySignature = countBySignature(
    blockedGateChecks.map((event) => blockerSignature(stringArray(event.data.missing)))
  );
  const fiscalBlocks = flow.history.filter((event) => event.type === "fiscal_policy_blocked");
  const fiscalBlocksBySignature = countBySignature(
    fiscalBlocks.map((event) => String(event.data.loop_signature ?? blockerSignature(stringArray(event.data.blocking_reasons))))
  );
  const loopMeetingIds = new Set<string>();
  for (const event of flow.history.filter((item) => item.type === "meeting_opened" || item.type === "meeting_turn_added" || item.type === "meeting_closed")) {
    const data = event.data;
    const text = [
      data.question,
      data.decision,
      ...stringArray(data.finding),
      ...stringArray(data.note),
      ...stringArray(data.findings),
      ...stringArray(data.questions),
      ...stringArray(data.decisions)
    ].filter(Boolean).join("\n");
    if (/loop_|LOOP RUIM|repetiu \d+ vezes|emergencia/i.test(text)) {
      const meetingId = typeof data.meeting_id === "string" ? data.meeting_id : null;
      if (meetingId) {
        loopMeetingIds.add(meetingId);
      }
    }
  }
  const researchEvidence = flow.evidence.filter((evidence) => /research|pesquisa/i.test([evidence.kind, evidence.title, evidence.note, evidence.content].filter(Boolean).join("\n")));
  const badLoopEvidence = flow.evidence.filter((evidence) => /bad_loop|LOOP RUIM REVISAR TRABALHO/i.test([evidence.kind, evidence.title, evidence.note, evidence.content].filter(Boolean).join("\n")));
  return {
    current,
    current_loop_id: current?.loop_id ?? null,
    current_count: current?.count ?? 0,
    current_escalation: current?.escalation ?? loopEscalationFor(0),
    regress_count: countRegressions(flow),
    phase_returned_count: countHistory(flow, "phase_returned"),
    reported_regress_count: Math.max(0, ...flow.history
      .filter((event) => event.type === "regress_count_reported" && typeof event.data.regress_count === "number")
      .map((event) => event.data.regress_count as number)),
    gate_checks_count: gateChecks.length,
    blocked_gate_checks_count: blockedGateChecks.length,
    blocked_gate_checks_by_signature: gateBlocksBySignature,
    fiscal_blocks_count: fiscalBlocks.length,
    fiscal_blocks_by_signature: fiscalBlocksBySignature,
    loop_meetings_count: loopMeetingIds.size,
    loop_meeting_ids: [...loopMeetingIds],
    research_reports_count: researchEvidence.length,
    research_evidence_ids: researchEvidence.map((evidence) => evidence.evidence_id),
    bad_loop_reports_count: badLoopEvidence.length,
    bad_loop_evidence_ids: badLoopEvidence.map((evidence) => evidence.evidence_id),
    organized_recovery_ladder: [
      { count: 3, action: "reuniao_convergente_transversal" },
      { count: 5, action: "reuniao_divergente_transversal" },
      { count: 6, action: "pesquisador_organizado_subagente" },
      { count: 8, action: "reuniao_emergencia_especialistas" },
      { count: 9, action: "estacionamento_garimpeiro_loop_ruim_revisar_trabalho" }
    ],
    reset_policy: current?.reset_policy ?? "contagem zera quando ha progresso: evidencia, reuniao fechada, memoria minerada, gate passado, fase avancada, veredito ou blocker diferente",
    summary: current
      ? `loop atual ${current.loop_id}: count=${current.count}, gate=${current.gate_block_count}, fiscal=${current.fiscal_block_count}, regress=${current.review_regress_count}, escalonamento=${current.escalation.level}`
      : "sem loop ativo no checkout"
  };
}

function countBySignature(signatures: string[]): Array<{ signature: string; count: number }> {
  const counts = new Map<string, number>();
  for (const signature of signatures.filter(Boolean)) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([signature, count]) => ({ signature, count }))
    .sort((left, right) => right.count - left.count || left.signature.localeCompare(right.signature));
}

export function memoryCheckoutAccountability(flow: Flow, memoryMining: MemoryMiningSummary): Record<string, unknown> {
  const raw = (flow.memory_mining ?? {}) as Record<string, unknown>;
  const written = Array.isArray(raw.written) ? (raw.written as Array<Record<string, unknown>>) : [];
  const candidates = Array.isArray(raw.candidates) ? (raw.candidates as Array<Record<string, unknown>>) : [];
  const writeDecisions = Array.isArray(raw.write_decisions) ? (raw.write_decisions as Array<Record<string, unknown>>) : [];
  const editQueue = Array.isArray(raw.edit_queue) ? (raw.edit_queue as Array<Record<string, unknown>>) : [];
  const destinationWarnings = Array.isArray(raw.destination_warnings) ? raw.destination_warnings.map(String) : [];
  const writtenFiles = unique(written.flatMap((item) => stringArray(item.files)));
  const layers = memoryLayersFromFiles(writtenFiles);
  return {
    required: memoryMining.required,
    mined: Boolean(memoryMining.last_run_at),
    last_run_at: memoryMining.last_run_at ?? null,
    write_policy: memoryMining.write_policy ?? null,
    written_count: memoryMining.written_count,
    candidates_count: memoryMining.candidates_count,
    blocked_count: memoryMining.blocked_count,
    ledger_only_count: memoryMining.ledger_only_count,
    discarded_count: memoryMining.discarded_count,
    estacionamento_count: memoryMining.estacionamento?.length ?? 0,
    strong_unwritten_count: memoryMining.strong_unwritten_count ?? 0,
    memory_written: memoryMining.memory_written === true,
    memory_validated: memoryMining.memory_validated === true,
    memory_consolidated: memoryMining.memory_consolidated === true,
    memory_review_status: memoryMining.memory_review_status ?? null,
    memory_post_write_validation: memoryMining.memory_post_write_validation ?? null,
    memory_required_but_empty: memoryMining.memory_required_but_empty === true,
    written,
    candidates,
    write_decisions: writeDecisions,
    edit_queue: editQueue,
    destination_warnings: destinationWarnings,
    layers,
    l1_files: layers.L1,
    l2_files: layers.L2,
    l3_files: layers.L3,
    summary:
      memoryMining.memory_consolidated === true
        ? `memoria consolidada: L1=${layers.L1.length}, L2=${layers.L2.length}, L3=${layers.L3.length}`
        : memoryMining.memory_review_status === "pending_consciencia_memorias"
          ? `memoria gravada e validada estruturalmente; revisao consciencia-memorias pendente: L1=${layers.L1.length}, L2=${layers.L2.length}, L3=${layers.L3.length}`
        : memoryMining.memory_validated === true
          ? `memoria gravada e validada: L1=${layers.L1.length}, L2=${layers.L2.length}, L3=${layers.L3.length}`
        : memoryMining.written_count > 0
          ? `memoria gravada, aguardando/pendente de validacao: L1=${layers.L1.length}, L2=${layers.L2.length}, L3=${layers.L3.length}`
        : memoryMining.candidates_count > 0
          ? "memoria classificada sem escrita canonica neste checkout"
          : memoryMining.required && memoryMining.last_run_at
            ? "mineracao executada; nenhum candidato de memoria encontrado"
            : memoryMining.required
              ? "memoria exigida, mas nenhum candidato gravado/classificado"
              : "memoria nao exigida neste flow"
  };
}

function memoryLayersFromFiles(files: string[]): Record<"L1" | "L2" | "L3" | "other", string[]> {
  const layers: Record<"L1" | "L2" | "L3" | "other", string[]> = { L1: [], L2: [], L3: [], other: [] };
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    if (/\/?LEMBRANCA\.md$/i.test(normalized) || /\/?lembranca\.md$/i.test(normalized)) {
      layers.L1.push(file);
    } else if (/\/?MEMORIA\.md$/i.test(normalized) || /\/?memoria\.md$/i.test(normalized) || /\/memorias\/[^/]+\.md$/i.test(normalized)) {
      layers.L2.push(file);
    } else if (/\/conhecimento\//i.test(normalized) || /\/L3\//i.test(normalized)) {
      layers.L3.push(file);
    } else {
      layers.other.push(file);
    }
  }
  return layers;
}

export function learningCheckoutAccountability(flow: Flow): Record<string, unknown> {
  const pontosCegos = unique([
    ...flow.gold_mining.filter((item) => /ponto cego|premissa|ocult|ambig|incert/i.test(item)),
    ...flow.parking_lot.filter((item) => /ponto cego|premissa|ocult|ambig|incert/i.test(item)),
    ...flow.goal_learning_links
      .filter((link) => link.garimpo_vinculado.classificacao === "ponto_cego")
      .map((link) => link.garimpo_vinculado.pepita ?? link.parking_item)
  ]);
  const garimpoPorClasse = flow.goal_learning_links.reduce<Record<string, number>>((acc, link) => {
    const key = link.garimpo_vinculado.classificacao;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const conviccaoFraca = flow.goal_learning_links
    .filter((link) => link.garimpo_vinculado.classificacao === "nao_promover")
    .map((link) => link.parking_item);
  return {
    garimpado: flow.gold_mining,
    estacionado: flow.parking_lot,
    pontos_cegos: pontosCegos,
    links: flow.goal_learning_links,
    garimpo_por_classificacao: garimpoPorClasse,
    conviccao_fraca_ou_frouxa: conviccaoFraca,
    garimpo_count: flow.gold_mining.length,
    estacionamento_count: flow.parking_lot.length,
    pontos_cegos_count: pontosCegos.length,
    conviccao_fraca_count: conviccaoFraca.length
  };
}

export function progressText(value: string, maxLength: number, field: string): string {
  requireText(value, field);
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function validateProgressNumbers(current: number, total: number, status: WorkProgressStatus): void {
  if (!Number.isInteger(total) || total <= 0) {
    throw new Error("PROGRESS_TOTAL_INVALID: total must be a positive integer");
  }
  if (!Number.isInteger(current) || current < 0 || current > total) {
    throw new Error("PROGRESS_CURRENT_INVALID: current must be an integer between zero and total");
  }
  if (status === "completed" && current !== total) {
    throw new Error("PROGRESS_COMPLETED_INCOMPLETE: completed progress requires current=total");
  }
}

export function workProgressEvents(flow: Flow): WorkProgressEvent[] {
  return flow.history
    .filter((event) => event.type === "work_progress_recorded")
    .map((event) => event.data as unknown as WorkProgressEvent)
    .filter((event) =>
      typeof event.progress_id === "string" &&
      typeof event.event_key === "string" &&
      typeof event.source === "string" &&
      typeof event.operation === "string" &&
      typeof event.stage === "string" &&
      typeof event.current === "number" &&
      typeof event.total === "number" &&
      typeof event.percent === "number" &&
      ["queued", "running", "completed", "failed"].includes(event.status)
    );
}

export function workProgressSummary(flow: Flow): WorkProgressSummary {
  const events = workProgressEvents(flow);
  return {
    event_count: events.length,
    operations_count: new Set(events.map((event) => `${event.source}\u0000${event.operation}`)).size,
    last: events.at(-1) ?? null
  };
}


export function memoryMiningStatus(flow: Flow): MemoryMiningSummary {
  return (
    flow.memory_mining ?? {
      required: flow.gold_mining.length > 0 || flow.parking_lot.length > 0 || flow.goal_learning_links.length > 0,
      blocked_verdict: false,
      candidates_count: 0,
      written_count: 0,
      blocked_count: 0,
      ledger_only_count: 0,
      discarded_count: 0,
      estacionamento: [],
      write_decisions: [],
      edit_queue: [],
      destination_warnings: [],
      strong_unwritten_count: 0,
      resolved_candidate_ids: [],
      resolved_strong_unwritten_count: 0,
      candidate_resolutions: flow.memory_candidate_resolutions ?? [],
      memory_written: false,
      memory_validated: false,
      memory_consolidated: false,
      memory_review_status: "not_required",
      memory_post_write_validation: {
        required: false,
        status: "not_required",
        validator: "consciencia-memorias-post-write",
        touched_files: [],
        l1_files: [],
        l2_files: [],
        l3_files: [],
        checked_triggers: [],
        recall_proof: [],
        findings: [],
        parking_lot: [],
        commands_required: []
      }
    }
  );
}

