import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_BACK_TO,
  GATE_REQUIREMENTS,
  NEXT_PHASE,
  PHASES,
  type Evidence,
  type Flow,
  type GateRecord,
  type HygieneFinding,
  type Meeting,
  type MeetingType,
  type PresentationEnvelope,
  type Phase,
  type Scope,
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
    flow.parking_lot = unique([...flow.parking_lot, ...meeting.parking_lot]);
    flow.gold_mining = unique([...flow.gold_mining, ...meeting.gold_mining]);
    flow.cooperators = uniqueCooperators([...flow.cooperators, ...meeting.cooperators]);
    flow.active_credits = unique([...flow.active_credits, ...meeting.active_credits]);
    flow.updated_at = now;
    flow.history.push({ at: now, type: "meeting_recorded", data: { meeting_id: meeting.meeting_id, type: meeting.type } });
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
        action: "Remover temporarios obvios ou justificar se forem artefatos."
      });
    }
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
