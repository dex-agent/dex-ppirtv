export type NormalizedLegacyPhaseGate = {
  phase: string;
  status: "passed" | "blocked";
  missing: string[];
  blockers: string[];
  phase_blockers: string[];
  closure_blockers: string[];
  phase_advance_allowed: boolean;
  next_required_action: unknown;
};

export function normalizeLegacyPhaseGate(input: Record<string, unknown>): NormalizedLegacyPhaseGate {
  const missing = stringArray(input.missing);
  const phaseBlockers = stringArray(input.phase_blockers);
  const closureBlockers = stringArray(input.closure_blockers);
  return {
    phase: String(input.phase ?? ""),
    status: input.status === "passed" && missing.length === 0 ? "passed" : "blocked",
    missing,
    blockers: unique([...phaseBlockers, ...closureBlockers]),
    phase_blockers: phaseBlockers,
    closure_blockers: closureBlockers,
    phase_advance_allowed: input.phase_advance_allowed === true,
    next_required_action: input.next_required_action ?? null
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
    : [];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
