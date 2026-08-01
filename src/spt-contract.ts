import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod";
import type {
  SptContract,
  SptEvidenceExpectation,
  SptV2Contract,
  SptV3Contract
} from "./domain.js";

const requiredText = z.string().trim().min(1, "must be a non-empty string");
const requiredTextList = z.array(requiredText).min(1, "must contain at least one item");
const stableId = requiredText.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "must be a stable identifier");

const sharedFields = {
  dex_contract: z.literal("spt"),
  status: requiredText,
  owner: requiredText,
  date: requiredText.regex(/^\d{4}-\d{2}-\d{2}$/, "must use YYYY-MM-DD"),
  workspace: requiredText,
  origin: requiredText,
  goal: z
    .object({
      id: requiredText.regex(/^[a-z0-9][a-z0-9._-]*$/, "must be a stable lowercase identifier"),
      title: requiredText,
      objective: requiredText
    })
    .strict(),
  context: requiredText,
  problem: requiredText,
  decision: requiredText,
  scope: z
    .object({
      include: requiredTextList,
      exclude: requiredTextList
    })
    .strict(),
  plan: requiredTextList,
  risks: requiredTextList,
  uncertainties: requiredTextList,
  gates: requiredTextList,
  validation: requiredTextList,
  execution_prompt: requiredText
};

const sptV2Schema: z.ZodType<SptV2Contract> = z
  .object({
    dex_contract: z.literal("spt"),
    version: z.literal(2),
    status: requiredText,
    owner: requiredText,
    date: requiredText.regex(/^\d{4}-\d{2}-\d{2}$/, "must use YYYY-MM-DD"),
    workspace: requiredText,
    origin: requiredText,
    goal: z
      .object({
        id: requiredText.regex(/^[a-z0-9][a-z0-9._-]*$/, "must be a stable lowercase identifier"),
        title: requiredText,
        objective: requiredText
      })
      .strict(),
    context: requiredText,
    problem: requiredText,
    decision: requiredText,
    scope: z
      .object({
        include: requiredTextList,
        exclude: requiredTextList
      })
      .strict(),
    spec: requiredText,
    plan: requiredTextList,
    tasks: requiredTextList,
    expected_evidence: requiredTextList,
    done_criteria: requiredTextList,
    risks: requiredTextList,
    uncertainties: requiredTextList,
    gates: requiredTextList,
    validation: requiredTextList,
    execution_prompt: requiredText
  })
  .strict();

const expectationSchema: z.ZodType<SptEvidenceExpectation> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("boolean_assertion"), expected: z.boolean() }).strict(),
  z.object({ kind: z.literal("command_exit"), expected_exit_code: z.number().int() }).strict(),
  z.object({ kind: z.literal("hash_equality") }).strict(),
  z
    .object({
      kind: z.literal("measurement"),
      operator: z.enum(["eq", "gte", "lte"]),
      expected: z.number().finite(),
      unit: requiredText.optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      operator: z.enum(["equals", "contains", "matches"]),
      expected: requiredText
    })
    .strict()
]);

const criterionSchema = z.object({ id: stableId, statement: requiredText }).strict();
const requirementSchema = z
  .object({
    id: stableId,
    statement: requiredText,
    criteria: z.array(criterionSchema).min(1, "must contain at least one criterion")
  })
  .strict();
const evidenceRequirementSchema = z
  .object({
    id: stableId,
    proves: z.array(stableId).min(1, "must prove at least one criterion"),
    method: z.enum(["command", "test", "inspection", "receipt", "review"]),
    procedure: requiredText,
    expectation: expectationSchema
  })
  .strict();
const taskSchema = z
  .object({
    id: stableId,
    action: requiredText,
    covers: z.array(stableId).min(1, "must cover at least one requirement"),
    done_when: z.array(stableId).min(1, "must reference at least one criterion"),
    depends_on: z.array(stableId),
    evidence_requirements: z.array(evidenceRequirementSchema).min(1, "must contain at least one evidence requirement")
  })
  .strict();

const sptV3Schema: z.ZodType<SptV3Contract> = z
  .object({
    ...sharedFields,
    version: z.literal(3),
    requirements: z.array(requirementSchema).min(1, "must contain at least one requirement"),
    tasks: z.array(taskSchema).min(1, "must contain at least one task"),
    closure_gates: requiredTextList
  })
  .strict();

export type SptParseResult = {
  contract: SptContract | null;
  checks: {
    frontmatter_present: boolean;
    frontmatter_closed: boolean;
    yaml_valid: boolean;
    schema_valid: boolean;
    semantics_valid: boolean;
  };
  errors: string[];
};

export type SptV2ParseResult = Omit<SptParseResult, "contract"> & {
  contract: SptV2Contract | null;
};

export function parseSptDocument(input: string): SptParseResult {
  const decoded = decodeFrontmatter(input);
  if (!decoded.value) {
    return decoded;
  }
  const version = recordVersion(decoded.value);
  if (version !== 2 && version !== 3) {
    return invalid(decoded.checks, `spt.version: unsupported explicit version ${String(version ?? "missing")}; expected 2 or 3`);
  }
  const prefix = `spt_v${version}`;
  const parsed = (version === 2 ? sptV2Schema : sptV3Schema).safeParse(decoded.value);
  if (!parsed.success) {
    return invalid(
      decoded.checks,
      ...parsed.error.issues.map((issue) => {
        const issuePath = issue.path.length > 0 ? issue.path.join(".") : "contract";
        return `${prefix}.${issuePath}: ${issue.message}`;
      })
    );
  }
  decoded.checks.schema_valid = true;
  if (version === 3) {
    const semanticErrors = validateSptV3Semantics(parsed.data as SptV3Contract);
    if (semanticErrors.length > 0) {
      return invalid(decoded.checks, ...semanticErrors);
    }
  }
  decoded.checks.semantics_valid = true;
  return { contract: parsed.data as SptContract, checks: decoded.checks, errors: [] };
}

export function parseSptV2Document(input: string): SptV2ParseResult {
  const result = parseSptDocument(input);
  if (result.contract?.version === 2) {
    return { ...result, contract: result.contract };
  }
  if (result.contract?.version === 3) {
    return {
      contract: null,
      checks: result.checks,
      errors: ["spt_v2.version: Invalid literal value, expected 2"]
    };
  }
  return {
    ...result,
    contract: null,
    errors: result.errors.map((error) => error.replace(/^spt\./, "spt_v2."))
  };
}

export function fingerprintSptContract(contract: SptContract): string {
  return createHash("sha256").update(JSON.stringify(contract), "utf8").digest("hex");
}

export function fingerprintSptV2Contract(contract: SptV2Contract): string {
  return fingerprintSptContract(contract);
}

export function sha256SptDocument(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function decodeFrontmatter(input: string): SptParseResult & { value?: unknown } {
  const text = input.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const checks = {
    frontmatter_present: lines[0] === "---",
    frontmatter_closed: false,
    yaml_valid: false,
    schema_valid: false,
    semantics_valid: false
  };
  if (!checks.frontmatter_present) {
    return invalid(checks, "spt.frontmatter: missing opening --- at the start of the file");
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  checks.frontmatter_closed = closingIndex > 0;
  if (!checks.frontmatter_closed) {
    return invalid(checks, "spt.frontmatter: missing closing ---");
  }
  const yamlText = lines.slice(1, closingIndex).join("\n");
  if (!yamlText.trim()) {
    return invalid(checks, "spt.frontmatter: YAML contract is empty");
  }
  try {
    const document = parseDocument(yamlText, { prettyErrors: false, schema: "core", strict: true });
    if (document.errors.length > 0) {
      return invalid(
        checks,
        ...document.errors.map((error) => `spt.yaml: ${error.message.replace(/\s+/g, " ").trim()}`)
      );
    }
    checks.yaml_valid = true;
    return { contract: null, checks, errors: [], value: document.toJS({ maxAliasCount: 50 }) };
  } catch (error) {
    return invalid(checks, `spt.yaml: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateSptV3Semantics(contract: SptV3Contract): string[] {
  const errors: string[] = [];
  const requirementIds = new Set<string>();
  const criterionToRequirement = new Map<string, string>();
  const taskIds = new Set<string>();
  const evidenceRequirementIds = new Set<string>();

  for (const requirement of contract.requirements) {
    addUnique(requirementIds, requirement.id, "requirement", errors);
    for (const criterion of requirement.criteria) {
      if (criterionToRequirement.has(criterion.id)) {
        errors.push(`spt_v3.semantic.duplicate_criterion: ${criterion.id}`);
      } else {
        criterionToRequirement.set(criterion.id, requirement.id);
      }
    }
  }
  for (const task of contract.tasks) {
    addUnique(taskIds, task.id, "task", errors);
    for (const evidenceRequirement of task.evidence_requirements) {
      addUnique(evidenceRequirementIds, evidenceRequirement.id, "evidence_requirement", errors);
      if (
        evidenceRequirement.expectation.kind === "text"
        && evidenceRequirement.expectation.operator === "matches"
      ) {
        try {
          new RegExp(evidenceRequirement.expectation.expected);
        } catch {
          errors.push(`spt_v3.semantic.invalid_expected_regex: ${evidenceRequirement.id}`);
        }
      }
    }
  }

  const coveredRequirements = new Set<string>();
  const completedCriteria = new Set<string>();
  for (const task of contract.tasks) {
    for (const requirementId of task.covers) {
      if (!requirementIds.has(requirementId)) {
        errors.push(`spt_v3.semantic.unknown_requirement: task ${task.id} covers ${requirementId}`);
      } else {
        coveredRequirements.add(requirementId);
      }
    }
    for (const criterionId of task.done_when) {
      const ownerRequirement = criterionToRequirement.get(criterionId);
      if (!ownerRequirement) {
        errors.push(`spt_v3.semantic.unknown_criterion: task ${task.id} done_when ${criterionId}`);
      } else {
        completedCriteria.add(criterionId);
        if (!task.covers.includes(ownerRequirement)) {
          errors.push(`spt_v3.semantic.criterion_outside_coverage: task ${task.id} uses ${criterionId} from ${ownerRequirement}`);
        }
      }
    }
    for (const dependencyId of task.depends_on) {
      if (!taskIds.has(dependencyId)) {
        errors.push(`spt_v3.semantic.unknown_dependency: task ${task.id} depends_on ${dependencyId}`);
      }
      if (dependencyId === task.id) {
        errors.push(`spt_v3.semantic.self_dependency: task ${task.id}`);
      }
    }
    const provedByTask = new Set<string>();
    for (const evidenceRequirement of task.evidence_requirements) {
      for (const criterionId of evidenceRequirement.proves) {
        if (!criterionToRequirement.has(criterionId)) {
          errors.push(`spt_v3.semantic.unknown_evidence_criterion: ${evidenceRequirement.id} proves ${criterionId}`);
        }
        if (!task.done_when.includes(criterionId)) {
          errors.push(`spt_v3.semantic.evidence_outside_done_when: ${evidenceRequirement.id} proves ${criterionId}`);
        }
        provedByTask.add(criterionId);
      }
    }
    for (const criterionId of task.done_when) {
      if (!provedByTask.has(criterionId)) {
        errors.push(`spt_v3.semantic.unproved_task_criterion: task ${task.id} criterion ${criterionId}`);
      }
    }
  }
  for (const requirement of contract.requirements) {
    if (!coveredRequirements.has(requirement.id)) {
      errors.push(`spt_v3.semantic.orphan_requirement: ${requirement.id}`);
    }
    for (const criterion of requirement.criteria) {
      if (!completedCriteria.has(criterion.id)) {
        errors.push(`spt_v3.semantic.orphan_criterion: ${criterion.id}`);
      }
    }
  }
  errors.push(...dependencyCycleErrors(contract));
  return errors;
}

function dependencyCycleErrors(contract: SptV3Contract): string[] {
  const graph = new Map(contract.tasks.map((task) => [task.id, task.depends_on]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const visit = (taskId: string, trail: string[]): void => {
    if (visiting.has(taskId)) {
      const start = trail.indexOf(taskId);
      cycles.add([...trail.slice(start), taskId].join(" -> "));
      return;
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependencyId of graph.get(taskId) ?? []) {
      if (graph.has(dependencyId)) visit(dependencyId, [...trail, taskId]);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const taskId of graph.keys()) visit(taskId, []);
  return [...cycles].map((cycle) => `spt_v3.semantic.dependency_cycle: ${cycle}`);
}

function addUnique(target: Set<string>, id: string, kind: string, errors: string[]): void {
  if (target.has(id)) {
    errors.push(`spt_v3.semantic.duplicate_${kind}: ${id}`);
  }
  target.add(id);
}

function recordVersion(value: unknown): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>).version : undefined;
}

function invalid(checks: SptParseResult["checks"], ...errors: string[]): SptParseResult {
  return { contract: null, checks, errors };
}
