import { describe, expect, it } from "vitest";
import {
  advanceGatesPending,
  fiscalBlockedAction,
  inputShapeEnvelope,
  normalizeFiscalBlockedMessage,
  unblockFor
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
