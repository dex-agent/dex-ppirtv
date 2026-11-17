import { describe, expect, it } from "vitest";
import { assertCompatibleGoalBinding, sameStringSet } from "../src/goal-binding-compat.js";
import type { GoalBinding, GoalEnvelope } from "../src/domain.js";

// Caracterizacao do cluster goal binding (caracterizacoes da maratina NUNCA
// sao podadas — Trilho maratona-pipeline-binding-261117, A-02). Asserts
// derivados do comportamento historico do flow-engine.ts l.4730-4779 antes da
// extracao: mensagens EXATAS e ORDEM dos campos preservadas.

function envelope(overrides: Partial<GoalEnvelope> = {}): GoalEnvelope {
  return {
    workspace: "C:/work/ws",
    spt_path: "C:/work/ws/.agents/PLAN-TASKS/t.md",
    objective: "objetivo literal",
    idempotency_key: "key-1",
    evidence_required: true,
    required_evidence: ["er-1"],
    requested_verdict_policy: "evidence_required",
    source: "test",
    ...overrides
  };
}

function binding(overrides: { envelope?: Partial<GoalEnvelope>; binding?: Partial<GoalBinding> } = {}): GoalBinding {
  return {
    envelope: envelope(overrides.envelope ?? {}),
    started_at: "2026-11-17T00:00:00.000Z",
    last_seen_at: "2026-11-17T00:00:00.000Z",
    spt_contract_fingerprint: "fp-1",
    ...overrides.binding
  };
}

describe("goal binding compat (caracterizacao maratona 2026-11-17)", () => {
  it("nao lanca quando binding ausente ou envelopes compativeis", () => {
    expect(() => assertCompatibleGoalBinding(undefined, envelope(), null)).not.toThrow();
    expect(() => assertCompatibleGoalBinding(binding(), envelope(), "fp-1")).not.toThrow();
  });

  it("rejeita primeiro idempotency_key divergente com mensagem historica", () => {
    expect(() =>
      assertCompatibleGoalBinding(binding({ envelope: { idempotency_key: "key-2" } }), envelope(), "fp-1")
    ).toThrow("flow_id is already bound to a different idempotency_key");
  });

  it("rejeita workspace ou spt_path divergentes com mensagem historica", () => {
    expect(() =>
      assertCompatibleGoalBinding(binding({ envelope: { workspace: "C:/other" } }), envelope(), "fp-1")
    ).toThrow("idempotency_key is already bound to a different workspace or spt_path");
  });

  it("reporta cada campo divergente pelo nome na ordem historica", () => {
    const divergent = binding({
      envelope: {
        objective: "outro objetivo",
        evidence_required: false,
        required_evidence: ["er-9"],
        requested_verdict_policy: "draft",
        source: "other"
      }
    });
    expect(() => assertCompatibleGoalBinding(divergent, envelope(), "fp-1")).toThrow(
      "GOAL_BINDING_MISMATCH: immutable binding differs in objective, evidence_required, required_evidence, requested_verdict_policy, source"
    );
  });

  it("compara objective de forma tolerante (case e espacos)", () => {
    const tolerant = binding({ envelope: { objective: "  OBJETIVO   literal " } });
    expect(() => assertCompatibleGoalBinding(tolerant, envelope(), "fp-1")).not.toThrow();
  });

  it("compara required_evidence como conjunto (ordem e duplicatas ignoradas)", () => {
    const reordened = binding({ envelope: { required_evidence: ["er-1", "er-1"] } });
    expect(() => assertCompatibleGoalBinding(reordened, envelope(), "fp-1")).not.toThrow();
  });

  it("ignora risk_level do envelope quando ausente e reporta quando divergente", () => {
    const semRisk = binding({ envelope: { risk_level: "high" } });
    expect(() => assertCompatibleGoalBinding(semRisk, envelope(), "fp-1")).not.toThrow();

    const comRiskDivergente = binding({ envelope: { risk_level: "high" } });
    expect(() => assertCompatibleGoalBinding(comRiskDivergente, envelope({ risk_level: "low" }), "fp-1")).toThrow(
      "GOAL_BINDING_MISMATCH: immutable binding differs in risk_level"
    );
  });

  it("reporta flow_role divergente apenas quando o envelope declara", () => {
    const base = binding({ binding: { flow_role: "execution" } });
    expect(() => assertCompatibleGoalBinding(base, envelope(), "fp-1")).not.toThrow();
    expect(() => assertCompatibleGoalBinding(base, envelope({ flow_role: "reconciliation" }), "fp-1")).toThrow(
      "GOAL_BINDING_MISMATCH: immutable binding differs in flow_role"
    );
  });

  it("sameStringSet compara conjuntos ignorando ordem e duplicatas (caracterizacao direta)", () => {
    expect(sameStringSet(["a", "b"], ["b", "a", "a"])).toBe(true);
    expect(sameStringSet(["a"], ["b"])).toBe(false);
    expect(sameStringSet([], [])).toBe(true);
  });

  it("diferencia fingerprint ausente de fingerprint divergente", () => {
    expect(() => assertCompatibleGoalBinding(binding(), envelope(), null)).toThrow(
      "GOAL_BINDING_MISMATCH: immutable binding differs in spt_contract_fingerprint"
    );
    expect(() => assertCompatibleGoalBinding(binding(), envelope(), "fp-outro")).toThrow(
      "GOAL_BINDING_MISMATCH: immutable binding differs in spt_contract"
    );
  });
});
