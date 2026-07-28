export const PHASES = [
  "pensamentos",
  "planejamento",
  "implementacao",
  "revisao",
  "teste",
  "validacao"
] as const;

export type Phase = (typeof PHASES)[number];

export const COMPACT_PHASES = [
  "concepcao",
  "implementacao",
  "revisao",
  "validacao"
] as const;

export type CompactPhase = (typeof COMPACT_PHASES)[number];

export type AnyPhase = Phase | CompactPhase;

export type PhaseMode = "full" | "compact";
export type GoalModeInput = PhaseMode | "lean";

export const MEETING_TYPES = ["divergent", "convergent", "transversal", "decision"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export const MEETING_KINDS = ["divergente", "convergente", "transversal", "decisao"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export const VERDICTS = ["pronto", "pronto_com_ressalvas", "nao_pronto", "bloqueado"] as const;
export type VerdictStatus = (typeof VERDICTS)[number];

export const GOAL_VERDICT_POLICIES = ["evidence_required", "allow_ressalvas", "draft"] as const;
export type GoalVerdictPolicy = (typeof GOAL_VERDICT_POLICIES)[number];
export const GOAL_FLOW_ROLES = ["execution", "reconciliation", "recovery"] as const;
export type GoalFlowRole = (typeof GOAL_FLOW_ROLES)[number];

export type RiskLevel = "high" | "medium" | "low" | "mechanical";

export type GoalEnvelope = {
  workspace: string;
  spt_path: string;
  objective: string;
  flow_id?: string;
  idempotency_key: string;
  evidence_required: boolean;
  required_evidence: string[];
  requested_verdict_policy: GoalVerdictPolicy;
  source: string;
  risk_level?: RiskLevel;
  mode?: GoalModeInput;
  flow_role?: GoalFlowRole;
};

export type GoalBindingEnvelope = Omit<GoalEnvelope, "flow_role">;

export type GoalBinding = {
  envelope: GoalBindingEnvelope;
  flow_role?: GoalFlowRole;
  goal_id?: string;
  spt_contract_fingerprint?: string;
  spt_document_sha256_at_start?: string;
  started_at: string;
  last_seen_at: string;
};

export type SptV2Contract = {
  dex_contract: "spt";
  version: 2;
  status: string;
  owner: string;
  date: string;
  workspace: string;
  origin: string;
  goal: {
    id: string;
    title: string;
    objective: string;
  };
  context: string;
  problem: string;
  decision: string;
  scope: {
    include: string[];
    exclude: string[];
  };
  spec: string;
  plan: string[];
  tasks: string[];
  expected_evidence: string[];
  done_criteria: string[];
  risks: string[];
  uncertainties: string[];
  gates: string[];
  validation: string[];
  execution_prompt: string;
};

export type SptValidationResult = {
  valid: boolean;
  workspace: string;
  spt_path: string;
  contract_version: 2 | null;
  goal_id: string | null;
  contract_fingerprint: string | null;
  document_sha256: string | null;
  checks: Record<string, boolean>;
  contract_errors: string[];
  missing: string[];
  warnings: string[];
  risks: string[];
  tasks: string[];
  expected_evidence: string[];
  done_criteria: string[];
  next_step: string;
};

export const MEMORY_WRITE_POLICIES = ["auto_write", "classify_only"] as const;
export type MemoryWritePolicy = (typeof MEMORY_WRITE_POLICIES)[number];

export type MemoryCandidateScope = "global" | "tema" | "projeto" | "ledger_only" | "estacionamento" | "descartar";
export type MemoryCandidateLayer = "L1" | "L2" | "L3";
export const MEMORY_CANDIDATE_RESOLUTION_ACTIONS = ["promote", "park", "discard", "accept_ledger_only"] as const;
export type MemoryCandidateResolutionAction = (typeof MEMORY_CANDIDATE_RESOLUTION_ACTIONS)[number];
export const MEMORY_CANDIDATE_PROMOTE_SCOPES = ["global", "tema", "projeto"] as const;
export type MemoryCandidatePromoteScope = (typeof MEMORY_CANDIDATE_PROMOTE_SCOPES)[number];

export type MemoryCandidate = {
  id: string;
  title: string;
  source: "gold_mining" | "parking_lot";
  scope: MemoryCandidateScope;
  theme?: string;
  layer: MemoryCandidateLayer;
  has_l1: boolean;
  score: {
    reaproveitamento: number;
    evidencia: number;
    custo_esquecimento: number;
    transferibilidade: number;
    total: number;
  };
  confidence: "baixa" | "media" | "alta";
  l1_gatilho: string;
  l2_bloco: string;
  l3_bloco?: string;
  l3_index_entry?: string;
  target_files: string[];
  blocked: boolean;
  blocked_reason: string | null;
};

export type MemoryCandidateResolution = {
  resolution_id: string;
  candidate_id: string;
  action: MemoryCandidateResolutionAction;
  rationale: string;
  when?: string;
  target_scope?: MemoryCandidatePromoteScope;
  theme?: string;
  candidate_title?: string;
  candidate_scope?: MemoryCandidateScope;
  candidate_score?: number;
  traceable: boolean;
  created_at: string;
  source: "mm_memory_candidate_resolve";
};

export type MemoryPostWriteValidationFinding = {
  code: string;
  message: string;
  file?: string;
  line?: number;
  candidate_id?: string;
};

export type MemoryPostWriteValidation = {
  required: boolean;
  status: "not_required" | "passed" | "failed";
  validator: "consciencia-memorias-post-write";
  validated_at?: string;
  evidence_id?: string;
  touched_files: string[];
  l1_files: string[];
  l2_files: string[];
  l3_files: string[];
  checked_triggers: string[];
  recall_proof: Array<Record<string, unknown>>;
  findings: MemoryPostWriteValidationFinding[];
  parking_lot: string[];
  commands_required: string[];
};

export type MemoryReviewStatus =
  | "not_required"
  | "pending_consciencia_memorias"
  | "approved"
  | "rejected"
  | "failed_post_write_validation";

export type MemoryMiningSummary = {
  required: boolean;
  last_run_at?: string;
  write_policy?: MemoryWritePolicy;
  blocked_verdict: boolean;
  candidates_count: number;
  written_count: number;
  blocked_count: number;
  ledger_only_count: number;
  discarded_count: number;
  memory_required_but_empty?: boolean;
  candidates?: Array<Record<string, unknown>>;
  written?: Array<{ candidate_id: string; files: string[] }>;
  write_failures?: Array<{ candidate_id: string; reason: string }>;
  write_failures_count?: number;
  ledger_only?: string[];
  estacionamento?: string[];
  discarded?: string[];
  blocked?: Array<Record<string, unknown>>;
  write_decisions?: Array<Record<string, unknown>>;
  edit_queue?: Array<Record<string, unknown>>;
  destination_warnings?: string[];
  strong_unwritten_count?: number;
  resolved_candidate_ids?: string[];
  resolved_strong_unwritten_count?: number;
  candidate_resolutions?: MemoryCandidateResolution[];
  memory_written?: boolean;
  memory_validated?: boolean;
  memory_consolidated?: boolean;
  memory_review_status?: MemoryReviewStatus;
  memory_post_write_validation?: MemoryPostWriteValidation;
};

export type PipelineItem = {
  goal: string;
  context?: string;
  scope_in?: string[];
  scope_out?: string[];
  tasks?: string[];
  done_criteria?: string[];
  expected_evidence?: string[];
  risks?: string[];
  uncertainties?: string[];
  changed_files?: string[];
  evidence?: string[];
  residual_risks?: string[];
  verdict_parking_lot?: string[];
  verdict_gold_mining?: string[];
};

export type PipelineFlowStatus = "pronto" | "pronto_com_ressalvas" | "nao_pronto" | "bloqueado" | "pending";

export type PipelineFlowResult = {
  index: number;
  goal: string;
  flow_id?: string;
  status: PipelineFlowStatus;
  phase?: AnyPhase;
  verdict_id?: string;
  blocker?: string;
  evidence_ids?: string[];
  memory_mining?: Record<string, unknown> | null;
};

export type GoalLearningLink = {
  id: string;
  source: "meeting_record" | "evidence_attach" | "verdict_record" | "memory_mining";
  source_id: string;
  parking_item: string;
  garimpo_vinculado: {
    classificacao: "ponto_cego" | "dica_de_ouro" | "armadilha" | "heuristica" | "nao_promover";
    simbolo: "🕳️" | "💎" | "⚠️" | "🔧" | "·";
    pepita: string | null;
    promovido_para_gold_mining: boolean;
    gold_id?: string;
  };
  memory_candidate_id?: string;
  created_at: string;
};

export type FlowStatus = "active" | "blocked" | "complete" | "archived";
export type GateStatus = "passed" | "blocked";

export type Scope = {
  in: string[];
  out: string[];
};

export type GateRecord = {
  phase: AnyPhase;
  status: GateStatus;
  checked_at: string;
  provided: Record<string, unknown>;
  missing: string[];
  next: string;
  back_to: AnyPhase | null;
};

export type Cooperator = {
  name: string;
  reason: string;
  material: boolean;
};

export type PresentationAliases = {
  fase?: AnyPhase;
  faltando?: string[];
  proximo?: string;
  voltar_para?: AnyPhase | null;
  estacionamento?: string[];
  garimpo?: string[];
};

export type ChecklistVisualItem = {
  label: string;
  checked: boolean;
  state?: "checked" | "unchecked" | "pending" | "blocked";
  emoji: string;
};

export type LibrarianComponentStatus = "disabled" | "recalled" | "empty" | "missing_graph" | "timeout" | "failed";

export type StructuredLibrarianStatus = {
  bibliotecario: {
    enabled: boolean;
    status: LibrarianComponentStatus;
    reason: string;
    visible: boolean;
    functional_tested: boolean;
    recall_executed: boolean;
    consumption_confirmed: boolean;
  };
  graphify: {
    enabled: boolean;
    configured?: boolean;
    status: LibrarianComponentStatus;
    reason: string;
    visible: boolean;
    functional_tested: boolean;
    recall_executed: boolean;
    consumption_confirmed: boolean;
  };
  warnings: string[];
  recalled_count: number;
  functional_tested: boolean;
  recall_executed: boolean;
  consumption_confirmed: boolean;
};

export type DisplayEnvelope = {
  phase_label?: string;
  phase_emoji?: string;
  owner?: string;
  owner_emoji?: string;
  cooperators: Cooperator[];
  active_credits: string[];
  direct_action?: {
    available: boolean;
    action: string;
  };
  checklist_visual?: ChecklistVisualItem[];
  librarian?: {
    status: LibrarianComponentStatus;
    graphify_status?: LibrarianComponentStatus;
    warnings: string[];
    recalled_count: number;
    recall_executed?: boolean;
    consumption_confirmed?: boolean;
    graphify_consumption_confirmed?: boolean;
  };
  work_progress?: WorkProgressSummary;
};

export type PresentationEnvelope = {
  aliases: PresentationAliases;
  display: DisplayEnvelope;
  suggested_cooperation: Cooperator[];
};

export type Evidence = {
  evidence_id: string;
  flow_id: string;
  kind: string;
  title: string;
  uri?: string;
  content?: string;
  note?: string;
  satisfies?: string[];
  observed_result?: Record<string, unknown>;
  scope_classification?: "target" | "declared_dependency" | "outside";
  scope_reference?: string;
  parking_lot: string[];
  gold_mining: string[];
  cooperators: Cooperator[];
  active_credits: string[];
  created_at: string;
  evidence_quality?: EvidenceQuality;
};

export type EvidenceQuality = {
  status: "strong" | "weak" | "missing_context" | "legacy_unclassified";
  blocking: boolean;
  reasons: string[];
  missing_fields: string[];
};

export type Meeting = {
  meeting_id: string;
  flow_id: string;
  type: MeetingType;
  kind: MeetingKind;
  question: string;
  status: "open" | "recorded" | "closed";
  opened_at: string;
  recorded_at?: string;
  closed_at?: string;
  participants_required: string[];
  participants_present: string[];
  suggested_cooperators: Cooperator[];
  questions: string[];
  findings: string[];
  hypotheses: string[];
  alternatives: string[];
  decisions: string[];
  decision?: string;
  next_required_action?: Record<string, unknown> | null;
  satisfies_blockers: string[];
  created_by?: string;
  evidence_ids: string[];
  turns: Array<{
    at: string;
    speaker?: string;
    question?: string;
    finding?: string;
    note?: string;
    evidence_ids: string[];
  }>;
  risks: string[];
  next_steps: string[];
  affected_areas: string[];
  impacts: string[];
  owners: string[];
  gates_extra: string[];
  rollback_plan?: string;
  parking_lot: string[];
  gold_mining: string[];
  cooperators: Cooperator[];
  active_credits: string[];
};

export type Verdict = {
  verdict_id: string;
  flow_id: string;
  status: VerdictStatus;
  rationale: string;
  evidence_ids: string[];
  residual_risks: string[];
  review_findings: string[];
  parking_lot: string[];
  gold_mining: string[];
  cooperators: Cooperator[];
  active_credits: string[];
  meeting_ids?: string[];
  next_step: string;
  created_at: string;
};

export type Flow = {
  flow_id: string;
  goal: string;
  goal_binding?: GoalBinding;
  owner?: string;
  context?: string;
  phase: AnyPhase;
  mode?: PhaseMode;
  status: FlowStatus;
  scope: Scope;
  risks: string[];
  uncertainties: string[];
  tasks: string[];
  done_criteria: string[];
  expected_evidence: string[];
  changed_files: string[];
  decisions: string[];
  parking_lot: string[];
  gold_mining: string[];
  goal_learning_links: GoalLearningLink[];
  cooperators: Cooperator[];
  active_credits: string[];
  evidence: Evidence[];
  meetings: string[];
  verdicts: Verdict[];
  gates: Record<string, GateRecord>;
  memory_mining?: MemoryMiningSummary;
  memory_candidate_resolutions?: MemoryCandidateResolution[];
  history: Array<{
    at: string;
    type: string;
    data: Record<string, unknown>;
  }>;
  created_at: string;
  updated_at: string;
  archived_at?: string;
};

export type LedgerEvent = {
  event_id: string;
  flow_id?: string;
  type: string;
  timestamp: string;
  actor: string;
  data: Record<string, unknown>;
};

export type WorkProgressStatus = "queued" | "running" | "completed" | "failed";

export type WorkProgressEvent = {
  progress_id: string;
  event_key: string;
  source: string;
  operation: string;
  stage: string;
  current: number;
  total: number;
  percent: number;
  status: WorkProgressStatus;
  message?: string;
  recorded_at: string;
};

export type WorkProgressSummary = {
  event_count: number;
  operations_count: number;
  last: WorkProgressEvent | null;
};

export type HygieneFinding = {
  id: string;
  severity: "info" | "warning" | "error";
  category: "docs" | "tasks" | "paths" | "temporary_files" | "dependencies" | "ledger" | "evidence" | "principles" | "memory" | "security";
  message: string;
  evidence: string[];
  action: string;
  sensitive_content_read?: boolean;
};

export const NEXT_PHASE: Record<Phase, Phase | null> = {
  pensamentos: "planejamento",
  planejamento: "implementacao",
  implementacao: "revisao",
  revisao: "teste",
  teste: "validacao",
  validacao: null
};

export const DEFAULT_BACK_TO: Record<Phase, Phase | null> = {
  pensamentos: null,
  planejamento: "pensamentos",
  implementacao: "planejamento",
  revisao: "implementacao",
  teste: "implementacao",
  validacao: "teste"
};

// Gate requirements live exclusively in phase-profile.ts. Keeping a second
// full-mode catalog here previously allowed the public template and runtime
// gate semantics to drift.

export const REQUIRED_TOOLS = [
  "runtime_probe",
  "ppirtv_trace",
  "flow_create",
  "flow_status",
  "flow_advance",
  "flow_return",
  "gate_check",
  "meeting_open",
  "meeting_record",
  "evidence_attach",
  "checklist_render",
  "verdict_record",
  "hygiene_scan",
  "flow_archive",
  "spt_validate",
  "goal_start",
  "goal_status",
  "ppirtv_checkout",
  "goal_resume",
  "goal_gate_check",
  "goal_gate_preflight",
  "goal_advance",
  "goal_progress_record",
  "goal_meeting_open",
  "goal_meeting_add_turn",
  "goal_meeting_close",
  "mm_memory_mining",
  "mm_memory_candidate_resolve",
  "mm_pipeline_run",
  "evidence_add",
  "goal_verdict",
  "goal_regress"
] as const;

export const REQUIRED_PROMPTS = [
  "start-ppirtv-flow",
  "run-phase-gate",
  "open-divergent-meeting",
  "open-convergent-meeting",
  "open-transversal-meeting",
  "clean-house-review",
  "final-verdict"
] as const;

export const REQUIRED_RESOURCES = [
  "ppirtv://flows",
  "ppirtv://flow/{flow_id}",
  "ppirtv://flow/{flow_id}/checklist",
  "ppirtv://flow/{flow_id}/ledger",
  "ppirtv://flow/{flow_id}/meetings",
  "ppirtv://templates/gates",
  "ppirtv://templates/meetings",
  "ppirtv://reference/mcp"
] as const;
