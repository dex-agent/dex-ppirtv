// Trilho 2026-11-05-verdict-learning-filtro-findings (A-01, RED-first).
// Issue #5 lapidação 2: deriveVerdictLearning (flow-engine) promove
// review_findings CEGAMENTE a gold_mining ("Achado de review: ..."), enquanto
// o rationale já é selecionado por isStrongLearningText — o flow 2950 do
// Trilho A gerou 2 candidatos de confiança baixa ao vivo (a prova do sintoma).
// Comportamentos contratados:
// - C-01: finding COM texto forte (mesmo vocabulário do filtro do rationale)
//   vira candidato "Achado de review: ...".
// - C-02: finding SEM texto forte NÃO vira candidato (fica evidência do
//   verdict persistido em review_findings, não mineração).
// Harness: padrão tests/fiscal-recurrence.test.ts (workspace inexistente =
// corroboração fail-aberta com limitação; sem git no fixture).
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let engine: FlowEngine;
let flowId: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-verdict-learning-"));
  engine = new FlowEngine(new PpirtvStore(tempRoot));
  const flow = await engine.createFlow({ goal: "Corte filtro findings", risks: ["baixo"], uncertainties: ["nenhuma"] });
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
  flowId = flow.flow_id;
  const evidence = await engine.addGoalEvidence({ flow_id: flowId, title: "Prova sintetica", content: "Assert executado." });
  lastEvidenceId = evidence.evidence_id as string;
});

let lastEvidenceId = "";

afterEach(async () => { await rm(tempRoot, { recursive: true, force: true }); });

describe("verdict learning: promocao de review_findings com filtro (issue #5.2)", () => {
  it("C-01/C-02: finding forte vira candidato; fraco fica evidencia", async () => {
    const forte = "P1 falso verde no contrato do gate fiscal";
    const fraco = "barata early-return por contagem (2===2 escondia troca)";
    await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "Corte confirmado.",
      evidence_ids: [lastEvidenceId],
      review_findings: [forte, fraco],
      residual_risks: [],
      next_step: "Quando este corte terminar, encerrar."
    });
    const reloaded = await engine.store.loadFlow(flowId);
    const verdict = reloaded.verdicts.at(-1)!;
    expect(verdict.gold_mining).toContain(`Achado de review: ${forte}`);
    expect(verdict.gold_mining).not.toContain(`Achado de review: ${fraco}`);
    // O finding fraco permanece evidência do verdict (não some do histórico).
    expect(verdict.review_findings).toContain(fraco);
  });
});
