import type { Evidence, Flow } from "./domain.js";
import type { GateRequirement } from "./phase-profile.js";

export type GateRequirementResolution = {
  key: string;
  label: string;
  accepted_sources: Array<GateRequirement["source"] | "evidence">;
  satisfied: boolean;
  satisfied_by: GateRequirement["source"] | "evidence" | null;
  evidence_ids: string[];
};

export type GateResolutionInput = {
  flow: Flow;
  requirements: GateRequirement[];
  provided?: Record<string, unknown>;
  canonicalVerdictRequired?: boolean;
};

const EXPLICIT_EVIDENCE_REQUIREMENTS = new Set([
  "diff_reviewed",
  "barata_scan",
  "regression_risks",
  "test_executed"
]);

const REVIEW_KINDS = new Set(["code_review", "review"]);
const TEST_KINDS = new Set(["test", "test_log", "test_run"]);

export function resolveGateRequirements(input: GateResolutionInput): GateRequirementResolution[] {
  const provided = input.provided ?? {};
  return input.requirements.map((requirement) => {
    const evidenceIds = input.flow.evidence
      .filter((evidence) => evidenceSatisfiesRequirement(input.flow, evidence, requirement.key))
      .map((evidence) => evidence.evidence_id);
    const acceptedSources: GateRequirementResolution["accepted_sources"] = EXPLICIT_EVIDENCE_REQUIREMENTS.has(requirement.key)
      ? uniqueSources([requirement.source, "evidence"])
      : [requirement.source];
    const sourceSatisfied = requirementSatisfiedBySource(
      input.flow,
      requirement.key,
      requirement.source,
      provided,
      input.canonicalVerdictRequired === true
    );
    const satisfiedBy = sourceSatisfied ? requirement.source : evidenceIds.length > 0 ? "evidence" : null;
    return {
      key: requirement.key,
      label: requirement.label,
      accepted_sources: acceptedSources,
      satisfied: satisfiedBy !== null,
      satisfied_by: satisfiedBy,
      evidence_ids: evidenceIds
    };
  });
}

export function evidenceSatisfiesRequirement(flow: Flow, evidence: Evidence, key: string): boolean {
  if (!EXPLICIT_EVIDENCE_REQUIREMENTS.has(key)) {
    return false;
  }
  if (evidence.flow_id !== flow.flow_id || !evidence.scope_reference || !scopeIsAuthorized(flow, evidence)) {
    return false;
  }
  if (!evidence.satisfies?.includes(key) || !evidence.observed_result) {
    return false;
  }
  const result = evidence.observed_result;
  if (key === "diff_reviewed") {
    return (
      REVIEW_KINDS.has(evidence.kind) &&
      result.diff_reviewed === true &&
      nonEmptyStringArray(result.reviewed_targets) &&
      result.reviewed_targets.includes(evidence.scope_reference)
    );
  }
  if (key === "barata_scan") {
    return (
      REVIEW_KINDS.has(evidence.kind) &&
      result.barata_scan === true &&
      nonEmptyStringArray(result.searched_patterns) &&
      stringArray(result.findings)
    );
  }
  if (key === "regression_risks") {
    return REVIEW_KINDS.has(evidence.kind) && stringArray(result.regression_risks);
  }
  if (key === "test_executed") {
    return (
      TEST_KINDS.has(evidence.kind) &&
      nonNegativeInteger(result.passed) &&
      nonNegativeInteger(result.failed) &&
      result.passed + result.failed > 0 &&
      result.failed === 0 &&
      result.exit_code === 0
    );
  }
  return false;
}

export function isStructuredReviewEvidence(flow: Flow, evidence: Evidence): boolean {
  return (
    evidenceSatisfiesRequirement(flow, evidence, "diff_reviewed") &&
    evidenceSatisfiesRequirement(flow, evidence, "barata_scan") &&
    evidenceSatisfiesRequirement(flow, evidence, "regression_risks")
  );
}

function requirementSatisfiedBySource(
  flow: Flow,
  key: string,
  source: GateRequirement["source"],
  provided: Record<string, unknown>,
  canonicalVerdictRequired: boolean
): boolean {
  if (source === "provided") {
    return truthy(provided[key]);
  }
  if (source === "evidence") {
    return flow.evidence.length > 0 || truthy(provided[key]);
  }
  if (source === "verdict") {
    return canonicalVerdictRequired ? false : flow.verdicts.length > 0 || truthy(provided[key]);
  }
  switch (key) {
    case "goal":
      return truthy(flow.goal);
    case "context":
      return truthy(flow.context) || truthy(provided.context);
    case "risks":
      return flow.risks.length > 0 || truthy(provided.risks);
    case "uncertainties":
      return flow.uncertainties.length > 0 || truthy(provided.uncertainties);
    case "scope_in":
      return flow.scope.in.length > 0 || truthy(provided.scope_in);
    case "scope_out":
      return flow.scope.out.length > 0 || truthy(provided.scope_out);
    case "tasks":
      return flow.tasks.length > 0 || truthy(provided.tasks);
    case "expected_evidence":
      return flow.expected_evidence.length > 0 || truthy(provided.expected_evidence);
    case "done_criteria":
      return flow.done_criteria.length > 0 || truthy(provided.done_criteria);
    case "changed_files":
      return flow.changed_files.length > 0 || truthy(provided.changed_files);
    default:
      return truthy(provided[key]);
  }
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function scopeIsAuthorized(flow: Flow, evidence: Evidence): boolean {
  const reference = evidence.scope_reference as string;
  if (flow.scope.out.includes(reference)) {
    return false;
  }
  if (evidence.scope_classification === "target") {
    return flow.changed_files.includes(reference) || flow.scope.in.includes(reference);
  }
  if (evidence.scope_classification === "declared_dependency") {
    return flow.scope.in.includes(reference);
  }
  return false;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return stringArray(value) && value.length > 0 && value.every((item) => {
    const normalized = item.trim();
    return normalized.length > 0 && !normalized.startsWith("<required:");
  });
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

function uniqueSources(values: GateRequirementResolution["accepted_sources"]): GateRequirementResolution["accepted_sources"] {
  return [...new Set(values)];
}
