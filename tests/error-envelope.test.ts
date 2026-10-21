import { describe, expect, it } from "vitest";
import {
  advanceGatesPending,
  fiscalBlockedAction,
  inputShapeEnvelope,
  normalizeFiscalBlockedMessage,
  unblockFor,
  validateSequenceSteps,
  type SequenceSchemaIndex
} from "../src/error-envelope.js";
import { parseSptDocument } from "../src/spt-contract.js";

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
    expect(action.tool).toBe("goal_verdict");
    expect(String(action.reason)).toContain("regress_count=3");
    expect(String(action.reason)).toContain("legacy alias: attempt_regress_count");
    expect(action.required_tool_sequence ?? []).toHaveLength(0);
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
  const schemas: SequenceSchemaIndex = {
    goal_meeting_open: {
      required: ["flow_id", "question"],
      properties: {
        flow_id: { type: "string" },
        question: { type: "string" },
        type: { type: "string", enum: ["divergent", "convergent", "transversal", "decision"] },
        suggested_cooperators: { type: "array" }
      }
    },
    goal_meeting_close: {
      required: ["flow_id", "meeting_id", "decision"],
      properties: {
        flow_id: { type: "string" },
        meeting_id: { type: "string" },
        decision: { type: "string" },
        participants_present: { type: "array" },
        satisfies_blockers: { type: "array" }
      }
    },
    goal_verdict: {
      required: ["flow_id", "status", "rationale", "next_step"],
      properties: {
        flow_id: { type: "string" },
        status: { type: "string", enum: ["pronto", "pronto_com_ressalvas", "nao_pronto", "bloqueado"] },
        rationale: { type: "string" },
        evidence_ids: { type: "array" },
        meeting_id: { type: "string" },
        next_step: { type: "string" }
      }
    },
    goal_status: {
      properties: {
        flow_id: { type: "string" },
        detail: { type: "string", enum: ["lean", "compact", "full"] }
      }
    },
    evidence_add: {
      required: ["flow_id", "title"],
      properties: {
        flow_id: { type: "string" },
        kind: { type: "string" },
        title: { type: "string" },
        scope_classification: { type: "string", enum: ["target", "declared_dependency", "outside"] },
        scope_reference: { type: "string" },
        satisfies: { type: "array" },
        observed_result: { type: "object" },
        reviewed_implementation_fingerprint: { type: "string" }
      }
    }
  };

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
});
