export const PHASES = [
  "pensamentos",
  "planejamento",
  "implementacao",
  "revisao",
  "teste",
  "validacao"
] as const;

export type Phase = (typeof PHASES)[number];

export const MEETING_TYPES = ["divergent", "convergent", "transversal"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const VERDICTS = ["pronto", "pronto_com_ressalvas", "nao_pronto", "bloqueado"] as const;
export type VerdictStatus = (typeof VERDICTS)[number];

export type FlowStatus = "active" | "blocked" | "complete" | "archived";
export type GateStatus = "passed" | "blocked";

export type Scope = {
  in: string[];
  out: string[];
};

export type GateRecord = {
  phase: Phase;
  status: GateStatus;
  checked_at: string;
  provided: Record<string, unknown>;
  missing: string[];
  next: string;
  back_to: Phase | null;
};

export type Cooperator = {
  name: string;
  reason: string;
  material: boolean;
};

export type PresentationAliases = {
  fase?: Phase;
  faltando?: string[];
  proximo?: string;
  voltar_para?: Phase | null;
  estacionamento?: string[];
  garimpo?: string[];
};

export type ChecklistVisualItem = {
  label: string;
  checked: boolean;
  emoji: string;
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
  parking_lot: string[];
  gold_mining: string[];
  cooperators: Cooperator[];
  active_credits: string[];
  created_at: string;
};

export type Meeting = {
  meeting_id: string;
  flow_id: string;
  type: MeetingType;
  question: string;
  status: "open" | "recorded";
  opened_at: string;
  recorded_at?: string;
  questions: string[];
  hypotheses: string[];
  alternatives: string[];
  decisions: string[];
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
  parking_lot: string[];
  gold_mining: string[];
  cooperators: Cooperator[];
  active_credits: string[];
  next_step: string;
  created_at: string;
};

export type Flow = {
  flow_id: string;
  goal: string;
  owner?: string;
  context?: string;
  phase: Phase;
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
  cooperators: Cooperator[];
  active_credits: string[];
  evidence: Evidence[];
  meetings: string[];
  verdicts: Verdict[];
  gates: Partial<Record<Phase, GateRecord>>;
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

export type HygieneFinding = {
  id: string;
  severity: "info" | "warning" | "error";
  category: "docs" | "tasks" | "paths" | "temporary_files" | "dependencies" | "ledger" | "evidence" | "principles" | "memory" | "security";
  message: string;
  evidence: string[];
  action: string;
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

export const GATE_REQUIREMENTS: Record<
  Phase,
  Array<{ key: string; label: string; source: "flow" | "provided" | "evidence" | "meeting" | "verdict" }>
> = {
  pensamentos: [
    { key: "goal", label: "objetivo nomeado", source: "flow" },
    { key: "context", label: "contexto minimo conhecido", source: "flow" },
    { key: "risks", label: "risco principal nomeado", source: "flow" },
    { key: "uncertainties", label: "incertezas marcadas como lacunas", source: "flow" }
  ],
  planejamento: [
    { key: "scope_in", label: "escopo definido", source: "flow" },
    { key: "scope_out", label: "fora do escopo definido", source: "flow" },
    { key: "tasks", label: "tarefas ordenadas", source: "flow" },
    { key: "expected_evidence", label: "evidencias esperadas definidas", source: "flow" },
    { key: "done_criteria", label: "criterio de pronto definido", source: "flow" }
  ],
  implementacao: [
    { key: "implementation_done", label: "mudanca executada ou bloqueio objetivo registrado", source: "provided" },
    { key: "changed_files", label: "arquivos alterados registrados", source: "flow" }
  ],
  revisao: [
    { key: "diff_reviewed", label: "diff revisado", source: "provided" },
    { key: "barata_scan", label: "barata nunca esta sozinha aplicado", source: "provided" },
    { key: "regression_risks", label: "riscos de regressao listados", source: "provided" }
  ],
  teste: [
    { key: "test_executed", label: "teste real executado ou limitacao explicita", source: "provided" },
    { key: "evidence", label: "evidencia anexada", source: "evidence" }
  ],
  validacao: [
    { key: "verdict", label: "veredito registrado", source: "verdict" },
    { key: "residual_risks", label: "risco residual registrado", source: "provided" },
    { key: "next_step", label: "proximo passo definido", source: "provided" },
    { key: "clean_house", label: "casa limpa confirmada", source: "provided" }
  ]
};

export const REQUIRED_TOOLS = [
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
  "flow_archive"
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
