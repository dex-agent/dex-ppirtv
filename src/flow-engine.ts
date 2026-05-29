import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
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
  type GoalLearningLink,
  type GoalBinding,
  type GoalEnvelope,
  type HygieneFinding,
  type Meeting,
  type MeetingType,
  type MemoryCandidate,
  type MemoryMiningSummary,
  type MemoryWritePolicy,
  type PipelineFlowResult,
  type PipelineItem,
  type PresentationEnvelope,
  type Phase,
  type Scope,
  type SptValidationResult,
  type Verdict,
  type VerdictStatus
} from "./domain.js";
import { presentArtifact, presentChecklist, presentFlow, presentGate } from "./presentation.js";
import { principleChecklist, scanOperationalPrinciples, type PrincipleChecklistItem } from "./principles.js";
import { PpirtvStore } from "./store.js";

const DEFAULT_SCOPE: Scope = { in: [], out: [] };

export class FlowEngine {
  constructor(readonly store: PpirtvStore) {}

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
    const flow = await this.resolveGoalFlow(input);
    const checklist = await this.renderChecklist(flow.flow_id);
    const gate = await this.checkGate({ flow_id: flow.flow_id, phase: flow.phase, persist: false });
    const currentVerdict = flow.verdicts.at(-1) ?? null;
    return {
      flow_id: flow.flow_id,
      status: flow.status,
      phase: flow.phase,
      phase_label: checklist.display.phase_label,
      phase_emoji: checklist.display.phase_emoji,
      checklist,
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
      meetings: (await this.store.listMeetings(flow.flow_id)).map((meeting) => ({
        meeting_id: meeting.meeting_id,
        type: meeting.type,
        status: meeting.status,
        question: meeting.question,
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
      blockers: gate.status === "blocked" ? gate.missing : [],
      next_step: nextGoalStep(flow, gate),
      current_verdict: currentVerdict,
      goal_envelope: flow.goal_binding?.envelope ?? null,
      aliases: checklist.aliases,
      display: checklist.display,
      suggested_cooperation: gate.suggested_cooperation
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
    type: MeetingType;
    question: string;
    suggested_cooperators?: Cooperator[];
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    assertGoalBinding(flow);
    assertNoSecretLikeText(input.question, "question");
    const suggestedCooperators = normalizeSuggestedCooperators(input.suggested_cooperators ?? []);
    const meeting = await this.openMeeting({
      flow_id: flow.flow_id,
      type: input.type,
      question: input.question
    });
    return {
      ...meeting,
      suggested_cooperators: suggestedCooperators,
      credit_rule: "suggested_cooperators are not active credits until goal_meeting_record records material=true contributions",
      status_snapshot: await this.goalStatus({ flow_id: flow.flow_id })
    };
  }

  async goalMeetingRecord(input: Partial<Meeting> & {
    flow_id?: string;
    idempotency_key?: string;
    meeting_id: string;
  }): Promise<Record<string, unknown>> {
    const flow = await this.resolveGoalFlow(input);
    assertGoalBinding(flow);
    const meeting = await this.store.loadMeeting(input.meeting_id);
    if (meeting.flow_id !== flow.flow_id) {
      throw new Error(`meeting_id ${input.meeting_id} does not belong to GOAL flow ${flow.flow_id}`);
    }
    assertNoSecretLikePayload(input, "goal_meeting_record");
    const cooperators = uniqueCooperators(input.cooperators ?? meeting.cooperators);
    const activeCredits = materialActiveCredits(cooperators, input.active_credits ?? meeting.active_credits);
    const recorded = await this.recordMeeting({
      ...input,
      meeting_id: input.meeting_id,
      cooperators,
      active_credits: activeCredits
    });
    return {
      ...recorded,
      material_cooperators: cooperators.filter((cooperator) => cooperator.material),
      ignored_active_credits:
        (input.active_credits ?? []).filter((credit) => !activeCredits.includes(credit)),
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
        discarded: [],
        blocked: [],
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
    const discarded = candidates.filter((candidate) => candidate.scope === "descartar" || candidate.scope === "estacionamento");
    const written: Array<{ candidate_id: string; files: string[] }> = [];

    if (writePolicy === "auto_write") {
      for (const candidate of writable) {
        const files = await writeMemoryCandidate(candidate);
        written.push({ candidate_id: candidate.id, files });
      }
    }

    const now = nowIso();
    const summary: MemoryMiningSummary = {
      required: candidates.length > 0,
      last_run_at: now,
      blocked_verdict: blocked.length > 0,
      candidates_count: candidates.length,
      written_count: written.length,
      blocked_count: blocked.length,
      ledger_only_count: ledgerOnly.length,
      discarded_count: discarded.length
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
        discarded: discarded.map((candidate) => candidate.id),
        blocked: blocked.map((candidate) => ({ id: candidate.id, blocked_reason: candidate.blocked_reason })),
        blocked_verdict: summary.blocked_verdict
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
      discarded,
      blocked,
      unclassified: blocked.length,
      blocked_verdict: summary.blocked_verdict
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
    next_step: string;
  }): Promise<Record<string, unknown>> {
    requireText(input.flow_id, "flow_id");
    assertNoSecretLikeText(input.rationale, "rationale");
    assertNoSecretLikeText(input.next_step, "next_step");
    for (const risk of input.residual_risks ?? []) {
      assertNoSecretLikeText(risk, "residual_risks");
    }
    const flow = await this.store.loadFlow(input.flow_id);
    assertGoalBinding(flow);
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
      memoryMining = await this.mineMemory({
        flow_id: input.flow_id,
        auto_classify: true,
        write_policy: "auto_write"
      });
      if (memoryMining.blocked_verdict === true) {
        throw new Error("MEMORY_MINING_BLOCKED_VERDICT: resolver memory_candidates bloqueados antes do veredito positivo");
      }
    }
    const verdict = await this.recordVerdict({
      flow_id: input.flow_id,
      status: input.status,
      rationale: input.rationale,
      evidence_ids: evidenceIds,
      residual_risks: input.residual_risks ?? [],
      next_step: input.next_step
    });
    return {
      verdict,
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
    const missing = GATE_REQUIREMENTS[phase]
      .filter((requirement) => !hasRequirement(flow, requirement.key, requirement.source, provided))
      .map((requirement) => requirement.key);
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
      return presentGate({
        advanced: false,
        status: "blocked",
        phase: flow.phase,
        missing: effectiveGate.missing,
        next: effectiveGate.next,
        back_to: effectiveGate.back_to
      }, flow);
    }
    const fresh = await this.store.loadFlow(flow.flow_id);
    const from = fresh.phase;
    const to = NEXT_PHASE[from];
    const now = nowIso();
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
    return presentGate({ advanced: true, phase: to, from, to, status: fresh.status, next: `gate_${to}`, back_to: null }, fresh);
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

  async openMeeting(input: { flow_id: string; type: MeetingType; question: string }): Promise<Meeting & PresentationEnvelope> {
    requireText(input.question, "question");
    const flow = await this.store.loadFlow(input.flow_id);
    const now = nowIso();
    const meeting: Meeting = {
      meeting_id: await this.store.nextId("mtg"),
      flow_id: flow.flow_id,
      type: input.type,
      question: input.question,
      status: "open",
      opened_at: now,
      questions: [],
      hypotheses: [],
      alternatives: [],
      decisions: [],
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
    flow.history.push({ at: now, type: "meeting_opened", data: { meeting_id: meeting.meeting_id, type: meeting.type } });
    await this.store.saveMeeting(meeting);
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "meeting_opened", { meeting_id: meeting.meeting_id, type: meeting.type, question: meeting.question });
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
    flow.history.push({ at: now, type: "meeting_recorded", data: { meeting_id: meeting.meeting_id, type: meeting.type } });
    await this.store.saveMeeting(meeting);
    await this.store.saveFlow(flow);
    await this.ledger(meeting.flow_id, "meeting_recorded", meeting as unknown as Record<string, unknown>);
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
    return presentArtifact(evidence as Evidence & Record<string, unknown>, flow);
  }

  async renderChecklist(flowId: string): Promise<{
    flow_id: string;
    phase: Phase;
    markdown: string;
    items: Array<{ label: string; checked: boolean }>;
    operational_principles: PrincipleChecklistItem[];
  } & PresentationEnvelope> {
    const flow = await this.store.loadFlow(flowId);
    const items = GATE_REQUIREMENTS[flow.phase].map((requirement) => ({
      label: requirement.label,
      checked: hasRequirement(flow, requirement.key, requirement.source, flow.gates[flow.phase]?.provided ?? {})
    }));
    const operationalPrinciples = await principleChecklist();
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
    return {
      ...presentChecklist({
        flow,
        markdown,
        items,
        visualItems: [
          ...items.map((item) => ({ ...item, emoji: item.checked ? "✅" : "◻️" })),
          ...operationalPrinciples.map((item) => ({ label: item.label, checked: item.checked, emoji: item.checked ? "✅" : "⚡" }))
        ]
      }),
      operational_principles: operationalPrinciples
    };
  }

  async recordVerdict(input: {
    flow_id: string;
    status: VerdictStatus;
    rationale: string;
    evidence_ids?: string[];
    residual_risks?: string[];
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

  async hygieneScan(flowId?: string): Promise<{ findings: HygieneFinding[]; rule: string } & Partial<PresentationEnvelope>> {
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

    return {
      findings: findings.sort((a, b) => a.id.localeCompare(b.id)),
      rule: "barata nunca esta sozinha",
      aliases: {
        estacionamento: [],
        garimpo: []
      },
      display: {
        cooperators: [],
        active_credits: [],
        direct_action: {
          available: findings.length > 0,
          action: findings.length > 0 ? "Tratar achados acionaveis antes do veredito" : "Sem achados de higiene"
        }
      },
      suggested_cooperation: findings.length > 0 ? [{ name: "Chato", reason: "avaliar achados de higiene antes de declarar pronto", material: false }] : []
    };
  }

  async archiveFlow(input: { flow_id: string; reason?: string }): Promise<Flow & PresentationEnvelope> {
    const flow = await this.store.loadFlow(input.flow_id);
    const now = nowIso();
    flow.status = "archived";
    flow.archived_at = now;
    flow.updated_at = now;
    flow.history.push({ at: now, type: "flow_archived", data: { reason: input.reason ?? "archived" } });
    await this.store.saveFlow(flow);
    await this.ledger(flow.flow_id, "flow_archived", { reason: input.reason ?? "archived" });
    return presentFlow(flow);
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

function assertNoSecretLikeText(value: string | undefined, field: string): void {
  if (!value) {
    return;
  }
  const secretPatterns = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
    /\bsk-[A-Za-z0-9_-]{12,}\b/i,
    /\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/i
  ];
  if (secretPatterns.some((pattern) => pattern.test(value))) {
    throw new Error(`${field} appears to contain a secret-like value and cannot be recorded`);
  }
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
      discarded_count: 0
    }
  );
}

function linkParkingToGold(
  flow: Flow,
  parkingItems: string[],
  source: GoalLearningLink["source"],
  sourceId: string,
  createdAt: string
): string[] {
  if (!flow.goal_binding || parkingItems.length === 0) {
    return [];
  }
  flow.goal_learning_links ??= [];
  const promoted: string[] = [];
  for (const item of unique(parkingItems)) {
    const normalizedItem = normalizeTextKey(item);
    const existing = flow.goal_learning_links.find((link) => normalizeTextKey(link.parking_item) === normalizedItem);
    if (existing) {
      if (existing.garimpo_vinculado.promovido_para_gold_mining && existing.garimpo_vinculado.pepita) {
        promoted.push(existing.garimpo_vinculado.pepita);
      }
      continue;
    }

    const garimpo = garimparParkingItem(item);
    const goldId = garimpo.promovido_para_gold_mining ? `gm_${flow.gold_mining.length + promoted.length + 1}` : undefined;
    flow.goal_learning_links.push({
      id: `gl_${flow.goal_learning_links.length + 1}`,
      source,
      source_id: sourceId,
      parking_item: item,
      garimpo_vinculado: {
        ...garimpo,
        gold_id: goldId
      },
      created_at: createdAt
    });
    if (garimpo.promovido_para_gold_mining && garimpo.pepita) {
      promoted.push(garimpo.pepita);
    }
  }
  return unique(promoted);
}

const SECRET_LIKE_PATTERN =
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}\b|\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/i;

const GARIMPO_RULES: Array<{
  classification: GoalLearningLink["garimpo_vinculado"]["classificacao"];
  symbol: GoalLearningLink["garimpo_vinculado"]["simbolo"];
  pattern: RegExp;
  promote: boolean;
  prefix: string;
}> = [
  { classification: "armadilha", symbol: "⚠️", pattern: /token|api[_-]?key|authorization|password|secret|senha|\.env/i, promote: false, prefix: "" },
  { classification: "armadilha", symbol: "⚠️", pattern: /risco|quebra|regress|falh|bug|bloque|falso|invisivel|duplic/i, promote: true, prefix: "Armadilha observada" },
  { classification: "ponto_cego", symbol: "🕳️", pattern: /ponto cego|ocult|ambig|incert|premissa|desacopl|depend/i, promote: true, prefix: "Ponto cego observado" },
  { classification: "heuristica", symbol: "🔧", pattern: /heuristic|padrao|regra|sempre|nunca|prefer|quando|contrato|validar|verificar/i, promote: true, prefix: "Heuristica pratica" },
  { classification: "nao_promover", symbol: "·", pattern: /avaliar|depois|futuro|talvez|pendente|backlog|proximo ciclo/i, promote: false, prefix: "" }
];

const THEME_RULES: Array<{ theme: string; pattern: RegExp }> = [
  { theme: "pythia-deepseek", pattern: /pythia-deepseek/i },
  { theme: "delphi", pattern: /delphi|dunitx|pascal|firebird|acbr/i },
  { theme: "ppirtv", pattern: /ppirtv|goal|spt|trilho|ledger|flow/i },
  { theme: "mcp", pattern: /mcp/i },
  { theme: "deepseek", pattern: /deepseek/i },
  { theme: "codex", pattern: /codex|codewhale/i },
  { theme: "php", pattern: /php|laravel|composer/i }
];

const PARKING_ONLY_PATTERN = /avaliar|depois|futuro|talvez|pendente|backlog|proximo ciclo/i;
const DISCARD_PATTERN = /descartar|ruido|sem promocao/i;
const LEDGER_ONLY_PATTERN = /ledger[-_ ]only|somente ledger/i;
const GLOBAL_SCOPE_PATTERN = /global|cross-project|reutilizavel em qualquer projeto|qualquer repo/i;
const RECURRING_SIGNAL_PATTERN = /sempre|nunca|padrao|regra|recorrent|quando|contrato|gate|validar|verificar/i;
const FORGETTING_COST_PATTERN = /falh|bug|regress|bloque|quebra|falso|secret|token|evidencia|veredito/i;

function garimparParkingItem(item: string): GoalLearningLink["garimpo_vinculado"] {
  for (const rule of GARIMPO_RULES) {
    if (rule.pattern.test(item)) {
      return {
        classificacao: rule.classification,
        simbolo: rule.symbol,
        pepita: rule.promote ? `${rule.prefix}: ${item}` : null,
        promovido_para_gold_mining: rule.promote
      };
    }
  }
  return {
    classificacao: "nao_promover",
    simbolo: "·",
    pepita: null,
    promovido_para_gold_mining: false
  };
}

function resolveDexMemoriaHome(): string {
  return path.resolve(process.env.DEX_MEMORIA_HOME || path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".agents", "memories"));
}

function collectMemoryNuggets(flow: Flow, meetings: Meeting[]): Array<{ item: string; source: "gold_mining" | "parking_lot"; evidenceScore: number }> {
  const nuggets: Array<{ item: string; source: "gold_mining" | "parking_lot"; evidenceScore: number }> = [];
  const add = (items: string[], source: "gold_mining" | "parking_lot") => {
    for (const item of items) {
      if (!item.trim() || /^evidence_required:/i.test(item.trim())) {
        continue;
      }
      nuggets.push({ item, source, evidenceScore: source === "gold_mining" ? 1 : 0 });
    }
  };
  add(flow.gold_mining, "gold_mining");
  add(flow.parking_lot, "parking_lot");
  for (const link of flow.goal_learning_links ?? []) {
    if (link.garimpo_vinculado.pepita) {
      add([link.garimpo_vinculado.pepita], "gold_mining");
    } else {
      add([link.parking_item], "parking_lot");
    }
  }
  for (const meeting of meetings) {
    add(meeting.gold_mining, "gold_mining");
    add(meeting.parking_lot, "parking_lot");
  }
  for (const evidence of flow.evidence) {
    add(evidence.gold_mining, "gold_mining");
    add(evidence.parking_lot, "parking_lot");
  }
  for (const verdict of flow.verdicts) {
    add(verdict.gold_mining, "gold_mining");
    add(verdict.parking_lot, "parking_lot");
  }
  const seen = new Set<string>();
  return nuggets.filter((nugget) => {
    const key = `${nugget.source}:${normalizeTextKey(nugget.item)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function classifyMemoryCandidate(input: {
  id: string;
  item: string;
  source: "gold_mining" | "parking_lot";
  evidenceScore: number;
  workspace: string;
  dexMemoriaHome: string;
}): MemoryCandidate {
  const secretLike = SECRET_LIKE_PATTERN.test(input.item);
  const theme = detectTheme(input.item);
  const scope = chooseMemoryScope(input.item, input.source, theme, input.evidenceScore);
  const title = secretLike ? "secret-like item redacted" : memoryTitle(input.item);
  const score = scoreMemoryCandidate(input.item, input.source, scope, input.evidenceScore);
  const layer: MemoryCandidate["layer"] = "L2";
  const targetFiles = memoryTargetFiles(scope, theme, input.workspace, input.dexMemoriaHome);
  const blockedReason = candidateBlockedReason({
    secretLike,
    scope,
    theme,
    targetFiles,
    workspace: input.workspace
  });
  const l1 = `[${memorySlug(title)}] ${title}.`;
  const l2 = [
    `## ${title}`,
    "",
    `Problema: ${secretLike ? "[redacted]" : input.item}`,
    "Mecanismo: aprendizado classificado automaticamente a partir do flow PPIRTV.",
    `Verificacao: origem=${input.source}; score=${score.total}.`,
    "Prevencao: manter L1 antes da memoria detalhada e revisar destino antes do veredito."
  ].join("\n");
  return {
    id: input.id,
    title,
    source: input.source,
    scope,
    theme,
    layer,
    has_l1: !blockedReason,
    score,
    confidence: score.total >= 7 ? "alta" : score.total >= 6 ? "media" : "baixa",
    l1_gatilho: l1,
    l2_bloco: l2,
    target_files: targetFiles,
    blocked: Boolean(blockedReason),
    blocked_reason: blockedReason
  };
}

function detectTheme(item: string): string | undefined {
  return THEME_RULES.find((rule) => rule.pattern.test(item))?.theme;
}

function chooseMemoryScope(item: string, source: "gold_mining" | "parking_lot", theme: string | undefined, evidenceScore: number): MemoryCandidate["scope"] {
  if (source === "parking_lot" && PARKING_ONLY_PATTERN.test(item)) {
    return "estacionamento";
  }
  if (DISCARD_PATTERN.test(item)) {
    return "descartar";
  }
  if (LEDGER_ONLY_PATTERN.test(item) || (source === "parking_lot" && evidenceScore < 1)) {
    return "ledger_only";
  }
  if (theme) {
    return "tema";
  }
  if (GLOBAL_SCOPE_PATTERN.test(item)) {
    return "global";
  }
  return source === "gold_mining" ? "projeto" : "ledger_only";
}

function scoreMemoryCandidate(item: string, source: "gold_mining" | "parking_lot", scope: MemoryCandidate["scope"], evidenceScore: number): MemoryCandidate["score"] {
  const recurring = RECURRING_SIGNAL_PATTERN.test(item);
  const reaproveitamento = scope === "global" || scope === "tema" ? 2 : recurring ? 1 : 0;
  const evidencia = source === "gold_mining" ? Math.max(1, evidenceScore) : evidenceScore;
  const custo_esquecimento = FORGETTING_COST_PATTERN.test(item) ? 2 : 1;
  const transferibilidade = recurring || scope === "tema" || scope === "global" ? 2 : 1;
  return {
    reaproveitamento,
    evidencia,
    custo_esquecimento,
    transferibilidade,
    total: reaproveitamento + evidencia + custo_esquecimento + transferibilidade
  };
}

function memoryTargetFiles(scope: MemoryCandidate["scope"], theme: string | undefined, workspace: string, dexMemoriaHome: string): string[] {
  if (scope === "global") {
    return [path.join(dexMemoriaHome, "global", "LEMBRANCA.md"), path.join(dexMemoriaHome, "global", "MEMORIA.md")];
  }
  if (scope === "tema" && theme) {
    return [path.join(dexMemoriaHome, "temas", theme, "LEMBRANCA.md"), path.join(dexMemoriaHome, "temas", theme, "MEMORIA.md")];
  }
  if (scope === "projeto") {
    return [path.join(workspace, ".agents", "LEMBRANCA.md"), path.join(workspace, ".agents", "MEMORIA.md")];
  }
  return [];
}

function candidateBlockedReason(input: {
  secretLike: boolean;
  scope: MemoryCandidate["scope"];
  theme: string | undefined;
  targetFiles: string[];
  workspace: string;
}): string | null {
  if (input.secretLike) {
    return "secret_like_value_detected";
  }
  if (input.theme && /-/.test(input.theme)) {
    return `theme_looks_like_project: use ${input.theme.split("-").at(-1)}`;
  }
  if ((input.scope === "global" || input.scope === "tema") && input.targetFiles.some((file) => isInsideOrEqual(input.workspace, file))) {
    return "global_or_theme_memory_target_inside_workspace";
  }
  return null;
}

function isWritableCandidate(candidate: MemoryCandidate): boolean {
  return !candidate.blocked && candidate.score.evidencia >= 1 && candidate.score.total >= 6 && ["global", "tema", "projeto"].includes(candidate.scope);
}

async function writeMemoryCandidate(candidate: MemoryCandidate): Promise<string[]> {
  const [l1Path, l2Path] = candidate.target_files;
  if (!l1Path || !l2Path) {
    return [];
  }
  await appendUniqueBlock(l1Path, candidate.l1_gatilho);
  await appendUniqueBlock(l2Path, candidate.l2_bloco);
  return [l1Path, l2Path];
}

async function appendUniqueBlock(filePath: string, block: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    existing = "";
  }
  if (existing.includes(block.trim())) {
    return;
  }
  const prefix = existing.trim().length > 0 ? "\n\n" : "";
  await appendFile(filePath, `${prefix}${block.trim()}\n`, "utf8");
}

function memoryCandidateLedgerData(candidate: MemoryCandidate): Record<string, unknown> {
  return {
    id: candidate.id,
    title: candidate.title,
    source: candidate.source,
    scope: candidate.scope,
    theme: candidate.theme,
    layer: candidate.layer,
    score: candidate.score,
    confidence: candidate.confidence,
    target_files: candidate.target_files,
    blocked: candidate.blocked,
    blocked_reason: candidate.blocked_reason
  };
}

function memoryTitle(item: string): string {
  return item
    .replace(/^(Dica de ouro observada|Ponto cego observado|Armadilha observada|Heuristica pratica):\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

function memorySlug(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()
    .slice(0, 32);
  return slug || "MEMORY-CANDIDATE";
}

function normalizeTextKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
