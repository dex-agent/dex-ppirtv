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

export type ReviewEvidenceDiagnostics = {
  valid: boolean;
  owner: "evidence_add";
  reasons: string[];
  scope_reference: string | null;
  authorized_scope: string[];
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
      result.reviewed_targets.map(normalizeReviewPath).includes(normalizeReviewPath(evidence.scope_reference)) &&
      reviewedTargetsCoverChangedFiles(flow, result.reviewed_targets)
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
    evidenceSatisfiesRequirement(flow, evidence, "regression_risks") &&
    reviewEvidenceRemainsCurrent(flow, evidence)
  );
}

export function reviewEvidenceDiagnostics(flow: Flow, evidence: Evidence): ReviewEvidenceDiagnostics {
  const reasons: string[] = [];
  const result = evidence.observed_result;
  const scopeReference = evidence.scope_reference?.trim() || null;
  if (evidence.flow_id !== flow.flow_id) reasons.push("flow_id_mismatch");
  if (!REVIEW_KINDS.has(evidence.kind)) reasons.push("review_kind_required");
  if (!scopeReference) reasons.push("scope_reference_required");
  else if (!scopeIsAuthorized(flow, evidence)) reasons.push("scope_reference_not_authorized");
  if (!evidence.satisfies?.includes("diff_reviewed")) reasons.push("diff_reviewed_not_claimed");
  if (!evidence.satisfies?.includes("barata_scan")) reasons.push("barata_scan_not_claimed");
  if (!evidence.satisfies?.includes("regression_risks")) reasons.push("regression_risks_not_claimed");
  if (!result) {
    reasons.push("observed_result_required");
  } else {
    if (result.diff_reviewed !== true) reasons.push("diff_reviewed_not_observed");
    if (!nonEmptyStringArray(result.reviewed_targets)) reasons.push("reviewed_targets_required");
    else {
      if (
        scopeReference &&
        !result.reviewed_targets.map(normalizeReviewPath).includes(normalizeReviewPath(scopeReference))
      ) {
        reasons.push("scope_reference_not_in_reviewed_targets");
      }
      if (!reviewedTargetsCoverChangedFiles(flow, result.reviewed_targets)) reasons.push("changed_files_not_fully_reviewed");
    }
    if (result.barata_scan !== true) reasons.push("barata_scan_not_observed");
    if (!nonEmptyStringArray(result.searched_patterns)) reasons.push("searched_patterns_required");
    if (!stringArray(result.findings)) reasons.push("findings_array_required");
    if (!stringArray(result.regression_risks)) reasons.push("regression_risks_array_required");
  }
  return {
    valid: reasons.length === 0,
    owner: "evidence_add",
    reasons,
    scope_reference: scopeReference,
    authorized_scope: uniqueStrings([...flow.changed_files, ...flow.scope.in]).filter((item) => !flow.scope.out.includes(item))
  };
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
  const reference = normalizeReviewPath(evidence.scope_reference as string);
  if (flow.scope.out.map(normalizeReviewPath).includes(reference)) {
    return false;
  }
  if (evidence.scope_classification === "target") {
    return flow.changed_files.map(normalizeReviewPath).includes(reference) || flow.scope.in.map(normalizeReviewPath).includes(reference);
  }
  if (evidence.scope_classification === "declared_dependency") {
    return flow.scope.in.map(normalizeReviewPath).includes(reference);
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

function reviewedTargetsCoverChangedFiles(flow: Flow, reviewedTargets: string[]): boolean {
  const normalizedTargets = new Set(reviewedTargets.map(normalizeReviewPath).filter(Boolean));
  const changedFiles = uniqueStrings(flow.changed_files.map(normalizeReviewPath).filter(Boolean));
  return changedFiles.every((changedFile) => normalizedTargets.has(changedFile));
}

function reviewEvidenceRemainsCurrent(flow: Flow, evidence: Evidence): boolean {
  const evidenceIndex = flow.history.findIndex(
    (event) => event.type === "evidence_attached" && event.data.evidence_id === evidence.evidence_id
  );
  if (evidenceIndex < 0) {
    return false;
  }
  let current = changedFilesSnapshotAt(flow, evidenceIndex);
  for (const event of flow.history.slice(evidenceIndex + 1)) {
    if (event.type === "flow_facts_updated") {
      if (!Object.prototype.hasOwnProperty.call(event.data, "changed_files")) {
        continue;
      }
      return false;
    }
    if (event.type !== "gate_checked" || event.data.phase !== "implementacao") {
      continue;
    }
    const provided = event.data.provided;
    if (
      !provided ||
      typeof provided !== "object" ||
      Array.isArray(provided) ||
      !Object.prototype.hasOwnProperty.call(provided, "changed_files")
    ) {
      continue;
    }
    const next = canonicalReviewPaths([
      ...current,
      ...reviewPathArray((provided as Record<string, unknown>).changed_files)
    ]);
    if (!sameReviewPaths(current, next)) {
      return false;
    }
    current = next;
  }
  return true;
}

function changedFilesSnapshotAt(flow: Flow, historyIndex: number): string[] {
  let changedFiles: string[] = [];
  for (const event of flow.history.slice(0, historyIndex + 1)) {
    if (event.type === "flow_facts_updated" && Object.prototype.hasOwnProperty.call(event.data, "changed_files")) {
      changedFiles = canonicalReviewPaths(reviewPathArray(event.data.changed_files));
      continue;
    }
    if (event.type !== "gate_checked" || event.data.phase !== "implementacao") {
      continue;
    }
    const provided = event.data.provided;
    if (
      provided &&
      typeof provided === "object" &&
      !Array.isArray(provided) &&
      Object.prototype.hasOwnProperty.call(provided, "changed_files")
    ) {
      changedFiles = canonicalReviewPaths([
        ...changedFiles,
        ...reviewPathArray((provided as Record<string, unknown>).changed_files)
      ]);
    }
  }
  return changedFiles;
}

function canonicalReviewPaths(values: string[]): string[] {
  return uniqueStrings(values.map(normalizeReviewPath).filter(Boolean)).sort();
}

function reviewPathArray(value: unknown): string[] {
  return stringArray(value) ? value : [];
}

function sameReviewPaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeReviewPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\/+/, "").toLowerCase();
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

function uniqueSources(values: GateRequirementResolution["accepted_sources"]): GateRequirementResolution["accepted_sources"] {
  return [...new Set(values)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
