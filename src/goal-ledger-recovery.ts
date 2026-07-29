import type { Flow, GoalEnvelope } from "./domain.js";
import type { PpirtvStore } from "./store.js";

export class GoalIdempotencyDuplicateBindingsError extends Error {
  readonly code = "GOAL_IDEMPOTENCY_DUPLICATE_BINDINGS" as const;
  readonly conflicting_flow_ids: string[];
  readonly next_required_action = {
    type: "inspect_goal_bindings",
    tool: "ppirtv_trace",
    reason: "multiple_flows_share_idempotency_key"
  } as const;

  constructor(flowIds: string[]) {
    super("GOAL_IDEMPOTENCY_DUPLICATE_BINDINGS: multiple flows share one idempotency_key");
    this.name = "GoalIdempotencyDuplicateBindingsError";
    this.conflicting_flow_ids = Array.from(
      new Set(flowIds.map((flowId) => (/^[A-Za-z0-9_-]{1,200}$/.test(flowId) ? flowId : "[invalid-flow-id]")))
    ).sort();
  }
}

export function assertLegacyFlowCanReceiveFirstGoalBinding(flow: Flow, envelope: GoalEnvelope): void {
  if (flow.goal_binding) {
    return;
  }
  if (flow.goal !== envelope.objective) {
    throw new Error(
      `GOAL_LEGACY_FLOW_OBJECTIVE_MISMATCH: legacy flow objective "${flow.goal}" differs from official objective "${envelope.objective}"`
    );
  }
  if (flow.verdicts.length > 0) {
    throw new Error(
      "GOAL_LEGACY_FLOW_VERDICTS_PRESENT: legacy advisory verdicts cannot become authority for an official GOAL"
    );
  }
}

export async function ensureLedgerTransitionRecorded(
  store: PpirtvStore,
  flow: Flow,
  transition: {
    originalType: string;
    recoveredType: string;
    originalAt: string;
    data: Record<string, unknown>;
    actor?: string;
  }
): Promise<void> {
  const ledger = await store.readLedger(flow.flow_id);
  if (ledger.some((event) => event.type === transition.originalType || event.type === transition.recoveredType)) {
    return;
  }
  await store.appendLedger({
    event_id: await store.nextId("evt"),
    flow_id: flow.flow_id,
    type: transition.recoveredType,
    timestamp: new Date().toISOString(),
    actor: transition.actor ?? "codex",
    data: {
      ...transition.data,
      original_event_type: transition.originalType,
      original_at: transition.originalAt,
      recovery_reason: "state_persisted_ledger_missing"
    }
  });
}
