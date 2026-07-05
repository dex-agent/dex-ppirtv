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
  it("routes review_required directly instead of opening a meeting when no meeting trigger exists", async () => {
    const flow = await createOfficialFiscalFlow("official-review-without-meeting-ritual");
    await engine.updateFlowFacts(flow.flow_id, { changed_files: ["src/flow-engine.ts"] });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com mudanca de codigo ainda sem artefato de revisao."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Mudanca de codigo precisa de review.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["review ainda nao anexado"],
        next_step: "anexar review antes de novo veredito"
      })
    ).rejects.toThrow(/review_required/i);

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.blockers).toContain("review_required");
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.meeting_required).toBe(false);
    expect(status.next_required_action).toMatchObject({
      type: "attach_review",
      tool: "evidence_add"
    });
  });

  it("keeps required_cooperation when the risk explicitly says meeting is missing", async () => {
    const flow = await createOfficialFiscalFlow("official-meeting-trigger-explicit");
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com ausencia explicita de reuniao material."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Ressalva confessa ausencia da mesa.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reuniao material para decidir a ressalva"],
        next_step: "abrir reuniao material agora"
      })
    ).rejects.toThrow(/required_cooperation/i);

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.blockers).toContain("required_cooperation");
    expect(status.meeting_required).toBe(true);
    expect(status.next_required_action).toMatchObject({
      type: "open_meeting",
      tool: "goal_meeting_open"
    });
  });

  it("keeps required_cooperation when the risk says sem reunião with accent", async () => {
    const flow = await createOfficialFiscalFlow("official-meeting-trigger-accented");
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com ausencia explicita de reuniao material acentuada."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Ressalva confessa ausência da mesa.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reunião material para decidir a ressalva"],
        next_step: "abrir reuniao material agora"
      })
    ).rejects.toThrow(/required_cooperation/i);

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.blockers).toContain("required_cooperation");
    expect(status.meeting_required).toBe(true);
  });

  it("does not treat sem reunir evidencias as a missing-meeting trigger", async () => {
    const flow = await createOfficialFiscalFlow("official-sem-reunir-no-meeting");
    await engine.updateFlowFacts(flow.flow_id, { changed_files: ["src/flow-engine.ts"] });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com mudanca de codigo ainda sem artefato de revisao."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Mudanca de codigo precisa de review.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reunir evidencias suficientes no pacote"],
        next_step: "anexar review antes de novo veredito"
      })
    ).rejects.toThrow(/review_required/i);

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.blockers).toContain("review_required");
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.meeting_required).toBe(false);
  });

  it("drops persisted explicit meeting trigger after facts remove the meeting reason", async () => {
    const flow = await createOfficialFiscalFlow("official-clear-stale-meeting-trigger");
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com gatilho antigo de reuniao removido por fatos novos."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Ressalva antiga dizia sem reuniao material.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reuniao material para decidir a ressalva"],
        next_step: "abrir reuniao material agora"
      })
    ).rejects.toThrow(/required_cooperation/i);

    await engine.updateFlowFacts(flow.flow_id, {
      risks: ["mudanca de codigo precisa apenas de review"],
      changed_files: ["src/flow-engine.ts"]
    });

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.blockers).toContain("review_required");
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.meeting_required).toBe(false);
  });

  it("keeps persisted verdict meeting trigger after additive facts update", async () => {
    const flow = await createOfficialFiscalFlow("official-additive-facts-keep-meeting-trigger");
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com gatilho fiscal preservado por update aditivo."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Ressalva ainda depende de mesa material.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reuniao material para decidir a ressalva"],
        next_step: "abrir reuniao material agora"
      })
    ).rejects.toThrow(/required_cooperation/i);

    await engine.updateFlowFacts(flow.flow_id, {
      changed_files: ["src/flow-engine.ts"]
    });

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.blockers).toContain("required_cooperation");
    expect(status.meeting_required).toBe(true);
  });

  it("does not treat negative meeting_id or required_cooperation text as a meeting trigger", async () => {
    const flow = await createOfficialFiscalFlow("official-negative-meeting-trigger-text");
    await engine.updateFlowFacts(flow.flow_id, { changed_files: ["src/flow-engine.ts"] });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com texto negativo sobre reuniao."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "required_cooperation nao se aplica neste corte.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["meeting_id opcional porque nao ha required_cooperation"],
        next_step: "anexar review antes de novo veredito"
      })
    ).rejects.toThrow(/review_required/i);

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.blockers).toContain("review_required");
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.meeting_required).toBe(false);
  });

  it("does not let unrelated negative text suppress a later explicit meeting trigger", async () => {
    const flow = await createOfficialFiscalFlow("official-mixed-negative-positive-meeting-trigger");
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com texto negativo e gatilho positivo no mesmo veredito."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "required_cooperation nao se aplica ao pacote antigo.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reuniao material para decidir o risco atual"],
        next_step: "abrir reuniao material agora"
      })
    ).rejects.toThrow(/required_cooperation/i);

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.blockers).toContain("required_cooperation");
    expect(status.meeting_required).toBe(true);
  });

  it("does not keep legacy required_cooperation alive because of an unrelated open meeting", async () => {
    const flow = await createOfficialFiscalFlow("official-unrelated-open-meeting-no-fiscal-signal");
    flow.history.push({
      at: new Date().toISOString(),
      type: "fiscal_policy_blocked",
      data: {
        source: "legacy_without_diagnostics",
        blocking_reasons: ["required_cooperation"],
        required_cooperation: [{ name: "reuniao", reason: "legacy fiscal", material: true }]
      }
    });
    await engine.store.saveFlow(flow);
    await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Reuniao de triagem sem vinculo com required_cooperation fiscal"
    });

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.meeting_required).toBe(false);
  });

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

  it("does not point required_cooperation to an open meeting from before the fiscal block", async () => {
    const flow = await createOfficialFiscalFlow("official-preexisting-open-meeting");
    const opened = await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Triagem aberta antes de qualquer bloqueio fiscal"
    });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com reuniao preexistente sem vinculo material."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Risco material novo apareceu no veredito.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reuniao material para o risco novo"],
        next_step: "abrir reuniao material agora"
      })
    ).rejects.toThrow(/required_cooperation/i);

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    expect(status.next_required_action).toMatchObject({
      type: "open_meeting",
      tool: "goal_meeting_open"
    });
    expect(status.next_required_action).not.toMatchObject({
      type: "close_existing_meeting",
      meeting_id: opened.meeting_id
    });
    expect(status.blocker_diagnostics).toMatchObject({
      required_cooperation: {
        open_meeting_ids: []
      }
    });
  });

  it("does not keep required_cooperation alive from an unrelated open meeting after trigger cleanup", async () => {
    const flow = await createOfficialFiscalFlow("official-unrelated-open-after-trigger-cleanup");
    const opened = await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Triagem operacional aberta antes do risco fiscal"
    });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com gatilho fiscal removido por fatos novos."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Risco material declarado no primeiro veredito.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reuniao material para o risco inicial"],
        next_step: "abrir reuniao material agora"
      })
    ).rejects.toThrow(/required_cooperation/i);

    await engine.updateFlowFacts(flow.flow_id, {
      risks: ["mudanca de codigo precisa apenas de review"],
      changed_files: ["src/flow-engine.ts"]
    });
    const status = await engine.goalStatus({ flow_id: flow.flow_id });

    expect(status.blockers).toContain("review_required");
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.meeting_required).toBe(false);
    expect(status.blocker_diagnostics).not.toMatchObject({
      required_cooperation: {
        open_meeting_ids: expect.arrayContaining([opened.meeting_id])
      }
    });
  });

  it("does not keep required_cooperation alive from an unrelated insufficient meeting", async () => {
    const flow = await createOfficialFiscalFlow("official-unrelated-insufficient-meeting");
    const opened = await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Triagem sem vinculo com required_cooperation",
      participants_required: ["chato", "questionador"]
    });
    await engine.goalMeetingClose({
      flow_id: flow.flow_id,
      meeting_id: opened.meeting_id as string,
      participants_present: ["chato"],
      decision: "Triagem operacional ficou incompleta."
    });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste com reuniao insuficiente alheia."
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Risco material declarado no primeiro veredito.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reuniao material para o risco inicial"],
        next_step: "abrir reuniao material agora"
      })
    ).rejects.toThrow(/required_cooperation/i);

    await engine.updateFlowFacts(flow.flow_id, {
      risks: ["mudanca de codigo precisa apenas de review"],
      changed_files: ["src/flow-engine.ts"]
    });
    const status = await engine.goalStatus({ flow_id: flow.flow_id });

    expect(status.blockers).toContain("review_required");
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.blocker_diagnostics).not.toMatchObject({
      required_cooperation: {
        insufficient_meeting_ids: expect.arrayContaining([opened.meeting_id])
      }
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
    expect(status.blockers).toContain("required_cooperation");
    expect(status.required_cooperation).not.toEqual([]);
    expect(status.meeting_required).toBe(true);
    const checkin = status.ppirtv_checkin as Record<string, unknown>;
    const coo = (checkin.components as Array<Record<string, unknown>>).find((component) => component.name === "coo");
    expect(coo).not.toMatchObject({
      status: "needs_visibility",
      auto_repair: "required_cooperation_generated"
    });
  });

  it("rejects a silent positive verdict without meeting_id when an eligible meeting exists", async () => {
    const flow = await createOfficialFiscalFlow("official-silent-missing-meeting-id");
    const opened = await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Fechar cooperacao fiscal completa"
    });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste de omissao silenciosa de meeting_id."
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
        rationale: "Evidencias e decisao material revisadas.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["risco residual baixo"],
        next_step: "arquivar apos validacao agora"
      })
    ).rejects.toThrow(/required_cooperation/i);

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    const lean = await engine.goalStatus({ flow_id: flow.flow_id, detail: "lean" });
    expect(status.next_required_action).toMatchObject({
      type: "provide_meeting_id_for_verdict",
      tool: "goal_verdict",
      eligible_meeting_ids: [opened.meeting_id]
    });
    expect(lean.blockers).toContain("required_cooperation");
    expect(lean.next_required_action).toMatchObject({
      type: "provide_meeting_id_for_verdict",
      tool: "goal_verdict"
    });
  });

  it("does not require meeting_id for an eligible meeting already consumed by a previous verdict", async () => {
    const flow = await createOfficialFiscalFlow("official-consumed-eligible-meeting");
    const opened = await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Fechar cooperacao fiscal completa"
    });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste de reuniao elegivel consumida por veredito."
    });

    await engine.goalMeetingClose({
      flow_id: flow.flow_id,
      meeting_id: opened.meeting_id as string,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
      decision: "Reuniao material fechada; required_cooperation satisfeito.",
      satisfies_blockers: ["required_cooperation"]
    });
    await engine.goalVerdict({
      flow_id: flow.flow_id,
      status: "pronto_com_ressalvas",
      rationale: "Veredito vinculado ao encontro fechado.",
      evidence_ids: [evidence.evidence_id],
      residual_risks: ["risco residual baixo"],
      meeting_id: opened.meeting_id as string,
      next_step: "registrar segundo veredito agora sem novo gatilho material"
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Segundo veredito sem novo risco material.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["risco residual baixo"],
        next_step: "arquivar apos validacao agora"
      })
    ).resolves.toMatchObject({
      verdict: {
        status: "pronto_com_ressalvas"
      }
    });
  });

  it("does not let an old eligible meeting satisfy a newer explicit meeting trigger", async () => {
    const flow = await createOfficialFiscalFlow("official-old-meeting-new-trigger");
    const opened = await engine.goalMeetingOpen({
      flow_id: flow.flow_id,
      kind: "convergente",
      question: "Fechar cooperacao fiscal antiga"
    });
    const evidence = await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      title: "Evidencia fiscal",
      content: "Teste de nova ressalva material apos reuniao antiga."
    });

    await engine.goalMeetingClose({
      flow_id: flow.flow_id,
      meeting_id: opened.meeting_id as string,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
      decision: "Reuniao antiga fechada para risco anterior.",
      satisfies_blockers: ["required_cooperation"]
    });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        rationale: "Novo risco material surgiu depois da reuniao antiga.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem reuniao material para o risco novo"],
        meeting_id: opened.meeting_id as string,
        next_step: "abrir reuniao material para o risco novo agora"
      })
    ).rejects.toThrow(/required_cooperation/i);
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
