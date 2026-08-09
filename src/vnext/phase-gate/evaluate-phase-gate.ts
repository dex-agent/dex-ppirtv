export type PhaseGateRequirementSnapshot = {
  readonly key: string;
  readonly satisfied: boolean;
};

export type PhaseGateJsonValue =
  | string
  | number
  | boolean
  | null
  | PhaseGateJsonValue[]
  | { [key: string]: PhaseGateJsonValue };

export type PhaseGateHistorySummary = {
  readonly action_signature: string;
  readonly attempt_count: number;
  readonly after_fingerprint: string | null;
  readonly required_proof: readonly string[];
};

export type PhaseGateSnapshot = {
  readonly phase: string;
  readonly current_phase: string;
  readonly has_next_phase: boolean;
  readonly requirements: readonly PhaseGateRequirementSnapshot[];
  readonly closure_blockers: readonly string[];
  readonly provided: Readonly<Record<string, PhaseGateJsonValue>>;
  readonly action_signature: string;
  readonly attempt_count: number;
  readonly before_fingerprint: string | null;
  readonly after_fingerprint: string | null;
  readonly required_proof: readonly string[];
};

export type AdvancePhaseAction = {
  tool: "goal_advance";
  provided?: Record<string, PhaseGateJsonValue>;
  missing?: string[];
};

export type PreviewFuturePhaseAction = {
  type: "preview_future_phase";
  executable: false;
  current_phase: string;
};

export type ResolveRepeatedGateFailureAction = {
  type: "resolve_repeated_gate_failure";
  executable: false;
  owner: "executor_orchestrator";
  action_signature: string;
  attempt_count: number;
  required_proof: string[];
};

export type PhaseGateDecision = {
  phase: string;
  passed: boolean;
  missing: string[];
  blockers: string[];
  closure_blockers: string[];
  phase_advance_allowed: boolean;
  next_required_action: AdvancePhaseAction | PreviewFuturePhaseAction | ResolveRepeatedGateFailureAction;
  classification: "compatibility" | "extension";
  action_signature: string;
  attempt_count: number;
};

export interface PhaseGateHistoryPort {
  load(actionSignature: string): Promise<PhaseGateHistorySummary | null>;
}

export function evaluatePhaseGate(snapshot: PhaseGateSnapshot): PhaseGateDecision {
  const missing = unique(snapshot.requirements.filter((item) => !item.satisfied).map((item) => item.key));
  const closureBlockers = unique(snapshot.closure_blockers);
  const blockers = unique([...missing, ...closureBlockers]);
  const passed = missing.length === 0;
  const isCurrentPhase = snapshot.phase === snapshot.current_phase;
  const repeatedWithoutChange = isRepeatedWithoutMaterialChange(snapshot);
  const attemptCount = effectiveAttemptCount(snapshot, repeatedWithoutChange);

  return {
    phase: snapshot.phase,
    passed,
    missing,
    blockers,
    closure_blockers: closureBlockers,
    phase_advance_allowed:
      isCurrentPhase && passed && (snapshot.has_next_phase || closureBlockers.length === 0),
    next_required_action: nextRequiredAction(
      snapshot,
      missing,
      passed,
      isCurrentPhase,
      repeatedWithoutChange,
      attemptCount
    ),
    classification: repeatedWithoutChange && missing.length > 0 ? "extension" : "compatibility",
    action_signature: snapshot.action_signature,
    attempt_count: attemptCount
  };
}

export async function evaluatePhaseGateWithHistory(
  snapshot: PhaseGateSnapshot,
  historyPort: PhaseGateHistoryPort
): Promise<PhaseGateDecision> {
  const stableSnapshot = cloneSnapshot(snapshot);
  const history = await historyPort.load(stableSnapshot.action_signature);
  if (!history) {
    return evaluatePhaseGate({
      ...stableSnapshot,
      attempt_count: 1
    });
  }
  const sameAction = history.action_signature === stableSnapshot.action_signature;
  const fingerprintsProveUnchanged = fingerprintsArePresentAndUnchanged(stableSnapshot, history);
  const materialStateChanged =
    !fingerprintsProveUnchanged
    || !sameStrings(history.required_proof, stableSnapshot.required_proof);
  return evaluatePhaseGate({
    ...stableSnapshot,
    attempt_count: sameAction && !materialStateChanged
      ? Math.max(stableSnapshot.attempt_count, history.attempt_count + 1)
      : 1
  });
}

function nextRequiredAction(
  snapshot: PhaseGateSnapshot,
  missing: string[],
  passed: boolean,
  isCurrentPhase: boolean,
  repeatedWithoutChange: boolean,
  attemptCount: number
): PhaseGateDecision["next_required_action"] {
  if (!isCurrentPhase) {
    return {
      type: "preview_future_phase",
      executable: false,
      current_phase: snapshot.current_phase
    };
  }
  if (repeatedWithoutChange && missing.length > 0) {
    return {
      type: "resolve_repeated_gate_failure",
      executable: false,
      owner: "executor_orchestrator",
      action_signature: snapshot.action_signature,
      attempt_count: attemptCount,
      required_proof: canonicalProof(snapshot.required_proof)
    };
  }
  if (passed) {
    return { tool: "goal_advance", provided: cloneJsonRecord(snapshot.provided) };
  }
  return { tool: "goal_advance", missing: [...missing] };
}

function isRepeatedWithoutMaterialChange(snapshot: PhaseGateSnapshot): boolean {
  return fingerprintPresent(snapshot.before_fingerprint)
    && fingerprintPresent(snapshot.after_fingerprint)
    && snapshot.before_fingerprint === snapshot.after_fingerprint
    && snapshot.attempt_count >= 2;
}

function effectiveAttemptCount(snapshot: PhaseGateSnapshot, repeatedWithoutChange: boolean): number {
  if (!fingerprintPresent(snapshot.before_fingerprint)
    || !fingerprintPresent(snapshot.after_fingerprint)
    || snapshot.before_fingerprint !== snapshot.after_fingerprint) {
    return 1;
  }
  return repeatedWithoutChange ? Math.max(2, snapshot.attempt_count) : Math.max(1, snapshot.attempt_count);
}

function fingerprintsArePresentAndUnchanged(
  snapshot: PhaseGateSnapshot,
  history: PhaseGateHistorySummary
): boolean {
  return fingerprintPresent(snapshot.before_fingerprint)
    && fingerprintPresent(snapshot.after_fingerprint)
    && fingerprintPresent(history.after_fingerprint)
    && snapshot.before_fingerprint === snapshot.after_fingerprint
    && history.after_fingerprint === snapshot.after_fingerprint;
}

function fingerprintPresent(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneSnapshot(snapshot: PhaseGateSnapshot): PhaseGateSnapshot {
  return {
    ...snapshot,
    requirements: snapshot.requirements.map((item) => ({
      ...item
    })),
    closure_blockers: [...snapshot.closure_blockers],
    provided: cloneJsonRecord(snapshot.provided),
    required_proof: [...snapshot.required_proof]
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const canonicalLeft = canonicalProof(left);
  const canonicalRight = canonicalProof(right);
  return canonicalLeft.length === canonicalRight.length
    && canonicalLeft.every((value, index) => value === canonicalRight[index]);
}

function canonicalProof(values: readonly string[]): string[] {
  return unique(values).sort();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function cloneJsonRecord(value: Readonly<Record<string, PhaseGateJsonValue>>): Record<string, PhaseGateJsonValue> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
}

function cloneJsonValue(value: PhaseGateJsonValue): PhaseGateJsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return cloneJsonRecord(value);
  }
  return value;
}
