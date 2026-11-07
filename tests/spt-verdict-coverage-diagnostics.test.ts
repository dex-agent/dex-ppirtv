import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { addDeclarativeEvidence, declarativeDefaults } from "../src/spt-declarative-proof.js";
import { PpirtvStore } from "../src/store.js";

// SPT issue10-verdict-diagnostico (GO 2026-11-07): o verdict cego pago pela
// frota (issue #10) — 5 criterion_proofs anexados e o erro só dizia
// missing=C-01..C-04. Estes testes exigem o erro que ENSINA: por que cada
// critério está descoberto (prova passed=false com a evaluation literal,
// evidência sem criterion_proof) e o diagnóstico de binding visível no
// goal_status. RED primeiro: no baseline 25275b0 todos falham.
let tempRoot: string;
let workspace: string;
let engine: FlowEngine;
let flowId: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-coverage-diag-"));
  workspace = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "example.ts"), "export const result = true;\n", "utf8");
  await mkdir(path.join(workspace, ".agents", "PLAN-TASKS"), { recursive: true });
  await writeFile(
    path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
    v3Document(workspace),
    "utf8"
  );
  engine = new FlowEngine(new PpirtvStore(path.join(workspace, ".ppirtv")));
  const started = await engine.startGoal({
    workspace,
    spt_path: path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
    objective: "Provar diagnostico de cobertura",
    idempotency_key: "coverage-diag-fixture",
    evidence_required: true,
    required_evidence: [],
    requested_verdict_policy: "evidence_required",
    source: "test"
  });
  flowId = started.flow_id as string;
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("goal_verdict SPT v3 coverage: o erro ensina por que cada criterio esta descoberto (issue #10)", () => {
  it("prova citada com passed=false: erro traz criterion_id, marca proof_not_passed e a evaluation literal", async () => {
    const receipt = await addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "declarativa reprovada",
      kind: "goal_evidence",
      declarative_proof: {
        task_id: "A-01",
        evidence_requirement_id: "ER-01",
        observed_value: false,
        paths: ["src/example.ts"],
        command: "vitest fixture (falhou de proposito)"
      }
    }, declarativeDefaults());
    expect(receipt.all_passed).toBe(false);

    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "cobertura reprovada de proposito",
      evidence_ids: receipt.evidence_ids,
      next_step: "diagnostico visivel"
    })).rejects.toThrow(/C-01.*proof_not_passed.*boolean false equals true/s);
  });

  it("evidencia citada sem criterion_proof: erro traz marca no_criterion_proof para o criterio descoberto", async () => {
    const note = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "nota sem prova de criterio",
      kind: "note",
      note: "evidencia narrativa que nao prova C-01 nem C-02"
    }) as Record<string, unknown>;
    const noteId = typeof note.evidence_id === "string" ? note.evidence_id : "";

    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "cobertura ausente",
      evidence_ids: [noteId],
      next_step: "diagnostico visivel"
    })).rejects.toThrow(/C-01.*no_criterion_proof/s);
  });

  it("goal_status full expoe spt_contract_version e spt_traceability_present do binding", async () => {
    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" }) as Record<string, unknown>;
    expect(status.spt_contract_version).toBe(3);
    expect(status.spt_traceability_present).toBe(true);
  });

  it("flow orfao de spt_traceability reata a traceability no re-bind com o mesmo spt validado", async () => {
    const orphan = path.join(workspace, ".ppirtv", "flows", `${flowId}.json`);
    const { readFile, writeFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(orphan, "utf8"));
    delete raw.spt_traceability;
    await writeFile(orphan, JSON.stringify(raw), "utf8");

    const rebound = await engine.startGoal({
      flow_id: flowId,
      workspace,
      spt_path: path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
      objective: "Provar diagnostico de cobertura",
      idempotency_key: "coverage-diag-fixture",
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "test"
    });
    expect(rebound.flow_id).toBe(flowId);
    const after = JSON.parse(await readFile(orphan, "utf8"));
    expect(after.spt_traceability?.tasks?.length).toBeGreaterThan(0);
    expect(after.spt_traceability?.requirements?.length).toBeGreaterThan(0);
  });
});

function v3Document(ws: string): string {
  return [
    "---",
    "dex_contract: spt",
    "version: 3",
    "status: AUTORIZADO",
    "owner: sprinter",
    "date: '2026-11-07'",
    `workspace: ${JSON.stringify(ws)}`,
    "origin: fixture diagnostico cobertura",
    "goal:",
    "  id: provar-diagnostico-cobertura",
    "  title: Provar diagnostico de cobertura",
    "  objective: Provar diagnostico de cobertura",
    "context: Fixture sintetica sem payload privado.",
    "problem: Verdict cego esconde o campo reprovado.",
    "decision: Diagnostico por criterio no erro.",
    "scope:",
    "  include: [Validar fixture.]",
    "  exclude: [Alterar produto.]",
    "requirements:",
    "  - id: REQ-01",
    "    statement: O resultado deve ser observavel.",
    "    criteria:",
    "      - id: C-01",
    "        statement: Criterio um.",
    "      - id: C-02",
    "        statement: Criterio dois.",
    "plan: [Executar a task.]",
    "tasks:",
    "  - id: A-01",
    "    action: Executar assercao.",
    "    covers: [REQ-01]",
    "    done_when: [C-01, C-02]",
    "    depends_on: []",
    "    evidence_requirements:",
    "      - id: ER-01",
    "        proves: [C-01, C-02]",
    "        method: test",
    "        procedure: Executar assercao e registrar o booleano.",
    "        expectation:",
    "          kind: boolean_assertion",
    "          expected: true",
    "closure_gates: [Review e teste possuem receipts independentes.]",
    "risks: [Falso verde.]",
    "uncertainties: [Nenhuma na fixture.]",
    "gates: [A prova deve citar ER-01.]",
    "validation: [vitest run tests/spt-verdict-coverage-diagnostics.test.ts]",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute esta fixture.",
    "---",
    "# Fixture SPT v3 diagnostico de cobertura"
  ].join("\n");
}
