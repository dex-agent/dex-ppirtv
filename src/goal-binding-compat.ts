// Compatibilidade de goal binding — valida que um re-start reutiliza o mesmo
// envelope imutavel (idempotency_key/workspace/spt_path) e reporta divergencias
// de campo por nome. Extraido do flow-engine na onda da maratona 2026-11-17
// (Trilho maratona-pipeline-binding-261117, record SHRINK 2 do camping fiscal).
// Decompor Condicional: os 9 checks de campo viram predicates nomeados com a
// ORDEM HISTORICA preservada na mensagem GOAL_BINDING_MISMATCH.
import path from "node:path";
import type { GoalBinding, GoalBindingEnvelope, GoalEnvelope } from "./domain.js";
import { normalizeComparable } from "./lang-utils.js";

type BindingCompatContext = {
  existing: GoalBindingEnvelope;
  envelope: GoalEnvelope;
  binding: GoalBinding;
  contractFingerprint: string | null;
};

type BindingFieldCheck = {
  field: string;
  differs: (context: BindingCompatContext) => boolean;
};

const BINDING_FIELD_CHECKS: BindingFieldCheck[] = [
  {
    field: "objective",
    differs: ({ existing, envelope }) => normalizeComparable(existing.objective) !== normalizeComparable(envelope.objective)
  },
  {
    field: "evidence_required",
    differs: ({ existing, envelope }) => existing.evidence_required !== envelope.evidence_required
  },
  {
    field: "required_evidence",
    differs: ({ existing, envelope }) => !sameStringSet(existing.required_evidence, envelope.required_evidence)
  },
  {
    field: "requested_verdict_policy",
    differs: ({ existing, envelope }) => existing.requested_verdict_policy !== envelope.requested_verdict_policy
  },
  {
    field: "source",
    differs: ({ existing, envelope }) => existing.source !== envelope.source
  },
  {
    field: "risk_level",
    differs: ({ existing, envelope }) => envelope.risk_level !== undefined && existing.risk_level !== envelope.risk_level
  },
  {
    field: "flow_role",
    differs: ({ binding, envelope }) => envelope.flow_role !== undefined && binding.flow_role !== envelope.flow_role
  },
  {
    field: "spt_contract_fingerprint",
    differs: ({ binding, contractFingerprint }) => !binding.spt_contract_fingerprint || !contractFingerprint
  },
  {
    field: "spt_contract",
    differs: ({ binding, contractFingerprint }) =>
      Boolean(binding.spt_contract_fingerprint) &&
      Boolean(contractFingerprint) &&
      binding.spt_contract_fingerprint !== contractFingerprint
  }
];

export function assertCompatibleGoalBinding(
  binding: GoalBinding | undefined,
  envelope: GoalEnvelope,
  contractFingerprint: string | null
): void {
  if (!binding) {
    return;
  }
  const existing = binding.envelope;
  if (existing.idempotency_key !== envelope.idempotency_key) {
    throw new Error("flow_id is already bound to a different idempotency_key");
  }
  if (path.resolve(existing.workspace) !== path.resolve(envelope.workspace) || path.resolve(existing.spt_path) !== path.resolve(envelope.spt_path)) {
    throw new Error("idempotency_key is already bound to a different workspace or spt_path");
  }
  const context: BindingCompatContext = { existing, envelope, binding, contractFingerprint };
  const mismatches = BINDING_FIELD_CHECKS.filter((check) => check.differs(context)).map((check) => check.field);
  if (mismatches.length > 0) {
    throw new Error(`GOAL_BINDING_MISMATCH: immutable binding differs in ${mismatches.join(", ")}`);
  }
}

export function sameStringSet(left: string[], right: string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}
