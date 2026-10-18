import type { Evidence, Flow, GateRecord } from "./domain.js";
import { REQUIREMENT_KINDS_BY_KEY, type GateRequirement, type GateRequirementKind } from "./phase-profile.js";
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

// SPT gate-integrity-hardening-2 (R6, laudo de revalidacao 2026-10-18):
// allowlist invertida — so e documental o que termina em extensao documental
// explícita. Path sem extensao (scripts/deploy, Makefile, Dockerfile,
// Procfile, Justfile) e codigo por padrao: o fast-track mechanical nunca e
// concedido por buraco de allowlist.
export const DOCUMENT_FILE_EXTENSIONS: readonly string[] = [".md", ".txt", ".rst", ".adoc"];

export function isDocumentalFile(file: string): boolean {
  const normalized = file.toLowerCase();
  return DOCUMENT_FILE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

export function changedFilesContainCode(changedFiles: readonly string[]): boolean {
  return changedFiles.some((file) => !isDocumentalFile(file));
}

// SPT gate-integrity-hardening-3 (R2): contrato estrito de paths. O
// stringArray legado do monolito converte escalar/objeto em lista e deixa o
// valor passar antes do gate tipado; este helper falha antes do merge.
export function strictPathArray(value: unknown, field = "changed_files"): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`PPIRTV_INPUT_INVALID: ${field} must be an array of non-empty relative paths`);
  }
  const paths: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`PPIRTV_INPUT_INVALID: ${field} must contain only non-empty string paths`);
    }
    paths.push(item);
  }
  return paths;
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
      requirement,
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

// SPT gate-integrity-hardening-3 (R3): review estruturada que ainda cobre o
// implementation_fingerprint atual. Claims-only/test receipt nao contam.
export function hasCurrentStructuredReview(flow: Flow): boolean {
  return flow.evidence.some((evidence) => isStructuredReviewEvidence(flow, evidence));
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

// SPT gate-integrity-hardening-2 (R2/R10, laudo de revalidacao 2026-10-18):
// nenhuma source interpreta prova por "truthy". source=flow exige o valor do
// tipo contratado no flow OU um provided do MESMO tipo (listas nao vazias de
// textos nao vazios, texto nao vazio/negativo, boolean true). Chave sem kind
// conhecido falha fechada.
function valueSatisfiesKind(value: unknown, kind: GateRequirementKind): boolean {
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

const FLOW_REQUIREMENT_FIELDS: Record<string, keyof Flow | "scope_in" | "scope_out"> = {
  goal: "goal",
  context: "context",
  risks: "risks",
  uncertainties: "uncertainties",
  scope_in: "scope_in",
  scope_out: "scope_out",
  tasks: "tasks",
  expected_evidence: "expected_evidence",
  done_criteria: "done_criteria",
  changed_files: "changed_files"
};

function flowRequirementValue(flow: Flow, key: string): unknown {
  if (key === "scope_in") return flow.scope.in;
  if (key === "scope_out") return flow.scope.out;
  return flow[key as keyof Flow];
}

function requirementSatisfiedBySource(
  flow: Flow,
  requirement: GateRequirement,
  provided: Record<string, unknown>,
  canonicalVerdictRequired: boolean
): boolean {
  const key = requirement.key;
  const kind = requirement.kind ?? REQUIREMENT_KINDS_BY_KEY[key];
  if (kind === undefined) {
    // R10: requisito sem tipo contratado falha fechado (configuracao do
    // perfil precisa tipar a chave antes de poder passar).
    return false;
  }
  if (requirement.source === "provided") {
    return valueSatisfiesKind(provided[key], kind);
  }
  if (requirement.source === "evidence") {
    // SPT gate-integrity-f4f5f6 (T-3, laudo F6): existencia de evidencia nao
    // e prova — exige evidencia relevante para o contrato da fase
    // (satisfies cobrindo expected_evidence, receipt de teste valido OU,
    // desde o hardening-2 (R5), criterion_proof SPT v3 aprovado).
    return genericEvidenceSatisfied(flow);
  }
  if (requirement.source === "verdict") {
    if (canonicalVerdictRequired) return false;
    return flow.verdicts.length > 0 || valueSatisfiesKind(provided[key], kind);
  }
  if (requirement.source === "flow") {
    const field = FLOW_REQUIREMENT_FIELDS[key];
    if (field === undefined) return false;
    return valueSatisfiesKind(flowRequirementValue(flow, key), kind)
      || valueSatisfiesKind(provided[key], kind);
  }
  return false;
}



// SPT gate-integrity-hardening-3 (R2): fatos de paths com contrato estrito.
export function mergePathFacts(
  currentChanged: string[],
  facts: Record<string, unknown>,
  currentDeleted: string[] | undefined
): { changed_files: string[]; deleted_files: string[] } {
  const changed = Object.prototype.hasOwnProperty.call(facts, "changed_files")
    ? uniqueStrings(strictPathArray(facts.changed_files, "changed_files"))
    : currentChanged;
  const deleted = Object.prototype.hasOwnProperty.call(facts, "deleted_files")
    ? uniqueStrings(strictPathArray(facts.deleted_files, "deleted_files"))
    : (currentDeleted ?? []);
  return { changed_files: changed, deleted_files: deleted };
}

// SPT gate-integrity-hardening-3 (R3): missing de review quando o gate de
// revisao ficou stale same-path e nao ha review estruturada atual.
export function reviewCurrencyMissing(phase: string, priorGate: GateRecord | undefined, flow: Flow): string[] {
  if (phase !== "revisao" || priorGate === undefined) return [];
  const fingerprintChanged = (priorGate.implementation_fingerprint ?? null) !== (flow.implementation_fingerprint ?? null);
  const alreadyFlagged = (priorGate.missing ?? []).includes("review_current");
  if (!fingerprintChanged && !alreadyFlagged) return [];
  return hasCurrentStructuredReview(flow) ? [] : ["review_current"];
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// Laudo F6: evidencia relevante para o requisito generico source=evidence.
function genericEvidenceSatisfied(flow: Flow): boolean {
  return flow.evidence.some((evidence) =>
    (evidence.satisfies ?? []).some((item) => flow.expected_evidence.includes(item))
    || isTestReceipt(evidence)
    // SPT gate-integrity-hardening-2 (R5, laudo de revalidacao): a rota
    // declarativa SPT v3 grava criterion_proof na evidencia; uma prova
    // aprovada e evidencia relevante — nao exige receipt manual nem satisfies.
    || evidence.criterion_proof?.passed === true
  );
}

// SPT gate-integrity-f4f5f6 (T-4, laudo F5): gates downstream (revisao em
// diante) so sao reutilizados quando o snapshot de changed_files gravado no
// momento do check permanece identico ao estado atual do flow. Gates legados
// sem snapshot nao sao reutilizados em flows com arquivos (fail-closed).
const DOWNSTREAM_REVIEW_PHASES = new Set(["revisao", "teste", "validacao"]);

// SPT gate-integrity-hardening-2 (R3): fases cuja validade de gate depende da
// moeda de conteudo revisado (paths E fingerprint).
export function reviewCurrencyAppliesToPhase(phase: string): boolean {
  return DOWNSTREAM_REVIEW_PHASES.has(phase);
}

// SPT gate-integrity-hardening-2 (R3, laudo de revalidacao): o gate e valido
// para o CONTEUDO revisado — paths E fingerprint. Gate sem fingerprint gravado
// (legado) nao e reusavel quando o flow tem fingerprint atual (fail-closed).
export function gateSnapshotMatches(
  gate: GateRecord,
  changedFiles: string[],
  currentFingerprint?: string | null
): boolean {
  if (!arraysSetEqual(gate.changed_files_snapshot ?? [], changedFiles)) {
    return false;
  }
  if (currentFingerprint === undefined) {
    return true;
  }
  return (gate.implementation_fingerprint ?? null) === (currentFingerprint ?? null);
}

// SPT gate-integrity-hardening-2 (R6 da regua da casa): decisao de reuse de
// gate salvo vivia duplicada em dois sites do monolito; unificada aqui.
export function savedGateReusable(
  savedGate: GateRecord | undefined,
  changedFiles: string[],
  currentFingerprint: string | null | undefined,
  opts: { providedPresent: boolean; needsCanonicalVerdict: boolean }
): savedGate is GateRecord {
  return Boolean(
    savedGate
    && !opts.providedPresent
    && savedGate.status === "passed"
    && gateSnapshotMatches(savedGate, changedFiles, currentFingerprint ?? null)
    && !opts.needsCanonicalVerdict
  );
}

export function invalidateStaleDownstreamGates(
  gates: Record<string, GateRecord>,
  changedFiles: string[],
  currentFingerprint?: string | null
): number {
  let dropped = 0;
  for (const phase of Object.keys(gates)) {
    const gate = gates[phase];
    if (
      gate.status === "passed"
      && DOWNSTREAM_REVIEW_PHASES.has(phase)
      && !gateSnapshotMatches(gate, changedFiles, currentFingerprint)
    ) {
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
    // SPT gate-integrity-hardening-2 (R10): chave sem tipo contratado falha
    // fechada — interpretar "truthy" aqui reabriria o buraco que o F1 fechou.
    return false;
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
