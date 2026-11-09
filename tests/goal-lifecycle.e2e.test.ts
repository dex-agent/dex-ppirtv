import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { fingerprintReviewedImplementation } from "../src/review-snapshot.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-goal-lifecycle-"));
  engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("GOAL lifecycle e2e (golden path num único workspace persistido)", () => {
  it("percorre start→gate/review→fiscal visível→checkout→verdict com artefatos persistidos", async () => {
    // 1) goal_start válido com SPT no workspace temporal
    const objective = "Percorrer o ciclo de vida completo do GOAL no motor real";
    const workspace = path.join(tempRoot, "consumer");
    const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "lifecycle.md");
    await mkdir(path.dirname(sptPath), { recursive: true });
    await writeFile(sptPath, fakeSpt(workspace, objective), "utf8");
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src", "app.ts"), "export const lifecycleFixture = true;\n", "utf8");

    const started = (await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective,
      idempotency_key: "goal-lifecycle-e2e-261109",
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "goal-lifecycle-e2e",
      mode: "full",
    })) as { flow_id: string };
    const flowId = started.flow_id;
    expect(flowId).toBeTruthy();

    // 2) implementação: facts mudam o worktree (changed_files)
    await engine.updateFlowFacts(flowId, { changed_files: ["src/app.ts"] });

    // 3) fases pela MÁQUINA DE ESTADOS real (sem teleporte de store):
    // cada goalAdvance fecha o gate da fase ATUAL (o método não recebe phase);
    // sequência canônica pensamentos→planejamento→implementacao→revisao
    await engine.goalAdvance({ flow_id: flowId, provided: {} });
    await engine.goalAdvance({ flow_id: flowId, provided: {} });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/app.ts"] },
    });
    const flowParaRevisao = await engine.store.loadFlow(flowId);
    expect(flowParaRevisao.phase).toBe("revisao");

    // gate de revisão: primeiro BLOQUEADO (fiscal visível: review sem evidência)
    const gateBloqueado = await engine.goalGateCheck({
      flow_id: flowId,
      phase: "revisao",
      persist: true,
      provided: {
        diff_reviewed: true,
        barata_scan: true,
        regression_risks: ["regressão de review"],
        changed_files: ["src/app.ts"],
      },
    });
    expect(gateBloqueado.status).toBe("blocked");
    expect(gateBloqueado.missing).toContain("review_evidence_coherent");

    // 4) review estrutural válida destrava o gate (fp pós-âncora)
    await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review estrutural do corte",
      reviewed_implementation_fingerprint: await currentFingerprint(flowId),
      content: "Diff e vizinhos revisados; sem blocker remanescente.",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/app.ts"],
        barata_scan: true,
        searched_patterns: ["review_required"],
        findings: [],
        regression_risks: ["regressão de review"],
      },
      scope_classification: "target",
      scope_reference: "src/app.ts",
    });
    const gateVerde = await engine.goalGateCheck({
      flow_id: flowId,
      phase: "revisao",
      persist: true,
      provided: {
        diff_reviewed: true,
        barata_scan: true,
        regression_risks: ["regressão de review"],
        changed_files: ["src/app.ts"],
      },
    });
    expect(gateVerde.status).toBe("passed");

    // 5) checkout/status do ciclo (envelope ppirtv-checkin) mantém coerência
    const status = (await engine.goalStatus({ flow_id: flowId, detail: "compact" })) as Record<string, unknown>;
    expect(status.blockers).not.toContain("review_required");

    // 6) verdict positivo com a review citada
    const flowParaVerdict = await engine.store.loadFlow(flowId);
    const reviewEvidence = flowParaVerdict.evidence.find((evidence) => evidence.kind === "code_review");
    expect(reviewEvidence).toBeTruthy();
    await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Ciclo completo percorrido com review estrutural e artefatos persistidos.",
      evidence_ids: [reviewEvidence!.evidence_id],
      next_step: "Encerrado; nenhuma ação futura pendente.",
      residual_risks: [],
    });
    // verdict conferido pela FONTE DA VERDADE persistida, não pelo retorno
    const flowPosVerdict = await engine.store.loadFlow(flowId);
    expect(flowPosVerdict.verdicts.length).toBeGreaterThan(0);
    expect(flowPosVerdict.verdicts.at(-1)?.status).toBe("pronto");

    // 7) artefatos persistidos conferidos NO DISCO (anti falso-positivo de exit 0)
    const flowFile = path.join(engine.store.flowsDir, `${flowId}.json`);
    const persisted = JSON.parse(await readFile(flowFile, "utf8")) as {
      phase: string;
      status: string;
      history: Array<{ type: string }>;
    };
    // verdict pronto registra o verdict mantendo o flow ativo neste perfil —
    // o advance TERMINAL (complete/archive) é rota própria, coberta pela
    // suíte do motor (flows TERMINAL das ondas da maratona)
    expect(persisted.phase).toBe("revisao");
    expect(persisted.status).toBe("active");
    expect(persisted.history.some((event) => event.type === "goal_started")).toBe(true);
    expect(persisted.history.some((event) => event.type === "evidence_attached")).toBe(true);
    expect(persisted.history.some((event) => event.type === "verdict_recorded")).toBe(true);

    const ledgerStat = await stat(engine.store.ledgerPath);
    expect(ledgerStat.size).toBeGreaterThan(0);
    const ledgerText = await readFile(engine.store.ledgerPath, "utf8");
    expect(ledgerText).toContain(flowId);
  });

  it("idempotência: reenviar o mesmo goal_start devolve o MESMO flow sem duplicar artefatos", async () => {
    const objective = "Idempotência do goal_start no ciclo";
    const workspace = path.join(tempRoot, "consumer-idem");
    const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "idem.md");
    await mkdir(path.dirname(sptPath), { recursive: true });
    await writeFile(sptPath, fakeSpt(workspace, objective), "utf8");
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src", "idem.ts"), "export const idem = true;\n", "utf8");

    const envelope = {
      workspace,
      spt_path: sptPath,
      objective,
      idempotency_key: "goal-lifecycle-idem-261109",
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required" as const,
      source: "goal-lifecycle-e2e",
      mode: "full" as const,
    };
    const first = (await engine.startGoal(envelope)) as { flow_id: string };
    const second = (await engine.startGoal(envelope)) as { flow_id: string };
    expect(second.flow_id).toBe(first.flow_id);

    const flowsDir = (engine.store as unknown as { flowsDir: string }).flowsDir;
    const files = (await readdir(flowsDir)).filter((file) => file.endsWith(".json"));
    expect(files.filter((file) => file.startsWith(first.flow_id))).toHaveLength(1);
  });

  async function currentFingerprint(flowId: string): Promise<string> {
    const flow = await engine.store.loadFlow(flowId);
    return fingerprintReviewedImplementation(
      flow.goal_binding!.envelope.workspace,
      flow.changed_files
    );
  }
});

function fakeSpt(workspace: string, objective: string): string {
  return [
    "---",
    "dex_contract: spt",
    "version: 2",
    "status: EM_TESTE",
    "owner: Teste",
    "date: '2026-11-09'",
    `workspace: ${JSON.stringify(workspace)}`,
    "origin: e2e lifecycle",
    "goal:",
    "  id: goal-lifecycle-e2e",
    "  title: Lifecycle e2e",
    `  objective: ${objective}`,
    "context: Teste local.",
    "problem: Ciclo sem prova ponta a ponta.",
    "decision: Percorrer ciclo completo.",
    "scope:",
    "  include:",
    "    - src/app.ts",
    "  exclude:",
    "    - vault",
    "spec: percorrer ciclo.",
    "plan:",
    "  - start, gate, review, verdict.",
    "tasks:",
    "  - executar ciclo.",
    "expected_evidence:",
    "  - review estrutural.",
    "done_criteria:",
    "  - verdict pronto.",
    "risks:",
    "  - falso positivo.",
    "uncertainties:",
    "  - legado.",
    "gates:",
    "  - teste verde.",
    "validation:",
    "  - vitest.",
    "execution_prompt: |",
    "  /GOAL",
    `  Executar ${objective} no workspace ${workspace}.`,
    "---",
    "",
  ].join("\n");
}
