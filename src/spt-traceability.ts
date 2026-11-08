import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isSensitiveWorkspacePath } from "./review-snapshot.js";
import type {
  CriterionProof,
  CriterionProofInput,
  Evidence,
  EvidenceRevision,
  Flow,
  SptEvidenceExpectation,
  SptV3Contract,
  SptV3EvidenceRequirement,
  SptV3Task,
  SptV3Traceability
} from "./domain.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function requiresGoalEvidence(flow: Flow): boolean {
  const envelope = flow.goal_binding?.envelope;
  return envelope?.requested_verdict_policy === "evidence_required" || envelope?.evidence_required === true;
}

// FE-DEBT-006 (Onda 2b): pre-indexacao O(C+E) da traceability. O qualify e a
// cobertura deixam de varrer arrays (.find linear) por criterio anexado e
// consultam Maps construidos uma unica vez. O indice NAO mora no objeto (o
// shape persistido {requirements, tasks} e contrato publico): vive num cache
// WeakMap — flows antigos lidos do disco ganham o indice lazy na 1a consulta,
// sem migracao de disco.
export type SptTraceIndex = {
  taskById: Map<string, SptV3Task>;
  criteriaByRequirementId: Map<string, Set<string>>;
  evidenceRequirementById: Map<string, SptV3EvidenceRequirement>;
  evidenceRequirementIdsByTaskId: Map<string, Set<string>>;
  requirementIdByCriterionId: Map<string, string>;
  ownerHintByCriterionId: Map<string, { taskId: string; evidenceRequirementId: string }>;
};

const traceIndexCache = new WeakMap<SptV3Traceability, SptTraceIndex>();

export function traceIndexFor(traceability: SptV3Traceability): SptTraceIndex {
  const cached = traceIndexCache.get(traceability);
  if (cached) return cached;
  const taskById = new Map<string, SptV3Task>();
  const criteriaByRequirementId = new Map<string, Set<string>>();
  const evidenceRequirementById = new Map<string, SptV3EvidenceRequirement>();
  const evidenceRequirementIdsByTaskId = new Map<string, Set<string>>();
  const requirementIdByCriterionId = new Map<string, string>();
  const ownerHintByCriterionId = new Map<string, { taskId: string; evidenceRequirementId: string }>();
  for (const requirement of traceability.requirements) {
    const criteria = new Set<string>();
    for (const criterion of requirement.criteria) {
      criteria.add(criterion.id);
      if (!requirementIdByCriterionId.has(criterion.id)) {
        requirementIdByCriterionId.set(criterion.id, requirement.id);
      }
    }
    criteriaByRequirementId.set(requirement.id, criteria);
  }
  for (const task of traceability.tasks) {
    taskById.set(task.id, task);
    const evidenceRequirementIds = new Set<string>();
    const doneWhen = new Set(task.done_when);
    for (const evidenceRequirement of task.evidence_requirements) {
      evidenceRequirementIds.add(evidenceRequirement.id);
      if (!evidenceRequirementById.has(evidenceRequirement.id)) {
        evidenceRequirementById.set(evidenceRequirement.id, evidenceRequirement);
      }
      for (const criterionId of evidenceRequirement.proves) {
        if (doneWhen.has(criterionId) && !ownerHintByCriterionId.has(criterionId)) {
          ownerHintByCriterionId.set(criterionId, {
            taskId: task.id,
            evidenceRequirementId: evidenceRequirement.id
          });
        }
      }
    }
    evidenceRequirementIdsByTaskId.set(task.id, evidenceRequirementIds);
  }
  const index: SptTraceIndex = {
    taskById,
    criteriaByRequirementId,
    evidenceRequirementById,
    evidenceRequirementIdsByTaskId,
    requirementIdByCriterionId,
    ownerHintByCriterionId
  };
  traceIndexCache.set(traceability, index);
  return index;
}

export function traceabilityFromContract(contract: SptV3Contract): SptV3Traceability {
  const traceability: SptV3Traceability = {
    requirements: contract.requirements,
    tasks: contract.tasks
  };
  traceIndexFor(traceability);
  return traceability;
}

// FE-DEBT-006 (Onda 2b): payload do evento de auditoria do re-attach — helper
// puro para o motor colar sem carregar politica SPT inline.
export function sptTraceabilityReattachedEventData(
  flowId: string,
  contractFingerprint: string | undefined
): Record<string, unknown> {
  return {
    flow_id: flowId,
    spt_contract_version: 3,
    spt_contract_fingerprint: contractFingerprint,
    recovered_by: "goal_start_rebind"
  };
}

export function taskProjection(contract: SptV3Contract): string[] {
  return contract.tasks.map((task) => `${task.id}: ${task.action}`);
}

export function criterionProjection(contract: SptV3Contract): string[] {
  return contract.requirements.flatMap((requirement) =>
    requirement.criteria.map((criterion) => `${criterion.id} ${requirement.id}: ${criterion.statement}`)
  );
}

export function evidenceRequirementProjection(contract: SptV3Contract): string[] {
  return contract.tasks.flatMap((task) =>
    task.evidence_requirements.map(
      (requirement) => `${requirement.id} ${task.id}: ${requirement.method} — ${requirement.procedure}`
    )
  );
}

export function qualifyCriterionProof(
  traceability: SptV3Traceability,
  input: CriterionProofInput
): CriterionProof {
  // FE-DEBT-006 (Onda 2b): consultas O(1) pelo indice pre-construido —
  // semantica de erro preservada (mesma mensagem para id inexistente e id
  // existente fora do dono, como os .find originais).
  const index = traceIndexFor(traceability);
  const task = index.taskById.get(input.task_id);
  if (!task) throw proofError("unknown_task", input.task_id);
  if (!index.criteriaByRequirementId.has(input.requirement_id)) {
    throw proofError("unknown_requirement", input.requirement_id);
  }
  const criterionOwned = index.criteriaByRequirementId.get(input.requirement_id)!.has(input.criterion_id);
  if (!criterionOwned) {
    throw proofError("criterion_not_owned_by_requirement", `${input.criterion_id}/${input.requirement_id}`);
  }
  if (!task.covers.includes(input.requirement_id)) {
    throw proofError("task_does_not_cover_requirement", `${task.id}/${input.requirement_id}`);
  }
  if (!task.done_when.includes(input.criterion_id)) {
    throw proofError("criterion_not_in_task_done_when", `${task.id}/${input.criterion_id}`);
  }
  const evidenceRequirementOwned = index.evidenceRequirementIdsByTaskId
    .get(task.id)!
    .has(input.evidence_requirement_id);
  if (!evidenceRequirementOwned) {
    throw proofError("evidence_requirement_not_owned_by_task", `${input.evidence_requirement_id}/${task.id}`);
  }
  const evidenceRequirement = index.evidenceRequirementById.get(input.evidence_requirement_id)!;
  if (!evidenceRequirement.proves.includes(input.criterion_id)) {
    throw proofError("evidence_requirement_does_not_prove_criterion", `${evidenceRequirement.id}/${input.criterion_id}`);
  }
  validateProofProvenance(input);
  const evaluation = evaluateExpectation(evidenceRequirement.expectation, input.observed_value);
  return {
    ...input,
    expectation: evidenceRequirement.expectation,
    passed: evaluation.passed,
    evaluation: evaluation.message
  };
}

// Issue #10 (frota travada em tentativa-e-erro): o verdict cego listava apenas
// os criterion_ids descobertos. O diagnostico por criterio diz POR QUE cada
// um esta descoberto e COMO fechar em 1 rodada — prova citada reprovada (com
// a evaluation literal e aviso quando existe prova aprovada nao citada) ou
// nenhuma prova de criterio citada (nomeando a ER/task dona e os ids citados).
export type CriterionCoverageDiagnostic = {
  criterion_id: string;
  reason: string;
};

const DETAILS_MAX_LENGTH = 4000;

export function criterionCoverageDiagnostics(
  traceability: SptV3Traceability,
  evidence: Evidence[],
  selectedEvidenceIds: string[]
): CriterionCoverageDiagnostic[] {
  const selected = new Set(selectedEvidenceIds);
  const passedCriteria = new Set(
    evidence
      .filter((item) => selected.has(item.evidence_id) && item.criterion_proof?.passed === true)
      .map((item) => item.criterion_proof!.criterion_id)
  );
  const diagnostics: CriterionCoverageDiagnostic[] = [];
  // Revisao adversarial (P2 consenso): invariante do loop hoisted — recalcula-
  // lo por criterio inflava o cap 4000 em N x citados sem informacao nova.
  const citedIds = evidence
    .filter((item) => selected.has(item.evidence_id))
    .map((item) => item.evidence_id);
  const citedList = citedIds.length ? citedIds.join(", ") : "nenhum";
  for (const requirement of traceability.requirements) {
    for (const criterion of requirement.criteria) {
      if (passedCriteria.has(criterion.id)) continue;
      const citedProofs = evidence.filter(
        (item) =>
          selected.has(item.evidence_id)
          && item.criterion_proof?.criterion_id === criterion.id
      );
      const ownerHintPair = traceIndexFor(traceability).ownerHintByCriterionId.get(criterion.id);
      const ownerHint = ownerHintPair
        ? ` via ${ownerHintPair.evidenceRequirementId} na task ${ownerHintPair.taskId}`
        : "";
      const approvedNotCited = evidence
        .filter((item) => !selected.has(item.evidence_id) && item.criterion_proof?.criterion_id === criterion.id && item.criterion_proof?.passed === true)
        .map((item) => item.evidence_id);
      // Revisao adversarial (glm53 P2): acao-primeiro — quando existe prova
      // aprovada nao citada, CITAR e o caminho de 1 rodada; "anexe" primeiro
      // induzia o re-anexo duplicado (o proprio loop da issue #10).
      const approvedHint = approvedNotCited.length
        ? `; cite a prova ja aprovada ${approvedNotCited.join(", ")} no verdict (anexe nova declarative_proof${ownerHint} apenas se a aprovada estiver stale)`
        : "";
      const reason = citedProofs.length === 0
        ? `no_criterion_proof: nenhuma evidencia citada carrega criterion_proof para este criterio${ownerHint}; citados neste verdict: ${citedList}${approvedHint || `; anexe declarative_proof${ownerHint} e cite o evidence_id no verdict`}`
        : `proof_not_passed: ${citedProofs
            .map((item) => `${item.evidence_id} (${item.criterion_proof?.evaluation ?? "sem evaluation"})`)
            .join(" | ")}${approvedHint}`;
      diagnostics.push({ criterion_id: criterion.id, reason });
    }
  }
  return diagnostics;
}

// Issue #10 review-fixes: cap defensivo — details cresce com criterios x
// provas citadas; truncagem declarada na propria mensagem.
function cappedCoverageDetails(details: string): string {
  if (details.length <= DETAILS_MAX_LENGTH) return details;
  return `${details.slice(0, DETAILS_MAX_LENGTH)}…[truncado em ${DETAILS_MAX_LENGTH} caracteres]`;
}

export async function assertCriterionProofRevisionCurrent(
  proof: CriterionProof,
  authorizedWorkspace: string
): Promise<void> {
  const stalePaths = await staleRevisionPaths(proof, authorizedWorkspace);
  if (stalePaths.length > 0) {
    throw new Error(`SPT_V3_EVIDENCE_STALE: criterion proof revision differs from current files; paths=${stalePaths.join(",")}`);
  }
}

// FE-2026-11-07-ISSUE10-VERDICT-DIAGNOSTICO (SHRINK): o gate SPT v3 do
// verdict positivo inteiro (traceability presente + provas citadas frescas +
// cobertura minima por criterio COM diagnostico do por que cada criterio esta
// descoberto — issue #10) sai da fachada flow-engine e mora com o resto da
// politica SPT. Erro que ensina: proof_not_passed carrega a evaluation
// literal; no_criterion_proof nomeia a rota de correcao.
export async function assertSptV3PositiveVerdictCoverage(
  flow: {
    spt_traceability?: SptV3Traceability;
    evidence: Evidence[];
    goal_binding: { envelope: { workspace: string } };
  },
  evidenceIds: string[]
): Promise<void> {
  if (!flow.spt_traceability) {
    throw new Error("SPT_V3_TRACEABILITY_MISSING: flow is bound to v3 without its canonical traceability map (recover: goal_start re-bind com a mesma idempotency_key do binding reata o mapa)");
  }
  const staleCriterionProofPaths = await staleSelectedCriterionProofPaths(
    flow.evidence,
    evidenceIds,
    flow.goal_binding.envelope.workspace
  );
  if (staleCriterionProofPaths.length > 0) {
    throw new Error(
      `SPT_V3_EVIDENCE_STALE: selected criterion proof revision differs from current files; paths=${staleCriterionProofPaths.join(",")}`
    );
  }
  // review-fixes: uma unica passada de diagnostics (o wrapper duplo era
  // computacao repetida); a lista de descobertos deriva do proprio diagnostico.
  const diagnostics = criterionCoverageDiagnostics(flow.spt_traceability, flow.evidence, evidenceIds);
  if (diagnostics.length > 0) {
    const uncoveredCriteria = diagnostics.map((diagnostic) => diagnostic.criterion_id);
    const details = cappedCoverageDetails(
      diagnostics.map((diagnostic) => `${diagnostic.criterion_id}: ${diagnostic.reason}`).join("; ")
    );
    throw new Error(
      `SPT_V3_CRITERION_COVERAGE_REQUIRED: positive verdict requires passed evidence for every minimum criterion; missing=${uncoveredCriteria.join(",")}; details=[${details}]`
    );
  }
}

export async function staleSelectedCriterionProofPaths(
  evidence: Evidence[],
  selectedEvidenceIds: string[],
  authorizedWorkspace: string
): Promise<string[]> {
  const selected = new Set(selectedEvidenceIds);
  const stale = await Promise.all(
    evidence
      .filter((item) => selected.has(item.evidence_id) && item.criterion_proof?.passed === true)
      .map((item) => staleRevisionPaths(item.criterion_proof!, authorizedWorkspace))
  );
  return [...new Set(stale.flat())].sort();
}

function validateProofProvenance(input: CriterionProofInput): void {
  if (!input.environment.trim()) throw proofError("environment_required");
  if (!input.producer.trim()) throw proofError("producer_required");
  if (!input.limits.length || input.limits.some((limit) => !limit.trim())) {
    throw proofError("limits_required");
  }
  const timestamp = Date.parse(input.timestamp);
  if (!Number.isFinite(timestamp)) throw proofError("timestamp_invalid", input.timestamp);
  if (!input.revision_set.length) throw proofError("revision_set_required");
  for (const revision of input.revision_set) {
    if (!revision.workspace.trim()) throw proofError("revision_workspace_required");
    if (!revision.paths.length) throw proofError("revision_paths_required", revision.workspace);
    for (const item of revision.paths) {
      if (!item.path.trim()) throw proofError("revision_path_required", revision.workspace);
      if (!SHA256_PATTERN.test(item.sha256)) {
        throw proofError("revision_sha256_invalid", `${revision.workspace}/${item.path}`);
      }
    }
  }
}

async function staleRevisionPaths(proof: CriterionProof, authorizedWorkspace: string): Promise<string[]> {
  const stale: string[] = [];
  for (const revision of proof.revision_set) {
    assertRevisionWorkspaceAuthorized(revision.workspace, authorizedWorkspace);
    for (const item of revision.paths) {
      if (!(await revisionPathMatches(revision.workspace, item.path, item.sha256))) {
        stale.push(item.path);
      }
    }
  }
  return stale;
}

export async function buildEvidenceRevision(
  authorizedWorkspace: string,
  paths: string[]
): Promise<EvidenceRevision> {
  if (!paths.length) throw proofError("revision_paths_required", authorizedWorkspace);
  const entries: EvidenceRevision["paths"] = [];
  for (const relativePath of paths) {
    let resolved: string;
    try {
      resolved = await resolveWorkspaceFilePath(authorizedWorkspace, relativePath);
    } catch (error) {
      if (isMissingPathError(error)) throw proofError("revision_path_missing", relativePath);
      throw error;
    }
    if (!(await stat(resolved)).isFile()) throw proofError("revision_path_not_a_file", relativePath);
    entries.push({ path: relativePath, sha256: await sha256File(resolved) });
  }
  return { workspace: authorizedWorkspace, paths: entries };
}

async function resolveWorkspaceFilePath(workspace: string, relativePath: string): Promise<string> {
  if (path.isAbsolute(relativePath)) {
    throw proofError("revision_path_must_be_relative", relativePath);
  }
  if (isSensitiveWorkspacePath(relativePath)) {
    throw proofError("revision_path_sensitive", relativePath);
  }
  const workspaceRoot = await realpath(path.resolve(workspace));
  const candidate = path.resolve(workspaceRoot, relativePath);
  assertInsideWorkspace(workspaceRoot, candidate, relativePath);
  const resolved = await realpath(candidate);
  assertInsideWorkspace(workspaceRoot, resolved, relativePath);
  return resolved;
}

async function revisionPathMatches(workspace: string, relativePath: string, expectedSha256: string): Promise<boolean> {
  let resolved: string;
  try {
    resolved = await resolveWorkspaceFilePath(workspace, relativePath);
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
  try {
    if (!(await stat(resolved)).isFile()) return false;
    return (await sha256File(resolved)) === expectedSha256;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function assertRevisionWorkspaceAuthorized(candidate: string, authorized: string): void {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (normalize(candidate) !== normalize(authorized)) {
    throw proofError("revision_workspace_not_authorized", candidate);
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function assertInsideWorkspace(workspace: string, candidate: string, reportedPath: string): void {
  const relative = path.relative(workspace, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw proofError("revision_path_outside_workspace", reportedPath);
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function evaluateExpectation(
  expectation: SptEvidenceExpectation,
  observed: unknown
): { passed: boolean; message: string } {
  switch (expectation.kind) {
    case "boolean_assertion": {
      const passed = typeof observed === "boolean" && observed === expectation.expected;
      return { passed, message: `boolean ${String(observed)} equals ${String(expectation.expected)}` };
    }
    case "command_exit": {
      const passed = typeof observed === "number" && Number.isInteger(observed) && observed === expectation.expected_exit_code;
      return { passed, message: `exit_code ${String(observed)} equals ${expectation.expected_exit_code}` };
    }
    case "hash_equality": {
      const value = asRecord(observed);
      const left = typeof value?.left_sha256 === "string" ? value.left_sha256 : "";
      const right = typeof value?.right_sha256 === "string" ? value.right_sha256 : "";
      const passed = SHA256_PATTERN.test(left) && SHA256_PATTERN.test(right) && left === right;
      return { passed, message: `sha256 equality ${passed ? "matched" : "did not match"}` };
    }
    case "measurement": {
      if (typeof observed !== "number" || !Number.isFinite(observed)) {
        return { passed: false, message: "observed value is not a finite number" };
      }
      const passed =
        expectation.operator === "eq"
          ? observed === expectation.expected
          : expectation.operator === "gte"
            ? observed >= expectation.expected
            : observed <= expectation.expected;
      return {
        passed,
        message: `measurement ${observed} ${expectation.operator} ${expectation.expected}${expectation.unit ? ` ${expectation.unit}` : ""}`
      };
    }
    case "text": {
      if (typeof observed !== "string") return { passed: false, message: "observed value is not text" };
      let passed = false;
      if (expectation.operator === "equals") passed = observed === expectation.expected;
      if (expectation.operator === "contains") passed = observed.includes(expectation.expected);
      if (expectation.operator === "matches") {
        try {
          passed = new RegExp(expectation.expected).test(observed);
        } catch {
          throw proofError("invalid_expected_regex", expectation.expected);
        }
      }
      return { passed, message: `text ${expectation.operator} planned expectation: ${passed}` };
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function proofError(code: string, detail?: string): Error {
  return new Error(`SPT_V3_EVIDENCE_INVALID: ${code}${detail ? `: ${detail}` : ""}`);
}

/** Onda 2 (FE-DEBT-006, sentinelas): admissao de criterion_proof como politica
 *  pura do SSOT — v2 rejeita (SPT_V3_EVIDENCE_INVALID), v3 sem mapa rejeita
 *  (SPT_V3_TRACEABILITY_MISSING), v3 com mapa qualifica via qualifyCriterionProof.
 *  Mensagens sao contrato publico: preservadas byte a byte. */
export function assertCriterionProofAdmission(
  flowLike: { spt_contract_version?: number | null; spt_traceability?: unknown },
  input: { criterion_proof?: CriterionProofInput }
): CriterionProof | undefined {
  if (!input.criterion_proof) return undefined;
  if (flowLike.spt_contract_version !== 3) {
    throw new Error("SPT_V3_EVIDENCE_INVALID: criterion_proof requires a flow bound to SPT v3");
  }
  if (!flowLike.spt_traceability) {
    throw new Error("SPT_V3_TRACEABILITY_MISSING: criterion_proof requires the bound canonical traceability map");
  }
  return qualifyCriterionProof(flowLike.spt_traceability as SptV3Traceability, input.criterion_proof);
}
