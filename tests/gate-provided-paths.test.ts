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

    // ressalva nomeando o typo (aviso; nunca em missing/blocked — e a gate
    // segue passed: ressalva nunca bloqueia, contrato de domain.ts)
    expect(Array.isArray(gate.provided_missing_paths)).toBe(true);
    expect(gate.provided_missing_paths).toContain("src/typo-fantasma-ts.ts");
    expect(gate.missing).not.toContain("src/typo-fantasma-ts.ts");
    expect(gate.status).toBe("passed");

    // o typo NAO persiste na union acumulada
    const flow = await engine.store.loadFlow(flowId);
    expect(flow.changed_files).toContain("src/app.ts");
    expect(flow.changed_files).not.toContain("src/typo-fantasma-ts.ts");
    // a raiz de julgamento e o workspace do ENVELOPE (nunca o CWD do processo)
    expect(flow.goal_binding!.envelope.workspace).toBe(workspace);
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
    expect(gate.status).toBe("passed");
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
    const gate2 = (await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: { implementation_done: true, changed_files: ["src/app.ts"], deleted_files: ["src/temp.ts"] },
    })) as Record<string, unknown>;
    flow = await engine.store.loadFlow(flowId);
    expect(flow.changed_files).toContain("src/app.ts");
    expect(flow.changed_files).toContain("src/temp.ts");
    expect(flow.deleted_files ?? []).toContain("src/temp.ts");
    // a ressalva NAO acusa o path declarado como deleted (deleção REAL de quem
    // está na union histórica — isenção legítima) e a gate segue passed
    expect(gate2.provided_missing_paths ?? []).not.toContain("src/temp.ts");
    expect(gate2.status).toBe("passed");
  });

  it("deleted_files de path fora do escopo historico continua reprovado (DELETED_FILES_NOT_CHANGED)", async () => {
    const { flowId } = await startGoal("gate-paths-guard-escopo");
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

  it("BYPASS FECHADO adversarial D-31 P1 — par changed E deleted simultâneo de path que o disco NÃO confirma entra por atestação canônica COM aviso, nunca mudo, nunca bloqueia", async () => {
    const { flowId } = await startGoal("gate-paths-bypass");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/app.ts"] });

    // Pré-emenda: o par simultâneo plantava o fantasma na union SEM aviso
    // nenhum (mudo — bypass do contrato publicado). Pós-emenda: o par é o
    // formato canônico de deleção (1ª declaração; indistinguível de deleção
    // real no disco), então ENTRA na union por atestação do cliente, mas o
    // receipt emite provided_unconfirmed_deletions nomeando o path — o typo
    // deixa de ser mudo sem quebrar a deleção real legítima.
    const gate = (await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: {
        implementation_done: true,
        changed_files: ["src/app.ts", "src/typo-bypass.ts"],
        deleted_files: ["src/typo-bypass.ts"],
      },
    })) as Record<string, unknown>;
    expect(gate.status).toBe("passed");
    expect(gate.provided_unconfirmed_deletions).toContain("src/typo-bypass.ts");
    expect(gate.provided_missing_paths ?? []).not.toContain("src/typo-bypass.ts");
    const flow = await engine.store.loadFlow(flowId);
    expect(flow.changed_files).toContain("src/typo-bypass.ts");
  });

  it("fluxo SEM goal_binding gate_check legado — sem envelope não há raiz legítima, sem ressalva e sem contaminação pelo CWD do servidor adversarial D-31", async () => {
    const created = (await engine.createFlow({ goal: "fluxo legado sem binding (gate_check)" })) as { flow_id: string };
    await engine.updateFlowFacts(created.flow_id, { changed_files: ["src/app.ts"] });

    // Pré-cura: o fallback process.cwd() julgava existência contra a raiz do
    // SERVIDOR (arquivo do produto podia entrar na union de flow sem
    // workspace). Pós-cura: sem envelope a ressalva fica ausente (não há
    // fronteira para julgar) — comportamento pré-issue preservado na rota legada.
    const gate = (await engine.checkGate({
      flow_id: created.flow_id,
      phase: "implementacao",
      persist: true,
      provided: {
        implementation_done: true,
        changed_files: ["src/app.ts", "nao-existe-em-lugar-nenhum.ts"],
      },
    })) as Record<string, unknown>;
    expect(gate.provided_missing_paths ?? []).not.toContain("nao-existe-em-lugar-nenhum.ts");
  });

  it("diretório não é arquivo do escopo — typo em forma de diretório ganha ressalva e NÃO entra na union adversarial D-31 V3", async () => {
    const { flowId } = await startGoal("gate-paths-diretorio");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/app.ts"] });

    const gate = (await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: { implementation_done: true, changed_files: ["src/app.ts", "src"] },
    })) as Record<string, unknown>;
    expect(gate.provided_missing_paths).toContain("src");
    const flow = await engine.store.loadFlow(flowId);
    expect(flow.changed_files).not.toContain("src");
  });

  it("goal_gate_preflight emite a mesma ressalva do gate — assimetria fechada adversarial D-31", async () => {
    const { flowId } = await startGoal("gate-paths-preflight");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/app.ts"] });

    const preflight = (await engine.goalGatePreflight({
      flow_id: flowId,
      phase: "implementacao",
      provided: { implementation_done: true, changed_files: ["src/app.ts", "src/typo-preflight.ts"] },
    })) as Record<string, unknown>;
    expect(preflight.provided_missing_paths).toContain("src/typo-preflight.ts");
  });

  it("sequência declarado-antes-de-existir com deleted depois — guard ensina que o path nunca foi escopo adversarial D-31 V5 documental", async () => {
    const { flowId } = await startGoal("gate-paths-v5");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/app.ts"] });

    // gate1: path ainda inexistente fica de fora COM ressalva (desenho #6)
    const gate1 = (await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: { implementation_done: true, changed_files: ["src/app.ts", "src/temp-v5.ts"] },
    })) as Record<string, unknown>;
    expect(gate1.provided_missing_paths).toContain("src/temp-v5.ts");

    // gate2: deleted_files de quem nunca entrou na union é erro de contrato —
    // o throw nomeia o path (recuperação: não há escopo para deletar;
    // corrija a declaração em vez de insistir)
    await expect(
      engine.goalGateCheck({
        flow_id: flowId,
        phase: "implementacao",
        persist: true,
        provided: { implementation_done: true, changed_files: ["src/app.ts"], deleted_files: ["src/temp-v5.ts"] },
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
