import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isSensitiveWorkspacePath } from "./review-snapshot.js";
import type {
  CriterionProof,
  CriterionProofInput,
  Evidence,
  SptEvidenceExpectation,
  SptV3Contract,
  SptV3Traceability
} from "./domain.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function traceabilityFromContract(contract: SptV3Contract): SptV3Traceability {
  return {
    requirements: contract.requirements,
    tasks: contract.tasks
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
  const task = traceability.tasks.find((candidate) => candidate.id === input.task_id);
  if (!task) throw proofError("unknown_task", input.task_id);
  const requirement = traceability.requirements.find((candidate) => candidate.id === input.requirement_id);
  if (!requirement) throw proofError("unknown_requirement", input.requirement_id);
  const criterion = requirement.criteria.find((candidate) => candidate.id === input.criterion_id);
  if (!criterion) throw proofError("criterion_not_owned_by_requirement", `${input.criterion_id}/${input.requirement_id}`);
  if (!task.covers.includes(requirement.id)) {
    throw proofError("task_does_not_cover_requirement", `${task.id}/${requirement.id}`);
  }
  if (!task.done_when.includes(criterion.id)) {
    throw proofError("criterion_not_in_task_done_when", `${task.id}/${criterion.id}`);
  }
  const evidenceRequirement = task.evidence_requirements.find(
    (candidate) => candidate.id === input.evidence_requirement_id
  );
  if (!evidenceRequirement) {
    throw proofError("evidence_requirement_not_owned_by_task", `${input.evidence_requirement_id}/${task.id}`);
  }
  if (!evidenceRequirement.proves.includes(criterion.id)) {
    throw proofError("evidence_requirement_does_not_prove_criterion", `${evidenceRequirement.id}/${criterion.id}`);
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

export function missingCriterionCoverage(
  traceability: SptV3Traceability,
  evidence: Evidence[],
  selectedEvidenceIds: string[]
): string[] {
  const selected = new Set(selectedEvidenceIds);
  const covered = new Set(
    evidence
      .filter((item) => selected.has(item.evidence_id) && item.criterion_proof?.passed === true)
      .map((item) => item.criterion_proof!.criterion_id)
  );
  return traceability.requirements
    .flatMap((requirement) => requirement.criteria)
    .map((criterion) => criterion.id)
    .filter((criterionId) => !covered.has(criterionId));
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

async function revisionPathMatches(workspace: string, relativePath: string, expectedSha256: string): Promise<boolean> {
  if (path.isAbsolute(relativePath)) {
    throw proofError("revision_path_must_be_relative", relativePath);
  }
  if (isSensitiveWorkspacePath(relativePath)) {
    throw proofError("revision_path_sensitive", relativePath);
  }
  const workspaceRoot = await realpath(path.resolve(workspace));
  const candidate = path.resolve(workspaceRoot, relativePath);
  assertInsideWorkspace(workspaceRoot, candidate, relativePath);
  try {
    const resolved = await realpath(candidate);
    assertInsideWorkspace(workspaceRoot, resolved, relativePath);
    if (!(await stat(resolved)).isFile()) return false;
    const actualSha256 = await sha256File(resolved);
    return actualSha256 === expectedSha256;
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
