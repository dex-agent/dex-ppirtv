import type { Evidence, Flow, GateRecord } from "./domain.js";
import type { GateRequirement } from "./phase-profile.js";
import { normalizeReviewPath } from "./review-snapshot.js";

export type GateRequirementResolution = {
  key: string;
  label: string;
  accepted_sources: Array<GateRequirement["source"] | "evidence">;
  satisfied: boolean;
  satisfied_by: GateRequirement["source"] | "evidence" | null;
  evidence_ids: string[];
  // SPT gate-integrity-hardening (T-2): quando o requisito e tipado
  // (source=provided) e nao foi satisfeito, o diagnostico nomeia campo,
  // valor recebido e tipo esperado. Opcional para nao quebrar consumidores.
  diagnostic?: ProvidedRequirementDiagnostic | null;
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
  // SPT review-gate-loop-proof (T-4): classificacao aditiva — shape do
  // observed_result (nested = chaves de review dentro de objetos) vs conteudo
  // (flat mas incompleto). Reasons existentes permanecem intactos.
  observed_result_shape: "flat" | "nested" | "missing";
  shape_guidance: string | null;
};

const EXPLICIT_EVIDENCE_REQUIREMENTS = new Set([
  "diff_reviewed",
  "barata_scan",
  "regression_risks",
  "test_executed"
]);

const REVIEW_KINDS = new Set(["code_review", "review"]);
const TEST_KINDS = new Set(["test", "test_log", "test_run"]);

// SPT gate-integrity-hardening (T-3, laudo F3): catalogo centralizado de
// extensoes de codigo. O fast-track "mechanical" so e honrado quando nenhum
// arquivo de codigo aparece em changed_files; codigo real exige o ciclo
// fiscal completo (review estruturada corroborada).
export const CODE_FILE_EXTENSIONS: readonly string[] = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".cs", ".kt", ".swift", ".dart",
  ".c", ".h", ".cpp", ".hpp", ".php", ".rb", ".sql", ".sh", ".ps1"
];

export function changedFilesContainCode(changedFiles: readonly string[]): boolean {
  return changedFiles.some((file) =>
    CODE_FILE_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension))
  );
}

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
    const diagnostic = satisfiedBy === null
      ? providedRequirementDiagnostic(requirement.key, provided[requirement.key])
      : null;
    return {
      key: requirement.key,
      label: requirement.label,
      accepted_sources: acceptedSources,
      satisfied: satisfiedBy !== null,
      satisfied_by: satisfiedBy,
      evidence_ids: evidenceIds,
      ...(diagnostic ? { diagnostic } : {})
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

// SPT review-gate-loop-proof (T-3): validade de evidencia de review para o
// evento evidence_attached — undefined para kinds nao-review (campo some do
// JSON persistido e o evento continua resetando, retrocompativel).
export function reviewEvidenceValidity(flow: Flow, evidence: Evidence): boolean | undefined {
  if (evidence.kind !== "code_review" && evidence.kind !== "review") {
    return undefined;
  }
  return reviewEvidenceDiagnostics(flow, evidence).valid;
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
  const nestedReviewKeys = [result?.diff_reviewed, result?.barata_scan].some(
    (value) => value !== null && typeof value === "object"
  );
  const observedResultShape: ReviewEvidenceDiagnostics["observed_result_shape"] = !result
    ? "missing"
    : nestedReviewKeys
      ? "nested"
      : "flat";
  const shapeGuidance = nestedReviewKeys
    ? "observed_result has review keys nested inside objects — send diff_reviewed and barata_scan as flat top-level booleans (true) and reviewed_targets/searched_patterns/findings/regression_risks as flat top-level arrays (this nested shape caused the 2026-10-17 retry loop)"
    : null;
  return {
    valid: reasons.length === 0,
    owner: "evidence_add",
    reasons,
    scope_reference: scopeReference,
    authorized_scope: authorizedReviewScope(flow),
    observed_result_shape: observedResultShape,
    shape_guidance: shapeGuidance
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
    return providedRequirementSatisfied(key, provided[key]);
  }
  if (source === "evidence") {
    // SPT gate-integrity-f4f5f6 (T-3, laudo F6): existencia de evidencia nao
    // e prova — exige evidencia relevante para o contrato da fase
    // (satisfies cobrindo expected_evidence OU receipt de teste valido).
    return genericEvidenceSatisfied(flow);
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

// Laudo F6: evidencia relevante para o requisito generico source=evidence.
function genericEvidenceSatisfied(flow: Flow): boolean {
  return flow.evidence.some((evidence) =>
    (evidence.satisfies ?? []).some((item) => flow.expected_evidence.includes(item))
    || isTestReceipt(evidence)
  );
}

// SPT gate-integrity-f4f5f6 (T-4, laudo F5): gates downstream (revisao em
// diante) so sao reutilizados quando o snapshot de changed_files gravado no
// momento do check permanece identico ao estado atual do flow. Gates legados
// sem snapshot nao sao reutilizados em flows com arquivos (fail-closed).
const DOWNSTREAM_REVIEW_PHASES = new Set(["revisao", "teste", "validacao"]);

export function gateSnapshotMatches(gate: GateRecord, changedFiles: string[]): boolean {
  return arraysSetEqual(gate.changed_files_snapshot ?? [], changedFiles);
}

export function invalidateStaleDownstreamGates(
  gates: Record<string, GateRecord>,
  changedFiles: string[]
): number {
  let dropped = 0;
  for (const phase of Object.keys(gates)) {
    const gate = gates[phase];
    if (gate.status === "passed" && DOWNSTREAM_REVIEW_PHASES.has(phase) && !gateSnapshotMatches(gate, changedFiles)) {
      delete gates[phase];
      dropped += 1;
    }
  }
  return dropped;
}

function arraysSetEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function isTestReceipt(evidence: Evidence): boolean {
  if (!TEST_KINDS.has(evidence.kind) || !evidence.observed_result) {
    return false;
  }
  const result = evidence.observed_result;
  return (
    nonNegativeInteger(result.passed)
    && nonNegativeInteger(result.failed)
    && result.passed + result.failed > 0
    && result.failed === 0
    && result.exit_code === 0
  );
}

function scopeIsAuthorized(flow: Flow, evidence: Evidence): boolean {
  const reference = normalizeReviewPath(evidence.scope_reference as string);
  const hasReviewableClassification = evidence.scope_classification === "target"
    || evidence.scope_classification === "declared_dependency";
  return hasReviewableClassification
    && authorizedReviewScope(flow).map(normalizeReviewPath).includes(reference);
}

function authorizedReviewScope(flow: Flow): string[] {
  const candidates = flow.changed_files.length > 0 ? flow.changed_files : flow.scope.in;
  const excluded = new Set(flow.scope.out.map(normalizeReviewPath));
  return uniqueStrings(candidates).filter((item) => !excluded.has(normalizeReviewPath(item)));
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
  if (flow.implementation_fingerprint || evidence.reviewed_implementation_fingerprint) {
    return Boolean(
      flow.implementation_fingerprint
      && evidence.reviewed_implementation_fingerprint === flow.implementation_fingerprint
    );
  }
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

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

// SPT gate-integrity-hardening (T-2, laudo F1): requisito de source=provided
// tem tipo contratado. O mapa substitui a interpretacao "truthy" que aceitava
// "false", "no", [] e {} como prova de execucao (divergencia gate-resolution
// x flow-engine medida no laudo de 2026-10-17).
export type ProvidedRequirementKind =
  | "boolean"
  | "non_empty_string"
  | "string_array"
  | "non_empty_string_array";

export const PROVIDED_REQUIREMENT_KINDS: Record<string, ProvidedRequirementKind> = {
  implementation_done: "boolean",
  diff_reviewed: "boolean",
  barata_scan: "boolean",
  test_executed: "boolean",
  memoria_viva_reconciled: "boolean",
  next_step: "non_empty_string",
  residual_risks: "string_array",
  regression_risks: "non_empty_string_array"
};

const NEGATIVE_STRING_MARKERS = new Set(["false", "no", "nao", "não", "null", "undefined", "0", "off"]);

export function providedRequirementSatisfied(key: string, value: unknown): boolean {
  const kind = PROVIDED_REQUIREMENT_KINDS[key];
  if (!kind) {
    return truthy(value);
  }
  switch (kind) {
    case "boolean":
      return value === true;
    case "non_empty_string": {
      if (typeof value !== "string") return false;
      const normalized = value.trim().toLowerCase();
      return normalized.length > 0 && !NEGATIVE_STRING_MARKERS.has(normalized);
    }
    case "string_array":
      return stringArray(value) && value.every((item) => item.trim().length > 0);
    case "non_empty_string_array":
      return stringArray(value) && value.length > 0 && value.every((item) => item.trim().length > 0);
  }
}

// Diagnostico de shape para gate bloqueado por tipo: nomeia campo, valor
// recebido e tipo esperado (o erro deixa de ser apenas "faltando").
export type ProvidedRequirementDiagnostic = {
  field: string;
  received: string;
  expected: string;
};

export function providedRequirementDiagnostic(
  key: string,
  value: unknown
): ProvidedRequirementDiagnostic | null {
  const kind = PROVIDED_REQUIREMENT_KINDS[key];
  if (!kind) {
    return null;
  }
  const expected = kind === "boolean"
    ? "boolean true"
    : kind === "non_empty_string"
      ? "texto nao vazio (negativos como \"false\"/\"no\" nao contam)"
      : kind === "string_array"
        ? "lista de textos (lista vazia e valida)"
        : "lista com pelo menos um texto nao vazio";
  return { field: key, received: describeProvidedValue(value), expected };
}

function describeProvidedValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "string") return `string "${value.slice(0, 40)}"`;
  return `${typeof value} ${String(value).slice(0, 40)}`;
}

function uniqueSources(values: GateRequirementResolution["accepted_sources"]): GateRequirementResolution["accepted_sources"] {
  return [...new Set(values)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
