import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Este teste sobe o servidor REAL (dist/index.js) via scripts/validate-spt.mjs.
// Rode `npm run build` antes quando executar o arquivo isolado
// (`npm run check` já builda antes da suíte inteira).
const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "validate-spt.mjs");
const distEntry = path.join(repoRoot, "dist", "index.js");

let tempRoot: string;
let workspace: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-skeletons-"));
  workspace = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspace, ".agents", "PLAN-TASKS"), { recursive: true });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("proof_skeletons na descoberta de formato", () => {
  it("spt_validate ao vivo emite proof_skeletons por evidence_requirement e o script local os expõe", async () => {
    if (!existsSync(distEntry)) {
      throw new Error("dist/index.js ausente: rode `npm run build` antes deste teste focado");
    }
    const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "skeleton-fixture.md");
    await writeSpt(sptPath, v3Document(workspace));

    const run = spawnSync(
      process.execPath,
      [scriptPath, "--workspace", workspace, "--spt-path", sptPath],
      { encoding: "utf8", cwd: repoRoot }
    );
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout);

    expect(report.spt_validate.valid).toBe(true);
    expect(report.spt_validate.proof_skeletons).toHaveLength(1);
    const serverSkeleton = report.spt_validate.proof_skeletons[0];
    expect(serverSkeleton).toMatchObject({
      task_id: "A-01",
      evidence_requirement_id: "ER-01",
      proves: ["C-01", "C-02"],
      observed_value_type: "integer exit code (number)"
    });
    expect(serverSkeleton.declarative_payload).toMatchObject({
      declarative_proof: {
        task_id: "A-01",
        evidence_requirement_id: "ER-01",
        observed_value: "0",
        paths: []
      }
    });

    expect(report.proof_skeletons).toHaveLength(1);
    expect(report.proof_skeletons[0]).toMatchObject({
      evidence_requirement_id: "ER-01",
      proves: ["C-01", "C-02"],
      observed_value_type: "integer exit code (number)"
    });
  }, 60000);

  it("contrato inválido não emite skeletons (apenas diagnostico)", async () => {
    if (!existsSync(distEntry)) {
      throw new Error("dist/index.js ausente: rode `npm run build` antes deste teste focado");
    }
    const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "broken.md");
    await writeSpt(sptPath, v3Document(workspace).replace("proves: [C-01, C-02]", "proves: [C-404]"));

    const run = spawnSync(
      process.execPath,
      [scriptPath, "--workspace", workspace, "--spt-path", sptPath],
      { encoding: "utf8", cwd: repoRoot }
    );
    expect(run.status).toBe(1);
    const report = JSON.parse(run.stdout);
    expect(report.spt_validate.valid).toBe(false);
    expect(report.proof_skeletons).toEqual([]);
    expect(report.spt_validate.proof_skeletons).toBeUndefined();
  }, 60000);
});

async function writeSpt(target: string, content: string): Promise<void> {
  await writeFile(target, content, "utf8");
}

function v3Document(ws: string): string {
  return [
    "---",
    "dex_contract: spt",
    "version: 3",
    "status: AUTORIZADO",
    "owner: sprinter",
    "date: '2026-10-14'",
    `workspace: ${JSON.stringify(ws)}`,
    "origin: fixture skeletons",
    "goal:",
    "  id: provar-skeletons",
    "  title: Provar skeletons",
    "  objective: Provar skeletons",
    "context: Fixture sintetica sem payload privado.",
    "problem: Agente adivinha o payload de prova.",
    "decision: Skeletons declarativos no spt_validate.",
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
    "    action: Executar bateria.",
    "    covers: [REQ-01]",
    "    done_when: [C-01, C-02]",
    "    depends_on: []",
    "    evidence_requirements:",
    "      - id: ER-01",
    "        proves: [C-01, C-02]",
    "        method: command",
    "        procedure: Rodar bateria.",
    "        expectation:",
    "          kind: command_exit",
    "          expected_exit_code: 0",
    "closure_gates: [Bateria com receipt.]",
    "risks: [Falso verde.]",
    "uncertainties: [Nenhuma na fixture.]",
    "gates: [A prova deve citar ER-01.]",
    "validation: [vitest run tests/spt-validate-skeletons.test.ts]",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute esta fixture.",
    "---",
    "# Fixture SPT v3 skeletons"
  ].join("\n");
}
