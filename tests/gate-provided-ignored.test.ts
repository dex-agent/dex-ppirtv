import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";

// ISSUE-LOCAL-0001 (2026-11-09): typo em provided (tests_executed plural) era
// engolido em silêncio — 1 turno queimado adivinhando. Este teste é o RED-first
// do corte diagnostico-que-ensina: o receipt do gate deve carregar
// provided_ignored nomeando as chaves ignoradas (ressalva, NUNCA bloqueio).
let tempRoot: string;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-provided-ignored-"));
  engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function fakeSpt(workspace: string, objective: string): string {
  return [
    "---", "dex_contract: spt", "version: 3", "status: EM_TESTE", "owner: Teste",
    "date: '2026-11-09'", "workspace: " + JSON.stringify(workspace),
    "origin: teste provided_ignored",
    "goal:", "  id: fake-goal-provided-ignored", "  title: Fake GOAL",
    "  objective: " + JSON.stringify(objective),
    "context: Fixture do aviso de chave ignorada.",
    "problem: Typo engolido.", "decision: Aviso no receipt.",
    "scope:", "  include:", "    - Gate.", "  exclude:", "    - Externo.",
    "requirements:", "  - id: REQ-01", "    statement: goal_start retorna flow_id.", "    criteria:",
    "      - id: C-01", "        statement: flow_id presente.",
    "plan: [Probe.]", "tasks:", "  - id: A-01", "    action: Chamar goal_start.",
    "    covers: [REQ-01]", "    done_when: [C-01]", "    depends_on: []",
    "    evidence_requirements:", "      - id: ER-01", "        proves: [C-01]", "        method: inspection",
    "        procedure: Observar flow_id.", "        expectation:", "          kind: boolean_assertion", "          expected: true",
    "closure_gates: [Nenhum.]",
    "risks:", "  - Risco de fixture.", "uncertainties:", "  - nenhuma.",
    "gates:", "  - preenchidos.", "validation:", "  - vitest local.",
    "execution_prompt: |", "  /GOAL", "---", "# t", ""
  ].join("\n");
}

async function flowAteRevisao(): Promise<string> {
  const objective = "Provar o aviso provided_ignored no receipt do gate";
  const workspace = path.join(tempRoot, "consumer");
  const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "ignored.md");
  await mkdir(path.dirname(sptPath), { recursive: true });
  await writeFile(sptPath, fakeSpt(workspace, objective), "utf8");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "app.ts"), "export const fixture = true;\n", "utf8");
  const started = (await engine.startGoal({
    workspace, spt_path: sptPath, objective,
    idempotency_key: "provided-ignored-261109",
    evidence_required: true, required_evidence: [],
    requested_verdict_policy: "evidence_required",
    source: "gate-provided-ignored.test", mode: "full",
  })) as { flow_id: string };
  await engine.updateFlowFacts(started.flow_id, { changed_files: ["src/app.ts"] });
  await engine.goalAdvance({ flow_id: started.flow_id, provided: {} });
  await engine.goalAdvance({ flow_id: started.flow_id, provided: {} });
  await engine.goalAdvance({
    flow_id: started.flow_id,
    provided: { implementation_done: true, changed_files: ["src/app.ts"] },
  });
  return started.flow_id;
}

describe("provided_ignored no receipt do gate (ISSUE-LOCAL-0001)", () => {
  it("typo plural em provided vira aviso nomeado no receipt e o gate NÃO é reprovado por ele", async () => {
    const flowId = await flowAteRevisao();
    const receipt = (await engine.goalGateCheck({
      flow_id: flowId,
      provided: { tests_executed: true },
      persist: false,
    })) as Record<string, unknown> & { provided_ignored?: string[]; status?: string; missing?: string[] };

    // C-01: a chave ignorada é NOMEADA (o silêncio é o bug).
    expect(receipt.provided_ignored).toEqual(["tests_executed"]);
    // C-01: o aviso é ressalva — não entra em missing nem reprova por conta própria.
    expect(receipt.missing ?? []).not.toContain("tests_executed");
  });

  it("chaves válidas da fase (incluindo changed_files lido à parte) nunca viram provided_ignored", async () => {
    const flowId = await flowAteRevisao();
    const receipt = (await engine.goalGateCheck({
      flow_id: flowId,
      provided: {
        memoria_viva_reconciled: true,
        residual_risks: ["r1"],
        next_step: "arquivar o flow",
        changed_files: ["src/app.ts"],
      },
      phase: "validacao",
      persist: false,
    })) as Record<string, unknown> & { provided_ignored?: string[] };

    // desenho: o campo só nasce quando há ignoradas — ausência = nada a avisar
    expect(receipt.provided_ignored ?? []).toEqual([]);
  });

  it("EMENDA D-34 P2: review_findings/review_artifact_path (lidas por needsReviewCoherence fora do mapa) NUNCA viram provided_ignored — avisá-las ensinaria a remover chave que altera o julgamento", async () => {
    const flowId = await flowAteRevisao();
    const receipt = (await engine.goalGateCheck({
      flow_id: flowId,
      provided: {
        diff_reviewed: true,
        barata_scan: true,
        regression_risks: ["r1"],
        review_findings: ["achado real de review"],
        tests_executed: true,
      },
      persist: false,
    })) as Record<string, unknown> & { provided_ignored?: string[] };

    expect(receipt.provided_ignored).toEqual(["tests_executed"]);
  });

  it("EMENDA D-34 P2 simetria: goal_gate_preflight na rota read-only também nomeia o typo — invariante D-31 vale para a família inteira", async () => {
    const flowId = await flowAteRevisao();
    const preflight = (await engine.goalGatePreflight({
      flow_id: flowId,
      provided: { tests_executed: true },
    })) as Record<string, unknown> & { provided_ignored?: string[] };

    expect(preflight.provided_ignored).toEqual(["tests_executed"]);
  });

  it("EMENDA D-34 P3 amarração: PROVIDED_PATH_KEYS casa com as chaves de path saneadas pelo sanitizePersistedProvided (duas enumerações do mesmo contrato não divergem em silêncio)", async () => {
    const { PROVIDED_PATH_KEYS } = await import("../src/gate-resolution.js");
    const { sanitizePersistedProvided } = await import("../src/input-unwrap.js");
    const saneado = sanitizePersistedProvided({ changed_files: ["a"], deleted_files: ["b"] });
    for (const key of saneado ? Object.keys(saneado) : []) {
      expect(PROVIDED_PATH_KEYS.has(key), `chave de path saneada "${key}" deve ser aceita pelo aviso`).toBe(true);
    }
    expect([...PROVIDED_PATH_KEYS].every((key) => key === "changed_files" || key === "deleted_files")).toBe(true);
  });
});
