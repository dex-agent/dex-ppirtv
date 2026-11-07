import type { SequenceSchemaIndex } from "../../src/error-envelope.js";

/**
 * Schema-index compartilhado das tools ensinadas em required_tool_sequence.
 *
 * Espelhado contra o tools/list REAL pelo teste-espelho do mcp.test.ts
 * (Trilho envelope-familia-todas-rotas-261107, C-06/C-07/C-10): required e
 * enums aqui devem bater com o inputSchema vivo do servidor — drift futuro
 * reprova a suite em vez de virar falso-verde/falso-vermelho na frota.
 *
 * Fontes vivas: src/server.ts (goalEnvelopeSchema l.192-205, goal_verdict
 * l.881+, flow_archive l.530+, spt_validate) e src/domain.ts l.31-36
 * (VERDICTS, GOAL_VERDICT_POLICIES, GOAL_FLOW_ROLES).
 */
export const SEQUENCE_SCHEMA_INDEX: SequenceSchemaIndex = {
  goal_meeting_open: {
    required: ["question"],
    properties: {
      flow_id: { type: "string" },
      question: { type: "string" },
      type: { type: "string", enum: ["divergent", "convergent", "transversal", "decision"] },
      suggested_cooperators: { type: "array" }
    }
  },
  goal_meeting_close: {
    required: ["meeting_id", "decision"],
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
      residual_risks: { type: "array" },
      review_artifact_path: { type: "string" },
      review_findings: { type: "array" },
      verdict_parking_lot: { type: "array" },
      verdict_gold_mining: { type: "array" },
      attempt_count: { type: "integer" },
      regress_count: { type: "integer" },
      recurring_risk: { type: "boolean" },
      meeting_id: { type: "string" },
      meeting_ids: { type: "array" },
      next_step: { type: "string" }
    }
  },
  goal_status: {
    properties: {
      flow_id: { type: "string" },
      detail: { type: "string", enum: ["lean", "compact", "full"] }
    }
  },
  goal_start: {
    required: ["workspace", "spt_path", "objective", "idempotency_key", "evidence_required", "source"],
    properties: {
      workspace: { type: "string" },
      spt_path: { type: "string" },
      objective: { type: "string" },
      flow_id: { type: "string" },
      idempotency_key: { type: "string" },
      evidence_required: { type: "boolean" },
      required_evidence: { type: "array" },
      requested_verdict_policy: { type: "string", enum: ["evidence_required", "allow_ressalvas", "draft"] },
      source: { type: "string" },
      risk_level: { type: "string", enum: ["high", "medium", "low", "mechanical"] },
      mode: { type: "string", enum: ["full", "compact", "lean"] },
      flow_role: { type: "string", enum: ["execution", "reconciliation", "recovery"] }
    }
  },
  spt_validate: {
    required: ["workspace", "spt_path"],
    properties: {
      workspace: { type: "string" },
      spt_path: { type: "string" },
      objective: { type: "string" }
    }
  },
  flow_archive: {
    required: ["flow_id"],
    properties: {
      flow_id: { type: "string" },
      reason: { type: "string" }
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
