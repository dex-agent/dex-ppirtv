import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  PHASES,
  COMPACT_PHASES,
  GOAL_FLOW_ROLES,
  type AnyPhase,
  type Cooperator,
  type CriterionProofInput,
  type Evidence,
  type EvidenceQuality,
  type Flow,
  type GateRecord,
  type GoalBinding,
  type GoalEnvelope,
  type GoalFlowRole,
  type HygieneFinding,
  type Meeting,
  type MemoryCandidate,
  type MemoryCandidatePromoteScope,
  type MemoryCandidateResolution,
  type MemoryCandidateResolutionAction,
  type MemoryCandidateScope,
  type MeetingKind,
  type MeetingType,
  type MemoryMiningSummary,
  type MemoryPostWriteValidation,
  type MemoryReviewStatus,
  type MemoryWritePolicy,
  type PipelineFlowResult,
  type PipelineItem,
  type PresentationEnvelope,
  type Phase,
  type Scope,
  type StructuredLibrarianStatus,
  type SptValidationResult,
  type SptV3Contract,
  type Verdict,
  type VerdictStatus,
  type WorkProgressEvent,
  type WorkProgressStatus,
  type WorkProgressSummary
} from "./domain.js";
import { isStructuredReviewEvidence, resolveGateRequirements, reviewEvidenceDiagnostics, type GateRequirementResolution } from "./gate-resolution.js";
import {
  assertLegacyFlowCanReceiveFirstGoalBinding,
  ensureLedgerTransitionRecorded,
  GoalIdempotencyDuplicateBindingsError
} from "./goal-ledger-recovery.js";
import {
  assertNoSecretLikeText,
  classifyDexMemoriaV2MiningCandidate,
  classifyMemoryCandidate,
  classifyDexMemoriaV2Intent,
  collectMemoryNuggets,
  executeDexMemoriaV2Adapter,
  governAutoWriteCandidate,
  isWritableCandidate,
  linkParkingToGold,
  MemoryLibrarian,
  memoryCandidateLedgerData,
  resolveDexMemoriaHome,
  validateMemoryPostWrite,
  writeMemoryCandidate,
  type DexMemoriaV2CanonicalReceipt,
  type DexMemoriaV2Destination,
  type DexMemoriaV2FlowWriterConfig,
  type DexMemoriaV2MiningClassification,
  type DexMemoriaV2ValidationReceiptRef,
  type MemoryHookRunner
} from "./memory/index.js";
import { presentArtifact, presentChecklist, presentFlow, presentGate } from "./presentation.js";
import {
  defaultWorkflow,
  earlySecurityProportionalityPolicy,
  finalReportModel,
  gateFinalOutput,
  operationalContractMeta,
  principleChecklist,
  readyDefinition,
  scanOperationalPrinciples,
  secretEnvConsumptionPolicy,
  type DefaultWorkflow,
  type OperationalPolicyBlock,
  type PrincipleChecklistItem
} from "./principles.js";
import { PpirtvStore, type RuntimeLayoutStatus } from "./store.js";
import { profileFor, type GateRequirement } from "./phase-profile.js";
import { FISCAL_CONFIG, RUNTIME_ENV, graphifyRecallConfigured, sameRuntimePath } from "./config.js";
import { fingerprintSptContract, parseSptDocument, sha256SptDocument } from "./spt-contract.js";
import {
  assertCriterionProofRevisionCurrent,
  criterionProjection,
  evidenceRequirementProjection,
  missingCriterionCoverage,
  qualifyCriterionProof,
  staleSelectedCriterionProofPaths,
  taskProjection,
  traceabilityFromContract
} from "./spt-traceability.js";
import { fingerprintReviewedImplementation, normalizeReviewPath } from "./review-snapshot.js";

const DEFAULT_SCOPE: Scope = { in: [], out: [] };
const MEMORY_MINING_BLOCKED_VERDICT_REASON = "memory_mining_blocked_verdict";
const MEMORY_V2_TAG_PATTERN = /^#[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const USER_PROFILE_POINTER = "$env:USERPROFILE";
export const RECALL_ERROR_MAX_REFERENCES = 12;
export const RECALL_ERROR_MAX_REFERENCE_LENGTH = 160;
export const WORK_PROGRESS_MAX_RUNNING_EVENTS = 100;

type RecallVisualStatus = NonNullable<PresentationEnvelope["display"]["librarian"]>;

type FiscalVerdictInput = {
  status?: VerdictStatus;
  rationale?: string;
  evidence_ids?: string[];
  residual_risks?: string[];
  next_step?: string;
  review_artifact_path?: string;
  review_findings?: string[];
  verdict_parking_lot?: string[];
  verdict_gold_mining?: string[];
  attempt_count?: number;
  regress_count?: number;
  meeting_id?: string;
  meeting_ids?: string[];
  memory_mining?: Record<string, unknown> | null;
};

type FiscalPolicyResult = {
  material: boolean;
  blocking_reasons: string[];
  required_cooperation: Cooperator[];
  meeting_policy: {
    required: boolean;
    rotation: string[];
    repertoire: string[];
    objective: string;
  };
  direct_action: string;
};

type ResolveMemoryCandidatesInput = {
  flow_id: string;
  candidate_ids: string[];
  action: MemoryCandidateResolutionAction;
  rationale: string;
  when?: string;
  target_scope?: MemoryCandidatePromoteScope;
  theme?: string;
  density?: "light" | "deep";
  owner_skill?: string;
  tags?: string[];
};

type RecallConsumptionInput = {
  references: string[];
  graphify_references?: string[];
  note?: string;
};

type WorkProgressInput = {
  flow_id?: string;
  idempotency_key?: string;
  event_key: string;
  source: string;
  operation: string;
  stage: string;
  current: number;
  total: number;
  status: WorkProgressStatus;
  message?: string;
};

export class WorkProgressContractError extends Error {
  readonly code: "PROGRESS_OUT_OF_ORDER" | "PROGRESS_TOTAL_MISMATCH" | "PROGRESS_AFTER_TERMINAL";
  readonly details: Record<string, unknown>;

  constructor(code: WorkProgressContractError["code"], details: Record<string, unknown>) {
    super(code);
    this.name = "WorkProgressContractError";
    this.code = code;
    this.details = details;
  }
}

export class RecallConsumptionReferenceError extends Error {
  readonly code: "RECALL_CONSUMPTION_UNKNOWN_REFERENCES" | "GRAPHIFY_CONSUMPTION_UNKNOWN_REFERENCES";
  readonly unknownReferences: string[];
  readonly validReferences: string[];
  readonly validGraphifyReferences: string[];

  constructor(
    code: RecallConsumptionReferenceError["code"],
    unknownReferences: string[],
    validReferences: string[],
    validGraphifyReferences: string[] = []
  ) {
    const boundedUnknownReferences = boundedRecallErrorReferences(unknownReferences);
    super(`${code}: ${boundedUnknownReferences.length} unknown reference(s)`);
    this.name = "RecallConsumptionReferenceError";
    this.code = code;
    this.unknownReferences = boundedUnknownReferences;
    this.validReferences = boundedRecallErrorReferences(validReferences);
    this.validGraphifyReferences = boundedRecallErrorReferences(validGraphifyReferences);
  }
}

export function boundedRecallErrorReferences(references: string[]): string[] {
  return unique(
    references
      .map((reference) => reference.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((reference) => reference.slice(0, RECALL_ERROR_MAX_REFERENCE_LENGTH))
  ).slice(0, RECALL_ERROR_MAX_REFERENCES);
}

type CanonicalGoalEnvelope = Omit<GoalEnvelope, "mode"> & { mode?: "full" | "compact" };

type BlockerDiagnostics = {
  source: "goal_status";
  phase?: AnyPhase;
  policy: "none" | "phase_gate_requirements" | "fiscal_material_policy" | "mixed";
  fiscal_mode_active: boolean;
  gate_status: GateRecord["status"];
  gate_blockers: string[];
  fiscal_blockers: string[];
  persisted_fiscal_blockers: string[];
  memory_mining_blockers: string[];
  effective_blockers: string[];
  blocker_families: Array<{
    blocker: string;
    family: string;
    source: string[];
  }>;
  interpretation: string;
  why_fiscal_mode_not_active: string[];
  required_cooperation?: Record<string, unknown>;
  memory_required?: Record<string, unknown>;
  memory_mining?: Record<string, unknown>;
};

type LoopMonitor = {
  loop_id: string;
  signature: string;
  blockers: string[];
  count: number;
  fiscal_block_count: number;
  gate_block_count: number;
  terminal_block_count: number;
  review_regress_count: number;
  reset_policy: string;
  escalation: {
    active: boolean;
    level:
      | "monitoring"
      | "convergence_transversal"
      | "divergence_transversal"
      | "research_subagent"
      | "emergency_meeting"
      | "bad_loop_review_work";
    threshold: number | null;
    label: string;
  };
};

export type FlowEngineOptions = {
  memory_writer?: { profile: "unconfigured" | "legacy-v1" } | DexMemoriaV2FlowWriterConfig;
  legacy_candidate_writer?: typeof writeMemoryCandidate;
};

type MemoryMiningV2Summary = MemoryMiningSummary & {
  memory_profile: "v2";
  estacionamento_count: number;
  v2_status: "complete" | "classify_only" | "classification_required" | "partial_pending" | "resume_pending_sibling";
  v2_ledger_status?: "pending" | "confirmed";
  v2_reconciliation_id?: string;
  v2_receipts: DexMemoriaV2CanonicalReceipt[];
  v2_validation_receipts: DexMemoriaV2ValidationReceiptRef[];
  v2_pending_destinations: Array<Record<string, unknown>>;
  v2_failures: Array<Record<string, unknown>>;
};

type V2MemoryCandidateResolution = MemoryCandidateResolution & {
  candidate_tags?: string[];
  candidate_density?: "light" | "deep";
  candidate_destinations?: DexMemoriaV2Destination[];
  candidate_theme?: string;
  candidate_owner_skill?: string;
};

type V2CommittedBoundaryError = Error & {
  v2_committed_effect: true;
};

export class FlowEngine {
  readonly store: PpirtvStore;
  readonly memoryHooks: MemoryHookRunner;
  readonly options: FlowEngineOptions;

  constructor(store: PpirtvStore, memoryHooks?: MemoryHookRunner, options: FlowEngineOptions = {}) {
    this.store = store;
    this.memoryHooks = memoryHooks ?? new MemoryLibrarian(store.root);
    this.options = options;
  }

  async createFlow(input: {
    goal: string;
    owner?: string;
    context?: string;
    scope?: Partial<Scope>;
    risks?: string[];
    uncertainties?: string[];
  }): Promise<Flow & PresentationEnvelope> {
    await this.store.init();
    requireText(input.goal, "goal");
    const now = nowIso();
    const flow = this.buildInitialFlow(input, await this.store.nextId("flow"), now);
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "flow_created", { goal: flow.goal, phase: flow.phase });
    return presentFlow(flow);
  }

  private buildInitialFlow(
    input: {
      goal: string;
      owner?: string;
      context?: string;
      scope?: Partial<Scope>;
      risks?: string[];
      uncertainties?: string[];
    },
    flowId: string,
    now: string
  ): Flow {
    return {
      flow_id: flowId,
      goal: input.goal,
      owner: input.owner,
      context: input.context,
      phase: "pensamentos",
      status: "active",
      scope: {
        in: input.scope?.in ?? DEFAULT_SCOPE.in,
        out: input.scope?.out ?? DEFAULT_SCOPE.out
      },
      risks: input.risks ?? [],
      uncertainties: input.uncertainties ?? [],
      tasks: [],
      done_criteria: [],
      expected_evidence: [],
      changed_files: [],
      deleted_files: [],
      decisions: [],
      parking_lot: [],
      gold_mining: [],
      goal_learning_links: [],
      cooperators: [],
      active_credits: [],
      evidence: [],
      meetings: [],
      verdicts: [],
      gates: {},
      history: [{ at: now, type: "flow_created", data: { phase: "pensamentos" } }],
      created_at: now,
      updated_at: now
    };
  }

  async status(flowId: string): Promise<Flow & PresentationEnvelope> {
    return presentFlow(await this.store.loadFlow(flowId));
  }

  async updateFlowFacts(
    flowId: string,
    facts: Partial<
      Pick<
        Flow,
        | "context"
        | "risks"
        | "uncertainties"
        | "tasks"
        | "done_criteria"
        | "expected_evidence"
        | "changed_files"
        | "deleted_files"
        | "decisions"
      >
    > & { scope?: Partial<Scope> }
  ): Promise<Flow> {
    return this.store.withFlowLock(flowId, () => this.updateFlowFactsUnlocked(flowId, facts));
  }

  private async updateFlowFactsUnlocked(
    flowId: string,
    facts: Partial<
      Pick<
        Flow,
        | "context"
        | "risks"
        | "uncertainties"
        | "tasks"
        | "done_criteria"
        | "expected_evidence"
        | "changed_files"
        | "deleted_files"
        | "decisions"
      >
    > & { scope?: Partial<Scope> }
  ): Promise<Flow> {
    const flow = await this.store.loadFlow(flowId);
    assertFlowAcceptsMutation(flow);
    const now = nowIso();
    flow.context = facts.context ?? flow.context;
    flow.risks = facts.risks ?? flow.risks;
    flow.uncertainties = facts.uncertainties ?? flow.uncertainties;
    flow.tasks = facts.tasks ?? flow.tasks;
    flow.done_criteria = facts.done_criteria ?? flow.done_criteria;
    flow.expected_evidence = facts.expected_evidence ?? flow.expected_evidence;
    flow.changed_files = facts.changed_files ?? flow.changed_files;
    flow.changed_files = unique([...flow.changed_files, ...stringArray((facts as Record<string, unknown>).changed_files)]);
    if (Object.prototype.hasOwnProperty.call(facts, "deleted_files")) {
      flow.deleted_files = unique(stringArray((facts as Record<string, unknown>).deleted_files));
    } else {
      flow.deleted_files = flow.deleted_files ?? [];
    }
    assertDeletedFilesBelongToChangedFiles(flow.changed_files, flow.deleted_files);
    flow.decisions = facts.decisions ?? flow.decisions;
    flow.scope = {
      in: facts.scope?.in ?? flow.scope.in,
      out: facts.scope?.out ?? flow.scope.out
    };
    flow.updated_at = now;
    flow.history.push({ at: now, type: "flow_facts_updated", data: facts as Record<string, unknown> });
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "flow_facts_updated", facts as Record<string, unknown>);
    return flow;
  }

  async validateSpt(input: { workspace: string; spt_path: string; objective?: string }): Promise<SptValidationResult> {
    requireText(input.workspace, "workspace");
    requireText(input.spt_path, "spt_path");
    const workspace = path.resolve(input.workspace);
    const sptPath = resolveSptPath(workspace, input.spt_path);
    const planTasksDir = path.join(workspace, ".agents", "PLAN-TASKS");
    const checks: Record<string, boolean> = {};
    const missing: string[] = [];
    const warnings: string[] = [];
    const risks: string[] = [];

    checks.workspace_absolute = path.isAbsolute(input.workspace);
    checks.workspace_exists = await this.store.pathExists(workspace);
    checks.workspace_is_directory = checks.workspace_exists && (await isDirectory(workspace));
    checks.spt_path_not_sensitive = !isSensitivePath(sptPath);
    checks.spt_inside_workspace = checks.workspace_is_directory && isInsideOrEqual(workspace, sptPath);
    checks.spt_under_plan_tasks = checks.workspace_is_directory && isInsideOrEqual(planTasksDir, sptPath);
    checks.spt_exists = checks.spt_path_not_sensitive && (await this.store.pathExists(sptPath));
    checks.spt_is_file = checks.spt_exists && (await isFile(sptPath));

    let text = "";
    let documentBytes: Buffer | null = null;
    if (checks.spt_is_file && checks.spt_inside_workspace && checks.spt_under_plan_tasks) {
      documentBytes = await readFile(sptPath);
      text = documentBytes.toString("utf8");
    }

    const parsedSpt = parseSptDocument(text);
    const contract = parsedSpt.contract;
    const contractLabel = contract?.version === 3 || parsedSpt.errors.some((error) => error.startsWith("spt_v3."))
      ? "spt_v3"
      : "spt_v2";
    checks.spt_frontmatter_present = parsedSpt.checks.frontmatter_present;
    checks.spt_frontmatter_closed = parsedSpt.checks.frontmatter_closed;
    checks.spt_yaml_valid = parsedSpt.checks.yaml_valid;
    checks.spt_schema_valid = parsedSpt.checks.schema_valid;
    checks.spt_semantics_valid = parsedSpt.checks.semantics_valid;
    checks.spt_workspace_matches = !!contract && path.resolve(contract.workspace) === workspace;
    checks.spt_objective_matches =
      !input.objective || (!!contract && normalizeComparable(contract.goal.objective) === normalizeComparable(input.objective));
    checks[`${contractLabel}_frontmatter_present`] = checks.spt_frontmatter_present;
    checks[`${contractLabel}_frontmatter_closed`] = checks.spt_frontmatter_closed;
    checks[`${contractLabel}_yaml_valid`] = checks.spt_yaml_valid;
    checks[`${contractLabel}_schema_valid`] = checks.spt_schema_valid;
    checks[`${contractLabel}_semantics_valid`] = checks.spt_semantics_valid;
    checks[`${contractLabel}_workspace_matches`] = checks.spt_workspace_matches;
    checks[`${contractLabel}_objective_matches`] = checks.spt_objective_matches;

    const requiredChecks: Record<string, string> = {
      workspace_absolute: "workspace_absolute",
      workspace_exists: "workspace_exists",
      workspace_is_directory: "workspace_is_directory",
      spt_path_not_sensitive: "spt_path_not_sensitive",
      spt_inside_workspace: "spt_inside_workspace",
      spt_under_plan_tasks: "spt_under_plan_tasks",
      spt_exists: "spt_exists",
      spt_is_file: "spt_is_file",
      spt_frontmatter_present: `${contractLabel}.frontmatter`,
      spt_frontmatter_closed: `${contractLabel}.frontmatter_closing_marker`,
      spt_yaml_valid: `${contractLabel}.yaml`,
      spt_schema_valid: `${contractLabel}.schema`,
      spt_semantics_valid: `${contractLabel}.semantics`,
      spt_workspace_matches: `${contractLabel}.workspace_matches_request`,
      spt_objective_matches: `${contractLabel}.objective_matches_request`
    };
    for (const [key, label] of Object.entries(requiredChecks)) {
      if (!checks[key]) {
        missing.push(label);
      }
    }

    if (contract && /\b(api[_-]?key|token|password|secret|authorization)\b/i.test(JSON.stringify(contract))) {
      warnings.push("spt_mentions_sensitive_terms_review_without_echoing_values");
    }
    const contractErrors = parsedSpt.errors.map((error) =>
      contractLabel === "spt_v2" ? error.replace(/^spt\./, "spt_v2.") : error.replace(/^spt\./, "spt_v3.")
    );
    missing.push(...contractErrors.filter((error) => !missing.includes(error)));
    if (!checks.spt_under_plan_tasks) {
      risks.push("SPT fora de .agents/PLAN-TASKS pode quebrar a retomada canonica.");
    }
    if (!checks.spt_path_not_sensitive) {
      risks.push("SPT aponta para path sensivel e nao deve ser lido pelo harness.");
    }

    return {
      valid: missing.length === 0,
      workspace,
      spt_path: sptPath,
      contract_version: contract?.version ?? null,
      execution_eligible: contract?.version === 3,
      goal_id: contract?.goal.id ?? null,
      contract_fingerprint: contract ? fingerprintSptContract(contract) : null,
      document_sha256: documentBytes ? sha256SptDocument(documentBytes) : null,
      checks,
      contract_errors: contractErrors,
      missing,
      warnings,
      risks,
      tasks:
        contract?.version === 3
          ? taskProjection(contract)
          : contract?.tasks ?? [],
      expected_evidence:
        contract?.version === 3
          ? evidenceRequirementProjection(contract)
          : contract?.expected_evidence ?? [],
      done_criteria:
        contract?.version === 3
          ? criterionProjection(contract)
          : contract?.done_criteria ?? [],
      ...(contract?.version === 3 ? { traceability: traceabilityFromContract(contract) } : {}),
      next_step:
        missing.length > 0
          ? `corrigir_spt: ${missing.join(", ")}`
          : contract?.version === 3
            ? "goal_start"
            : "migrar_spt_v3_para_nova_execucao"
    };
  }

  async startGoal(input: GoalEnvelope): Promise<Record<string, unknown>> {
    const idempotencyKey = normalizeGoalEnvelope(input).idempotency_key;
    const claimId = `goal_start_${createHash("sha256").update(idempotencyKey, "utf8").digest("hex").slice(0, 24)}`;
    const deadline = Date.now() + 35_000;
    while (true) {
      try {
        return await this.store.withFlowLock(claimId, () => this.startGoalUnlocked(input));
      } catch (error) {
        if (!errorMessage(error).startsWith(`MEETING_LOCKED: ${claimId};`) || Date.now() >= deadline) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private async startGoalUnlocked(input: GoalEnvelope): Promise<Record<string, unknown>> {
    const envelope = normalizeGoalEnvelope(input);
    const canonicalStore = path.basename(this.store.root).toLowerCase() === ".ppirtv";
    if (!canonicalStore && !this.store.fixtureOnlyNoncanonicalRoot) {
      throw new Error(
        "PPIRTV_STORE_PROJECT_ROOT_REQUIRED: goal_start requires a canonical <workspace>/.ppirtv store; noncanonical roots are fixture-only and must be declared explicitly"
      );
    }
    const workspaceMatchesStore =
      this.store.fixtureOnlyNoncanonicalRoot
      || sameRuntimePath(envelope.workspace, this.store.runtimePaths.projectRoot);
    if (!workspaceMatchesStore) {
      throw new Error(
        `GOAL_WORKSPACE_STORE_MISMATCH: requested workspace ${envelope.workspace} differs from runtime project_root ${this.store.runtimePaths.projectRoot}`
      );
    }
    const validation = await this.validateSpt({
      workspace: envelope.workspace,
      spt_path: envelope.spt_path,
      objective: envelope.objective
    });
    if (!validation.valid) {
      throw new Error(`Invalid SPT for goal_start: ${validation.missing.join(", ")}`);
    }
    const now = nowIso();
    const existingByKey = await this.findGoalFlowByIdempotencyKey(envelope.idempotency_key);
    let flow: Flow;
    let reused = false;
    let newlyCreated = false;
    if (envelope.flow_id) {
      flow = await this.store.loadFlow(envelope.flow_id);
      if (existingByKey && existingByKey.flow_id !== flow.flow_id) {
        throw new Error(`idempotency_key already belongs to ${existingByKey.flow_id}`);
      }
      assertCompatibleGoalBinding(flow.goal_binding, envelope, validation.contract_fingerprint);
      reused = flow.goal_binding !== undefined;
    } else if (existingByKey) {
      assertCompatibleGoalBinding(existingByKey.goal_binding, envelope, validation.contract_fingerprint);
      flow = existingByKey;
      reused = true;
    } else {
      flow = this.buildInitialFlow({
        goal: envelope.objective,
        owner: "dex-code",
        context: `GOAL/SPT via dex-code. Workspace: ${envelope.workspace}. SPT: ${envelope.spt_path}.`,
        scope: {
          in: ["Executar fluxo PPIRTV do SPT validado", "Registrar evidencias rastreaveis", "Emitir veredito PPIRTV"],
          out: ["Executar hooks invisiveis", "Ler .env ou segredos", "Duplicar flow por retry"]
        },
        risks: ["Conclusao positiva exige evidencia rastreavel.", ...validation.risks],
        uncertainties: ["Integracao real do dex-code pode ajustar campos futuros sem quebrar este envelope."]
      }, await this.store.nextId("flow"), now);
      newlyCreated = true;
    }

    const effectiveFlowRole = envelope.flow_role ?? "execution";
    if (
      !reused
      && validation.contract_version === 2
      && effectiveFlowRole === "execution"
      && !this.store.fixtureOnlyNoncanonicalRoot
    ) {
      throw new Error(
        "SPT_V2_EXECUTION_MIGRATION_REQUIRED: new execution bindings require an explicit SPT v3; v2 remains readable for exact retry, recovery or reconciliation"
      );
    }

    return this.store.withFlowLock(flow.flow_id, async () => {
    if (!newlyCreated) {
      flow = await this.store.loadFlow(flow.flow_id);
      reused = flow.goal_binding !== undefined;
    }
    if (reused) {
      assertCompatibleGoalBinding(flow.goal_binding, envelope, validation.contract_fingerprint);
    }
    if (!flow.goal_binding && flowIsTerminal(flow)) {
      throw new Error(
        `GOAL_TERMINAL_FLOW_UNBOUND: flow ${flow.flow_id} is terminal and cannot receive its first GOAL binding`
      );
    }
    assertLegacyFlowCanReceiveFirstGoalBinding(flow, envelope);
    if (reused && flowIsTerminal(flow)) {
      await ensureLedgerTransitionRecorded(this.store, flow, {
        originalType: "flow_created",
        recoveredType: "flow_created_recovered",
        originalAt: flow.created_at,
        data: { goal: flow.goal, phase: flow.history.find((event) => event.type === "flow_created")?.data.phase ?? flow.phase }
      });
      await ensureLedgerTransitionRecorded(this.store, flow, {
        originalType: "goal_started",
        recoveredType: "goal_started_recovered",
        originalAt: flow.goal_binding!.started_at,
        data: goalLedgerData(flow.goal_binding!, flow),
        actor: "dex-code"
      });
      return {
        ...(await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow) })),
        started: false,
        reused: true,
        spt_validation: validation,
        goal_envelope: flow.goal_binding?.envelope
      };
    }
    const previousBinding = flow.goal_binding;
    const previousMode = flow.mode;
    const previousPhase = flow.phase;
    const incomingMode = envelope.mode ?? (reused ? flow.mode ?? "compact" : "compact");
    const flowRole = previousBinding?.flow_role ?? envelope.flow_role ?? "execution";
    const { flow_role: _inputFlowRole, ...envelopeWithoutFlowRole } = envelope;
    const boundEnvelope = previousBinding?.envelope ?? {
      ...envelopeWithoutFlowRole,
      flow_id: flow.flow_id,
      mode: incomingMode
    };
    flow.goal_binding = {
      envelope: boundEnvelope,
      flow_role: previousBinding ? previousBinding.flow_role : flowRole,
      goal_id: previousBinding ? previousBinding.goal_id : validation.goal_id ?? undefined,
      spt_contract_fingerprint: previousBinding?.spt_contract_fingerprint ?? validation.contract_fingerprint ?? undefined,
      spt_document_sha256_at_start:
        previousBinding ? previousBinding.spt_document_sha256_at_start : validation.document_sha256 ?? undefined,
      started_at: previousBinding?.started_at ?? now,
      last_seen_at: now
    };
    if (!previousBinding) {
      flow.spt_contract_version = validation.contract_version ?? undefined;
      flow.spt_traceability = validation.traceability;
    }
    assertNoSecretLikeItems(parsedValidationItems(validation), "spt_validation");
    flow.tasks = unique([...flow.tasks, ...validation.tasks]);
    flow.done_criteria = unique([...flow.done_criteria, ...validation.done_criteria]);
    flow.expected_evidence = unique([...flow.expected_evidence, ...validation.expected_evidence, ...envelope.required_evidence]);
    flow.risks = unique([...flow.risks, "Conclusao positiva exige evidencia rastreavel.", ...validation.risks]);
    flow.updated_at = now;
    flow.history.push({
      at: now,
      type: reused ? "goal_reused" : "goal_started",
      data: goalLedgerData(flow.goal_binding, flow)
    });
    // Patch A (modo compact wire-up): propagar envelope.mode para flow.mode.
    // Default "compact" quando ausente. Em retry sem modo explicito, preservar
    // o perfil persistido para nao migrar um flow antigo no meio da execucao.
    // Se compact e o flow ainda esta em fase
    // full inicial ("pensamentos"), migrar para a fase inicial compact
    // ("concepcao") para que advance/checkGate operem no perfil certo.
    // R2 (revisor-codigo): se o flow ja existe com modo diferente (idempotency
    // reuse), rejeitar em vez de sobrescrever silenciosamente — isso quebraria
    // o fluxo em fase avancada.
    // P2a (hardening): snapshot do estado pre-mutacao para rollback em caso
    // de falha em saveFlow. Sem isso, o flow em memoria fica divergente do
    // disco apos IO error.
    if (reused && flow.mode && flow.mode !== incomingMode) {
      throw new Error(`MODE_MISMATCH: flow already in mode "${flow.mode}", cannot switch to "${incomingMode}" (idempotency_key=${envelope.idempotency_key})`);
    }
    flow.mode = incomingMode;
    if (flow.mode === "compact" && flow.phase === "pensamentos" && flow.verdicts.length === 0 && Object.keys(flow.gates).length === 0) {
      flow.phase = "concepcao";
      flow.history.push({ at: now, type: "flow_created", data: { phase: "concepcao", mode: "compact" } });
    }
    try {
      await this.store.saveFlow(flow);
    } catch (saveError) {
      // Rollback defensivo: restaurar estado pre-mutacao para nao deixar o
      // flow em memoria divergente do disco.
      flow.mode = previousMode;
      flow.phase = previousPhase;
      throw saveError;
    }
    const existingLedger = await this.store.readLedger(flow.flow_id);
    if (newlyCreated) {
      await this.ledger(flow.flow_id, "flow_created", {
        goal: flow.goal,
        phase: flow.history.find((event) => event.type === "flow_created")?.data.phase ?? flow.phase
      });
      await this.ledger(flow.flow_id, "goal_started", goalLedgerData(flow.goal_binding, flow), "dex-code");
    } else if (!reused) {
      await ensureLedgerTransitionRecorded(this.store, flow, {
        originalType: "flow_created",
        recoveredType: "flow_created_recovered",
        originalAt: flow.created_at,
        data: { goal: flow.goal, phase: flow.history.find((event) => event.type === "flow_created")?.data.phase ?? flow.phase }
      });
      await this.ledger(flow.flow_id, "goal_started", goalLedgerData(flow.goal_binding, flow), "dex-code");
    } else {
      const hasGoalStarted = existingLedger.some(
        (event) => event.type === "goal_started" || event.type === "goal_started_recovered"
      );
      await ensureLedgerTransitionRecorded(this.store, flow, {
        originalType: "flow_created",
        recoveredType: "flow_created_recovered",
        originalAt: flow.created_at,
        data: { goal: flow.goal, phase: flow.history.find((event) => event.type === "flow_created")?.data.phase ?? flow.phase }
      });
      await ensureLedgerTransitionRecorded(this.store, flow, {
        originalType: "goal_started",
        recoveredType: "goal_started_recovered",
        originalAt: flow.goal_binding.started_at,
        data: goalLedgerData(flow.goal_binding, flow),
        actor: "dex-code"
      });
      if (hasGoalStarted) {
        await this.ledger(flow.flow_id, "goal_reused", goalLedgerData(flow.goal_binding, flow), "dex-code");
      }
    }

    return {
      ...(await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow) })),
      started: !reused,
      reused,
      spt_validation: validation,
      goal_envelope: flow.goal_binding.envelope
    };
    });
  }

  async goalStatus(input: { flow_id?: string; idempotency_key?: string; detail?: "lean" | "compact" | "full" }): Promise<Record<string, unknown>> {
    let flow = await this.resolveGoalFlow(input);
    flow = await this.flowWithCurrentImplementationFingerprint(flow);
    const detail = input.detail === "lean" ? "lean" : input.detail === "compact" ? "compact" : "full";
    // DT-04 (pragmatic/chato): detail "lean" retorna apenas nucleo do status
    // (fase, status, blockers, next_step, display, aliases) sem montar
    // checkout, checkin, checklist ou fiscal_policy. Target: <5KB.
    if (detail === "lean") {
      const gate = flow.gates[flow.phase];
      const phaseSnapshot = this.resolveGateSnapshot(
        flow,
        flow.phase,
        (gate?.provided ?? {}) as Record<string, unknown>
      );
      const phaseBlockers = reconciledBlockers(flow, phaseSnapshot.missing);
      // BUG-LEAN-01+02: calcular campos acionaveis de blocker mesmo em lean.
      // Sem isso, o operador fica preso sem saber o que fazer para destravar.
      const fiscal = evaluateFiscalPolicy(flow);
      const persistedFiscal = latestFiscalBlock(flow);
      const meetings = await this.store.listMeetings(flow.flow_id);
      const closureBlockers = closureBlockersFor(flow, meetings);
      const allBlockers = unique([...phaseBlockers, ...closureBlockers]);
      const meetingRequired = allBlockers.includes("required_cooperation");
      const requiredCooperation = meetingRequired
        ? fiscal.required_cooperation.length > 0
          ? fiscal.required_cooperation
          : persistedFiscal.required_cooperation.length > 0
            ? persistedFiscal.required_cooperation
            : requiredCoo(allBlockers)
        : [];
      const regressCount = countRegressions(flow);
      const regressLimitReached = regressCount >= FISCAL_CONFIG.maxRegressions;
      const nextPhase = profileFor(flow.mode).nextPhase[flow.phase] as AnyPhase | null;
      const canAdvancePhase = phaseAdvanceAllowed(flow, phaseBlockers, closureBlockers);
      const next = phaseBlockers.length > 0
        ? `complete_gate_${flow.phase}`
        : nextPhase
          ? `advance_to_${nextPhase}`
          : closureBlockers.length > 0
            ? fiscalResult(true, closureBlockers).direct_action
            : "complete";
      // next_required_action: acao concreta para o operador destravar.
      let nextRequiredAction = nextRequiredActionFor(
        flow,
        meetings,
        allBlockers,
        allBlockers.length > 0 ? fiscalBackTo(flow) : null,
        regressCount,
        regressLimitReached,
        null
      );
      if (!nextRequiredAction) {
        if (allBlockers.includes("review_required")) {
          nextRequiredAction = { type: "attach_review", tool: "evidence_add", reason: "review_required exige evidencia de revisao" };
        } else if (allBlockers.includes("memory_required_but_empty")) {
          nextRequiredAction = { type: "run_memory_mining", tool: "mm_memory_mining", reason: "memory_required_but_empty exige mineracao" };
        } else if (allBlockers.length > 0) {
          nextRequiredAction = { type: "resolve_blockers", tool: "goal_status", detail: "full", reason: `blockers: ${allBlockers.join(", ")}` };
        }
      }
      const directAction = allBlockers.length > 0
        ? `Bloqueado: ${allBlockers.join(", ")}`
        : "Sem bloqueio local; verificar status fiscal antes de avancar";
      // barata_scan (auditoria): incluir counts de vizinhos do erro para o
      // operador aplicar "barata nunca esta sozinha" sem precisar de full.
      const currentVerdict = flow.verdicts.at(-1) ?? null;
      const loopMonitor = strongestLoopMonitor(flow, phaseBlockers, closureBlockers, allBlockers);
      const runtimeLayoutStatus = await this.store.runtimeLayoutStatus();
      const workProgress = workProgressSummary(flow);
      const lean: Record<string, unknown> = {
        flow_id: flow.flow_id,
        phase: flow.phase,
        mode: flow.mode,
        status: effectiveFlowStatus(flow, allBlockers),
        project_root: runtimeLayoutStatus.project_root,
        ppirtv_home: runtimeLayoutStatus.ppirtv_home,
        runtime_layout_status: runtimeLayoutStatus,
        memory_writer_runtime: memoryWriterRuntimeSummary(this.options.memory_writer, runtimeLayoutStatus.project_root),
        blockers: allBlockers,
        phase_blockers: phaseBlockers,
        closure_blockers: closureBlockers,
        phase_advance_allowed: canAdvancePhase,
        next_step: next,
        gate_status: gate ? (phaseBlockers.length === 0 ? "passed" : "blocked") : "unchecked",
        gate_missing: phaseBlockers,
        goal: flow.goal,
        goal_envelope: flow.goal_binding?.envelope ?? null,
        implementation_fingerprint: flow.implementation_fingerprint ?? null,
        // Campos acionaveis de blocker (BUG-LEAN-01+02): pequenos em bytes
        // mas essenciais para o operador saber COMO destravar o flow.
        required_cooperation: requiredCooperation,
        next_required_action: nextRequiredAction,
        phase_next_required_action: canAdvancePhase && nextPhase
          ? {
              type: "advance_phase",
              tool: "goal_advance",
              reason: closureBlockers.length > 0
                ? `gate local concluido; pendencias fiscais permanecem para o fechamento: ${closureBlockers.join(", ")}`
                : "gate local concluido"
            }
          : null,
        phase_direct_action: canAdvancePhase && nextPhase
          ? phaseAdvanceDirectAction(closureBlockers, nextPhase)
          : null,
        meeting_required: meetingRequired,
        regress_required: allBlockers.length > 0 && !regressLimitReached,
        regress_count: regressCount,
        max_regressions: FISCAL_CONFIG.maxRegressions,
        regress_limit_reached: regressLimitReached,
        // barata_scan (auditoria vizinhos): counts e sinal, nao arrays.
        evidence_count: flow.evidence.length,
        meetings_count: flow.meetings.length,
        meeting_outcome_summary: meetingOutcomeCounts(flow),
        current_verdict: currentVerdict ? { verdict_id: currentVerdict.verdict_id, status: currentVerdict.status } : null,
        current_verdict_status: currentVerdict?.status ?? null,
        work_progress: workProgress,
        loop_monitor: loopMonitor ? { count: loopMonitor.count, signature: loopMonitor.signature, escalation_active: loopMonitor.escalation?.active ?? false } : null,
        aliases: {
          fase: flow.phase,
          faltando: allBlockers,
          proximo: next
        },
        display: {
          phase_label: profileFor(flow.mode).displayMeta[flow.phase]?.label ?? flow.phase,
          phase_emoji: profileFor(flow.mode).displayMeta[flow.phase]?.emoji ?? "",
          direct_action: directAction,
          work_progress: workProgress
        }
      };
      return lean;
    }
    const checklist = await this.renderChecklist(flow.flow_id, detail === "compact" ? "compact" : "full");
    const savedGate = flow.gates[flow.phase];
    const gateProvided = savedGate?.status === "blocked" || (savedGate?.status === "passed" && officialGoalNeedsCanonicalVerdict(flow))
      ? savedGate.provided
      : {};
    const gate = await this.checkGate({ flow_id: flow.flow_id, phase: flow.phase, provided: gateProvided, persist: false });
    const currentVerdict = flow.verdicts.at(-1) ?? null;
    let rawLibrarianStatus = latestLibrarianStatus(flow) ?? latestLibrarianStatusFromLedger(await this.store.readLedger(flow.flow_id));
    if (!rawLibrarianStatus && graphifyRecallConfigured() && flow.status !== "archived") {
      rawLibrarianStatus = await this.runBeforePhaseHook(flow, flow.phase, "ppirtv_checkin");
      flow = await this.store.loadFlow(flow.flow_id);
    }
    const fiscal = evaluateFiscalPolicy(flow);
    const persistedFiscal = latestFiscalBlock(flow);
    const librarianStatus = structuredLibrarianStatus(rawLibrarianStatus);
    let requiredCooperation = fiscal.required_cooperation.length > 0 ? fiscal.required_cooperation : persistedFiscal.required_cooperation;
    const meetings = await this.store.listMeetings(flow.flow_id);
    const gateBlockers = flow.status === "complete" || flow.status === "archived" ? [] : gate.status === "blocked" ? gate.missing : [];
    const memoryMiningBlockers = memoryMiningVerdictBlockers(flow);
    const closureBlockers = closureBlockersFor(flow, meetings);
    const blockers = unique([...gateBlockers, ...closureBlockers]);
    const nextPhase = profileFor(flow.mode).nextPhase[flow.phase] as AnyPhase | null;
    const canAdvancePhase = phaseAdvanceAllowed(flow, gateBlockers, closureBlockers);
    if (blockers.includes("required_cooperation") && requiredCooperation.length === 0) {
      requiredCooperation = requiredCoo(blockers);
    }
    const blockerDiagnostics = blockerDiagnosticsFor(flow, meetings, gate, gateBlockers, fiscal, persistedFiscal, blockers, memoryMiningBlockers);
    const effectiveStatus = effectiveFlowStatus(flow, blockers);
    const presentationFlow = { ...flow, status: effectiveStatus };
    const directAction = blockers.length > 0 ? blockedDirectAction(blockers) : checklist.display.direct_action;
    const checklistStatus = directAction ? withDirectAction(checklist, directAction) : checklist;
    const backTo = blockers.length > 0 ? fiscalBackTo(flow) : null;
    const regressCount = countRegressions(flow);
    const regressLimitReached = regressCount >= FISCAL_CONFIG.maxRegressions;
    const loopMonitor = strongestLoopMonitor(flow, gateBlockers, closureBlockers, blockers);
    const nextRequiredAction = nextRequiredActionFor(
      flow,
      meetings,
      blockers,
      backTo,
      regressCount,
      regressLimitReached,
      loopMonitor
    );
    const resolutionGuidance = blockerResolutionGuidance(blockers, nextRequiredAction, loopMonitor);
    const runtimeLayoutStatus = await this.store.runtimeLayoutStatus();
    const workProgress = workProgressSummary(flow);
    return {
      flow_id: flow.flow_id,
      status: effectiveStatus,
      phase: flow.phase,
      project_root: runtimeLayoutStatus.project_root,
      ppirtv_home: runtimeLayoutStatus.ppirtv_home,
      runtime_layout_status: runtimeLayoutStatus,
      memory_writer_runtime: memoryWriterRuntimeSummary(this.options.memory_writer, runtimeLayoutStatus.project_root),
      phase_label: checklistStatus.display.phase_label,
      phase_emoji: checklistStatus.display.phase_emoji,
      checklist: checklistStatus,
      tasks: flow.tasks,
      expected_evidence: flow.expected_evidence,
      done_criteria: flow.done_criteria,
      implementation_fingerprint: flow.implementation_fingerprint ?? null,
      evidence: flow.evidence.map((evidence) => ({
        evidence_id: evidence.evidence_id,
        kind: evidence.kind,
        title: evidence.title,
        uri: evidence.uri,
        created_at: evidence.created_at,
        evidence_quality: classifyEvidenceQuality(evidence)
      })),
      meetings: meetings.map((meeting) => ({
        meeting_id: meeting.meeting_id,
        type: meeting.type,
        kind: meeting.kind,
        status: meeting.status,
        question: meeting.question,
        opened_at: meeting.opened_at,
        closed_at: meeting.closed_at,
        participants_required: meeting.participants_required,
        participants_present: meeting.participants_present,
        suggested_cooperators: meeting.suggested_cooperators,
        questions: meeting.questions,
        findings: meeting.findings,
        decision: meeting.decision,
        next_required_action: meeting.next_required_action,
        satisfies_blockers: meeting.satisfies_blockers,
        created_by: meeting.created_by,
        evidence_ids: meeting.evidence_ids,
        turns: meeting.turns,
        cooperators: meeting.cooperators,
        active_credits: meeting.active_credits
      })),
      ...(detail === "full" ? { meeting_outcomes: meetingOutcomeSummaries(flow) } : {}),
      meeting_outcome_summary: meetingOutcomeCounts(flow),
      gates: flow.gates,
      parking_lot: flow.parking_lot,
      gold_mining: flow.gold_mining,
      goal_learning_links: flow.goal_learning_links,
      cooperators: flow.cooperators,
      active_credits: flow.active_credits,
      memory_mining: memoryMiningStatus(flow),
      work_progress: workProgress,
      blockers,
      phase_blockers: gateBlockers,
      closure_blockers: closureBlockers,
      phase_advance_allowed: canAdvancePhase,
      gate_status: gate.status,
      gate_missing: reconciledBlockers(flow, gate.missing),
      blocker_diagnostics: blockerDiagnostics,
      next_step: gateBlockers.length > 0
        ? `complete_gate_${flow.phase}`
        : nextPhase
          ? `advance_to_${nextPhase}`
          : closureBlockers.length > 0
            ? fiscalResult(true, closureBlockers).direct_action
            : nextGoalStep(flow, gate),
      meeting_required: blockers.includes("required_cooperation"),
      phase_next_required_action: canAdvancePhase && nextPhase
        ? {
            type: "advance_phase",
            tool: "goal_advance",
            reason: closureBlockers.length > 0
              ? `gate local concluido; pendencias fiscais permanecem para o fechamento: ${closureBlockers.join(", ")}`
              : "gate local concluido"
          }
        : null,
      phase_direct_action: canAdvancePhase && nextPhase
        ? phaseAdvanceDirectAction(closureBlockers, nextPhase)
        : null,
      regress_required: blockers.length > 0 && !regressLimitReached,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      regress_limit_reached: regressLimitReached,
      locked_by_limit: regressLimitReached,
      back_to: backTo,
      loop_monitor: loopMonitor,
      next_required_action: nextRequiredAction,
      resolution_guidance: resolutionGuidance,
      can_retry_verdict: blockers.length === 0,
      current_verdict: currentVerdict,
      goal_envelope: flow.goal_binding?.envelope ?? null,
      aliases: checklistStatus.aliases,
      display: {
        ...checklistStatus.display,
        direct_action: directAction,
        librarian: rawLibrarianStatus ?? checklist.display.librarian,
        work_progress: workProgress
      },
      suggested_cooperation: gate.suggested_cooperation,
      required_cooperation: requiredCooperation,
      fiscal_policy: fiscal,
      librarian_status: librarianStatus,
      ppirtv_checkin: ppirtvCheckIn(presentationFlow, requiredCooperation, librarianStatus, blockers, resolutionGuidance),
      ppirtv_checkout: compactPpirtvCheckout(
        ppirtvCheckOut(
          presentationFlow,
          librarianStatus,
          blockers,
          resolutionGuidance,
          blockerDiagnostics,
          runtimeLayoutStatus,
          {
            phase_blockers: gateBlockers,
            closure_blockers: closureBlockers,
            phase_advance_allowed: canAdvancePhase
          }
        ),
        detail
      )
    };
  }

  async goalCheckout(input: { flow_id?: string; idempotency_key?: string; detail?: "lean" | "compact" | "full" }): Promise<Record<string, unknown>> {
    if (input.detail === "lean") {
      const flow = await this.resolveGoalFlow(input);
      const status = await this.goalStatus({ ...input, detail: "lean" });
      const rawLibrarianStatus = latestLibrarianStatus(flow) ?? latestLibrarianStatusFromLedger(await this.store.readLedger(flow.flow_id));
      const librarianStatus = structuredLibrarianStatus(rawLibrarianStatus);
      const display = (status.display as Record<string, unknown> | undefined) ?? {};
      const currentVerdict = flow.verdicts.at(-1) ?? null;
      return {
        flow_id: flow.flow_id,
        status: status.status,
        phase: flow.phase,
        mode: flow.mode,
        blockers: status.blockers,
        phase_blockers: status.phase_blockers,
        closure_blockers: status.closure_blockers,
        phase_advance_allowed: status.phase_advance_allowed,
        direct_action: display.direct_action ?? status.next_step,
        complete: status.status === "complete",
        verdict: currentVerdict ? { verdict_id: currentVerdict.verdict_id, status: currentVerdict.status } : null,
        evidence_count: status.evidence_count,
        meetings_count: status.meetings_count,
        memory_review_status: flow.memory_mining?.memory_review_status ?? "not_required",
        work_progress: status.work_progress,
        project_root: status.project_root,
        ppirtv_home: status.ppirtv_home,
        runtime_layout_status: status.runtime_layout_status,
        recall_executed: librarianStatus.recall_executed,
        consumption_confirmed: librarianStatus.consumption_confirmed,
        librarian_accountability: librarianCheckoutAccountability(librarianStatus)
      };
    }
    const statusDetail = input.detail;
    const status = await this.goalStatus({ ...input, detail: statusDetail });
    const checkout = status.ppirtv_checkout as Record<string, unknown>;
    // A+C (DRY): o checkout interno ja foi processado por compactPpirtvCheckout
    // quando detail=compact. Nao reomitir nem recompute count aqui — confiar
    // no processamento anterior. Apenas espelhar campos do checkout no top-level.
    return {
      flow_id: status.flow_id,
      status: status.status,
      phase: status.phase,
      blockers: status.blockers,
      phase_blockers: status.phase_blockers,
      closure_blockers: status.closure_blockers,
      phase_advance_allowed: status.phase_advance_allowed,
      direct_action: checkout.direct_action,
      complete: checkout.complete,
      verdict: checkout.verdict,
      memory_accountability: checkout.memory_accountability,
      learning_accountability: checkout.learning_accountability,
      cooperation_accountability: checkout.cooperation_accountability,
      librarian_accountability: checkout.librarian_accountability,
      work_progress: checkout.work_progress,
      contract_accountability: checkout.contract_accountability,
      ready_definition: checkout.ready_definition,
      gate_final_output: checkout.gate_final_output,
      final_report_model: checkout.final_report_model,
      default_workflow: checkout.default_workflow,
      project_root: checkout.project_root,
      ppirtv_home: checkout.ppirtv_home,
      runtime_layout_status: checkout.runtime_layout_status,
      evidence_accountability: checkout.evidence_accountability,
      blocker_diagnostics: checkout.blocker_diagnostics,
      utility_accountability: checkout.utility_accountability,
      prestacao_de_contas: checkout.prestacao_de_contas,
      prestacao_de_contas_count: checkout.prestacao_de_contas_count,
      residual_risks: checkout.residual_risks,
      resolution_guidance: checkout.resolution_guidance,
      ppirtv_checkout: checkout
    };
  }

  async resumeGoal(input: { flow_id?: string; idempotency_key?: string; note?: string }): Promise<Record<string, unknown>> {
    const resolvedFlow = await this.resolveGoalFlow(input);
    return this.store.withFlowLock(resolvedFlow.flow_id, async () => {
    const flow = await this.store.loadFlow(resolvedFlow.flow_id);
    assertGoalBinding(flow);
    assertFlowAcceptsMutation(flow);
    const now = nowIso();
    if (flow.goal_binding) {
      flow.goal_binding.last_seen_at = now;
    }
    flow.updated_at = now;
    flow.history.push({ at: now, type: "goal_resumed", data: { note: input.note ?? "resume requested" } });
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "goal_resumed", { note: input.note ?? "resume requested" }, "dex-code");
    return {
      ...(await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow) })),
      resumed: true
    };
    });
  }

  async goalGateCheck(input: {
    flow_id?: string;
    idempotency_key?: string;
    phase?: AnyPhase;
    provided?: Record<string, unknown>;
    persist?: boolean;
    detail?: "lean" | "compact" | "full";
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    assertGoalBinding(flow);
    assertNoSecretLikePayload(input.provided, "provided");
    const gate = await this.checkGate({
      flow_id: flow.flow_id,
      phase: input.phase,
      provided: input.provided,
      persist: input.persist ?? true
    });
    return {
      ...gate,
      persisted: input.persist ?? true,
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow, input.detail) })
    };
  }

  async goalGatePreflight(input: {
    flow_id?: string;
    idempotency_key?: string;
    phase?: AnyPhase;
    provided?: Record<string, unknown>;
    detail?: "lean" | "compact";
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    assertGoalBinding(flow);
    assertNoSecretLikePayload(input.provided, "provided");
    const phase = input.phase ?? flow.phase;
    assertPhase(phase);
    const persistedProvided = (flow.gates[phase]?.provided ?? {}) as Record<string, unknown>;
    const effectiveProvided = { ...persistedProvided, ...(input.provided ?? {}) };
    const snapshot = this.resolveGateSnapshot(flow, phase, effectiveProvided);
    const meetings = await this.store.listMeetings(flow.flow_id);
    const closureBlockers = closureBlockersFor(flow, meetings);
    const currentPhaseAdvanceAllowed = phase === flow.phase && phaseAdvanceAllowed(flow, snapshot.missing, closureBlockers);
    const evidenceCandidates = unique(snapshot.requirements.flatMap((item) => item.evidence_ids));
    return {
      flow_id: flow.flow_id,
      phase,
      status: snapshot.missing.length === 0 ? "passed" : "blocked",
      required: snapshot.requirements.map((item) => ({
        key: item.key,
        label: item.label,
        accepted_sources: item.accepted_sources
      })),
      already_satisfied: snapshot.requirements.filter((item) => item.satisfied).map((item) => item.key),
      missing: snapshot.missing,
      phase_blockers: snapshot.missing,
      closure_blockers: closureBlockers,
      phase_advance_allowed: currentPhaseAdvanceAllowed,
      evidence_candidates: evidenceCandidates,
      next_required_action: phase !== flow.phase
        ? { type: "preview_future_phase", executable: false, current_phase: flow.phase }
        : snapshot.missing.length === 0
          ? { tool: "goal_advance", provided: input.provided ?? {} }
          : { tool: "goal_advance", missing: snapshot.missing },
      read_only: true,
      persisted: false
    };
  }

  async goalAdvance(input: {
    flow_id?: string;
    idempotency_key?: string;
    provided?: Record<string, unknown>;
    evidence_ids?: string[];
    recall_consumption?: RecallConsumptionInput;
    detail?: "lean" | "compact" | "full";
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    return this.store.withFlowLock(flow.flow_id, () => this.goalAdvanceUnlocked(input, flow.flow_id));
  }

  private async goalAdvanceUnlocked(input: {
    flow_id?: string;
    idempotency_key?: string;
    provided?: Record<string, unknown>;
    evidence_ids?: string[];
    recall_consumption?: RecallConsumptionInput;
    detail?: "lean" | "compact" | "full";
  }, resolvedFlowId: string): Promise<Record<string, unknown>> {
    const flow = await this.store.loadFlow(resolvedFlowId);
    assertGoalBinding(flow);
    if (flowIsTerminal(flow)) {
      return this.advanceUnlocked({
        flow_id: flow.flow_id,
        evidence_ids: input.evidence_ids,
        actor: "dex-code"
      });
    }
    assertNoSecretLikePayload(input.provided, "provided");
    const recallConsumption = input.recall_consumption
      ? await this.confirmRecallConsumption(flow, input.recall_consumption, "dex-code")
      : null;
    const beforeSnapshot = this.resolveGateSnapshot(
      flow,
      flow.phase,
      (flow.gates[flow.phase]?.provided ?? {}) as Record<string, unknown>
    );
    const savedGate = flow.gates[flow.phase];
    const shouldReuseSavedGate =
      !input.provided &&
      savedGate?.status === "passed" &&
      !officialGoalNeedsCanonicalVerdict(flow);
    const providedForGate =
      !input.provided && savedGate?.status === "passed" && officialGoalNeedsCanonicalVerdict(flow)
        ? savedGate.provided
        : input.provided;
    const gate = shouldReuseSavedGate
      ? presentGate(savedGate as GateRecord & Record<string, unknown>, flow)
      : await this.checkGateUnlocked({
          flow_id: flow.flow_id,
          phase: flow.phase,
          provided: providedForGate,
          persist: true
        });
    if (gate.status === "blocked") {
      if (input.detail === "compact") {
        const fresh = await this.store.loadFlow(flow.flow_id);
        const meetings = await this.store.listMeetings(fresh.flow_id);
        return this.compactMutationReceipt(fresh, meetings, {
          action: "goal_advance",
          advanced: false,
          before_missing: beforeSnapshot.missing
        });
      }
      return {
        ...gate,
        advanced: false,
        blocked: true,
        recall_consumption: recallConsumption,
        status_snapshot: await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow, input.detail) })
      };
    }
    const advanced = await this.advanceUnlocked({
      flow_id: flow.flow_id,
      evidence_ids: input.evidence_ids,
      actor: "dex-code"
    });
    if (input.detail === "compact") {
      const fresh = await this.store.loadFlow(flow.flow_id);
      const meetings = await this.store.listMeetings(fresh.flow_id);
      return this.compactMutationReceipt(fresh, meetings, {
        action: "goal_advance",
        advanced: advanced.advanced === true,
        from: flow.phase,
        before_missing: beforeSnapshot.missing,
        result_missing: stringArray(advanced.missing)
      });
    }
    return {
      ...advanced,
      gate,
      recall_consumption: recallConsumption,
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow, input.detail) })
    };
  }

  async recordGoalProgress(input: WorkProgressInput): Promise<Record<string, unknown>> {
    const resolvedFlow = await this.resolveGoalFlow(input);
    return this.store.withFlowLock(resolvedFlow.flow_id, async () => {
    const flow = await this.store.loadFlow(resolvedFlow.flow_id);
    assertGoalBinding(flow);
    assertFlowAcceptsMutation(flow);
    assertNoSecretLikePayload(input, "goal_progress_record");
    const eventKey = progressText(input.event_key, 120, "event_key");
    const source = progressText(input.source, 80, "source");
    const operation = progressText(input.operation, 120, "operation");
    const stage = progressText(input.stage, 120, "stage");
    const message = input.message ? progressText(input.message, 240, "message") : undefined;
    validateProgressNumbers(input.current, input.total, input.status);

    const operationEvents = workProgressEvents(flow).filter(
      (event) => event.source === source && event.operation === operation
    );
    const existing = operationEvents.find((event) => event.event_key === eventKey);
    if (existing) {
      return progressReceipt(flow, existing, { recorded: false, reused: true, throttled: false, reason: "event_key_reused" });
    }
    const latest = operationEvents.at(-1);
    if (latest?.status === "completed" || latest?.status === "failed") {
      throw new WorkProgressContractError("PROGRESS_AFTER_TERMINAL", {
        source,
        operation,
        terminal_status: latest.status,
        terminal_progress_id: latest.progress_id
      });
    }
    if (latest && latest.total !== input.total) {
      throw new WorkProgressContractError("PROGRESS_TOTAL_MISMATCH", {
        source,
        operation,
        expected_total: latest.total,
        received_total: input.total
      });
    }
    if (latest && input.current < latest.current) {
      throw new WorkProgressContractError("PROGRESS_OUT_OF_ORDER", {
        source,
        operation,
        latest_current: latest.current,
        received_current: input.current,
        total: input.total
      });
    }
    if (latest && latest.current === input.current && latest.stage === stage && latest.status === input.status) {
      return progressReceipt(flow, latest, { recorded: false, reused: false, throttled: true, reason: "no_material_change" });
    }
    const terminal = input.status === "completed" || input.status === "failed";
    const runningEvents = operationEvents.filter((event) => event.status === "queued" || event.status === "running");
    if (!terminal && runningEvents.length >= WORK_PROGRESS_MAX_RUNNING_EVENTS) {
      return progressReceipt(flow, latest ?? null, { recorded: false, reused: false, throttled: true, reason: "retention_limit" });
    }

    const now = nowIso();
    const event: WorkProgressEvent = {
      progress_id: await this.store.nextId("prg"),
      event_key: eventKey,
      source,
      operation,
      stage,
      current: input.current,
      total: input.total,
      percent: Math.round((input.current / input.total) * 10_000) / 100,
      status: input.status,
      ...(message ? { message } : {}),
      recorded_at: now
    };
    flow.history.push({ at: now, type: "work_progress_recorded", data: event as unknown as Record<string, unknown> });
    flow.updated_at = now;
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "work_progress_recorded", event as unknown as Record<string, unknown>, source);
    return {
      ...progressReceipt(flow, event, { recorded: true, reused: false, throttled: false, reason: "material_progress" }),
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id, detail: "lean" })
    };
    });
  }

  async goalMeetingOpen(input: {
    flow_id?: string;
    idempotency_key?: string;
    type?: MeetingType;
    kind?: MeetingKind;
    question: string;
    participants_required?: string[];
    created_by?: string;
    evidence_ids?: string[];
    suggested_cooperators?: Cooperator[];
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    assertGoalBinding(flow);
    assertNoSecretLikeText(input.question, "question");
    const suggestedCooperators = normalizeSuggestedCooperators(input.suggested_cooperators ?? []);
    const meeting = await this.openMeeting({
      flow_id: flow.flow_id,
      type: input.type,
      kind: input.kind,
      question: input.question,
      participants_required: input.participants_required,
      suggested_cooperators: suggestedCooperators,
      created_by: input.created_by ?? "goal_meeting_open",
      evidence_ids: input.evidence_ids
    });
    return {
      ...meeting,
      suggested_cooperators: suggestedCooperators,
      credit_rule: "suggested_cooperators are not active credits until goal_meeting_close records material decision and participants",
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow) })
    };
  }

  async goalMeetingAddTurn(input: {
    flow_id?: string;
    idempotency_key?: string;
    meeting_id: string;
    speaker?: string;
    question?: string;
    finding?: string;
    note?: string;
    evidence_ids?: string[];
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    assertGoalBinding(flow);
    const meeting = await this.store.loadMeeting(input.meeting_id);
    if (meeting.flow_id !== flow.flow_id) {
      throw new Error(`meeting_id ${input.meeting_id} does not belong to GOAL flow ${flow.flow_id}`);
    }
    assertNoSecretLikePayload(input, "goal_meeting_add_turn");
    const updated = await this.addMeetingTurn(input);
    return {
      ...updated,
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow) })
    };
  }

  async goalMeetingClose(input: Partial<Meeting> & {
    flow_id?: string;
    idempotency_key?: string;
    meeting_id: string;
    participants_present?: string[];
    findings?: string[];
    decision: string;
    next_required_action?: Record<string, unknown> | null;
    satisfies_blockers?: string[];
    evidence_ids?: string[];
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    assertGoalBinding(flow);
    const meeting = await this.store.loadMeeting(input.meeting_id);
    if (meeting.flow_id !== flow.flow_id) {
      throw new Error(`meeting_id ${input.meeting_id} does not belong to GOAL flow ${flow.flow_id}`);
    }
    assertNoSecretLikePayload(input, "goal_meeting_close");
    const closed = await this.closeMeeting(input);
    return {
      ...closed,
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow) })
    };
  }

  async mineMemory(input: {
    flow_id: string;
    auto_classify?: boolean;
    write_policy?: MemoryWritePolicy;
    v2_destinations?: DexMemoriaV2Destination[];
    v2_density?: "light" | "deep";
    v2_owner_skill?: string;
    v2_tags?: string[];
  }): Promise<Record<string, unknown>> {
    requireText(input.flow_id, "flow_id");
    return await this.store.withFlowLock(input.flow_id, () => this.mineMemoryUnlocked(input));
  }

  private async mineMemoryUnlocked(input: {
    flow_id: string;
    auto_classify?: boolean;
    write_policy?: MemoryWritePolicy;
    v2_destinations?: DexMemoriaV2Destination[];
    v2_density?: "light" | "deep";
    v2_owner_skill?: string;
    v2_tags?: string[];
  }): Promise<Record<string, unknown>> {
    const flow = await this.store.loadFlow(input.flow_id);
    assertFlowAcceptsMutation(flow);
    const writePolicy = input.write_policy ?? "auto_write";
    if (writePolicy !== "auto_write" && writePolicy !== "classify_only") {
      throw new Error(`Invalid write_policy: ${writePolicy}`);
    }
    const autoClassify = input.auto_classify ?? true;
    if (!autoClassify && writePolicy === "auto_write") {
      throw new Error("AUTO_CLASSIFY_DISABLED_AUTO_WRITE: use auto_classify=true for auto_write or switch write_policy to classify_only");
    }
    const v2Writer = this.options.memory_writer?.profile === "v2" ? this.options.memory_writer : undefined;
    const dexMemoriaHome = v2Writer
      ? requireConfiguredV2Root(v2Writer.memory_home, "MEMORY_HOME")
      : resolveDexMemoriaHome();
    if (!autoClassify) {
      return {
        flow_id: flow.flow_id,
        dex_memoria_home: dexMemoriaHome,
        auto_classify: false,
        write_policy: writePolicy,
        classification_skipped: true,
        candidates: [],
        written: [],
        ledger_only: [],
        estacionamento: [],
        discarded: [],
        blocked: [],
        write_decisions: [],
        edit_queue: [],
        destination_warnings: [],
        strong_unwritten_count: 0,
        unclassified: 0,
        blocked_verdict: false
      };
    }
    const workspace = v2Writer
      ? confinedV2Workspace({
        storeWorkspace: this.store.runtimePaths.projectRoot,
        writerWorkspace: v2Writer.workspace_root,
        envelopeWorkspace: flow.goal_binding?.envelope.workspace
      })
      : path.resolve(flow.goal_binding?.envelope.workspace ?? process.cwd());
    const linkNow = nowIso();
    const promotedGold = linkParkingToGold(flow, flow.parking_lot, "memory_mining", flow.flow_id, linkNow);
    flow.gold_mining = unique([...flow.gold_mining, ...promotedGold]);
    const meetings = await this.store.listMeetings(flow.flow_id);
    const nuggets = collectMemoryNuggets(flow, meetings);
    if (this.options.memory_writer?.profile === "v2") {
      return await this.mineMemoryV2({
        flow,
        nuggets,
        writePolicy,
        autoClassify,
        workspace,
        memoryHome: dexMemoriaHome,
        writer: this.options.memory_writer,
        requestClassification: requestedV2MiningClassification(input)
      });
    }
    const resolutionMap = latestTraceableCandidateResolutionMap(flow);
    const rawCandidates = nuggets.map((nugget, index) =>
      classifyMemoryCandidate({
        id: `mc_${index + 1}`,
        item: nugget.item,
        source: nugget.source,
        evidenceScore: nugget.evidenceScore,
        workspace,
        dexMemoriaHome
      })
    );
    const resolvedCandidates = rawCandidates.map((candidate) => applyMemoryCandidateResolution(candidate, resolutionMap.get(candidate.id), workspace, dexMemoriaHome));
    const candidates = writePolicy === "auto_write" ? resolvedCandidates.map((candidate) => governAutoWriteCandidate(candidate, flow.flow_id)) : resolvedCandidates;
    const blocked = candidates.filter((candidate) => candidate.blocked);
    const unresolvedBlocked = blocked.filter((candidate) => !resolutionMap.has(candidate.id));
    const writable = candidates.filter((candidate) => isWritableCandidate(candidate));
    const ledgerOnly = candidates.filter((candidate) => candidate.scope === "ledger_only");
    const estacionamento = candidates.filter((candidate) => candidate.scope === "estacionamento");
    const discarded = candidates.filter((candidate) => candidate.scope === "descartar");
    const written: Array<{ candidate_id: string; files: string[] }> = [];
    const writeFailures: Array<{ candidate_id: string; reason: string }> = [];

    if (writePolicy === "auto_write") {
      const legacyCandidateWriter = this.options.legacy_candidate_writer ?? writeMemoryCandidate;
      for (const candidate of writable) {
        try {
          const files = await legacyCandidateWriter(candidate);
          written.push({ candidate_id: candidate.id, files });
        } catch (error) {
          writeFailures.push({ candidate_id: candidate.id, reason: errorMessage(error) });
        }
      }
    }

    const now = nowIso();
    const writtenIds = new Set(written.map((item) => item.candidate_id));
    const postWriteValidation = await validateMemoryPostWrite({ written, candidates, validatedAt: now });
    const postWriteParkingLot = postWriteValidation.parking_lot;
    if (postWriteParkingLot.length > 0) {
      flow.parking_lot = unique([...flow.parking_lot, ...postWriteParkingLot]);
    }
    if (postWriteValidation.required) {
      const validationEvidence: Evidence = {
        evidence_id: await this.store.nextId("evd"),
        flow_id: flow.flow_id,
        kind: "memory_post_write_validation",
        title: `mm_memory_mining post-write validation: ${postWriteValidation.status}`,
        content: JSON.stringify(
          {
            status: postWriteValidation.status,
            validator: postWriteValidation.validator,
            touched_files: postWriteValidation.touched_files,
            findings: postWriteValidation.findings,
            checked_triggers: postWriteValidation.checked_triggers,
            recall_proof: postWriteValidation.recall_proof
          },
          null,
          2
        ),
        note: "Validacao estrutural pos-write para impedir tratar written_count como memoria consolidada sem L1<->L2/L3 e recall.",
        parking_lot: postWriteParkingLot,
        gold_mining: [],
        cooperators: [{ name: "consciencia-memorias", reason: "validou contrato L1/L2/L3 pos-write de mm_memory_mining", material: true }],
        active_credits: ["consciencia-memorias validou memoria automatica antes do veredito"],
        created_at: now
      };
      postWriteValidation.evidence_id = validationEvidence.evidence_id;
      flow.evidence.push(validationEvidence);
      await this.store.saveEvidence(validationEvidence);
    }
    const postWriteBlocked = memoryPostWriteValidationBlocks(postWriteValidation);
    const strongUnwrittenCandidates =
      writePolicy === "auto_write"
        ? candidates.filter((candidate) => candidate.score.total >= 6 && !writtenIds.has(candidate.id) && !candidate.blocked && candidate.scope !== "estacionamento" && candidate.scope !== "descartar")
        : [];
    const strongUnwritten = strongUnwrittenCandidates.filter((candidate) => !resolutionMap.has(candidate.id));
    const resolvedStrongUnwritten = rawCandidates.filter((candidate) => candidate.score.total >= 6 && resolutionMap.has(candidate.id));
    const resolvedCandidateIds = candidates.filter((candidate) => resolutionMap.has(candidate.id)).map((candidate) => candidate.id);
    const candidateResolutions = resolvedCandidateIds.map((candidateId) => resolutionMap.get(candidateId)).filter((item): item is MemoryCandidateResolution => Boolean(item));
    const writeDecisions = candidates.map((candidate) => memoryWriteDecision(candidate, writePolicy, writtenIds, resolutionMap.get(candidate.id)));
    const editQueue = candidates
      .filter((candidate) => !writtenIds.has(candidate.id) && !resolutionMap.has(candidate.id))
      .map((candidate) => ({
        candidate_id: candidate.id,
        title: candidate.title,
        scope: candidate.scope,
        layer: candidate.layer,
        score: candidate.score,
        suggestion: memoryEditSuggestion(candidate, writePolicy),
        target_files: candidate.target_files
      }));
    const destinationWarnings = [
      ...strongUnwritten.map((candidate) => `${candidate.id}:${candidate.scope}:${memoryNonWriteReason(candidate, writePolicy, writtenIds)}`),
      ...postWriteValidation.findings.map((finding) => `post_write_validation:${finding.code}:${finding.file ?? "unknown"}:${finding.line ?? "unknown"}`),
      ...writeFailures.map((failure) => `write_failed:${failure.candidate_id}:${failure.reason}`)
    ];
    const writeFailuresCount = writeFailures.length;
    const emptyMiningCompleted =
      candidates.length === 0 &&
      written.length === 0 &&
      strongUnwritten.length === 0 &&
      unresolvedBlocked.length === 0 &&
      writeFailuresCount === 0 &&
      !postWriteBlocked;
    const memoryRequiredButEmpty = memoryRequiredByFlow(flow) && candidates.length === 0 && written.length === 0 && !emptyMiningCompleted;
    const postWritePassed = postWriteValidation.status === "passed";
    const memoryReviewStatus = reviewStatusForPostWrite(postWriteValidation, written.length);
    const memoryConsolidated = memoryReviewStatus === "approved" && postWritePassed && writeFailuresCount === 0;
    const summary: MemoryMiningSummary = {
      required: candidates.length > 0 || memoryRequiredByFlow(flow),
      last_run_at: now,
      write_policy: writePolicy,
      blocked_verdict: unresolvedBlocked.length > 0 || memoryRequiredButEmpty || strongUnwritten.length > 0 || postWriteBlocked || writeFailuresCount > 0,
      candidates_count: candidates.length,
      written_count: written.length,
      blocked_count: unresolvedBlocked.length,
      ledger_only_count: ledgerOnly.length,
      discarded_count: discarded.length,
      strong_unwritten_count: strongUnwritten.length,
      resolved_candidate_ids: resolvedCandidateIds,
      resolved_strong_unwritten_count: resolvedStrongUnwritten.length,
      candidate_resolutions: candidateResolutions,
      memory_written: written.length > 0,
      memory_validated: postWritePassed,
      memory_consolidated: memoryConsolidated,
      memory_review_status: memoryReviewStatus,
      memory_post_write_validation: postWriteValidation,
      memory_required_but_empty: memoryRequiredButEmpty,
      candidates: candidates.map((candidate) => memoryCandidateLedgerDataWithResolution(candidate, resolutionMap.get(candidate.id))),
      written,
      write_failures: writeFailures,
      write_failures_count: writeFailuresCount,
      ledger_only: ledgerOnly.map((candidate) => candidate.id),
      estacionamento: estacionamento.map((candidate) => candidate.id),
      discarded: discarded.map((candidate) => candidate.id),
      blocked: unresolvedBlocked.map((candidate) => ({ id: candidate.id, blocked_reason: candidate.blocked_reason })),
      write_decisions: writeDecisions,
      edit_queue: editQueue,
      destination_warnings: destinationWarnings
    };
    flow.memory_mining = summary;
    flow.history.push({
      at: now,
      type: "memory_mined",
      data: {
        write_policy: writePolicy,
        candidates_count: candidates.length,
        written_count: written.length,
        write_failures_count: writeFailuresCount,
        blocked_count: unresolvedBlocked.length,
        resolved_candidate_ids: resolvedCandidateIds,
        memory_written: summary.memory_written,
        memory_validated: summary.memory_validated,
        memory_consolidated: summary.memory_consolidated,
        memory_review_status: summary.memory_review_status,
        post_write_parking_lot: postWriteParkingLot,
        memory_post_write_validation: postWriteValidation
      }
    });
    flow.updated_at = now;
    await this.store.saveFlow(flow);
    await this.ledger(
      flow.flow_id,
      "memory_mined",
      {
        write_policy: writePolicy,
        candidates: candidates.map((candidate) => memoryCandidateLedgerDataWithResolution(candidate, resolutionMap.get(candidate.id))),
        written,
        write_failures: writeFailures,
        write_failures_count: writeFailuresCount,
        ledger_only: ledgerOnly.map((candidate) => candidate.id),
        estacionamento: estacionamento.map((candidate) => candidate.id),
        discarded: discarded.map((candidate) => candidate.id),
        blocked: unresolvedBlocked.map((candidate) => ({ id: candidate.id, blocked_reason: candidate.blocked_reason })),
        write_decisions: writeDecisions,
        edit_queue: editQueue,
        destination_warnings: destinationWarnings,
        strong_unwritten_count: strongUnwritten.length,
        resolved_candidate_ids: resolvedCandidateIds,
        resolved_strong_unwritten_count: resolvedStrongUnwritten.length,
        candidate_resolutions: candidateResolutions,
        memory_written: summary.memory_written,
        memory_validated: summary.memory_validated,
        memory_consolidated: summary.memory_consolidated,
        memory_review_status: summary.memory_review_status,
        post_write_parking_lot: postWriteParkingLot,
        memory_post_write_validation: postWriteValidation,
        blocked_verdict: summary.blocked_verdict,
        memory_required_but_empty: summary.memory_required_but_empty
      },
      "dex-code"
    );

    return {
      flow_id: flow.flow_id,
      dex_memoria_home: dexMemoriaHome,
      auto_classify: autoClassify,
      write_policy: writePolicy,
      candidates,
      written,
      write_failures: writeFailures,
      write_failures_count: writeFailuresCount,
      ledger_only: ledgerOnly,
      estacionamento,
      discarded,
      blocked: unresolvedBlocked,
      write_decisions: writeDecisions,
      edit_queue: editQueue,
      destination_warnings: destinationWarnings,
      strong_unwritten_count: strongUnwritten.length,
      resolved_candidate_ids: resolvedCandidateIds,
      resolved_strong_unwritten_count: resolvedStrongUnwritten.length,
      candidate_resolutions: candidateResolutions,
      memory_written: summary.memory_written,
      memory_validated: summary.memory_validated,
      memory_consolidated: summary.memory_consolidated,
      memory_review_status: summary.memory_review_status,
      memory_post_write_validation: postWriteValidation,
      unclassified: unresolvedBlocked.length,
      blocked_verdict: summary.blocked_verdict,
      memory_required_but_empty: summary.memory_required_but_empty
    };
  }

  private async mineMemoryV2(input: {
    flow: Flow;
    nuggets: Array<{
      item: string;
      source: "gold_mining" | "parking_lot";
      evidenceScore: number;
      provenance?: Array<Record<string, unknown>>;
    }>;
    writePolicy: MemoryWritePolicy;
    autoClassify: boolean;
    workspace: string;
    memoryHome: string;
    writer: DexMemoriaV2FlowWriterConfig;
    requestClassification?: DexMemoriaV2MiningClassification;
  }): Promise<Record<string, unknown>> {
    const now = nowIso();
    const previous = input.flow.memory_mining as MemoryMiningV2Summary | undefined;
    const previousReceipts = previous?.memory_profile === "v2" ? previous.v2_receipts ?? [] : [];
    const candidates = [] as Array<Record<string, unknown>>;
    const receipts: DexMemoriaV2CanonicalReceipt[] = [];
    const validationReceipts: DexMemoriaV2ValidationReceiptRef[] = [];
    const writtenByCandidate = new Map<string, Set<string>>();
    const pendingDestinations: Array<Record<string, unknown>> = [];
    const v2Failures: Array<Record<string, unknown>> = [];
    let v2Status: MemoryMiningV2Summary["v2_status"] = input.writePolicy === "auto_write" ? "complete" : "classify_only";
    let unclassifiedCount = 0;
    let strongUnclassifiedCount = 0;
    const resolutionMap = latestTraceableCandidateResolutionMap(input.flow);
    const resolvedCandidateIds: string[] = [];
    const candidateResolutions: MemoryCandidateResolution[] = [];
    const ledgerOnly: string[] = [];
    const estacionamento: string[] = [];
    const discarded: string[] = [];
    const pendingPromotions: string[] = [];

    for (const [index, nugget] of input.nuggets.entries()) {
      assertNoSecretLikeText(nugget.item, `memory_v2_candidate_${index + 1}`);
      const candidateId = memoryV2CandidateId(nugget.item);
      const resolution = resolutionMap.get(candidateId);
      const classifierInput = {
        flow_id: input.flow.flow_id,
        candidate_id: candidateId,
        item: nugget.item,
        source: nugget.source,
        evidence_score: nugget.evidenceScore
      };
      if (resolution && resolution.action !== "promote") {
        resolvedCandidateIds.push(candidateId);
        candidateResolutions.push(resolution);
        if (resolution.action === "accept_ledger_only") ledgerOnly.push(candidateId);
        if (resolution.action === "park") estacionamento.push(candidateId);
        if (resolution.action === "discard") discarded.push(candidateId);
        candidates.push({
          candidate_id: candidateId,
          operation_id: `mmv2_resolved_${candidateId}`,
          flow_id: input.flow.flow_id,
          slug: memoryV2Slug(nugget.item, candidateId),
          item: nugget.item,
          source: nugget.source,
          ...(nugget.provenance?.length ? { provenance: nugget.provenance } : {}),
          classification_status: "resolved",
          destinations: [],
          route: null,
          resolution: candidateResolutionLedgerData(resolution),
          effective_action: resolution.action
        });
        continue;
      }
      const directive = resolution?.action === "promote"
        ? v2PromotionClassification(resolution)
        : input.requestClassification
          ?? input.writer.classify?.(classifierInput)
          ?? input.writer.default_classification
          ?? classifyDexMemoriaV2MiningCandidate(classifierInput);
      if (directive.status === "unresolved") {
        unclassifiedCount += 1;
        if (nugget.evidenceScore >= 1) strongUnclassifiedCount += 1;
        candidates.push({
          candidate_id: candidateId,
          operation_id: `mmv2_pending_${candidateId}`,
          flow_id: input.flow.flow_id,
          slug: memoryV2Slug(nugget.item, candidateId),
          item: nugget.item,
          source: nugget.source,
          ...(nugget.provenance?.length ? { provenance: nugget.provenance } : {}),
          classification_status: "unresolved",
          classification_reason: directive.reason,
          destinations: [],
          route: null
        });
        if (input.writePolicy === "auto_write") v2Status = "classification_required";
        continue;
      }
      const classification = classifyDexMemoriaV2Intent({
        item: nugget.item,
        density: directive.density,
        requested_destinations: directive.requested_destinations,
        owner_skill: directive.owner_skill,
        tags: directive.tags
      });
      const operationId = memoryV2OperationId(nugget.item, classification);
      const slug = memoryV2Slug(nugget.item, candidateId);
      if (resolution) {
        resolvedCandidateIds.push(candidateId);
        candidateResolutions.push(resolution);
      }
      candidates.push({
        candidate_id: candidateId,
        operation_id: operationId,
        flow_id: input.flow.flow_id,
        slug,
        item: nugget.item,
        source: nugget.source,
        ...(nugget.provenance?.length ? { provenance: nugget.provenance } : {}),
        destinations: classification.destinations,
        route: classification.route,
        tags: classification.tags,
        density: classification.route.target === "L3" ? "deep" : "light",
        ...(classification.route.target === "L3" ? { owner_skill: classification.route.owner_skill } : {}),
        ...(resolution ? { resolution: candidateResolutionLedgerData(resolution), effective_action: resolution.action } : {})
      });
      if (input.writePolicy !== "auto_write") {
        if (resolution?.action === "promote") pendingPromotions.push(candidateId);
        continue;
      }
      const adapterResult = await executeDexMemoriaV2Adapter({
        operation_id: operationId,
        slug,
        workspace_root: input.workspace,
        memory_home: input.memoryHome,
        classification,
        executor: input.writer.executor,
        resume_receipts: previousReceipts.filter((receipt) => receipt.operation_id === operationId)
      });
      receipts.push(...adapterResult.receipts);
      validationReceipts.push(...adapterResult.validation_receipts);
      const validatedFiles = adapterResult.validation_receipts.flatMap((validationReceipt) => validationReceipt.files);
      if (validatedFiles.length > 0) {
        const candidateFiles = writtenByCandidate.get(candidateId) ?? new Set<string>();
        for (const file of validatedFiles) candidateFiles.add(file);
        writtenByCandidate.set(candidateId, candidateFiles);
      }
      pendingDestinations.push(...adapterResult.pending_destinations);
      if (adapterResult.status !== "complete") {
        v2Status = adapterResult.status;
        if (adapterResult.failure) {
          v2Failures.push(adapterResult.failure);
        }
      }
    }

    const blockedVerdict = unclassifiedCount > 0
      || pendingPromotions.length > 0
      || v2Status === "classification_required"
      || v2Status === "partial_pending"
      || v2Status === "resume_pending_sibling";
    const strongUnwrittenCount = strongUnclassifiedCount + pendingPromotions.length;
    const blockedCandidateCount = unclassifiedCount + pendingPromotions.length
      + (v2Status === "partial_pending" || v2Status === "resume_pending_sibling" ? 1 : 0);
    const committedRouteCount = validationReceipts.length;
    const written = Array.from(writtenByCandidate, ([candidate_id, files]) => ({ candidate_id, files: Array.from(files) }));
    const reconciliationId = memoryV2ReconciliationId({
      flowId: input.flow.flow_id,
      writePolicy: input.writePolicy,
      candidates,
      receipts,
      candidateResolutions
    });
    const hasCommittedEffect = v2ReceiptsProveCommittedEffect(receipts);
    const summary: MemoryMiningV2Summary = {
      required: candidates.length > 0 || memoryRequiredByFlow(input.flow),
      last_run_at: now,
      write_policy: input.writePolicy,
      blocked_verdict: blockedVerdict,
      candidates_count: candidates.length,
      written_count: written.length,
      blocked_count: blockedCandidateCount,
      ledger_only_count: ledgerOnly.length,
      discarded_count: discarded.length,
      estacionamento_count: estacionamento.length,
      resolved_candidate_ids: resolvedCandidateIds,
      resolved_strong_unwritten_count: resolvedCandidateIds.length,
      candidate_resolutions: candidateResolutions,
      strong_unwritten_count: strongUnwrittenCount,
      memory_required_but_empty: false,
      memory_written: committedRouteCount > 0,
      memory_validated: committedRouteCount > 0
        && !blockedVerdict,
      memory_consolidated: false,
      memory_review_status: "not_required",
      candidates,
      written,
      ledger_only: ledgerOnly,
      estacionamento,
      discarded,
      write_decisions: candidates.map((candidate) => ({
        candidate_id: memoryCandidateIdentity(candidate),
        action: candidate.effective_action ? `resolved_${candidate.effective_action}` : writtenByCandidate.has(memoryCandidateIdentity(candidate)) ? "written" : "classified",
        editable: !candidate.effective_action && !writtenByCandidate.has(memoryCandidateIdentity(candidate))
      })),
      memory_profile: "v2",
      v2_status: v2Status,
      v2_ledger_status: hasCommittedEffect ? "pending" : "confirmed",
      v2_reconciliation_id: reconciliationId,
      v2_receipts: receipts,
      v2_validation_receipts: validationReceipts,
      v2_pending_destinations: pendingDestinations,
      v2_failures: v2Failures
    };
    const finalBlockedVerdict = summary.blocked_verdict;
    const finalBlockedCount = summary.blocked_count;
    const finalMemoryValidated = summary.memory_validated;
    if (hasCommittedEffect) {
      summary.blocked_verdict = true;
      summary.blocked_count = Math.max(1, summary.blocked_count);
      summary.memory_validated = false;
    }
    input.flow.memory_mining = summary;
    const existingHistoryEvent = input.flow.history.find((event) =>
      event.type === "memory_mined" && event.data.v2_reconciliation_id === reconciliationId
    );
    const historyData = {
      write_policy: input.writePolicy,
      memory_profile: "v2",
      v2_status: summary.v2_status,
      v2_ledger_status: summary.v2_ledger_status,
      v2_reconciliation_id: reconciliationId,
      candidates_count: candidates.length,
      receipts_count: receipts.length,
      blocked_verdict: summary.blocked_verdict
    };
    if (existingHistoryEvent) {
      existingHistoryEvent.at = now;
      existingHistoryEvent.data = historyData;
    } else {
      input.flow.history.push({ at: now, type: "memory_mined", data: historyData });
    }
    input.flow.updated_at = now;
    let initialPersistenceError: unknown;
    if (hasCommittedEffect) {
      const persisted = await this.saveV2CommittedFlowState(input.flow);
      if (!persisted.saved) {
        throw v2CommittedBoundaryError(persisted.error);
      }
      initialPersistenceError = persisted.error;
    } else {
      await this.store.saveFlow(input.flow);
    }
    const ledgerData = {
      write_policy: input.writePolicy,
      memory_profile: "v2",
      v2_status: v2Status,
      v2_reconciliation_id: reconciliationId,
      candidates,
      written,
      ledger_only: ledgerOnly,
      estacionamento,
      discarded,
      resolved_candidate_ids: resolvedCandidateIds,
      candidate_resolutions: candidateResolutions,
      v2_receipts: receipts,
      v2_validation_receipts: validationReceipts,
      v2_pending_destinations: pendingDestinations,
      v2_failures: v2Failures,
      blocked_verdict: blockedVerdict
    };
    const ledgerResult = initialPersistenceError
      ? { confirmed: false, error: initialPersistenceError }
      : await this.ensureV2MemoryMinedLedger(input.flow.flow_id, reconciliationId, ledgerData);
    if (!ledgerResult.confirmed) {
      if (!hasCommittedEffect) throw ledgerResult.error;
      summary.v2_status = "partial_pending";
      summary.v2_ledger_status = "pending";
      summary.blocked_verdict = true;
      summary.blocked_count = Math.max(1, summary.blocked_count);
      summary.memory_validated = false;
      summary.v2_failures.push({
        stage: "memory_mined_ledger",
        message: errorMessage(ledgerResult.error),
        reconciliation_id: reconciliationId
      });
      const pendingHistoryEvent = input.flow.history.find((event) =>
        event.type === "memory_mined" && event.data.v2_reconciliation_id === reconciliationId
      );
      if (pendingHistoryEvent) {
        pendingHistoryEvent.data.v2_status = summary.v2_status;
        pendingHistoryEvent.data.v2_ledger_status = summary.v2_ledger_status;
        pendingHistoryEvent.data.blocked_verdict = true;
      }
      input.flow.updated_at = nowIso();
      try {
        await this.store.saveFlow(input.flow);
      } catch {
        // O estado pending com receipts ja foi persistido antes da tentativa de
        // ledger. Falhar ao enriquecer o diagnostico nao autoriza rollback.
      }
    } else if (hasCommittedEffect) {
      summary.v2_ledger_status = "confirmed";
      summary.blocked_verdict = finalBlockedVerdict;
      summary.blocked_count = finalBlockedCount;
      summary.memory_validated = finalMemoryValidated;
      const confirmedHistoryEvent = input.flow.history.find((event) =>
        event.type === "memory_mined" && event.data.v2_reconciliation_id === reconciliationId
      );
      if (confirmedHistoryEvent) {
        confirmedHistoryEvent.data.v2_ledger_status = "confirmed";
        confirmedHistoryEvent.data.blocked_verdict = finalBlockedVerdict;
      }
      input.flow.updated_at = nowIso();
      const confirmedPersistence = await this.saveV2CommittedFlowState(input.flow);
      if (!confirmedPersistence.saved) {
        summary.v2_status = "partial_pending";
        summary.v2_ledger_status = "pending";
        summary.blocked_verdict = true;
        summary.blocked_count = Math.max(1, summary.blocked_count);
        summary.memory_validated = false;
        summary.v2_failures.push({
          stage: "memory_mined_flow_confirmation",
          message: errorMessage(confirmedPersistence.error),
          reconciliation_id: reconciliationId
        });
        if (confirmedHistoryEvent) {
          confirmedHistoryEvent.data.v2_status = summary.v2_status;
          confirmedHistoryEvent.data.v2_ledger_status = "pending";
          confirmedHistoryEvent.data.blocked_verdict = true;
        }
      }
    }

    return {
      flow_id: input.flow.flow_id,
      auto_classify: input.autoClassify,
      write_policy: input.writePolicy,
      memory_profile: "v2",
      v2_status: summary.v2_status,
      v2_ledger_status: summary.v2_ledger_status,
      v2_reconciliation_id: reconciliationId,
      candidates,
      written,
      ledger_only: ledgerOnly,
      estacionamento,
      discarded,
      ledger_only_count: ledgerOnly.length,
      estacionamento_count: estacionamento.length,
      discarded_count: discarded.length,
      resolved_candidate_ids: resolvedCandidateIds,
      resolved_strong_unwritten_count: resolvedCandidateIds.length,
      candidate_resolutions: candidateResolutions,
      strong_unwritten_count: strongUnwrittenCount,
      v2_receipts: receipts,
      v2_validation_receipts: validationReceipts,
      v2_pending_destinations: pendingDestinations,
      v2_failures: v2Failures,
      memory_written: summary.memory_written,
      memory_validated: summary.memory_validated,
      memory_consolidated: summary.memory_consolidated,
      memory_review_status: summary.memory_review_status,
      blocked_verdict: summary.blocked_verdict,
      blocked_count: summary.blocked_count,
      memory_required_but_empty: false,
      written_count: written.length,
      unclassified: unclassifiedCount
    };
  }

  async resolveMemoryCandidates(input: ResolveMemoryCandidatesInput): Promise<Record<string, unknown>> {
    requireText(input.flow_id, "flow_id");
    return await this.store.withFlowLock(input.flow_id, () => this.resolveMemoryCandidatesUnlocked(input));
  }

  private async resolveMemoryCandidatesUnlocked(input: ResolveMemoryCandidatesInput): Promise<Record<string, unknown>> {
    const candidateIds = unique((input.candidate_ids ?? []).map((candidateId) => candidateId.trim()).filter(Boolean));
    if (candidateIds.length === 0) {
      throw new Error("candidate_ids must contain at least one memory candidate id");
    }
    const actions: MemoryCandidateResolutionAction[] = ["promote", "park", "discard", "accept_ledger_only"];
    if (!actions.includes(input.action)) {
      throw new Error(`Invalid memory candidate resolution action: ${input.action}`);
    }
    requireText(input.rationale, "rationale");
    assertNoSecretLikeText(input.rationale, "rationale");
    if (input.when) {
      assertNoSecretLikeText(input.when, "when");
    }
    if (input.theme) {
      assertNoSecretLikeText(input.theme, "theme");
    }
    if (input.owner_skill) {
      assertNoSecretLikeText(input.owner_skill, "owner_skill");
    }
    for (const tag of input.tags ?? []) {
      requireText(tag, "tags");
      if (!MEMORY_V2_TAG_PATTERN.test(tag)) {
        throw new Error(`MEMORY_CANDIDATE_PROMOTION_TAG_INVALID: ${tag}`);
      }
    }
    if (input.action === "park") {
      requireText(input.when, "when");
    }
    const hasPromotionOnlyInput = input.target_scope !== undefined
      || input.theme !== undefined
      || input.density !== undefined
      || input.owner_skill !== undefined
      || input.tags !== undefined;
    if (input.action !== "promote" && hasPromotionOnlyInput) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_FIELDS_NOT_ALLOWED: promotion fields require action=promote");
    }
    if (input.action === "promote") {
      const scope = input.target_scope ?? "projeto";
      if (!isPromotionScope(scope)) {
        throw new Error(`Invalid target_scope for promote: ${scope}`);
      }
      if (scope === "tema") {
        requireText(input.theme, "theme");
      } else if (input.theme !== undefined) {
        throw new Error("MEMORY_CANDIDATE_PROMOTION_THEME_NOT_ALLOWED: theme requires target_scope=tema");
      }
      if (input.density === "light" && input.owner_skill !== undefined) {
        throw new Error("MEMORY_CANDIDATE_PROMOTION_OWNER_NOT_ALLOWED: owner_skill requires density=deep");
      }
    }

    const flow = await this.store.loadFlow(input.flow_id);
    assertFlowAcceptsMutation(flow);
    const originalFlow = structuredClone(flow);
    const currentCandidates = Array.isArray(flow.memory_mining?.candidates) ? flow.memory_mining.candidates : [];
    if (currentCandidates.length === 0) {
      throw new Error("MEMORY_CANDIDATES_NOT_MINED: execute mm_memory_mining antes de resolver memory_candidates");
    }
    const candidateLookup = memoryCandidateLookup(currentCandidates);
    const missing = candidateIds.filter((candidateId) => !candidateLookup.has(candidateId));
    if (missing.length > 0) {
      throw new Error(`Unknown memory candidate ids: ${missing.join(", ")}`);
    }

    const now = nowIso();
    const existingResolutions = flow.memory_candidate_resolutions ?? [];
    const resolutions: V2MemoryCandidateResolution[] = candidateIds.map((candidateId) => {
      const candidate = candidateLookup.get(candidateId) ?? {};
      if (input.action === "promote"
        && !hasV2CandidateIdentity(candidate)
        && (input.density !== undefined || input.owner_skill !== undefined || input.tags !== undefined)) {
        throw new Error("MEMORY_CANDIDATE_PROMOTION_FIELDS_NOT_ALLOWED: V2 promotion metadata cannot be applied to a legacy candidate");
      }
      if (input.action === "promote"
        && hasV2CandidateIdentity(candidate)
        && candidate.classification_status === "unresolved"
        && input.target_scope === undefined) {
        throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: unresolved V2 promotion requires explicit target_scope, tags, density and owner_skill for L3");
      }
      const promotionMetadata = input.action === "promote" && hasV2CandidateIdentity(candidate)
        ? requireV2PromotionMetadata(candidate, {
            density: input.density,
            owner_skill: input.owner_skill,
            tags: input.tags
          })
        : undefined;
      const classifiedV2Candidate = input.action === "promote"
        && hasV2CandidateIdentity(candidate)
        && candidate.classification_status !== "unresolved";
      const promotionDestinations = promotionMetadata
        ? classifiedV2Candidate
          ? requireV2CandidateDestinations(candidate)
          : [promotionDestination(input.target_scope!, input.theme)]
        : undefined;
      if (classifiedV2Candidate && input.target_scope !== undefined) {
        const requestedDestination = promotionDestination(input.target_scope, input.theme);
        if (promotionDestinations!.length !== 1
          || JSON.stringify(promotionDestinations![0]) !== JSON.stringify(requestedDestination)) {
          throw new Error("MEMORY_CANDIDATE_PROMOTION_DESTINATION_CONFLICT: explicit destination differs from the classified V2 candidate");
        }
      }
      const effectivePromotionScope = input.action === "promote"
        ? promotionDestinations
          ? promotionScopeForDestinations(promotionDestinations)
          : input.target_scope ?? "projeto"
        : undefined;
      const effectivePromotionTheme = input.action === "promote"
        ? promotionThemeForDestinations(promotionDestinations) ?? input.theme?.trim()
        : undefined;
      const resolutionFingerprint = createHash("sha256").update(JSON.stringify({
        candidate_id: candidateId,
        action: input.action,
        rationale: input.rationale.trim(),
        when: input.when?.trim() ?? null,
        target_scope: effectivePromotionScope ?? null,
        theme: effectivePromotionTheme ?? null,
        candidate_tags: promotionMetadata ? [...promotionMetadata.tags].sort() : null,
        candidate_density: promotionMetadata?.density ?? null,
        candidate_destinations: promotionDestinations ?? null,
        candidate_theme: promotionMetadata?.theme ?? null,
        candidate_owner_skill: promotionMetadata?.owner_skill ?? null
      }), "utf8").digest("hex").slice(0, 24);
      const proposed: V2MemoryCandidateResolution = {
        resolution_id: `mcr_${now.replace(/[-:.TZ]/g, "")}_${resolutionFingerprint}`,
        candidate_id: candidateId,
        action: input.action,
        rationale: input.rationale.trim(),
        ...(input.when ? { when: input.when.trim() } : {}),
        ...(effectivePromotionScope ? { target_scope: effectivePromotionScope } : {}),
        ...(effectivePromotionTheme ? { theme: effectivePromotionTheme } : {}),
        candidate_title: typeof candidate.title === "string" ? candidate.title : undefined,
        candidate_scope: isMemoryCandidateScope(candidate.scope) ? candidate.scope : undefined,
        candidate_score: candidateScoreTotal(candidate),
        ...(promotionMetadata ? {
          candidate_tags: [...promotionMetadata.tags].sort(),
          candidate_density: promotionMetadata.density,
          candidate_destinations: promotionDestinations,
          ...(promotionMetadata.theme ? { candidate_theme: promotionMetadata.theme } : {}),
          ...(promotionMetadata.owner_skill ? { candidate_owner_skill: promotionMetadata.owner_skill } : {})
        } : {}),
        traceable: true,
        created_at: now,
        source: "mm_memory_candidate_resolve"
      };
      return existingResolutions.find((resolution) => sameCandidateResolution(resolution, proposed)) as V2MemoryCandidateResolution | undefined
        ?? proposed;
    });

    const existingResolutionIds = new Set(existingResolutions.map((resolution) => resolution.resolution_id));
    const newResolutions = resolutions.filter((resolution) => !existingResolutionIds.has(resolution.resolution_id));
    const previousWritePolicy = flow.memory_mining?.write_policy === "classify_only" ? "classify_only" : "auto_write";
    let memoryMining: Record<string, unknown>;
    try {
      if (newResolutions.length > 0) {
        const effectiveTargetScopes = unique(resolutions
          .map((resolution) => resolution.target_scope)
          .filter((scope): scope is MemoryCandidatePromoteScope => scope !== undefined));
        flow.memory_candidate_resolutions = [...existingResolutions, ...newResolutions];
        flow.history.push({
          at: now,
          type: "memory_candidates_resolved",
          data: {
            candidate_ids: candidateIds,
            action: input.action,
            rationale: input.rationale.trim(),
            when: input.when?.trim() ?? null,
            target_scope: input.action === "promote" && effectiveTargetScopes.length === 1
              ? effectiveTargetScopes[0]
              : null,
            candidate_destinations: input.action === "promote"
              ? resolutions.map((resolution) => ({
                  candidate_id: resolution.candidate_id,
                  destinations: (resolution as V2MemoryCandidateResolution).candidate_destinations
                    ?? [promotionDestination(resolution.target_scope ?? "projeto", resolution.theme)]
                }))
              : []
          }
        });
        flow.updated_at = now;
        await this.store.saveFlow(flow);
      }
      memoryMining = await this.mineMemoryUnlocked({ flow_id: flow.flow_id, auto_classify: true, write_policy: previousWritePolicy });
    } catch (error) {
      if (newResolutions.length > 0 && !isV2CommittedBoundaryError(error)) {
        await this.store.saveFlow(originalFlow);
      }
      throw error;
    }
    await this.ensureMemoryCandidateResolutionLedger(flow.flow_id, resolutions);

    const writtenIds = new Set(
      (Array.isArray(memoryMining.written) ? memoryMining.written : [])
        .map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).candidate_id === "string"
          ? (item as Record<string, unknown>).candidate_id as string
          : "")
        .filter(Boolean)
    );
    const v2LedgerPending = memoryMining.v2_ledger_status === "pending";
    const pendingResolutions = resolutions.filter((resolution) =>
      v2LedgerPending || (resolution.action === "promote" && !writtenIds.has(resolution.candidate_id))
    );
    const pendingResolutionIds = new Set(pendingResolutions.map((resolution) => resolution.resolution_id));
    const appliedResolutions = resolutions.filter((resolution) => !pendingResolutionIds.has(resolution.resolution_id));
    return {
      flow_id: flow.flow_id,
      resolved: resolutions,
      application_status: pendingResolutions.length > 0 ? "pending" : "applied",
      applied_resolutions: appliedResolutions,
      pending_resolutions: pendingResolutions,
      memory_mining: memoryMining,
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow) })
    };
  }

  private async ensureMemoryCandidateResolutionLedger(
    flowId: string,
    resolutions: V2MemoryCandidateResolution[]
  ): Promise<void> {
    const missingResolutions = async (): Promise<V2MemoryCandidateResolution[]> => {
      const ledgerEvents = await this.store.readLedger(flowId);
      const recordedResolutionIds = new Set(
        ledgerEvents
          .filter((event) => event.type === "memory_candidates_resolved")
          .flatMap((event) => Array.isArray(event.data.resolutions) ? event.data.resolutions : [])
          .map((resolution) =>
            resolution && typeof resolution === "object" && typeof (resolution as Record<string, unknown>).resolution_id === "string"
              ? (resolution as Record<string, unknown>).resolution_id as string
              : ""
          )
          .filter(Boolean)
      );
      return resolutions.filter((resolution) => !recordedResolutionIds.has(resolution.resolution_id));
    };

    const missing = await missingResolutions();
    if (missing.length === 0) return;
    try {
      await this.ledger(flowId, "memory_candidates_resolved", { resolutions: missing }, "dex-code");
    } catch (error) {
      if ((await missingResolutions()).length > 0) throw error;
    }
  }

  private async ensureV2MemoryMinedLedger(
    flowId: string,
    reconciliationId: string,
    data: Record<string, unknown>
  ): Promise<{ confirmed: boolean; error?: unknown }> {
    const ledgerContainsAttempt = async (): Promise<boolean> =>
      (await this.store.readLedger(flowId)).some((event) =>
        event.type === "memory_mined" && event.data.v2_reconciliation_id === reconciliationId
      );

    try {
      if (await ledgerContainsAttempt()) return { confirmed: true };
    } catch (error) {
      return { confirmed: false, error };
    }
    try {
      await this.ledger(flowId, "memory_mined", data, "dex-code");
      return { confirmed: true };
    } catch (error) {
      try {
        if (await ledgerContainsAttempt()) return { confirmed: true };
        return { confirmed: false, error };
      } catch (readError) {
        return { confirmed: false, error: readError };
      }
    }
  }

  private async saveV2CommittedFlowState(flow: Flow): Promise<{ saved: boolean; error?: unknown }> {
    try {
      await this.store.saveFlow(flow);
      return { saved: true };
    } catch (error) {
      try {
        await this.store.saveFlow(flow);
        return { saved: true, error };
      } catch (retryError) {
        return { saved: false, error: retryError };
      }
    }
  }

  async goalRegress(input: {
    flow_id?: string;
    idempotency_key?: string;
    to?: AnyPhase;
    reason: string;
    meeting_id?: string;
    evidence_ids?: string[];
    actor?: string;
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    return this.store.withFlowLock(flow.flow_id, () => this.goalRegressUnlocked(input));
  }

  private async goalRegressUnlocked(input: {
    flow_id?: string;
    idempotency_key?: string;
    to?: AnyPhase;
    reason: string;
    meeting_id?: string;
    evidence_ids?: string[];
    actor?: string;
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    assertGoalBinding(flow);
    assertNoSecretLikePayload(input, "goal_regress");
    if (input.meeting_id) {
      const meeting = await this.store.loadMeeting(input.meeting_id);
      if (meeting.flow_id !== flow.flow_id) {
        throw new Error(`meeting_id ${input.meeting_id} does not belong to GOAL flow ${flow.flow_id}`);
      }
      assertMeetingClosed(meeting);
    }
    const to = input.to ?? fiscalBackTo(flow);
    const returned = await this.returnToUnlocked({
      flow_id: flow.flow_id,
      to,
      reason: input.reason,
      evidence_ids: input.evidence_ids,
      actor: input.actor ?? "goal_regress"
    });
    const updated = await this.store.loadFlow(flow.flow_id);
    const regressCount = countRegressions(updated);
    updated.history.push({
      at: nowIso(),
      type: "goal_regressed",
      data: {
        to,
        reason: input.reason,
        meeting_id: input.meeting_id,
        evidence_ids: input.evidence_ids ?? [],
        regress_count: regressCount,
        max_regressions: FISCAL_CONFIG.maxRegressions
      }
    });
    updated.updated_at = nowIso();
    await this.store.saveFlow(updated);
    await this.ledger(updated.flow_id, "goal_regressed", {
      to,
      reason: input.reason,
      meeting_id: input.meeting_id,
      evidence_ids: input.evidence_ids ?? [],
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions
    }, input.actor ?? "goal_regress");
    return {
      ...returned,
      regressed: true,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id, detail: mutationStatusDetail(flow) })
    };
  }

  async addGoalEvidence(input: {
    flow_id: string;
    kind?: string;
    title: string;
    uri?: string;
    content?: string;
    note?: string;
    satisfies?: string[];
    observed_result?: Record<string, unknown>;
    criterion_proof?: CriterionProofInput;
    scope_classification?: "target" | "declared_dependency" | "outside";
    scope_reference?: string;
    reviewed_implementation_fingerprint?: string;
    detail?: "lean" | "compact" | "full";
  }): Promise<Record<string, unknown>> {
    requireText(input.flow_id, "flow_id");
    assertNoSecretLikeText(input.title, "title");
    assertNoSecretLikeText(input.uri, "uri");
    assertNoSecretLikeText(input.content, "content");
    assertNoSecretLikeText(input.note, "note");
    assertNoSecretLikeText(input.scope_reference, "scope_reference");
    assertNoSecretLikePayload(input.observed_result, "observed_result");
    assertNoSecretLikePayload(input.criterion_proof, "criterion_proof");
    const flow = await this.store.loadFlow(input.flow_id);
    const beforeSnapshot = this.resolveGateSnapshot(
      flow,
      flow.phase,
      (flow.gates[flow.phase]?.provided ?? {}) as Record<string, unknown>
    );
    const evidence = await this.attachEvidence({
      flow_id: input.flow_id,
      kind: input.kind ?? "goal_evidence",
      title: input.title,
      uri: input.uri,
      content: input.content,
      note: mergeEvidenceNotes(input.note, goalEvidenceMetadataNote(flow, input)),
      satisfies: input.satisfies,
      observed_result: input.observed_result,
      criterion_proof: input.criterion_proof,
      scope_classification: input.scope_classification,
      scope_reference: input.scope_reference,
      reviewed_implementation_fingerprint: input.reviewed_implementation_fingerprint,
      gold_mining: input.satisfies?.map((item) => `evidence_required:${item}`) ?? []
    });
    const reviewDiagnostics = reviewEvidenceRequested(input) ? reviewEvidenceDiagnostics(flow, evidence) : null;
    if (input.detail === "compact") {
      const fresh = await this.store.loadFlow(input.flow_id);
      const meetings = await this.store.listMeetings(fresh.flow_id);
      return {
        ...this.compactMutationReceipt(fresh, meetings, {
        action: "evidence_add",
        evidence_id: evidence.evidence_id,
        before_missing: beforeSnapshot.missing
        }),
        ...(reviewDiagnostics ? { review_evidence_diagnostics: reviewDiagnostics } : {})
      };
    }
    return {
      evidence_id: evidence.evidence_id,
      evidence,
      ...(reviewDiagnostics ? { review_evidence_diagnostics: reviewDiagnostics } : {}),
      status: await this.goalStatus({ flow_id: input.flow_id, detail: mutationStatusDetail(flow, input.detail) })
    };
  }

  async goalVerdict(input: {
    flow_id: string;
    status: VerdictStatus;
    rationale: string;
    evidence_ids?: string[];
    residual_risks?: string[];
    review_artifact_path?: string;
    review_findings?: string[];
    verdict_parking_lot?: string[];
    verdict_gold_mining?: string[];
    attempt_count?: number;
    regress_count?: number;
    meeting_id?: string;
    meeting_ids?: string[];
    next_step: string;
  }): Promise<Record<string, unknown>> {
    requireText(input.flow_id, "flow_id");
    assertNoSecretLikeText(input.rationale, "rationale");
    assertNoSecretLikeText(input.next_step, "next_step");
    for (const risk of input.residual_risks ?? []) {
      assertNoSecretLikeText(risk, "residual_risks");
    }
    assertNoSecretLikeText(input.review_artifact_path, "review_artifact_path");
    for (const finding of input.review_findings ?? []) {
      assertNoSecretLikeText(finding, "review_findings");
    }
    for (const item of input.verdict_parking_lot ?? []) {
      assertNoSecretLikeText(item, "verdict_parking_lot");
    }
    for (const item of input.verdict_gold_mining ?? []) {
      assertNoSecretLikeText(item, "verdict_gold_mining");
    }
    return this.store.withFlowLock(input.flow_id, () => this.goalVerdictUnlocked(input));
  }

  private async goalVerdictUnlocked(input: {
    flow_id: string;
    status: VerdictStatus;
    rationale: string;
    evidence_ids?: string[];
    residual_risks?: string[];
    review_artifact_path?: string;
    review_findings?: string[];
    verdict_parking_lot?: string[];
    verdict_gold_mining?: string[];
    attempt_count?: number;
    regress_count?: number;
    meeting_id?: string;
    meeting_ids?: string[];
    next_step: string;
  }): Promise<Record<string, unknown>> {
    let flow = await this.store.loadFlow(input.flow_id);
    assertGoalBinding(flow);
    assertFlowAcceptsMutation(flow);
    if (typeof input.regress_count === "number" && input.regress_count > countRegressions(flow)) {
      const now = nowIso();
      flow.history.push({
        at: now,
        type: "regress_count_reported",
        data: { regress_count: input.regress_count, source: "goal_verdict" }
      });
      flow.updated_at = now;
      await this.store.saveFlow(flow);
      await this.ledger(flow.flow_id, "regress_count_reported", { regress_count: input.regress_count, source: "goal_verdict" }, "goal_verdict");
      flow = await this.store.loadFlow(input.flow_id);
    }
    const meetingIds = unique([input.meeting_id, ...(input.meeting_ids ?? [])].filter(Boolean) as string[]);
    for (const meetingId of meetingIds) {
      const meeting = await this.store.loadMeeting(meetingId);
      if (meeting.flow_id !== flow.flow_id) {
        throw new Error(`meeting_id ${meetingId} does not belong to GOAL flow ${flow.flow_id}`);
      }
      assertMeetingClosed(meeting);
    }
    const evidenceIds = input.evidence_ids ?? [];
    const existingEvidenceIds = new Set(flow.evidence.map((evidence) => evidence.evidence_id));
    const missingEvidence = evidenceIds.filter((evidenceId) => !existingEvidenceIds.has(evidenceId));
    if (missingEvidence.length > 0) {
      throw new Error(`Unknown evidence_ids: ${missingEvidence.join(", ")}`);
    }
    if (requiresGoalEvidence(flow) && (input.status === "pronto" || input.status === "pronto_com_ressalvas") && evidenceIds.length === 0) {
      throw new Error("goal_verdict requires traceable evidence_ids for positive conclusions");
    }
    const positiveVerdict = input.status === "pronto" || input.status === "pronto_com_ressalvas";
    if (positiveVerdict && flow.spt_contract_version === 3) {
      if (!flow.spt_traceability) {
        throw new Error("SPT_V3_TRACEABILITY_MISSING: flow is bound to v3 without its canonical traceability map");
      }
      const staleCriterionProofPaths = await staleSelectedCriterionProofPaths(
        flow.evidence,
        evidenceIds,
        flow.goal_binding!.envelope.workspace
      );
      if (staleCriterionProofPaths.length > 0) {
        throw new Error(
          `SPT_V3_EVIDENCE_STALE: selected criterion proof revision differs from current files; paths=${staleCriterionProofPaths.join(",")}`
        );
      }
      const uncoveredCriteria = missingCriterionCoverage(flow.spt_traceability, flow.evidence, evidenceIds);
      if (uncoveredCriteria.length > 0) {
        throw new Error(
          `SPT_V3_CRITERION_COVERAGE_REQUIRED: positive verdict requires passed evidence for every minimum criterion; missing=${uncoveredCriteria.join(",")}`
        );
      }
    }
    const fiscalFlow = await this.flowWithCurrentImplementationFingerprint(await this.store.loadFlow(input.flow_id));
    const memoryMining: Record<string, unknown> | null = positiveVerdict && hasMemoryMiningRun(fiscalFlow) ? (fiscalFlow.memory_mining ?? null) : null;
    if (positiveVerdict && memoryMining?.blocked_verdict === true) {
      await this.persistMemoryMiningVerdictBlock(fiscalFlow, memoryMining, input);
      throw new Error(
        "MEMORY_MINING_BLOCKED_VERDICT: resolver memory_candidates bloqueados antes do veredito positivo; execute goal_status, use mm_memory_candidate_resolve para dar destino rastreavel a strong_unwritten_count/ledger_only e reexecute mm_memory_mining antes de repetir goal_verdict"
      );
    }
    if (positiveVerdict) {
      const fiscal = evaluateFiscalPolicy(fiscalFlow, {
        ...input,
        memory_mining: memoryMining
      });
      if (fiscal.blocking_reasons.length > 0) {
        await this.persistFiscalBlock(fiscalFlow, fiscal, "goal_verdict", input);
        const meetings = await this.store.listMeetings(fiscalFlow.flow_id);
        const cooperationDiagnostics = requiredCooperationDiagnostics(fiscalFlow, meetings, fiscal.blocking_reasons, input);
        const missingForVerdict = stringArray(cooperationDiagnostics.missing_for_verdict);
        const eligibleMeetingIds = stringArray(cooperationDiagnostics.eligible_meeting_ids);
        const meetingRetryHint = missingForVerdict.includes("meeting_id")
          ? `; missing_for_verdict=${missingForVerdict.join("|")}; eligible_meeting_ids=${eligibleMeetingIds.join("|")}`
          : "";
        throw new Error(`PPIRTV_FISCAL_BLOCKED: ${fiscal.blocking_reasons.join(", ")}; required_cooperation=${fiscal.required_cooperation.map((item) => item.name).join("|")}${meetingRetryHint}`);
      }
    }
    let effectiveStatus = input.status;
    let quandoRessalva: string | null = null;
    if (input.status === "pronto") {
      quandoRessalva = missingQuandoGate(input.next_step);
      if (quandoRessalva) {
        effectiveStatus = "pronto_com_ressalvas";
      }
    }
    const verdictLearning = deriveVerdictLearning(input, flow.evidence.filter((evidence) => evidenceIds.includes(evidence.evidence_id)));
    if (quandoRessalva) {
      verdictLearning.gold_mining.push(quandoRessalva);
    }
    const verdict = await this.recordVerdictUnlocked({
      flow_id: input.flow_id,
      status: effectiveStatus,
      rationale: input.rationale,
      evidence_ids: evidenceIds,
      residual_risks: input.residual_risks ?? [],
      review_artifact_path: input.review_artifact_path,
      review_findings: input.review_findings ?? [],
      parking_lot: verdictLearning.parking_lot,
      gold_mining: verdictLearning.gold_mining,
      meeting_ids: meetingIds,
      next_step: input.next_step
    }, { allowOfficialGoal: true });
    const statusSnapshot = await this.goalStatus({ flow_id: input.flow_id, detail: mutationStatusDetail(flow) });
    const closureBlockers = stringArray(statusSnapshot.closure_blockers);
    const terminalAdvanceAllowed =
      (effectiveStatus === "pronto" || effectiveStatus === "pronto_com_ressalvas") &&
      statusSnapshot.phase_advance_allowed === true &&
      closureBlockers.length === 0;
    return {
      verdict,
      verdict_learning: verdictLearning,
      memory_mining: memoryMining,
      phase_advance_allowed: terminalAdvanceAllowed,
      closure_blockers: closureBlockers,
      next_required_action: terminalAdvanceAllowed
        ? {
            type: profileFor(flow.mode).nextPhase[flow.phase] === null ? "advance_terminal" : "advance_phase",
            tool: "goal_advance",
            args: { flow_id: input.flow_id },
            reason: profileFor(flow.mode).nextPhase[flow.phase] === null
              ? "veredito positivo registrado; executar a transicao terminal protegida"
              : "veredito positivo registrado; avancar a fase atual"
          }
        : statusSnapshot.next_required_action ?? null,
      status: statusSnapshot
    };
  }

  async runPipeline(input: {
    pipeline: PipelineItem[];
    stop_on_failure?: boolean;
    auto_memory_mining?: boolean;
  }): Promise<Record<string, unknown>> {
    if (!Array.isArray(input.pipeline) || input.pipeline.length === 0) {
      throw new Error("pipeline must contain at least one item");
    }
    const pipelineId = await this.store.nextId("pipe");
    const startedAt = Date.now();
    const stopOnFailure = input.stop_on_failure ?? true;
    const autoMemoryMining = input.auto_memory_mining ?? true;
    const flows: PipelineFlowResult[] = [];
    let haltedBy: string | undefined;

    for (let index = 0; index < input.pipeline.length; index += 1) {
      const item = input.pipeline[index];
      if (haltedBy) {
        flows.push({
          index,
          goal: item.goal || `pipeline item ${index + 1}`,
          status: "pending",
          blocker: `skipped_after_failure:${haltedBy}`
        });
        continue;
      }

      const result = await this.runPipelineItem({
        pipelineId,
        index,
        item,
        autoMemoryMining
      });
      flows.push(result);
      if ((result.status === "bloqueado" || result.status === "nao_pronto") && stopOnFailure) {
        haltedBy = result.flow_id ?? `item_${index + 1}`;
      }
    }

    const completed = flows.filter((flow) => flow.status === "pronto" || flow.status === "pronto_com_ressalvas").length;
    const failed = flows.filter((flow) => flow.status === "bloqueado" || flow.status === "nao_pronto").length;
    const pending = flows.filter((flow) => flow.status === "pending").length;
    return {
      pipeline_id: pipelineId,
      total: input.pipeline.length,
      completed,
      failed,
      pending,
      stop_on_failure: stopOnFailure,
      auto_memory_mining: autoMemoryMining,
      flows,
      duration_ms: Date.now() - startedAt
    };
  }

  async checkGate(input: {
    flow_id: string;
    phase?: AnyPhase;
    provided?: Record<string, unknown>;
    persist?: boolean;
  }): Promise<GateRecord & PresentationEnvelope> {
    if (input.persist === false) {
      return this.checkGateUnlocked(input);
    }
    return this.store.withFlowLock(input.flow_id, () => this.checkGateUnlocked(input));
  }

  private async checkGateUnlocked(input: {
    flow_id: string;
    phase?: AnyPhase;
    provided?: Record<string, unknown>;
    persist?: boolean;
  }): Promise<GateRecord & PresentationEnvelope> {
    const flow = await this.store.loadFlow(input.flow_id);
    if (input.persist ?? true) {
      assertFlowAcceptsMutation(flow);
    }
    const phase = input.phase ?? flow.phase;
    assertPhase(phase);
    const provided = input.provided ?? {};
    // BUG 3 (pragmatic DRY): requisitos source=provided (ex.: implementation_done)
    // precisam persistir entre chamadas de goal_gate_check. O registro anterior
    // da fase ja esta em flow.gates[phase].provided; fazemos merge aditivo para
    // que chamadas subsequentes sem reenviar o provided continuem considerando-o
    // resolvido. Sources flow/evidence/meeting/verdict continuam consultando o
    // fluxo vivo e nao sao afetados por este merge.
    const persistedProvided = (flow.gates[phase]?.provided ?? {}) as Record<string, unknown>;
    const effectiveProvided: Record<string, unknown> = { ...persistedProvided, ...provided };
    const changedFiles = phase === "implementacao"
      ? unique([...flow.changed_files, ...stringArray(effectiveProvided.changed_files)])
      : flow.changed_files;
    const deletedFiles = phase === "implementacao"
      ? Object.prototype.hasOwnProperty.call(provided, "deleted_files")
        ? unique(stringArray(provided.deleted_files))
        : (flow.deleted_files ?? [])
      : (flow.deleted_files ?? []);
    assertDeletedFilesBelongToChangedFiles(changedFiles, deletedFiles);
    // Patch C (modo compact wire-up): usar profileFor(flow.mode) para decidir
    // gates e transicoes. Default cai em FULL_PROFILE quando flow.mode e'
    // undefined ou desconhecido.
    let flowForResolution =
      changedFiles === flow.changed_files && deletedFiles === flow.deleted_files
        ? flow
        : { ...flow, changed_files: changedFiles, deleted_files: deletedFiles };
    if (phase === "implementacao") {
      flowForResolution = await this.flowWithCurrentImplementationFingerprint(flowForResolution);
    }
    const profile = profileFor(flow.mode);
    const snapshot = this.resolveGateSnapshot(flowForResolution, phase, effectiveProvided);
    const missing = snapshot.missing;
    const status = missing.length === 0 ? "passed" : "blocked";
    const record: GateRecord = {
      phase,
      status,
      checked_at: nowIso(),
      provided: effectiveProvided,
      implementation_fingerprint: flowForResolution.implementation_fingerprint,
      missing,
      next: status === "passed" ? `advance_to_${profile.nextPhase[phase] ?? "complete"}` : `complete_gate_${phase}`,
      back_to: status === "passed" ? null : (profile.defaultBackTo[phase] as Phase | null)
    };
    if (input.persist ?? true) {
      flow.changed_files = changedFiles;
      flow.deleted_files = deletedFiles;
      flow.implementation_fingerprint = flowForResolution.implementation_fingerprint;
      flow.gates[phase] = record;
      flow.status = status === "blocked" ? "blocked" : flow.status === "blocked" ? "active" : flow.status;
      flow.updated_at = record.checked_at;
      flow.history.push({ at: record.checked_at, type: "gate_checked", data: record as unknown as Record<string, unknown> });
      await this.store.saveFlow(flow);
      await this.ledger(flow.flow_id, "gate_checked", record as unknown as Record<string, unknown>);
    }
    const presented = presentGate(record, flow) as GateRecord & PresentationEnvelope & Record<string, unknown>;
    const loopMonitor = status === "blocked" ? fiscalLoopMonitor(flow, missing) : null;
    if (loopMonitor) {
      presented.loop_monitor = loopMonitor;
    }
    return presented;
  }

  private async flowWithCurrentImplementationFingerprint(flow: Flow): Promise<Flow> {
    const workspace = flow.goal_binding?.envelope.workspace;
    if (!workspace || flow.status === "complete" || flow.status === "archived") {
      return flow;
    }
    const implementationFingerprint = await fingerprintReviewedImplementation(
      workspace,
      flow.changed_files,
      process.platform,
      { allowedMissingFiles: flow.deleted_files ?? [] }
    );
    return implementationFingerprint === flow.implementation_fingerprint
      ? flow
      : { ...flow, implementation_fingerprint: implementationFingerprint };
  }

  private resolveGateSnapshot(
    flow: Flow,
    phase: AnyPhase,
    provided: Record<string, unknown>
  ): { requirements: GateRequirementResolution[]; missing: string[] } {
    const requirements = resolveGateRequirements({
      flow,
      requirements: profileFor(flow.mode).gateRequirements[phase] ?? [],
      provided,
      canonicalVerdictRequired: officialGoalNeedsCanonicalVerdict(flow, phase)
    });
    const missing = requirements.filter((item) => !item.satisfied).map((item) => item.key);
    if (needsReviewCoherence(flow, phase, provided)) {
      missing.push("review_evidence_coherent");
    }
    return { requirements, missing: unique(missing) };
  }

  private compactMutationReceipt(
    flow: Flow,
    meetings: Meeting[],
    input: {
      action: "evidence_add" | "goal_advance";
      evidence_id?: string;
      advanced?: boolean;
      from?: AnyPhase;
      before_missing: string[];
      result_missing?: string[];
    }
  ): Record<string, unknown> {
    const snapshot = this.resolveGateSnapshot(
      flow,
      flow.phase,
      (flow.gates[flow.phase]?.provided ?? {}) as Record<string, unknown>
    );
    const phaseBlockers = snapshot.missing;
    const resultBlockers = input.result_missing ?? [];
    const closureBlockers = unique([...closureBlockersFor(flow, meetings), ...resultBlockers]);
    const blockers = unique([...phaseBlockers, ...closureBlockers]);
    return {
      action: input.action,
      flow_id: flow.flow_id,
      ...(input.evidence_id ? { evidence_id: input.evidence_id } : {}),
      ...(input.from ? { from: input.from } : {}),
      phase: flow.phase,
      status: effectiveFlowStatus(flow, blockers),
      ...(typeof input.advanced === "boolean" ? { advanced: input.advanced } : {}),
      satisfied: snapshot.requirements.filter((item) => item.satisfied).map((item) => item.key),
      cleared_blockers: input.before_missing.filter((item) => !phaseBlockers.includes(item)),
      remaining_blockers: blockers,
      phase_blockers: phaseBlockers,
      closure_blockers: closureBlockers,
      phase_advance_allowed: phaseAdvanceAllowed(flow, phaseBlockers, closureBlockers),
      next_step: resultBlockers.length > 0
        ? `complete_gate_${flow.phase}`
        : phaseBlockers.length === 0
        ? `advance_to_${profileFor(flow.mode).nextPhase[flow.phase] ?? "complete"}`
        : `complete_gate_${flow.phase}`
    };
  }

  async advance(input: {
    flow_id: string;
    provided?: Record<string, unknown>;
    evidence_ids?: string[];
    actor?: string;
  }): Promise<Record<string, unknown> & Partial<PresentationEnvelope>> {
    return this.store.withFlowLock(input.flow_id, () => this.advanceUnlocked(input));
  }

  private async advanceUnlocked(input: {
    flow_id: string;
    provided?: Record<string, unknown>;
    evidence_ids?: string[];
    actor?: string;
  }): Promise<Record<string, unknown> & Partial<PresentationEnvelope>> {
    const flow = await this.store.loadFlow(input.flow_id);
    if (flow.status === "archived") {
      throw new Error(`Flow ${flow.flow_id} is archived`);
    }
    const completedEvent = [...flow.history].reverse().find((event) => event.type === "flow_completed");
    if (completedEvent) {
      await ensureLedgerTransitionRecorded(this.store, flow, {
        originalType: "flow_completed",
        recoveredType: "flow_completed_recovered",
        originalAt: completedEvent.at,
        data: completedEvent.data,
        actor: input.actor
      });
      return presentGate({
        advanced: false,
        reused: true,
        phase: flow.phase,
        from: flow.phase,
        to: null,
        status: "complete",
        next: "complete",
        back_to: null
      }, flow);
    }
    const savedGate = flow.gates[flow.phase];
    const shouldReuseSavedGate =
      !input.provided &&
      savedGate?.status === "passed" &&
      !officialGoalNeedsCanonicalVerdict(flow);
    const providedForGate =
      !input.provided && savedGate?.status === "passed" && officialGoalNeedsCanonicalVerdict(flow)
        ? savedGate.provided
        : input.provided;
    const effectiveGate = shouldReuseSavedGate
      ? savedGate
      : await this.checkGateUnlocked({ flow_id: flow.flow_id, phase: flow.phase, provided: providedForGate });
    if (effectiveGate.status === "blocked") {
      const presented = presentGate({
        advanced: false,
        status: "blocked",
        phase: flow.phase,
        missing: effectiveGate.missing,
        next: effectiveGate.next,
        back_to: effectiveGate.back_to
      }, flow);
      if (flow.goal_binding && effectiveGate.missing.some((item) => ["required_cooperation", "librarian_status"].includes(item))) {
        const librarian = await this.runBeforePhaseHook(flow, flow.phase, input.actor ?? "advance_blocked");
        if (librarian) {
          presented.display.librarian = librarian;
        }
      }
      return presented;
    }
    const fresh = await this.flowWithCurrentImplementationFingerprint(await this.store.loadFlow(flow.flow_id));
    const from = fresh.phase;
    // Patch B (modo compact wire-up): proxima fase segundo o perfil do flow.
    const to = profileFor(fresh.mode).nextPhase[from] as AnyPhase | null;
    const now = nowIso();
    if (to === null) {
      if (fresh.goal_binding) {
        const latestVerdict = fresh.verdicts.at(-1);
        const positiveVerdict =
          latestVerdict?.status === "pronto" || latestVerdict?.status === "pronto_com_ressalvas";
        const meetings = await this.store.listMeetings(fresh.flow_id);
        const closureBlockers = closureBlockersFor(fresh, meetings);
        const terminalBlockers = unique([
          ...(positiveVerdict ? [] : ["goal_positive_verdict_required"]),
          ...closureBlockers
        ]);
        if (terminalBlockers.length > 0) {
          const loopSignature = blockerSignature(terminalBlockers);
          const terminalBlock = {
            source: "goal_advance",
            phase: from,
            loop_id: blockerLoopId(terminalBlockers),
            loop_signature: loopSignature,
            blocking_reasons: terminalBlockers,
            evidence_ids: input.evidence_ids ?? []
          };
          fresh.status = "blocked";
          fresh.updated_at = now;
          fresh.history.push({ at: now, type: "goal_terminal_blocked", data: terminalBlock });
          await this.store.saveFlow(fresh);
          await this.ledger(fresh.flow_id, "goal_terminal_blocked", terminalBlock, input.actor ?? "goal_advance");
          return presentGate({
            advanced: false,
            status: "blocked",
            phase: from,
            missing: terminalBlockers,
            next: "complete_gate_validacao",
            back_to: profileFor(fresh.mode).defaultBackTo[from] as AnyPhase | null
          }, fresh);
        }
      }
      await this.runAfterPhaseHook(fresh, from, input.actor);
      fresh.status = "complete";
      fresh.updated_at = now;
      fresh.history.push({
        at: now,
        type: "flow_completed",
        data: { from, evidence_ids: input.evidence_ids ?? [] }
      });
      await this.store.saveFlow(fresh);
      await this.ledger(fresh.flow_id, "flow_completed", { from, evidence_ids: input.evidence_ids ?? [] }, input.actor);
      return presentGate({ advanced: true, phase: from, from, to: null, status: "complete", next: "complete", back_to: null }, fresh);
    }
    await this.runAfterPhaseHook(fresh, from, input.actor);
    fresh.phase = to;
    fresh.status = "active";
    fresh.updated_at = now;
    fresh.history.push({ at: now, type: "phase_advanced", data: { from, to, evidence_ids: input.evidence_ids ?? [] } });
    await this.store.saveFlow(fresh);
    await this.ledger(fresh.flow_id, "phase_advanced", { from, to, evidence_ids: input.evidence_ids ?? [] }, input.actor);
    const librarian = await this.runBeforePhaseHook(fresh, to, input.actor);
    const presented = presentGate({ advanced: true, phase: to, from, to: to, status: fresh.status, next: `gate_${to}`, back_to: null }, fresh);
    if (librarian) {
      presented.display.librarian = librarian;
    }
    return presented;
  }

  private async runAfterPhaseHook(flow: Flow, phase: AnyPhase, actor?: string): Promise<void> {
    try {
      const meetings = await this.store.listMeetings(flow.flow_id);
      const summary = await this.memoryHooks.afterPhase({ flow, phase, meetings });
      await this.ledger(
        flow.flow_id,
        "memory_hook_recorded",
        {
          phase,
          candidates_count: summary.candidates_count,
          parking_count: summary.parking_count,
          warnings: summary.warnings
        },
        actor ?? "bibliotecario"
      );
    } catch (error) {
      await this.recordMemoryHookWarning(flow.flow_id, "afterPhase", phase, error, actor);
    }
  }

  private async runBeforePhaseHook(flow: Flow, phase: AnyPhase, actor?: string): Promise<RecallVisualStatus | null> {
    try {
      const summary = await this.memoryHooks.beforePhase({ flow, phase });
      const recallData = {
        phase,
        recalled_count: summary.items.length,
        items: summary.items.map((item) => ({
          source: item.source,
          title: item.title,
          path: item.path,
          score: item.score,
          question: item.question,
          destination: item.destination,
          observation: item.observation
        })),
        warnings: summary.warnings,
        librarian_status: summary.visual_status.librarian,
        graphify_status: summary.visual_status.graphify,
        recall_executed: true,
        consumption_confirmed: false,
        graphify_consumption_confirmed: false
      };
      const librarianStatus: RecallVisualStatus = {
        status: summary.visual_status.librarian,
        graphify_status: summary.visual_status.graphify,
        warnings: summary.warnings,
        recalled_count: summary.items.length,
        recall_executed: true,
        consumption_confirmed: false,
        graphify_consumption_confirmed: false
      };
      if (summary.deduped) {
        const reusedRecallData = {
          ...recallData,
          items: recallData.items.map((item) => ({
            source: item.source,
            title: item.title,
            path: item.path,
            destination: item.destination
          }))
        };
        await this.ledger(flow.flow_id, "memory_recall_reused", reusedRecallData, actor ?? "bibliotecario");
        const stored = await this.store.loadFlow(flow.flow_id);
        stored.history.push({ at: nowIso(), type: "memory_recall_reused", data: reusedRecallData });
        stored.updated_at = nowIso();
        await this.store.saveFlow(stored);
        return librarianStatus;
      }
      await this.ledger(flow.flow_id, "memory_recalled", recallData, actor ?? "bibliotecario");
      const stored = await this.store.loadFlow(flow.flow_id);
      stored.history.push({ at: nowIso(), type: "memory_recalled", data: recallData });
      stored.updated_at = nowIso();
      await this.store.saveFlow(stored);
      return librarianStatus;
    } catch (error) {
      const failed: RecallVisualStatus = {
        status: "failed",
        graphify_status: "failed",
        warnings: [`bibliotecario_failed: ${error instanceof Error ? error.message : String(error)}`],
        recalled_count: 0,
        recall_executed: true,
        consumption_confirmed: false,
        graphify_consumption_confirmed: false
      };
      await this.recordMemoryHookWarning(flow.flow_id, "beforePhase", phase, error, actor);
      const stored = await this.store.loadFlow(flow.flow_id);
      stored.history.push({
        at: nowIso(),
        type: "memory_recalled",
        data: {
          phase,
          recalled_count: 0,
          warnings: failed.warnings,
          librarian_status: "failed",
          graphify_status: "failed",
          recall_executed: true,
          consumption_confirmed: false,
          graphify_consumption_confirmed: false
        }
      });
      stored.updated_at = nowIso();
      await this.store.saveFlow(stored);
      return failed;
    }
  }

  private async confirmRecallConsumption(flow: Flow, input: RecallConsumptionInput, actor: string): Promise<Record<string, unknown>> {
    assertNoSecretLikePayload(input, "recall_consumption");
    const references = unique((input.references ?? []).map((item) => item.trim()).filter(Boolean));
    const graphifyReferences = unique((input.graphify_references ?? []).map((item) => item.trim()).filter(Boolean));
    if (references.length === 0) {
      throw new Error("RECALL_CONSUMPTION_REFERENCES_REQUIRED: informe ao menos uma referencia recuperada");
    }
    const ledger = await this.store.readLedger(flow.flow_id);
    const recallEventIndex = lastIndexWhere(
      ledger,
      (event) => (event.type === "memory_recalled" || event.type === "memory_recall_reused") && event.data.phase === flow.phase
    );
    const recallEvent = recallEventIndex >= 0 ? ledger[recallEventIndex] : undefined;
    const recalledItems = Array.isArray(recallEvent?.data.items) ? (recallEvent?.data.items as Array<Record<string, unknown>>) : [];
    if (recalledItems.length === 0) {
      throw new Error(`RECALL_CONSUMPTION_WITHOUT_RECALL: nenhum item recuperado para a fase ${flow.phase}`);
    }
    const validReferences = recallReferenceValues(recalledItems);
    const knownReferences = recallReferenceSet(validReferences);
    const unknownReferences = references.filter((reference) => !knownReferences.has(normalizeRecallReference(reference)));
    if (unknownReferences.length > 0) {
      throw new RecallConsumptionReferenceError(
        "RECALL_CONSUMPTION_UNKNOWN_REFERENCES",
        unknownReferences,
        validReferences
      );
    }
    const graphifyItems = recalledItems.filter((item) => item.source === "graphify");
    const validGraphifyReferences = recallReferenceValues(graphifyItems);
    const knownGraphifyReferences = recallReferenceSet(validGraphifyReferences);
    const unknownGraphifyReferences = graphifyReferences.filter((reference) => !knownGraphifyReferences.has(normalizeRecallReference(reference)));
    if (unknownGraphifyReferences.length > 0) {
      throw new RecallConsumptionReferenceError(
        "GRAPHIFY_CONSUMPTION_UNKNOWN_REFERENCES",
        unknownGraphifyReferences,
        validReferences,
        validGraphifyReferences
      );
    }
    const existingConfirmation = [...ledger.slice(recallEventIndex + 1)].reverse().find((event) =>
      event.type === "memory_recall_consumed" &&
      event.data.recall_phase === flow.phase &&
      sameRecallReferences(stringArray(event.data.references), references) &&
      sameRecallReferences(stringArray(event.data.graphify_references), graphifyReferences)
    );
    if (existingConfirmation) {
      return { ...existingConfirmation.data, reused: true };
    }
    const now = nowIso();
    const data = {
      recall_phase: flow.phase,
      references,
      graphify_references: graphifyReferences,
      note: input.note?.trim() ?? null,
      consumption_confirmed: true,
      graphify_consumption_confirmed: graphifyReferences.length > 0
    };
    const stored = await this.store.loadFlow(flow.flow_id);
    stored.history.push({ at: now, type: "memory_recall_consumed", data });
    stored.updated_at = now;
    await this.store.saveFlow(stored);
    await this.ledger(flow.flow_id, "memory_recall_consumed", data, actor);
    return data;
  }

  private async recordMemoryHookWarning(flowId: string, hook: "beforePhase" | "afterPhase", phase: AnyPhase, error: unknown, actor?: string): Promise<void> {
    try {
      await this.ledger(
        flowId,
        "memory_hook_warning",
        {
          hook,
          phase,
          message: error instanceof Error ? error.message : String(error)
        },
        actor ?? "bibliotecario"
      );
      const flow = await this.store.loadFlow(flowId);
      flow.history.push({
        at: nowIso(),
        type: "memory_hook_warning",
        data: {
          hook,
          phase,
          message: error instanceof Error ? error.message : String(error),
          librarian_status: "failed",
          graphify_status: "failed",
          recall_executed: hook === "beforePhase",
          consumption_confirmed: false,
          graphify_consumption_confirmed: false
        }
      });
      flow.updated_at = nowIso();
      await this.store.saveFlow(flow);
    } catch {
      // The librarian is advisory in v1; hook warning persistence is best effort.
    }
  }

  async returnTo(input: { flow_id: string; to: AnyPhase; reason: string; evidence_ids?: string[]; actor?: string }): Promise<Flow & PresentationEnvelope> {
    return this.store.withFlowLock(input.flow_id, () => this.returnToUnlocked(input));
  }

  private async returnToUnlocked(input: { flow_id: string; to: AnyPhase; reason: string; evidence_ids?: string[]; actor?: string }): Promise<Flow & PresentationEnvelope> {
    assertPhase(input.to);
    requireText(input.reason, "reason");
    const flow = await this.store.loadFlow(input.flow_id);
    assertFlowAcceptsMutation(flow);
    const from = flow.phase;
    const now = nowIso();
    flow.phase = input.to;
    flow.status = "active";
    // P1+D (hardening): invalidar gate da fase destino E todos os gates
    // de fases posteriores no perfil do flow. Sem isso, o gate "passed"
    // stale (com provided acumulado do BUG 3 merge) de fases downstream
    // libera avance sem revalidacao apos regresso.
    const profile = profileFor(flow.mode);
    const toIndex = profile.phases.indexOf(input.to);
    if (toIndex >= 0) {
      for (let i = toIndex; i < profile.phases.length; i += 1) {
        const phaseToInvalidate = profile.phases[i];
        if (flow.gates[phaseToInvalidate]) {
          delete flow.gates[phaseToInvalidate];
        }
      }
    } else {
      // Fallback: se a fase nao esta no perfil (dados corrompidos),
      // invalidar pelo menos o gate da fase destino.
      if (flow.gates[input.to]) {
        delete flow.gates[input.to];
      }
    }
    flow.updated_at = now;
    flow.history.push({
      at: now,
      type: "phase_returned",
      data: { from, to: input.to, reason: input.reason, evidence_ids: input.evidence_ids ?? [] }
    });
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "phase_returned", { from, to: input.to, reason: input.reason, evidence_ids: input.evidence_ids ?? [] }, input.actor);
    return presentFlow(flow);
  }

  async openMeeting(input: {
      flow_id: string;
      type?: MeetingType;
      kind?: MeetingKind;
      question: string;
      participants_required?: string[];
      suggested_cooperators?: Cooperator[];
      created_by?: string;
      evidence_ids?: string[];
  }): Promise<Meeting & PresentationEnvelope> {
    requireText(input.question, "question");
    return this.store.withFlowLock(input.flow_id, () => this.openMeetingUnlocked(input));
  }

  private async openMeetingUnlocked(input: {
      flow_id: string;
      type?: MeetingType;
      kind?: MeetingKind;
      question: string;
      participants_required?: string[];
      suggested_cooperators?: Cooperator[];
      created_by?: string;
      evidence_ids?: string[];
  }): Promise<Meeting & PresentationEnvelope> {
    const flow = await this.store.loadFlow(input.flow_id);
    assertFlowAcceptsMutation(flow);
    const now = nowIso();
    const fiscal = evaluateFiscalPolicy(flow);
    const persistedFiscal = latestFiscalBlock(flow);
    const blockers = reconciledBlockers(flow, [...fiscal.blocking_reasons, ...persistedFiscal.blocking_reasons]);
    const regressCount = countRegressions(flow);
    const kind = input.kind ?? meetingKindForType(input.type) ?? requiredMeetingKind(flow, blockers, regressCount >= FISCAL_CONFIG.maxRegressions);
    const type = input.type ?? meetingTypeForKind(kind);
    const meeting: Meeting = {
      meeting_id: await this.store.nextId("mtg"),
      flow_id: flow.flow_id,
      type,
      kind,
      question: input.question,
      status: "open",
      opened_at: now,
      participants_required: unique(input.participants_required ?? requiredMeetingParticipants(blockers)),
      participants_present: [],
      suggested_cooperators: normalizeSuggestedCooperators(input.suggested_cooperators ?? []),
      questions: [],
      findings: [],
      hypotheses: [],
      alternatives: [],
      decisions: [],
      decision: undefined,
      next_required_action: null,
      satisfies_blockers: [],
      created_by: input.created_by ?? "meeting_open",
      evidence_ids: input.evidence_ids ?? [],
      turns: [],
      risks: [],
      next_steps: [],
      affected_areas: [],
      impacts: [],
      owners: [],
      gates_extra: [],
      parking_lot: [],
      gold_mining: [],
      cooperators: [],
      active_credits: []
    };
    flow.meetings.push(meeting.meeting_id);
    flow.updated_at = now;
    flow.history.push({
      at: now,
      type: "meeting_opened",
      data: {
        meeting_id: meeting.meeting_id,
        type: meeting.type,
        kind: meeting.kind,
        participants_required: meeting.participants_required,
        suggested_cooperators: meeting.suggested_cooperators,
        evidence_ids: meeting.evidence_ids
      }
    });
    await this.store.saveMeeting(meeting);
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "meeting_opened", {
      meeting_id: meeting.meeting_id,
      type: meeting.type,
      kind: meeting.kind,
      question: meeting.question,
      participants_required: meeting.participants_required,
      suggested_cooperators: meeting.suggested_cooperators,
      evidence_ids: meeting.evidence_ids
    });
    return presentArtifact(meeting as Meeting & Record<string, unknown>, flow);
  }

  async addMeetingTurn(input: {
    meeting_id: string;
    speaker?: string;
    question?: string;
    finding?: string;
    note?: string;
    evidence_ids?: string[];
  }): Promise<Meeting & PresentationEnvelope> {
    const meeting = await this.store.loadMeeting(input.meeting_id);
    return this.store.withFlowLock(meeting.flow_id, () => this.addMeetingTurnUnlocked(input));
  }

  private async addMeetingTurnUnlocked(input: {
    meeting_id: string;
    speaker?: string;
    question?: string;
    finding?: string;
    note?: string;
    evidence_ids?: string[];
  }): Promise<Meeting & PresentationEnvelope> {
    const meeting = await this.store.loadMeeting(input.meeting_id);
    const flow = await this.store.loadFlow(meeting.flow_id);
    assertFlowAcceptsMutation(flow);
    if (meeting.status === "closed") {
      throw new Error(`meeting_id ${input.meeting_id} is already closed`);
    }
    const now = nowIso();
    const turn = {
      at: now,
      speaker: input.speaker,
      question: input.question,
      finding: input.finding,
      note: input.note,
      evidence_ids: input.evidence_ids ?? []
    };
    meeting.turns = [...meeting.turns, turn];
    meeting.questions = unique([...meeting.questions, ...stringArray(input.question)]);
    meeting.findings = unique([...meeting.findings, ...stringArray(input.finding), ...stringArray(input.note)]);
    meeting.evidence_ids = unique([...meeting.evidence_ids, ...(input.evidence_ids ?? [])]);
    await this.store.saveMeeting(meeting);
    flow.updated_at = now;
    flow.history.push({
      at: now,
      type: "meeting_turn_added",
      data: { meeting_id: meeting.meeting_id, speaker: input.speaker, evidence_ids: input.evidence_ids ?? [] }
    });
    await this.store.saveFlow(flow);
    await this.ledger(meeting.flow_id, "meeting_turn_added", {
      meeting_id: meeting.meeting_id,
      speaker: input.speaker,
      question: input.question,
      finding: input.finding,
      note: input.note,
      evidence_ids: input.evidence_ids ?? []
    });
    return presentArtifact(meeting as Meeting & Record<string, unknown>, flow);
  }

  async recordMeeting(input: Partial<Meeting> & { meeting_id: string }): Promise<Meeting & PresentationEnvelope> {
    const meeting = await this.store.loadMeeting(input.meeting_id);
    return this.store.withFlowLock(meeting.flow_id, () => this.recordMeetingUnlocked(input));
  }

  private async recordMeetingUnlocked(input: Partial<Meeting> & { meeting_id: string }): Promise<Meeting & PresentationEnvelope> {
    const meeting = await this.store.loadMeeting(input.meeting_id);
    const flow = await this.store.loadFlow(meeting.flow_id);
    assertFlowAcceptsMutation(flow);
    if (meeting.status === "closed") {
      throw new Error(`MEETING_ALREADY_CLOSED: ${meeting.meeting_id}`);
    }
    const now = nowIso();
    meeting.status = "recorded";
    meeting.recorded_at = now;
    meeting.questions = input.questions ?? meeting.questions;
    meeting.hypotheses = input.hypotheses ?? meeting.hypotheses;
    meeting.alternatives = input.alternatives ?? meeting.alternatives;
    meeting.decisions = input.decisions ?? meeting.decisions;
    meeting.decision = input.decision ?? meeting.decision ?? meeting.decisions[0];
    meeting.findings = input.findings ?? meeting.findings;
    meeting.participants_present = input.participants_present ?? meeting.participants_present;
    meeting.satisfies_blockers = input.satisfies_blockers ?? meeting.satisfies_blockers;
    meeting.evidence_ids = unique([...(input.evidence_ids ?? []), ...meeting.evidence_ids]);
    meeting.risks = input.risks ?? meeting.risks;
    meeting.next_steps = input.next_steps ?? meeting.next_steps;
    meeting.affected_areas = input.affected_areas ?? meeting.affected_areas;
    meeting.impacts = input.impacts ?? meeting.impacts;
    meeting.owners = input.owners ?? meeting.owners;
    meeting.gates_extra = input.gates_extra ?? meeting.gates_extra;
    meeting.rollback_plan = input.rollback_plan ?? meeting.rollback_plan;
    meeting.parking_lot = input.parking_lot ?? meeting.parking_lot;
    meeting.gold_mining = input.gold_mining ?? meeting.gold_mining;
    meeting.cooperators = input.cooperators ?? meeting.cooperators;
    meeting.active_credits = input.active_credits ?? meeting.active_credits;
    await this.store.saveMeeting(meeting);
    flow.decisions = unique([...flow.decisions, ...meeting.decisions]);
    flow.risks = unique([...flow.risks, ...meeting.risks]);
    const meetingPromotedGold = linkParkingToGold(flow, meeting.parking_lot, "meeting_record", meeting.meeting_id, now);
    meeting.gold_mining = unique([...meeting.gold_mining, ...meetingPromotedGold]);
    flow.parking_lot = unique([...flow.parking_lot, ...meeting.parking_lot]);
    flow.gold_mining = unique([...flow.gold_mining, ...meeting.gold_mining]);
    flow.cooperators = uniqueCooperators([...flow.cooperators, ...meeting.cooperators]);
    flow.active_credits = unique([...flow.active_credits, ...meeting.active_credits]);
    flow.updated_at = now;
    flow.history.push({
      at: now,
      type: "meeting_recorded",
      data: { meeting_id: meeting.meeting_id, type: meeting.type, kind: meeting.kind }
    });
    await this.store.saveMeeting(meeting);
    await this.store.saveFlow(flow);
    await this.ledger(meeting.flow_id, "meeting_recorded", meeting as unknown as Record<string, unknown>);
    return presentArtifact(meeting as Meeting & Record<string, unknown>, flow);
  }

  async closeMeeting(input: Partial<Meeting> & {
    meeting_id: string;
    participants_present?: string[];
    findings?: string[];
    decision: string;
    next_required_action?: Record<string, unknown> | null;
    satisfies_blockers?: string[];
    evidence_ids?: string[];
  }): Promise<Meeting & PresentationEnvelope> {
    const meeting = await this.store.loadMeeting(input.meeting_id);
    return this.store.withFlowLock(meeting.flow_id, () => this.closeMeetingUnlocked(input));
  }

  private async closeMeetingUnlocked(input: Partial<Meeting> & {
    meeting_id: string;
    participants_present?: string[];
    findings?: string[];
    decision: string;
    next_required_action?: Record<string, unknown> | null;
    satisfies_blockers?: string[];
    evidence_ids?: string[];
  }): Promise<Meeting & PresentationEnvelope> {
    requireText(input.decision, "decision");
    const meeting = await this.store.loadMeeting(input.meeting_id);
    const flow = await this.store.loadFlow(meeting.flow_id);
    assertFlowAcceptsMutation(flow);
    if (meeting.status === "closed") {
      if (meeting.decision !== input.decision) {
        throw new Error(`MEETING_ALREADY_CLOSED: ${meeting.meeting_id}`);
      }
      let closedData: Record<string, unknown>;
      const closedIndex = meetingClosedIndex(flow, meeting.meeting_id);
      if (closedIndex === null) {
        closedData = applyClosedMeetingToFlow(flow, meeting, meeting.closed_at ?? nowIso());
        await this.store.saveFlow(flow);
      } else {
        closedData = flow.history[closedIndex]?.data ?? meetingClosedLedgerData(meeting);
      }
      const ledgerEvents = await this.store.readLedger(meeting.flow_id);
      const hasCloseLedger = ledgerEvents.some(
        (event) =>
          (event.type === "meeting_closed" || event.type === "meeting_closed_recovered") &&
          String(event.data.meeting_id ?? "") === meeting.meeting_id
      );
      if (!hasCloseLedger) {
        await this.ledger(meeting.flow_id, "meeting_closed", {
          ...closedData,
          recovered_components: closedIndex === null ? ["flow", "ledger"] : ["ledger"]
        });
      }
      // The same frozen decision is an idempotent retry. This also covers the
      // ambiguous append-then-throw boundary where the ledger write succeeded
      // but the caller never received success.
      return presentArtifact(meeting as Meeting & Record<string, unknown>, flow);
    }
    const now = nowIso();
    const participantsPresent = unique(input.participants_present ?? meeting.participants_present);
    const missingParticipants = meeting.participants_required.filter((participant) => !participantsPresent.includes(participant));
    const requestedSatisfies = unique(input.satisfies_blockers ?? []);
    const unsupportedBlockers = requestedSatisfies.filter((blocker) => !MEETING_RESOLVABLE_BLOCKERS.has(blocker));
    if (unsupportedBlockers.length > 0) {
      const owners = unsupportedBlockers.map((blocker) => `${blocker}:${blockerOwner(blocker)}`).join(", ");
      throw new Error(`MEETING_BLOCKER_NOT_OWNED: ${owners}`);
    }
    meeting.status = "closed";
    meeting.recorded_at = meeting.recorded_at ?? now;
    meeting.closed_at = now;
    meeting.questions = input.questions ?? meeting.questions;
    meeting.findings = unique([...(input.findings ?? []), ...meeting.findings]);
    meeting.hypotheses = input.hypotheses ?? meeting.hypotheses;
    meeting.alternatives = input.alternatives ?? meeting.alternatives;
    meeting.decisions = unique([...(input.decisions ?? []), input.decision, ...meeting.decisions]);
    meeting.decision = input.decision;
    meeting.risks = input.risks ?? meeting.risks;
    meeting.next_steps = input.next_steps ?? meeting.next_steps;
    meeting.affected_areas = input.affected_areas ?? meeting.affected_areas;
    meeting.impacts = input.impacts ?? meeting.impacts;
    meeting.owners = input.owners ?? meeting.owners;
    meeting.gates_extra = input.gates_extra ?? meeting.gates_extra;
    meeting.rollback_plan = input.rollback_plan ?? meeting.rollback_plan;
    meeting.parking_lot = input.parking_lot ?? meeting.parking_lot;
    meeting.gold_mining = input.gold_mining ?? meeting.gold_mining;
    meeting.cooperators = input.cooperators ?? meeting.cooperators;
    meeting.active_credits = input.active_credits ?? meeting.active_credits;
    meeting.participants_present = participantsPresent;
    meeting.next_required_action = input.next_required_action ?? null;
    meeting.evidence_ids = unique([...(input.evidence_ids ?? []), ...meeting.evidence_ids]);
    meeting.satisfies_blockers =
      missingParticipants.length === 0 && meeting.decision ? unique(requestedSatisfies) : meeting.satisfies_blockers.filter((blocker) => !requestedSatisfies.includes(blocker));
    const meetingPromotedGold = linkParkingToGold(flow, meeting.parking_lot, "meeting_record", meeting.meeting_id, now);
    meeting.gold_mining = unique([...meeting.gold_mining, ...meetingPromotedGold]);
    const closedData = applyClosedMeetingToFlow(flow, meeting, now);
    await this.store.saveMeeting(meeting);
    await this.store.saveFlow(flow);
    await this.ledger(meeting.flow_id, "meeting_closed", closedData);
    return presentArtifact(meeting as Meeting & Record<string, unknown>, flow);
  }

  async attachEvidence(input: {
    flow_id: string;
    kind: string;
    title: string;
    uri?: string;
    content?: string;
    note?: string;
    satisfies?: string[];
    observed_result?: Record<string, unknown>;
    criterion_proof?: CriterionProofInput;
    scope_classification?: "target" | "declared_dependency" | "outside";
    scope_reference?: string;
    reviewed_implementation_fingerprint?: string;
    parking_lot?: string[];
    gold_mining?: string[];
    cooperators?: Flow["cooperators"];
    active_credits?: string[];
  }): Promise<Evidence & PresentationEnvelope> {
    return this.store.withFlowLock(input.flow_id, () => this.attachEvidenceUnlocked(input));
  }

  private async attachEvidenceUnlocked(input: {
    flow_id: string;
    kind: string;
    title: string;
    uri?: string;
    content?: string;
    note?: string;
    satisfies?: string[];
    observed_result?: Record<string, unknown>;
    criterion_proof?: CriterionProofInput;
    scope_classification?: "target" | "declared_dependency" | "outside";
    scope_reference?: string;
    reviewed_implementation_fingerprint?: string;
    parking_lot?: string[];
    gold_mining?: string[];
    cooperators?: Flow["cooperators"];
    active_credits?: string[];
  }): Promise<Evidence & PresentationEnvelope> {
    requireText(input.title, "title");
    const flow = await this.flowWithCurrentImplementationFingerprint(await this.store.loadFlow(input.flow_id));
    assertFlowAcceptsMutation(flow);
    const reviewAttestation = structuredReviewAttestationRequested(input);
    if (reviewAttestation && flow.goal_binding?.envelope.workspace) {
      const strictFingerprint = await fingerprintReviewedImplementation(
        flow.goal_binding.envelope.workspace,
        flow.changed_files,
        process.platform,
        {
          requireReviewableFiles: true,
          allowedMissingFiles: flow.deleted_files ?? []
        }
      );
      if (!input.reviewed_implementation_fingerprint) {
        throw new Error("REVIEW_SNAPSHOT_FINGERPRINT_REQUIRED: obtain implementation_fingerprint after implementation and attest that exact snapshot");
      }
      if (input.reviewed_implementation_fingerprint !== strictFingerprint) {
        throw new Error("REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH: reviewed snapshot differs from the current implementation");
      }
      flow.implementation_fingerprint = strictFingerprint;
    }
    const now = nowIso();
    if (input.criterion_proof && flow.spt_contract_version !== 3) {
      throw new Error("SPT_V3_EVIDENCE_INVALID: criterion_proof requires a flow bound to SPT v3");
    }
    if (input.criterion_proof && !flow.spt_traceability) {
      throw new Error("SPT_V3_TRACEABILITY_MISSING: criterion_proof requires the bound canonical traceability map");
    }
    const criterionProof =
      input.criterion_proof && flow.spt_traceability
        ? qualifyCriterionProof(flow.spt_traceability, input.criterion_proof)
        : undefined;
    if (criterionProof) {
      await assertCriterionProofRevisionCurrent(criterionProof, flow.goal_binding!.envelope.workspace);
    }
    const evidence: Evidence = {
      evidence_id: await this.store.nextId("evd"),
      flow_id: flow.flow_id,
      kind: input.kind || "note",
      title: input.title,
      uri: input.uri,
      content: input.content,
      note: input.note,
      satisfies: input.satisfies,
      observed_result: input.observed_result,
      criterion_proof: criterionProof,
      scope_classification: input.scope_classification,
      scope_reference: input.scope_reference,
      reviewed_implementation_fingerprint:
        reviewAttestation
          ? input.reviewed_implementation_fingerprint
          : undefined,
      parking_lot: input.parking_lot ?? [],
      gold_mining: input.gold_mining ?? [],
      cooperators: input.cooperators ?? [],
      active_credits: input.active_credits ?? [],
      created_at: now
    };
    const evidencePromotedGold = linkParkingToGold(flow, evidence.parking_lot, "evidence_attach", evidence.evidence_id, now);
    evidence.gold_mining = unique([...evidence.gold_mining, ...evidencePromotedGold]);
    flow.parking_lot = unique([...flow.parking_lot, ...evidence.parking_lot]);
    flow.gold_mining = unique([...flow.gold_mining, ...evidence.gold_mining]);
    flow.cooperators = uniqueCooperators([...flow.cooperators, ...evidence.cooperators]);
    flow.active_credits = unique([...flow.active_credits, ...evidence.active_credits]);
    flow.evidence.push(evidence);
    flow.updated_at = now;
    flow.history.push({ at: now, type: "evidence_attached", data: { evidence_id: evidence.evidence_id, title: evidence.title } });
    await this.store.saveEvidence(evidence);
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "evidence_attached", { evidence_id: evidence.evidence_id, kind: evidence.kind, title: evidence.title, uri: evidence.uri });
    const presented = presentArtifact(evidence as Evidence & Record<string, unknown>, flow);
    const blockers = latestFiscalBlock(flow).blocking_reasons;
    return flow.status === "blocked" || blockers.length > 0
      ? withDirectAction(presented, blockedDirectAction(blockers.length > 0 ? blockers : ["flow_blocked"]))
      : presented;
  }

  async renderChecklist(flowId: string, detail: "visual-only" | "lean" | "compact" | "full" = "visual-only"): Promise<{
    flow_id: string;
    phase?: AnyPhase;
    mode?: Flow["mode"];
    status?: Flow["status"];
    markdown?: string;
    items: Array<{ label: string; checked: boolean }>;
    blockers?: string[];
    phase_blockers?: string[];
    closure_blockers?: string[];
    phase_advance_allowed?: boolean;
    phase_direct_action?: { available: boolean; action: string } | null;
    next_step?: string;
    operational_principles?: PrincipleChecklistItem[];
    operational_principles_count?: number;
    ready_definition?: string[];
    gate_final_output?: string[];
    final_report_model?: string[];
    default_workflow?: DefaultWorkflow;
    secret_env_consumption_policy?: OperationalPolicyBlock;
    early_security_proportionality_policy?: OperationalPolicyBlock;
    required_cooperation?: Cooperator[];
    fiscal_policy?: FiscalPolicyResult;
    work_progress?: WorkProgressSummary;
  } & PresentationEnvelope> {
    const flow = await this.store.loadFlow(flowId);
    const meetings = await this.store.listMeetings(flow.flow_id);
    const checklistProfile = profileFor(flow.mode);
    const checklistRequirements = checklistProfile.gateRequirements[flow.phase] ?? [];
    const items = checklistRequirements.map((requirement) => ({
      label: requirement.label,
      checked: hasRequirement(flow, requirement.key, requirement.source, flow.gates[flow.phase]?.provided ?? {})
    }));
    const fiscal = evaluateFiscalPolicy(flow);
    const persistedFiscal = latestFiscalBlock(flow);
    const phaseBlockers = checklistRequirements
      .filter((requirement) => !hasRequirement(flow, requirement.key, requirement.source, flow.gates[flow.phase]?.provided ?? {}))
      .map((requirement) => requirement.key);
    if (needsReviewCoherence(flow, flow.phase, flow.gates[flow.phase]?.provided ?? {})) {
      phaseBlockers.push("review_evidence_coherent");
    }
    const closureBlockers = closureBlockersFor(flow, meetings);
    const blockers = unique([...phaseBlockers, ...closureBlockers]);
    const nextPhase = checklistProfile.nextPhase[flow.phase] as AnyPhase | null;
    const canAdvancePhase = phaseAdvanceAllowed(flow, phaseBlockers, closureBlockers);
    const nextStep = phaseBlockers.length > 0
      ? `complete_gate_${flow.phase}`
      : nextPhase
        ? `advance_to_${nextPhase}`
        : closureBlockers.length > 0
          ? fiscalResult(true, closureBlockers).direct_action
          : "complete";
    if (detail === "visual-only" || detail === "lean") {
      const presented = presentChecklist({ flow, markdown: "", items });
      const withAction = blockers.length > 0
        ? withDirectAction(presented, blockedDirectAction(blockers))
        : presented;
      const workProgress = workProgressSummary(flow);
      return {
        flow_id: flow.flow_id,
        phase: flow.phase,
        mode: flow.mode,
        status: effectiveFlowStatus(flow, blockers),
        items,
        blockers,
        phase_blockers: phaseBlockers,
        closure_blockers: closureBlockers,
        phase_advance_allowed: canAdvancePhase,
        phase_direct_action: canAdvancePhase && nextPhase
          ? phaseAdvanceDirectAction(closureBlockers, nextPhase)
          : null,
        next_step: nextStep,
        work_progress: workProgress,
        aliases: {
          ...withAction.aliases,
          faltando: blockers,
          proximo: nextStep
        },
        display: { ...withAction.display, work_progress: workProgress },
        suggested_cooperation: withAction.suggested_cooperation
      };
    }
    const operationalPrinciples = (await principleChecklist()).map((item) => {
      if (item.id === "memoria_sem_lembranca" && memoryRequiredByFlow(flow) && noMemoryWasPromoted(flow)) {
        return { ...item, checked: false, state: "blocked" as const };
      }
      if (item.id === "memoria_sem_lembranca" && !hasMemoryMiningRun(flow)) {
        return { ...item, checked: false, state: "pending" as const };
      }
      if (item.id === "casa_limpa" && (hasHygieneBlocking(flow) || blockers.length > 0)) {
        return { ...item, checked: false, state: "blocked" as const };
      }
      if (item.id === "casa_limpa" && !hasHygieneScan(flow)) {
        return { ...item, checked: false, state: "pending" as const };
      }
      if (item.id === "barata_nunca_esta_sozinha" && fiscal.blocking_reasons.includes("attempt_regress_count")) {
        return { ...item, checked: false, state: "blocked" as const };
      }
      if (item.id === "barata_nunca_esta_sozinha" && fiscal.material && countRegressions(flow) === 0) {
        return { ...item, checked: false, state: "pending" as const };
      }
      return { ...item, state: item.checked ? ("checked" as const) : ("unchecked" as const) };
    });
    const readyItems = readyDefinition();
    const gateOutputItems = gateFinalOutput();
    const reportModelItems = finalReportModel();
    const workflow = defaultWorkflow();
    const secretPolicy = secretEnvConsumptionPolicy();
    const earlySecurityPolicy = earlySecurityProportionalityPolicy();
    const markdown = [
      `# Checklist PPIRTV - ${flow.flow_id}`,
      "",
      `Fase atual: ${flow.phase}`,
      "",
      ...items.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`),
      "",
      "## Principios operacionais",
      "",
      ...operationalPrinciples.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}${item.default_severity ? ` (${item.default_severity})` : ""}`),
      "",
      "## Definicao de pronto",
      "",
      ...(readyItems.length > 0 ? readyItems.map((item) => `- ${item}`) : ["- Validar objetivo, evidencias, bloqueios, riscos e proximas acoes antes de declarar pronto."]),
      "",
      "## Gate Final PPIRTV",
      "",
      ...(gateOutputItems.length > 0 ? gateOutputItems.map((item) => `- ${item}`) : ["- Declarar principios acionados, evidencias, bloqueios, validacao e risco restante."])
    ].join("\n");
    const presented = presentChecklist({
        flow,
        markdown,
        items,
        visualItems: [
          ...items.map((item) => ({ ...item, state: item.checked ? ("checked" as const) : ("unchecked" as const), emoji: item.checked ? "✅" : "◻️" })),
          ...operationalPrinciples.map((item) => ({
            label: item.label,
            checked: item.checked,
            state: item.state,
            emoji: item.state === "checked" ? "✅" : item.state === "pending" ? "…" : "⚡"
          }))
        ]
      });
    return {
      ...(blockers.length > 0 || effectiveFlowStatus(flow, blockers) === "blocked"
        ? withDirectAction(presented, blockedDirectAction(blockers.length > 0 ? blockers : ["flow_blocked"]))
        : presented),
      status: effectiveFlowStatus(flow, blockers),
      blockers,
      phase_blockers: phaseBlockers,
      closure_blockers: closureBlockers,
      phase_advance_allowed: canAdvancePhase,
      phase_direct_action: canAdvancePhase && nextPhase
        ? phaseAdvanceDirectAction(closureBlockers, nextPhase)
        : null,
      next_step: nextStep,
      work_progress: workProgressSummary(flow),
      // BUG 5 (detail compact): omitir arrays grandes quando detail=compact.
      // Substituir por contagens para manter sinal sem custo de tokens.
      operational_principles: detail === "compact" ? undefined : operationalPrinciples,
      operational_principles_count: operationalPrinciples.length,
      ready_definition: detail === "compact" ? undefined : readyItems,
      gate_final_output: detail === "compact" ? undefined : gateOutputItems,
      final_report_model: detail === "compact" ? undefined : reportModelItems,
      default_workflow: detail === "compact" ? undefined : workflow,
      secret_env_consumption_policy: detail === "compact" ? undefined : secretPolicy,
      early_security_proportionality_policy: detail === "compact" ? undefined : earlySecurityPolicy,
      required_cooperation: fiscal.required_cooperation,
      fiscal_policy: fiscal
    };
  }

  async recordVerdict(input: {
    flow_id: string;
    status: VerdictStatus;
    rationale: string;
    evidence_ids?: string[];
    residual_risks?: string[];
    review_artifact_path?: string;
    review_findings?: string[];
    parking_lot?: string[];
    gold_mining?: string[];
    cooperators?: Flow["cooperators"];
    active_credits?: string[];
    meeting_ids?: string[];
    next_step: string;
  }): Promise<Verdict & PresentationEnvelope> {
    requireText(input.rationale, "rationale");
    requireText(input.next_step, "next_step");
    return this.store.withFlowLock(input.flow_id, () => this.recordVerdictUnlocked(input));
  }

  private async recordVerdictUnlocked(input: {
    flow_id: string;
    status: VerdictStatus;
    rationale: string;
    evidence_ids?: string[];
    residual_risks?: string[];
    review_artifact_path?: string;
    review_findings?: string[];
    parking_lot?: string[];
    gold_mining?: string[];
    cooperators?: Flow["cooperators"];
    active_credits?: string[];
    meeting_ids?: string[];
    next_step: string;
  }, options: { allowOfficialGoal?: boolean } = {}): Promise<Verdict & PresentationEnvelope> {
    const flow = await this.flowWithCurrentImplementationFingerprint(await this.store.loadFlow(input.flow_id));
    assertFlowAcceptsMutation(flow);
    if (flow.goal_binding && options.allowOfficialGoal !== true) {
      throw new Error("OFFICIAL_GOAL_REQUIRES_GOAL_VERDICT: verdict_record is legacy/advisory; use goal_verdict");
    }
    const meetingIds = unique(input.meeting_ids ?? []);
    for (const meetingId of meetingIds) {
      const meeting = await this.store.loadMeeting(meetingId);
      if (meeting.flow_id !== flow.flow_id) {
        throw new Error(`meeting_id ${meetingId} does not belong to flow ${flow.flow_id}`);
      }
      assertMeetingClosed(meeting);
    }
    const evidenceIds = input.evidence_ids ?? [];
    const citedEvidence = flow.evidence.filter((evidence) => evidenceIds.includes(evidence.evidence_id));
    const citedCurrentReview = citedEvidence.find((evidence) => isStructuredReviewEvidence(flow, evidence));
    let status = input.status;
    const residualRisks = input.residual_risks ?? [];
    if (status === "pronto" && evidenceIds.length === 0) {
      status = residualRisks.length > 0 ? "pronto_com_ressalvas" : "nao_pronto";
    }
    const now = nowIso();
    const verdict: Verdict = {
      verdict_id: await this.store.nextId("vrd"),
      flow_id: flow.flow_id,
      status,
      rationale: input.rationale,
      evidence_ids: evidenceIds,
      residual_risks: residualRisks,
      review_artifact_path: input.review_artifact_path,
      review_findings: input.review_findings ?? [],
      reviewed_changed_files:
        citedCurrentReview
          ? canonicalChangedFiles(flow.changed_files)
          : undefined,
      reviewed_implementation_fingerprint:
        citedCurrentReview
          ? citedCurrentReview.reviewed_implementation_fingerprint
          : undefined,
      parking_lot: input.parking_lot ?? [],
      gold_mining: input.gold_mining ?? [],
      cooperators: input.cooperators ?? [],
      active_credits: input.active_credits ?? [],
      meeting_ids: meetingIds,
      next_step: input.next_step,
      created_at: now
    };
    const verdictPromotedGold = linkParkingToGold(flow, verdict.parking_lot, "verdict_record", verdict.verdict_id, now);
    verdict.gold_mining = unique([...verdict.gold_mining, ...verdictPromotedGold]);
    flow.verdicts.push(verdict);
    flow.parking_lot = unique([...flow.parking_lot, ...verdict.parking_lot]);
    flow.gold_mining = unique([...flow.gold_mining, ...verdict.gold_mining]);
    flow.cooperators = uniqueCooperators([...flow.cooperators, ...verdict.cooperators]);
    flow.active_credits = unique([...flow.active_credits, ...verdict.active_credits]);
    flow.updated_at = now;
    if (status === "pronto" || status === "pronto_com_ressalvas") {
      // Um veredito positivo autoriza o guard terminal, mas nao substitui a
      // transicao que executa hooks e grava flow_completed em GOAL oficial.
      flow.status = flow.goal_binding ? "active" : "complete";
    }
    flow.history.push({ at: now, type: "verdict_recorded", data: verdict as unknown as Record<string, unknown> });
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "verdict_recorded", verdict as unknown as Record<string, unknown>);
    return presentArtifact(verdict as Verdict & Record<string, unknown>, flow);
  }

  async hygieneScan(flowId?: string): Promise<
    {
      findings: HygieneFinding[];
      blocking_findings: HygieneFinding[];
      blocking_findings_count: number;
      hygiene_blocking: boolean;
      rule: string;
      required_cooperation?: Cooperator[];
    } & Partial<PresentationEnvelope>
  > {
    const findings: HygieneFinding[] = [];
    const flows = flowId ? [await this.store.loadFlow(flowId)] : await this.store.listFlows();
    const root = process.cwd();
    const tasksPath = path.join(root, "TASKS.md");
    const docs = ["README.md", "SPEC.md", "PLAN.md", "TASKS.md", "SPRINTS.md", "REFERENCE.md"];

    for (const flow of flows) {
      if (flow.tasks.length > 0 && flow.evidence.length === 0) {
        findings.push({
          id: `${flow.flow_id}:tasks_without_evidence`,
          severity: "warning",
          category: "evidence",
          message: "Flow possui tasks registradas sem evidencia anexada.",
          evidence: [flow.flow_id],
          action: "Anexar evidencia ou registrar limitacao explicita antes do veredito."
        });
      }
    }

    if (await this.store.pathExists(tasksPath)) {
      const tasks = await readFile(tasksPath, "utf8");
      if (/- \[x\].*(Sprint [1-7]|flow_|MCP)/i.test(tasks) && !/Evid[eê]ncia/i.test(tasks)) {
        findings.push({
          id: "tasks_checked_without_evidence",
          severity: "warning",
          category: "tasks",
          message: "TASKS.md contem itens marcados sem secao de evidencia clara.",
          evidence: ["TASKS.md"],
          action: "Adicionar evidencia ou evitar marcar pronto sem prova registrada."
        });
      }
    }

    for (const doc of docs) {
      const target = path.join(root, doc);
      if (await this.store.pathExists(target)) {
        const text = await readFile(target, "utf8");
        if (/C:\\Users\\|\/Users\/|\/home\//.test(text)) {
          findings.push({
            id: `fixed_path:${doc}`,
            severity: "warning",
            category: "paths",
            message: "Documento contem path local fixo.",
            evidence: [doc],
            action: "Trocar por path relativo ou variavel documentada."
          });
        }
        if (/A confirmar/i.test(text) && /Status\s*\n+.*pronto/i.test(text)) {
          findings.push({
            id: `contradiction:${doc}`,
            severity: "warning",
            category: "docs",
            message: "Documento mistura lacuna 'A confirmar' com status pronto.",
            evidence: [doc],
            action: "Resolver lacuna ou rebaixar status."
          });
        }
      }
    }

    const tempFiles = await collectTempFiles(root);
    if (tempFiles.length > 0) {
      findings.push({
        id: "temporary_files",
        severity: "info",
        category: "temporary_files",
        message: "Arquivos temporarios encontrados.",
        evidence: tempFiles.slice(0, 20),
        action: "Antes de remover, garimpar comandos, evidencias ou memorias uteis; depois descartar temporarios obvios ou justificar artefatos."
      });
    }
    findings.push(...(await scanTrashWithoutGarimpoGate(root, this.store)));
    findings.push(...(await scanOperationalPrinciples(root)));

    const sortedFindings = findings.sort((a, b) => a.id.localeCompare(b.id));
    const blockingFindings = sortedFindings.filter(isMaterialHygieneFinding);
    if (flowId) {
      await this.store.withFlowLock(flowId, async () => {
        const flow = await this.store.loadFlow(flowId);
        if (flowIsTerminal(flow)) {
          return;
        }
        const now = nowIso();
        flow.history.push({
          at: now,
          type: "hygiene_scanned",
          data: {
            findings_count: sortedFindings.length,
            blocking_findings_count: blockingFindings.length,
            blocking_findings: blockingFindings.map((finding) => finding.id)
          }
        });
        flow.updated_at = now;
        await this.store.saveFlow(flow);
        await this.ledger(flow.flow_id, "hygiene_scanned", {
          findings_count: sortedFindings.length,
          blocking_findings_count: blockingFindings.length,
          blocking_findings: blockingFindings.map((finding) => finding.id)
        });
      });
    }

    return {
      findings: sortedFindings,
      blocking_findings: blockingFindings,
      blocking_findings_count: blockingFindings.length,
      hygiene_blocking: blockingFindings.length > 0,
      rule: "barata nunca esta sozinha",
      aliases: {
        estacionamento: [],
        garimpo: []
      },
      display: {
        cooperators: [],
        active_credits: [],
        direct_action: {
          available: sortedFindings.length > 0,
          action: sortedFindings.length > 0 ? "Tratar achados acionaveis antes do veredito" : "Sem achados de higiene"
        }
      },
      suggested_cooperation: [],
      required_cooperation: []
    };
  }

  private async persistFiscalBlock(flow: Flow, fiscal: FiscalPolicyResult, source: string, input: FiscalVerdictInput = {}): Promise<void> {
    const now = nowIso();
    const loopId = blockerLoopId(fiscal.blocking_reasons);
    const loopSignature = blockerSignature(fiscal.blocking_reasons);
    const meetings = await this.store.listMeetings(flow.flow_id);
    const requiredCooperation = {
      ...requiredCooperationDiagnostics(flow, meetings, fiscal.blocking_reasons, input),
      explicit_meeting_trigger: explicitMeetingTrigger(fiscalText(flow, input))
    };
    flow.status = "blocked";
    flow.history.push({
      at: now,
      type: "fiscal_policy_blocked",
      data: {
        source,
        loop_id: loopId,
        loop_signature: loopSignature,
        blocking_reasons: fiscal.blocking_reasons,
        memory_required: fiscal.blocking_reasons.includes("memory_required_but_empty"),
        required_cooperation: fiscal.required_cooperation,
        required_cooperation_diagnostics: requiredCooperation
      }
    });
    flow.updated_at = now;
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "fiscal_policy_blocked", {
      source,
      loop_id: loopId,
      loop_signature: loopSignature,
      blocking_reasons: fiscal.blocking_reasons,
      memory_required: fiscal.blocking_reasons.includes("memory_required_but_empty"),
      required_cooperation: fiscal.required_cooperation,
      required_cooperation_diagnostics: requiredCooperation
    });
  }

  private async persistMemoryMiningVerdictBlock(flow: Flow, memoryMining: Record<string, unknown>, input: FiscalVerdictInput = {}): Promise<void> {
    const now = nowIso();
    const blockers = [MEMORY_MINING_BLOCKED_VERDICT_REASON];
    const loopId = blockerLoopId(blockers);
    const loopSignature = blockerSignature(blockers);
    flow.status = "blocked";
    flow.history.push({
      at: now,
      type: "memory_mining_blocked_verdict",
      data: {
        source: "goal_verdict",
        loop_id: loopId,
        loop_signature: loopSignature,
        blocking_reasons: blockers,
        strong_unwritten_count: numericMemoryField(memoryMining, "strong_unwritten_count"),
        ledger_only_count: numericMemoryField(memoryMining, "ledger_only_count"),
        blocked_count: numericMemoryField(memoryMining, "blocked_count"),
        destination_warnings: Array.isArray(memoryMining.destination_warnings) ? memoryMining.destination_warnings : [],
        edit_queue_count: Array.isArray(memoryMining.edit_queue) ? memoryMining.edit_queue.length : 0,
        next_required_action: memoryMiningBlockedAction(flow, "validacao", countRegressions(flow), false),
        verdict_status: input.status
      }
    });
    flow.updated_at = now;
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "memory_mining_blocked_verdict", {
      source: "goal_verdict",
      loop_id: loopId,
      loop_signature: loopSignature,
      blocking_reasons: blockers,
      strong_unwritten_count: numericMemoryField(memoryMining, "strong_unwritten_count"),
      ledger_only_count: numericMemoryField(memoryMining, "ledger_only_count"),
      blocked_count: numericMemoryField(memoryMining, "blocked_count"),
      destination_warnings: Array.isArray(memoryMining.destination_warnings) ? memoryMining.destination_warnings : [],
      edit_queue_count: Array.isArray(memoryMining.edit_queue) ? memoryMining.edit_queue.length : 0
    }, "goal_verdict");
  }

  async archiveFlow(input: { flow_id: string; reason?: string }): Promise<Flow & PresentationEnvelope> {
    return this.store.withFlowLock(input.flow_id, () => this.archiveFlowUnlocked(input));
  }

  private async archiveFlowUnlocked(input: { flow_id: string; reason?: string }): Promise<Flow & PresentationEnvelope> {
    const flow = await this.store.loadFlow(input.flow_id);
    const completedEvent = [...flow.history].reverse().find((event) => event.type === "flow_completed");
    if (completedEvent) {
      await ensureLedgerTransitionRecorded(this.store, flow, {
        originalType: "flow_completed",
        recoveredType: "flow_completed_recovered",
        originalAt: completedEvent.at,
        data: completedEvent.data
      });
    }
    if (flow.status === "archived") {
      const archivedEvent = [...flow.history].reverse().find((event) => event.type === "flow_archived");
      if (archivedEvent) {
        await ensureLedgerTransitionRecorded(this.store, flow, {
          originalType: "flow_archived",
          recoveredType: "flow_archived_recovered",
          originalAt: archivedEvent.at,
          data: archivedEvent.data
        });
      }
      const archivedBlockedFlow = archivedEvent?.data.archived_blocked_flow === true;
      const preservedBlockers = stringArray(archivedEvent?.data.preserved_blockers);
      const presented = presentFlow(flow);
      if (!archivedBlockedFlow) {
        return presented;
      }
      return {
        ...withDirectAction(
          presented,
          blockedArchiveDirectAction(preservedBlockers.length > 0 ? preservedBlockers : ["flow_blocked_before_archive"])
        ),
        archived_blocked_flow: true,
        preserved_blockers: preservedBlockers
      } as Flow & PresentationEnvelope;
    }
    const wasBlocked = flow.status === "blocked";
    const preservedBlockers = reconciledBlockers(flow, [
      ...latestFiscalBlock(flow).blocking_reasons,
      ...Object.values(flow.gates).flatMap((gate) => (gate?.status === "blocked" ? gate.missing : []))
    ]);
    const archivedBlockedFlow = wasBlocked || preservedBlockers.length > 0;
    const now = nowIso();
    flow.status = "archived";
    flow.archived_at = now;
    flow.updated_at = now;
    flow.history.push({
      at: now,
      type: "flow_archived",
      data: { reason: input.reason ?? "archived", archived_blocked_flow: archivedBlockedFlow, preserved_blockers: preservedBlockers }
    });
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "flow_archived", {
      reason: input.reason ?? "archived",
      archived_blocked_flow: archivedBlockedFlow,
      preserved_blockers: preservedBlockers
    });
    const presented = presentFlow(flow);
    if (!archivedBlockedFlow) {
      return presented;
    }
    return {
      ...withDirectAction(
        presented,
        blockedArchiveDirectAction(preservedBlockers.length > 0 ? preservedBlockers : ["flow_blocked_before_archive"])
      ),
      archived_blocked_flow: archivedBlockedFlow,
      preserved_blockers: preservedBlockers
    } as Flow & PresentationEnvelope;
  }

  private async findGoalFlowByIdempotencyKey(idempotencyKey: string): Promise<Flow | undefined> {
    const flows = await this.store.listFlows();
    const matches = flows.filter((flow) => flow.goal_binding?.envelope.idempotency_key === idempotencyKey);
    if (matches.length > 1) {
      throw new GoalIdempotencyDuplicateBindingsError(matches.map((flow) => flow.flow_id));
    }
    return matches[0];
  }

  private async resolveGoalFlow(input: { flow_id?: string; idempotency_key?: string }): Promise<Flow> {
    if (input.flow_id) {
      return this.store.loadFlow(input.flow_id);
    }
    if (input.idempotency_key) {
      const flow = await this.findGoalFlowByIdempotencyKey(input.idempotency_key);
      if (flow) {
        return flow;
      }
      throw new Error(`No flow found for idempotency_key: ${input.idempotency_key}`);
    }
    throw new Error("flow_id or idempotency_key is required");
  }

  private async runPipelineItem(input: {
    pipelineId: string;
    index: number;
    item: PipelineItem;
    autoMemoryMining: boolean;
  }): Promise<PipelineFlowResult> {
    let flowId: string | undefined;
    try {
      const item = normalizePipelineItem(input.item, input.index);
      const created = await this.createFlow({
        goal: item.goal,
        owner: "mm_pipeline_run",
        context: item.context,
        scope: { in: item.scope_in, out: item.scope_out },
        risks: item.risks,
        uncertainties: item.uncertainties
      });
      flowId = created.flow_id;
      await this.ledger(
        flowId,
        "pipeline_item_started",
        {
          pipeline_id: input.pipelineId,
          index: input.index,
          goal: item.goal,
          stop_contract: "gate_failure_blocks_or_marks_pending"
        },
        "mm_pipeline_run"
      );
      await this.updateFlowFacts(flowId, {
        scope: { in: item.scope_in, out: item.scope_out },
        tasks: item.tasks,
        done_criteria: item.done_criteria,
        expected_evidence: item.expected_evidence,
        changed_files: item.changed_files,
        decisions: [`pipeline:${input.pipelineId}:item:${input.index + 1}`]
      });

      let advanced = await this.advance({ flow_id: flowId, actor: "mm_pipeline_run" });
      if (isBlockedAdvance(advanced)) {
        return this.pipelineBlocked(input.pipelineId, input.index, item.goal, flowId, advanced);
      }
      advanced = await this.advance({ flow_id: flowId, actor: "mm_pipeline_run" });
      if (isBlockedAdvance(advanced)) {
        return this.pipelineBlocked(input.pipelineId, input.index, item.goal, flowId, advanced);
      }

      const evidence = await this.attachEvidence({
        flow_id: flowId,
        kind: "pipeline_evidence",
        title: `Pipeline evidence ${input.index + 1}`,
        content: pipelineEvidenceText(item),
        note: "Evidence declared by mm_pipeline_run input; external build/code execution must be attached separately when required."
      });

      advanced = await this.advance({
        flow_id: flowId,
        actor: "mm_pipeline_run",
        provided: { implementation_done: true }
      });
      if (isBlockedAdvance(advanced)) {
        return this.pipelineBlocked(input.pipelineId, input.index, item.goal, flowId, advanced);
      }
      advanced = await this.advance({
        flow_id: flowId,
        actor: "mm_pipeline_run",
        provided: {
          diff_reviewed: true,
          barata_scan: true,
          regression_risks: item.residual_risks.length > 0 ? item.residual_risks : ["pipeline item reviewed for repeated gate failure patterns"]
        }
      });
      if (isBlockedAdvance(advanced)) {
        return this.pipelineBlocked(input.pipelineId, input.index, item.goal, flowId, advanced);
      }
      advanced = await this.advance({
        flow_id: flowId,
        actor: "mm_pipeline_run",
        provided: { test_executed: true }
      });
      if (isBlockedAdvance(advanced)) {
        return this.pipelineBlocked(input.pipelineId, input.index, item.goal, flowId, advanced);
      }

      const verdict = await this.recordVerdict({
        flow_id: flowId,
        status: "pronto",
        rationale: "Pipeline item completed all PPIRTV gates with declared pipeline evidence.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: item.residual_risks,
        parking_lot: item.verdict_parking_lot,
        gold_mining: item.verdict_gold_mining,
        next_step: "continue_pipeline_or_archive"
      });
      let memoryMining: Record<string, unknown> | null = null;
      if (input.autoMemoryMining) {
        memoryMining = await this.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "auto_write" });
        if (memoryMining.blocked_verdict === true) {
          await this.markPipelineBlocked(flowId, input.pipelineId, input.index, "memory_mining_blocked_verdict");
          return {
            index: input.index,
            goal: item.goal,
            flow_id: flowId,
            phase: (await this.store.loadFlow(flowId)).phase,
            status: "bloqueado",
            blocker: "MEMORY_MINING_BLOCKED_VERDICT",
            verdict_id: verdict.verdict_id,
            evidence_ids: [evidence.evidence_id],
            memory_mining: memoryMining
          };
        }
      }
      const residualRisksForGate = item.residual_risks.length > 0 ? item.residual_risks : ["sem risco residual material informado"];
      advanced = await this.advance({
        flow_id: flowId,
        actor: "mm_pipeline_run",
        provided: {
          residual_risks: residualRisksForGate,
          next_step: "continue_pipeline_or_archive"
        },
        evidence_ids: [evidence.evidence_id]
      });
      if (isBlockedAdvance(advanced)) {
        return this.pipelineBlocked(input.pipelineId, input.index, item.goal, flowId, advanced);
      }
      await this.ledger(
        flowId,
        "pipeline_item_completed",
        {
          pipeline_id: input.pipelineId,
          index: input.index,
          verdict_id: verdict.verdict_id,
          status: verdict.status,
          evidence_ids: [evidence.evidence_id],
          auto_memory_mining: input.autoMemoryMining
        },
        "mm_pipeline_run"
      );
      return {
        index: input.index,
        goal: item.goal,
        flow_id: flowId,
        status: verdict.status,
        phase: (await this.store.loadFlow(flowId)).phase,
        verdict_id: verdict.verdict_id,
        evidence_ids: [evidence.evidence_id],
        memory_mining: memoryMining
      };
    } catch (error) {
      const blocker = error instanceof Error ? error.message : String(error);
      if (flowId) {
        await this.markPipelineBlocked(flowId, input.pipelineId, input.index, blocker);
      }
      return {
        index: input.index,
        goal: input.item.goal || `pipeline item ${input.index + 1}`,
        flow_id: flowId,
        phase: flowId ? (await this.store.loadFlow(flowId)).phase : undefined,
        status: "bloqueado",
        blocker
      };
    }
  }

  private async pipelineBlocked(
    pipelineId: string,
    index: number,
    goal: string,
    flowId: string,
    advanceResult: Record<string, unknown> & Partial<PresentationEnvelope>
  ): Promise<PipelineFlowResult> {
    const blocker = pipelineBlocker(advanceResult);
    await this.markPipelineBlocked(flowId, pipelineId, index, blocker);
    return {
      index,
      goal,
      flow_id: flowId,
      phase: (await this.store.loadFlow(flowId)).phase,
      status: "bloqueado",
      blocker
    };
  }

  private async markPipelineBlocked(flowId: string, pipelineId: string, index: number, blocker: string): Promise<void> {
    const flow = await this.store.loadFlow(flowId);
    const now = nowIso();
    flow.status = "blocked";
    flow.updated_at = now;
    flow.history.push({
      at: now,
      type: "pipeline_item_blocked",
      data: { pipeline_id: pipelineId, index, blocker }
    });
    await this.store.saveFlow(flow);
    await this.ledger(flowId, "pipeline_item_blocked", { pipeline_id: pipelineId, index, blocker }, "mm_pipeline_run");
  }

  private async ledger(flowId: string, type: string, data: Record<string, unknown>, actor = "codex"): Promise<void> {
    await this.store.appendLedger({
      event_id: await this.store.nextId("evt"),
      flow_id: flowId,
      type,
      timestamp: nowIso(),
      actor,
      data
    });
  }
}

type NormalizedPipelineItem = {
  goal: string;
  context: string;
  scope_in: string[];
  scope_out: string[];
  tasks: string[];
  done_criteria: string[];
  expected_evidence: string[];
  risks: string[];
  uncertainties: string[];
  changed_files: string[];
  evidence: string[];
  residual_risks: string[];
  verdict_parking_lot: string[];
  verdict_gold_mining: string[];
};

function normalizePipelineItem(item: PipelineItem, index: number): NormalizedPipelineItem {
  requireText(item.goal, `pipeline[${index}].goal`);
  assertNoSecretLikeText(item.goal, `pipeline[${index}].goal`);
  assertNoSecretLikeText(item.context, `pipeline[${index}].context`);
  const scopeIn = unique(item.scope_in ?? []);
  const scopeOut = unique(item.scope_out ?? []);
  const tasks = unique(item.tasks ?? []);
  const doneCriteria = unique(item.done_criteria ?? []);
  const expectedEvidence = unique(item.expected_evidence ?? []);
  const changedFiles = unique(item.changed_files?.length ? item.changed_files : scopeIn);
  const evidence = unique(item.evidence?.length ? item.evidence : expectedEvidence);
  const residualRisks = unique(item.residual_risks ?? []);
  const verdictParkingLot = unique(item.verdict_parking_lot ?? []);
  const verdictGoldMining = unique(item.verdict_gold_mining ?? []);
  const risks = unique(
    item.risks?.length
      ? item.risks
      : ["Automacao de pipeline nao substitui evidencia externa quando a tarefa exigir execucao real."]
  );
  const uncertainties = unique(
    item.uncertainties?.length
      ? item.uncertainties
      : ["mm_pipeline_run orquestra gates PPIRTV; execucao externa deve ser anexada como evidencia quando existir."]
  );
  assertNoSecretLikeItems(
    [
      ...scopeIn,
      ...scopeOut,
      ...tasks,
      ...doneCriteria,
      ...expectedEvidence,
      ...changedFiles,
      ...evidence,
      ...risks,
      ...uncertainties,
      ...residualRisks,
      ...verdictParkingLot,
      ...verdictGoldMining
    ],
    `pipeline[${index}]`
  );
  return {
    goal: item.goal.trim(),
    context: item.context?.trim() || `Pipeline item ${index + 1}: ${item.goal.trim()}`,
    scope_in: scopeIn,
    scope_out: scopeOut,
    tasks,
    done_criteria: doneCriteria,
    expected_evidence: expectedEvidence,
    risks,
    uncertainties,
    changed_files: changedFiles,
    evidence,
    residual_risks: residualRisks,
    verdict_parking_lot: verdictParkingLot,
    verdict_gold_mining: verdictGoldMining
  };
}

function pipelineEvidenceText(item: NormalizedPipelineItem): string {
  return [
    `Goal: ${item.goal}`,
    "",
    "Scope in:",
    ...item.scope_in.map((entry) => `- ${entry}`),
    "",
    "Tasks:",
    ...item.tasks.map((entry) => `- ${entry}`),
    "",
    "Expected evidence declared:",
    ...item.expected_evidence.map((entry) => `- ${entry}`),
    "",
    "Done criteria:",
    ...item.done_criteria.map((entry) => `- ${entry}`),
    "",
    "Pipeline evidence:",
    ...(item.evidence.length > 0 ? item.evidence.map((entry) => `- ${entry}`) : ["- no extra evidence declared"])
  ].join("\n");
}

function isBlockedAdvance(result: Record<string, unknown>): boolean {
  return result.advanced === false || result.status === "blocked";
}

function pipelineBlocker(result: Record<string, unknown>): string {
  const missing = Array.isArray(result.missing) ? result.missing.join(", ") : "";
  const next = typeof result.next === "string" ? result.next : "complete_current_gate";
  return missing ? `${next}: ${missing}` : next;
}

function resolveSptPath(workspace: string, sptPath: string): string {
  return path.resolve(path.isAbsolute(sptPath) ? sptPath : path.join(workspace, sptPath));
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSensitivePath(target: string): boolean {
  return path
    .resolve(target)
    .split(path.sep)
    .some((segment) => /^\.env(?:\.|$)/i.test(segment));
}

function normalizeComparable(text: string): string {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  return normalize(text);
}

function normalizeGoalEnvelope(input: GoalEnvelope): CanonicalGoalEnvelope {
  requireText(input.workspace, "workspace");
  requireText(input.spt_path, "spt_path");
  requireText(input.objective, "objective");
  requireText(input.idempotency_key, "idempotency_key");
  requireText(input.source, "source");
  const workspace = path.resolve(input.workspace);
  return {
    workspace,
    spt_path: resolveSptPath(workspace, input.spt_path),
    objective: input.objective.trim(),
    flow_id: input.flow_id,
    idempotency_key: input.idempotency_key.trim(),
    evidence_required: Boolean(input.evidence_required),
    required_evidence: unique(input.required_evidence ?? []),
    requested_verdict_policy: input.requested_verdict_policy,
    source: input.source.trim(),
    // P2b (hardening): validar mode e risk_level na borda. Rejeitar valores
    // invalidos em vez de passar cru para o store (Zod do MCP protege, mas
    // chamadas diretas ao engine precisam do mesmo guard).
    mode: canonicalPhaseMode(input.mode),
    risk_level: input.risk_level && ["high", "medium", "low", "mechanical"].includes(input.risk_level) ? input.risk_level : undefined,
    flow_role: canonicalGoalFlowRole(input.flow_role)
  };
}

function canonicalPhaseMode(mode: GoalEnvelope["mode"]): "full" | "compact" | undefined {
  if (mode === "lean") {
    return "compact";
  }
  return mode === "full" || mode === "compact" ? mode : undefined;
}

function canonicalGoalFlowRole(role: GoalEnvelope["flow_role"]): GoalFlowRole | undefined {
  if (role === undefined) {
    return undefined;
  }
  if (GOAL_FLOW_ROLES.includes(role)) {
    return role;
  }
  throw new Error(`flow_role must be one of: ${GOAL_FLOW_ROLES.join(", ")}`);
}

function mutationStatusDetail(_flow: Flow, requested?: "lean" | "compact" | "full"): "lean" | "compact" | "full" {
  return requested ?? "lean";
}

function effectiveFlowStatus(flow: Flow, blockers: string[]): Flow["status"] {
  if (flow.status === "complete" || flow.status === "archived") {
    return flow.status;
  }
  return blockers.length > 0 ? "blocked" : "active";
}

function phaseAdvanceAllowed(flow: Flow, phaseBlockers: string[], closureBlockers: string[] = []): boolean {
  if (flow.status === "complete" || flow.status === "archived" || phaseBlockers.length > 0) {
    return false;
  }
  return profileFor(flow.mode).nextPhase[flow.phase] !== null || closureBlockers.length === 0;
}

function closureBlockersFor(flow: Flow, meetings: Meeting[]): string[] {
  const fiscal = evaluateFiscalPolicy(flow);
  const persistedFiscal = latestFiscalBlock(flow);
  const latestVerdict = flow.verdicts.at(-1);
  const terminalVerdictBlockers =
    flow.goal_binding &&
    profileFor(flow.mode).nextPhase[flow.phase] === null &&
    latestVerdict &&
    latestVerdict.status !== "pronto" &&
    latestVerdict.status !== "pronto_com_ressalvas"
      ? ["goal_positive_verdict_required"]
      : [];
  const blockers = reconciledBlockers(flow, [
    ...fiscal.blocking_reasons,
    ...persistedFiscal.blocking_reasons,
    ...memoryMiningVerdictBlockers(flow),
    ...terminalVerdictBlockers
  ]);
  return requiredCooperationNeedsMeetingIdRetry(flow, meetings)
    ? unique([...blockers, "required_cooperation"])
    : blockers;
}

function assertCompatibleGoalBinding(
  binding: GoalBinding | undefined,
  envelope: GoalEnvelope,
  contractFingerprint: string | null
): void {
  if (!binding) {
    return;
  }
  const existing = binding.envelope;
  if (existing.idempotency_key !== envelope.idempotency_key) {
    throw new Error("flow_id is already bound to a different idempotency_key");
  }
  if (path.resolve(existing.workspace) !== path.resolve(envelope.workspace) || path.resolve(existing.spt_path) !== path.resolve(envelope.spt_path)) {
    throw new Error("idempotency_key is already bound to a different workspace or spt_path");
  }
  const mismatches: string[] = [];
  if (normalizeComparable(existing.objective) !== normalizeComparable(envelope.objective)) {
    mismatches.push("objective");
  }
  if (existing.evidence_required !== envelope.evidence_required) {
    mismatches.push("evidence_required");
  }
  if (!sameStringSet(existing.required_evidence, envelope.required_evidence)) {
    mismatches.push("required_evidence");
  }
  if (existing.requested_verdict_policy !== envelope.requested_verdict_policy) {
    mismatches.push("requested_verdict_policy");
  }
  if (existing.source !== envelope.source) {
    mismatches.push("source");
  }
  if (envelope.risk_level !== undefined && existing.risk_level !== envelope.risk_level) {
    mismatches.push("risk_level");
  }
  if (envelope.flow_role !== undefined && binding.flow_role !== envelope.flow_role) {
    mismatches.push("flow_role");
  }
  if (!binding.spt_contract_fingerprint || !contractFingerprint) {
    mismatches.push("spt_contract_fingerprint");
  } else if (binding.spt_contract_fingerprint !== contractFingerprint) {
    mismatches.push("spt_contract");
  }
  if (mismatches.length > 0) {
    throw new Error(`GOAL_BINDING_MISMATCH: immutable binding differs in ${mismatches.join(", ")}`);
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function goalLedgerData(binding: GoalBinding, flow?: Flow): Record<string, unknown> {
  return {
    workspace: binding.envelope.workspace,
    spt_path: binding.envelope.spt_path,
    objective: binding.envelope.objective,
    flow_id: binding.envelope.flow_id,
    idempotency_key: binding.envelope.idempotency_key,
    evidence_required: binding.envelope.evidence_required,
    required_evidence: binding.envelope.required_evidence,
    requested_verdict_policy: binding.envelope.requested_verdict_policy,
    source: binding.envelope.source,
    flow_role: binding.flow_role,
    goal_id: binding.goal_id,
    spt_contract_fingerprint: binding.spt_contract_fingerprint,
    spt_document_sha256_at_start: binding.spt_document_sha256_at_start,
    tasks: flow?.tasks ?? [],
    expected_evidence: flow?.expected_evidence ?? binding.envelope.required_evidence,
    done_criteria: flow?.done_criteria ?? []
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiresGoalEvidence(flow: Flow): boolean {
  const envelope = flow.goal_binding?.envelope;
  return envelope?.requested_verdict_policy === "evidence_required" || envelope?.evidence_required === true;
}

function assertGoalBinding(flow: Flow): void {
  if (!flow.goal_binding) {
    throw new Error(`Flow ${flow.flow_id} is not bound to an official GOAL. Call goal_start first.`);
  }
}

function assertFlowAcceptsMutation(flow: Flow): void {
  if (flowIsTerminal(flow)) {
    throw new Error(`FLOW_IMMUTABLE_AFTER_COMPLETION: ${flow.flow_id} is ${flow.status}`);
  }
}

function flowIsTerminal(flow: Flow): boolean {
  return flow.status === "archived" || flow.history.some((event) => event.type === "flow_completed");
}

function nextGoalStep(flow: Flow, gate: GateRecord): string {
  if (flow.status === "archived") {
    return "flow_archived";
  }
  if (gate.status === "blocked") {
    return gate.next;
  }
  if (flow.status === "complete") {
    return "flow_complete_review_or_archive";
  }
  return gate.next;
}

function assertNoSecretLikePayload(value: unknown, field: string): void {
  if (typeof value === "string") {
    assertNoSecretLikeText(value, field);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLikePayload(item, `${field}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      assertNoSecretLikePayload(nested, `${field}.${key}`);
    }
  }
}

function assertNoSecretLikeItems(values: string[], field: string): void {
  for (const value of values) {
    assertNoSecretLikeText(value, field);
  }
}

function parsedValidationItems(validation: SptValidationResult): string[] {
  return [...validation.tasks, ...validation.expected_evidence, ...validation.done_criteria];
}

async function scanTrashWithoutGarimpoGate(root: string, store: PpirtvStore): Promise<HygieneFinding[]> {
  const lixeiraPath = path.join(root, ".agents", "LIXEIRA.md");
  if (!(await store.pathExists(lixeiraPath))) {
    return [];
  }
  const text = await readFile(lixeiraPath, "utf8");
  const hasContentBeyondTitle = text
    .split(/\r?\n/)
    .some((line) => line.trim().length > 0 && !/^#\s*Lixeira/i.test(line.trim()));
  if (!hasContentBeyondTitle || /garimpo|garimp|ouro|Nao podemos jogar ouro no lixo/i.test(text)) {
    return [];
  }
  return [
    {
      id: "hygiene:lixeira_without_garimpo_gate",
      severity: "warning",
      category: "docs",
      message: "LIXEIRA.md tem conteudo sem gate explicito de garimpo antes do descarte.",
      evidence: [".agents/LIXEIRA.md"],
      action: "Registrar que aprendizados, evidencias e memorias uteis foram garimpados antes de manter o item na lixeira."
    }
  ];
}

function hasRequirement(flow: Flow, key: string, source: GateRequirement["source"], provided: Record<string, unknown>): boolean {
  return resolveGateRequirements({
    flow,
    requirements: [{ key, label: key, source }],
    provided,
    canonicalVerdictRequired: officialGoalNeedsCanonicalVerdict(flow)
  })[0]?.satisfied === true;
}

function officialGoalNeedsCanonicalVerdict(flow: Flow, phase: AnyPhase = flow.phase): boolean {
  return Boolean(flow.goal_binding && phase === "validacao" && flow.verdicts.length === 0);
}

function evaluateFiscalPolicy(flow: Flow, input: FiscalVerdictInput = {}): FiscalPolicyResult {
  const material = fiscalMateriality(flow, input);
  const blockingReasons: string[] = [];
  if (!material) {
    return fiscalResult(false, []);
  }

  if (memoryRequiredByFlow(flow, input) && noMemoryWasPromoted(flow, input.memory_mining)) {
    blockingReasons.push("memory_required_but_empty");
  }
  if (hasHygieneBlocking(flow)) {
    blockingReasons.push("hygiene_blocking");
  }
  if (codeReviewRequired(flow, input) && !hasReviewEvidence(flow, input)) {
    blockingReasons.push("review_required");
  }
  if (librarianRequired(flow, input) && latestLibrarianStatus(flow)?.status !== "recalled") {
    blockingReasons.push("librarian_status");
  }
  if (recurringRisk(input) && regressLimitReached(flow, input)) {
    blockingReasons.push("attempt_regress_count");
  } else if (recurringRisk(input) && !hasEnoughAttempts(flow, input)) {
    blockingReasons.push("attempt_regress_count");
  }
  if (requiredCooperationRequired(flow, input, blockingReasons)) {
    blockingReasons.unshift("required_cooperation");
  }

  return fiscalResult(true, unique(blockingReasons));
}

function fiscalResult(material: boolean, blockingReasons: string[]): FiscalPolicyResult {
  const meetingRequired = blockingReasons.includes("required_cooperation");
  return {
    material,
    blocking_reasons: blockingReasons,
    required_cooperation: blockingReasons.includes("required_cooperation") ? requiredCoo(blockingReasons) : [],
    meeting_policy: {
      required: meetingRequired,
      rotation: [
        "ancora-fluxo",
        "chato",
        "questionador",
        "entrevista-me",
        "reuniao",
        "garimpeiro",
        "dex-memoria",
        "estacionamento",
        "sprinter",
        "mapeador-implementacao",
        "duda-dev",
        "revisor-codigo",
        "tio-testador",
        "validador-pronto"
      ],
      repertoire: [
        "E SE falhar?",
        "pra que?",
        "por que?",
        "onde nasce?",
        "qual origem?",
        "qual destino?",
        "qual gatilho?",
        "precisa lembrar disso?",
        "qual saida ainda nao foi tentada?",
        "qual ponto cego esta sendo protegido pelo plano atual?",
        "estamos seguindo nossos principios?"
      ],
      objective: "rotacionar integrantes, provocar desvios uteis, procurar pontos cegos e recomendar regresso/fase correta antes de veredito positivo"
    },
    direct_action:
      blockingReasons.length > 0
        ? `resolver_blockers_fiscais: ${blockingReasons.join(", ")}`
        : "fiscal_policy_clear"
  };
}

function requiredCoo(reasonInput: string | string[]): Cooperator[] {
  const blockingReasons = Array.isArray(reasonInput) ? reasonInput : [];
  const fallbackReason = Array.isArray(reasonInput) ? "modo fiscal PPIRTV exige mesa COO material por fase" : reasonInput;
  return [
    "ancora-fluxo",
    "chato",
    "questionador",
    "entrevista-me",
    "garimpeiro",
    "dex-memoria",
    "estacionamento",
    "reuniao",
    "sprinter",
    "duda-dev",
    "mapeador-implementacao",
    "revisor-codigo",
    "tio-testador",
    "validador-pronto"
  ].map((name) => ({ name, reason: cooReason(name, blockingReasons, fallbackReason), material: true }));
}

function cooReason(name: string, blockers: string[], fallbackReason: string): string {
  if (name === "revisor-codigo" && blockers.includes("review_required")) {
    return "obrigatorio por review_required: mudanca/risco de codigo exige artefato ou achados de revisao";
  }
  if ((name === "garimpeiro" || name === "dex-memoria") && blockers.some((blocker) => ["memory_required_but_empty", MEMORY_MINING_BLOCKED_VERDICT_REASON].includes(blocker))) {
    return "obrigatorio por memory_required_but_empty/memory_mining_blocked_verdict: garimpar pepitas, classificar memoria L1/L2 e dar destino a candidatos fortes antes de veredito positivo";
  }
  if ((name === "reuniao" || name === "sprinter") && blockers.includes("required_cooperation")) {
    return "obrigatorio por required_cooperation: ressalva material exige reuniao material e trilho/regresso definido";
  }
  if (name === "tio-testador" && blockers.some((blocker) => ["hygiene_blocking", "review_required", "attempt_regress_count"].includes(blocker))) {
    return "obrigatorio por risco de teste/evidencia: provar comportamento antes de qualquer positivo";
  }
  if (name === "validador-pronto") {
    return "obrigatorio antes de qualquer veredito positivo: conferir blockers fiscais e evidencias coerentes";
  }
  if (name === "ancora-fluxo") {
    return "obrigatorio para regresso correto: apontar fase, retorno e proxima acao quando houver bloqueio";
  }
  if (name === "chato" || name === "questionador" || name === "entrevista-me") {
    return "obrigatorio para perguntas de pressao: E SE, pra que, por que, onde, quando, quanto e estamos seguindo os principios?";
  }
  if (name === "estacionamento") {
    return "obrigatorio para registrar saidas nao tentadas, pendencias e pontos cegos sem sumir com contexto";
  }
  if (name === "duda-dev" || name === "mapeador-implementacao") {
    return "obrigatorio para ligar o bloqueio ao contrato, classe/grupo/secao e impacto implementavel";
  }
  return fallbackReason;
}

function fiscalMateriality(flow: Flow, input: FiscalVerdictInput): boolean {
  if (!flow.goal_binding) {
    return false;
  }
  // Fast-track: mechanical risk (text/doc/refs updates) skips fiscal material
  if (flow.goal_binding.envelope.risk_level === "mechanical") {
    return false;
  }
  const text = fiscalText(flow, input);
  return (
    input.status === "pronto_com_ressalvas" ||
    materialRiskText(text) ||
    memoryRequiredByFlow(flow, input) ||
    codeReviewRequired(flow, input) ||
    hasHygieneBlocking(flow) ||
    recurringRisk(input) ||
    latestLibrarianStatus(flow)?.status === "failed"
  );
}

function fiscalText(flow: Flow, input: FiscalVerdictInput): string {
  return [
    flow.goal,
    flow.context,
    ...flow.risks,
    ...flow.uncertainties,
    ...flow.tasks,
    ...flow.expected_evidence,
    ...flow.done_criteria,
    ...flow.changed_files,
    input.rationale,
    input.next_step,
    ...(input.residual_risks ?? []),
    ...(input.review_findings ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}

function memoryIntentText(flow: Flow, input: FiscalVerdictInput): string {
  const envelope = flow.goal_binding?.envelope;
  const generatedProvenanceContext = envelope
    ? `GOAL/SPT via dex-code. Workspace: ${envelope.workspace}. SPT: ${envelope.spt_path}.`
    : null;
  const semanticContext = flow.context === generatedProvenanceContext ? "" : flow.context;

  return [
    flow.goal,
    semanticContext,
    ...flow.risks,
    ...flow.uncertainties,
    ...flow.tasks,
    ...flow.expected_evidence,
    ...flow.done_criteria,
    input.rationale,
    input.next_step,
    ...(input.residual_risks ?? []),
    ...(input.review_findings ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}

function materialRiskText(text: string): boolean {
  return /(risco material|risco de produto|regress|erro recorrente|falh|bloque|sem reuniao|sem reunião|sem revisor|sem memoria|sem memória|bibliotecario|bibliotecário|graphify|hygiene|codigo|código|mudanca de codigo|mudança de código|principios|princípios)/i.test(text);
}

function requiredCooperationRequired(flow: Flow, input: FiscalVerdictInput, blockingReasons: string[]): boolean {
  return requiredCooperationStillActive(flow, input);
}

function explicitMeetingTrigger(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized
    .split(/[\r\n.;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => positiveMeetingTrigger(segment) && !negativeMeetingTrigger(segment));
}

function negativeMeetingTrigger(text: string): boolean {
  return (
    /(required_cooperation|meeting_id|participantes insuficientes).{0,80}(nao se aplica|nao e necessario|nao ha|required false|opcional|sem necessidade|nao ocorreu)/i.test(text) ||
    /(nao se aplica|nao e necessario|nao ha|opcional|sem necessidade|nao ocorreu).{0,80}(required_cooperation|meeting_id|participantes insuficientes)/i.test(text)
  );
}

function positiveMeetingTrigger(text: string): boolean {
  return /(sem reuniao|reuniao obrigatoria|reuniao material|mesa material|cooperacao material|divergente\/convergente\/transversal|sem meeting_id|required_cooperation (obrigator|exig|missing|falt|pendente)|participantes insuficientes)/i.test(text);
}

function requiredCooperationStillActive(flow: Flow, input: FiscalVerdictInput = {}): boolean {
  if (explicitMeetingTrigger(fiscalText(flow, input))) {
    return true;
  }
  if (requiredCooperationMeetingIdMissingForPositiveVerdict(flow, input)) {
    return true;
  }
  if (hasClosedMeetingSatisfying(flow, input, "required_cooperation")) {
    return false;
  }
  return requiredCooperationMeetingSignal(flow);
}

function requiredCooperationMeetingIdMissingForPositiveVerdict(flow: Flow, input: FiscalVerdictInput): boolean {
  if ((input.status !== "pronto" && input.status !== "pronto_com_ressalvas") || inputMeetingIds(input).length > 0) {
    return false;
  }
  return flow.history.some(
    (event, index) =>
      event.type === "meeting_closed" &&
      event.data.participants_minimum_satisfied !== false &&
      truthy(event.data.decision) &&
      stringArray(event.data.satisfies_blockers).includes("required_cooperation") &&
      !hasVerdictRecordedAfterIndex(flow, index)
  );
}

function requiredCooperationMeetingSignal(flow: Flow): boolean {
  const latestBlock = latestFiscalBlockEvent(flow);
  const latest = latestBlock?.event.data.required_cooperation_diagnostics as Record<string, unknown> | undefined;
  if (!latestBlock) {
    return false;
  }
  if (flow.history.slice(latestBlock.index + 1).some((event) => event.type === "verdict_recorded")) {
    return false;
  }
  if (latest?.explicit_meeting_trigger === true && !explicitMeetingTriggerClearedByFactsUpdate(flow, latestBlock.index)) {
    return true;
  }
  return (
    hasOpenRequiredCooperationMeetingSignal(flow, stringArray(latest?.open_meeting_ids)) ||
    hasInsufficientRequiredCooperationMeetingSignal(flow, stringArray(latest?.insufficient_meeting_ids))
  );
}

function historyAfter(flow: Flow, index: number): Flow["history"] {
  return flow.history.slice(index + 1);
}

function explicitMeetingTriggerClearedByFactsUpdate(flow: Flow, latestBlockIndex: number): boolean {
  if (explicitMeetingTrigger(fiscalText(flow, {}))) {
    return false;
  }
  return historyAfter(flow, latestBlockIndex).some(
    (event) =>
      event.type === "flow_facts_updated" &&
      Object.keys(event.data).some((key) => ["context", "risks", "uncertainties", "tasks", "done_criteria", "expected_evidence", "decisions", "scope"].includes(key))
  );
}

function hasOpenRequiredCooperationMeetingSignal(flow: Flow, meetingIds: string[]): boolean {
  return liveOpenMeetingIds(flow).some((meetingId) => meetingIds.includes(meetingId));
}

function hasInsufficientRequiredCooperationMeetingSignal(flow: Flow, meetingIds: string[]): boolean {
  return flow.history.some(
    (event) =>
      event.type === "meeting_closed" &&
      meetingIds.includes(String(event.data.meeting_id ?? "")) &&
      event.data.participants_minimum_satisfied === false
  );
}

function liveOpenMeetingIds(flow: Flow): string[] {
  const opened = flow.history
    .filter((event) => event.type === "meeting_opened")
    .map((event) => String(event.data.meeting_id ?? ""))
    .filter(Boolean);
  const closed = new Set(
    flow.history
      .filter((event) => event.type === "meeting_closed")
      .map((event) => String(event.data.meeting_id ?? ""))
      .filter(Boolean)
  );
  return opened.filter((meetingId) => !closed.has(meetingId));
}

function memoryRequiredByFlow(flow: Flow, input: FiscalVerdictInput = {}): boolean {
  return (
    flow.history.some(
      (event) =>
        event.type === "fiscal_policy_blocked" &&
        (event.data.memory_required === true || stringArray(event.data.blocking_reasons).includes("memory_required_but_empty"))
    ) ||
    /(memoria|memória|\bL[123]\b|lembranca|lembrança|aprendizado reutilizavel|aprendizado reutilizável|garimpo|pepita)/i.test(memoryIntentText(flow, input))
  );
}

function noMemoryWasPromoted(flow: Flow, memoryMining?: Record<string, unknown> | null): boolean {
  const status = memoryMining ?? flow.memory_mining;
  const writtenCount = typeof status?.written_count === "number" ? status.written_count : 0;
  if (writtenCount > 0) {
    return !memoryMiningStructurallyPromoted(status);
  }
  const candidatesCount = typeof status?.candidates_count === "number" ? status.candidates_count : 0;
  const candidates = Array.isArray(status?.candidates) ? status.candidates : [];
  const editQueue = Array.isArray(status?.edit_queue) ? status.edit_queue : [];
  const effectiveCandidatesCount = Math.max(candidatesCount, candidates.length, editQueue.length);
  if (effectiveCandidatesCount > 0) {
    return candidates.length === 0;
  }
  // Se a mineracao ja foi executada e terminou vazia, nao ha candidato para
  // escrever nem candidate_id para resolver. O blocker de "memoria vazia" so
  // faz sentido antes da mineracao ou quando existe residuo real.
  if (memoryMiningCompletedWithNoCandidates(status)) {
    return false;
  }
  // Compatibilidade com estados antigos de classify_only sem todos os campos.
  // O blocker de "memoria vazia" so faz sentido quando a mineracao ainda
  // nao rodou ou quando existe strong_unwritten aguardando decisao.
  const miningRan = typeof status?.last_run_at === "string" && status.last_run_at.length > 0;
  const writePolicy = typeof status?.write_policy === "string" ? status.write_policy : "";
  const strongUnwrittenCount = typeof status?.strong_unwritten_count === "number" ? status.strong_unwritten_count : 0;
  if (miningRan && writePolicy === "classify_only" && strongUnwrittenCount === 0) {
    return false;
  }
  return true;
}

function memoryMiningCompletedWithNoCandidates(memoryMining: Record<string, unknown> | MemoryMiningSummary | undefined | null): boolean {
  if (!memoryMining) {
    return false;
  }
  const miningRan = typeof memoryMining.last_run_at === "string" && memoryMining.last_run_at.length > 0;
  const candidates = Array.isArray(memoryMining.candidates) ? memoryMining.candidates : [];
  const editQueue = Array.isArray(memoryMining.edit_queue) ? memoryMining.edit_queue : [];
  return (
    miningRan &&
    numericMemoryField(memoryMining, "candidates_count") === 0 &&
    candidates.length === 0 &&
    numericMemoryField(memoryMining, "written_count") === 0 &&
    numericMemoryField(memoryMining, "strong_unwritten_count") === 0 &&
    numericMemoryField(memoryMining, "blocked_count") === 0 &&
    numericMemoryField(memoryMining, "write_failures_count") === 0 &&
    editQueue.length === 0 &&
    !memoryPostWriteValidationBlocks(memoryMining.memory_post_write_validation as MemoryPostWriteValidation | undefined | null)
  );
}

function memoryMiningStructurallyPromoted(memoryMining: Record<string, unknown> | MemoryMiningSummary | undefined | null): boolean {
  if (!memoryMining) {
    return false;
  }
  return memoryMining.memory_written === true
    && memoryMining.memory_validated === true
    && !memoryPostWriteValidationBlocks(memoryMining.memory_post_write_validation as MemoryPostWriteValidation | undefined | null);
}

function reviewStatusForPostWrite(validation: MemoryPostWriteValidation, writtenCount: number): MemoryReviewStatus {
  if (writtenCount <= 0 || validation.status === "not_required") {
    return "not_required";
  }
  if (validation.status !== "passed") {
    return "failed_post_write_validation";
  }
  return "pending_consciencia_memorias";
}

function codeReviewRequired(flow: Flow, input: FiscalVerdictInput): boolean {
  // Fast-track: mechanical risk (text/doc updates) does not require code review
  if (flow.goal_binding?.envelope.risk_level === "mechanical") {
    return false;
  }
  return flow.changed_files.length > 0 || /(codigo|código|mudanca de codigo|mudança de código|diff|review|revisor)/i.test(fiscalText(flow, input));
}

function hasReviewEvidence(flow: Flow, input: FiscalVerdictInput): boolean {
  const citedEvidenceIds = input.evidence_ids ? new Set(input.evidence_ids) : null;
  if (citedEvidenceIds) {
    return flow.evidence.some((evidence) =>
      citedEvidenceIds.has(evidence.evidence_id)
      && isStructuredReviewEvidence(flow, evidence)
    );
  }
  return (
    flow.verdicts.some((verdict) =>
      verdict.reviewed_implementation_fingerprint
        ? verdict.reviewed_implementation_fingerprint === flow.implementation_fingerprint
        : !flow.implementation_fingerprint &&
          (
            truthy(verdict.review_artifact_path) ||
            verdict.review_findings.length > 0
          ) &&
          changedFilesMatchReview(flow.changed_files, reviewedChangedFilesForVerdict(flow, verdict)) &&
          reviewRemainsCurrent(flow, verdict)
    ) ||
    flow.evidence.some((evidence) => isStructuredReviewEvidence(flow, evidence))
  );
}

function canonicalChangedFiles(changedFiles: string[]): string[] {
  return unique(changedFiles.map(normalizeReviewPath).filter(Boolean)).sort();
}

function assertDeletedFilesBelongToChangedFiles(changedFiles: string[], deletedFiles: string[]): void {
  const changed = new Set(changedFiles.map(normalizeReviewPath).filter(Boolean));
  const unknown = deletedFiles
    .map(normalizeReviewPath)
    .filter(Boolean)
    .filter((file) => !changed.has(file));
  if (unknown.length > 0) {
    throw new Error(`DELETED_FILES_NOT_CHANGED: ${unique(unknown).join(", ")}`);
  }
}

function changedFilesMatchReview(changedFiles: string[], reviewedChangedFiles: string[] | undefined): boolean {
  if (!reviewedChangedFiles) {
    return false;
  }
  const current = canonicalChangedFiles(changedFiles);
  const reviewed = canonicalChangedFiles(reviewedChangedFiles);
  return current.length === reviewed.length && current.every((item, index) => item === reviewed[index]);
}

function reviewedChangedFilesForVerdict(flow: Flow, verdict: Verdict): string[] | undefined {
  if (verdict.reviewed_changed_files) {
    return verdict.reviewed_changed_files;
  }
  const verdictIndex = verdictHistoryIndex(flow, verdict);
  if (verdictIndex < 0) {
    return undefined;
  }
  const changedFiles = changedFilesSnapshotAt(flow, verdictIndex);
  return changedFiles.length > 0 ? changedFiles : undefined;
}

function changedFilesSnapshotAt(flow: Flow, historyIndex: number): string[] {
  let changedFiles: string[] = [];
  for (const event of flow.history.slice(0, historyIndex + 1)) {
    const nextChangedFiles = changedFilesAfterEvent(changedFiles, event);
    if (nextChangedFiles) {
      changedFiles = nextChangedFiles;
    }
  }
  return canonicalChangedFiles(changedFiles);
}

function reviewRemainsCurrent(flow: Flow, verdict: Verdict): boolean {
  if (flow.implementation_fingerprint || verdict.reviewed_implementation_fingerprint) {
    return Boolean(
      flow.implementation_fingerprint
      && verdict.reviewed_implementation_fingerprint === flow.implementation_fingerprint
    );
  }
  const verdictIndex = verdictHistoryIndex(flow, verdict);
  const reviewedChangedFiles = reviewedChangedFilesForVerdict(flow, verdict);
  if (verdictIndex < 0 || !reviewedChangedFiles) {
    return false;
  }
  let current = canonicalChangedFiles(reviewedChangedFiles);
  for (const event of flow.history.slice(verdictIndex + 1)) {
    if (
      event.type === "flow_facts_updated" &&
      Object.prototype.hasOwnProperty.call(event.data, "changed_files")
    ) {
      return false;
    }
    const next = changedFilesAfterEvent(current, event);
    if (!next) {
      continue;
    }
    if (!changedFilesMatchReview(current, next)) {
      return false;
    }
    current = next;
  }
  return true;
}

function verdictHistoryIndex(flow: Flow, verdict: Verdict): number {
  return flow.history.findIndex(
    (event) => event.type === "verdict_recorded" && event.data.verdict_id === verdict.verdict_id
  );
}

function changedFilesAfterEvent(
  current: string[],
  event: Flow["history"][number]
): string[] | undefined {
  if (event.type === "flow_facts_updated") {
    return Object.prototype.hasOwnProperty.call(event.data, "changed_files")
      ? canonicalChangedFiles(stringArray(event.data.changed_files))
      : undefined;
  }
  if (event.type !== "gate_checked" || event.data.phase !== "implementacao") {
    return undefined;
  }
  const provided = event.data.provided;
  if (!provided || typeof provided !== "object" || Array.isArray(provided)) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(provided, "changed_files")) {
    return undefined;
  }
  return canonicalChangedFiles([
    ...current,
    ...stringArray((provided as Record<string, unknown>).changed_files)
  ]);
}

function hasMaterialMeeting(flow: Flow): boolean {
  return flow.cooperators.some((cooperator) => cooperator.material) || flow.active_credits.length > 0;
}

function hasMaterialMeetingOrRegress(flow: Flow): boolean {
  const recordedMeeting = flow.history.some((event) => event.type === "meeting_recorded");
  const returned = flow.history.some((event) => event.type === "phase_returned");
  return returned || (recordedMeeting && hasMaterialMeeting(flow));
}

function hasClosedMeetingSatisfying(flow: Flow, input: FiscalVerdictInput, blocker: string): boolean {
  const meetingIds = inputMeetingIds(input);
  if ((input.status === "pronto" || input.status === "pronto_com_ressalvas") && meetingIds.length === 0) {
    return false;
  }
  return flow.history.some((event) => {
    if (event.type !== "meeting_closed") {
      return false;
    }
    const eventMeetingId = String(event.data.meeting_id ?? "");
    if (meetingIds.length > 0 && !meetingIds.includes(eventMeetingId)) {
      return false;
    }
    if (event.data.participants_minimum_satisfied === false) {
      return false;
    }
    if (!truthy(event.data.decision)) {
      return false;
    }
    return stringArray(event.data.satisfies_blockers).includes(blocker);
  });
}

function inputMeetingIds(input: FiscalVerdictInput): string[] {
  return unique([input.meeting_id, ...(input.meeting_ids ?? [])].filter(Boolean) as string[]);
}

function requiredCooperationDiagnostics(
  flow: Flow,
  meetings: Meeting[],
  blockers: string[],
  input: FiscalVerdictInput = {}
): Record<string, unknown> {
  const suggested = uniqueCooperators(meetings.flatMap((meeting) => meeting.suggested_cooperators ?? []));
  const inputIds = inputMeetingIds(input);
  const latestBlock = latestFiscalBlockEvent(flow);
  const latestPersisted = latestBlock?.event.data.required_cooperation_diagnostics as Record<string, unknown> | undefined;
  const persistedInsufficientIds = new Set(
    latestBlock && !hasVerdictRecordedAfterIndex(flow, latestBlock.index) ? stringArray(latestPersisted?.insufficient_meeting_ids) : []
  );
  const eligible = meetings.filter(
    (meeting) =>
      meeting.status === "closed" &&
      meeting.satisfies_blockers.includes("required_cooperation") &&
      missingParticipantsFor(meeting).length === 0 &&
      truthy(meeting.decision) &&
      !meetingConsumedByLaterVerdict(flow, meeting)
  );
  const insufficient = meetings.filter(
    (meeting) =>
      meeting.status === "closed" &&
      meeting.participants_required.length > 0 &&
      missingParticipantsFor(meeting).length > 0 &&
      (persistedInsufficientIds.has(meeting.meeting_id) || requiredCooperationMeetingMaterial(flow, meeting, inputIds, latestBlock?.index ?? null))
  );
  const inputMissingMeetingId =
    (input.status === "pronto" || input.status === "pronto_com_ressalvas") && inputMeetingIds(input).length === 0 && eligible.length > 0;
  const persistedMissingForVerdict = inputMeetingIds(input).length > 0 ? [] : stringArray(latestPersisted?.missing_for_verdict);
  const missingForVerdict = unique([...(inputMissingMeetingId ? ["meeting_id"] : []), ...persistedMissingForVerdict]);
  const participantsRequired = requiredMeetingParticipants(blockers);
  const missingParticipants = unique(insufficient.flatMap((meeting) => missingParticipantsFor(meeting)));
  return {
    suggested_count: suggested.length,
    suggested,
    participants_required: participantsRequired,
    open_meeting_ids: meetings
      .filter((meeting) => meeting.status !== "closed" && requiredCooperationMeetingMaterial(flow, meeting, inputIds, latestBlock?.index ?? null))
      .map((meeting) => meeting.meeting_id),
    eligible_meeting_ids: eligible.map((meeting) => meeting.meeting_id),
    insufficient_meeting_ids: insufficient.map((meeting) => meeting.meeting_id),
    missing_participants: missingParticipants,
    missing_for_verdict: missingForVerdict,
    distinction: "suggested_cooperators nao sao active_credits nem participants_present; required_cooperation exige participants_present e meeting_id no goal_verdict positivo"
  };
}

function missingParticipantsFor(meeting: Meeting): string[] {
  return meeting.participants_required.filter((participant) => !meeting.participants_present.includes(participant));
}

function requiredCooperationMeetingMaterial(flow: Flow, meeting: Meeting, inputMeetingIdsForVerdict: string[], latestBlockIndex: number | null): boolean {
  if (inputMeetingIdsForVerdict.includes(meeting.meeting_id)) {
    return true;
  }
  if (meeting.satisfies_blockers.includes("required_cooperation")) {
    return true;
  }
  if (!meetingHasRequiredCooperationParticipants(meeting)) {
    return false;
  }
  return meetingLinkedToFiscalBlock(flow, meeting, latestBlockIndex);
}

function meetingHasRequiredCooperationParticipants(meeting: Meeting): boolean {
  const requiredParticipants = requiredMeetingParticipants(["required_cooperation"]);
  return requiredParticipants.every((participant) => meeting.participants_required.includes(participant));
}

function meetingLinkedToFiscalBlock(flow: Flow, meeting: Meeting, latestBlockIndex: number | null): boolean {
  if (latestBlockIndex === null) {
    return false;
  }
  const openedIndex = meetingOpenedIndex(flow, meeting.meeting_id);
  if (openedIndex === null) {
    return false;
  }
  if (openedIndex > latestBlockIndex) {
    return true;
  }
  const previousBlockIndex = previousFiscalBlockIndex(flow, latestBlockIndex);
  return previousBlockIndex !== null && openedIndex > previousBlockIndex;
}

function meetingOpenedIndex(flow: Flow, meetingId: string): number | null {
  const index = flow.history.findIndex((event) => event.type === "meeting_opened" && String(event.data.meeting_id ?? "") === meetingId);
  return index >= 0 ? index : null;
}

function meetingClosedIndex(flow: Flow, meetingId: string): number | null {
  const index = flow.history.findIndex((event) => event.type === "meeting_closed" && String(event.data.meeting_id ?? "") === meetingId);
  return index >= 0 ? index : null;
}

function previousFiscalBlockIndex(flow: Flow, beforeIndex: number): number | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (flow.history[index]?.type === "fiscal_policy_blocked") {
      return index;
    }
  }
  return null;
}

function meetingConsumedByLaterVerdict(flow: Flow, meeting: Meeting): boolean {
  const closedIndex = meetingClosedIndex(flow, meeting.meeting_id);
  return closedIndex !== null && flow.history.slice(closedIndex + 1).some(
    (event) => event.type === "verdict_recorded" && (
      stringArray(event.data.meeting_ids).includes(meeting.meeting_id) ||
      !Object.prototype.hasOwnProperty.call(event.data, "meeting_ids")
    )
  );
}

function meetingOutcomeSummaries(flow: Flow): Array<Record<string, unknown>> {
  return flow.meetings.map((meetingId) => {
    const closedIndex = meetingClosedIndex(flow, meetingId);
    if (closedIndex === null) {
      const wasRecorded = flow.history.some(
        (event) => event.type === "meeting_recorded" && String(event.data.meeting_id ?? "") === meetingId
      );
      return meetingOutcomeSummary(meetingId, wasRecorded ? "recorded_legacy" : "open", null);
    }
    const laterEvents = flow.history.slice(closedIndex + 1);
    const exactConsumption = laterEvents.find(
      (event) =>
        (event.type === "goal_regressed" && String(event.data.meeting_id ?? "") === meetingId) ||
        (event.type === "verdict_recorded" && stringArray(event.data.meeting_ids).includes(meetingId))
    );
    if (exactConsumption) {
      return meetingOutcomeSummary(
        meetingId,
        exactConsumption.type === "goal_regressed" ? "consumed_by_regress" : "consumed_by_verdict",
        {
          at: exactConsumption.at,
          event_type: exactConsumption.type,
          consumer_id: exactConsumption.type === "verdict_recorded" ? String(exactConsumption.data.verdict_id ?? "") || null : null
        }
      );
    }
    const hasUnattributedLegacyVerdict = laterEvents.some(
      (event) => event.type === "verdict_recorded" && !Object.prototype.hasOwnProperty.call(event.data, "meeting_ids")
    );
    return meetingOutcomeSummary(meetingId, hasUnattributedLegacyVerdict ? "unattributed_legacy" : "closed_unconsumed", null);
  });
}

function meetingOutcomeSummary(
  meetingId: string,
  traceabilityStatus: "open" | "recorded_legacy" | "closed_unconsumed" | "consumed_by_regress" | "consumed_by_verdict" | "unattributed_legacy",
  consumption: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    meeting_id: meetingId,
    traceability_status: traceabilityStatus,
    consumed: traceabilityStatus === "consumed_by_regress" || traceabilityStatus === "consumed_by_verdict",
    reusable: traceabilityStatus === "closed_unconsumed",
    reuse_reason: traceabilityStatus === "closed_unconsumed"
      ? "closed result has no later attributed or legacy verdict"
      : traceabilityStatus === "unattributed_legacy"
        ? "legacy verdict prevents safe reuse without inventing attribution"
        : "meeting is not an eligible unconsumed closed result",
    consumption,
    semantic_effectiveness: "not_measured",
    evidence_rule: "meeting close, presence, turns, findings and credits never prove effectiveness; attributed consumption requires a later event with the exact meeting_id"
  };
}

function meetingOutcomeCounts(flow: Flow): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const outcome of meetingOutcomeSummaries(flow)) {
    const status = String(outcome.traceability_status);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function hasVerdictRecordedAfterIndex(flow: Flow, historyIndex: number): boolean {
  return flow.history.slice(historyIndex + 1).some((event) => event.type === "verdict_recorded");
}

function librarianRequired(flow: Flow, input: FiscalVerdictInput): boolean {
  const text = [input.rationale, input.next_step, ...(input.residual_risks ?? [])].filter(Boolean).join("\n");
  if (librarianExplicitlyOutOfScope(flow, text)) {
    return false;
  }
  return /bibliotec|graphify|retorno visual/i.test(text);
}

function librarianExplicitlyOutOfScope(flow: Flow, inputText: string): boolean {
  const scopeOutText = flow.scope.out.join("\n");
  const combined = [scopeOutText, inputText].filter(Boolean).join("\n");
  if (!/bibliotec|graphify|retorno visual/i.test(scopeOutText)) {
    return false;
  }
  if (!/(fora do escopo|fora de escopo|out[-_ ]?of[-_ ]?scope|p2|estacionad|rodada futura|rodada propria|nao exigid|nao requerido)/i.test(combined)) {
    return false;
  }
  return !/(obrigatorio agora|exigido agora|required now|bloqueia p1|bloquear p1|gate p1)/i.test(inputText);
}

function recurringRisk(input: FiscalVerdictInput): boolean {
  return /\b(?:erros?|falhas?|bugs?|defeitos?|problemas?|incidentes?|riscos?)\s+recorrentes?\b|\btentativas?\b|\bregress/i.test(
    [input.rationale, input.next_step, ...(input.residual_risks ?? [])].filter(Boolean).join("\n")
  );
}

function hasEnoughAttempts(flow: Flow, input: FiscalVerdictInput): boolean {
  const attemptCount = input.attempt_count ?? countHistory(flow, "verdict_recorded");
  const regressCount = input.regress_count ?? countRegressions(flow);
  return attemptCount >= 2 || regressCount >= 1 || flow.meetings.length > 0;
}

function regressLimitReached(flow: Flow, input: FiscalVerdictInput): boolean {
  return (input.regress_count ?? countRegressions(flow)) >= FISCAL_CONFIG.maxRegressions;
}

function countHistory(flow: Flow, type: string): number {
  return flow.history.filter((event) => event.type === type).length;
}

function countRegressions(flow: Flow): number {
  const reported = flow.history
    .filter((event) => event.type === "regress_count_reported" && typeof event.data.regress_count === "number")
    .map((event) => event.data.regress_count as number);
  return Math.max(countHistory(flow, "phase_returned"), 0, ...reported);
}

function hasHygieneBlocking(flow: Flow): boolean {
  const latest = [...flow.history].reverse().find((event) => event.type === "hygiene_scanned");
  return Boolean(latest && typeof latest.data.blocking_findings_count === "number" && latest.data.blocking_findings_count > 0);
}

function hasHygieneScan(flow: Flow): boolean {
  return flow.history.some((event) => event.type === "hygiene_scanned");
}

function hasMemoryMiningRun(flow: Flow): boolean {
  return flow.history.some((event) => event.type === "memory_mined") || Boolean(flow.memory_mining?.last_run_at);
}

function isMaterialHygieneFinding(finding: HygieneFinding): boolean {
  return finding.severity === "warning" || finding.severity === "error";
}

function needsReviewCoherence(flow: Flow, phase: AnyPhase, provided: Record<string, unknown>): boolean {
  const changedFilesVisible = flow.changed_files.length > 0 || stringArray(provided.changed_files).length > 0;
  if (phase !== "revisao" || !flow.goal_binding || !changedFilesVisible) {
    return false;
  }
  return (
    truthy(provided.diff_reviewed) &&
    !truthy(provided.review_artifact_path) &&
    !truthy(provided.review_findings) &&
    !hasReviewEvidence(flow, {})
  );
}

function latestFiscalBlock(flow: Flow): Pick<FiscalPolicyResult, "blocking_reasons" | "required_cooperation"> {
  const latest = latestFiscalBlockEvent(flow);
  if (!latest) {
    return { blocking_reasons: [], required_cooperation: [] };
  }
  const verdictRecordedAfterBlock = flow.history
    .slice(latest.index + 1)
    .some((event) => event.type === "verdict_recorded");
  if (verdictRecordedAfterBlock) {
    return { blocking_reasons: [], required_cooperation: [] };
  }
  const event = latest.event;
  const required = Array.isArray(event.data.required_cooperation) ? (event.data.required_cooperation as Cooperator[]) : [];
  const blockingReasons = reconciledBlockers(flow, stringArray(event.data.blocking_reasons));
  return {
    blocking_reasons: blockingReasons,
    required_cooperation: blockingReasons.includes("required_cooperation") ? required : []
  };
}

function reconciledBlockers(flow: Flow, blockers: string[]): string[] {
  return unique(blockers).filter((reason) => isBlockerStillActive(flow, reason));
}

function isBlockerStillActive(flow: Flow, reason: string): boolean {
  if (reason === "required_cooperation") {
    return requiredCooperationStillActive(flow);
  }
  if (reason === "memory_required_but_empty") {
    return memoryRequiredByFlow(flow) && noMemoryWasPromoted(flow);
  }
  if (reason === MEMORY_MINING_BLOCKED_VERDICT_REASON) {
    return memoryMiningVerdictStillBlocked(flow);
  }
  if (reason === "review_required" || reason === "review_evidence_coherent") {
    return !hasReviewEvidence(flow, {});
  }
  return true;
}

function latestFiscalBlockEvent(flow: Flow): { event: Flow["history"][number]; index: number } | null {
  for (let index = flow.history.length - 1; index >= 0; index -= 1) {
    const event = flow.history[index];
    if (event.type === "fiscal_policy_blocked") {
      return { event, index };
    }
  }
  return null;
}

function requiredCooperationNeedsMeetingIdRetry(flow: Flow, meetings: Meeting[]): boolean {
  const latest = latestFiscalBlockEvent(flow);
  if (!latest) {
    return false;
  }
  const latestDiagnostics = latest.event.data.required_cooperation_diagnostics as Record<string, unknown> | undefined;
  const missingForVerdict = stringArray(latestDiagnostics?.missing_for_verdict);
  if (!missingForVerdict.includes("meeting_id")) {
    return false;
  }
  const verdictRecordedAfterBlock = flow.history.slice(latest.index + 1).some((event) => event.type === "verdict_recorded");
  if (verdictRecordedAfterBlock) {
    return false;
  }
  return stringArray(requiredCooperationDiagnostics(flow, meetings, ["required_cooperation"]).eligible_meeting_ids).length > 0;
}

function blockerDiagnosticsFor(
  flow: Flow,
  meetings: Meeting[],
  gate: GateRecord,
  gateBlockers: string[],
  fiscal: FiscalPolicyResult,
  persistedFiscal: Pick<FiscalPolicyResult, "blocking_reasons" | "required_cooperation">,
  effectiveBlockers: string[],
  memoryMiningBlockers: string[] = []
): BlockerDiagnostics {
  const fiscalBlockers = reconciledBlockers(flow, fiscal.blocking_reasons);
  const persistedFiscalBlockers = reconciledBlockers(flow, persistedFiscal.blocking_reasons);
  const activeMemoryMiningBlockers = reconciledBlockers(flow, memoryMiningBlockers);
  const fiscalModeActive = fiscal.material || persistedFiscalBlockers.length > 0 || activeMemoryMiningBlockers.length > 0;
  const hasGateBlockers = gateBlockers.length > 0;
  const hasFiscalBlockers = fiscalBlockers.length > 0 || persistedFiscalBlockers.length > 0 || activeMemoryMiningBlockers.length > 0;
  const policy = hasGateBlockers && hasFiscalBlockers
    ? "mixed"
    : hasFiscalBlockers
      ? "fiscal_material_policy"
      : hasGateBlockers
        ? "phase_gate_requirements"
        : "none";

  const diagnostics: BlockerDiagnostics = {
    source: "goal_status",
    phase: flow.phase,
    policy,
    fiscal_mode_active: fiscalModeActive,
    gate_status: gate.status,
    gate_blockers: gateBlockers,
    fiscal_blockers: fiscalBlockers,
    persisted_fiscal_blockers: persistedFiscalBlockers,
    memory_mining_blockers: activeMemoryMiningBlockers,
    effective_blockers: effectiveBlockers,
    blocker_families: effectiveBlockers.map((blocker) => ({
      blocker,
      family: blockerFamily(blocker),
      source: blockerSources(blocker, gateBlockers, fiscalBlockers, persistedFiscalBlockers, activeMemoryMiningBlockers)
    })),
    interpretation: blockerInterpretation(policy, fiscalModeActive),
    why_fiscal_mode_not_active: fiscalModeActive ? [] : whyFiscalModeNotActive(flow)
  };
  if (effectiveBlockers.includes("required_cooperation")) {
    diagnostics.required_cooperation = requiredCooperationDiagnostics(flow, meetings, effectiveBlockers);
  }
  if (effectiveBlockers.includes("memory_required_but_empty")) {
    diagnostics.memory_required = memoryRequiredDiagnostics(flow);
  }
  if (effectiveBlockers.includes(MEMORY_MINING_BLOCKED_VERDICT_REASON)) {
    diagnostics.memory_mining = memoryMiningBlockedDiagnostics(flow);
  }
  return diagnostics;
}

function blockerSources(
  blocker: string,
  gateBlockers: string[],
  fiscalBlockers: string[],
  persistedFiscalBlockers: string[],
  memoryMiningBlockers: string[] = []
): string[] {
  const sources: string[] = [];
  if (gateBlockers.includes(blocker)) {
    sources.push("phase_gate");
  }
  if (fiscalBlockers.includes(blocker)) {
    sources.push("current_fiscal_policy");
  }
  if (persistedFiscalBlockers.includes(blocker)) {
    sources.push("persisted_fiscal_block");
  }
  if (memoryMiningBlockers.includes(blocker)) {
    sources.push("memory_mining");
  }
  return sources;
}

function blockerFamily(blocker: string): string {
  if (["scope_in", "scope_out", "tasks", "expected_evidence", "done_criteria"].includes(blocker)) {
    return "planning_requirement";
  }
  if (["context", "risks", "uncertainties", "goal"].includes(blocker)) {
    return "thought_requirement";
  }
  if (["implementation_done", "changed_files"].includes(blocker)) {
    return "implementation_requirement";
  }
  if (["diff_reviewed", "barata_scan", "regression_risks"].includes(blocker)) {
    return "review_requirement";
  }
  if (blocker === "test_executed") {
    return "test_requirement";
  }
  if (["verdict", "residual_risks", "next_step", "memoria_viva_reconciled"].includes(blocker)) {
    return blocker === "verdict" ? "canonical_verdict" : "validation_requirement";
  }
  if (blocker === "required_cooperation") {
    return "fiscal_cooperation";
  }
  if (blocker === "memory_required_but_empty") {
    return "fiscal_memory";
  }
  if (blocker === MEMORY_MINING_BLOCKED_VERDICT_REASON) {
    return "fiscal_memory";
  }
  if (["hygiene_blocking", "review_required", "librarian_status", "attempt_regress_count"].includes(blocker)) {
    return "fiscal_material";
  }
  return "unknown";
}

function blockerInterpretation(policy: BlockerDiagnostics["policy"], fiscalModeActive: boolean): string {
  if (policy === "mixed") {
    return "ha requisitos de fase e bloqueios fiscais ativos; resolver ambos antes de declarar pronto";
  }
  if (policy === "fiscal_material_policy") {
    return "bloqueio vem da politica fiscal/material; nao e falta comum de campo de fase";
  }
  if (policy === "phase_gate_requirements") {
    return fiscalModeActive
      ? "bloqueio atual vem do gate de fase, embora a politica fiscal esteja em modo material sem blocker ativo"
      : "bloqueio vem de requisito do gate da fase atual; completar campos exigidos antes de avancar";
  }
  return "sem bloqueio efetivo no status atual";
}

function whyFiscalModeNotActive(flow: Flow): string[] {
  const reasons: string[] = [];
  if (!flow.goal_binding) {
    reasons.push("flow sem goal_binding oficial");
  }
  reasons.push("sem sinal material ativo no texto, evidencias, memoria, higiene, review, regressao ou bibliotecario");
  return reasons;
}

function memoryRequiredDiagnostics(flow: Flow): Record<string, unknown> {
  const status = flow.memory_mining;
  const candidates = Array.isArray(status?.candidates) ? status.candidates : [];
  const writtenCount = typeof status?.written_count === "number" ? status.written_count : 0;
  const candidatesCount = typeof status?.candidates_count === "number" ? status.candidates_count : 0;
  return {
    required: memoryRequiredByFlow(flow),
    mined: hasMemoryMiningRun(flow),
    last_run_at: status?.last_run_at ?? null,
    write_policy: status?.write_policy ?? null,
    written_count: writtenCount,
    memory_written: status?.memory_written === true,
    memory_validated: status?.memory_validated === true,
    memory_consolidated: status?.memory_consolidated === true,
    memory_review_status: status?.memory_review_status ?? null,
    post_write_validation: status?.memory_post_write_validation ?? null,
    candidates_count: candidatesCount,
    candidates_visible: candidates.length,
    memory_required_but_empty: noMemoryWasPromoted(flow),
    clears_when: [
      "mm_memory_mining roda no flow",
      "memory_written=true e memory_validated=true com memory_review_status pendente ou aprovado quando auto_write escreveu memoria",
      "goal_status deixa de listar memory_required_but_empty antes de novo goal_verdict positivo"
    ],
    executable_route: memoryMiningRequiredSequence(flow).slice(0, 2)
  };
}

function memoryMiningVerdictBlockers(flow: Flow): string[] {
  return memoryMiningVerdictStillBlocked(flow) ? [MEMORY_MINING_BLOCKED_VERDICT_REASON] : [];
}

function memoryMiningVerdictStillBlocked(flow: Flow): boolean {
  const status = flow.memory_mining;
  const postWriteBlocked = memoryPostWriteValidationBlocks(status?.memory_post_write_validation);
  if (memoryMiningCompletedWithNoCandidates(status)) {
    return false;
  }
  if (!status?.blocked_verdict && !postWriteBlocked) {
    return false;
  }
  return (
    numericMemoryField(status, "strong_unwritten_count") > 0 ||
    numericMemoryField(status, "blocked_count") > 0 ||
    status?.memory_required_but_empty === true ||
    postWriteBlocked
  );
}

function memoryPostWriteValidationBlocks(validation: MemoryPostWriteValidation | undefined | null): boolean {
  return validation?.required === true && validation.status !== "passed";
}

function numericMemoryField(memory: Record<string, unknown> | MemoryMiningSummary | undefined | null, field: string): number {
  const value = memory?.[field as keyof typeof memory];
  return typeof value === "number" ? value : 0;
}

function memoryMiningBlockedDiagnostics(flow: Flow): Record<string, unknown> {
  const status = flow.memory_mining;
  const editQueue = Array.isArray(status?.edit_queue) ? status.edit_queue : [];
  const destinationWarnings = Array.isArray(status?.destination_warnings) ? status.destination_warnings.map(String) : [];
  const writeDecisions = Array.isArray(status?.write_decisions) ? status.write_decisions : [];
  return {
    blocked_verdict: status?.blocked_verdict === true,
    last_run_at: status?.last_run_at ?? null,
    write_policy: status?.write_policy ?? null,
    strong_unwritten_count: numericMemoryField(status, "strong_unwritten_count"),
    resolved_candidate_ids: Array.isArray(status?.resolved_candidate_ids) ? status.resolved_candidate_ids : [],
    resolved_strong_unwritten_count: numericMemoryField(status, "resolved_strong_unwritten_count"),
    memory_written: status?.memory_written === true,
    memory_validated: status?.memory_validated === true,
    memory_consolidated: status?.memory_consolidated === true,
    memory_review_status: status?.memory_review_status ?? null,
    post_write_validation: status?.memory_post_write_validation ?? null,
    ledger_only_count: numericMemoryField(status, "ledger_only_count"),
    blocked_count: numericMemoryField(status, "blocked_count"),
    edit_queue_count: editQueue.length,
    destination_warnings: destinationWarnings,
    write_decisions: writeDecisions,
    clears_when: [
      "candidatos fortes recebem destino claro via mm_memory_candidate_resolve: memoria, estacionamento com quando, descarte justificado ou ledger-only aceito com regra",
      "memoria auto_write passa na validacao pos-write L1<->L2/L3 com marcador PPIRTV-MM-AUTO-WRITE-REVIEW",
      "mm_memory_mining retorna blocked_verdict=false",
      "goal_status deixa de listar memory_mining_blocked_verdict antes de novo goal_verdict positivo"
    ],
    executable_route: memoryMiningBlockedSequence(flow)
  };
}

function latestLibrarianStatus(flow: Flow): RecallVisualStatus | null {
  const eventIndex = lastIndexWhere(
    flow.history,
    (item) => item.type === "memory_recalled" || item.type === "memory_recall_reused" || item.type === "memory_hook_warning"
  );
  const event = eventIndex >= 0 ? flow.history[eventIndex] : undefined;
  if (!event) {
    return null;
  }
  const consumption = [...flow.history.slice(eventIndex + 1)].reverse().find((item) =>
    item.type === "memory_recall_consumed" && item.data.recall_phase === event.data.phase
  );
  return {
    status: statusValue(event.data.librarian_status),
    graphify_status: statusValue(event.data.graphify_status),
    warnings: stringArray(event.data.warnings ?? event.data.message),
    recalled_count: typeof event.data.recalled_count === "number" ? event.data.recalled_count : 0,
    recall_executed: event.data.recall_executed === true || (event.data.recall_executed === undefined && event.type === "memory_recalled"),
    consumption_confirmed: consumption?.data.consumption_confirmed === true,
    graphify_consumption_confirmed: consumption?.data.graphify_consumption_confirmed === true
  };
}

function latestLibrarianStatusFromLedger(events: Array<{ type: string; data: Record<string, unknown> }>): RecallVisualStatus | null {
  const eventIndex = lastIndexWhere(
    events,
    (item) => item.type === "memory_recalled" || item.type === "memory_recall_reused" || item.type === "memory_hook_warning"
  );
  const event = eventIndex >= 0 ? events[eventIndex] : undefined;
  if (!event) {
    return null;
  }
  const consumption = [...events.slice(eventIndex + 1)].reverse().find((item) =>
    item.type === "memory_recall_consumed" && item.data.recall_phase === event.data.phase
  );
  return {
    status: statusValue(event.data.librarian_status),
    graphify_status: statusValue(event.data.graphify_status),
    warnings: stringArray(event.data.warnings ?? event.data.message),
    recalled_count: typeof event.data.recalled_count === "number" ? event.data.recalled_count : 0,
    recall_executed: event.data.recall_executed === true || (event.data.recall_executed === undefined && event.type === "memory_recalled"),
    consumption_confirmed: consumption?.data.consumption_confirmed === true,
    graphify_consumption_confirmed: consumption?.data.graphify_consumption_confirmed === true
  };
}

function lastIndexWhere<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }
  return -1;
}

function blockedDirectAction(blockers: string[]): { available: boolean; action: string } {
  return {
    available: true,
    action: `Bloqueado: ${blockers.join(", ")}`
  };
}

function phaseAdvanceDirectAction(blockers: string[], nextPhase: AnyPhase): { available: boolean; action: string } {
  return {
    available: true,
    action: blockers.length > 0
      ? `Avanco de fase permitido para ${nextPhase}; pendencias fiscais de fechamento: ${blockers.join(", ")}`
      : `Avanco de fase permitido para ${nextPhase}`
  };
}

function blockedArchiveDirectAction(blockers: string[]): { available: boolean; action: string } {
  return {
    available: true,
    action: `Arquivado com bloqueios preservados: ${blockers.join(", ")}`
  };
}

function withDirectAction<T extends { display?: Record<string, unknown> }>(
  value: T,
  directAction: { available: boolean; action: string }
): T {
  return {
    ...value,
    display: {
      ...(value.display ?? {}),
      direct_action: directAction
    }
  };
}

function fiscalBackTo(flow: Flow): AnyPhase {
  // Patch D (modo compact wire-up): regresso fiscal segundo o perfil do flow.
  // P3b (hardening): fallback mode-aware para nao enviar compact flow para
  // fase full-only ("pensamentos") em caso de dados corrompidos.
  const fallback = flow.mode === "compact" ? "concepcao" : "pensamentos";
  return (profileFor(flow.mode).defaultBackTo[flow.phase] as Phase | null) ?? (fallback as Phase);
}

function meetingKindForType(type?: MeetingType): MeetingKind | undefined {
  if (!type) {
    return undefined;
  }
  if (type === "convergent") {
    return "convergente";
  }
  if (type === "transversal") {
    return "transversal";
  }
  if (type === "decision") {
    return "decisao";
  }
  return "divergente";
}

function meetingTypeForKind(kind: MeetingKind): MeetingType {
  if (kind === "convergente") {
    return "convergent";
  }
  if (kind === "transversal") {
    return "transversal";
  }
  if (kind === "decisao") {
    return "decision";
  }
  return "divergent";
}

function requiredMeetingKind(flow: Flow, blockers: string[], regressLimitReached: boolean): MeetingKind {
  if (regressLimitReached) {
    return "decisao";
  }
  if (!hasClosedMeetingKind(flow, "divergente")) {
    return "divergente";
  }
  if (!hasClosedMeetingKind(flow, "convergente")) {
    return "convergente";
  }
  if (
    blockers.some((blocker) => ["hygiene_blocking", "memory_required_but_empty", MEMORY_MINING_BLOCKED_VERDICT_REASON, "review_required", "librarian_status"].includes(blocker)) &&
    !hasClosedMeetingKind(flow, "transversal")
  ) {
    return "transversal";
  }
  return "convergente";
}

function hasClosedMeetingKind(flow: Flow, kind: MeetingKind): boolean {
  return flow.history.some((event) => event.type === "meeting_closed" && String(event.data.kind) === kind);
}

function requiredMeetingParticipants(blockers: string[]): string[] {
  const participants = ["chato", "questionador", "reuniao", "validador-pronto"];
  if (blockers.some((blocker) => ["memory_required_but_empty", MEMORY_MINING_BLOCKED_VERDICT_REASON].includes(blocker))) {
    participants.push("garimpeiro", "dex-memoria");
  }
  if (blockers.includes("review_required")) {
    participants.push("revisor-codigo");
  }
  if (blockers.includes("hygiene_blocking")) {
    participants.push("tio-testador");
  }
  if (blockers.includes("librarian_status") || blockers.includes("attempt_regress_count")) {
    participants.push("ancora-fluxo", "ppi");
  }
  return unique(participants);
}

function meetingClosedLedgerData(meeting: Meeting): Record<string, unknown> {
  return {
    meeting_id: meeting.meeting_id,
    flow_id: meeting.flow_id,
    type: meeting.type,
    kind: meeting.kind,
    opened_at: meeting.opened_at,
    closed_at: meeting.closed_at,
    participants_required: meeting.participants_required,
    participants_present: meeting.participants_present,
    questions: meeting.questions,
    findings: meeting.findings,
    decision: meeting.decision,
    next_required_action: meeting.next_required_action,
    satisfies_blockers: meeting.satisfies_blockers,
    created_by: meeting.created_by,
    evidence_ids: meeting.evidence_ids
  };
}

function applyClosedMeetingToFlow(flow: Flow, meeting: Meeting, at: string): Record<string, unknown> {
  const missingParticipants = missingParticipantsFor(meeting);
  const data = {
    ...meetingClosedLedgerData(meeting),
    missing_participants: missingParticipants,
    participants_minimum_satisfied: missingParticipants.length === 0
  };
  flow.decisions = unique([...flow.decisions, ...meeting.decisions]);
  flow.risks = unique([...flow.risks, ...meeting.risks]);
  flow.parking_lot = unique([...flow.parking_lot, ...meeting.parking_lot]);
  flow.gold_mining = unique([...flow.gold_mining, ...meeting.gold_mining]);
  flow.cooperators = uniqueCooperators([...flow.cooperators, ...meeting.cooperators]);
  flow.active_credits = unique([...flow.active_credits, ...meeting.active_credits]);
  flow.updated_at = at;
  flow.history.push({ at, type: "meeting_closed", data });
  return data;
}

const MEETING_RESOLVABLE_BLOCKERS = new Set(["required_cooperation"]);

function assertMeetingClosed(meeting: Meeting): void {
  if (meeting.status !== "closed") {
    throw new Error(`MEETING_NOT_CLOSED: ${meeting.meeting_id}; status=${meeting.status}`);
  }
}

function blockerOwner(blocker: string): string {
  if (blocker === "review_required") return "evidence_add";
  if (blocker === "memory_required_but_empty") return "mm_memory_mining";
  if (blocker === "hygiene_blocking") return "hygiene_scan";
  if (blocker === "librarian_status") return "memory_recall";
  return "unknown/unregistered";
}

function nextRequiredActionFor(
  flow: Flow,
  meetings: Meeting[],
  blockers: string[],
  backTo: AnyPhase | null,
  regressCount: number,
  regressLimitReached: boolean,
  loopMonitor: LoopMonitor | null
): Record<string, unknown> | null {
  if (blockers.length === 0) {
    return null;
  }
  const loopAction = loopEscalationAction(flow, blockers, backTo, loopMonitor);
  if (loopAction) {
    return loopAction;
  }
  if (blockers.includes("verdict") && officialGoalNeedsCanonicalVerdict(flow)) {
    return {
      type: "goal_verdict_required",
      tool: "goal_verdict",
      reason: "validacao exige veredito canonico registrado por goal_verdict antes de completar GOAL oficial",
      other_blockers: blockers.filter((blocker) => blocker !== "verdict"),
      back_to: backTo,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      can_retry_verdict: true,
      required_tool_sequence: [
        {
          order: 1,
          tool: "goal_verdict",
          purpose: "registrar veredito canonico com evidence_ids antes de completar ou arquivar",
          args: {
            flow_id: flow.flow_id,
            status: "pronto_com_ressalvas",
            rationale: "<racional com evidencia>",
            evidence_ids: ["<evidence_id>"],
            residual_risks: ["<risco residual ou nenhum>"],
            next_step: "<proximo passo com quando>"
          }
        },
        { order: 2, tool: "goal_status", purpose: "confirmar current_verdict antes de qualquer archive", args: { flow_id: flow.flow_id } }
      ]
    };
  }
  if (regressLimitReached) {
    return {
      type: "open_decision_meeting",
      tool: "goal_meeting_open",
      reason: "limite de regressos atingido; abrir reuniao de decisao/validador-pronto em vez de repetir loop de retorno",
      back_to: backTo,
      meeting_kind: "decisao",
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      locked_by_limit: true,
      can_retry_verdict: false,
      required_tool_sequence: [
        {
          order: 1,
          tool: "goal_meeting_open",
          purpose: "abrir reuniao de decisao; nao repetir goal_verdict enquanto locked_by_limit=true",
          args: { flow_id: flow.flow_id, kind: "decisao", question: "Decidir saida apos limite de regressos fiscais" },
          capture: "meeting_id"
        },
        {
          order: 2,
          tool: "goal_meeting_close",
          purpose: "fechar decisao com responsaveis e blockers preservados",
          args: { meeting_id: "<meeting_id>", participants_present: ["chato", "reuniao", "validador-pronto"], decision: "decisao fiscal registrada" }
        },
        { order: 3, tool: "goal_status", purpose: "confirmar novo estado antes de qualquer veredito", args: { flow_id: flow.flow_id } }
      ]
    };
  }
  if (blockers.includes("required_cooperation")) {
    const cooperationDiagnostics = requiredCooperationDiagnostics(flow, meetings, blockers);
    const meetingKind = requiredMeetingKind(flow, blockers, regressLimitReached);
    const eligibleMeetingIds = stringArray(cooperationDiagnostics.eligible_meeting_ids);
    const openMeetingIds = new Set(stringArray(cooperationDiagnostics.open_meeting_ids));
    const relevantOpenMeetings = meetings.filter((meeting) => openMeetingIds.has(meeting.meeting_id));
    const openMeeting = latestOpenMeeting(relevantOpenMeetings, meetingKind) ?? latestOpenMeeting(relevantOpenMeetings);
    const missingForVerdict = stringArray(cooperationDiagnostics.missing_for_verdict);
    if (eligibleMeetingIds.length > 0 && missingForVerdict.includes("meeting_id")) {
      return {
        type: "provide_meeting_id_for_verdict",
        tool: "goal_verdict",
        reason: "required_cooperation ja tem reuniao elegivel; repetir goal_verdict informando meeting_id",
        back_to: backTo,
        eligible_meeting_ids: eligibleMeetingIds,
        required_satisfies_blockers: ["required_cooperation"],
        regress_count: regressCount,
        max_regressions: FISCAL_CONFIG.maxRegressions,
        can_retry_verdict: true,
        loop_guard: "nao abrir nova reuniao; usar um eligible_meeting_id no goal_verdict",
        required_tool_sequence: [
          {
            order: 1,
            tool: "goal_verdict",
            purpose: "repetir veredito positivo com meeting_id da reuniao que satisfez required_cooperation",
            args: {
              flow_id: flow.flow_id,
              meeting_id: eligibleMeetingIds[0],
              status: "pronto_com_ressalvas",
              rationale: "<racional com evidencia>",
              evidence_ids: ["<evidence_id>"],
              residual_risks: ["<risco residual ou nenhum>"],
              next_step: "<proximo passo com quando>"
            }
          },
          { order: 2, tool: "goal_status", purpose: "confirmar ausencia de required_cooperation", args: { flow_id: flow.flow_id } }
        ]
      };
    }
    if (blockers.includes("required_cooperation") && openMeeting) {
      return {
        type: "close_existing_meeting",
        tool: "goal_meeting_close",
        reason: "required_cooperation ja tem reuniao aberta; nao abra outra, registre turno material e feche com satisfies_blockers",
        back_to: backTo,
        meeting_id: openMeeting.meeting_id,
        meeting_kind: openMeeting.kind,
        required_participants: requiredMeetingParticipants(blockers),
        required_satisfies_blockers: ["required_cooperation"],
        regress_count: regressCount,
        max_regressions: FISCAL_CONFIG.maxRegressions,
        can_retry_verdict: false,
        loop_guard: "nao chamar goal_verdict e nao abrir nova reuniao enquanto esta reuniao aberta nao for fechada com materialidade",
        required_tool_sequence: requiredCooperationSequence(flow, openMeeting.meeting_id, openMeeting.kind, blockers, backTo, true)
      };
    }
    return {
      type: "open_meeting",
      tool: "goal_meeting_open",
      reason: blockers.includes("required_cooperation")
        ? "required_cooperation material exige reuniao/regresso rastreavel antes de novo veredito positivo"
        : `bloqueio material ainda exige reuniao ${meetingKind} antes de nova tentativa`,
      back_to: backTo,
      meeting_kind: meetingKind,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      can_retry_verdict: false,
      required_satisfies_blockers: blockers.includes("required_cooperation") ? ["required_cooperation"] : [],
      loop_guard: "execute a sequencia completa e confirme goal_status antes de repetir goal_verdict",
      required_tool_sequence: requiredCooperationSequence(flow, "<meeting_id>", meetingKind, blockers, backTo, false)
    };
  }
  if (blockers.includes("review_required")) {
    return {
      type: "attach_review",
      tool: "evidence_add",
      reason: "review_required exige review_artifact_path, review_findings ou evidencia de revisao",
      back_to: backTo,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      can_retry_verdict: false,
      loop_guard: "nao abrir nova reuniao nem repetir goal_verdict enquanto a evidencia de review nao estiver anexada e goal_status nao confirmar a remocao de review_required",
      required_tool_sequence: reviewRequiredSequence(flow)
    };
  }
  if (blockers.includes("memory_required_but_empty")) {
    return {
      type: "run_memory_mining",
      tool: "mm_memory_mining",
      reason: "memory_required_but_empty exige garimpo/classificacao de memoria antes de veredito positivo",
      back_to: backTo,
      regress_count: regressCount,
      max_regressions: FISCAL_CONFIG.maxRegressions,
      can_retry_verdict: false,
      required_tool_sequence: memoryMiningRequiredSequence(flow)
    };
  }
  if (blockers.includes(MEMORY_MINING_BLOCKED_VERDICT_REASON)) {
    return memoryMiningBlockedAction(flow, backTo, regressCount, regressLimitReached);
  }
  return {
    type: "resolve_blockers",
    tool: "goal_gate_check",
    reason: `resolver blockers: ${blockers.join(", ")}`,
    back_to: backTo,
    regress_count: regressCount,
    max_regressions: FISCAL_CONFIG.maxRegressions,
    can_retry_verdict: false
  };
}

function latestOpenMeeting(meetings: Meeting[], kind?: MeetingKind): Meeting | undefined {
  return [...meetings]
    .reverse()
    .find((meeting) => meeting.status !== "closed" && (!kind || meeting.kind === kind));
}

function requiredCooperationSequence(
  flow: Flow,
  meetingId: string,
  meetingKind: MeetingKind,
  blockers: string[],
  backTo: AnyPhase | null,
  meetingAlreadyOpen: boolean
): Array<Record<string, unknown>> {
  const participants = requiredMeetingParticipants(blockers);
  const sequence: Array<Record<string, unknown>> = [];
  if (!meetingAlreadyOpen) {
    sequence.push({
      order: sequence.length + 1,
      tool: "goal_meeting_open",
      purpose: "abrir reuniao material uma unica vez para resolver required_cooperation",
      args: {
        flow_id: flow.flow_id,
        kind: meetingKind,
        question: "Resolver required_cooperation antes de novo veredito positivo",
        participants_required: participants
      },
      capture: "meeting_id"
    });
  }
  sequence.push(
    {
      order: sequence.length + 1,
      tool: "goal_meeting_add_turn",
      purpose: "registrar fala material do Chato/Questionador com E SE, por que, origem, destino e principios",
      args: {
        flow_id: flow.flow_id,
        meeting_id: meetingId,
        speaker: "chato",
        question: "E SE falhar? por que liberar? qual origem/destino/gatilho? estamos seguindo nossos principios?",
        finding: "required_cooperation exige decisao material antes de qualquer veredito positivo"
      }
    },
    {
      order: sequence.length + 2,
      tool: "goal_meeting_close",
      purpose: "fechar a reuniao com decisao, participantes materiais e blocker satisfeito",
      args: {
        flow_id: flow.flow_id,
        meeting_id: meetingId,
        participants_present: participants,
        findings: ["required_cooperation analisado com materialidade"],
        decision: "Reuniao material fechada; required_cooperation satisfeito ou pendencia explicitada.",
        satisfies_blockers: ["required_cooperation"]
      }
    }
  );
  if (backTo) {
    sequence.push({
      order: sequence.length + 1,
      tool: "goal_regress",
      purpose: "registrar regresso rastreavel antes de nova tentativa de veredito",
      args: {
        flow_id: flow.flow_id,
        to: backTo,
        reason: "required_cooperation resolvido por reuniao material; regressar para fase fiscal correta",
        meeting_id: meetingId
      }
    });
  }
  sequence.push({
    order: sequence.length + 1,
    tool: "goal_status",
    purpose: "confirmar ausencia de required_cooperation antes de repetir goal_verdict",
    args: { flow_id: flow.flow_id }
  });
  return sequence;
}

function loopEscalationAction(flow: Flow, blockers: string[], backTo: AnyPhase | null, loopMonitor: LoopMonitor | null): Record<string, unknown> | null {
  if (!loopMonitor?.escalation.active) {
    return null;
  }
  const common = {
    loop_id: loopMonitor.loop_id,
    loop_count: loopMonitor.count,
    blockers,
    back_to: backTo,
    can_retry_verdict: false,
    loop_guard: "nao repetir a mesma acao enquanto loop_monitor.escalation.active=true; executar a sequencia de escalonamento e confirmar goal_status"
  };
  if (loopMonitor.count >= 9) {
    return {
      ...common,
      type: "bad_loop_review_work",
      tool: "evidence_add",
      reason: "9 ocorrencias na mesma janela sem progresso: acionar estacionamento e garimpeiro, documentar achados e finalizar como LOOP RUIM REVISAR TRABALHO",
      required_tool_sequence: badLoopReviewSequence(flow, loopMonitor)
    };
  }
  if (loopMonitor.count >= 8) {
    return {
      ...common,
      type: "emergency_meeting",
      tool: "goal_meeting_open",
      reason: "8 ocorrencias: abrir reuniao de emergencia com provocacao e especialistas extras em divergencia/convergencia/transversal",
      required_tool_sequence: emergencyLoopSequence(flow, loopMonitor)
    };
  }
  if (loopMonitor.count >= 6) {
    return {
      ...common,
      type: "research_subagent_request",
      tool: "subagent_research_request",
      reason: "6 ocorrencias: pedir pesquisa organizada antes de continuar tentando a mesma correcao",
      required_tool_sequence: researchLoopSequence(flow, loopMonitor)
    };
  }
  if (loopMonitor.count >= 5) {
    return {
      ...common,
      type: "divergence_transversal_meetings",
      tool: "goal_meeting_open",
      reason: "5 ocorrencias: abrir reunioes divergente e transversal para quebrar premissa repetida",
      required_tool_sequence: loopMeetingSequence(flow, loopMonitor, ["divergente", "transversal"])
    };
  }
  return {
    ...common,
    type: "convergence_transversal_meetings",
    tool: "goal_meeting_open",
    reason: "3 ocorrencias: abrir reunioes convergente e transversal para decidir recuperacao sem falso-verde",
    required_tool_sequence: loopMeetingSequence(flow, loopMonitor, ["convergente", "transversal"])
  };
}

function loopMeetingSequence(flow: Flow, loopMonitor: LoopMonitor, kinds: MeetingKind[]): Array<Record<string, unknown>> {
  const participants = requiredMeetingParticipants(loopMonitor.blockers);
  const sequence: Array<Record<string, unknown>> = kinds.flatMap((kind, index) => {
    const meetingId = `<${kind}_meeting_id>`;
    return [
      {
        order: index * 3 + 1,
        tool: "goal_meeting_open",
        purpose: `abrir reuniao ${kind} para loop_id=${loopMonitor.loop_id}`,
        args: {
          flow_id: flow.flow_id,
          kind,
          question: `Loop ${loopMonitor.loop_id} repetiu ${loopMonitor.count} vezes. O que muda agora para nao repetir a mesma acao?`,
          participants_required: participants
        },
        capture: meetingId
      },
      {
        order: index * 3 + 2,
        tool: "goal_meeting_add_turn",
        purpose: "registrar provocacao material do Chato/Questionador antes do fechamento",
        args: {
          flow_id: flow.flow_id,
          meeting_id: meetingId,
          speaker: "chato",
          question: "E SE a proxima tentativa for so repeticao? qual origem, destino, responsavel e evidencia nova?",
          finding: `loop_id=${loopMonitor.loop_id}; blockers=${loopMonitor.blockers.join(", ")}`
        }
      },
      {
        order: index * 3 + 3,
        tool: "goal_meeting_close",
        purpose: `fechar reuniao ${kind} com decisao e proxima acao diferente`,
        args: {
          flow_id: flow.flow_id,
          meeting_id: meetingId,
          participants_present: participants,
          findings: [`Loop ${loopMonitor.loop_id} analisado em reuniao ${kind}.`],
          decision: "Definir acao nova, evidencia nova ou bloqueio explicito antes de repetir tentativa.",
          satisfies_blockers: []
        }
      }
    ];
  });
  return sequence.concat([{ order: kinds.length * 3 + 1, tool: "goal_status", purpose: "confirmar loop_monitor e blockers apos reunioes", args: { flow_id: flow.flow_id } }]);
}

function researchLoopSequence(flow: Flow, loopMonitor: LoopMonitor): Array<Record<string, unknown>> {
  const workspace = flow.goal_binding?.envelope.workspace ?? "<WORKSPACE>";
  return [
    {
      order: 1,
      tool: "subagent_research_request",
      purpose: "acionar pesquisador organizado com contexto minimo e salvar pesquisa em .agents/PESQUISA",
      args: {
        skill: "pesquisador-organizado",
        repo: workspace,
        mission: `Pesquisar causa e saidas para loop ${loopMonitor.loop_id} com blockers ${loopMonitor.blockers.join(", ")} sem ler segredos.`,
        objective: "troubleshooting",
        required_outputs: ["relatorio", "raw-notes.md", "sources.json"]
      },
      skill_resolution: researcherSkillResolution(workspace)
    },
    {
      order: 2,
      tool: "evidence_add",
      purpose: "anexar relatorio da pesquisa como evidencia antes de nova tentativa",
      args: {
        flow_id: flow.flow_id,
        kind: "research_report",
        title: `Pesquisa organizada para ${loopMonitor.loop_id}`,
        content: "Anexar caminho do relatorio .agents/PESQUISA e achados principais.",
        satisfies: ["loop_research_required"]
      }
    },
    { order: 3, tool: "goal_status", purpose: "confirmar se a pesquisa mudou a proxima acao", args: { flow_id: flow.flow_id } }
  ];
}

function emergencyLoopSequence(flow: Flow, loopMonitor: LoopMonitor): Array<Record<string, unknown>> {
  const participants = ["chato", "questionador", "entrevista-me", "reuniao", "garimpeiro", "estacionamento", "revisor-codigo", "tio-testador", "validador-pronto", "ppi"];
  return [
    {
      order: 1,
      tool: "goal_meeting_open",
      purpose: "abrir reuniao de emergencia com especialistas extras",
      args: {
        flow_id: flow.flow_id,
        kind: "decisao",
        question: `EMERGENCIA: loop ${loopMonitor.loop_id} chegou a ${loopMonitor.count}. Que premissa falsa esta mantendo o trabalho preso?`,
        participants_required: participants
      },
      capture: "emergency_meeting_id"
    },
    {
      order: 2,
      tool: "goal_meeting_add_turn",
      purpose: "registrar provocacao adversarial de emergencia",
      args: {
        flow_id: flow.flow_id,
        meeting_id: "<emergency_meeting_id>",
        speaker: "chato",
        question: "A PERGUNTA PRINCIPAL: estamos seguindo nossos principios ou repetindo ferramenta sem aprendizado?",
        finding: `loop_id=${loopMonitor.loop_id}; decretar mudanca de estrategia antes de qualquer veredito.`
      }
    },
    {
      order: 3,
      tool: "goal_meeting_close",
      purpose: "fechar emergencia com decisao, estacionamento e acao nova",
      args: {
        flow_id: flow.flow_id,
        meeting_id: "<emergency_meeting_id>",
        participants_present: participants,
        findings: [`Loop ${loopMonitor.loop_id} exige emergencia fiscal.`],
        decision: "Nao repetir a mesma acao; escolher acao nova ou preparar encerramento LOOP RUIM.",
        satisfies_blockers: []
      }
    },
    { order: 4, tool: "goal_status", purpose: "confirmar estado apos emergencia", args: { flow_id: flow.flow_id } }
  ];
}

function badLoopReviewSequence(flow: Flow, loopMonitor: LoopMonitor): Array<Record<string, unknown>> {
  const workspace = flow.goal_binding?.envelope.workspace ?? "<WORKSPACE>";
  return [
    {
      order: 1,
      tool: "use_skill",
      purpose: "acionar estacionamento para selecionar achados, pendencias e pontos cegos vivos",
      args: { skill: "estacionamento", flow_id: flow.flow_id, loop_id: loopMonitor.loop_id, action: "selecionar achados e pendencias do loop" },
      skill_resolution: cooperatorSkillResolution(workspace, "estacionamento", "Fila viva de achados, pendencias, pontos cegos e retomada do loop.")
    },
    {
      order: 2,
      tool: "use_skill",
      purpose: "acionar garimpeiro para separar ouro, armadilha recorrente e descarte",
      args: { skill: "garimpeiro", flow_id: flow.flow_id, loop_id: loopMonitor.loop_id, action: "curar achados reutilizaveis do loop" },
      skill_resolution: cooperatorSkillResolution(workspace, "garimpeiro", "Curador de aprendizados reutilizaveis, armadilhas recorrentes e descarte honesto.")
    },
    {
      order: 3,
      tool: "evidence_add",
      purpose: "documentar encerramento fiscal do loop ruim",
      args: {
        flow_id: flow.flow_id,
        kind: "bad_loop_report",
        title: "LOOP RUIM REVISAR TRABALHO",
        content: `loop_id=${loopMonitor.loop_id}; count=${loopMonitor.count}; blockers=${loopMonitor.blockers.join(", ")}; achados estacionados e garimpados antes de finalizar.`,
        satisfies: ["bad_loop_documented"]
      }
    },
    {
      order: 4,
      tool: "goal_verdict",
      purpose: "finalizar sem falso-verde: decretar bloqueado/nao_pronto",
      args: {
        flow_id: flow.flow_id,
        status: "bloqueado",
        rationale: "LOOP RUIM REVISAR TRABALHO: limite de repeticao atingido sem progresso suficiente.",
        evidence_ids: ["<bad_loop_report_evidence_id>"],
        residual_risks: ["trabalho precisa ser revisado antes de nova tentativa"],
        next_step: "revisar metodo, contrato e evidencias antes de reabrir"
      }
    }
  ];
}

function researcherSkillResolution(workspace: string): Record<string, unknown> {
  return {
    required_skill: "pesquisador-organizado",
    lookup_paths: [
      `${USER_PROFILE_POINTER}\\.agents\\skills\\pesquisador-organizado\\SKILL.md`,
      `${USER_PROFILE_POINTER}\\.codex\\skills\\pesquisador-organizado\\SKILL.md`,
      `${workspace}\\.agents\\skills\\pesquisador-organizado\\SKILL.md`
    ],
    if_missing: {
      action: "create_local_skill",
      target: `${workspace}\\.agents\\skills\\pesquisador-organizado\\SKILL.md`,
      role: "Pesquisador Organizado local: pesquisar causas, fontes e saidas para destravar loop ruim, salvar relatorio em .agents/PESQUISA e retornar evidencias rastreaveis.",
      minimum_contract: [
        "nao ler .env, config.toml, tokens, cookies, Authorization ou payload sensivel",
        "usar fontes locais permitidas e web/oficial quando disponivel",
        "salvar relatorio, raw-notes.md e sources.json em .agents/PESQUISA",
        "registrar lacunas e nao declarar conclusao forte sem evidencia",
        "retornar caminhos dos artefatos e achados principais"
      ],
      gate: "permitido como fallback local quando a skill global nao existir; registrar evidencia da criacao"
    },
    fallback: {
      action: "execute_local_contract",
      evidence_required: true,
      merit_rule: "nao vira merito automatico; material=true somente se pesquisa executada e evidenciada"
    }
  };
}

function cooperatorSkillResolution(workspace: string, skill: string, role: string): Record<string, unknown> {
  return {
    required_skill: skill,
    lookup_paths: [
      `${USER_PROFILE_POINTER}\\.agents\\skills\\${skill}\\SKILL.md`,
      `${USER_PROFILE_POINTER}\\.codex\\skills\\${skill}\\SKILL.md`,
      `${workspace}\\.agents\\skills\\${skill}\\SKILL.md`
    ],
    if_missing: {
      action: "execute_inline_fallback_or_create_local_skill_proposal",
      target: `${workspace}\\.agents\\skills\\${skill}\\SKILL.md`,
      role,
      gate: "criar skill local somente se a ausencia bloquear o fluxo ou virar erro recorrente; caso contrario executar fallback resumido"
    },
    fallback: {
      action: "execute_local_summary_contract",
      evidence_required: true,
      merit_rule: "nao vira merito automatico; material=true somente se houve contribuicao registrada e evidenciada"
    }
  };
}

function reviewRequiredSequence(flow: Flow): Array<Record<string, unknown>> {
  const scopeReference = flow.changed_files[0] ?? flow.scope.in[0] ?? "<required:exact scope.in or changed_files reference>";
  return [
    {
      order: 1,
      tool: "evidence_add",
      purpose: "anexar revisao explicita com achados reais, riscos, escopo revisado e decisao",
      args: {
        flow_id: flow.flow_id,
        kind: "code_review",
        title: "Revisao adversarial do SPT / artefatos finais",
        content:
          "Escopo revisado: <arquivos/artefatos>. Achados: <lista real>. Riscos: <risco residual>. Decisao: <bloquear/liberar com ressalva>.",
        satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
        observed_result: {
          diff_reviewed: true,
          reviewed_targets: [scopeReference],
          barata_scan: true,
          searched_patterns: ["<required:padroes ou consumidores vizinhos realmente pesquisados>"],
          findings: [],
          regression_risks: []
        },
        scope_classification: "target",
        scope_reference: scopeReference,
        operator_must_replace: ["content", "observed_result.searched_patterns", "observed_result.findings", "observed_result.regression_risks"]
      },
      capture: "review_evidence_id"
    },
    {
      order: 2,
      tool: "goal_status",
      purpose: "confirmar que review_required saiu dos blockers antes de qualquer veredito",
      args: { flow_id: flow.flow_id }
    },
    {
      order: 3,
      tool: "goal_verdict",
      purpose: "somente se goal_status nao listar review_required; incluir evidence_ids e review_findings reais",
      only_if: "goal_status.blockers nao contem review_required",
      args: {
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        evidence_ids: ["<review_evidence_id>", "<evidence_ids_obrigatorias>"],
        review_findings: ["<achado real de review>"],
        rationale: "Veredito apos review explicita e blockers fiscais resolvidos.",
        next_step: "arquivar ou executar pendencia rastreavel"
      }
    }
  ];
}

function memoryMiningRequiredSequence(flow: Flow): Array<Record<string, unknown>> {
  return [
    {
      order: 1,
      tool: "mm_memory_mining",
      purpose: "executar garimpo/classificacao canonica de memoria no flow antes de novo veredito positivo",
      args: { flow_id: flow.flow_id, auto_classify: true, write_policy: "auto_write" },
      capture: "memory_mining_summary"
    },
    {
      order: 2,
      tool: "goal_status",
      purpose: "confirmar que memory_required_but_empty saiu dos blockers antes de repetir goal_verdict",
      args: { flow_id: flow.flow_id }
    },
    {
      order: 3,
      tool: "goal_verdict",
      purpose: "somente se goal_status nao listar memory_required_but_empty e os demais blockers estiverem resolvidos",
      only_if: "goal_status.blockers nao contem memory_required_but_empty",
      args: {
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        evidence_ids: ["<evidence_ids_obrigatorias>"],
        meeting_id: "<meeting_id_se_required_cooperation_estava_ativo>",
        rationale: "Veredito apos mm_memory_mining canonico e blockers fiscais resolvidos.",
        residual_risks: ["<risco residual ou nenhum>"],
        next_step: "<proximo passo com quando>"
      }
    }
  ];
}

function memoryMiningBlockedAction(
  flow: Flow,
  backTo: AnyPhase | null,
  regressCount: number,
  regressLimitReached: boolean
): Record<string, unknown> {
  const status = flow.memory_mining;
  return {
    type: "resolve_memory_candidates",
    tool: "mm_memory_candidate_resolve",
    reason:
      `memory_mining bloqueou veredito: strong_unwritten_count=${numericMemoryField(status, "strong_unwritten_count")}, ` +
      `ledger_only_count=${numericMemoryField(status, "ledger_only_count")}, blocked_count=${numericMemoryField(status, "blocked_count")}. ` +
      "Dar destino explicito aos candidatos antes de repetir goal_verdict.",
    back_to: backTo,
    regress_count: regressCount,
    max_regressions: FISCAL_CONFIG.maxRegressions,
    can_retry_verdict: false,
    locked_by_limit: regressLimitReached,
    candidate_resolution_options: [
      "promover para memoria L1/L2/L3 quando houver destino claro",
      "estacionar com quando/gatilho quando ainda nao for memoria canonica",
      "descartar com justificativa depois do garimpo",
      "aceitar como ledger-only nao bloqueante somente com regra e justificativa rastreaveis"
    ],
    required_tool_sequence: memoryMiningBlockedSequence(flow)
  };
}

function memoryMiningBlockedSequence(flow: Flow): Array<Record<string, unknown>> {
  return [
    {
      order: 1,
      tool: "goal_status",
      purpose: "inspecionar memory_mining.edit_queue, write_decisions, destination_warnings e strong_unwritten_count",
      args: { flow_id: flow.flow_id }
    },
    {
      order: 2,
      tool: "mm_memory_candidate_resolve",
      purpose: "registrar destino rastreavel para cada candidato forte sem rota canonica",
      args: {
        flow_id: flow.flow_id,
        candidate_ids: ["<candidate_id>"],
        action: "promote|park|discard|accept_ledger_only",
        rationale: "<justificativa rastreavel>",
        when: "<obrigatorio se action=park>",
        target_scope: "<global|tema|projeto se action=promote>"
      },
      capture: "memory_candidate_resolution"
    },
    {
      order: 3,
      tool: "mm_memory_mining",
      purpose: "reexecutar a mineracao apos dar destino claro aos candidatos fortes sem rota canonica",
      args: { flow_id: flow.flow_id, auto_classify: true, write_policy: "auto_write" },
      capture: "memory_mining_summary"
    },
    {
      order: 4,
      tool: "goal_status",
      purpose: "confirmar que memory_mining_blocked_verdict saiu dos effective_blockers",
      args: { flow_id: flow.flow_id }
    },
    {
      order: 5,
      tool: "goal_verdict",
      purpose: "somente se goal_status nao listar memory_mining_blocked_verdict nem outros blockers efetivos",
      only_if: "goal_status.blocker_diagnostics.effective_blockers vazio",
      args: {
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        evidence_ids: ["<evidence_ids_obrigatorias>"],
        rationale: "Veredito apos candidatos fortes de memoria receberem destino rastreavel.",
        residual_risks: ["<risco residual ou nenhum>"],
        next_step: "<proximo passo com quando>"
      }
    }
  ];
}

function blockerResolutionGuidance(
  blockers: string[],
  nextRequiredAction: Record<string, unknown> | null,
  loopMonitor: LoopMonitor | null
): Record<string, unknown> | null {
  if (blockers.length === 0 || !nextRequiredAction) {
    return null;
  }
  return {
    summary: loopMonitor?.escalation.active
      ? "loop fiscal detectado; nao repetir a mesma acao, executar escalonamento por loop_monitor"
      : "nao repetir goal_verdict enquanto can_retry_verdict=false; executar next_required_action.required_tool_sequence na ordem",
    blockers,
    loop_guard: "se required_cooperation reaparecer, verificar reuniao aberta/fechada e satisfies_blockers antes de abrir nova reuniao",
    loop_monitor: loopMonitor,
    next_required_action: nextRequiredAction
  };
}

function fiscalLoopMonitor(flow: Flow, blockers: string[]): LoopMonitor | null {
  const activeBlockers = unique(blockers).sort();
  if (activeBlockers.length === 0) {
    return null;
  }
  const signature = blockerSignature(activeBlockers);
  const loopId = blockerLoopId(activeBlockers);
  const windowEvents = loopWindowEvents(flow, signature);
  const terminalWindowEvents = loopWindowEvents(flow, signature, false);
  const fiscalBlockCount = windowEvents.filter(
    (event) => event.type === "fiscal_policy_blocked" && String(event.data.loop_signature ?? blockerSignature(stringArray(event.data.blocking_reasons))) === signature
  ).length;
  const gateBlockCount = windowEvents.filter(
    (event) => event.type === "gate_checked" && event.data.status === "blocked" && blockerSignature(stringArray(event.data.missing)) === signature
  ).length;
  const terminalBlockCount = terminalWindowEvents.filter(
    (event) =>
      event.type === "goal_terminal_blocked" &&
      String(event.data.loop_signature ?? blockerSignature(stringArray(event.data.blocking_reasons))) === signature
  ).length;
  const reviewRegressCount = windowEvents.filter((event) => {
    if (event.type !== "phase_returned" || String(event.data.to) !== "revisao") {
      return false;
    }
    const text = [event.data.reason, ...(Array.isArray(event.data.evidence_ids) ? event.data.evidence_ids : [])].filter(Boolean).join("\n");
    return /review|revis|block|fiscal/i.test(text);
  }).length;
  const count = Math.max(fiscalBlockCount, gateBlockCount, terminalBlockCount, reviewRegressCount);
  return {
    loop_id: loopId,
    signature,
    blockers: activeBlockers,
    count,
    fiscal_block_count: fiscalBlockCount,
    gate_block_count: gateBlockCount,
    terminal_block_count: terminalBlockCount,
    review_regress_count: reviewRegressCount,
    reset_policy: "contagem considera apenas a janela desde o ultimo progresso: evidencia, reuniao fechada, memoria minerada, fase avancada, veredito ou blocker diferente; gate passado reseta loops de gate/fiscal, mas nao apaga retries terminais com a mesma assinatura",
    escalation: loopEscalationFor(count)
  };
}

function strongestLoopMonitor(flow: Flow, ...blockerSets: string[][]): LoopMonitor | null {
  const monitors = blockerSets
    .map((blockers) => fiscalLoopMonitor(flow, blockers))
    .filter((monitor): monitor is LoopMonitor => monitor !== null);
  return monitors.reduce<LoopMonitor | null>(
    (strongest, monitor) => !strongest || monitor.count > strongest.count ? monitor : strongest,
    null
  );
}

function loopWindowEvents(flow: Flow, signature: string, resetOnPassedGate = true): Flow["history"] {
  const history = flow.history;
  let start = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (isLoopResetEvent(history[index], signature, resetOnPassedGate)) {
      start = index + 1;
      break;
    }
  }
  return history.slice(start);
}

function isLoopResetEvent(event: Flow["history"][number], signature: string, resetOnPassedGate: boolean): boolean {
  if (event.type === "fiscal_policy_blocked" || event.type === "goal_terminal_blocked") {
    const eventSignature = String(event.data.loop_signature ?? blockerSignature(stringArray(event.data.blocking_reasons)));
    return eventSignature !== signature;
  }
  if (resetOnPassedGate && event.type === "gate_checked" && event.data.status === "passed") {
    return true;
  }
  return ["evidence_attached", "meeting_closed", "memory_mined", "phase_advanced", "verdict_recorded", "flow_completed", "flow_archived"].includes(event.type);
}

function loopEscalationFor(count: number): LoopMonitor["escalation"] {
  if (count >= 9) {
    return { active: true, level: "bad_loop_review_work", threshold: 9, label: "LOOP RUIM REVISAR TRABALHO" };
  }
  if (count >= 8) {
    return { active: true, level: "emergency_meeting", threshold: 8, label: "reuniao de emergencia com mais especialistas" };
  }
  if (count >= 6) {
    return { active: true, level: "research_subagent", threshold: 6, label: "acionar pesquisador organizado/subagente" };
  }
  if (count >= 5) {
    return { active: true, level: "divergence_transversal", threshold: 5, label: "reunioes divergente e transversal" };
  }
  if (count >= 3) {
    return { active: true, level: "convergence_transversal", threshold: 3, label: "reunioes convergente e transversal" };
  }
  return { active: false, level: "monitoring", threshold: null, label: "monitorando repeticao sem escalonamento" };
}

function blockerSignature(blockers: string[]): string {
  return unique(blockers).sort().join("|");
}

function blockerLoopId(blockers: string[]): string {
  const token = blockerSignature(blockers)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return `loop_${token || "unknown"}`;
}

function structuredLibrarianStatus(raw: RecallVisualStatus | null): StructuredLibrarianStatus {
  const librarianStatus = raw?.status ?? "disabled";
  const graphifyConfigured = graphifyRecallConfigured();
  const graphifyStatus = raw?.graphify_status ?? (graphifyConfigured ? "empty" : "disabled");
  const librarianFunctionalTested = raw !== null && librarianStatus !== "disabled" && (raw.recalled_count > 0 || raw.warnings.length > 0);
  const graphifyFunctionalTested =
    raw !== null && graphifyStatus !== "disabled" && (raw.recalled_count > 0 || raw.warnings.some((warning) => /graphify/i.test(warning)));
  const recallExecuted = raw?.recall_executed === true;
  const consumptionConfirmed = raw?.consumption_confirmed === true;
  const graphifyConsumptionConfirmed = raw?.graphify_consumption_confirmed === true;
  return {
    bibliotecario: {
      enabled: librarianStatus !== "disabled",
      status: librarianStatus,
      reason: raw ? librarianReason(librarianStatus) : "await_beforePhase_or_report_disabled",
      visible: true,
      functional_tested: librarianFunctionalTested,
      recall_executed: recallExecuted,
      consumption_confirmed: consumptionConfirmed
    },
    graphify: {
      enabled: graphifyConfigured || graphifyStatus !== "disabled",
      configured: graphifyConfigured,
      status: graphifyStatus,
      reason: raw ? graphifyReason(graphifyStatus) : graphifyConfigured ? "configured_awaiting_beforePhase_functional_test" : "optional_disabled_reported",
      visible: true,
      functional_tested: graphifyFunctionalTested,
      recall_executed: recallExecuted && graphifyStatus !== "disabled",
      consumption_confirmed: graphifyConsumptionConfirmed
    },
    warnings: raw?.warnings ?? [],
    recalled_count: raw?.recalled_count ?? 0,
    functional_tested: librarianFunctionalTested || graphifyFunctionalTested,
    recall_executed: recallExecuted,
    consumption_confirmed: consumptionConfirmed
  };
}

function librarianReason(status: StructuredLibrarianStatus["bibliotecario"]["status"]): string {
  if (status === "disabled") {
    return "await_beforePhase_or_report_disabled";
  }
  if (status === "recalled") {
    return "beforePhase_recalled_memory";
  }
  if (status === "empty") {
    return "beforePhase_ran_without_recall_items";
  }
  return `beforePhase_${status}`;
}

function graphifyReason(status: StructuredLibrarianStatus["graphify"]["status"]): string {
  if (status === "disabled") {
    return "optional_disabled_reported";
  }
  if (status === "recalled") {
    return "graphify_recalled";
  }
  if (status === "empty") {
    return "graphify_enabled_no_hits";
  }
  return `graphify_${status}`;
}

function checkInTrailAlignment(flow: Flow): Record<string, unknown> {
  const envelope = flow.goal_binding?.envelope;
  const mcpCwd = process.cwd();
  const workspace = envelope?.workspace;
  return {
    mcp_cwd: mcpCwd,
    workspace: workspace ?? null,
    spt_path: envelope?.spt_path ?? null,
    goal: flow.goal,
    evidence_required: envelope?.evidence_required ?? false,
    required_evidence_count: envelope?.required_evidence.length ?? 0,
    cwd_matches_workspace: workspace ? path.resolve(mcpCwd) === path.resolve(workspace) : null,
    adjustment_targets: [
      "mcp_cwd",
      "workspace",
      "spt_path",
      "goal",
      "required_evidence",
      "visible_components",
      "blockers"
    ]
  };
}

function ppirtvCheckIn(
  flow: Flow,
  requiredCooperation: Cooperator[],
  librarianStatus: StructuredLibrarianStatus,
  blockers: string[],
  resolutionGuidance: Record<string, unknown> | null = null
): Record<string, unknown> {
  const graphifyStatus = librarianStatus.graphify.status;
  const meetingRequired = blockers.includes("required_cooperation");
  const cooRequired = meetingRequired || requiredCooperation.length > 0;
  const cooVisible = requiredCooperation.length > 0 || flow.cooperators.length > 0;
  const meetingToolAvailable = true;
  const librarianGraphifyRequired = blockers.includes("librarian_status");
  const graphifyConfigured = librarianStatus.graphify.configured === true;
  const graphifyFunctionalPending =
    (librarianGraphifyRequired || graphifyConfigured) && librarianStatus.graphify.status !== "failed" && !librarianStatus.graphify.functional_tested;
  const graphifyConfigMismatch = graphifyConfigured && librarianStatus.graphify.status === "disabled";
  const librarianConfiguredButUntested =
    librarianGraphifyRequired && librarianStatus.bibliotecario.status !== "failed" && !librarianStatus.bibliotecario.functional_tested;
  const checkinBlockers = unique([
    ...blockers,
    ...(meetingRequired && !meetingToolAvailable ? ["meeting_tool_unavailable"] : []),
    ...(librarianGraphifyRequired && !librarianStatus.functional_tested ? ["librarian_or_graphify_not_functional"] : []),
    ...(graphifyConfigMismatch ? ["graphify_config_mismatch"] : []),
    ...(librarianConfiguredButUntested ? ["bibliotecario_config_mismatch"] : [])
  ]);
  const ppiRequired =
    (cooRequired && !cooVisible) ||
    librarianStatus.bibliotecario.status === "failed" ||
    librarianStatus.graphify.status === "failed" ||
    checkinBlockers.length > 0;
  return {
    phase: flow.phase,
    mode: flow.goal_binding ? (checkinBlockers.length > 0 ? "goal_fiscal_blocked" : "goal_fiscal_capable") : "advisory",
    blockers: checkinBlockers,
    meeting_required: meetingRequired,
    meeting_tool_available: meetingToolAvailable,
    regress_required: checkinBlockers.length > 0 && countRegressions(flow) < FISCAL_CONFIG.maxRegressions,
    resolution_guidance: resolutionGuidance,
    initial_adjustment_required: ppiRequired || checkinBlockers.length > 0,
    trail_alignment: checkInTrailAlignment(flow),
    components: [
      { name: "ppirtv", status: "online", visible: true, auto_repair: "already_visible" },
      {
        name: "coo",
        status: cooVisible ? "visible" : cooRequired ? "needs_visibility" : "not_required",
        visible: cooVisible,
        auto_repair: cooVisible ? "already_visible" : cooRequired ? "required_cooperation_generated" : "not_required_without_required_cooperation"
      },
      {
        name: "bibliotecario",
        status: librarianStatus.bibliotecario.status,
        visible: librarianStatus.bibliotecario.visible,
        functional_required: librarianGraphifyRequired,
        functional_tested: librarianStatus.bibliotecario.functional_tested,
        needs_adjustment: librarianGraphifyRequired && !librarianStatus.bibliotecario.functional_tested,
        auto_repair:
          librarianGraphifyRequired && !librarianStatus.bibliotecario.functional_tested
            ? "executar beforePhase/recall funcional ou corrigir configuracao antes do trabalho real"
            : librarianStatus.bibliotecario.reason
      },
      {
        name: "graphify",
        status: graphifyStatus,
        visible: librarianStatus.graphify.visible,
        configured: graphifyConfigured,
        functional_required: librarianGraphifyRequired,
        functional_tested: librarianStatus.graphify.functional_tested,
        needs_adjustment: graphifyFunctionalPending || graphifyConfigMismatch,
        auto_repair:
          graphifyFunctionalPending || graphifyConfigMismatch
            ? `validar Graphify Recall funcional ou corrigir ${RUNTIME_ENV.graphifyRecall} antes do trabalho real`
            : librarianStatus.graphify.reason
      },
      {
        name: "meeting_tools",
        status: meetingToolAvailable ? "available" : "unavailable",
        visible: meetingToolAvailable,
        auto_repair: meetingToolAvailable ? "goal_meeting_open_add_turn_close_and_goal_regress_exported" : "exportar_tools_de_reuniao_regresso"
      },
      {
        name: "ppi",
        status: ppiRequired ? "required" : "ready",
        visible: true,
        auto_repair: ppiRequired ? "acionar_ppi_para_resolver_visibilidade_ou_configuracao" : "standing_by"
      }
    ],
    ppi_action_required: ppiRequired,
    direct_action: ppiRequired
      ? `check-in bloqueado: ${checkinBlockers.join(", ")}`
      : checkinBlockers.length > 0
        ? `check-in visivel com bloqueios fiscais: ${checkinBlockers.join(", ")}`
        : "check-in visivel"
  };
}

// BUG 5 (detail compact): helper para omitir arrays grandes do checkout
// quando detail=compact. Mantem contagem para preservar sinal diagnostico.
function compactPpirtvCheckout(checkout: Record<string, unknown>, detail: "compact" | "full"): Record<string, unknown> {
  if (detail !== "compact") {
    return checkout;
  }
  const prestacao = checkout.prestacao_de_contas;
  // prestacao_de_contas pode ser array (legado) ou objeto com chaves
  // (utilidade, memoria, evidencias, etc.). Contar de forma compativel.
  const prestacaoCount = Array.isArray(prestacao)
    ? prestacao.length
    : (prestacao && typeof prestacao === "object" ? Object.keys(prestacao).length : 0);
  const meetingAccountability = checkout.meeting_outcome_accountability as Record<string, unknown> | undefined;
  const compactMeetingAccountability = meetingAccountability
    ? Object.fromEntries(Object.entries(meetingAccountability).filter(([key]) => key !== "outcomes"))
    : undefined;
  const { prestacao_de_contas, ready_definition, gate_final_output, final_report_model, ...rest } = checkout;
  return {
    ...rest,
    meeting_outcome_accountability: compactMeetingAccountability,
    prestacao_de_contas_count: prestacaoCount
  };
}

function ppirtvCheckOut(
  flow: Flow,
  librarianStatus: StructuredLibrarianStatus,
  blockers: string[],
  resolutionGuidance: Record<string, unknown> | null = null,
  blockerDiagnostics: BlockerDiagnostics | null = null,
  runtimeLayoutStatus: RuntimeLayoutStatus | null = null,
  phaseState: {
    phase_blockers: string[];
    closure_blockers: string[];
    phase_advance_allowed: boolean;
  } = { phase_blockers: [], closure_blockers: [], phase_advance_allowed: false }
): Record<string, unknown> {
  const latestVerdict = flow.verdicts.at(-1);
  const closed = flow.status === "complete" || flow.status === "archived";
  const memoryMining = memoryMiningStatus(flow);
  const memoryAccountability = memoryCheckoutAccountability(flow, memoryMining);
  const learningAccountability = learningCheckoutAccountability(flow);
  const cooperationAccountability = cooperationCheckoutAccountability(flow);
  const librarianAccountability = librarianCheckoutAccountability(librarianStatus);
  const loopAccountability = loopCheckoutAccountability(flow, blockers);
  const evidenceAccountability = evidenceCheckoutAccountability(flow);
  const meetingOutcomes = meetingOutcomeSummaries(flow);
  const meetingOutcomeAccountability = {
    outcomes: meetingOutcomes,
    consumed_count: meetingOutcomes.filter((item) => item.consumed === true).length,
    closed_unconsumed_count: meetingOutcomes.filter((item) => item.traceability_status === "closed_unconsumed").length,
    unattributed_legacy_count: meetingOutcomes.filter((item) => item.traceability_status === "unattributed_legacy").length,
    semantic_effectiveness: "not_measured",
    rule: "traceable downstream consumption is measurable; semantic effectiveness requires independent product evidence"
  };
  const contractAccountability = {
    ...operationalContractMeta(),
    ready_definition: readyDefinition(),
    gate_final_output: gateFinalOutput(),
    final_report_model: finalReportModel(),
    default_workflow: defaultWorkflow(),
    secret_env_consumption_policy: secretEnvConsumptionPolicy(),
    early_security_proportionality_policy: earlySecurityProportionalityPolicy()
  };
  const utilityAccountability = utilityCheckoutAccountability({
    flow,
    memory: memoryAccountability,
    learning: learningAccountability,
    cooperation: cooperationAccountability,
    librarian: librarianAccountability,
    loop: loopAccountability
  });
  return {
    complete: closed,
    status: flow.status,
    phase_blockers: phaseState.phase_blockers,
    closure_blockers: phaseState.closure_blockers,
    phase_advance_allowed: phaseState.phase_advance_allowed,
    verdict: latestVerdict?.status ?? null,
    project_root: runtimeLayoutStatus?.project_root ?? null,
    ppirtv_home: runtimeLayoutStatus?.ppirtv_home ?? null,
    runtime_layout_status: runtimeLayoutStatus,
    meetings_count: flow.meetings.length,
    meeting_outcome_accountability: meetingOutcomeAccountability,
    evidence_count: flow.evidence.length,
    evidence_accountability: evidenceAccountability,
    review_visible: flow.evidence.some((evidence) => /review|revisor|diff/i.test([evidence.kind, evidence.title, evidence.note, evidence.content].filter(Boolean).join("\n"))),
    tests_visible: flow.evidence.some((evidence) => /test|teste|vitest|npm run check/i.test([evidence.kind, evidence.title, evidence.note, evidence.content].filter(Boolean).join("\n"))),
    garimpo_count: flow.gold_mining.length,
    estacionamento_count: flow.parking_lot.length,
    memory_mining: memoryMining,
    librarian_status: librarianStatus,
    memory_accountability: memoryAccountability,
    learning_accountability: learningAccountability,
    cooperation_accountability: cooperationAccountability,
    librarian_accountability: librarianAccountability,
    work_progress: workProgressSummary(flow),
    loop_accountability: loopAccountability,
    contract_accountability: contractAccountability,
    ready_definition: contractAccountability.ready_definition,
    gate_final_output: contractAccountability.gate_final_output,
    final_report_model: contractAccountability.final_report_model,
    default_workflow: contractAccountability.default_workflow,
    utility_accountability: utilityAccountability,
    prestacao_de_contas: {
      utilidade: utilityAccountability,
      memoria: memoryAccountability,
      evidencias: evidenceAccountability,
      garimpo: learningAccountability.garimpado,
      estacionamento: learningAccountability.estacionado,
      pontos_cegos: learningAccountability.pontos_cegos,
      cooperadores: cooperationAccountability,
      reunioes: meetingOutcomeAccountability,
      bibliotecario: librarianAccountability,
      loops: loopAccountability,
      contrato_operacional: contractAccountability
    },
    residual_risks: latestVerdict?.residual_risks ?? [],
    resolution_guidance: resolutionGuidance,
    blocker_diagnostics: blockerDiagnostics,
    direct_action: blockers.length > 0
      ? `check-out bloqueado: ${blockers.join(", ")}; executar resolution_guidance.next_required_action antes de veredito positivo`
      : closed
        ? "fechamento_total_registrado"
        : "check-out pendente ate veredito/arquivo"
  };
}

function evidenceCheckoutAccountability(flow: Flow): Record<string, unknown> {
  const items = flow.evidence.map((evidence) => ({
    evidence_id: evidence.evidence_id,
    title: evidence.title,
    kind: evidence.kind,
    quality: classifyEvidenceQuality(evidence)
  }));
  const weakCount = items.filter((item) => item.quality.status === "weak").length;
  const missingContextCount = items.filter((item) => item.quality.status === "missing_context").length;
  const strongCount = items.filter((item) => item.quality.status === "strong").length;
  return {
    total: items.length,
    strong_count: strongCount,
    weak_count: weakCount,
    missing_context_count: missingContextCount,
    legacy_unclassified_count: items.filter((item) => item.quality.status === "legacy_unclassified").length,
    blocks_ready: items.some((item) => item.quality.blocking),
    policy: "aditivo: evidencia fraca e visivel como WARN; nao bloqueia legado neste corte",
    items
  };
}

function classifyEvidenceQuality(evidence: Evidence): EvidenceQuality {
  if (!evidence.created_at) {
    return {
      status: "legacy_unclassified",
      blocking: false,
      reasons: ["evidencia legada sem metadados suficientes para classificacao forte"],
      missing_fields: []
    };
  }
  const text = [evidence.kind, evidence.title, evidence.uri, evidence.content, evidence.note, ...evidence.gold_mining].filter(Boolean).join("\n");
  const checks = {
    origin: /origem|origin|source/i.test(text),
    objective: /objetivo|objective|goal/i.test(text),
    phase: /fase|phase|pensamentos|planejamento|implementacao|revisao|teste|validacao/i.test(text),
    procedure: /procedimento|procedure|comando|command|npm|vitest|teste|test/i.test(text),
    observed_result: /resultado|result|observado|observed|pass|passed|fail|failed|falh/i.test(text),
    limitation: /limitacao|limitação|limitation|risco|ressalva|residual/i.test(text),
    flow_reference: Boolean(evidence.flow_id)
  };
  const missingFields = Object.entries(checks)
    .filter(([, checked]) => !checked)
    .map(([field]) => field);
  const hasTrace = Boolean(evidence.uri || evidence.content || evidence.note || evidence.gold_mining.length > 0);
  const status = !hasTrace || missingFields.length >= 4 ? "weak" : missingFields.length <= 1 ? "strong" : "missing_context";
  return {
    status,
    blocking: false,
    reasons: evidenceQualityReasons(status, hasTrace, missingFields),
    missing_fields: missingFields
  };
}

function reviewEvidenceRequested(input: { kind?: string; satisfies?: string[] }): boolean {
  if (/^(?:code_)?review$/i.test(input.kind ?? "")) {
    return true;
  }
  const reviewClaims = new Set(["diff_reviewed", "barata_scan", "regression_risks", "review_required"]);
  return (input.satisfies ?? []).some((claim) => reviewClaims.has(claim));
}

function structuredReviewAttestationRequested(input: { kind?: string; satisfies?: string[] }): boolean {
  return /^(?:code_)?review$/i.test(input.kind ?? "")
    && (input.satisfies ?? []).some((claim) =>
      ["diff_reviewed", "barata_scan", "regression_risks"].includes(claim)
    );
}

function evidenceQualityReasons(status: EvidenceQuality["status"], hasTrace: boolean, missingFields: string[]): string[] {
  const reasons: string[] = [];
  if (!hasTrace) {
    reasons.push("sem conteudo, nota, uri ou satisfacao rastreavel");
  }
  if (missingFields.length > 0) {
    reasons.push(`campos ausentes: ${missingFields.join(", ")}`);
  }
  if (status === "strong") {
    reasons.push("evidencia contem contexto operacional suficiente para auditoria inicial");
  }
  return reasons;
}

function goalEvidenceMetadataNote(flow: Flow, input: { title: string; content?: string; uri?: string; note?: string }): string | undefined {
  if (!input.content && !input.uri && !input.note) {
    return undefined;
  }
  return [
    "Metadados PPIRTV:",
    "Origem: evidence_add.",
    "Objetivo: declarado no GoalEnvelope/flow.",
    `Fase: ${flow.phase}.`,
    `Procedimento: ${input.title}.`,
    "Limitacao: nao informada pelo operador; revisar risco residual no veredito."
  ].join(" ");
}

function mergeEvidenceNotes(note: string | undefined, metadata: string | undefined): string | undefined {
  return [note, metadata].filter(Boolean).join("\n") || undefined;
}

function deriveVerdictLearning(
  input: FiscalVerdictInput,
  evidences: Evidence[]
): { gold_mining: string[]; parking_lot: string[]; review_findings: string[] } {
  const reviewFindings = input.review_findings ?? [];
  const explicitGold = input.verdict_gold_mining ?? [];
  const explicitParking = input.verdict_parking_lot ?? [];
  const gold = [
    ...explicitGold,
    ...reviewFindings.map((finding) => `Achado de review: ${finding}`),
    ...(isStrongLearningText(input.rationale) ? [`Achado garimpado do veredito: ${input.rationale}`] : [])
  ];
  const parking = [
    ...explicitParking,
    ...(input.residual_risks ?? []).map((risk) => `Risco residual estacionado: ${risk}`),
    ...(input.review_artifact_path ? [`Artefato de review para consulta: ${input.review_artifact_path}`] : []),
    ...evidences.map((evidence) => `Evidencia usada no veredito: ${evidence.title}${evidence.uri ? ` -> ${evidence.uri}` : ""}`)
  ];
  return {
    gold_mining: unique(gold),
    parking_lot: unique(parking),
    review_findings: unique(reviewFindings)
  };
}

function isStrongLearningText(value: string | undefined): boolean {
  return Boolean(value && /(falso verde|contrato|princip|harness|canonical|case|CPU|RTX|CUDA|Graphify|MCP|PPIRTV|loop|bloque|regress|falh)/i.test(value));
}

const FUTURE_ACTION_PATTERN = /\b(resolv|corrig|implement|valid|revis|test|cri|abr|execut|fa[cz]|ajust|migr|refator|document|submet|envia|public|deploy|build|compil|rodar?|investig|diagnostic|analis|medir|monitor|otimiz|limp|remove|substitu|atualiz|configur|instal|deslig|liga)\w*\b|depois|mais tarde|futuro|pr[oó]ximo|em breve|oportunamente|quando der|abrir issue|criar PR|submeter PR|ver iss|olhar iss|pensar em/i;
const QUANDO_INDICATOR = /\b(202[0-9]|20[3-9][0-9]|janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|semana que vem|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|quando|ao receber|assim que|no momento em que|semanalmente|diariamente|a cada|todo dia|toda semana|depende de|bloqueado por|revisar em|validar ap[óo]s|daqui a|vence|prazo|at[ée] |respons[áa]vel|gatilho|cad[êe]ncia|janela de|condi[çc][ãa]o de|crit[ée]rio de|desbloquead|retomad)/i;

function hasFutureAction(text: string): boolean {
  return FUTURE_ACTION_PATTERN.test(text);
}

function hasQuando(text: string): boolean {
  return QUANDO_INDICATOR.test(text);
}

function missingQuandoGate(nextStep: string): string | null {
  if (!nextStep || !hasFutureAction(nextStep)) {
    return null;
  }
  if (hasQuando(nextStep)) {
    return null;
  }
  return "Gate do Quando: next_step promete acao futura sem quando verificavel (data, gatilho, cadencia, condicao, janela, vencimento, dependencia ou responsavel). Veredito rebaixado para pronto_com_ressalvas.";
}

function latestTraceableCandidateResolutionMap(flow: Flow): Map<string, MemoryCandidateResolution> {
  const result = new Map<string, MemoryCandidateResolution>();
  for (const resolution of flow.memory_candidate_resolutions ?? []) {
    if (isTraceableCandidateResolution(resolution)) {
      result.set(resolution.candidate_id, resolution);
    }
  }
  return result;
}

function isTraceableCandidateResolution(resolution: MemoryCandidateResolution): boolean {
  if (!resolution.traceable || !resolution.candidate_id || !resolution.rationale?.trim()) {
    return false;
  }
  if (resolution.action === "park") {
    return Boolean(resolution.when?.trim());
  }
  if (resolution.action === "promote") {
    return isPromotionScope(resolution.target_scope ?? "projeto") && (resolution.target_scope !== "tema" || Boolean(resolution.theme?.trim()));
  }
  return resolution.action === "discard" || resolution.action === "accept_ledger_only";
}

function applyMemoryCandidateResolution(
  candidate: MemoryCandidate,
  resolution: MemoryCandidateResolution | undefined,
  workspace: string,
  dexMemoriaHome: string
): MemoryCandidate {
  if (!resolution || !isTraceableCandidateResolution(resolution)) {
    return candidate;
  }
  if (resolution.action === "promote") {
    const scope = resolution.target_scope ?? "projeto";
    const theme = scope === "tema" ? resolution.theme ?? candidate.theme : candidate.theme;
    return {
      ...candidate,
      scope,
      theme,
      target_files: memoryTargetFilesForResolution(scope, theme, workspace, dexMemoriaHome),
      blocked: false,
      blocked_reason: null,
      has_l1: true
    };
  }
  if (resolution.action === "park") {
    return { ...candidate, scope: "estacionamento", target_files: [], blocked: false, blocked_reason: null };
  }
  if (resolution.action === "discard") {
    return { ...candidate, scope: "descartar", target_files: [], blocked: false, blocked_reason: null };
  }
  return candidate;
}

function memoryTargetFilesForResolution(scope: MemoryCandidatePromoteScope, theme: string | undefined, workspace: string, dexMemoriaHome: string): string[] {
  if (scope === "global") {
    return [path.join(dexMemoriaHome, "global", "LEMBRANCA.md"), path.join(dexMemoriaHome, "global", "MEMORIA.md")];
  }
  if (scope === "tema" && theme) {
    return [path.join(dexMemoriaHome, "temas", theme, "LEMBRANCA.md"), path.join(dexMemoriaHome, "temas", theme, "MEMORIA.md")];
  }
  return [path.join(workspace, ".agents", "LEMBRANCA.md"), path.join(workspace, ".agents", "MEMORIA.md")];
}

function memoryV2Slug(item: string, fallback: string): string {
  const base = item
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const identitySuffix = fallback.toLowerCase().replace(/[^a-f0-9]/g, "").slice(-12);
  const readablePrefix = base.slice(0, 51).replace(/-+$/g, "") || "memory";
  return identitySuffix ? `${readablePrefix}-${identitySuffix}` : readablePrefix.slice(0, 64);
}

function memoryV2CandidateId(item: string): string {
  const normalized = item.normalize("NFC").replace(/\s+/g, " ").trim();
  return `mc_${createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 24)}`;
}

function memoryV2OperationId(item: string, classification: ReturnType<typeof classifyDexMemoriaV2Intent>): string {
  const materialUnit = {
    item: item.normalize("NFC").replace(/\s+/g, " ").trim(),
    target_layer: classification.route.target,
    owner_skill: classification.route.target === "L3" ? classification.route.owner_skill : null,
    tags: [...classification.tags],
    destinations: classification.destinations.map((destination) => destination.scope === "theme"
      ? { scope: destination.scope, theme: destination.theme }
      : { scope: destination.scope })
  };
  return `mmv2_${createHash("sha256").update(JSON.stringify(materialUnit), "utf8").digest("hex")}`;
}

function v2ReceiptsProveCommittedEffect(receipts: DexMemoriaV2CanonicalReceipt[]): boolean {
  return receipts.some((receipt) =>
    receipt.status === "COMMITTED"
    || Object.values(receipt.route_receipts ?? {}).some((routeReceipt) => routeReceipt?.status === "COMMITTED")
  );
}

function v2CommittedBoundaryError(error: unknown): V2CommittedBoundaryError {
  return Object.assign(
    new Error(`PPIRTV_V2_COMMITTED_STATE_PERSISTENCE_FAILED: ${errorMessage(error)}`),
    { v2_committed_effect: true as const }
  );
}

function isV2CommittedBoundaryError(error: unknown): error is V2CommittedBoundaryError {
  return error instanceof Error
    && (error as Partial<V2CommittedBoundaryError>).v2_committed_effect === true;
}

function memoryV2ReconciliationId(input: {
  flowId: string;
  writePolicy: MemoryWritePolicy;
  candidates: Array<Record<string, unknown>>;
  receipts: DexMemoriaV2CanonicalReceipt[];
  candidateResolutions: MemoryCandidateResolution[];
}): string {
  const operationIds = unique([
    ...input.candidates
      .map((candidate) => typeof candidate.operation_id === "string" ? candidate.operation_id : "")
      .filter(Boolean),
    ...input.receipts.map((receipt) => receipt.operation_id)
  ]).sort();
  const receiptIds = unique(input.receipts.flatMap((receipt) =>
    Object.values(receipt.route_receipts ?? {})
      .map((routeReceipt) => routeReceipt?.receipt_id ?? "")
      .filter(Boolean)
  )).sort();
  const resolutionIds = unique(input.candidateResolutions.map((resolution) => resolution.resolution_id)).sort();
  const candidateIds = unique(input.candidates.map((candidate) => memoryCandidateIdentity(candidate))).sort();
  const materialAttempt = {
    flow_id: input.flowId,
    write_policy: input.writePolicy,
    operation_ids: operationIds,
    receipt_ids: receiptIds,
    resolution_ids: resolutionIds,
    candidate_ids: candidateIds
  };
  return `mmv2_ledger_${createHash("sha256").update(JSON.stringify(materialAttempt), "utf8").digest("hex")}`;
}

function requireConfiguredV2Root(value: string | undefined, field: "MEMORY_HOME" | "WORKSPACE"): string {
  if (!value?.trim()) throw new Error(`PPIRTV_DEX_MEMORIA_V2_${field}_REQUIRED`);
  if (!path.isAbsolute(value)) throw new Error(`PPIRTV_DEX_MEMORIA_V2_${field}_MUST_BE_ABSOLUTE`);
  return path.resolve(value);
}

function confinedV2Workspace(input: {
  storeWorkspace: string;
  writerWorkspace: string | undefined;
  envelopeWorkspace?: string;
}): string {
  const storeWorkspace = requireConfiguredV2Root(input.storeWorkspace, "WORKSPACE");
  const writerWorkspace = requireConfiguredV2Root(input.writerWorkspace, "WORKSPACE");
  const envelopeWorkspace = input.envelopeWorkspace
    ? requireConfiguredV2Root(input.envelopeWorkspace, "WORKSPACE")
    : undefined;
  if (!sameRuntimePath(storeWorkspace, writerWorkspace)
    || (envelopeWorkspace && !sameRuntimePath(storeWorkspace, envelopeWorkspace))) {
    throw new Error(
      `PPIRTV_DEX_MEMORIA_V2_WORKSPACE_MISMATCH: store=${storeWorkspace}; writer=${writerWorkspace}; envelope=${envelopeWorkspace ?? "not_bound"}`
    );
  }
  return storeWorkspace;
}

function requestedV2MiningClassification(input: {
  v2_destinations?: DexMemoriaV2Destination[];
  v2_density?: "light" | "deep";
  v2_owner_skill?: string;
  v2_tags?: string[];
}): DexMemoriaV2MiningClassification | undefined {
  const hasAnyDirective = Boolean(input.v2_destinations || input.v2_density || input.v2_owner_skill || input.v2_tags);
  if (!hasAnyDirective) return undefined;
  if (!input.v2_destinations?.length) return { status: "unresolved", reason: "destinations_required" };
  if (!input.v2_tags?.length) return { status: "unresolved", reason: "tags_required" };
  const requestedDestinations = input.v2_destinations as [DexMemoriaV2Destination, ...DexMemoriaV2Destination[]];
  const tags = input.v2_tags as [string, ...string[]];
  if (input.v2_density === "deep") {
    if (!input.v2_owner_skill?.trim()) return { status: "unresolved", reason: "owner_skill_required" };
    return { status: "resolved", density: "deep", requested_destinations: requestedDestinations, tags, owner_skill: input.v2_owner_skill };
  }
  return { status: "resolved", density: "light", requested_destinations: requestedDestinations, tags };
}

function memoryCandidateLedgerDataWithResolution(candidate: MemoryCandidate, resolution: MemoryCandidateResolution | undefined): Record<string, unknown> {
  return {
    ...memoryCandidateLedgerData(candidate),
    ...(resolution ? { resolution: candidateResolutionLedgerData(resolution) } : {})
  };
}

function candidateResolutionLedgerData(resolution: MemoryCandidateResolution): Record<string, unknown> {
  const v2Resolution = resolution as V2MemoryCandidateResolution;
  return {
    resolution_id: resolution.resolution_id,
    candidate_id: resolution.candidate_id,
    action: resolution.action,
    rationale: resolution.rationale,
    when: resolution.when,
    target_scope: resolution.target_scope,
    theme: resolution.theme,
    candidate_tags: v2Resolution.candidate_tags,
    candidate_density: v2Resolution.candidate_density,
    candidate_destinations: v2Resolution.candidate_destinations,
    candidate_theme: v2Resolution.candidate_theme,
    candidate_owner_skill: v2Resolution.candidate_owner_skill,
    traceable: resolution.traceable,
    created_at: resolution.created_at,
    source: resolution.source
  };
}

function isPromotionScope(value: unknown): value is MemoryCandidatePromoteScope {
  return value === "global" || value === "tema" || value === "projeto";
}

function isMemoryCandidateScope(value: unknown): value is MemoryCandidateScope {
  return value === "global" || value === "tema" || value === "projeto" || value === "ledger_only" || value === "estacionamento" || value === "descartar";
}

function candidateScoreTotal(candidate: Record<string, unknown>): number | undefined {
  const score = candidate.score;
  if (!score || typeof score !== "object") {
    return undefined;
  }
  const total = (score as Record<string, unknown>).total;
  return typeof total === "number" ? total : undefined;
}

function memoryCandidateIdentity(candidate: Record<string, unknown>): string {
  const legacyIdentity = typeof candidate.id === "string" ? candidate.id : undefined;
  const v2Identity = typeof candidate.candidate_id === "string" ? candidate.candidate_id : undefined;
  if (legacyIdentity !== undefined && v2Identity !== undefined && legacyIdentity !== v2Identity) {
    throw new Error(`MEMORY_CANDIDATE_IDENTITY_CONFLICT: id=${legacyIdentity}; candidate_id=${v2Identity}`);
  }
  const identity = (v2Identity ?? legacyIdentity ?? "").trim();
  if (!identity) {
    throw new Error("MEMORY_CANDIDATE_IDENTITY_REQUIRED: candidate must contain id or candidate_id");
  }
  return identity;
}

function memoryCandidateLookup(candidates: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const lookup = new Map<string, Record<string, unknown>>();
  for (const candidate of candidates) {
    const identity = memoryCandidateIdentity(candidate);
    if (lookup.has(identity)) {
      throw new Error(`MEMORY_CANDIDATE_IDENTITY_DUPLICATE: ${identity}`);
    }
    lookup.set(identity, candidate);
  }
  return lookup;
}

function hasV2CandidateIdentity(candidate: Record<string, unknown>): boolean {
  return typeof candidate.candidate_id === "string" && candidate.candidate_id.trim().length > 0;
}

function requireV2PromotionMetadata(
  candidate: Record<string, unknown>,
  explicit: {
    tags?: string[];
    density?: "light" | "deep";
    owner_skill?: string;
  } = {}
): {
  tags: string[];
  density: "light" | "deep";
  theme?: string;
  owner_skill?: string;
} {
  const hasExplicitMetadata = explicit.tags !== undefined
    || explicit.density !== undefined
    || explicit.owner_skill !== undefined;
  const persistedTags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  const route = candidate.route && typeof candidate.route === "object"
    ? candidate.route as Record<string, unknown>
    : undefined;
  const persistedDensity = candidate.density === "deep" || route?.target === "L3" ? "deep"
    : candidate.density === "light" || route?.target === "L2" ? "light"
      : undefined;
  const persistedOwnerSkill = typeof candidate.owner_skill === "string" && candidate.owner_skill.trim()
    ? candidate.owner_skill.trim()
    : typeof route?.owner_skill === "string" && route.owner_skill.trim()
      ? route.owner_skill.trim()
      : undefined;
  const destinations = Array.isArray(candidate.destinations) ? candidate.destinations : [];
  const themeDestination = destinations.find((destination) =>
    destination && typeof destination === "object" && (destination as Record<string, unknown>).scope === "theme"
  ) as Record<string, unknown> | undefined;
  const persistedTheme = typeof themeDestination?.theme === "string" && themeDestination.theme.trim()
    ? themeDestination.theme.trim()
    : undefined;
  const persistedComplete = persistedTags.length > 0
    && persistedDensity !== undefined
    && (persistedDensity !== "deep" || Boolean(persistedOwnerSkill));

  if (hasExplicitMetadata && candidate.classification_status !== "unresolved") {
    if (!persistedComplete) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: classified V2 candidate metadata is incomplete");
    }
    const explicitTags = explicit.tags === undefined
      ? undefined
      : unique(explicit.tags.map((tag) => tag.trim()).filter(Boolean));
    const tagsConflict = explicitTags !== undefined
      && JSON.stringify([...explicitTags].sort()) !== JSON.stringify([...persistedTags].sort());
    const densityConflict = explicit.density !== undefined && explicit.density !== persistedDensity;
    const ownerConflict = explicit.owner_skill !== undefined
      && explicit.owner_skill.trim() !== (persistedOwnerSkill ?? "");
    if (tagsConflict || densityConflict || ownerConflict) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_CONFLICT: explicit metadata differs from the classified V2 candidate");
    }
    return {
      tags: persistedTags,
      density: persistedDensity!,
      ...(persistedTheme ? { theme: persistedTheme } : {}),
      ...(persistedOwnerSkill ? { owner_skill: persistedOwnerSkill } : {})
    };
  }
  if (hasExplicitMetadata) {
    const tags = unique((explicit.tags ?? []).map((tag) => tag.trim()).filter(Boolean));
    const ownerSkill = explicit.owner_skill?.trim();
    if (tags.length === 0 || !explicit.density || (explicit.density === "deep" && !ownerSkill)) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: unresolved V2 promotion requires explicit tags, density and owner_skill for L3");
    }
    if (tags.some((tag) => !MEMORY_V2_TAG_PATTERN.test(tag))) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_TAG_INVALID: promotion tags must use governed nested kebab-case");
    }
    return {
      tags,
      density: explicit.density,
      ...(ownerSkill ? { owner_skill: ownerSkill } : {})
    };
  }
  if (!persistedComplete) {
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: V2 promotion requires tags, density and owner_skill for L3");
  }
  return {
    tags: persistedTags,
    density: persistedDensity!,
    ...(persistedTheme ? { theme: persistedTheme } : {}),
    ...(persistedOwnerSkill ? { owner_skill: persistedOwnerSkill } : {})
  };
}

function requireV2CandidateDestinations(candidate: Record<string, unknown>): DexMemoriaV2Destination[] {
  if (!Array.isArray(candidate.destinations) || candidate.destinations.length === 0) {
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: classified V2 candidate destinations are incomplete");
  }
  return candidate.destinations.map((destination) => {
    if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: classified V2 candidate destination is invalid");
    }
    const record = destination as Record<string, unknown>;
    if (record.scope === "project" || record.scope === "global") {
      return { scope: record.scope };
    }
    if (record.scope === "theme" && typeof record.theme === "string" && record.theme.trim()) {
      return { scope: "theme", theme: record.theme.trim() };
    }
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: classified V2 candidate destination is invalid");
  });
}

function v2PromotionClassification(resolution: MemoryCandidateResolution): DexMemoriaV2MiningClassification {
  const v2Resolution = resolution as V2MemoryCandidateResolution;
  const tags = v2Resolution.candidate_tags?.filter((tag) => typeof tag === "string" && tag.trim().length > 0) ?? [];
  const density = v2Resolution.candidate_density;
  if (tags.length === 0 || !density || (density === "deep" && !v2Resolution.candidate_owner_skill?.trim())) {
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: persisted V2 promotion metadata is incomplete");
  }
  const destinations = v2Resolution.candidate_destinations?.length
    ? v2Resolution.candidate_destinations
    : resolution.target_scope
      ? [promotionDestination(resolution.target_scope, resolution.theme)]
      : undefined;
  if (!destinations?.length) {
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: persisted V2 promotion destinations are incomplete");
  }
  return density === "deep"
    ? {
        status: "resolved",
        density,
        requested_destinations: destinations as [DexMemoriaV2Destination, ...DexMemoriaV2Destination[]],
        tags: tags as [string, ...string[]],
        owner_skill: v2Resolution.candidate_owner_skill!.trim()
      }
    : {
        status: "resolved",
        density,
        requested_destinations: destinations as [DexMemoriaV2Destination, ...DexMemoriaV2Destination[]],
        tags: tags as [string, ...string[]]
      };
}

function promotionDestination(scope: MemoryCandidatePromoteScope, theme?: string): DexMemoriaV2Destination {
  if (scope === "global") return { scope: "global" };
  if (scope === "tema") {
    requireText(theme, "theme");
    return { scope: "theme", theme: theme!.trim() };
  }
  return { scope: "project" };
}

function promotionScopeForDestinations(
  destinations: DexMemoriaV2Destination[]
): MemoryCandidatePromoteScope | undefined {
  if (destinations.length !== 1) return undefined;
  if (destinations[0].scope === "global") return "global";
  if (destinations[0].scope === "theme") return "tema";
  return "projeto";
}

function promotionThemeForDestinations(destinations?: DexMemoriaV2Destination[]): string | undefined {
  if (destinations?.length !== 1 || destinations[0].scope !== "theme") return undefined;
  return destinations[0].theme;
}

function sameCandidateResolution(existing: MemoryCandidateResolution, proposed: V2MemoryCandidateResolution): boolean {
  const current = existing as V2MemoryCandidateResolution;
  return existing.candidate_id === proposed.candidate_id
    && existing.action === proposed.action
    && existing.rationale === proposed.rationale
    && (existing.when ?? "") === (proposed.when ?? "")
    && (existing.target_scope ?? "") === (proposed.target_scope ?? "")
    && (existing.theme ?? "") === (proposed.theme ?? "")
    && JSON.stringify([...(current.candidate_tags ?? [])].sort()) === JSON.stringify([...(proposed.candidate_tags ?? [])].sort())
    && (current.candidate_density ?? "") === (proposed.candidate_density ?? "")
    && JSON.stringify(current.candidate_destinations ?? []) === JSON.stringify(proposed.candidate_destinations ?? [])
    && (current.candidate_owner_skill ?? "") === (proposed.candidate_owner_skill ?? "");
}

function memoryWriteDecision(
  candidate: MemoryCandidate,
  writePolicy: MemoryWritePolicy,
  writtenIds: Set<string>,
  resolution?: MemoryCandidateResolution
): Record<string, unknown> {
  const written = writtenIds.has(candidate.id);
  const resolved = Boolean(resolution && isTraceableCandidateResolution(resolution));
  return {
    candidate_id: candidate.id,
    title: candidate.title,
    action: written ? "written" : resolved ? `resolved_${resolution?.action}` : memoryNonWriteAction(candidate, writePolicy, writtenIds),
    reason: written ? "written_by_auto_write_policy" : resolved ? "traceable_resolution_registered" : memoryNonWriteReason(candidate, writePolicy, writtenIds),
    scope: candidate.scope,
    score: candidate.score.total,
    editable: !written && !resolved,
    ...(resolution ? { resolution: candidateResolutionLedgerData(resolution) } : {})
  };
}

function memoryNonWriteAction(candidate: MemoryCandidate, writePolicy: MemoryWritePolicy, writtenIds: Set<string>): string {
  if (writtenIds.has(candidate.id)) {
    return "written";
  }
  if (candidate.blocked) {
    return "blocked";
  }
  if (writePolicy === "classify_only") {
    return "classify_only";
  }
  if (candidate.scope === "ledger_only") {
    return "ledger_only";
  }
  if (candidate.scope === "estacionamento") {
    return "estacionamento";
  }
  if (candidate.scope === "descartar") {
    return "descartar";
  }
  return isWritableCandidate(candidate) ? "not_written_unexpected" : "not_writable";
}

function memoryNonWriteReason(candidate: MemoryCandidate, writePolicy: MemoryWritePolicy, writtenIds: Set<string>): string {
  if (writtenIds.has(candidate.id)) {
    return "written_by_auto_write_policy";
  }
  if (candidate.blocked) {
    return candidate.blocked_reason ?? "candidate_blocked";
  }
  if (writePolicy === "classify_only") {
    return "classify_only_policy_requires_user_review_before_write";
  }
  if (candidate.scope === "ledger_only") {
    return "ledger_only_needs_better_scope_or_destination";
  }
  if (candidate.scope === "estacionamento") {
    return "parked_for_later_decision";
  }
  if (candidate.scope === "descartar") {
    return "discard_scope_detected";
  }
  return isWritableCandidate(candidate) ? "writable_candidate_not_written" : "score_or_scope_not_writable";
}

function memoryEditSuggestion(candidate: MemoryCandidate, writePolicy: MemoryWritePolicy): string {
  if (candidate.blocked) {
    return `corrigir bloqueio antes de gravar: ${candidate.blocked_reason}`;
  }
  if (writePolicy === "classify_only") {
    return "revisar candidato e aprovar uma rodada auto_write se for memoria canonica";
  }
  if (candidate.scope === "ledger_only") {
    return "dar destino claro: memoria, estacionamento ou descarte justificado";
  }
  if (candidate.scope === "estacionamento") {
    return "decidir se fica pendencia, vira garimpo ou deve ser descartado";
  }
  if (candidate.scope === "descartar") {
    return "confirmar descarte depois de garimpar se ha ouro";
  }
  return "melhorar gatilho L1/L2 se o candidato for util";
}

function utilityCheckoutAccountability(input: {
  flow: Flow;
  memory: Record<string, unknown>;
  learning: Record<string, unknown>;
  cooperation: Record<string, unknown>;
  librarian: Record<string, unknown>;
  loop: Record<string, unknown>;
}): Record<string, unknown> {
  const memoryEditQueue = Array.isArray(input.memory.edit_queue) ? (input.memory.edit_queue as Array<Record<string, unknown>>) : [];
  const warnings = Array.isArray(input.memory.destination_warnings) ? input.memory.destination_warnings.map(String) : [];
  const garimpado = stringArray(input.learning.garimpado);
  const estacionado = stringArray(input.learning.estacionado);
  const pontosCegos = stringArray(input.learning.pontos_cegos);
  const materialCount = typeof input.cooperation.material_count === "number" ? input.cooperation.material_count : 0;
  const worked = input.librarian.worked === true;
  const loopCurrent = input.loop.current as Record<string, unknown> | null;
  const loopCount = typeof loopCurrent?.count === "number" ? loopCurrent.count : 0;
  const loopLevel = typeof loopCurrent?.escalation === "object" && loopCurrent.escalation
    ? String((loopCurrent.escalation as Record<string, unknown>).level ?? "none")
    : "none";
  return {
    painel: [
      `M memoria: candidates=${input.memory.candidates_count ?? 0}, written=${input.memory.written_count ?? 0}, editaveis=${memoryEditQueue.length}`,
      `G garimpo: ${garimpado.length}`,
      `E estacionamento: ${estacionado.length}`,
      `P pontos_cegos: ${pontosCegos.length}`,
      `C cooperadores_materiais: ${materialCount}`,
      `B bibliotecario_graphify: ${worked ? "worked" : "not_confirmed"}`,
      `L loops: atual=${loopCount}, nivel=${loopLevel}`
    ],
    edit_queue_count: memoryEditQueue.length,
    edit_queue_sample: memoryEditQueue.slice(0, 8),
    warnings,
    samples: {
      garimpado: garimpado.slice(0, 8),
      estacionamento: estacionado.slice(0, 8),
      pontos_cegos: pontosCegos.slice(0, 8)
    },
    next_use:
      memoryEditQueue.length > 0
        ? "revisar edit_queue antes de nova auto_write ou promocao L1/L2"
        : warnings.length > 0
          ? "resolver destination_warnings antes de positivo"
          : "checkout tem prestacao de contas consultavel para retomada"
  };
}

function loopCheckoutAccountability(flow: Flow, blockers: string[]): Record<string, unknown> {
  const phaseGate = flow.gates[flow.phase];
  const phaseBlockers = phaseGate?.status === "blocked" ? phaseGate.missing : [];
  const current = strongestLoopMonitor(flow, phaseBlockers, blockers);
  const gateChecks = flow.history.filter((event) => event.type === "gate_checked");
  const blockedGateChecks = gateChecks.filter((event) => event.data.status === "blocked");
  const gateBlocksBySignature = countBySignature(
    blockedGateChecks.map((event) => blockerSignature(stringArray(event.data.missing)))
  );
  const fiscalBlocks = flow.history.filter((event) => event.type === "fiscal_policy_blocked");
  const fiscalBlocksBySignature = countBySignature(
    fiscalBlocks.map((event) => String(event.data.loop_signature ?? blockerSignature(stringArray(event.data.blocking_reasons))))
  );
  const loopMeetingIds = new Set<string>();
  for (const event of flow.history.filter((item) => item.type === "meeting_opened" || item.type === "meeting_turn_added" || item.type === "meeting_closed")) {
    const data = event.data;
    const text = [
      data.question,
      data.decision,
      ...stringArray(data.finding),
      ...stringArray(data.note),
      ...stringArray(data.findings),
      ...stringArray(data.questions),
      ...stringArray(data.decisions)
    ].filter(Boolean).join("\n");
    if (/loop_|LOOP RUIM|repetiu \d+ vezes|emergencia/i.test(text)) {
      const meetingId = typeof data.meeting_id === "string" ? data.meeting_id : null;
      if (meetingId) {
        loopMeetingIds.add(meetingId);
      }
    }
  }
  const researchEvidence = flow.evidence.filter((evidence) => /research|pesquisa/i.test([evidence.kind, evidence.title, evidence.note, evidence.content].filter(Boolean).join("\n")));
  const badLoopEvidence = flow.evidence.filter((evidence) => /bad_loop|LOOP RUIM REVISAR TRABALHO/i.test([evidence.kind, evidence.title, evidence.note, evidence.content].filter(Boolean).join("\n")));
  return {
    current,
    current_loop_id: current?.loop_id ?? null,
    current_count: current?.count ?? 0,
    current_escalation: current?.escalation ?? loopEscalationFor(0),
    regress_count: countRegressions(flow),
    phase_returned_count: countHistory(flow, "phase_returned"),
    reported_regress_count: Math.max(0, ...flow.history
      .filter((event) => event.type === "regress_count_reported" && typeof event.data.regress_count === "number")
      .map((event) => event.data.regress_count as number)),
    gate_checks_count: gateChecks.length,
    blocked_gate_checks_count: blockedGateChecks.length,
    blocked_gate_checks_by_signature: gateBlocksBySignature,
    fiscal_blocks_count: fiscalBlocks.length,
    fiscal_blocks_by_signature: fiscalBlocksBySignature,
    loop_meetings_count: loopMeetingIds.size,
    loop_meeting_ids: [...loopMeetingIds],
    research_reports_count: researchEvidence.length,
    research_evidence_ids: researchEvidence.map((evidence) => evidence.evidence_id),
    bad_loop_reports_count: badLoopEvidence.length,
    bad_loop_evidence_ids: badLoopEvidence.map((evidence) => evidence.evidence_id),
    organized_recovery_ladder: [
      { count: 3, action: "reuniao_convergente_transversal" },
      { count: 5, action: "reuniao_divergente_transversal" },
      { count: 6, action: "pesquisador_organizado_subagente" },
      { count: 8, action: "reuniao_emergencia_especialistas" },
      { count: 9, action: "estacionamento_garimpeiro_loop_ruim_revisar_trabalho" }
    ],
    reset_policy: current?.reset_policy ?? "contagem zera quando ha progresso: evidencia, reuniao fechada, memoria minerada, gate passado, fase avancada, veredito ou blocker diferente",
    summary: current
      ? `loop atual ${current.loop_id}: count=${current.count}, gate=${current.gate_block_count}, fiscal=${current.fiscal_block_count}, regress=${current.review_regress_count}, escalonamento=${current.escalation.level}`
      : "sem loop ativo no checkout"
  };
}

function countBySignature(signatures: string[]): Array<{ signature: string; count: number }> {
  const counts = new Map<string, number>();
  for (const signature of signatures.filter(Boolean)) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([signature, count]) => ({ signature, count }))
    .sort((left, right) => right.count - left.count || left.signature.localeCompare(right.signature));
}

function memoryCheckoutAccountability(flow: Flow, memoryMining: MemoryMiningSummary): Record<string, unknown> {
  const raw = (flow.memory_mining ?? {}) as Record<string, unknown>;
  const written = Array.isArray(raw.written) ? (raw.written as Array<Record<string, unknown>>) : [];
  const candidates = Array.isArray(raw.candidates) ? (raw.candidates as Array<Record<string, unknown>>) : [];
  const writeDecisions = Array.isArray(raw.write_decisions) ? (raw.write_decisions as Array<Record<string, unknown>>) : [];
  const editQueue = Array.isArray(raw.edit_queue) ? (raw.edit_queue as Array<Record<string, unknown>>) : [];
  const destinationWarnings = Array.isArray(raw.destination_warnings) ? raw.destination_warnings.map(String) : [];
  const writtenFiles = unique(written.flatMap((item) => stringArray(item.files)));
  const layers = memoryLayersFromFiles(writtenFiles);
  return {
    required: memoryMining.required,
    mined: Boolean(memoryMining.last_run_at),
    last_run_at: memoryMining.last_run_at ?? null,
    write_policy: memoryMining.write_policy ?? null,
    written_count: memoryMining.written_count,
    candidates_count: memoryMining.candidates_count,
    blocked_count: memoryMining.blocked_count,
    ledger_only_count: memoryMining.ledger_only_count,
    discarded_count: memoryMining.discarded_count,
    estacionamento_count: memoryMining.estacionamento?.length ?? 0,
    strong_unwritten_count: memoryMining.strong_unwritten_count ?? 0,
    memory_written: memoryMining.memory_written === true,
    memory_validated: memoryMining.memory_validated === true,
    memory_consolidated: memoryMining.memory_consolidated === true,
    memory_review_status: memoryMining.memory_review_status ?? null,
    memory_post_write_validation: memoryMining.memory_post_write_validation ?? null,
    memory_required_but_empty: memoryMining.memory_required_but_empty === true,
    written,
    candidates,
    write_decisions: writeDecisions,
    edit_queue: editQueue,
    destination_warnings: destinationWarnings,
    layers,
    l1_files: layers.L1,
    l2_files: layers.L2,
    l3_files: layers.L3,
    summary:
      memoryMining.memory_consolidated === true
        ? `memoria consolidada: L1=${layers.L1.length}, L2=${layers.L2.length}, L3=${layers.L3.length}`
        : memoryMining.memory_review_status === "pending_consciencia_memorias"
          ? `memoria gravada e validada estruturalmente; revisao consciencia-memorias pendente: L1=${layers.L1.length}, L2=${layers.L2.length}, L3=${layers.L3.length}`
        : memoryMining.memory_validated === true
          ? `memoria gravada e validada: L1=${layers.L1.length}, L2=${layers.L2.length}, L3=${layers.L3.length}`
        : memoryMining.written_count > 0
          ? `memoria gravada, aguardando/pendente de validacao: L1=${layers.L1.length}, L2=${layers.L2.length}, L3=${layers.L3.length}`
        : memoryMining.candidates_count > 0
          ? "memoria classificada sem escrita canonica neste checkout"
          : memoryMining.required && memoryMining.last_run_at
            ? "mineracao executada; nenhum candidato de memoria encontrado"
            : memoryMining.required
              ? "memoria exigida, mas nenhum candidato gravado/classificado"
              : "memoria nao exigida neste flow"
  };
}

function memoryLayersFromFiles(files: string[]): Record<"L1" | "L2" | "L3" | "other", string[]> {
  const layers: Record<"L1" | "L2" | "L3" | "other", string[]> = { L1: [], L2: [], L3: [], other: [] };
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    if (/\/?LEMBRANCA\.md$/i.test(normalized) || /\/?lembranca\.md$/i.test(normalized)) {
      layers.L1.push(file);
    } else if (/\/?MEMORIA\.md$/i.test(normalized) || /\/?memoria\.md$/i.test(normalized) || /\/memorias\/[^/]+\.md$/i.test(normalized)) {
      layers.L2.push(file);
    } else if (/\/conhecimento\//i.test(normalized) || /\/L3\//i.test(normalized)) {
      layers.L3.push(file);
    } else {
      layers.other.push(file);
    }
  }
  return layers;
}

function learningCheckoutAccountability(flow: Flow): Record<string, unknown> {
  const pontosCegos = unique([
    ...flow.gold_mining.filter((item) => /ponto cego|premissa|ocult|ambig|incert/i.test(item)),
    ...flow.parking_lot.filter((item) => /ponto cego|premissa|ocult|ambig|incert/i.test(item)),
    ...flow.goal_learning_links
      .filter((link) => link.garimpo_vinculado.classificacao === "ponto_cego")
      .map((link) => link.garimpo_vinculado.pepita ?? link.parking_item)
  ]);
  const garimpoPorClasse = flow.goal_learning_links.reduce<Record<string, number>>((acc, link) => {
    const key = link.garimpo_vinculado.classificacao;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const conviccaoFraca = flow.goal_learning_links
    .filter((link) => link.garimpo_vinculado.classificacao === "nao_promover")
    .map((link) => link.parking_item);
  return {
    garimpado: flow.gold_mining,
    estacionado: flow.parking_lot,
    pontos_cegos: pontosCegos,
    links: flow.goal_learning_links,
    garimpo_por_classificacao: garimpoPorClasse,
    conviccao_fraca_ou_frouxa: conviccaoFraca,
    garimpo_count: flow.gold_mining.length,
    estacionamento_count: flow.parking_lot.length,
    pontos_cegos_count: pontosCegos.length,
    conviccao_fraca_count: conviccaoFraca.length
  };
}

function cooperationCheckoutAccountability(flow: Flow): Record<string, unknown> {
  const material = flow.cooperators.filter((cooperator) => cooperator.material);
  const suggested = suggestedCooperatorsForFlow(flow);
  return {
    suggested_count: suggested.length,
    suggested,
    material_count: material.length,
    material,
    all: flow.cooperators,
    active_credits: flow.active_credits,
    merits: material.map((cooperator) => ({
      name: cooperator.name,
      reason: cooperator.reason,
      merit_source: "recorded_material_cooperator",
      credits: flow.active_credits.filter((credit) => credit.toLowerCase().includes(cooperator.name.toLowerCase()))
    })),
    summary:
      material.length > 0
        ? `cooperadores materiais: ${material.map((cooperator) => cooperator.name).join(", ")}`
        : suggested.length > 0
          ? "cooperadores sugeridos registrados; nenhum credito material automatico"
          : "nenhum cooperador material registrado"
  };
}

function suggestedCooperatorsForFlow(flow: Flow): Cooperator[] {
  return uniqueCooperators(
    flow.history.flatMap((event) => {
      if (event.type !== "meeting_opened") {
        return [];
      }
      const suggested = event.data.suggested_cooperators;
      return Array.isArray(suggested) ? (suggested as Cooperator[]) : [];
    })
  );
}

function librarianCheckoutAccountability(librarianStatus: StructuredLibrarianStatus): Record<string, unknown> {
  const worked = librarianStatus.consumption_confirmed === true;
  const graphifyWorked = librarianStatus.graphify.consumption_confirmed === true;
  return {
    worked,
    recall_executed: librarianStatus.recall_executed,
    consumption_confirmed: librarianStatus.consumption_confirmed,
    bibliotecario_worked: librarianStatus.bibliotecario.consumption_confirmed,
    bibliotecario_recall_executed: librarianStatus.bibliotecario.recall_executed,
    graphify_worked: graphifyWorked,
    graphify_recall_executed: librarianStatus.graphify.recall_executed,
    status: librarianStatus,
    summary: worked
      ? "Consumo de recall confirmado por referencias rastreaveis"
      : librarianStatus.recall_executed
        ? "Recall executado; consumo pelo executor ainda nao confirmado"
        : `Recall nao executado; graphify=${librarianStatus.graphify.status}, bibliotecario=${librarianStatus.bibliotecario.status}`
  };
}

function recallReferenceValues(items: Array<Record<string, unknown>>): string[] {
  return unique(
    items.flatMap((item) => [item.path, item.title, item.destination])
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
  );
}

function recallReferenceSet(references: string[]): Set<string> {
  return new Set(references.map(normalizeRecallReference));
}

function normalizeRecallReference(reference: string): string {
  return reference.trim().replace(/\\/g, "/").toLowerCase();
}

function sameRecallReferences(left: string[], right: string[]): boolean {
  const leftNormalized = unique(left.map(normalizeRecallReference)).sort();
  const rightNormalized = unique(right.map(normalizeRecallReference)).sort();
  return leftNormalized.length === rightNormalized.length && leftNormalized.every((item, index) => item === rightNormalized[index]);
}

function progressText(value: string, maxLength: number, field: string): string {
  requireText(value, field);
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function validateProgressNumbers(current: number, total: number, status: WorkProgressStatus): void {
  if (!Number.isInteger(total) || total <= 0) {
    throw new Error("PROGRESS_TOTAL_INVALID: total must be a positive integer");
  }
  if (!Number.isInteger(current) || current < 0 || current > total) {
    throw new Error("PROGRESS_CURRENT_INVALID: current must be an integer between zero and total");
  }
  if (status === "completed" && current !== total) {
    throw new Error("PROGRESS_COMPLETED_INCOMPLETE: completed progress requires current=total");
  }
}

function workProgressEvents(flow: Flow): WorkProgressEvent[] {
  return flow.history
    .filter((event) => event.type === "work_progress_recorded")
    .map((event) => event.data as unknown as WorkProgressEvent)
    .filter((event) =>
      typeof event.progress_id === "string" &&
      typeof event.event_key === "string" &&
      typeof event.source === "string" &&
      typeof event.operation === "string" &&
      typeof event.stage === "string" &&
      typeof event.current === "number" &&
      typeof event.total === "number" &&
      typeof event.percent === "number" &&
      ["queued", "running", "completed", "failed"].includes(event.status)
    );
}

function workProgressSummary(flow: Flow): WorkProgressSummary {
  const events = workProgressEvents(flow);
  return {
    event_count: events.length,
    operations_count: new Set(events.map((event) => `${event.source}\u0000${event.operation}`)).size,
    last: events.at(-1) ?? null
  };
}

function progressReceipt(
  flow: Flow,
  event: WorkProgressEvent | null,
  outcome: { recorded: boolean; reused: boolean; throttled: boolean; reason: string }
): Record<string, unknown> {
  return {
    flow_id: flow.flow_id,
    ...outcome,
    progress_event: event,
    work_progress: workProgressSummary(flow)
  };
}

function statusValue(value: unknown): RecallVisualStatus["status"] {
  const allowed = ["disabled", "recalled", "empty", "missing_graph", "timeout", "failed"] as const;
  return allowed.includes(value as RecallVisualStatus["status"]) ? (value as RecallVisualStatus["status"]) : "failed";
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return value ? [String(value)] : [];
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return Boolean(value);
}

function requireText(value: string | undefined, field: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function assertPhase(phase: string): asserts phase is Phase {
  // Modo compact wire-up: aceitar tambem fases compact alem das full.
  if (!PHASES.includes(phase as Phase) && !COMPACT_PHASES.includes(phase as AnyPhase as never)) {
    throw new Error(`Invalid phase: ${phase}`);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function uniqueCooperators(values: Flow["cooperators"]): Flow["cooperators"] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.name}\n${value.reason}\n${value.material}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return value.name.trim().length > 0 && value.reason.trim().length > 0;
  });
}

function normalizeSuggestedCooperators(values: Cooperator[]): Cooperator[] {
  return uniqueCooperators(
    values.map((value) => ({
      name: value.name,
      reason: value.reason,
      material: false
    }))
  );
}

function materialActiveCredits(cooperators: Cooperator[], requestedCredits: string[]): string[] {
  const materialCooperators = cooperators.filter((cooperator) => cooperator.material);
  if (materialCooperators.length === 0) {
    return [];
  }
  const generatedCredits = materialCooperators.map((cooperator) => `${cooperator.name}: ${cooperator.reason}`);
  const allowedNames = materialCooperators.map((cooperator) => cooperator.name.toLowerCase());
  const acceptedRequestedCredits = requestedCredits.filter((credit) =>
    allowedNames.some((name) => credit.toLowerCase().includes(name))
  );
  return unique([...acceptedRequestedCredits, ...generatedCredits]);
}

function memoryMiningStatus(flow: Flow): MemoryMiningSummary {
  return (
    flow.memory_mining ?? {
      required: flow.gold_mining.length > 0 || flow.parking_lot.length > 0 || flow.goal_learning_links.length > 0,
      blocked_verdict: false,
      candidates_count: 0,
      written_count: 0,
      blocked_count: 0,
      ledger_only_count: 0,
      discarded_count: 0,
      estacionamento: [],
      write_decisions: [],
      edit_queue: [],
      destination_warnings: [],
      strong_unwritten_count: 0,
      resolved_candidate_ids: [],
      resolved_strong_unwritten_count: 0,
      candidate_resolutions: flow.memory_candidate_resolutions ?? [],
      memory_written: false,
      memory_validated: false,
      memory_consolidated: false,
      memory_review_status: "not_required",
      memory_post_write_validation: {
        required: false,
        status: "not_required",
        validator: "consciencia-memorias-post-write",
        touched_files: [],
        l1_files: [],
        l2_files: [],
        l3_files: [],
        checked_triggers: [],
        recall_proof: [],
        findings: [],
        parking_lot: [],
        commands_required: []
      }
    }
  );
}

function memoryWriterRuntimeSummary(
  config: FlowEngineOptions["memory_writer"],
  projectRoot: string
): { profile: "unconfigured" | "legacy-v1" | "v2"; workspace_root: string; memory_home: string | null } {
  if (config?.profile === "v2") {
    return { profile: "v2", workspace_root: config.workspace_root ?? projectRoot, memory_home: config.memory_home ?? null };
  }
  return { profile: config?.profile ?? "unconfigured", workspace_root: projectRoot, memory_home: null };
}

async function collectTempFiles(root: string): Promise<string[]> {
  const ignored = new Set([".git", "node_modules", ".ppirtv", "dist"]);
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/(\.tmp|\.bak|\.orig|~)$/.test(entry.name)) {
        found.push(path.relative(root, full).replace(/\\/g, "/"));
      }
    }
  }
  await walk(root);
  return found.sort();
}
