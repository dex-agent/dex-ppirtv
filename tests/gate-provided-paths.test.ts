import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-gate-paths-"));
  engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("gate provided.changed_files: path inexistente e expurgo (ISSUE-LOCAL-0002)", () => {
  it("path inexistente em provided.changed_files vira ressalva provided_missing_paths e NAO entra na union", async () => {
    const { flowId, workspace } = await startGoal("gate-paths-fantasma");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/app.ts"] });

    const gate = (await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: {
        implementation_done: true,
        changed_files: ["src/app.ts", "src/typo-fantasma-ts.ts"],
      },
    })) as Record<string, unknown>;

    // ressava nomeando o typo (aviso; nunca em missing/blocked)
    expect(Array.isArray(gate.provided_missing_paths)).toBe(true);
    expect(gate.provided_missing_paths).toContain("src/typo-fantasma-ts.ts");
    expect(Array.isArray(gate.missing) ? gate.missing : []).not.toContain("src/typo-fantasma-ts.ts");

    // o typo NAO persiste na union acumulada
    const flow = await engine.store.loadFlow(flowId);
    expect(flow.changed_files).toContain("src/app.ts");
    expect(flow.changed_files).not.toContain("src/typo-fantasma-ts.ts");
    expect(workspace).toBeTruthy();
  });

  it("path valido declarado antes de existir fica de fora COM ressalva ate existir (comportamento declarado)", async () => {
    const { flowId } = await startGoal("gate-paths-antecipado");
    await engine.updateFlowFacts(flowId, { changed_files: [] });

    const gate = (await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: {
        implementation_done: true,
        changed_files: ["src/futuro.ts"],
      },
    })) as Record<string, unknown>;

    expect(gate.provided_missing_paths).toContain("src/futuro.ts");
    const flow = await engine.store.loadFlow(flowId);
    expect(flow.changed_files).not.toContain("src/futuro.ts");

    // quando o arquivo passa a existir, o mesmo provided o aceita
    const workspace = flow.goal_binding!.envelope.workspace;
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src", "futuro.ts"), "export const ok = true;\n", "utf8");
    const gate2 = (await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: {
        implementation_done: true,
        changed_files: ["src/futuro.ts"],
      },
    })) as Record<string, unknown>;
    expect((gate2.provided_missing_paths as string[]) ?? []).not.toContain("src/futuro.ts");
    const flow2 = await engine.store.loadFlow(flowId);
    expect(flow2.changed_files).toContain("src/futuro.ts");
  });

  it("deleted_files atesta delecao REAL: path permanece na union como memoria do escopo (desenho #6; expurgo rejeitado)", async () => {
    const { flowId, workspace } = await startGoal("gate-paths-delecao-real");
    await writeFile(path.join(workspace, "src", "temp.ts"), "export const temp = true;\n", "utf8");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/app.ts"] });
    await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: { implementation_done: true, changed_files: ["src/app.ts", "src/temp.ts"] },
    });
    let flow = await engine.store.loadFlow(flowId);
    expect(flow.changed_files).toContain("src/temp.ts");

    // delecao REAL no meio do corte: deleted_files declara a ausencia; o path
    // PERMANECE na union (memoria do escopo — o snapshot o atesta como
    // deleted; expurga-lo quebra a atestacao, regresso medido na emenda)
    await rm(path.join(workspace, "src", "temp.ts"), { force: true });
    await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: { implementation_done: true, changed_files: ["src/app.ts"], deleted_files: ["src/temp.ts"] },
    });
    flow = await engine.store.loadFlow(flowId);
    expect(flow.changed_files).toContain("src/app.ts");
    expect(flow.changed_files).toContain("src/temp.ts");
    expect(flow.deleted_files ?? []).toContain("src/temp.ts");
    // e a ressalva NAO acusa o path declarado como deleted (ausencia legitima)
  });

  it("deleted_files de path fora do escopo historico continua reprovado (DELETED_FILES_NOT_CHANGED)", async () => {
    const { flowId } = await startGoal("gate-paths-estrorno");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/app.ts"] });
    await expect(
      engine.goalGateCheck({
        flow_id: flowId,
        phase: "implementacao",
        persist: true,
        provided: { implementation_done: true, changed_files: ["src/app.ts"], deleted_files: ["src/ nunca-esteve-aqui.ts"] },
      })
    ).rejects.toThrow(/DELETED_FILES_NOT_CHANGED/);
  });

  async function startGoal(idempotencyKey: string): Promise<{ flowId: string; workspace: string }> {
    const objective = `Validar ${idempotencyKey}`;
    const workspace = path.join(tempRoot, idempotencyKey);
    const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "gate-paths.md");
    await mkdir(path.dirname(sptPath), { recursive: true });
    await writeFile(sptPath, fakeSpt(workspace, objective), "utf8");
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src", "app.ts"), "export const app = true;\n", "utf8");
    const started = (await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective,
      idempotency_key: idempotencyKey,
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "gate-paths-test",
      mode: "full",
    })) as { flow_id: string };
    return { flowId: started.flow_id, workspace };
  }
});

function fakeSpt(workspace: string, objective: string): string {
  return [
    "---", "dex_contract: spt", "version: 2", "status: EM_TESTE", "owner: Teste",
    "date: '2026-11-09'", `workspace: ${JSON.stringify(workspace)}`, "origin: issue-0002 test",
    "goal:", "  id: gate-paths", "  title: gate paths", `  objective: ${objective}`,
    "context: ctx.", "problem: p.", "decision: d.",
    "scope:", "  include:", "    - src/app.ts", "  exclude:", "    - vault",
    "spec: s.", "plan:", "  - a.", "tasks:", "  - t.",
    "expected_evidence:", "  - e.", "done_criteria:", "  - c.",
    "risks:", "  - r.", "uncertainties:", "  - u.",
    "gates:", "  - g.", "validation:", "  - v.",
    "execution_prompt: |", "  /GOAL", `  ${objective}`, "---", "",
  ].join("\n");
}
