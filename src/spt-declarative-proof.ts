import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSptDocument, type SptParseResult } from "./spt-contract.js";
import { buildEvidenceRevision, traceabilityFromContract } from "./spt-traceability.js";
import type {
  CriterionProofInput,
  SptEvidenceExpectation,
  SptV3Traceability
} from "./domain.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type DeclarativeProofInput = {
  task_id: string;
  evidence_requirement_id: string;
  observed_value: unknown;
  paths: string[];
  command?: string;
  environment?: string;
  producer?: string;
  limits?: string[];
};

export type DeclarativeProofDefaults = {
  environment: string;
  producer: string;
  limits: string[];
};

export type DeclarativeCriterionResult = {
  criterion_id: string;
  requirement_id: string;
  evidence_id: string;
  passed: boolean;
  evaluation: string;
};

export type DeclarativeEvidenceReceipt = {
  mutated: true;
  declarative: true;
  flow_id: string;
  evidence_requirement_id: string;
  evidence_ids: string[];
  criteria: DeclarativeCriterionResult[];
  all_passed: boolean;
};

export type DeclarativeStatusLookup = {
  goalStatus(input: { flow_id?: string; detail?: "lean" | "compact" | "full" }): Promise<Record<string, unknown>>;
};

export type DeclarativeEvidenceSink = {
  addGoalEvidence(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export async function expandDeclarativeProof(
  traceability: SptV3Traceability,
  workspace: string,
  input: DeclarativeProofInput,
  defaults: DeclarativeProofDefaults,
  now: () => string = () => new Date().toISOString()
): Promise<CriterionProofInput[]> {
  const task = traceability.tasks.find((candidate) => candidate.id === input.task_id);
  if (!task) throw declarativeError("unknown_task", input.task_id);
  const evidenceRequirement = task.evidence_requirements.find(
    (candidate) => candidate.id === input.evidence_requirement_id
  );
  if (!evidenceRequirement) {
    throw declarativeError("evidence_requirement_not_owned_by_task", `${input.evidence_requirement_id}/${task.id}`);
  }
  assertObservedValueType(evidenceRequirement.id, evidenceRequirement.expectation, input.observed_value);
  const revision = await buildEvidenceRevision(workspace, input.paths);
  const timestamp = now();
  const environment = input.environment?.trim() || defaults.environment;
  const producer = input.producer?.trim() || defaults.producer;
  const limits = [...(input.limits?.length ? input.limits : defaults.limits)];
  if (input.command) limits.push(`command: ${input.command}`);
  return evidenceRequirement.proves.map((criterionId) => ({
    task_id: task.id,
    requirement_id: criterionOwner(traceability, evidenceRequirement.id, criterionId),
    criterion_id: criterionId,
    evidence_requirement_id: evidenceRequirement.id,
    observed_value: input.observed_value,
    revision_set: [revision],
    environment,
    producer,
    timestamp,
    limits
  }));
}

export async function addDeclarativeEvidence(
  statusLookup: DeclarativeStatusLookup,
  sink: DeclarativeEvidenceSink,
  args: {
    flow_id: string;
    title: string;
    declarative_proof: DeclarativeProofInput;
    criterion_proof?: unknown;
    [key: string]: unknown;
  },
  defaults: DeclarativeProofDefaults
): Promise<DeclarativeEvidenceReceipt> {
  if (args.criterion_proof) {
    throw declarativeError(
      "mutual_exclusion",
      "send either criterion_proof or declarative_proof, not both"
    );
  }
  const context = await resolveDeclarativeContext(statusLookup, args.flow_id);
  const proofs = await expandDeclarativeProof(
    context.traceability,
    context.workspace,
    args.declarative_proof,
    defaults
  );
  const evidenceIds: string[] = [];
  const criteria: DeclarativeCriterionResult[] = [];
  for (const proof of proofs) {
    let receipt: Record<string, unknown>;
    try {
      const { declarative_proof: omitDeclarative, criterion_proof: omitManual, ...engineArgs } = args;
      void omitDeclarative;
      void omitManual;
      receipt = await sink.addGoalEvidence({
        ...engineArgs,
        criterion_proof: proof,
        title: `${args.title} — ${proof.criterion_id}`
      });
    } catch (error) {
      throw wrapEngineFailure(proof.criterion_id, error);
    }
    const evidenceId = typeof receipt.evidence_id === "string" ? receipt.evidence_id : "";
    if (!evidenceId) {
      throw declarativeError("engine_receipt_missing_evidence_id", `criterion ${proof.criterion_id}`);
    }
    const stored = extractCriterionProof(receipt);
    if (!stored || stored.criterion_id !== proof.criterion_id) {
      throw declarativeError("engine_receipt_missing_criterion_proof", `criterion ${proof.criterion_id}`);
    }
    evidenceIds.push(evidenceId);
    criteria.push({
      criterion_id: stored.criterion_id,
      requirement_id: proof.requirement_id,
      evidence_id: evidenceId,
      passed: stored.passed === true,
      evaluation: typeof stored.evaluation === "string" ? stored.evaluation : ""
    });
  }
  return {
    mutated: true,
    declarative: true,
    flow_id: args.flow_id,
    evidence_requirement_id: args.declarative_proof.evidence_requirement_id,
    evidence_ids: evidenceIds,
    criteria,
    all_passed: criteria.length > 0 && criteria.every((criterion) => criterion.passed)
  };
}

export async function resolveDeclarativeContext(
  statusLookup: DeclarativeStatusLookup,
  flowId: string
): Promise<{ workspace: string; traceability: SptV3Traceability; spt_path: string }> {
  const status = await statusLookup.goalStatus({ flow_id: flowId, detail: "full" });
  const envelope = asRecord(status.goal_envelope);
  const workspace = typeof envelope?.workspace === "string" ? envelope.workspace : "";
  const sptPath = typeof envelope?.spt_path === "string" ? envelope.spt_path : "";
  if (!workspace || !sptPath) {
    throw declarativeError("goal_binding_missing", `flow ${flowId} has no goal envelope workspace/spt_path`);
  }
  const parsed: SptParseResult = parseSptDocument(await readFile(resolveSptPathForFlow(workspace, sptPath), "utf8"));
  const contract = parsed.contract;
  if (!contract || contract.version !== 3) {
    throw declarativeError("spt_v3_required", `${sptPath} is not a valid SPT v3 contract`);
  }
  return { workspace, traceability: traceabilityFromContract(contract), spt_path: sptPath };
}

export type ProofSkeleton = {
  task_id: string;
  evidence_requirement_id: string;
  proves: string[];
  method: string;
  expectation: SptEvidenceExpectation;
  observed_value_type: string;
  observed_value_example: string;
  declarative_payload: {
    flow_id: string;
    title: string;
    declarative_proof: {
      task_id: string;
      evidence_requirement_id: string;
      observed_value: string;
      paths: string[];
    };
  };
};

export function buildProofSkeletons(traceability: SptV3Traceability, flowId = "<flow_id>"): ProofSkeleton[] {
  return traceability.tasks.flatMap((task) =>
    task.evidence_requirements.map((requirement) => ({
      task_id: task.id,
      evidence_requirement_id: requirement.id,
      proves: [...requirement.proves],
      method: requirement.method,
      expectation: requirement.expectation,
      observed_value_type: describeObservedType(requirement.expectation),
      observed_value_example: exampleObservedValue(requirement.expectation),
      declarative_payload: {
        flow_id: flowId,
        title: `${requirement.id} — declarative`,
        declarative_proof: {
          task_id: task.id,
          evidence_requirement_id: requirement.id,
          observed_value: exampleObservedValue(requirement.expectation),
          paths: []
        }
      }
    }))
  );
}

function observedTypeError(detail: string): Error {
  return new Error(`SPT_V3_DECLARATIVE_OBSERVED_TYPE: ${detail}`);
}

function assertObservedValueType(
  evidenceRequirementId: string,
  expectation: SptEvidenceExpectation,
  observed: unknown
): void {
  const received = `received ${describeJsValue(observed)}`;
  switch (expectation.kind) {
    case "boolean_assertion":
      if (typeof observed !== "boolean") {
        throw observedTypeError(
          `${evidenceRequirementId} (kind boolean_assertion): send observed_value as boolean ${String(expectation.expected)}; ${received}`
        );
      }
      return;
    case "command_exit":
      if (typeof observed !== "number" || !Number.isInteger(observed)) {
        throw observedTypeError(
          `${evidenceRequirementId} (kind command_exit): send observed_value as the integer exit code (number, e.g. ${expectation.expected_exit_code}); ${received}`
        );
      }
      return;
    case "measurement":
      if (typeof observed !== "number" || !Number.isFinite(observed)) {
        throw observedTypeError(
          `${evidenceRequirementId} (kind measurement): send observed_value as a finite number; ${received}`
        );
      }
      return;
    case "text":
      if (typeof observed !== "string") {
        throw observedTypeError(
          `${evidenceRequirementId} (kind text): send observed_value as the observed text string; ${received}`
        );
      }
      return;
    case "hash_equality": {
      const record = asRecord(observed);
      const left = typeof record?.left_sha256 === "string" ? record.left_sha256 : "";
      const right = typeof record?.right_sha256 === "string" ? record.right_sha256 : "";
      if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) {
        throw observedTypeError(
          `${evidenceRequirementId} (kind hash_equality): send observed_value as {"left_sha256": "<64 hex>", "right_sha256": "<64 hex>"}; ${received}`
        );
      }
      return;
    }
  }
}

function criterionOwner(traceability: SptV3Traceability, evidenceRequirementId: string, criterionId: string): string {
  const requirement = traceability.requirements.find((candidate) =>
    candidate.criteria.some((criterion) => criterion.id === criterionId)
  );
  if (!requirement) {
    throw declarativeError("criterion_not_owned_by_requirement", `${evidenceRequirementId}/${criterionId}`);
  }
  return requirement.id;
}

function extractCriterionProof(receipt: Record<string, unknown>): {
  criterion_id: string;
  passed: boolean;
  evaluation?: unknown;
} | null {
  const direct = asRecord(receipt.criterion_proof);
  if (direct && typeof direct.criterion_id === "string") {
    return { criterion_id: direct.criterion_id, passed: direct.passed === true, evaluation: direct.evaluation };
  }
  const evidence = asRecord(receipt.evidence);
  const nested = asRecord(evidence?.criterion_proof);
  if (nested && typeof nested.criterion_id === "string") {
    return { criterion_id: nested.criterion_id, passed: nested.passed === true, evaluation: nested.evaluation };
  }
  return null;
}

function wrapEngineFailure(criterionId: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("SPT_V3_DECLARATIVE_")) return error as Error;
  return declarativeError("engine_rejected", `criterion ${criterionId}: ${message}`);
}

function describeObservedType(expectation: SptEvidenceExpectation): string {
  switch (expectation.kind) {
    case "boolean_assertion":
      return "boolean";
    case "command_exit":
      return "integer exit code (number)";
    case "measurement":
      return "finite number";
    case "text":
      return "string";
    case "hash_equality":
      return "object {left_sha256, right_sha256}";
  }
}

function exampleObservedValue(expectation: SptEvidenceExpectation): string {
  switch (expectation.kind) {
    case "boolean_assertion":
      return String(expectation.expected);
    case "command_exit":
      return String(expectation.expected_exit_code);
    case "measurement":
      return String(expectation.expected);
    case "text":
      return expectation.expected;
    case "hash_equality":
      return "{left_sha256: \"<64 hex>\", right_sha256: \"<64 hex>\"}";
  }
}

function describeJsValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return `${typeof value} ${String(value)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function declarativeError(code: string, detail: string): Error {
  return new Error(`SPT_V3_DECLARATIVE_INVALID: ${code}: ${detail}`);
}

export function declarativeDefaults(): DeclarativeProofDefaults {
  return {
    environment: `node ${process.version} on ${process.platform}`,
    producer: "dex-ppirtv declarative route (server-side expansion)",
    limits: ["revision_set, timestamp e avaliacao computados pelo servidor; observed_value declarado pelo agente executor"]
  };
}

export function resolveSptPathForFlow(workspace: string, sptPath: string): string {
  return path.resolve(workspace, sptPath);
}
