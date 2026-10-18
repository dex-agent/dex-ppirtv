/**
 * PhaseProfile: single source of truth for phase configuration.
 *
 * Clean Architecture: separates policy (which phases, transitions, gates,
 * display meta) from detail (flow engine logic, presentation rendering).
 * Clean Code SRP: this module owns phase configuration. Nothing else should.
 *
 * Adding a new mode = adding a new PhaseProfile instance. Engine and
 * presentation never need to know if it's "compact" or "full".
 */

import type { Phase, CompactPhase, AnyPhase } from "./domain.js";

// AnyPhase agora e reexportado de domain.ts (SSOT). A definicao local
// `string` foi removida para evitar divergencia de tipos.
export type { AnyPhase };

export type PhaseDisplayMeta = {
  label: string;
  emoji: string;
  owner: string;
  ownerEmoji: string;
};

export type GateRequirement = {
  key: string;
  label: string;
  source: "flow" | "provided" | "evidence" | "meeting" | "verdict";
  // SPT gate-integrity-hardening-2 (R2/R10, laudo de revalidacao 2026-10-18):
  // todo requisito declara o tipo contratado da sua prova; interpretacao
  // "truthy" nao existe mais em nenhuma source.
  kind: GateRequirementKind;
};

export type GateRequirementKind =
  | "boolean"
  | "non_empty_string"
  | "string_array"
  | "non_empty_string_array";

// Mapa SSOT de kind por chave de requisito (consumido por source=flow e pelo
// fail-closed de chave desconhecida).
export const REQUIREMENT_KINDS_BY_KEY: Record<string, GateRequirementKind> = {
  goal: "non_empty_string",
  context: "non_empty_string",
  risks: "non_empty_string_array",
  uncertainties: "non_empty_string_array",
  scope_in: "non_empty_string_array",
  scope_out: "non_empty_string_array",
  tasks: "non_empty_string_array",
  expected_evidence: "non_empty_string_array",
  done_criteria: "non_empty_string_array",
  changed_files: "non_empty_string_array",
  implementation_done: "boolean",
  diff_reviewed: "boolean",
  barata_scan: "boolean",
  test_executed: "boolean",
  memoria_viva_reconciled: "boolean",
  next_step: "non_empty_string",
  residual_risks: "string_array",
  regression_risks: "non_empty_string_array",
  evidence: "non_empty_string",
  verdict: "non_empty_string"
};

export type PhaseProfile = {
  readonly mode: string;
  readonly phases: readonly string[];
  readonly nextPhase: Record<string, string | null>;
  readonly defaultBackTo: Record<string, string | null>;
  readonly gateRequirements: Record<string, GateRequirement[]>;
  readonly displayMeta: Record<string, PhaseDisplayMeta>;
  readonly checklistEmoji: Record<string, string>;
};

// --- Full profile (6 phases: original PPIRTV) ---

export const FULL_PROFILE: PhaseProfile = {
  mode: "full",
  phases: ["pensamentos", "planejamento", "implementacao", "revisao", "teste", "validacao"],
  nextPhase: {
    pensamentos: "planejamento",
    planejamento: "implementacao",
    implementacao: "revisao",
    revisao: "teste",
    teste: "validacao",
    validacao: null,
  },
  defaultBackTo: {
    pensamentos: null,
    planejamento: "pensamentos",
    implementacao: "planejamento",
    revisao: "implementacao",
    teste: "implementacao",
    validacao: "teste",
  },
  gateRequirements: {
    pensamentos: [
      { key: "goal", label: "objetivo nomeado", source: "flow", kind: "non_empty_string" },
      { key: "context", label: "contexto minimo conhecido", source: "flow", kind: "non_empty_string" },
      { key: "risks", label: "risco principal nomeado", source: "flow", kind: "non_empty_string_array" },
      { key: "uncertainties", label: "incertezas marcadas como lacunas", source: "flow", kind: "non_empty_string_array" },
    ],
    planejamento: [
      { key: "scope_in", label: "escopo definido", source: "flow", kind: "non_empty_string_array" },
      { key: "scope_out", label: "fora do escopo definido", source: "flow", kind: "non_empty_string_array" },
      { key: "tasks", label: "tarefas ordenadas", source: "flow", kind: "non_empty_string_array" },
      { key: "expected_evidence", label: "evidencias esperadas definidas", source: "flow", kind: "non_empty_string_array" },
      { key: "done_criteria", label: "criterio de pronto definido", source: "flow", kind: "non_empty_string_array" },
    ],
    implementacao: [
      { key: "implementation_done", label: "mudanca executada ou bloqueio objetivo registrado", source: "provided", kind: "boolean" },
      { key: "changed_files", label: "arquivos alterados registrados", source: "flow", kind: "non_empty_string_array" },
    ],
    revisao: [
      { key: "diff_reviewed", label: "diff revisado", source: "provided", kind: "boolean" },
      { key: "barata_scan", label: "barata nunca esta sozinha aplicado", source: "provided", kind: "boolean" },
      { key: "regression_risks", label: "riscos de regressao listados", source: "provided", kind: "non_empty_string_array" },
    ],
    teste: [
      { key: "test_executed", label: "teste real executado ou limitacao explicita", source: "provided", kind: "boolean" },
      { key: "evidence", label: "evidencia anexada", source: "evidence", kind: "non_empty_string" },
    ],
    validacao: [
      { key: "verdict", label: "veredito registrado", source: "verdict", kind: "non_empty_string" },
      { key: "residual_risks", label: "risco residual registrado", source: "provided", kind: "string_array" },
      { key: "next_step", label: "proximo passo definido", source: "provided", kind: "non_empty_string" },
      {
        key: "memoria_viva_reconciled",
        label: "memoria-viva reconciliou continuidade e orquestrou o fechamento",
        source: "provided",
        kind: "boolean",
      },
    ],
  },
  displayMeta: {
    pensamentos: { label: "Pensamentos", emoji: "🧠", owner: "Rita Reuniao + Quele Questiona", ownerEmoji: "🗣️" },
    planejamento: { label: "Planejamento", emoji: "🗂️", owner: "Paula Planeja", ownerEmoji: "📋" },
    implementacao: { label: "Implementacao", emoji: "🛠️", owner: "Ivo Implementa", ownerEmoji: "🛠️" },
    revisao: { label: "Revisao", emoji: "🔎", owner: "Renata Review", ownerEmoji: "🔎" },
    teste: { label: "Teste", emoji: "🧪", owner: "Tereza Testa", ownerEmoji: "🧪" },
    validacao: { label: "Validacao", emoji: "✅", owner: "Vera Veredito", ownerEmoji: "✅" },
  },
  checklistEmoji: {
    pensamentos: "🧠",
    planejamento: "🗂️",
    implementacao: "🛠️",
    revisao: "🔎",
    teste: "🧪",
    validacao: "✅",
  },
};

// --- Compact profile (4 phases: concepcao, implementacao, revisao, validacao) ---

export const COMPACT_PROFILE: PhaseProfile = {
  mode: "compact",
  phases: ["concepcao", "implementacao", "revisao", "validacao"],
  nextPhase: {
    concepcao: "implementacao",
    implementacao: "revisao",
    revisao: "validacao",
    validacao: null,
  },
  defaultBackTo: {
    concepcao: null,
    implementacao: "concepcao",
    revisao: "implementacao",
    validacao: "revisao",
  },
  gateRequirements: {
    concepcao: [
      { key: "goal", label: "objetivo nomeado", source: "flow", kind: "non_empty_string" },
      { key: "context", label: "contexto minimo conhecido", source: "flow", kind: "non_empty_string" },
      { key: "risks", label: "risco principal nomeado", source: "flow", kind: "non_empty_string_array" },
      { key: "scope_in", label: "escopo definido", source: "flow", kind: "non_empty_string_array" },
      { key: "tasks", label: "tarefas ordenadas", source: "flow", kind: "non_empty_string_array" },
      { key: "done_criteria", label: "criterio de pronto definido", source: "flow", kind: "non_empty_string_array" },
    ],
    implementacao: [
      { key: "implementation_done", label: "mudanca executada ou bloqueio objetivo registrado", source: "provided", kind: "boolean" },
      { key: "changed_files", label: "arquivos alterados registrados", source: "flow", kind: "non_empty_string_array" },
    ],
    revisao: [
      { key: "diff_reviewed", label: "diff revisado", source: "provided", kind: "boolean" },
      { key: "barata_scan", label: "barata nunca esta sozinha aplicado", source: "provided", kind: "boolean" },
      { key: "test_executed", label: "teste executado ou limitacao explicita", source: "provided", kind: "boolean" },
      { key: "evidence", label: "evidencia anexada", source: "evidence", kind: "non_empty_string" },
    ],
    validacao: [
      { key: "verdict", label: "veredito registrado", source: "verdict", kind: "non_empty_string" },
      { key: "residual_risks", label: "risco residual registrado", source: "provided", kind: "string_array" },
      { key: "next_step", label: "proximo passo definido", source: "provided", kind: "non_empty_string" },
      {
        key: "memoria_viva_reconciled",
        label: "memoria-viva reconciliou continuidade e orquestrou o fechamento",
        source: "provided",
        kind: "boolean",
      },
    ],
  },
  displayMeta: {
    concepcao: { label: "Concepcao", emoji: "🧠", owner: "Rita Reuniao + Paula Planeja", ownerEmoji: "📋" },
    implementacao: { label: "Implementacao", emoji: "🛠️", owner: "Ivo Implementa", ownerEmoji: "🛠️" },
    revisao: { label: "Revisao", emoji: "🔎", owner: "Renata Review + Tereza Testa", ownerEmoji: "🔎" },
    validacao: { label: "Validacao", emoji: "✅", owner: "Vera Veredito", ownerEmoji: "✅" },
  },
  checklistEmoji: {
    concepcao: "🧠",
    implementacao: "🛠️",
    revisao: "🔎",
    validacao: "✅",
  },
};

const PROFILES: Record<string, PhaseProfile> = {
  full: FULL_PROFILE,
  compact: COMPACT_PROFILE,
};

/**
 * Returns the PhaseProfile for a flow's mode.
 * Defaults to FULL_PROFILE when mode is undefined or unknown.
 */
export function profileFor(mode?: string): PhaseProfile {
  return PROFILES[mode ?? "full"] ?? FULL_PROFILE;
}

// SPT gate-integrity-hardening (T-3, laudo F2): politica de transicao de fase
// vive aqui (SSOT de perfil), nao no motor. Fase desconhecida falha fechado —
// undefined NAO e fase terminal.
export function nextPhaseOrThrow(mode: string | undefined, from: string): AnyPhase | null {
  const nextPhase = profileFor(mode).nextPhase[from] as AnyPhase | null | undefined;
  if (nextPhase === undefined) {
    throw new Error(
      `PPIRTV_UNKNOWN_PHASE_TRANSITION: fase "${from}" nao tem transicao definida no perfil "${mode ?? "full"}"`
    );
  }
  return nextPhase;
}

export function assertPhaseInProfile(mode: string | undefined, to: AnyPhase): void {
  const profile = profileFor(mode);
  if (!profile.phases.includes(to)) {
    throw new Error(
      `PPIRTV_INVALID_PHASE_FOR_PROFILE: fase "${to}" nao pertence ao perfil "${mode ?? "full"}" (fases validas: ${profile.phases.join(", ")})`
    );
  }
}

export function phaseAdvanceAllowed(
  flow: { status?: string; mode?: string; phase: string },
  phaseBlockers: string[],
  closureBlockers: string[] = []
): boolean {
  if (flow.status === "complete" || flow.status === "archived" || phaseBlockers.length > 0) {
    return false;
  }
  const nextPhase = profileFor(flow.mode).nextPhase[flow.phase];
  if (nextPhase === undefined) {
    return false;
  }
  return nextPhase !== null || closureBlockers.length === 0;
}


// SPT gate-integrity-hardening-2 (R1, laudo de revalidacao 2026-10-18):
// flow_return/goal_regress nao podem pular para frente. Destino POSTERIOR a
// fase atual e erro tipado ANTES de qualquer mutacao; retorno para a propia
// fase atual e legal (regresso fiscal revalida o gate da fase) e avancar usa
// o caminho do advance (gates), nunca o retorno.
export function assertPhaseTransitionDirection(mode: string | undefined, from: string, to: string | undefined): void {
  const phases = profileFor(mode).phases;
  const fromIndex = phases.indexOf(from);
  const target = to ?? "";
  const toIndex = phases.indexOf(target);
  if (fromIndex === -1 || toIndex === -1) {
    throw new Error(
      `PPIRTV_PHASE_RETURN_MUST_GO_BACK: fase desconhecida no perfil '${mode}' (from='${from}', to='${to}')`
    );
  }
  if (toIndex > fromIndex) {
    throw new Error(
      `PPIRTV_PHASE_RETURN_MUST_GO_BACK: retorno para '${target}' nao pode avancar alem da fase atual '${from}' no modo '${mode}'; movimento para frente exige o caminho de advance com gates`
    );
  }
}
