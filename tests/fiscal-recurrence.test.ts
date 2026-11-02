import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { fiscalBlockedAction } from "../src/error-envelope.js";

let tempRoot: string;
let engine: FlowEngine;
let proposal: Parameters<FlowEngine["goalVerdict"]>[0];

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-recurrence-"));
  engine = new FlowEngine(new PpirtvStore(tempRoot));
  const flow = await engine.createFlow({ goal: "Aceite sintetico", risks: ["baixo"], uncertainties: ["nenhuma"] });
  flow.goal_binding = {
    envelope: {
      workspace: path.join(tempRoot, "fixture"),
      spt_path: path.join(tempRoot, "fixture", "trilho.md"),
      objective: flow.goal,
      idempotency_key: flow.flow_id,
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "synthetic-test"
    },
    started_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  };
  await engine.store.saveFlow(flow);
  const evidence = await engine.addGoalEvidence({ flow_id: flow.flow_id, title: "Prova sintetica", content: "Assert executado." });
  proposal = {
    flow_id: flow.flow_id,
    status: "pronto_com_ressalvas",
    rationale: "Aceite confirmado.",
    evidence_ids: [evidence.evidence_id],
    residual_risks: [],
    next_step: "Quando este aceite terminar, encerrar este corte."
  };
});

afterEach(async () => { await rm(tempRoot, { recursive: true, force: true }); });

describe("recorrencia fiscal por fatos", () => {
  it.each([
    "Regressao 51/51 verde.",
    "Regressão: suíte de regressão verde.",
    "Nao ha erro recorrente.",
    'O manual cita "falhas recorrentes" como exemplo.',
    "Tentativas de conexao documentadas.",
    "Regression suite passed; no recurring failure.",
    "Riscos recorrentes foram eliminados."
  ])("texto livre nao declara recorrencia: %s", async (text) => {
    const result = await engine.goalVerdict({ ...proposal, rationale: text, next_step: `${text} Quando terminar, encerrar.`, residual_risks: [text] });
    expect(result.verdict).toMatchObject({ status: "pronto_com_ressalvas" });
    expect((await engine.goalStatus({ flow_id: proposal.flow_id })).blockers).not.toContain("attempt_regress_count");
  });

  it("true pendente sobrevive reload e omissao; false explicito encerra somente o relato", async () => {
    await expect(engine.goalVerdict({ ...proposal, recurring_risk: true })).rejects.toThrow(/attempts_insufficient/);
    engine = new FlowEngine(new PpirtvStore(tempRoot));
    expect((await engine.goalStatus({ flow_id: proposal.flow_id })).blockers).toContain("attempt_regress_count");
    await expect(engine.goalVerdict(proposal)).rejects.toThrow(/attempts_insufficient/);
    await engine.goalVerdict({ ...proposal, recurring_risk: false });
    expect((await engine.goalStatus({ flow_id: proposal.flow_id })).blockers).not.toContain("attempt_regress_count");
    const flow = await engine.store.loadFlow(proposal.flow_id);
    expect(flow.history.filter((event) => event.type === "recurring_risk_reported").map((event) => event.data.recurring_risk)).toEqual([true, false]);
    const ledger = await engine.store.readLedger(proposal.flow_id);
    expect(ledger.filter((event) => event.type === "recurring_risk_reported").map((event) => event.data.recurring_risk)).toEqual([true, false]);
  });

  it("verdict registrado encerra o relato atendido sem ressuscitar true antigo", async () => {
    await engine.goalVerdict({ ...proposal, recurring_risk: true, attempt_count: 2 });
    await engine.goalVerdict(proposal);
    expect((await engine.goalStatus({ flow_id: proposal.flow_id })).blockers).not.toContain("attempt_regress_count");
  });

  it("false e contador menor nao apagam teto persistido, mesmo com texto neutro", async () => {
    await expect(engine.goalVerdict({ ...proposal, regress_count: 3 })).rejects.toThrow(/attempt_regress_limit_reached/);
    engine = new FlowEngine(new PpirtvStore(tempRoot));
    await expect(engine.goalVerdict({ ...proposal, recurring_risk: false, regress_count: 0 })).rejects.toThrow(/attempt_regress_limit_reached/);
    expect(await engine.goalStatus({ flow_id: proposal.flow_id })).toMatchObject({ regress_count: 3, locked_by_limit: true });
  });

  it.each([true, false])("fast-track mechanical nao ignora fatos fiscais: recorrencia=%s", async (declaredRisk) => {
    const flow = await engine.store.loadFlow(proposal.flow_id);
    flow.goal_binding!.envelope.risk_level = "mechanical";
    await engine.store.saveFlow(flow);
    await expect(engine.goalVerdict({ ...proposal, recurring_risk: declaredRisk, regress_count: declaredRisk ? 0 : 3 }))
      .rejects.toThrow(declaredRisk ? /attempts_insufficient/ : /attempt_regress_limit_reached/);
  });

  it.each([NaN, -1, 0.5, "3", null])("contador invalido %j nao grava sinal booleano", async (value) => {
    const before = await engine.store.loadFlow(proposal.flow_id);
    await expect(engine.goalVerdict({ ...proposal, recurring_risk: true, regress_count: value } as unknown as typeof proposal)).rejects.toThrow(/regress_count.*integer/);
    expect((await engine.store.loadFlow(proposal.flow_id)).history).toEqual(before.history);
  });

  it.each(["true", "false", 1, 0, null, {}, []])("sinal invalido %j nao persiste parte de um relato conjunto", async (value) => {
    const before = await engine.store.loadFlow(proposal.flow_id);
    const ledger = await engine.store.readLedger(proposal.flow_id);
    await expect(engine.goalVerdict({ ...proposal, recurring_risk: value, regress_count: 3 } as unknown as typeof proposal)).rejects.toThrow(/recurring_risk.*boolean/i);
    expect((await engine.store.loadFlow(proposal.flow_id)).history).toEqual(before.history);
    expect(await engine.store.readLedger(proposal.flow_id)).toEqual(ledger);
  });
});

describe("veredito nao-positivo nao desarma recorrencia (revisao dupla 2026-11-02)", () => {
  it("nao_pronto gravado com true declarado NAO encerra relato: positivo seguinte exige tentativas", async () => {
    await engine.goalVerdict({ ...proposal, status: "nao_pronto", recurring_risk: true, next_step: "Retomar quando o fix pousar." });
    await expect(engine.goalVerdict(proposal)).rejects.toThrow(/attempts_insufficient/);
  });

  it("veredito rejeitado com false NAO persiste sinal nem apaga pending true", async () => {
    await expect(engine.goalVerdict({ ...proposal, recurring_risk: true })).rejects.toThrow(/attempts_insufficient/);
    await expect(engine.goalVerdict({ ...proposal, recurring_risk: false, evidence_ids: ["ev_inexistente"] })).rejects.toThrow(/Unknown evidence_ids/);
    const flow = await engine.store.loadFlow(proposal.flow_id);
    expect(flow.history.filter((event) => event.type === "recurring_risk_reported").map((event) => event.data.recurring_risk)).toEqual([true]);
    await expect(engine.goalVerdict(proposal)).rejects.toThrow(/attempts_insufficient/);
  });

  it("envelope do teto prescreve encerramento com ressalva, nunca repetir veredito", () => {
    const action = fiscalBlockedAction("PPIRTV_FISCAL_BLOCKED: attempt_regress_count, attempt_regress_limit_reached; regress_count=3 max=3; attempt_count=1");
    expect(JSON.stringify(action)).not.toMatch(/repita o veredito/i);
    expect(action.tool).not.toBe("goal_verdict");
    expect(JSON.stringify(action)).toMatch(/ressalva|encerr/i);
  });

  it("retry com mesmo valor efetivo nao duplica recurring_risk_reported", async () => {
    await expect(engine.goalVerdict({ ...proposal, recurring_risk: true })).rejects.toThrow(/attempts_insufficient/);
    await expect(engine.goalVerdict({ ...proposal, recurring_risk: true })).rejects.toThrow(/attempts_insufficient/);
    const flow = await engine.store.loadFlow(proposal.flow_id);
    expect(flow.history.filter((event) => event.type === "recurring_risk_reported")).toHaveLength(1);
  });

  it("next_required_action do teto e terminal: close_flow_with_reservation via flow_archive, sem reuniao nem retry", async () => {
    await expect(engine.goalVerdict({ ...proposal, regress_count: 3 })).rejects.toThrow(/attempt_regress_limit_reached/);
    const status = (await engine.goalStatus({ flow_id: proposal.flow_id })) as Record<string, unknown>;
    const action = status.next_required_action as Record<string, unknown>;
    expect(action).toMatchObject({ type: "close_flow_with_reservation", tool: "flow_archive", can_retry_verdict: false });
    expect(JSON.stringify(action.required_tool_sequence)).not.toMatch(/goal_meeting_open/);
  });
});
