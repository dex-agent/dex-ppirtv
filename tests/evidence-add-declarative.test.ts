import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { addDeclarativeEvidence, declarativeDefaults } from "../src/spt-declarative-proof.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let workspace: string;
let engine: FlowEngine;
let flowId: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-declarative-engine-"));
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
    objective: "Provar rota declarativa",
    idempotency_key: "declarative-engine-fixture",
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

describe("addDeclarativeEvidence over the real FlowEngine", () => {
  it("expands one declaration into passed criterion proofs and unblocks the verdict coverage gate", async () => {
    const receipt = await addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "bateria verde",
      kind: "goal_evidence",
      declarative_proof: {
        task_id: "A-01",
        evidence_requirement_id: "ER-01",
        observed_value: true,
        paths: ["src/example.ts"],
        command: "vitest fixture"
      }
    }, declarativeDefaults());

    expect(receipt.declarative).toBe(true);
    expect(receipt.evidence_requirement_id).toBe("ER-01");
    expect(receipt.evidence_ids).toHaveLength(2);
    expect(receipt.criteria.map((criterion) => criterion.criterion_id)).toEqual(["C-01", "C-02"]);
    expect(receipt.all_passed).toBe(true);
    for (const criterion of receipt.criteria) {
      expect(criterion.passed).toBe(true);
      expect(criterion.evidence_id).toBeTruthy();
    }

    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "cobertura declarativa presente",
      evidence_ids: receipt.evidence_ids,
      next_step: "executar fiscais pendentes"
    });
    expect((verdict.verdict as Record<string, unknown>).status).toBe("pronto_com_ressalvas");
  });

  it("rejects sending criterion_proof together with declarative_proof with an actionable error", async () => {
    await expect(addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "conflito de rotas",
      declarative_proof: {
        task_id: "A-01",
        evidence_requirement_id: "ER-01",
        observed_value: true,
        paths: ["src/example.ts"]
      },
      criterion_proof: { task_id: "A-01" }
    } as never, declarativeDefaults())).rejects.toThrow(
      /SPT_V3_DECLARATIVE_INVALID: mutual_exclusion: send either criterion_proof or declarative_proof, not both/
    );
  });

  it("fails loud with SPT_V3_DECLARATIVE_OBSERVED_TYPE before touching the engine", async () => {
    await expect(addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "tipo errado",
      declarative_proof: {
        task_id: "A-01",
        evidence_requirement_id: "ER-01",
        observed_value: { observed: true, rich: ["object"] },
        paths: ["src/example.ts"]
      }
    }, declarativeDefaults())).rejects.toThrow(/SPT_V3_DECLARATIVE_OBSERVED_TYPE: ER-01 \(kind boolean_assertion\)/);
  });
});

function v3Document(ws: string): string {
  return [
    "---",
    "dex_contract: spt",
    "version: 3",
    "status: AUTORIZADO",
    "owner: sprinter",
    "date: '2026-10-14'",
    `workspace: ${JSON.stringify(ws)}`,
    "origin: fixture declarativa",
    "goal:",
    "  id: provar-rota-declarativa",
    "  title: Provar rota declarativa",
    "  objective: Provar rota declarativa",
    "context: Fixture sintetica sem payload privado.",
    "problem: Cerimonia manual de prova consome o executor.",
    "decision: Expansao declarativa server-side.",
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
    "validation: [vitest run tests/evidence-add-declarative.test.ts]",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute esta fixture.",
    "---",
    "# Fixture SPT v3 declarativa"
  ].join("\n");
}
