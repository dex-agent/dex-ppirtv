import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-goal-fiscal-"));
  engine = new FlowEngine(new PpirtvStore(tempRoot));
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("GOAL fiscal canonical verdict boundary", () => {
  it("keeps suggested cooperators recoverable without turning them into material presence", async () => {
    const flow = await createOfficialValidationFlow("official-suggested-cooperators");

    const opened = await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Confirmar cooperadores indicados antes do veredito fiscal",
      suggested_cooperators: [
        { name: "ppi", reason: "protege metodo PPIRTV", material: true },
        { name: "chato", reason: "pressiona falso pronto", material: true }
      ]
    });
    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    const checkout = await engine.goalCheckout({ flow_id: flow.flow_id });

    expect(opened.suggested_cooperators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "ppi", material: false }),
        expect.objectContaining({ name: "chato", material: false })
      ])
    );
    expect(status.meetings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meeting_id: opened.meeting_id,
          suggested_cooperators: expect.arrayContaining([
            expect.objectContaining({ name: "ppi", material: false }),
            expect.objectContaining({ name: "chato", material: false })
          ]),
          participants_present: [],
          cooperators: [],
          active_credits: []
        })
      ])
    );
    expect((checkout.ppirtv_checkout as Record<string, unknown>).cooperation_accountability).toMatchObject({
      suggested_count: 2,
      suggested: expect.arrayContaining([
        expect.objectContaining({ name: "ppi", material: false }),
        expect.objectContaining({ name: "chato", material: false })
      ]),
      material_count: 0,
      active_credits: []
    });
  });

  it("diagnoses required_cooperation when a closed meeting lacks required participants", async () => {
    const flow = await createOfficialFiscalFlow("official-missing-participants");
    const opened = await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Fechar cooperacao fiscal"
    });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste de cooperacao fiscal com participantes insuficientes."
    });

    const closed = await engine.goalMeetingClose({
      flow_id: flow.flow_id,
      meeting_id: opened.meeting_id as string,
      participants_present: ["chato"],
      decision: "Tentativa insuficiente de fechar required_cooperation.",
      satisfies_blockers: ["required_cooperation"]
    });
    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Tentativa com participantes insuficientes.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["participantes insuficientes"],
        meeting_id: opened.meeting_id as string,
        next_step: "Fechar nova reuniao com participantes obrigatorios agora."
      })
    ).rejects.toThrow(/required_cooperation/i);
    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    const checkout = await engine.goalCheckout({ flow_id: flow.flow_id });

    expect(closed.satisfies_blockers).not.toContain("required_cooperation");
    expect(status.blockers).toContain("required_cooperation");
    expect(status.blocker_diagnostics).toMatchObject({
      required_cooperation: {
        missing_participants: expect.arrayContaining(["questionador", "reuniao", "validador-pronto"]),
        insufficient_meeting_ids: expect.arrayContaining([opened.meeting_id])
      }
    });
    expect((checkout.blocker_diagnostics as Record<string, unknown>).required_cooperation).toMatchObject({
      missing_participants: expect.arrayContaining(["questionador", "reuniao", "validador-pronto"]),
      insufficient_meeting_ids: expect.arrayContaining([opened.meeting_id])
    });
  });

  it("points goal_verdict to an eligible meeting when meeting_id is omitted", async () => {
    const flow = await createOfficialFiscalFlow("official-eligible-meeting");
    const opened = await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Fechar cooperacao fiscal completa"
    });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste de cooperacao fiscal com meeting_id elegivel."
    });

    await engine.goalMeetingClose({
      flow_id: flow.flow_id,
      meeting_id: opened.meeting_id as string,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
      decision: "Reuniao material fechada; required_cooperation satisfeito.",
      satisfies_blockers: ["required_cooperation"]
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Tentativa sem meeting_id deve orientar o operador.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem meeting_id no veredito"],
        next_step: "Repetir goal_verdict agora com meeting_id."
      })
    ).rejects.toThrow(/required_cooperation/i);

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.next_required_action).toMatchObject({
      type: "provide_meeting_id_for_verdict",
      tool: "goal_verdict",
      eligible_meeting_ids: [opened.meeting_id]
    });
    expect(status.blocker_diagnostics).toMatchObject({
      required_cooperation: {
        eligible_meeting_ids: [opened.meeting_id],
        missing_for_verdict: ["meeting_id"]
      }
    });
  });

  it("blocks official GOAL validation when provided verdict text is not canonical", async () => {
    const flow = await createOfficialValidationFlow("official-provided-verdict");

    const gate = await engine.goalGateCheck({
      flow_id: flow.flow_id,
      phase: "validacao",
      provided: validationProvidedVerdict()
    });
    const advanced = await engine.goalAdvance({ flow_id: flow.flow_id });
    const checkout = await engine.goalCheckout({ flow_id: flow.flow_id });
    const ledgerTypes = await ledgerEventTypes(flow.flow_id);

    expect(gate).toMatchObject({
      status: "blocked",
      missing: ["verdict"]
    });
    expect(advanced).toMatchObject({
      advanced: false,
      blocked: true,
      status: "blocked",
      missing: ["verdict"],
      status_snapshot: {
        phase: "validacao",
        current_verdict: null,
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict",
          can_retry_verdict: true
        }
      }
    });
    expect(checkout).toMatchObject({
      status: "blocked",
      phase: "validacao",
      blockers: ["verdict"],
      complete: false,
      verdict: null,
      resolution_guidance: {
        blockers: ["verdict"],
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict"
        }
      }
    });
    expect(ledgerTypes).not.toContain("verdict_recorded");
    expect(ledgerTypes).not.toContain("flow_completed");
  });

  it("keeps goal_status, goal_advance and ppirtv_checkout coherent for a stale official validation gate", async () => {
    const flow = await createOfficialValidationFlow("official-stale-gate");
    flow.gates.validacao = {
      phase: "validacao",
      status: "passed",
      checked_at: new Date().toISOString(),
      provided: validationProvidedVerdict(),
      missing: [],
      next: "advance_to_complete",
      back_to: null
    };
    await engine.store.saveFlow(flow);

    const before = await engine.goalStatus({ flow_id: flow.flow_id });
    const advanced = await engine.goalAdvance({ flow_id: flow.flow_id });
    const checkout = await engine.goalCheckout({ flow_id: flow.flow_id });
    const ledgerTypes = await ledgerEventTypes(flow.flow_id);

    expect(before).toMatchObject({
      status: "active",
      phase: "validacao",
      blockers: ["verdict"],
      current_verdict: null,
      next_required_action: {
        type: "goal_verdict_required",
        tool: "goal_verdict",
        can_retry_verdict: true
      }
    });
    expect(advanced).toMatchObject({
      advanced: false,
      blocked: true,
      status: "blocked",
      missing: ["verdict"],
      status_snapshot: {
        status: "blocked",
        phase: "validacao",
        blockers: ["verdict"],
        current_verdict: null,
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict",
          can_retry_verdict: true
        }
      }
    });
    expect(checkout).toMatchObject({
      status: "blocked",
      phase: "validacao",
      blockers: ["verdict"],
      complete: false,
      verdict: null,
      resolution_guidance: {
        blockers: ["verdict"],
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict"
        }
      }
    });
    expect(ledgerTypes).not.toContain("verdict_recorded");
    expect(ledgerTypes).not.toContain("flow_completed");
  });

  it("keeps goal_verdict_required visible when validation has verdict and another blocker", async () => {
    const flow = await createOfficialValidationFlow("official-verdict-plus-clean-house");

    const gate = await engine.goalGateCheck({
      flow_id: flow.flow_id,
      phase: "validacao",
      provided: {
        verdict: "pronto_com_ressalvas",
        residual_risks: ["veredito canonico pendente"],
        next_step: "chamar goal_verdict antes de completar"
      }
    });
    const status = await engine.goalStatus({ flow_id: flow.flow_id });

    expect(gate).toMatchObject({
      status: "blocked",
      missing: expect.arrayContaining(["verdict", "clean_house"])
    });
    expect(status).toMatchObject({
      status: "blocked",
      phase: "validacao",
      blockers: expect.arrayContaining(["verdict", "clean_house"]),
      current_verdict: null,
      next_required_action: {
        type: "goal_verdict_required",
        tool: "goal_verdict",
        other_blockers: ["clean_house"]
      }
    });
  });

  it("preserves legacy manual flow compatibility without goal_binding", async () => {
    const flow = await createLegacyValidationFlow("legacy-manual-flow");

    const gate = await engine.checkGate({
      flow_id: flow.flow_id,
      phase: "validacao",
      provided: validationProvidedVerdict()
    });
    const advanced = await engine.advance({ flow_id: flow.flow_id });
    const status = await engine.status(flow.flow_id);
    const ledgerTypes = await ledgerEventTypes(flow.flow_id);

    expect(gate).toMatchObject({
      status: "passed",
      missing: [],
      next: "advance_to_complete"
    });
    expect(advanced).toMatchObject({
      advanced: true,
      from: "validacao",
      to: null,
      status: "complete"
    });
    expect(status).toMatchObject({
      status: "complete",
      phase: "validacao"
    });
    expect(ledgerTypes).toContain("flow_completed");
    expect(ledgerTypes).not.toContain("verdict_recorded");
  });
});

async function createOfficialValidationFlow(idempotencyKey: string): Promise<Flow> {
  const flow = await engine.createFlow({
    goal: `Official fiscal boundary ${idempotencyKey}`,
    context: "ctx",
    risks: ["baixo"],
    uncertainties: ["nenhuma"]
  });
  flow.goal_binding = {
    envelope: {
      workspace: path.join(tempRoot, idempotencyKey),
      spt_path: path.join(tempRoot, idempotencyKey, ".agents", "PLAN-TASKS", `${idempotencyKey}.md`),
      objective: flow.goal,
      idempotency_key: `dex-ppirtv:${idempotencyKey}`,
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "codex-test"
    },
    started_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  };
  flow.phase = "validacao";
  await engine.store.saveFlow(flow);
  return flow;
}

async function createOfficialFiscalFlow(idempotencyKey: string): Promise<Flow> {
  const flow = await createOfficialValidationFlow(idempotencyKey);
  flow.phase = "pensamentos";
  await engine.store.saveFlow(flow);
  return flow;
}

async function createLegacyValidationFlow(goal: string): Promise<Flow> {
  const flow = await engine.createFlow({
    goal,
    context: "ctx",
    risks: ["baixo"],
    uncertainties: ["nenhuma"]
  });
  flow.phase = "validacao";
  await engine.store.saveFlow(flow);
  return flow;
}

function validationProvidedVerdict(): Record<string, unknown> {
  return {
    verdict: "pronto_com_ressalvas",
    residual_risks: ["veredito canonico pendente"],
    next_step: "chamar goal_verdict antes de completar",
    clean_house: true
  };
}

async function ledgerEventTypes(flowId: string): Promise<string[]> {
  const ledger = await engine.store.readLedger(flowId);
  return ledger.map((event) => event.type);
}
