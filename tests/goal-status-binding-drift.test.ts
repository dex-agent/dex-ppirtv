import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";

// Issue #19: goal_status expõe a divergência de fingerprint do contrato SPT
// (binding drift) que hoje só o ppirtv_trace mostra — bloqueio de fase e
// integridade do binding são condições diferentes.

let tempRoot: string;
let workspace: string;
let store: PpirtvStore;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-status-drift-"));
  workspace = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspace, ".agents", "PLAN-TASKS"), { recursive: true });
  store = new PpirtvStore(path.join(workspace, ".ppirtv"));
  engine = new FlowEngine(store);
  await store.init();
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function writeSpt(goalId: string, objective: string): Promise<string> {
  const document = [
    "---", "dex_contract: spt", "version: 3", "status: EM_TESTE", "owner: Teste",
    "date: '2026-11-13'", "workspace: " + JSON.stringify(workspace), "origin: teste issue 19",
    "goal:", "  id: " + goalId, "  title: Fake GOAL Drift",
    "  objective: " + JSON.stringify(objective),
    "context: Fixture do binding drift no goal_status.", "problem: Probe da issue #19.",
    "decision: RED primeiro.", "scope:", "  include:", "    - Validar gates.", "  exclude:",
    "    - Externo.", "requirements:", "  - id: REQ-01", "    statement: Probe.", "    criteria:",
    "      - id: C-01", "        statement: goal_start retorna flow_id.",
    "plan: [Probe.]", "tasks:", "  - id: A-01", "    action: Chamar goal_start.",
    "    covers: [REQ-01]", "    done_when: [C-01]", "    depends_on: []",
    "    evidence_requirements:", "      - id: ER-01", "        proves: [C-01]", "        method: inspection",
    "        procedure: Observar flow_id.", "        expectation:", "          kind: boolean_assertion",
    "          expected: true",
    "closure_gates: [Nenhum para o probe.]", "risks:", "  - Risco de fixture.",
    "uncertainties:", "  - nenhuma.", "gates:", "  - preenchidos.", "validation:", "  - vitest local.",
    "execution_prompt: |", "  /GOAL", "---", "# t", ""
  ].join("\n");
  const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", goalId + ".md");
  await writeFile(sptPath, document, "utf8");
  return sptPath;
}

async function startGoalFor(goalId: string, objective: string) {
  const sptPath = await writeSpt(goalId, objective);
  return engine.startGoal({
    workspace,
    spt_path: sptPath,
    objective,
    idempotency_key: "status-drift-" + goalId,
    evidence_required: true,
    required_evidence: ["ER-01"],
    source: "test",
    mode: "full"
  } as Parameters<FlowEngine["startGoal"]>[0]);
}

describe("issue #19: goal_status expõe divergência de fingerprint do SPT", () => {
  it("lean expoe spt_binding_integrity drifted quando o SPT diverge do fingerprint registrado; full mostra registered x current", async () => {
    const started = await startGoalFor("goal-status-drift", "Probe drift no goal_status");
    const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "goal-status-drift.md");
    const original = await readFile(sptPath, "utf8");
    await writeFile(sptPath, original.replace("origin: teste issue 19", "origin: teste issue 19 EDITADO"), "utf8");

    const lean = await engine.goalStatus({ flow_id: started.flow_id as string, detail: "lean" });
    expect(lean.spt_binding_integrity).toEqual({
      status: "drifted",
      reason_code: "spt_contract_fingerprint_drift"
    });

    const full = await engine.goalStatus({ flow_id: started.flow_id as string, detail: "full" });
    const integrity = full.spt_binding_integrity as {
      status: string;
      reason_code: string | null;
      fields_compared: Array<{ field: string; registered: unknown; current: unknown; match: boolean }>;
    };
    expect(integrity.status).toBe("drifted");
    expect(integrity.reason_code).toBe("spt_contract_fingerprint_drift");
    expect(integrity.fields_compared).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "spt_contract_fingerprint", match: false })
    ]));
  });

  it("flow coerente: lean OMITE spt_binding_integrity (economia frota) e full expoe coherent", async () => {
    const started = await startGoalFor("goal-status-coerente", "Probe coerente no goal_status");

    const lean = await engine.goalStatus({ flow_id: started.flow_id as string, detail: "lean" });
    expect(Object.hasOwn(lean, "spt_binding_integrity")).toBe(false);

    const full = await engine.goalStatus({ flow_id: started.flow_id as string, detail: "full" });
    expect((full.spt_binding_integrity as { status: string }).status).toBe("coherent");
  });
});
