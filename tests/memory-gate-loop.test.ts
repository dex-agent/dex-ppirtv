import { describe, expect, it, vi } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import type { DexMemoriaV2Executor, DexMemoriaV2FlowWriterConfig } from "../src/memory/dex-memoria-v2-adapter.js";
import { addDeclarativeEvidence, declarativeDefaults } from "../src/spt-declarative-proof.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// SPT memory-gate-loop-solubility (T-1/T-2): caracterizacao do loop insolvel
// do memory gate decifrado pelo oraculo (2026-10-17) — gate decide frescor por
// POSICAO (lastIndexOf) mas a mineracao V2 deduplica por RESULTADO
// (reconciliation id) e muta o evento antigo in-place. T-1 documenta o
// comportamento de HOJE; T-2 e o RED do contrato da decisao A (history
// append-only + idempotencia so no ledger + reset do loop por id distinto).

let tempRoot = "";

function fakeSpt(workspace: string, objective: string): string {
  return [
    "---", "dex_contract: spt", "version: 3", "status: EM_TESTE", "owner: Teste",
    "date: '2026-10-18'", `workspace: ${JSON.stringify(workspace)}`, "origin: teste mgl",
    "goal:", "  id: fake-goal-mgl", "  title: Fake GOAL MGL",
    `  objective: ${JSON.stringify(objective)}`,
    "context: Fixture sintetica do memory gate loop.",
    "problem: Duas nocoes de ordem no mesmo log.",
    "decision: Caracterizar antes de corrigir.",
    "scope:", "  include:", "    - Validar mining local.", "  exclude:", "    - Externo.",
    "requirements:",
    "  - id: REQ-01", "    statement: O flow deve iniciar para o probe de mining.",
    "    criteria:",
    "      - id: C-01", "        statement: goal_start retorna flow_id.",
    "plan: [Probe de mining.]", "tasks:",
    "  - id: A-01", "    action: Chamar goal_start e minerar memoria.", "    covers: [REQ-01]",
    "    done_when: [C-01]", "    depends_on: []",
    "    evidence_requirements:",
    "      - id: ER-01", "        proves: [C-01]", "        method: test",
    "        procedure: Observar flow_id.",
    "        expectation:", "          kind: boolean_assertion", "          expected: true",
    "closure_gates: [Nenhum para o probe.]", "risks:", "  - Falso pronto.",
    "uncertainties:", "  - nenhuma.", "gates:", "  - preenchidos.",
    "validation:", "  - vitest local.", "execution_prompt: |", "  /GOAL", "---", "# t", ""
  ].join("\n");
}

function configuredWriter(): DexMemoriaV2FlowWriterConfig {
  return {
    profile: "v2",
    executor: vi.fn() as unknown as DexMemoriaV2Executor,
    memory_home: path.join(tempRoot, "memory-home"),
    workspace_root: path.join(tempRoot, "workspace"),
  };
}

async function fixtureGoal(objective: string) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "mgl-loop-"));
  const engine = new FlowEngine(
    new PpirtvStore(path.join(tempRoot, "workspace", ".ppirtv")),
    undefined,
    { memory_writer: configuredWriter() }
  );
  const workspace = path.join(tempRoot, "workspace");
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-10-18-fake-goal-mgl.md");
  await writeFile(sptPath, fakeSpt(workspace, objective), "utf8");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  const started = (await engine.startGoal({
    workspace, spt_path: sptPath, objective,
    idempotency_key: `mgl-${Math.random().toString(36).slice(2, 8)}`,
    evidence_required: true, required_evidence: ["npm run check"],
    requested_verdict_policy: "evidence_required", source: "dex-code"
  } as never)) as Record<string, unknown>;
  return { engine, tempRoot, workspace, flowId: String(started.flow_id) };
}

type Fixture = Awaited<ReturnType<typeof fixtureGoal>>;

async function miningEvents(f: Fixture) {
  const flow = await f.engine.store.loadFlow(f.flowId);
  return flow.history
    .map((event, index) => ({ index, event }))
    .filter(({ event }) => event.type === "memory_mined")
    .map(({ event }) => event);
}

async function mine(f: Fixture) {
  return (await f.engine.mineMemory({
    flow_id: f.flowId,
    write_policy: "classify_only",
    v2_destinations: [{ scope: "project" }],
    v2_density: "light"
  } as never)) as Record<string, unknown>;
}

describe("T-1 caracterizacao: duas nocoes de ordem no mesmo log (passa hoje)", () => {
  it("(a) [pos-fix, decisao A] re-mining identico registra um evento por tentativa (contagem honesta) e o ledger segue idempotente por reconciliation id", async () => {
    const f = await fixtureGoal("Garimpo de memoria para caracterizar o dedup por resultado");
    try {
      const first = await mine(f);
      const second = await mine(f);
      const events = await miningEvents(f);
      // Append-only: 2 tentativas = 2 eventos (contagem honesta); antes do fix
      // o evento era mutado in-place (1 evento) e o gate ordinal nunca via
      // mining posterior ao veredito — o loop insolvel.
      expect(events).toHaveLength(2);
      expect(second.v2_reconciliation_id).toBe(first.v2_reconciliation_id);
      expect(String(events[0].data.v2_reconciliation_id)).toBe(String(second.v2_reconciliation_id));
      // A idempotencia por resultado vive SOMENTE no ledger: 1 linha por id.
      const ledger = await f.engine.store.readLedger(f.flowId);
      const ledgerLines = ledger.filter(
        (event: Record<string, unknown>) =>
          event.type === "memory_mined"
          && String((event.data as Record<string, unknown>).v2_reconciliation_id) === String(second.v2_reconciliation_id)
      );
      expect(ledgerLines).toHaveLength(1);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });

  it("(b) mineracao com estado mudado cria evento NOVO com reconciliation id distinto (o que destravou o flow_20261017164713291)", async () => {
    const f = await fixtureGoal("Garimpo de memoria com estado que muda entre mineracoes");
    try {
      const first = await mine(f);
      const meeting = await f.engine.goalMeetingOpen({
        flow_id: f.flowId, type: "divergent", question: "Qual aprendizado nao pode se perder?"
      } as never);
      await f.engine.goalMeetingClose({
        flow_id: f.flowId, meeting_id: (meeting as Record<string, unknown>).meeting_id,
        participants_present: ["chato"],
        decision: "Achado novo muda o resultado da mineracao.",
        parking_lot: []
      } as never);
      const second = await mine(f);
      const events = await miningEvents(f);
      expect(events).toHaveLength(2);
      expect(second.v2_reconciliation_id).not.toBe(first.v2_reconciliation_id);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });

  it("(c) re-mining duplicado NAO reseta a janela do loop monitor (invariante: id identico nao e progresso) e mining com estado mudado reseta", async () => {
    const f = await fixtureGoal("Garimpo de memoria com fiscal de review bloqueando o loop");
    try {
      await f.engine.goalAdvance({ flow_id: f.flowId } as never);
      await f.engine.goalAdvance({
        flow_id: f.flowId, provided: { implementation_done: true, changed_files: ["src/a.ts"] }
      } as never);
      // revisao sem evidencia estrutural de review -> fiscal_policy_blocked (review_required)
      const provided = { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["sem review estrutural"] };
      await f.engine.goalAdvance({ flow_id: f.flowId, provided } as never);
      await mine(f); // mining #1: reseta a janela (progresso legitimo)
      await f.engine.goalAdvance({ flow_id: f.flowId, provided } as never);
      const duplicate = await mine(f); // identico: HOJE nao cria evento (dedup in-place), logo nao reseta
      await f.engine.goalAdvance({ flow_id: f.flowId, provided } as never);
      let status = (await f.engine.goalStatus({ flow_id: f.flowId })) as Record<string, any>;
      expect(duplicate.v2_reconciliation_id).toBeDefined();
      // Invariante (decisao A): duplicado nunca reseta a janela — hoje por
      // ausencia de evento; pos-fix append-only precisa do guard por id
      // distinto para manter este mesmo valor.
      expect(status.loop_monitor.count).toBe(2);
      // mining com estado mudado (id distinto) reseta a janela: progresso real
      const meeting = await f.engine.goalMeetingOpen({
        flow_id: f.flowId, type: "divergent", question: "Qual aprendizado muda o resultado?"
      } as never);
      await f.engine.goalMeetingClose({
        flow_id: f.flowId, meeting_id: (meeting as Record<string, unknown>).meeting_id,
        participants_present: ["chato"], decision: "Estado mudou o id.", parking_lot: []
      } as never);
      await mine(f);
      await f.engine.goalAdvance({ flow_id: f.flowId, provided } as never);
      status = (await f.engine.goalStatus({ flow_id: f.flowId })) as Record<string, any>;
      expect(status.loop_monitor.count).toBe(1);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("T-2 RED (decisao A): loop insolvel deixa de existir", () => {
  it("re-mining identico apos veredito positivo registra evento novo e o advance terminal avanca", async () => {
    const f = await fixtureGoal("Garimpo de memoria para matar o loop insolvel do gate ordinal");
    try {
      await f.engine.goalAdvance({ flow_id: f.flowId } as never);
      await f.engine.goalAdvance({
        flow_id: f.flowId, provided: { implementation_done: true, changed_files: ["src/a.ts"] }
      } as never);
      // evidencia p/ gate de evidence (F6) + review estrutural p/ fiscal
      await f.engine.addGoalEvidence({
        flow_id: f.flowId, title: "npm run check", content: "pass", satisfies: ["npm run check"]
      } as never);
      const flowBefore = await f.engine.store.loadFlow(f.flowId);
      const fingerprint = flowBefore.implementation_fingerprint;
      await f.engine.addGoalEvidence({
        flow_id: f.flowId, kind: "code_review",
        title: "Review estrutural MGL",
        content: "diff revisado",
        scope_classification: "target", scope_reference: "src/a.ts",
        reviewed_implementation_fingerprint: fingerprint,
        satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
        observed_result: {
          diff_reviewed: true, barata_scan: true, reviewed_targets: ["src/a.ts"],
          searched_patterns: ["rg memory"], findings: [], regression_risks: ["baixo"]
        }
      } as never);
      await f.engine.goalAdvance({
        flow_id: f.flowId,
        provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] }
      } as never); // -> validacao
      // SPT v3: veredito positivo exige criterion proof (C-01) — rota
      // declarativa real (mesma injecao do servidor: engine como lookup+sink).
      await addDeclarativeEvidence(f.engine, f.engine, {
        flow_id: f.flowId, title: "ER-1 — declarative",
        declarative_proof: { task_id: "A-01", evidence_requirement_id: "ER-01", observed_value: true, paths: ["src/a.ts"] }
      }, declarativeDefaults());
      await mine(f); // mining #1 pre-veredito
      const evidence = await f.engine.store.loadFlow(f.flowId);
      const evidenceIds = evidence.evidence.map((item) => item.evidence_id);
      await f.engine.goalVerdict({
        flow_id: f.flowId, status: "pronto_com_ressalvas",
        rationale: "loop insolvel fechado por construcao",
        evidence_ids: evidenceIds, residual_risks: [], next_step: "arquivar"
      } as never);
      await mine(f); // mining #2 IDENTICO — hoje: dedup in-place, nenhum evento pos-veredito
      const events = await miningEvents(f);
      const flow = await f.engine.store.loadFlow(f.flowId);
      const types = flow.history.map((event) => event.type);
      const verdictAt = types.lastIndexOf("verdict_recorded");
      const miningAfter = types.findIndex((type, index) => type === "memory_mined" && index > verdictAt);
      expect(events.length).toBeGreaterThanOrEqual(2); // contagem honesta de tentativas
      expect(miningAfter).toBeGreaterThan(-1); // ordem unica: evento pos-verdict existe
      const advance = (await f.engine.goalAdvance({
        flow_id: f.flowId,
        provided: { residual_risks: ["nenhum"], next_step: "arquivar", memoria_viva_reconciled: true }
      } as never)) as Record<string, unknown>;
      expect(advance.advanced).toBe(true); // RED hoje: blocked para sempre
      expect(advance.status).toBe("complete");
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });
});
