// Envelope de erro acionavel na fronteira MCP.
// Contrato: docs/contracts/MCP_TOOL_ERROR_ENVELOPE_CONTRACT.md
// Localizador: PPIRTV-ERRO-QUE-ENSINA-ENVELOPE
//
// Modulo puro, sem dependencia do engine: toda funcao recebe strings/arrays
// e devolve o envelope que ensina o destravamento (codigo desambiguado,
// numeros do estado, sequencia literal com args do schema vivo, sem campos
// vazios).

export type EnvelopeStep = {
  order: number;
  tool: string;
  args?: Record<string, unknown>;
  only_if?: string;
};

export type NextRequiredAction = {
  type: string;
  tool: string;
  reason?: string;
  args?: Record<string, unknown>;
  required_tool_sequence?: EnvelopeStep[];
  [extra: string]: unknown;
};

export type InputShapeIssue = {
  field: string;
  received_type: string;
  expected_type: string;
  example?: unknown;
};

const COOPERATOR_EXAMPLE = [
  { name: "response-evidence-fiscal", reason: "valida os achados e a integridade das provas", material: false }
];

/**
 * Segmento de numeros do estado para a mensagem fiscal bloqueada
 * (SPEC item 2 do contrato). O formato mora aqui; o engine so projeta.
 */
export function fiscalStateSegment(
  attemptCount: number,
  regressCount: number,
  maxRegressions: number,
  meetings: number
): string {
  return `attempt_count=${attemptCount}, regress_count=${regressCount}, max=${maxRegressions}, meetings=${meetings}`;
}

function meetingSequence(flowId: string): EnvelopeStep[] {
  return [
    {
      order: 1,
      tool: "goal_meeting_open",
      args: {
        flow_id: flowId,
        question: "registrar cooperacao material que destrava o veredito",
        type: "decision",
        suggested_cooperators: COOPERATOR_EXAMPLE
      }
    },
    {
      order: 2,
      tool: "goal_meeting_close",
      args: {
        flow_id: flowId,
        meeting_id: "<meeting_id retornado por goal_meeting_open>",
        decision: "cooperacao registrada; liberar veredito"
      }
    },
    {
      order: 3,
      tool: "goal_verdict",
      args: {
        flow_id: flowId,
        status: "pronto",
        rationale: "cooperacao material registrada na meeting citada",
        meeting_id: "<meeting_id retornado por goal_meeting_open>",
        next_step: "avancar o fluxo apos o veredito"
      }
    }
  ];
}

function parseNumberAfter(message: string, key: string): number | null {
  const match = new RegExp(`${key}=(\\d+)`).exec(message);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * next_required_action do PPIRTV_FISCAL_BLOCKED.
 * Ramifica pelo codigo desambiguado do blocker (split do attempt_regress_count)
 * e termina com a rota fallback goal_status detail=full apenas quando nada
 * mais ensina. Substitui a rota circular `resolve_fiscal_blockers -> goal_status`.
 */
export function fiscalBlockedAction(message: string, flowId = "<flow_id>"): NextRequiredAction {
  const baseArgs = { flow_id: flowId };
  if (/attempts_insufficient_before_positive_verdict/i.test(message)) {
    const attemptCount = parseNumberAfter(message, "attempt_count");
    const meetings = parseNumberAfter(message, "meetings");
    return {
      type: "run_cooperation_cycle_before_positive_verdict",
      tool: "goal_meeting_open",
      reason: `risco recorrente exige mais uma rodada antes do veredito positivo (attempt_count=${attemptCount ?? "?"}, meetings=${meetings ?? "?"}); legacy alias: attempt_regress_count`,
      args: { ...baseArgs, suggested_cooperators: COOPERATOR_EXAMPLE },
      required_tool_sequence: [
        ...meetingSequence(flowId),
        { order: 4, tool: "goal_regress", only_if: "preferir registrar regressao deliberada em vez de meeting" },
        { order: 5, tool: "goal_verdict", only_if: "tentativas ja somarem 2+ com o proximo veredito registrado" }
      ]
    };
  }
  if (/attempt_regress_limit_reached/i.test(message)) {
    const regressCount = parseNumberAfter(message, "regress_count");
    const max = parseNumberAfter(message, "max");
    return {
      type: "stop_regressing_and_fix_work",
      tool: "goal_verdict",
      reason: `limite de regressoes atingido (regress_count=${regressCount ?? "?"}, max=${max ?? "?"}); legacy alias: attempt_regress_count — pare de regredir, corrija o trabalho e repita o veredito`,
      args: baseArgs
    };
  }
  if (/required_cooperation/i.test(message) && !/required_cooperation=(?:;|$|\s)/i.test(message)) {
    return {
      type: "register_required_cooperation",
      tool: "goal_meeting_open",
      reason: "o fiscal exige cooperacao material nomeada antes do veredito",
      args: { ...baseArgs, suggested_cooperators: COOPERATOR_EXAMPLE },
      required_tool_sequence: meetingSequence(flowId)
    };
  }
  return {
    type: "inspect_fiscal_blockers_full",
    tool: "goal_status",
    reason: "blocker fiscal sem rota especifica — inspecione o diagnostico completo",
    args: { ...baseArgs, detail: "full" }
  };
}

/**
 * gates_pending para goal_advance blocked: mapeia cada campo faltante do gate
 * para a forma esperada (C-8). Tabela fora do monolito; o tradutor no server
 * consome o `missing` que o engine ja carrega.
 */
const GATE_FIELD_EXPECTED: Record<string, string> = {
  implementation_done: "boolean true no provided quando a implementacao terminou de verdade",
  changed_files: "array de paths relativos tocados (declare remocoes tambem em deleted_files)",
  deleted_files: "array de paths relativos removidos, todos presentes em changed_files",
  review_findings: "resumo rastreavel da revisao (string nao vazia) no provided",
  test_executed: "boolean true no provided apos suite real executada com exit 0",
  residual_risks: "array de riscos residuais no provided do veredito",
  next_step: "string com o proximo passo e quando",
  memoria_viva_reconciled: "boolean true somente apos a cadeia memoria-viva real"
};

export function advanceGatesPending(
  missing: string[],
  phase?: string | null
): { phase: string | null; gates_pending: { field: string; expected: string }[] } {
  return {
    phase: phase ?? null,
    gates_pending: missing.map((field) => ({
      field,
      expected: GATE_FIELD_EXPECTED[field] ?? `forneca ${field} no provided desta fase e repita goal_advance`
    }))
  };
}

/**
 * Tabela de destravamento das familias de codigo que cruzam a fronteira MCP
 * sem tradutor hoje (secao B do contrato). Chave = regex do codigo na
 * mensagem; usada pelo classifyToolError antes do fallback.
 */
const UNBLOCK_RULES: { code: string; pattern: RegExp; action: NextRequiredAction }[] = [
  {
    code: "MEMORY_CANDIDATES_NOT_MINED",
    pattern: /MEMORY_CANDIDATES_NOT_MINED/i,
    action: { type: "run_memory_mining_first", tool: "mm_memory_mining", reason: "candidatos de memoria exigem mineracao canonica antes do consumo" }
  },
  {
    code: "MEMORY_CANDIDATE_IDENTITY_INVALID",
    pattern: /MEMORY_CANDIDATE_IDENTITY_(?:CONFLICT|DUPLICATE|REQUIRED)/i,
    action: { type: "fix_candidate_identity", tool: "mm_memory_mining", reason: "identidade do candidato (origem/revision) precisa ser unica e estavel; reexecute a mineracao" }
  },
  {
    code: "MEMORY_CANDIDATE_PROMOTION_INVALID",
    pattern: /MEMORY_CANDIDATE_PROMOTION_(?:DESTINATION_CONFLICT|FIELDS_NOT_ALLOWED|METADATA_REQUIRED|OWNER_NOT_ALLOWED|TAG_INVALID|THEME_NOT_ALLOWED)/i,
    action: { type: "fix_promotion_payload", tool: "mm_memory_candidate_resolve", reason: "promocao exige campos, owner, tag (#tema/assunto) e destino permitidos pelo contrato dex-memoria" }
  },
  {
    code: "GOAL_IDEMPOTENCY_DUPLICATE_BINDINGS",
    pattern: /GOAL_IDEMPOTENCY_DUPLICATE_BINDINGS/i,
    action: { type: "inspect_existing_goal", tool: "goal_status", reason: "idempotency_key ja vinculada a outro binding; inspecione o flow existente antes de reabrir" }
  },
  {
    code: "GOAL_LEGACY_FLOW_DIVERGED",
    pattern: /GOAL_LEGACY_FLOW_(?:OBJECTIVE_MISMATCH|VERDICTS_PRESENT)/i,
    action: { type: "revalidate_spt_for_legacy_flow", tool: "spt_validate", reason: "flow legado diverge do SPT; revalide e use goal_start com flow_role de recuperacao exato" }
  },
  {
    code: "FLOW_TERMINAL_IMMUTABLE",
    pattern: /GOAL_TERMINAL_FLOW_UNBOUND|FLOW_IMMUTABLE_AFTER_COMPLETION/i,
    action: { type: "start_new_goal_for_reexecution", tool: "spt_validate", reason: "flow terminal e imutavel; reexecucao exige novo goal_start (SPT v3)" }
  },
  {
    code: "GOAL_WORKSPACE_STORE_MISMATCH",
    pattern: /GOAL_WORKSPACE_STORE_MISMATCH/i,
    action: { type: "restart_runtime_in_flow_workspace", tool: "runtime_probe", reason: "o runtime esta preso a outro workspace; reinicie o servidor MCP com cwd do workspace do flow" }
  },
  {
    code: "OFFICIAL_GOAL_REQUIRES_GOAL_VERDICT",
    pattern: /OFFICIAL_GOAL_REQUIRES_GOAL_VERDICT/i,
    action: { type: "record_goal_verdict", tool: "goal_verdict", reason: "GOAL oficial so conclui com veredito canonico" }
  },
  {
    code: "PROGRESS_COUNTERS_INVALID",
    pattern: /PROGRESS_(?:COMPLETED_INCOMPLETE|CURRENT_INVALID|TOTAL_INVALID)/i,
    action: { type: "fix_progress_counters", tool: "goal_progress_record", reason: "ajuste completed<=total, current/total inteiros validos e reenvie" }
  },
  {
    code: "REVIEW_SNAPSHOT_INVALID",
    pattern: /REVIEW_SNAPSHOT_(?:FILE_REQUIRED|FINGERPRINT_REQUIRED|FINGERPRINT_MISMATCH)/i,
    action: { type: "rebuild_review_snapshot", tool: "goal_status", reason: "snapshot de revisao exige arquivo relativo e fingerprint do implementation_fingerprint atual (goal_status detail=full)" }
  },
  {
    code: "MEETING_LOCK_INVALID",
    pattern: /MEETING_LOCKED|MEETING_LOCK_(?:INVALID|IDENTITY_CHANGED|TIMEOUT)|MEETING_STALE_LOCK_IDENTITY_CHANGED/i,
    action: { type: "inspect_meeting_lock_owner", tool: "goal_status", reason: "lock de meeting ativo; goal_status detail=full expoe lock owner e expiracao — aguarde ou reabra com a idempotency_key correta" }
  },
  {
    code: "REVIEW_SNAPSHOT_PATH_INVALID",
    pattern: /REVIEW_SNAPSHOT_(?:OUTSIDE_WORKSPACE|SENSITIVE_PATH)/i,
    action: { type: "use_workspace_relative_non_sensitive_path", tool: "evidence_add", reason: "caminhos de snapshot precisam ser relativos, dentro do workspace e nao-sensiveis" }
  },
  {
    code: "REVIEW_SNAPSHOT_DECLARED_DELETION_STILL_EXISTS",
    pattern: /REVIEW_SNAPSHOT_DECLARED_DELETION_STILL_EXISTS/i,
    action: { type: "finish_declared_deletion", tool: "evidence_add", reason: "arquivo declarado como deletado ainda existe; conclua a remocao ou corrija deleted_files" }
  },
  {
    code: "RECALL_CONSUMPTION_WITHOUT_RECALL",
    pattern: /RECALL_CONSUMPTION_WITHOUT_RECALL/i,
    action: { type: "record_recall_consumption", tool: "goal_advance", reason: "confirme as referencias de recall em recall_consumption antes de avancar" }
  },
  {
    code: "DELETED_FILES_NOT_CHANGED",
    pattern: /DELETED_FILES_NOT_CHANGED/i,
    action: { type: "declare_deletion_in_changed_files", tool: "goal_advance", reason: "todo deleted_files precisa constar em changed_files (fail-closed contra remocao nao declarada)" }
  }
];

export function unblockFor(message: string): { code: string; action: NextRequiredAction } | null {
  for (const rule of UNBLOCK_RULES) {
    if (rule.pattern.test(message)) {
      return { code: rule.code, action: rule.action };
    }
  }
  return null;
}

/**
 * Normaliza a mensagem fiscal para a superficie MCP: remove segmentos
 * `required_cooperation=` vazios (chave sem valor parece "cooperador sem
 * nome" — a misleitura medida na captura de 2026-10-15).
 */
export function normalizeFiscalBlockedMessage(message: string): string {
  return message
    .replace(/; required_cooperation=(?=[;\s]|$)/gi, "")
    .replace(/required_cooperation=$(?!\S)/i, "")
    .replace(/;{2,}/g, ";")
    .replace(/;\s*$/g, "")
    .trim();
}

/**
 * Envelope de shape de input (SPEC item 5): field, received_type,
 * expected_type, example. Recebe issues zod-like ({path, expected,
 * received, message}) e devolve o ensinamento.
 */
const FIELD_EXAMPLES: Record<string, unknown> = {
  suggested_cooperators: COOPERATOR_EXAMPLE,
  cooperators: COOPERATOR_EXAMPLE,
  active_credits: ["fiscal validou as provas"],
  decision: "cooperacao registrada; liberar veredito",
  meeting_id: "mtg_<id retornado por goal_meeting_close>",
  idempotency_key: "erro-que-ensina-20261015-a",
  provided: { test_executed: true }
};

function exampleFor(expected: string, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(FIELD_EXAMPLES, field)) {
    return FIELD_EXAMPLES[field];
  }
  if (expected.includes("string")) {
    return "<string>";
  }
  if (expected.includes("boolean")) {
    return true;
  }
  if (expected.includes("number")) {
    return 0;
  }
  if (expected.includes("array")) {
    return [];
  }
  return null;
}

export function inputShapeEnvelope(
  issues: { path: (string | number | symbol)[]; expected?: string; received?: string; message?: string }[]
): InputShapeIssue[] {
  return issues.map((issue) => {
    const field = issue.path.map(String).join(".");
    const expectedType = issue.expected ?? "unknown";
    const receivedType = issue.received ?? "unknown";
    return {
      field,
      received_type: receivedType,
      expected_type: expectedType,
      example: exampleFor(expectedType, field)
    };
  });
}

/** Textos .describe() para os campos quentes (ensinam no lado do cliente via tools/list). */
export const INPUT_FIELD_DESCRIPTIONS = {
  suggested_cooperators:
    "Array de objetos {name, reason, material}. Envie um array real — NAO envie string JSON codificada.",
  cooperators:
    "Array de objetos {name, reason, material} registrados como cooperacao; material=true so quando a contribuicao mudou decisao, risco, teste, doc ou veredito.",
  active_credits: "Array de strings descrevendo creditos ativos herdados do ciclo de meeting.",
  decision: "Texto da decisao que fecha a reuniao (string nao vazia).",
  meeting_id: "ID da reuniao fechada, retornado por goal_meeting_close.",
  auto_classify: "Boolean — classificar candidatos de memoria automaticamente.",
  write_policy: "Enum 'auto_write' | 'classify_only' (default 'auto_write') — gravar memoraveis fortes direto ou apenas classificar."
} as const;

/**
 * Oracle de sequencia (fase 2A): valida os steps ENSINADOS contra o schema
 * vivo de tools/list. Duas testemunhas — a sequencia sai da funcao que emite
 * a mensagem real; o schema sai do servidor real. O oracle nunca deriva o
 * esperado do proprio codigo gerador da mensagem.
 */
export type SequenceSchemaIndex = Record<string, { required?: string[]; properties?: Record<string, unknown> }>;

export type SequenceValidationError = {
  step: number;
  tool: string;
  problem: string;
};

function isPlaceholder(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith("<") && value.trim().endsWith(">");
}

function typeMatches(value: unknown, property: Record<string, unknown> | undefined): boolean {
  if (!property || typeof property.type !== "string") {
    return true;
  }
  const expected = property.type;
  if (isPlaceholder(value)) {
    return true;
  }
  if (expected === "string") return typeof value === "string";
  if (expected === "number") return typeof value === "number";
  if (expected === "boolean") return typeof value === "boolean";
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return true;
}

export function validateSequenceSteps(
  steps: EnvelopeStep[],
  schemasByTool: SequenceSchemaIndex
): SequenceValidationError[] {
  const errors: SequenceValidationError[] = [];
  for (const step of steps) {
    const schema = schemasByTool[step.tool];
    if (!schema) {
      errors.push({ step: step.order, tool: step.tool, problem: "tool ausente no tools/list (schema vivo)" });
      continue;
    }
    const args = step.args ?? {};
    for (const requiredField of schema.required ?? []) {
      if (!(requiredField in args)) {
        errors.push({
          step: step.order,
          tool: step.tool,
          problem: `campo obrigatorio "${requiredField}" ausente nos args ensinados`
        });
      }
    }
    for (const [field, value] of Object.entries(args)) {
      const property = (schema.properties?.[field] ?? undefined) as Record<string, unknown> | undefined;
      if (!property && schema.properties) {
        errors.push({
          step: step.order,
          tool: step.tool,
          problem: `campo "${field}" nao existe no schema vivo da tool`
        });
        continue;
      }
      if (isPlaceholder(value)) {
        continue;
      }
      if (!typeMatches(value, property)) {
        errors.push({
          step: step.order,
          tool: step.tool,
          problem: `campo "${field}" com tipo ${typeof value} mas schema exige ${String(property?.type)}`
        });
      }
      const enumValues = Array.isArray(property?.enum) ? (property.enum as unknown[]) : null;
      if (enumValues && !isPlaceholder(value) && !enumValues.includes(value)) {
        errors.push({
          step: step.order,
          tool: step.tool,
          problem: `campo "${field}" com valor ${JSON.stringify(value)} fora do enum vivo ${JSON.stringify(enumValues)}`
        });
      }
    }
  }
  return errors;
}
