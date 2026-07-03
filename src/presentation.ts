import { DEFAULT_BACK_TO, type Cooperator, type DisplayEnvelope, type Flow, type AnyPhase, type Phase, type PresentationEnvelope } from "./domain.js";

const PHASE_META: Record<Phase, { label: string; emoji: string; owner: string; ownerEmoji: string }> = {
  pensamentos: { label: "Pensamentos", emoji: "🧠", owner: "Rita Reuniao + Quele Questiona", ownerEmoji: "🗣️" },
  planejamento: { label: "Planejamento", emoji: "🗂️", owner: "Paula Planeja", ownerEmoji: "📋" },
  implementacao: { label: "Implementacao", emoji: "🛠️", owner: "Ivo Implementa", ownerEmoji: "🛠️" },
  revisao: { label: "Revisao", emoji: "🔎", owner: "Renata Review", ownerEmoji: "🔎" },
  teste: { label: "Teste", emoji: "🧪", owner: "Tereza Testa", ownerEmoji: "🧪" },
  validacao: { label: "Validacao", emoji: "✅", owner: "Vera Veredito", ownerEmoji: "✅" }
};

const COMPACT_PHASE_META: Record<string, { label: string; emoji: string; owner: string; ownerEmoji: string }> = {
  concepcao: { label: "Concepcao", emoji: "🧠", owner: "Rita Reuniao + Paula Planeja", ownerEmoji: "📋" },
  implementacao: { label: "Implementacao", emoji: "🛠️", owner: "Ivo Implementa", ownerEmoji: "🛠️" },
  revisao: { label: "Revisao", emoji: "🔎", owner: "Renata Review + Tereza Testa", ownerEmoji: "🔎" },
  validacao: { label: "Validacao", emoji: "✅", owner: "Vera Veredito", ownerEmoji: "✅" }
};

// Fallback de emergencia: se nem full nem compact conhecerem a fase, usar
// um meta neutro em vez de quebrar a apresentacao com TypeError.
const FALLBACK_PHASE_META: { label: string; emoji: string; owner: string; ownerEmoji: string } = {
  label: "Fase",
  emoji: "❓",
  owner: "—",
  ownerEmoji: "❓"
};

const COMPACT_CHECKLIST_EMOJI: Record<string, string> = {
  concepcao: "🧠",
  implementacao: "🛠️",
  revisao: "🔎",
  validacao: "✅"
};

const CHECKLIST_EMOJI: Record<Phase, string> = {
  pensamentos: "🧠",
  planejamento: "🗂️",
  implementacao: "🛠️",
  revisao: "🔎",
  teste: "🧪",
  validacao: "✅"
};

export type GateLike = {
  phase: AnyPhase;
  missing?: string[];
  next?: string;
  back_to?: AnyPhase | null;
  parking_lot?: string[];
  gold_mining?: string[];
  cooperators?: Cooperator[];
  active_credits?: string[];
};

export type Presentable<T extends Record<string, unknown>> = T & PresentationEnvelope;

export function presentFlow(flow: Flow): Flow & PresentationEnvelope {
  return {
    ...flow,
    ...presentationFor({
      phase: flow.phase,
      mode: flow.mode,
      parking_lot: flow.parking_lot,
      gold_mining: flow.gold_mining,
      cooperators: flow.cooperators,
      active_credits: flow.active_credits
    })
  };
}

export function presentGate<T extends GateLike & Record<string, unknown>>(value: T, flow?: Flow): Presentable<T> {
  return {
    ...value,
    ...presentationFor({
      phase: value.phase,
      mode: flow?.mode,
      missing: value.missing,
      next: value.next,
      back_to: value.back_to,
      parking_lot: value.parking_lot ?? flow?.parking_lot,
      gold_mining: value.gold_mining ?? flow?.gold_mining,
      cooperators: value.cooperators ?? flow?.cooperators,
      active_credits: value.active_credits ?? flow?.active_credits
    })
  };
}

export function presentArtifact<T extends Record<string, unknown> & { flow_id: string }>(value: T, flow: Flow): Presentable<T> {
  return {
    ...value,
    ...presentationFor({
      phase: flow.phase,
      mode: flow.mode,
      parking_lot: arrayField(value.parking_lot) ?? flow.parking_lot,
      gold_mining: arrayField(value.gold_mining) ?? flow.gold_mining,
      cooperators: cooperatorsField(value.cooperators) ?? flow.cooperators,
      active_credits: arrayField(value.active_credits) ?? flow.active_credits
    })
  };
}

export function presentChecklist(input: {
  flow: Flow;
  items: Array<{ label: string; checked: boolean }>;
  visualItems?: Array<{ label: string; checked: boolean; state?: "checked" | "unchecked" | "pending" | "blocked"; emoji?: string }>;
  markdown: string;
}): {
  flow_id: string;
  phase: AnyPhase;
  markdown: string;
  items: Array<{ label: string; checked: boolean }>;
} & PresentationEnvelope {
  const visualSource: Array<{ label: string; checked: boolean; state?: "checked" | "unchecked" | "pending" | "blocked"; emoji?: string }> =
    input.visualItems ?? input.items;
  const checklist_visual = visualSource.map((item) => ({
    ...item,
    state: item.state ?? (item.checked ? "checked" : "unchecked"),
    emoji: item.emoji ?? (item.checked ? "✅" : (input.flow.mode === "compact" ? (COMPACT_CHECKLIST_EMOJI[input.flow.phase] ?? "◻️") : CHECKLIST_EMOJI[input.flow.phase as Phase] ?? "◻️"))
  }));
  return {
    flow_id: input.flow.flow_id,
    phase: input.flow.phase,
    markdown: input.markdown,
    items: input.items,
    ...presentationFor({
      phase: input.flow.phase,
      mode: input.flow.mode,
      parking_lot: input.flow.parking_lot,
      gold_mining: input.flow.gold_mining,
      cooperators: input.flow.cooperators,
      active_credits: input.flow.active_credits,
      checklist_visual
    })
  };
}

export function presentationFor(input: GateLike & { checklist_visual?: DisplayEnvelope["checklist_visual"]; mode?: string }): PresentationEnvelope {
  const meta = input.mode === "compact"
    ? (COMPACT_PHASE_META[input.phase] ?? PHASE_META[input.phase as Phase] ?? FALLBACK_PHASE_META)
    : (PHASE_META[input.phase as Phase] ?? COMPACT_PHASE_META[input.phase] ?? FALLBACK_PHASE_META);
  const missing = input.missing ?? [];
  const directAction = missing.length > 0 ? `Completar: ${missing.join(", ")}` : "Sem bloqueio local; verificar status fiscal antes de avancar";
  const display: DisplayEnvelope = {
    phase_label: meta.label,
    phase_emoji: meta.emoji,
    owner: meta.owner,
    owner_emoji: meta.ownerEmoji,
    cooperators: input.cooperators ?? [],
    active_credits: input.active_credits ?? [],
    direct_action: {
      available: missing.length > 0,
      action: directAction
    },
    checklist_visual: input.checklist_visual
  };
  return {
    aliases: {
      fase: input.phase,
      faltando: missing,
      proximo: input.next,
      voltar_para: input.back_to,
      estacionamento: input.parking_lot ?? [],
      garimpo: input.gold_mining ?? []
    },
    display,
    suggested_cooperation: suggestedCooperation(input.phase, missing, input.back_to ?? (DEFAULT_BACK_TO[input.phase as Phase] ?? null))
  };
}

function suggestedCooperation(phase: AnyPhase, missing: string[], backTo: AnyPhase | null): Cooperator[] {
  if (missing.length === 0) {
    return [];
  }
  const suggestions: Cooperator[] = [];
  if (phase === "pensamentos") {
    suggestions.push({ name: "Quele Questiona", reason: "clarear objetivo, contexto, riscos e lacunas antes de planejar", material: false });
  }
  if (phase === "planejamento") {
    suggestions.push({ name: "Paula Planeja", reason: "fechar escopo, tarefas, evidencias esperadas e criterio de pronto", material: false });
  }
  if (phase === "implementacao") {
    suggestions.push({ name: "Ivo Implementa", reason: "registrar menor ajuste executado ou bloqueio objetivo", material: false });
  }
  if (phase === "revisao") {
    suggestions.push({ name: "Chato", reason: "pressionar riscos de regressao e falso pronto", material: false });
  }
  if (phase === "teste") {
    suggestions.push({ name: "Tereza Testa", reason: "produzir evidencia real ou explicitar limite de teste", material: false });
  }
  if (phase === "validacao") {
    suggestions.push({ name: "Vera Veredito", reason: "fechar veredito, risco residual, proximo passo e casa limpa", material: false });
  }
  if (backTo) {
    suggestions.push({ name: "Fernanda do Fluxo", reason: `rotear retorno seguro para ${backTo}`, material: false });
  }
  return suggestions;
}

function arrayField(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function cooperatorsField(value: unknown): Cooperator[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as Cooperator).name === "string" &&
      typeof (item as Cooperator).reason === "string" &&
      typeof (item as Cooperator).material === "boolean"
  )
    ? (value as Cooperator[])
    : undefined;
}
