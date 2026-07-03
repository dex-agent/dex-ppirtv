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

import type { Phase, CompactPhase } from "./domain.js";

export type AnyPhase = string;

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
      { key: "goal", label: "objetivo nomeado", source: "flow" },
      { key: "context", label: "contexto minimo conhecido", source: "flow" },
      { key: "risks", label: "risco principal nomeado", source: "flow" },
      { key: "uncertainties", label: "incertezas marcadas como lacunas", source: "flow" },
    ],
    planejamento: [
      { key: "scope_in", label: "escopo definido", source: "flow" },
      { key: "scope_out", label: "fora do escopo definido", source: "flow" },
      { key: "tasks", label: "tarefas ordenadas", source: "flow" },
      { key: "expected_evidence", label: "evidencias esperadas definidas", source: "flow" },
      { key: "done_criteria", label: "criterio de pronto definido", source: "flow" },
    ],
    implementacao: [
      { key: "implementation_done", label: "mudanca executada ou bloqueio objetivo registrado", source: "provided" },
      { key: "changed_files", label: "arquivos alterados registrados", source: "flow" },
    ],
    revisao: [
      { key: "diff_reviewed", label: "diff revisado", source: "provided" },
      { key: "barata_scan", label: "barata nunca esta sozinha aplicado", source: "provided" },
      { key: "regression_risks", label: "riscos de regressao listados", source: "provided" },
    ],
    teste: [
      { key: "test_executed", label: "teste real executado ou limitacao explicita", source: "provided" },
      { key: "evidence", label: "evidencia anexada", source: "evidence" },
    ],
    validacao: [
      { key: "verdict", label: "veredito registrado", source: "verdict" },
      { key: "residual_risks", label: "risco residual registrado", source: "provided" },
      { key: "next_step", label: "proximo passo definido", source: "provided" },
      { key: "clean_house", label: "casa limpa confirmada", source: "provided" },
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
      { key: "goal", label: "objetivo nomeado", source: "flow" },
      { key: "context", label: "contexto minimo conhecido", source: "flow" },
      { key: "risks", label: "risco principal nomeado", source: "flow" },
      { key: "scope_in", label: "escopo definido", source: "flow" },
      { key: "tasks", label: "tarefas ordenadas", source: "flow" },
      { key: "done_criteria", label: "criterio de pronto definido", source: "flow" },
    ],
    implementacao: [
      { key: "implementation_done", label: "mudanca executada ou bloqueio objetivo registrado", source: "provided" },
      { key: "changed_files", label: "arquivos alterados registrados", source: "flow" },
    ],
    revisao: [
      { key: "diff_reviewed", label: "diff revisado", source: "provided" },
      { key: "barata_scan", label: "barata nunca esta sozinha aplicado", source: "provided" },
      { key: "test_executed", label: "teste executado ou limitacao explicita", source: "provided" },
      { key: "evidence", label: "evidencia anexada", source: "evidence" },
    ],
    validacao: [
      { key: "verdict", label: "veredito registrado", source: "verdict" },
      { key: "residual_risks", label: "risco residual registrado", source: "provided" },
      { key: "next_step", label: "proximo passo definido", source: "provided" },
      { key: "clean_house", label: "casa limpa confirmada", source: "provided" },
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
