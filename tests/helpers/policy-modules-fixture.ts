import type { Cooperator, Flow, Meeting } from "../../src/domain.js";

export function historyEvent(type: string, data: Record<string, unknown> = {}) {
  return { at: "2026-11-09T00:00:00.000Z", type, data };
}

export function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    flow_id: "flow_test",
    goal: "goal de teste",
    phase: "concepcao",
    status: "active",
    scope: { in: [], out: [] },
    risks: [],
    uncertainties: [],
    tasks: [],
    done_criteria: [],
    expected_evidence: [],
    changed_files: [],
    decisions: [],
    parking_lot: [],
    gold_mining: [],
    goal_learning_links: [],
    cooperators: [],
    active_credits: [],
    evidence: [],
    meetings: [],
    verdicts: [],
    gates: {},
    history: [],
    created_at: "2026-11-09T00:00:00.000Z",
    updated_at: "2026-11-09T00:00:00.000Z",
    ...overrides,
  };
}

export function makeCooperator(overrides: Partial<Cooperator> = {}): Cooperator {
  return { name: "$chato", reason: "fiscal do corte", material: true, ...overrides };
}

export function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    meeting_id: "meet-1",
    flow_id: "flow_test",
    type: "convergent",
    kind: "convergente",
    question: "pergunta material?",
    status: "open",
    opened_at: "2026-11-09T00:00:00.000Z",
    participants_required: [],
    participants_present: [],
    suggested_cooperators: [],
    questions: [],
    findings: [],
    hypotheses: [],
    alternatives: [],
    decisions: [],
    satisfies_blockers: [],
    evidence_ids: [],
    turns: [],
    risks: [],
    next_steps: [],
    affected_areas: [],
    impacts: [],
    owners: [],
    gates_extra: [],
    parking_lot: [],
    gold_mining: [],
    cooperators: [],
    active_credits: [],
    ...overrides,
  };
}
