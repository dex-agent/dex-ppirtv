import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_BACK_TO,
  GATE_REQUIREMENTS,
  NEXT_PHASE,
  PHASES,
  type Cooperator,
  type Evidence,
  type Flow,
  type GateRecord,
  type GoalBinding,
  type GoalEnvelope,
  type HygieneFinding,
  type Meeting,
  type MemoryCandidate,
  type MeetingKind,
  type MeetingType,
  type MemoryMiningSummary,
  type MemoryWritePolicy,
  type PipelineFlowResult,
  type PipelineItem,
  type PresentationEnvelope,
  type Phase,
  type Scope,
  type StructuredLibrarianStatus,
  type SptValidationResult,
  type Verdict,
  type VerdictStatus
} from "./domain.js";
import {
  assertNoSecretLikeText,
  classifyMemoryCandidate,
  collectMemoryNuggets,
  isWritableCandidate,
  linkParkingToGold,
  MemoryLibrarian,
  memoryCandidateLedgerData,
  resolveDexMemoriaHome,
  writeMemoryCandidate,
  type MemoryHookRunner
} from "./memory/index.js";
import { presentArtifact, presentChecklist, presentFlow, presentGate } from "./presentation.js";
import { principleChecklist, scanOperationalPrinciples, type PrincipleChecklistItem } from "./principles.js";
import { PpirtvStore } from "./store.js";
import { FISCAL_CONFIG, RUNTIME_ENV, graphifyRecallConfigured } from "./config.js";

const DEFAULT_SCOPE: Scope = { in: [], out: [] };

type RecallVisualStatus = NonNullable<PresentationEnvelope["display"]["librarian"]>;

type FiscalVerdictInput = {
  status?: VerdictStatus;
  rationale?: string;
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

type LoopMonitor = {
  loop_id: string;
  signature: string;
  blockers: string[];
  count: number;
  fiscal_block_count: number;
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

export class FlowEngine {
  readonly store: PpirtvStore;
  readonly memoryHooks: MemoryHookRunner;

  constructor(store: PpirtvStore, memoryHooks?: MemoryHookRunner) {
    this.store = store;
    this.memoryHooks = memoryHooks ?? new MemoryLibrarian(store.root);
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
    const flow: Flow = {
      flow_id: await this.store.nextId("flow"),
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
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "flow_created", { goal: flow.goal, phase: flow.phase });
    return presentFlow(flow);
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
        | "decisions"
      >
    > & { scope?: Partial<Scope> }
  ): Promise<Flow> {
    const flow = await this.store.loadFlow(flowId);
    const now = nowIso();
    flow.context = facts.context ?? flow.context;
    flow.risks = facts.risks ?? flow.risks;
    flow.uncertainties = facts.uncertainties ?? flow.uncertainties;
    flow.tasks = facts.tasks ?? flow.tasks;
    flow.done_criteria = facts.done_criteria ?? flow.done_criteria;
    flow.expected_evidence = facts.expected_evidence ?? flow.expected_evidence;
    flow.changed_files = facts.changed_files ?? flow.changed_files;
    flow.changed_files = unique([...flow.changed_files, ...stringArray((facts as Record<string, unknown>).changed_files)]);
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
    if (checks.spt_is_file && checks.spt_inside_workspace && checks.spt_under_plan_tasks) {
      text = await readFile(sptPath, "utf8");
    }

    checks.has_title = /^#\s+\S+/m.test(text);
    checks.has_type = /Tipo:\s*SPEC-PLAN-TASKs/i.test(text);
    checks.has_status = /Status:\s*\S+/i.test(text);
    checks.has_owner = /Owner:\s*\S+/i.test(text);
    checks.has_date = /(?:Data|Date):\s*\S+/i.test(text);
    checks.has_workspace = /Workspace:\s*\S+/i.test(text);
    checks.has_origin = /(?:Origem|Origin):\s*\S+/i.test(text);
    checks.has_goal_envelope = hasSection(text, ["goalenvelope", "goal envelope"]);
    checks.has_context = hasSection(text, ["contexto", "context"]);
    checks.has_problem = hasSection(text, ["problema", "problem"]);
    checks.has_decision = hasSection(text, ["decisao", "decision"]);
    checks.has_scope = hasSection(text, ["escopo", "scope"]);
    checks.has_out_of_scope = hasSection(text, ["fora de escopo", "out of scope"]);
    checks.has_spec = /^##\s+SPEC\b/im.test(text);
    checks.has_plan = /^##\s+PLAN\b/im.test(text);
    checks.has_tasks = /^##\s+TASKs?\b/im.test(text);
    checks.has_expected_evidence_section = hasSection(text, ["expected evidence", "evidencias esperadas", "evidencia esperada"]);
    checks.has_done_criteria_section = hasSection(text, ["done criteria", "criterios de pronto", "criterios de aceite"]);
    checks.has_risks = hasSection(text, ["riscos", "risks"]);
    checks.has_gates = hasSection(text, ["gates"]);
    checks.has_validation = /^##\s+(?:Validacao|Validation)\b/im.test(text);
    checks.has_goal_prompt = hasSection(text, ["prompt /goal de execucao", "prompt goal de execucao", "prompt /goal", "goal execution prompt"]);

    const parsedSpt = parseSpt(text);
    checks.has_extracted_tasks = parsedSpt.tasks.length > 0;
    checks.has_extracted_expected_evidence = parsedSpt.expected_evidence.length > 0;
    checks.has_extracted_done_criteria = parsedSpt.done_criteria.length > 0;

    const requiredChecks: Record<string, string> = {
      workspace_absolute: "workspace_absolute",
      workspace_exists: "workspace_exists",
      workspace_is_directory: "workspace_is_directory",
      spt_path_not_sensitive: "spt_path_not_sensitive",
      spt_inside_workspace: "spt_inside_workspace",
      spt_under_plan_tasks: "spt_under_plan_tasks",
      spt_exists: "spt_exists",
      spt_is_file: "spt_is_file",
      has_title: "title",
      has_type: "Tipo: SPEC-PLAN-TASKs",
      has_status: "Status",
      has_owner: "Owner",
      has_date: "Data/Date",
      has_workspace: "Workspace",
      has_origin: "Origem",
      has_goal_envelope: "GoalEnvelope",
      has_context: "Contexto",
      has_problem: "Problema",
      has_decision: "Decisao",
      has_scope: "Escopo",
      has_out_of_scope: "Fora de escopo",
      has_spec: "SPEC",
      has_plan: "PLAN",
      has_tasks: "TASKs",
      has_expected_evidence_section: "Expected Evidence",
      has_done_criteria_section: "Done Criteria",
      has_risks: "Riscos",
      has_gates: "Gates",
      has_validation: "Validacao",
      has_goal_prompt: "Prompt /GOAL de execucao",
      has_extracted_tasks: "tasks",
      has_extracted_expected_evidence: "expected_evidence",
      has_extracted_done_criteria: "done_criteria"
    };
    for (const [key, label] of Object.entries(requiredChecks)) {
      if (!checks[key]) {
        missing.push(label);
      }
    }

    if (text && input.objective && !containsLoose(text, input.objective)) {
      warnings.push("objective_not_found_exactly_in_spt");
    }
    if (text && /\b(api[_-]?key|token|password|secret|authorization)\b/i.test(text)) {
      warnings.push("spt_mentions_sensitive_terms_review_without_echoing_values");
    }
    if (text && parsedSpt.tasks.length === 0) {
      warnings.push("spt_tasks_not_extracted");
    }
    if (text && parsedSpt.expected_evidence.length === 0) {
      warnings.push("spt_expected_evidence_not_extracted");
    }
    if (text && parsedSpt.done_criteria.length === 0) {
      warnings.push("spt_done_criteria_not_extracted");
    }
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
      checks,
      missing,
      warnings,
      risks,
      tasks: parsedSpt.tasks,
      expected_evidence: parsedSpt.expected_evidence,
      done_criteria: parsedSpt.done_criteria,
      next_step: missing.length === 0 ? "goal_start" : `corrigir_spt: ${missing.join(", ")}`
    };
  }

  async startGoal(input: GoalEnvelope): Promise<Record<string, unknown>> {
    const envelope = normalizeGoalEnvelope(input);
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
    if (envelope.flow_id) {
      flow = await this.store.loadFlow(envelope.flow_id);
      if (existingByKey && existingByKey.flow_id !== flow.flow_id) {
        throw new Error(`idempotency_key already belongs to ${existingByKey.flow_id}`);
      }
      assertCompatibleGoalBinding(flow.goal_binding, envelope);
      reused = true;
    } else if (existingByKey) {
      assertCompatibleGoalBinding(existingByKey.goal_binding, envelope);
      flow = existingByKey;
      reused = true;
    } else {
      const created = await this.createFlow({
        goal: envelope.objective,
        owner: "dex-code",
        context: `GOAL/SPT via dex-code. Workspace: ${envelope.workspace}. SPT: ${envelope.spt_path}.`,
        scope: {
          in: ["Executar fluxo PPIRTV do SPT validado", "Registrar evidencias rastreaveis", "Emitir veredito PPIRTV"],
          out: ["Executar hooks invisiveis", "Ler .env ou segredos", "Duplicar flow por retry"]
        },
        risks: ["Conclusao positiva exige evidencia rastreavel.", ...validation.risks],
        uncertainties: ["Integracao real do dex-code pode ajustar campos futuros sem quebrar este envelope."]
      });
      flow = await this.store.loadFlow(created.flow_id);
    }

    const previousBinding = flow.goal_binding;
    flow.goal_binding = {
      envelope: { ...envelope, flow_id: flow.flow_id },
      started_at: previousBinding?.started_at ?? now,
      last_seen_at: now
    };
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
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, reused ? "goal_reused" : "goal_started", goalLedgerData(flow.goal_binding, flow), "dex-code");

    return {
      ...(await this.goalStatus({ flow_id: flow.flow_id })),
      started: !reused,
      reused,
      spt_validation: validation,
      goal_envelope: flow.goal_binding.envelope
    };
  }

  async goalStatus(input: { flow_id?: string; idempotency_key?: string }): Promise<Record<string, unknown>> {
    let flow = await this.resolveGoalFlow(input);
    const checklist = await this.renderChecklist(flow.flow_id);
    const gate = await this.checkGate({ flow_id: flow.flow_id, phase: flow.phase, persist: false });
    const currentVerdict = flow.verdicts.at(-1) ?? null;
    let rawLibrarianStatus = latestLibrarianStatus(flow) ?? latestLibrarianStatusFromLedger(await this.store.readLedger(flow.flow_id));
    if (!rawLibrarianStatus && graphifyRecallConfigured() && flow.status !== "archived") {
      rawLibrarianStatus = await this.runBeforePhaseHook(flow, flow.phase, "ppirtv_checkin");
      flow = await this.store.loadFlow(flow.flow_id);
    }
    const fiscal = evaluateFiscalPolicy(flow);
    const persistedFiscal = latestFiscalBlock(flow);
    const librarianStatus = structuredLibrarianStatus(rawLibrarianStatus);
    const requiredCooperation = fiscal.required_cooperation.length > 0 ? fiscal.required_cooperation : persistedFiscal.required_cooperation;
    const gateBlockers = flow.status === "complete" || flow.status === "archived" ? [] : gate.status === "blocked" ? gate.missing : [];
    const blockers = reconciledBlockers(flow, [...gateBlockers, ...fiscal.blocking_reasons, ...persistedFiscal.blocking_reasons]);
    const directAction = blockers.length > 0 ? blockedDirectAction(blockers) : checklist.display.direct_action;
    const checklistStatus = directAction ? withDirectAction(checklist, directAction) : checklist;
    const backTo = blockers.length > 0 ? fiscalBackTo(flow) : null;
    const regressCount = countRegressions(flow);
    const regressLimitReached = regressCount >= FISCAL_CONFIG.maxRegressions;
    const meetings = await this.store.listMeetings(flow.flow_id);
    const loopMonitor = fiscalLoopMonitor(flow, blockers);
    const nextRequiredAction = nextRequiredActionFor(flow, meetings, blockers, backTo, regressCount, regressLimitReached, loopMonitor);
    const resolutionGuidance = blockerResolutionGuidance(blockers, nextRequiredAction, loopMonitor);
    return {
      flow_id: flow.flow_id,
      status: flow.status,
      phase: flow.phase,
      phase_label: checklistStatus.display.phase_label,
      phase_emoji: checklistStatus.display.phase_emoji,
      checklist: checklistStatus,
      tasks: flow.tasks,
      expected_evidence: flow.expected_evidence,
      done_criteria: flow.done_criteria,
      evidence: flow.evidence.map((evidence) => ({
        evidence_id: evidence.evidence_id,
        kind: evidence.kind,
        title: evidence.title,
        uri: evidence.uri,
        created_at: evidence.created_at
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
      gates: flow.gates,
      parking_lot: flow.parking_lot,
      gold_mining: flow.gold_mining,
      goal_learning_links: flow.goal_learning_links,
      cooperators: flow.cooperators,
      active_credits: flow.active_credits,
      memory_mining: memoryMiningStatus(flow),
      blockers,
      next_step: blockers.length > 0 ? fiscalResult(true, blockers).direct_action : nextGoalStep(flow, gate),
      meeting_required: blockers.includes("required_cooperation"),
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
        librarian: rawLibrarianStatus ?? checklist.display.librarian
      },
      suggested_cooperation: gate.suggested_cooperation,
      required_cooperation: requiredCooperation,
      fiscal_policy: fiscal,
      librarian_status: librarianStatus,
      ppirtv_checkin: ppirtvCheckIn(flow, requiredCooperation, librarianStatus, blockers, resolutionGuidance),
      ppirtv_checkout: ppirtvCheckOut(flow, librarianStatus, blockers, resolutionGuidance)
    };
  }

  async resumeGoal(input: { flow_id?: string; idempotency_key?: string; note?: string }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    const now = nowIso();
    if (flow.goal_binding) {
      flow.goal_binding.last_seen_at = now;
    }
    flow.updated_at = now;
    flow.history.push({ at: now, type: "goal_resumed", data: { note: input.note ?? "resume requested" } });
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "goal_resumed", { note: input.note ?? "resume requested" }, "dex-code");
    return {
      ...(await this.goalStatus({ flow_id: flow.flow_id })),
      resumed: true
    };
  }

  async goalGateCheck(input: {
    flow_id?: string;
    idempotency_key?: string;
    phase?: Phase;
    provided?: Record<string, unknown>;
    persist?: boolean;
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
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id })
    };
  }

  async goalAdvance(input: {
    flow_id?: string;
    idempotency_key?: string;
    provided?: Record<string, unknown>;
    evidence_ids?: string[];
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    assertGoalBinding(flow);
    assertNoSecretLikePayload(input.provided, "provided");
    const savedGate = flow.gates[flow.phase];
    const gate =
      !input.provided && savedGate?.status === "passed"
        ? presentGate(savedGate as GateRecord & Record<string, unknown>, flow)
        : await this.checkGate({
            flow_id: flow.flow_id,
            phase: flow.phase,
            provided: input.provided,
            persist: true
          });
    if (gate.status === "blocked") {
      return {
        ...gate,
        advanced: false,
        blocked: true,
        status_snapshot: await this.goalStatus({ flow_id: flow.flow_id })
      };
    }
    const advanced = await this.advance({
      flow_id: flow.flow_id,
      evidence_ids: input.evidence_ids,
      actor: "dex-code"
    });
    return {
      ...advanced,
      gate,
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id })
    };
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
      created_by: input.created_by ?? "goal_meeting_open",
      evidence_ids: input.evidence_ids
    });
    return {
      ...meeting,
      suggested_cooperators: suggestedCooperators,
      credit_rule: "suggested_cooperators are not active credits until goal_meeting_close records material decision and participants",
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id })
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
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id })
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
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id })
    };
  }

  async mineMemory(input: {
    flow_id: string;
    auto_classify?: boolean;
    write_policy?: MemoryWritePolicy;
  }): Promise<Record<string, unknown>> {
    requireText(input.flow_id, "flow_id");
    const flow = await this.store.loadFlow(input.flow_id);
    const writePolicy = input.write_policy ?? "auto_write";
    if (writePolicy !== "auto_write" && writePolicy !== "classify_only") {
      throw new Error(`Invalid write_policy: ${writePolicy}`);
    }
    const autoClassify = input.auto_classify ?? true;
    if (!autoClassify && writePolicy === "auto_write") {
      throw new Error("AUTO_CLASSIFY_DISABLED_AUTO_WRITE: use auto_classify=true for auto_write or switch write_policy to classify_only");
    }
    const dexMemoriaHome = resolveDexMemoriaHome();
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
    const workspace = path.resolve(flow.goal_binding?.envelope.workspace ?? process.cwd());
    const linkNow = nowIso();
    const promotedGold = linkParkingToGold(flow, flow.parking_lot, "memory_mining", flow.flow_id, linkNow);
    flow.gold_mining = unique([...flow.gold_mining, ...promotedGold]);
    const meetings = await this.store.listMeetings(flow.flow_id);
    const nuggets = collectMemoryNuggets(flow, meetings);
    const candidates = nuggets.map((nugget, index) =>
      classifyMemoryCandidate({
        id: `mc_${index + 1}`,
        item: nugget.item,
        source: nugget.source,
        evidenceScore: nugget.evidenceScore,
        workspace,
        dexMemoriaHome
      })
    );
    const blocked = candidates.filter((candidate) => candidate.blocked);
    const writable = candidates.filter((candidate) => isWritableCandidate(candidate));
    const ledgerOnly = candidates.filter((candidate) => candidate.scope === "ledger_only");
    const estacionamento = candidates.filter((candidate) => candidate.scope === "estacionamento");
    const discarded = candidates.filter((candidate) => candidate.scope === "descartar");
    const written: Array<{ candidate_id: string; files: string[] }> = [];

    if (writePolicy === "auto_write") {
      for (const candidate of writable) {
        const files = await writeMemoryCandidate(candidate);
        written.push({ candidate_id: candidate.id, files });
      }
    }

    const now = nowIso();
    const writtenIds = new Set(written.map((item) => item.candidate_id));
    const strongUnwritten =
      writePolicy === "auto_write"
        ? candidates.filter((candidate) => candidate.score.total >= 6 && !writtenIds.has(candidate.id) && !candidate.blocked && candidate.scope !== "estacionamento" && candidate.scope !== "descartar")
        : [];
    const writeDecisions = candidates.map((candidate) => memoryWriteDecision(candidate, writePolicy, writtenIds));
    const editQueue = candidates
      .filter((candidate) => !writtenIds.has(candidate.id))
      .map((candidate) => ({
        candidate_id: candidate.id,
        title: candidate.title,
        scope: candidate.scope,
        layer: candidate.layer,
        score: candidate.score,
        suggestion: memoryEditSuggestion(candidate, writePolicy),
        target_files: candidate.target_files
      }));
    const destinationWarnings = strongUnwritten.map((candidate) => `${candidate.id}:${candidate.scope}:${memoryNonWriteReason(candidate, writePolicy, writtenIds)}`);
    const memoryRequiredButEmpty = memoryRequiredByFlow(flow) && candidates.length === 0 && written.length === 0;
    const summary: MemoryMiningSummary = {
      required: candidates.length > 0 || memoryRequiredByFlow(flow),
      last_run_at: now,
      write_policy: writePolicy,
      blocked_verdict: blocked.length > 0 || memoryRequiredButEmpty || strongUnwritten.length > 0,
      candidates_count: candidates.length,
      written_count: written.length,
      blocked_count: blocked.length,
      ledger_only_count: ledgerOnly.length,
      discarded_count: discarded.length,
      strong_unwritten_count: strongUnwritten.length,
      memory_required_but_empty: memoryRequiredButEmpty,
      candidates: candidates.map(memoryCandidateLedgerData),
      written,
      ledger_only: ledgerOnly.map((candidate) => candidate.id),
      estacionamento: estacionamento.map((candidate) => candidate.id),
      discarded: discarded.map((candidate) => candidate.id),
      blocked: blocked.map((candidate) => ({ id: candidate.id, blocked_reason: candidate.blocked_reason })),
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
        blocked_count: blocked.length
      }
    });
    flow.updated_at = now;
    await this.store.saveFlow(flow);
    await this.ledger(
      flow.flow_id,
      "memory_mined",
      {
        write_policy: writePolicy,
        candidates: candidates.map(memoryCandidateLedgerData),
        written,
        ledger_only: ledgerOnly.map((candidate) => candidate.id),
        estacionamento: estacionamento.map((candidate) => candidate.id),
        discarded: discarded.map((candidate) => candidate.id),
        blocked: blocked.map((candidate) => ({ id: candidate.id, blocked_reason: candidate.blocked_reason })),
        write_decisions: writeDecisions,
        edit_queue: editQueue,
        destination_warnings: destinationWarnings,
        strong_unwritten_count: strongUnwritten.length,
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
      ledger_only: ledgerOnly,
      estacionamento,
      discarded,
      blocked,
      write_decisions: writeDecisions,
      edit_queue: editQueue,
      destination_warnings: destinationWarnings,
      strong_unwritten_count: strongUnwritten.length,
      unclassified: blocked.length,
      blocked_verdict: summary.blocked_verdict,
      memory_required_but_empty: summary.memory_required_but_empty
    };
  }

  async goalRegress(input: {
    flow_id?: string;
    idempotency_key?: string;
    to?: Phase;
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
    }
    const to = input.to ?? fiscalBackTo(flow);
    const returned = await this.returnTo({
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
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id })
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
  }): Promise<Record<string, unknown>> {
    requireText(input.flow_id, "flow_id");
    assertNoSecretLikeText(input.title, "title");
    assertNoSecretLikeText(input.uri, "uri");
    assertNoSecretLikeText(input.content, "content");
    assertNoSecretLikeText(input.note, "note");
    const evidence = await this.attachEvidence({
      flow_id: input.flow_id,
      kind: input.kind ?? "goal_evidence",
      title: input.title,
      uri: input.uri,
      content: input.content,
      note: input.note,
      gold_mining: input.satisfies?.map((item) => `evidence_required:${item}`) ?? []
    });
    return {
      evidence_id: evidence.evidence_id,
      evidence,
      status: await this.goalStatus({ flow_id: input.flow_id })
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
    const flow = await this.store.loadFlow(input.flow_id);
    assertGoalBinding(flow);
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
    }
    const meetingIds = unique([input.meeting_id, ...(input.meeting_ids ?? [])].filter(Boolean) as string[]);
    for (const meetingId of meetingIds) {
      const meeting = await this.store.loadMeeting(meetingId);
      if (meeting.flow_id !== flow.flow_id) {
        throw new Error(`meeting_id ${meetingId} does not belong to GOAL flow ${flow.flow_id}`);
      }
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
    let memoryMining: Record<string, unknown> | null = null;
    if (input.status === "pronto" || input.status === "pronto_com_ressalvas") {
      memoryMining = hasMemoryMiningRun(flow) ? (flow.memory_mining ?? null) : null;
    }
    const fiscalFlow = await this.store.loadFlow(input.flow_id);
    const fiscal = evaluateFiscalPolicy(fiscalFlow, {
      ...input,
      memory_mining: memoryMining
    });
    if (fiscal.blocking_reasons.length > 0) {
      await this.persistFiscalBlock(fiscalFlow, fiscal, "goal_verdict");
      throw new Error(`PPIRTV_FISCAL_BLOCKED: ${fiscal.blocking_reasons.join(", ")}; required_cooperation=${fiscal.required_cooperation.map((item) => item.name).join("|")}`);
    }
    if (memoryMining?.blocked_verdict === true) {
      throw new Error("MEMORY_MINING_BLOCKED_VERDICT: resolver memory_candidates bloqueados antes do veredito positivo");
    }
    const verdictLearning = deriveVerdictLearning(input, flow.evidence.filter((evidence) => evidenceIds.includes(evidence.evidence_id)));
    const verdict = await this.recordVerdict({
      flow_id: input.flow_id,
      status: input.status,
      rationale: input.rationale,
      evidence_ids: evidenceIds,
      residual_risks: input.residual_risks ?? [],
      review_findings: input.review_findings ?? [],
      parking_lot: verdictLearning.parking_lot,
      gold_mining: verdictLearning.gold_mining,
      next_step: input.next_step
    });
    return {
      verdict,
      verdict_learning: verdictLearning,
      memory_mining: memoryMining,
      status: await this.goalStatus({ flow_id: input.flow_id })
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
    phase?: Phase;
    provided?: Record<string, unknown>;
    persist?: boolean;
  }): Promise<GateRecord & PresentationEnvelope> {
    const flow = await this.store.loadFlow(input.flow_id);
    const phase = input.phase ?? flow.phase;
    assertPhase(phase);
    const provided = input.provided ?? {};
    if (phase === "implementacao") {
      flow.changed_files = unique([...flow.changed_files, ...stringArray(provided.changed_files)]);
    }
    const missing = GATE_REQUIREMENTS[phase]
      .filter((requirement) => !hasRequirement(flow, requirement.key, requirement.source, provided))
      .map((requirement) => requirement.key);
    if (needsReviewCoherence(flow, phase, provided)) {
      missing.push("review_evidence_coherent");
    }
    if (missing.length === 0) {
      missing.push(...evaluateFiscalPolicy(flow).blocking_reasons);
    }
    const status = missing.length === 0 ? "passed" : "blocked";
    const record: GateRecord = {
      phase,
      status,
      checked_at: nowIso(),
      provided,
      missing,
      next: status === "passed" ? `advance_to_${NEXT_PHASE[phase] ?? "complete"}` : `complete_gate_${phase}`,
      back_to: status === "passed" ? null : DEFAULT_BACK_TO[phase]
    };
    if (input.persist ?? true) {
      flow.gates[phase] = record;
      flow.status = status === "blocked" ? "blocked" : flow.status === "blocked" ? "active" : flow.status;
      flow.updated_at = record.checked_at;
      flow.history.push({ at: record.checked_at, type: "gate_checked", data: record as unknown as Record<string, unknown> });
      await this.store.saveFlow(flow);
      await this.ledger(flow.flow_id, "gate_checked", record as unknown as Record<string, unknown>);
    }
    return presentGate(record, flow);
  }

  async advance(input: {
    flow_id: string;
    provided?: Record<string, unknown>;
    evidence_ids?: string[];
    actor?: string;
  }): Promise<Record<string, unknown> & Partial<PresentationEnvelope>> {
    const flow = await this.store.loadFlow(input.flow_id);
    if (flow.status === "archived") {
      throw new Error(`Flow ${flow.flow_id} is archived`);
    }
    const savedGate = flow.gates[flow.phase];
    const effectiveGate =
      !input.provided && savedGate?.status === "passed"
        ? savedGate
        : await this.checkGate({ flow_id: flow.flow_id, phase: flow.phase, provided: input.provided });
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
    const fresh = await this.store.loadFlow(flow.flow_id);
    const from = fresh.phase;
    const to = NEXT_PHASE[from];
    const now = nowIso();
    await this.runAfterPhaseHook(fresh, from, input.actor);
    if (to === null) {
      fresh.status = "complete";
      fresh.updated_at = now;
      fresh.history.push({ at: now, type: "flow_completed", data: { from } });
      await this.store.saveFlow(fresh);
      await this.ledger(fresh.flow_id, "flow_completed", { from, evidence_ids: input.evidence_ids ?? [] }, input.actor);
      return presentGate({ advanced: true, phase: from, from, to: null, status: "complete", next: "complete", back_to: null }, fresh);
    }
    fresh.phase = to;
    fresh.status = "active";
    fresh.updated_at = now;
    fresh.history.push({ at: now, type: "phase_advanced", data: { from, to, evidence_ids: input.evidence_ids ?? [] } });
    await this.store.saveFlow(fresh);
    await this.ledger(fresh.flow_id, "phase_advanced", { from, to, evidence_ids: input.evidence_ids ?? [] }, input.actor);
    const librarian = await this.runBeforePhaseHook(fresh, to, input.actor);
    const presented = presentGate({ advanced: true, phase: to, from, to, status: fresh.status, next: `gate_${to}`, back_to: null }, fresh);
    if (librarian) {
      presented.display.librarian = librarian;
    }
    return presented;
  }

  private async runAfterPhaseHook(flow: Flow, phase: Phase, actor?: string): Promise<void> {
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

  private async runBeforePhaseHook(flow: Flow, phase: Phase, actor?: string): Promise<RecallVisualStatus | null> {
    try {
      const summary = await this.memoryHooks.beforePhase({ flow, phase });
      const librarianStatus: RecallVisualStatus = {
        status: summary.visual_status.librarian,
        graphify_status: summary.visual_status.graphify,
        warnings: summary.warnings,
        recalled_count: summary.items.length
      };
      await this.ledger(
        flow.flow_id,
        "memory_recalled",
        {
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
          graphify_status: summary.visual_status.graphify
        },
        actor ?? "bibliotecario"
      );
      const stored = await this.store.loadFlow(flow.flow_id);
      stored.history.push({
        at: nowIso(),
        type: "memory_recalled",
        data: {
          phase,
          recalled_count: summary.items.length,
          warnings: summary.warnings,
          librarian_status: summary.visual_status.librarian,
          graphify_status: summary.visual_status.graphify
        }
      });
      stored.updated_at = nowIso();
      await this.store.saveFlow(stored);
      return librarianStatus;
    } catch (error) {
      const failed: RecallVisualStatus = {
        status: "failed",
        graphify_status: "failed",
        warnings: [`bibliotecario_failed: ${error instanceof Error ? error.message : String(error)}`],
        recalled_count: 0
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
          graphify_status: "failed"
        }
      });
      stored.updated_at = nowIso();
      await this.store.saveFlow(stored);
      return failed;
    }
  }

  private async recordMemoryHookWarning(flowId: string, hook: "beforePhase" | "afterPhase", phase: Phase, error: unknown, actor?: string): Promise<void> {
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
          graphify_status: "failed"
        }
      });
      flow.updated_at = nowIso();
      await this.store.saveFlow(flow);
    } catch {
      // The librarian is advisory in v1; hook warning persistence is best effort.
    }
  }

  async returnTo(input: { flow_id: string; to: Phase; reason: string; evidence_ids?: string[]; actor?: string }): Promise<Flow & PresentationEnvelope> {
    assertPhase(input.to);
    requireText(input.reason, "reason");
    const flow = await this.store.loadFlow(input.flow_id);
    const from = flow.phase;
    const now = nowIso();
    flow.phase = input.to;
    flow.status = "active";
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
    created_by?: string;
    evidence_ids?: string[];
  }): Promise<Meeting & PresentationEnvelope> {
    requireText(input.question, "question");
    const flow = await this.store.loadFlow(input.flow_id);
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
    const flow = await this.store.loadFlow(meeting.flow_id);
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
    const flow = await this.store.loadFlow(meeting.flow_id);
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
    requireText(input.decision, "decision");
    const meeting = await this.store.loadMeeting(input.meeting_id);
    const flow = await this.store.loadFlow(meeting.flow_id);
    const now = nowIso();
    const participantsPresent = unique(input.participants_present ?? meeting.participants_present);
    const missingParticipants = meeting.participants_required.filter((participant) => !participantsPresent.includes(participant));
    const requestedSatisfies = unique(input.satisfies_blockers ?? latestFiscalBlock(flow).blocking_reasons);
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
      type: "meeting_closed",
      data: {
        ...meetingClosedLedgerData(meeting),
        missing_participants: missingParticipants,
        participants_minimum_satisfied: missingParticipants.length === 0
      }
    });
    await this.store.saveMeeting(meeting);
    await this.store.saveFlow(flow);
    await this.ledger(meeting.flow_id, "meeting_closed", {
      ...meetingClosedLedgerData(meeting),
      missing_participants: missingParticipants,
      participants_minimum_satisfied: missingParticipants.length === 0
    });
    return presentArtifact(meeting as Meeting & Record<string, unknown>, flow);
  }

  async attachEvidence(input: {
    flow_id: string;
    kind: string;
    title: string;
    uri?: string;
    content?: string;
    note?: string;
    parking_lot?: string[];
    gold_mining?: string[];
    cooperators?: Flow["cooperators"];
    active_credits?: string[];
  }): Promise<Evidence & PresentationEnvelope> {
    requireText(input.title, "title");
    const flow = await this.store.loadFlow(input.flow_id);
    const now = nowIso();
    const evidence: Evidence = {
      evidence_id: await this.store.nextId("evd"),
      flow_id: flow.flow_id,
      kind: input.kind || "note",
      title: input.title,
      uri: input.uri,
      content: input.content,
      note: input.note,
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

  async renderChecklist(flowId: string): Promise<{
    flow_id: string;
    phase: Phase;
    markdown: string;
    items: Array<{ label: string; checked: boolean }>;
    operational_principles: PrincipleChecklistItem[];
    required_cooperation?: Cooperator[];
    fiscal_policy?: FiscalPolicyResult;
  } & PresentationEnvelope> {
    const flow = await this.store.loadFlow(flowId);
    const items = GATE_REQUIREMENTS[flow.phase].map((requirement) => ({
      label: requirement.label,
      checked: hasRequirement(flow, requirement.key, requirement.source, flow.gates[flow.phase]?.provided ?? {})
    }));
    const fiscal = evaluateFiscalPolicy(flow);
    const persistedFiscal = latestFiscalBlock(flow);
    const blockers = reconciledBlockers(flow, [...fiscal.blocking_reasons, ...persistedFiscal.blocking_reasons]);
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
    const markdown = [
      `# Checklist PPIRTV - ${flow.flow_id}`,
      "",
      `Fase atual: ${flow.phase}`,
      "",
      ...items.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`),
      "",
      "## Principios operacionais",
      "",
      ...operationalPrinciples.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`)
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
      ...(blockers.length > 0 || flow.status === "blocked" ? withDirectAction(presented, blockedDirectAction(blockers.length > 0 ? blockers : ["flow_blocked"])) : presented),
      operational_principles: operationalPrinciples,
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
    review_findings?: string[];
    parking_lot?: string[];
    gold_mining?: string[];
    cooperators?: Flow["cooperators"];
    active_credits?: string[];
    next_step: string;
  }): Promise<Verdict & PresentationEnvelope> {
    requireText(input.rationale, "rationale");
    requireText(input.next_step, "next_step");
    const flow = await this.store.loadFlow(input.flow_id);
    const evidenceIds = input.evidence_ids ?? [];
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
      review_findings: input.review_findings ?? [],
      parking_lot: input.parking_lot ?? [],
      gold_mining: input.gold_mining ?? [],
      cooperators: input.cooperators ?? [],
      active_credits: input.active_credits ?? [],
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
    flow.status = status === "pronto" || status === "pronto_com_ressalvas" ? "complete" : flow.status;
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
      const flow = await this.store.loadFlow(flowId);
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
      required_cooperation: blockingFindings.length > 0 ? requiredCoo("hygiene_scan encontrou achados materiais antes do veredito") : []
    };
  }

  private async persistFiscalBlock(flow: Flow, fiscal: FiscalPolicyResult, source: string): Promise<void> {
    const now = nowIso();
    const loopId = blockerLoopId(fiscal.blocking_reasons);
    const loopSignature = blockerSignature(fiscal.blocking_reasons);
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
        required_cooperation: fiscal.required_cooperation
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
      required_cooperation: fiscal.required_cooperation
    });
  }

  async archiveFlow(input: { flow_id: string; reason?: string }): Promise<Flow & PresentationEnvelope> {
    const flow = await this.store.loadFlow(input.flow_id);
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
    return flows.find((flow) => flow.goal_binding?.envelope.idempotency_key === idempotencyKey);
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
          next_step: "continue_pipeline_or_archive",
          clean_house: true
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

function containsLoose(text: string, fragment: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  return normalize(text).includes(normalize(fragment));
}

function parseSpt(text: string): Pick<SptValidationResult, "tasks" | "expected_evidence" | "done_criteria"> {
  if (!text.trim()) {
    return { tasks: [], expected_evidence: [], done_criteria: [] };
  }
  const tasksSection = sectionText(text, ["tasks", "tasks"]);
  const validationSection = sectionText(text, ["validacao", "validation"]);
  const evidenceSection = sectionText(text, ["evidencia", "evidencias", "evidencias esperadas", "expected evidence"]);
  const doneSection = sectionText(text, [
    "done criteria",
    "criterios de pronto",
    "criterios de validacao",
    "criterios de aceite",
    "definition of done",
    "gate de pronto"
  ]);
  const table = parseTaskTable(tasksSection);
  const taskList = listItems(tasksSection);
  const evidenceList = unique([...listItems(evidenceSection), ...listItems(validationSection)]);
  const doneCriteria = unique([...table.done_criteria, ...listItems(doneSection), ...criteriaLikeLines(validationSection)]);
  return {
    tasks: unique([...table.tasks, ...taskList]),
    expected_evidence: evidenceList,
    done_criteria: doneCriteria
  };
}

function hasSection(text: string, headings: string[]): boolean {
  const wanted = new Set(headings.map(normalizeHeading));
  return text.split(/\r?\n/).some((line) => {
    const heading = line.match(/^#{2,6}\s+(.+?)\s*#*\s*$/);
    return !!heading && wanted.has(normalizeHeading(heading[1]));
  });
}

function sectionText(text: string, headings: string[]): string {
  const wanted = new Set(headings.map(normalizeHeading));
  const lines = text.split(/\r?\n/);
  const selected: string[] = [];
  let active = false;
  for (const line of lines) {
    const heading = line.match(/^#{2,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (active) {
        break;
      }
      active = wanted.has(normalizeHeading(heading[1]));
      continue;
    }
    if (active) {
      selected.push(line);
    }
  }
  return selected.join("\n");
}

function normalizeHeading(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[`*_]/g, "")
    .trim()
    .toLowerCase();
}

function listItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/)?.[1]?.trim() ?? "")
    .filter(Boolean);
}

function parseTaskTable(text: string): { tasks: string[]; done_criteria: string[] } {
  const tasks: string[] = [];
  const doneCriteria: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 4 || /^-+$/.test(cells[0]) || /^id$/i.test(cells[0])) {
      continue;
    }
    const task = cells.length >= 5 ? cells[3] : cells.at(-1);
    const criterion = cells.length >= 5 ? cells[4] : undefined;
    if (task) {
      tasks.push(task);
    }
    if (criterion) {
      doneCriteria.push(criterion);
    }
  }
  return { tasks: unique(tasks), done_criteria: unique(doneCriteria) };
}

function criteriaLikeLines(text: string): string[] {
  return listItems(text).filter((item) => /passa|passou|valid|evid|pronto|check|test/i.test(item));
}

function normalizeGoalEnvelope(input: GoalEnvelope): GoalEnvelope {
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
    source: input.source.trim()
  };
}

function assertCompatibleGoalBinding(binding: GoalBinding | undefined, envelope: GoalEnvelope): void {
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
    tasks: flow?.tasks ?? [],
    expected_evidence: flow?.expected_evidence ?? binding.envelope.required_evidence,
    done_criteria: flow?.done_criteria ?? []
  };
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

function hasRequirement(flow: Flow, key: string, source: string, provided: Record<string, unknown>): boolean {
  if (source === "provided") {
    return truthy(provided[key]);
  }
  if (source === "evidence") {
    return flow.evidence.length > 0 || truthy(provided[key]);
  }
  if (source === "verdict") {
    return flow.verdicts.length > 0 || truthy(provided[key]);
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

function evaluateFiscalPolicy(flow: Flow, input: FiscalVerdictInput = {}): FiscalPolicyResult {
  const material = fiscalMateriality(flow, input);
  const blockingReasons: string[] = [];
  if (!material) {
    return fiscalResult(false, []);
  }

  if (!hasClosedMeetingSatisfying(flow, input, "required_cooperation")) {
    blockingReasons.push("required_cooperation");
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
  if (librarianRequired(input) && latestLibrarianStatus(flow)?.status !== "recalled") {
    blockingReasons.push("librarian_status");
  }
  if (recurringRisk(input) && regressLimitReached(flow, input)) {
    blockingReasons.push("attempt_regress_count");
  } else if (recurringRisk(input) && !hasEnoughAttempts(flow, input)) {
    blockingReasons.push("attempt_regress_count");
  }

  return fiscalResult(true, unique(blockingReasons));
}

function fiscalResult(material: boolean, blockingReasons: string[]): FiscalPolicyResult {
  return {
    material,
    blocking_reasons: blockingReasons,
    required_cooperation: material ? requiredCoo(blockingReasons) : [],
    meeting_policy: {
      required: material,
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
        ? `regressar_para_reuniao_review_memoria: ${blockingReasons.join(", ")}`
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
  if ((name === "garimpeiro" || name === "dex-memoria") && blockers.includes("memory_required_but_empty")) {
    return "obrigatorio por memory_required_but_empty: garimpar pepitas e classificar memoria L1/L2 antes de veredito positivo";
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

function materialRiskText(text: string): boolean {
  return /(risco material|risco de produto|regress|erro recorrente|falh|bloque|sem reuniao|sem reunião|sem revisor|sem memoria|sem memória|bibliotecario|bibliotecário|graphify|hygiene|codigo|código|mudanca de codigo|mudança de código|principios|princípios)/i.test(text);
}

function memoryRequiredByFlow(flow: Flow, input: FiscalVerdictInput = {}): boolean {
  return (
    flow.history.some(
      (event) =>
        event.type === "fiscal_policy_blocked" &&
        (event.data.memory_required === true || stringArray(event.data.blocking_reasons).includes("memory_required_but_empty"))
    ) ||
    /(memoria|memória|L1|L2|L3|lembranca|lembrança|aprendizado reutilizavel|aprendizado reutilizável|garimpo|pepita)/i.test(fiscalText(flow, input))
  );
}

function noMemoryWasPromoted(flow: Flow, memoryMining?: Record<string, unknown> | null): boolean {
  const status = memoryMining ?? flow.memory_mining;
  const writtenCount = typeof status?.written_count === "number" ? status.written_count : 0;
  if (writtenCount > 0) {
    return false;
  }
  const candidatesCount = typeof status?.candidates_count === "number" ? status.candidates_count : 0;
  const candidates = Array.isArray(status?.candidates) ? status.candidates : [];
  if (candidatesCount > 0) {
    return candidates.length === 0;
  }
  return true;
}

function codeReviewRequired(flow: Flow, input: FiscalVerdictInput): boolean {
  return flow.changed_files.length > 0 || /(codigo|código|mudanca de codigo|mudança de código|diff|review|revisor)/i.test(fiscalText(flow, input));
}

function hasReviewEvidence(flow: Flow, input: FiscalVerdictInput): boolean {
  return (
    truthy(input.review_artifact_path) ||
    truthy(input.review_findings) ||
    flow.evidence.some((evidence) => /review|revisor|diff/i.test([evidence.kind, evidence.title, evidence.note, evidence.content].filter(Boolean).join("\n")))
  );
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

function librarianRequired(input: FiscalVerdictInput): boolean {
  return /bibliotecario|bibliotecário|graphify|retorno visual/i.test([input.rationale, input.next_step, ...(input.residual_risks ?? [])].filter(Boolean).join("\n"));
}

function recurringRisk(input: FiscalVerdictInput): boolean {
  return /(erro recorrente|recorrente|tentativa|regress)/i.test([input.rationale, input.next_step, ...(input.residual_risks ?? [])].filter(Boolean).join("\n"));
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

function needsReviewCoherence(flow: Flow, phase: Phase, provided: Record<string, unknown>): boolean {
  const changedFilesVisible = flow.changed_files.length > 0 || stringArray(provided.changed_files).length > 0;
  if (phase !== "revisao" || !flow.goal_binding || !changedFilesVisible) {
    return false;
  }
  return truthy(provided.diff_reviewed) && !truthy(provided.review_artifact_path) && !truthy(provided.review_findings);
}

function latestFiscalBlock(flow: Flow): Pick<FiscalPolicyResult, "blocking_reasons" | "required_cooperation"> {
  const event = [...flow.history].reverse().find((item) => item.type === "fiscal_policy_blocked");
  if (!event) {
    return { blocking_reasons: [], required_cooperation: [] };
  }
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
    return !hasClosedMeetingSatisfying(flow, {}, "required_cooperation");
  }
  if (reason === "memory_required_but_empty") {
    return memoryRequiredByFlow(flow) && noMemoryWasPromoted(flow);
  }
  if (reason === "review_required") {
    return !hasReviewEvidence(flow, {});
  }
  return true;
}

function latestLibrarianStatus(flow: Flow): RecallVisualStatus | null {
  const event = [...flow.history].reverse().find((item) => item.type === "memory_recalled" || item.type === "memory_hook_warning");
  if (!event) {
    return null;
  }
  return {
    status: statusValue(event.data.librarian_status),
    graphify_status: statusValue(event.data.graphify_status),
    warnings: stringArray(event.data.warnings ?? event.data.message),
    recalled_count: typeof event.data.recalled_count === "number" ? event.data.recalled_count : 0
  };
}

function latestLibrarianStatusFromLedger(events: Array<{ type: string; data: Record<string, unknown> }>): RecallVisualStatus | null {
  const event = [...events].reverse().find((item) => item.type === "memory_recalled" || item.type === "memory_hook_warning");
  if (!event) {
    return null;
  }
  return {
    status: statusValue(event.data.librarian_status),
    graphify_status: statusValue(event.data.graphify_status),
    warnings: stringArray(event.data.warnings ?? event.data.message),
    recalled_count: typeof event.data.recalled_count === "number" ? event.data.recalled_count : 0
  };
}

function blockedDirectAction(blockers: string[]): { available: boolean; action: string } {
  return {
    available: true,
    action: `Bloqueado: ${blockers.join(", ")}`
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

function fiscalBackTo(flow: Flow): Phase {
  return DEFAULT_BACK_TO[flow.phase] ?? "pensamentos";
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
    blockers.some((blocker) => ["hygiene_blocking", "memory_required_but_empty", "review_required", "librarian_status"].includes(blocker)) &&
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
  if (blockers.includes("memory_required_but_empty")) {
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

function nextRequiredActionFor(
  flow: Flow,
  meetings: Meeting[],
  blockers: string[],
  backTo: Phase | null,
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
  const meetingKind = requiredMeetingKind(flow, blockers, regressLimitReached);
  const openMeeting = latestOpenMeeting(meetings, meetingKind) ?? latestOpenMeeting(meetings);
  if (blockers.includes("required_cooperation")) {
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
      can_retry_verdict: false
    };
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
  backTo: Phase | null,
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

function loopEscalationAction(flow: Flow, blockers: string[], backTo: Phase | null, loopMonitor: LoopMonitor | null): Record<string, unknown> | null {
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
      "C:\\Users\\Administrator\\.agents\\skills\\pesquisador-organizado\\SKILL.md",
      "C:\\Users\\Administrator\\.codex\\skills\\pesquisador-organizado\\SKILL.md",
      `${workspace}\\skills\\pesquisador-organizado\\SKILL.md`
    ],
    if_missing: {
      action: "create_local_skill",
      target: `${workspace}\\skills\\pesquisador-organizado\\SKILL.md`,
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
      `C:\\Users\\Administrator\\.agents\\skills\\${skill}\\SKILL.md`,
      `C:\\Users\\Administrator\\.codex\\skills\\${skill}\\SKILL.md`,
      `${workspace}\\skills\\${skill}\\SKILL.md`
    ],
    if_missing: {
      action: "execute_inline_fallback_or_create_local_skill_proposal",
      target: `${workspace}\\skills\\${skill}\\SKILL.md`,
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
        satisfies: ["review_required"]
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
  const fiscalBlockCount = windowEvents.filter(
    (event) => event.type === "fiscal_policy_blocked" && String(event.data.loop_signature ?? blockerSignature(stringArray(event.data.blocking_reasons))) === signature
  ).length;
  const reviewRegressCount = windowEvents.filter((event) => {
    if (event.type !== "phase_returned" || String(event.data.to) !== "revisao") {
      return false;
    }
    const text = [event.data.reason, ...(Array.isArray(event.data.evidence_ids) ? event.data.evidence_ids : [])].filter(Boolean).join("\n");
    return /review|revis|block|fiscal/i.test(text);
  }).length;
  const count = Math.max(fiscalBlockCount, reviewRegressCount);
  return {
    loop_id: loopId,
    signature,
    blockers: activeBlockers,
    count,
    fiscal_block_count: fiscalBlockCount,
    review_regress_count: reviewRegressCount,
    reset_policy: "contagem considera apenas a janela desde o ultimo progresso: evidencia, reuniao fechada, memoria minerada, gate passado, fase avancada, veredito ou blocker diferente",
    escalation: loopEscalationFor(count)
  };
}

function loopWindowEvents(flow: Flow, signature: string): Flow["history"] {
  const history = flow.history;
  let start = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (isLoopResetEvent(history[index], signature)) {
      start = index + 1;
      break;
    }
  }
  return history.slice(start);
}

function isLoopResetEvent(event: Flow["history"][number], signature: string): boolean {
  if (event.type === "fiscal_policy_blocked") {
    const eventSignature = String(event.data.loop_signature ?? blockerSignature(stringArray(event.data.blocking_reasons)));
    return eventSignature !== signature;
  }
  if (event.type === "gate_checked" && event.data.status === "passed") {
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
  return {
    bibliotecario: {
      enabled: librarianStatus !== "disabled",
      status: librarianStatus,
      reason: raw ? librarianReason(librarianStatus) : "await_beforePhase_or_report_disabled",
      visible: true,
      functional_tested: librarianFunctionalTested
    },
    graphify: {
      enabled: graphifyConfigured || graphifyStatus !== "disabled",
      configured: graphifyConfigured,
      status: graphifyStatus,
      reason: raw ? graphifyReason(graphifyStatus) : graphifyConfigured ? "configured_awaiting_beforePhase_functional_test" : "optional_disabled_reported",
      visible: true,
      functional_tested: graphifyFunctionalTested
    },
    warnings: raw?.warnings ?? [],
    recalled_count: raw?.recalled_count ?? 0,
    functional_tested: librarianFunctionalTested || graphifyFunctionalTested
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
  const cooVisible = requiredCooperation.length > 0 || flow.cooperators.length > 0;
  const graphifyStatus = librarianStatus.graphify.status;
  const meetingRequired = blockers.includes("required_cooperation");
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
    !cooVisible ||
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
        status: cooVisible ? "visible" : "needs_visibility",
        visible: cooVisible,
        auto_repair: cooVisible ? "already_visible" : "required_cooperation_generated"
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

function ppirtvCheckOut(
  flow: Flow,
  librarianStatus: StructuredLibrarianStatus,
  blockers: string[],
  resolutionGuidance: Record<string, unknown> | null = null
): Record<string, unknown> {
  const latestVerdict = flow.verdicts.at(-1);
  const closed = flow.status === "complete" || flow.status === "archived";
  const memoryMining = memoryMiningStatus(flow);
  const memoryAccountability = memoryCheckoutAccountability(flow, memoryMining);
  const learningAccountability = learningCheckoutAccountability(flow);
  const cooperationAccountability = cooperationCheckoutAccountability(flow);
  const librarianAccountability = librarianCheckoutAccountability(librarianStatus);
  const utilityAccountability = utilityCheckoutAccountability({
    flow,
    memory: memoryAccountability,
    learning: learningAccountability,
    cooperation: cooperationAccountability,
    librarian: librarianAccountability
  });
  return {
    complete: closed,
    status: flow.status,
    verdict: latestVerdict?.status ?? null,
    meetings_count: flow.meetings.length,
    evidence_count: flow.evidence.length,
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
    utility_accountability: utilityAccountability,
    prestacao_de_contas: {
      utilidade: utilityAccountability,
      memoria: memoryAccountability,
      garimpo: learningAccountability.garimpado,
      estacionamento: learningAccountability.estacionado,
      pontos_cegos: learningAccountability.pontos_cegos,
      cooperadores: cooperationAccountability,
      bibliotecario: librarianAccountability
    },
    residual_risks: latestVerdict?.residual_risks ?? [],
    resolution_guidance: resolutionGuidance,
    direct_action: blockers.length > 0
      ? `check-out bloqueado: ${blockers.join(", ")}; abrir reuniao/revisor/memoria conforme resolution_guidance antes de veredito positivo`
      : closed
        ? "fechamento_total_registrado"
        : "check-out pendente ate veredito/arquivo"
  };
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

function memoryWriteDecision(candidate: MemoryCandidate, writePolicy: MemoryWritePolicy, writtenIds: Set<string>): Record<string, unknown> {
  const written = writtenIds.has(candidate.id);
  return {
    candidate_id: candidate.id,
    title: candidate.title,
    action: written ? "written" : memoryNonWriteAction(candidate, writePolicy, writtenIds),
    reason: written ? "written_by_auto_write_policy" : memoryNonWriteReason(candidate, writePolicy, writtenIds),
    scope: candidate.scope,
    score: candidate.score.total,
    editable: !written
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
}): Record<string, unknown> {
  const memoryEditQueue = Array.isArray(input.memory.edit_queue) ? (input.memory.edit_queue as Array<Record<string, unknown>>) : [];
  const warnings = Array.isArray(input.memory.destination_warnings) ? input.memory.destination_warnings.map(String) : [];
  const garimpado = stringArray(input.learning.garimpado);
  const estacionado = stringArray(input.learning.estacionado);
  const pontosCegos = stringArray(input.learning.pontos_cegos);
  const materialCount = typeof input.cooperation.material_count === "number" ? input.cooperation.material_count : 0;
  const worked = input.librarian.worked === true;
  return {
    painel: [
      `M memoria: candidates=${input.memory.candidates_count ?? 0}, written=${input.memory.written_count ?? 0}, editaveis=${memoryEditQueue.length}`,
      `G garimpo: ${garimpado.length}`,
      `E estacionamento: ${estacionado.length}`,
      `P pontos_cegos: ${pontosCegos.length}`,
      `C cooperadores_materiais: ${materialCount}`,
      `B bibliotecario_graphify: ${worked ? "worked" : "not_confirmed"}`
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
      memoryMining.written_count > 0
        ? `memoria gravada: L1=${layers.L1.length}, L2=${layers.L2.length}, L3=${layers.L3.length}`
        : memoryMining.candidates_count > 0
          ? "memoria classificada sem escrita canonica neste checkout"
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
    } else if (/\/?MEMORIA\.md$/i.test(normalized) || /\/?memoria\.md$/i.test(normalized)) {
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
  return {
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
        : "nenhum cooperador material registrado"
  };
}

function librarianCheckoutAccountability(librarianStatus: StructuredLibrarianStatus): Record<string, unknown> {
  const worked = librarianStatus.functional_tested === true;
  const graphifyWorked = librarianStatus.graphify.functional_tested === true;
  return {
    worked,
    bibliotecario_worked: librarianStatus.bibliotecario.functional_tested,
    graphify_worked: graphifyWorked,
    status: librarianStatus,
    summary: worked
      ? "Bibliotecario/Graphify tiveram participacao funcional testada"
      : graphifyWorked
        ? "Graphify teve participacao funcional; Bibliotecario nao confirmou recall funcional completo"
        : `Bibliotecario/Graphify nao tiveram participacao funcional confirmada; graphify=${librarianStatus.graphify.status}, bibliotecario=${librarianStatus.bibliotecario.status}`
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
  if (!PHASES.includes(phase as Phase)) {
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
      strong_unwritten_count: 0
    }
  );
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
