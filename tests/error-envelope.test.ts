import { describe, expect, it } from "vitest";
import {
  advanceGatesPending,
  fiscalBlockedAction,
  goalStartRequiredAction,
  inputShapeEnvelope,
  normalizeFiscalBlockedMessage,
  recoverTraceabilityRequiredAction,
  unblockFor,
  validateSequenceSteps,
  type SequenceSchemaIndex
} from "../src/error-envelope.js";
import { parseSptDocument } from "../src/spt-contract.js";
import { SEQUENCE_SCHEMA_INDEX } from "./helpers/sequence-schema-index.js";

describe("error envelope contract (PPIRTV-ERRO-QUE-ENSINA-ENVELOPE)", () => {
  it("fiscal blocked envelope teaches the insufficient-attempts branch with state numbers and the cooperation sequence", () => {
    const message = "PPIRTV_FISCAL_BLOCKED: attempt_regress_count, attempts_insufficient_before_positive_verdict; attempt_count=0, regress_count=0, max=3, meetings=0";
    const action = fiscalBlockedAction(message, "flow_test");
    expect(action.type).toBe("run_cooperation_cycle_before_positive_verdict");
    expect(action.tool).toBe("goal_meeting_open");
    expect(String(action.reason)).toContain("attempt_count=0");
    const sequence = action.required_tool_sequence ?? [];
    const open = sequence.find((step) => step.tool === "goal_meeting_open");
    const close = sequence.find((step) => step.tool === "goal_meeting_close");
    const verdict = sequence.find((step) => step.tool === "goal_verdict");
    expect(open).toBeDefined();
    expect(close).toBeDefined();
    expect(verdict).toBeDefined();
    expect(JSON.stringify(open?.args)).toContain("suggested_cooperators");
    expect(JSON.stringify(open?.args)).not.toContain('"cooperators"');
    expect(JSON.stringify(verdict?.args)).toContain("meeting_id");
    expect(sequence.some((step) => step.tool === "goal_regress")).toBe(true);
  });

  it("fiscal blocked envelope teaches the regress limit branch without inviting another regress", () => {
    const message = "PPIRTV_FISCAL_BLOCKED: attempt_regress_count, attempt_regress_limit_reached; attempt_count=4, regress_count=3, max=3, meetings=2";
    const action = fiscalBlockedAction(message, "flow_test");
    expect(action.type).toBe("stop_regressing_and_fix_work");
    expect(action.tool).toBe("flow_archive");
    expect(String(action.reason)).toContain("regress_count=3");
    expect(String(action.reason)).toContain("legacy alias: attempt_regress_count");
    expect(String(action.reason)).not.toMatch(/repita o veredito/i);
    expect(String(action.reason)).toMatch(/ressalva|encerr/i);
  });

  it("composite review_required + regress limit ends with the terminal reservation route, never a positive verdict", () => {
    const message = "PPIRTV_FISCAL_BLOCKED: review_required, attempt_regress_count, attempt_regress_limit_reached; attempt_count=4, regress_count=3, max=3, meetings=2";
    const action = fiscalBlockedAction(message, "flow_test");
    expect(action.type).toBe("attach_structural_review_before_meetings");
    const seq = JSON.stringify(action.required_tool_sequence ?? []);
    expect(seq).toContain("flow_archive");
    expect(seq).not.toMatch(/"status"\s*:\s*"pronto"/);
    expect(seq).toContain("nao_pronto");
  });

  it("composite required_cooperation + regress limit routes terminal via the limit branch (engine order), not a meeting loop", () => {
    const message = "PPIRTV_FISCAL_BLOCKED: attempt_regress_count, attempt_regress_limit_reached, required_cooperation; attempt_count=4, regress_count=3, max=3, meetings=2";
    const action = fiscalBlockedAction(message, "flow_test");
    expect(action.type).toBe("stop_regressing_and_fix_work");
    expect(action.tool).toBe("flow_archive");
    expect(String(action.reason)).toMatch(/ressalva|encerr/i);
    expect(String(action.reason)).not.toMatch(/repita o veredito/i);
  });

  it("composite required_cooperation + review_required routes review-first with the executable code_review recipe", () => {
    const message =
      "PPIRTV_FISCAL_BLOCKED: required_cooperation, review_required; attempt_count=0, regress_count=0, max=3, meetings=2; required_cooperation=chato|questionador";
    const action = fiscalBlockedAction(message, "flow_test");
    expect(action.type).toBe("attach_structural_review_before_meetings");
    expect(action.tool).toBe("evidence_add");
    expect(String(action.reason)).toContain("review_required");
    const sequence = action.required_tool_sequence ?? [];
    const statusStep = sequence.find((step) => step.tool === "goal_status");
    expect(JSON.stringify(statusStep?.args)).toContain("full");
    const reviewStep = sequence.find((step) => step.tool === "evidence_add");
    expect(reviewStep?.args?.kind).toBe("code_review");
    expect(reviewStep?.args?.scope_classification).toBe("target");
    expect(String(reviewStep?.args?.scope_reference)).toContain("escopo");
    expect(JSON.stringify(reviewStep?.args?.satisfies)).toContain("diff_reviewed");
    expect(JSON.stringify(reviewStep?.args?.observed_result)).toContain("reviewed_targets");
    expect(String(reviewStep?.args?.reviewed_implementation_fingerprint)).toContain("implementation_fingerprint");
    // F1: a reuniao que o close fecha precisa nascer na propria sequencia
    const openIndex = sequence.findIndex((step) => step.tool === "goal_meeting_open");
    const closeIndex = sequence.findIndex((step) => step.tool === "goal_meeting_close");
    expect(openIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeGreaterThan(openIndex);
    // F2: close sem participants_present fecha sem satisfazer (silencio)
    const closeStep = sequence[closeIndex];
    expect(JSON.stringify(closeStep?.args?.participants_present)).toContain("participants_required");
    expect(JSON.stringify(closeStep?.args?.satisfies_blockers)).toContain("required_cooperation");
    // F4: verdict positivo sem evidence_ids falha ou e rebaixado
    const verdictStep = sequence.find((step) => step.tool === "goal_verdict");
    expect(JSON.stringify(verdictStep?.args?.evidence_ids)).toContain("evidence_id");
    expect(JSON.stringify(verdictStep?.args)).toContain("meeting_id");
  });

  it("pure review_required (sem required_cooperation) ensina review + verdict SEM meeting_id", () => {
    const message = "PPIRTV_FISCAL_BLOCKED: review_required; attempt_count=0, regress_count=0, max=3, meetings=0";
    const action = fiscalBlockedAction(message, "flow_test");
    expect(action.type).toBe("attach_structural_review_before_meetings");
    const sequence = action.required_tool_sequence ?? [];
    expect(sequence.find((step) => step.tool === "evidence_add")).toBeDefined();
    expect(sequence.find((step) => step.tool === "goal_meeting_close")).toBeUndefined();
    expect(sequence.find((step) => step.tool === "goal_meeting_open")).toBeUndefined();
    const verdictStep = sequence.find((step) => step.tool === "goal_verdict");
    expect(JSON.stringify(verdictStep?.args)).not.toContain("meeting_id");
    expect(JSON.stringify(verdictStep?.args?.evidence_ids)).toContain("evidence_id");
  });

  it("review_required lidera sobre attempts_insufficient e attempt_regress_limit_reached", () => {
    const withAttempts = fiscalBlockedAction(
      "PPIRTV_FISCAL_BLOCKED: attempt_regress_count, attempts_insufficient_before_positive_verdict, review_required; attempt_count=0, regress_count=0, max=3, meetings=0"
    );
    expect(withAttempts.type).toBe("attach_structural_review_before_meetings");
    expect((withAttempts.required_tool_sequence ?? []).some((step) => step.tool === "evidence_add")).toBe(true);
    const withLimit = fiscalBlockedAction(
      "PPIRTV_FISCAL_BLOCKED: attempt_regress_limit_reached, review_required; attempt_count=4, regress_count=3, max=3, meetings=2"
    );
    expect(withLimit.type).toBe("attach_structural_review_before_meetings");
    expect((withLimit.required_tool_sequence ?? []).some((step) => step.tool === "evidence_add")).toBe(true);
  });

  it("fiscal blocked envelope teaches satisfies_blockers in the pure required_cooperation route", () => {
    const message =
      "PPIRTV_FISCAL_BLOCKED: required_cooperation; attempt_count=0, regress_count=0, max=3, meetings=0; required_cooperation=chato";
    const action = fiscalBlockedAction(message, "flow_test");
    expect(action.type).toBe("register_required_cooperation");
    expect(String(action.reason)).toContain("satisfies_blockers");
    const close = (action.required_tool_sequence ?? []).find((step) => step.tool === "goal_meeting_close");
    expect(JSON.stringify(close?.args?.satisfies_blockers)).toContain("required_cooperation");
    expect(JSON.stringify(close?.args?.participants_present)).toContain("participants_required");
    const verdict = (action.required_tool_sequence ?? []).find((step) => step.tool === "goal_verdict");
    expect(JSON.stringify(verdict?.args?.evidence_ids)).toContain("evidence");
  });

  it("taught verdict rationales never re-arm required_cooperation (positiveMeetingTrigger literals)", () => {
    // flow-engine positiveMeetingTrigger casa literais no texto fiscal do
    // veredito ANTES de checar a meeting que satisfaz (rodada adversarial
    // F4-residual, probe 2026-10-21): rationale ensinada com
    // "cooperacao material" rejeita o veredito mesmo com a meeting correta.
    const trigger =
      /(sem reuniao|reuniao obrigatoria|reuniao material|mesa material|cooperacao material|sem meeting_id|participantes insuficientes)/i;
    const messages = [
      "PPIRTV_FISCAL_BLOCKED: required_cooperation; attempt_count=0, regress_count=0, max=3, meetings=0; required_cooperation=chato",
      "PPIRTV_FISCAL_BLOCKED: required_cooperation, review_required; attempt_count=0, regress_count=0, max=3, meetings=2; required_cooperation=chato",
      "PPIRTV_FISCAL_BLOCKED: review_required; attempt_count=0, regress_count=0, max=3, meetings=0"
    ];
    for (const message of messages) {
      const action = fiscalBlockedAction(message, "flow_test");
      const verdictSteps = (action.required_tool_sequence ?? []).filter((step) => step.tool === "goal_verdict");
      expect(verdictSteps.length).toBeGreaterThan(0);
      for (const step of verdictSteps) {
        const rationale = String((step.args as { rationale?: string } | undefined)?.rationale ?? "");
        expect(trigger.test(rationale)).toBe(false);
      }
    }
  });

  it("fiscal blocked envelope omits empty required_cooperation segments", () => {
    const raw = "PPIRTV_FISCAL_BLOCKED: attempt_regress_count, attempts_insufficient_before_positive_verdict; attempt_count=0, regress_count=0, max=3, meetings=0; required_cooperation=";
    const normalized = normalizeFiscalBlockedMessage(raw);
    expect(normalized).not.toMatch(/required_cooperation=($|;|\s)/);
    expect(normalized).toContain("attempt_count=0");
    const named = normalizeFiscalBlockedMessage(
      "PPIRTV_FISCAL_BLOCKED: required_cooperation; required_cooperation=fiscal-de-evidencia"
    );
    expect(named).toContain("required_cooperation=fiscal-de-evidencia");
  });

  it("advance blocked response exposes gates_pending with expected shapes", () => {
    const pending = advanceGatesPending(["test_executed", "residual_risks", "campo_novo"], "revisao");
    expect(pending.phase).toBe("revisao");
    expect(pending.gates_pending).toHaveLength(3);
    expect(pending.gates_pending.map((gate) => gate.field)).toEqual(
      expect.arrayContaining(["test_executed", "residual_risks", "campo_novo"])
    );
    const testGate = pending.gates_pending.find((gate) => gate.field === "test_executed");
    expect(String(testGate?.expected)).toContain("boolean true");
    const fallbackGate = pending.gates_pending.find((gate) => gate.field === "campo_novo");
    expect(String(fallbackGate?.expected)).toContain("campo_novo");
  });

  it("input shape envelope reports field received_type expected_type and example", () => {
    const issues = [
      {
        path: ["suggested_cooperators"],
        expected: "array",
        received: "string",
        message: "Invalid input: expected array, received string"
      }
    ];
    const envelopes = inputShapeEnvelope(issues);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.field).toBe("suggested_cooperators");
    expect(envelopes[0]?.received_type).toBe("string");
    expect(envelopes[0]?.expected_type).toBe("array");
    expect(JSON.stringify(envelopes[0]?.example)).toContain("response-evidence-fiscal");
    expect(JSON.stringify(envelopes[0])).toContain("expected_type");
  });

  it("unblock table routes untranslated MCP code families", () => {
    const cases: { message: string; code: string; tool: string }[] = [
      { message: "MEMORY_CANDIDATES_NOT_MINED: consumo antes de minerar", code: "MEMORY_CANDIDATES_NOT_MINED", tool: "mm_memory_mining" },
      { message: "MEMORY_CANDIDATE_PROMOTION_TAG_INVALID: tag fora do padrao", code: "MEMORY_CANDIDATE_PROMOTION_INVALID", tool: "mm_memory_candidate_resolve" },
      { message: "GOAL_TERMINAL_FLOW_UNBOUND: flow concluido", code: "FLOW_TERMINAL_IMMUTABLE", tool: "spt_validate" },
      { message: "GOAL_WORKSPACE_STORE_MISMATCH: runtime em outro workspace", code: "GOAL_WORKSPACE_STORE_MISMATCH", tool: "runtime_probe" },
      { message: "PROGRESS_TOTAL_INVALID: total zero", code: "PROGRESS_COUNTERS_INVALID", tool: "goal_progress_record" },
      { message: "REVIEW_SNAPSHOT_SENSITIVE_PATH: path sensiveis", code: "REVIEW_SNAPSHOT_PATH_INVALID", tool: "evidence_add" },
      { message: "DELETED_FILES_NOT_CHANGED: remocao nao declarada", code: "DELETED_FILES_NOT_CHANGED", tool: "goal_advance" },
      { message: "MEETING_LOCKED: reuniao presa por lock", code: "MEETING_LOCK_INVALID", tool: "goal_status" },
      { message: "MEETING_STALE_LOCK_IDENTITY_CHANGED: lock velho", code: "MEETING_LOCK_INVALID", tool: "goal_status" }
    ];
    for (const testCase of cases) {
      const routed = unblockFor(testCase.message);
      expect(routed?.code).toBe(testCase.code);
      expect(routed?.action.tool).toBe(testCase.tool);
      expect(routed?.action.type).toBeTruthy();
      expect(routed?.action.reason).toBeTruthy();
    }
    expect(unblockFor("erro totalmente desconhecido")).toBeNull();
  });

  it("spt parse appends quote hint for object-received list items", () => {
    const document = [
      "---",
      "dex_contract: spt",
      "version: 3",
      "status: ativo",
      "owner: teste",
      "date: '2026-10-15'",
      "workspace: 'C:\\\\ws'",
      "origin: teste",
      "goal:",
      "  id: teste",
      "  title: teste",
      "  objective: teste",
      "context: teste",
      "problem: teste",
      "decision: teste",
      "scope:",
      "  include:",
      "    - item com dois pontos: vira mapping",
      "  exclude:",
      "    - fora",
      "plan:",
      "  - plano",
      "requirements:",
      "  - id: R-1",
      "    statement: req",
      "    criteria:",
      "      - id: C-1",
      "        statement: crit",
      "tasks:",
      "  - id: T-1",
      "    action: task",
      "    covers:",
      "      - R-1",
      "    done_when:",
      "      - C-1",
      "    depends_on: []",
      "    evidence_requirements:",
      "      - id: ER-1",
      "        proves:",
      "          - C-1",
      "        method: command",
      "        procedure: proc",
      "        expectation:",
      "          kind: command_exit",
      "          expected_exit_code: 0",
      "closure_gates:",
      "  - gate",
      "risks:",
      "  - risco",
      "uncertainties:",
      "  - incerteza",
      "gates:",
      "  - gate",
      "validation:",
      "  - validacao",
      "execution_prompt: prompt",
      "---"
    ].join("\n");
    const result = parseSptDocument(document);
    expect(result.contract).toBeNull();
    const hint = result.errors.find((error) => error.includes("scope.include"));
    expect(hint).toBeTruthy();
    expect(String(hint)).toContain("quote");
  });
});

describe("sequence oracle validates taught steps against live schemas", () => {
  // Index movido para tests/helpers/sequence-schema-index.ts (compartilhado
  // com o espelho do mcp.test.ts, que o valida contra o tools/list REAL do
  // servidor — drift de required/enum reprova a suite, nao a frota) e
  // completado neste corte: enums de requested_verdict_policy/risk_level/mode,
  // flow_role e tool flow_archive (P2#2 do smoke 261107, 3 lentes convergentes).
  const schemas: SequenceSchemaIndex = SEQUENCE_SCHEMA_INDEX;

  it("accepts the taught meeting sequence when every required field and enum matches the live schema", () => {
    const action = fiscalBlockedAction(
      "PPIRTV_FISCAL_BLOCKED: required_cooperation; attempt_count=0, regress_count=0, max=3, meetings=1; required_cooperation=chato|questionador"
    );
    const errors = validateSequenceSteps(action.required_tool_sequence ?? [], schemas);
    expect(errors).toEqual([]);
  });

  it("oracle accepts the review-first composite sequence against live-shaped schemas", () => {
    const action = fiscalBlockedAction(
      "PPIRTV_FISCAL_BLOCKED: required_cooperation, review_required; attempt_count=0, regress_count=0, max=3, meetings=2; required_cooperation=chato"
    );
    const sequence = action.required_tool_sequence ?? [];
    expect(sequence.find((step) => step.tool === "evidence_add")).toBeDefined();
    const errors = validateSequenceSteps(sequence, schemas);
    expect(errors).toEqual([]);
  });

  it("rejects the historic decisao regression: invalid enum value in taught args", () => {
    const regression = fiscalBlockedAction(
      "PPIRTV_FISCAL_BLOCKED: required_cooperation; attempt_count=0, regress_count=0, max=3, meetings=1; required_cooperation=chato"
    );
    const steps = (regression.required_tool_sequence ?? []).map((step) =>
      step.tool === "goal_meeting_open" ? { ...step, args: { ...step.args, type: "decisao" } } : step
    );
    const errors = validateSequenceSteps(steps, schemas);
    expect(errors.some((error) => error.problem.includes("fora do enum vivo"))).toBe(true);
  });

  it("rejects taught steps missing required fields of the live schema", () => {
    const action = fiscalBlockedAction(
      "PPIRTV_FISCAL_BLOCKED: required_cooperation; attempt_count=0, regress_count=0, max=3, meetings=1"
    );
    const stripped = (action.required_tool_sequence ?? []).map((step) => {
      if (step.tool !== "goal_verdict") return step;
      const args = { ...step.args };
      delete args.rationale;
      return { ...step, args };
    });
    const errors = validateSequenceSteps(stripped, schemas);
    expect(errors.some((error) => error.problem.includes("rationale"))).toBe(true);
  });

  it("treats placeholder args as substitution obligations, not literal values", () => {
    const errors = validateSequenceSteps(
      [{ order: 2, tool: "goal_meeting_close", args: { flow_id: "f1", meeting_id: "<meeting_id retornado por goal_meeting_open>", decision: "ok" } }],
      schemas
    );
    expect(errors).toEqual([]);
  });

  // Vacina do P1 do workflow revisao-adversarial (6 lentes, 2026-11-07):
  // sequencia de goal_start SEM evidence_required (a forma que o schema vivo
  // rejeitava com PPIRTV_INPUT_INVALID) e REPROVADA aqui; os builders curados
  // em error-envelope.ts passam. RED documentado: esta e a forma que esteve
  // em producao no commit 052304a (passo 3 do TRACEABILITY_MISSING e
  // goalStartRequiredAction antigo).
  it("REPROVA sequencia de goal_start sem evidence_required (forma do P1, forma antiga)", () => {
    const oldShape = [
      { order: 1, tool: "goal_status", args: { flow_id: "f1", detail: "full" } },
      { order: 2, tool: "spt_validate", args: { workspace: "<workspace>", spt_path: "<spt_path>", objective: "<objective>" } },
      {
        order: 3,
        tool: "goal_start",
        args: {
          workspace: "<workspace>",
          spt_path: "<spt_path>",
          objective: "<objective>",
          idempotency_key: "<idempotency_key>",
          source: "<source>",
          flow_id: "f1"
        }
      }
    ];
    const errors = validateSequenceSteps(oldShape, schemas);
    expect(errors.some((error) => error.problem.includes("evidence_required"))).toBe(true);
  });

  it("APROVA recoverTraceabilityRequiredAction contra o schema vivo (com evidence_required)", () => {
    const action = recoverTraceabilityRequiredAction("flow-1");
    const errors = validateSequenceSteps(action.required_tool_sequence ?? [], schemas);
    expect(errors).toEqual([]);
  });

  it("APROVA goalStartRequiredAction contra o schema vivo (com evidence_required)", () => {
    const action = goalStartRequiredAction("flow-1");
    const errors = validateSequenceSteps(action.required_tool_sequence ?? [], schemas);
    expect(errors).toEqual([]);
  });

  // Vacina da rota do teto terminal (P1 do smoke 261107, 4a copia da classe):
  // a rota composta review_required + attempt_regress_limit_reached ensina a
  // sequencia do probe real do adversario [goal_status, evidence_add,
  // goal_verdict, flow_archive, goal_start] — o goal_start do tail omitia os
  // 2 campos obrigatorios. Curada com evidence_required true + source, a
  // sequencia INTEIRA passa no oraculo (antes: probe esbuild + oraculo
  // reprovava; nenhum teste cobria esta rota).
  it("VACINA teto terminal: composto review_required + attempt_regress_limit_reached produz sequencia inteira aprovada pelo oraculo", () => {
    const action = fiscalBlockedAction(
      "PPIRTV_FISCAL_BLOCKED: review_required, attempt_regress_count, attempt_regress_limit_reached; attempt_count=4, regress_count=3, max=3, meetings=2"
    );
    const sequence = action.required_tool_sequence ?? [];
    expect(sequence.some((step) => step.tool === "flow_archive")).toBe(true);
    expect(sequence.some((step) => step.tool === "goal_start")).toBe(true);
    const errors = validateSequenceSteps(sequence, schemas);
    expect(errors).toEqual([]);
  });

  it("RED documentado: goal_start do teto terminal na forma antiga (sem evidence_required e sem source) reprova citando os 2 campos", () => {
    const oldShape = [
      {
        order: 3,
        tool: "goal_start",
        args: {
          workspace: "<workspace>",
          spt_path: "<trilho do novo corte>",
          objective: "<objetivo do novo corte>",
          idempotency_key: "<chave>"
        }
      }
    ];
    const errors = validateSequenceSteps(oldShape, schemas);
    expect(errors.some((error) => error.problem.includes("evidence_required"))).toBe(true);
    expect(errors.some((error) => error.problem.includes("source"))).toBe(true);
  });

  // P2#1 do smoke (contratos + adversario convergentes): placeholder string em
  // campo boolean reprova verbatim POR TIPO. A prova e composta: o espelho do
  // mcp.test.ts garante index == inputSchema real do servidor, e este teste
  // garante que o valor ENSINADO (true literal) bate com o tipo do index —
  // logo a chamada verbatim passa no schema vivo.
  it("replay verbatim-por-tipo: evidence_required ensinado como true literal (boolean) nas 3 rotas de goal_start", () => {
    const recover = recoverTraceabilityRequiredAction("flow-1").required_tool_sequence?.find(
      (step) => step.tool === "goal_start"
    );
    const direct = goalStartRequiredAction("flow-1").required_tool_sequence?.find(
      (step) => step.tool === "goal_start"
    );
    const terminal = fiscalBlockedAction(
      "PPIRTV_FISCAL_BLOCKED: review_required, attempt_regress_count, attempt_regress_limit_reached; attempt_count=4, regress_count=3, max=3, meetings=2"
    ).required_tool_sequence?.find((step) => step.tool === "goal_start");
    const goalStartProps = schemas.goal_start?.properties as Record<string, { type: string }> | undefined;
    for (const step of [recover, direct, terminal]) {
      expect(step).toBeDefined();
      const taught = (step?.args as Record<string, unknown>).evidence_required;
      expect(taught).toBe(true);
      expect(typeof taught).toBe(goalStartProps?.evidence_required?.type);
    }
  });
});
