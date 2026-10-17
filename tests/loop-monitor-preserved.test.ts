import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { fingerprintReviewedImplementation } from "../src/review-snapshot.js";

// T-2 do SPT review-gate-loop-proof: CARACTERIZACAO do comportamento
// PRESERVADO do fiscal de loop (heuristic Feathers cap. 13 — pino da area
// antes do alvo). Estes tres testes passam HOJE e devem continuar passando
// depois que a T-3 mudar a semantica de reset: sao a prova de que progresso
// REAL (e eventos legados) continuam zerando a janela do loop_monitor.

const TEST_ENV_KEYS = [
  "PPIRTV_GRAPHIFY_RECALL",
  "PPIRTV_GRAPHIFY_COMMAND",
  "PPIRTV_GRAPHIFY_GRAPH_PATH",
  "PPIRTV_GRAPHIFY_TIMEOUT_MS",
  "PPIRTV_GRAPHIFY_BUDGET",
  "PPIRTV_PRINCIPLES_PATH",
  "DEX_MEMORIA_HOME",
  "USERPROFILE"
] as const;

let tempRoot: string;
let engine: FlowEngine;
let originalTestEnv: Record<string, string | undefined>;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-loop-preserved-"));
  originalTestEnv = snapshotEnv(TEST_ENV_KEYS);
  for (const key of TEST_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.USERPROFILE = path.join(tempRoot, "home-without-shared-principles");
  engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
});

afterEach(async () => {
  restoreEnvSnapshot(originalTestEnv);
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function snapshotEnv(keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvSnapshot(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function fakeSptText(workspace: string, objective: string): string {
  return [
    "---",
    "dex_contract: spt",
    "version: 2",
    "status: EM_TESTE",
    "owner: Teste",
    "date: '2026-05-24'",
    `workspace: ${JSON.stringify(workspace)}`,
    "origin: teste",
    "goal:",
    "  id: fake-goal-spt",
    "  title: Fake GOAL SPT",
    `  objective: ${objective}`,
    "context: Teste local do contrato GOAL/SPT.",
    "problem: Garantir que o flow receba campos normalizados.",
    "decision: Usar SPT v2 em .agents/PLAN-TASKS.",
    "scope:",
    "  include:",
    "    - Validar SPT local.",
    "  exclude:",
    "    - Alterar componentes externos.",
    "spec: Executar ponte GOAL/SPT com evidencia rastreavel.",
    "plan:",
    "  - Validar SPT.",
    "  - Criar flow.",
    "  - Registrar evidencia.",
    "tasks:",
    "  - Rodar teste local.",
    "expected_evidence:",
    "  - npm run check.",
    "done_criteria:",
    "  - npm run check.",
    "risks:",
    "  - Falso pronto sem evidencia.",
    "uncertainties:",
    "  - Cliente de teste pode variar o objective do envelope.",
    "gates:",
    "  - tasks, expected_evidence e done_criteria preenchidos.",
    "validation:",
    "  - npm run check.",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute este SPT.",
    "---",
    "# Human test notes\n"
  ].join("\n");
}

async function startGoalWithEvidence(idempotencyKey: string, objective: string): Promise<{ flowId: string; evidenceId: string }> {
  const workspace = path.join(tempRoot, idempotencyKey.replace(/[^a-z0-9_-]+/gi, "-"));
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-05-24-fake-goal-spt.md");
  await writeFile(sptPath, fakeSptText(workspace, objective), "utf8");
  for (const relativePath of [
    "docs/contract.md",
    "docs/status.md",
    "src/flow-engine.ts",
    "src/l1-adapter.ts",
    "src/server.ts",
    "src/x.ts"
  ]) {
    const target = path.join(workspace, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `fixture:${relativePath}\n`, "utf8");
  }
  const started = await engine.startGoal({
    workspace,
    spt_path: sptPath,
    objective,
    idempotency_key: idempotencyKey,
    evidence_required: true,
    required_evidence: ["npm run check"],
    requested_verdict_policy: "evidence_required",
    source: "dex-code",
    mode: "full"
  });
  const flowId = started.flow_id as string;
  const evidence = await engine.addGoalEvidence({
    flow_id: flowId,
    title: "npm run check",
    content: "pass",
    satisfies: ["npm run check"]
  });
  return { flowId, evidenceId: evidence.evidence_id as string };
}

async function currentImplementationFingerprint(flowId: string): Promise<string> {
  const flow = await engine.store.loadFlow(flowId);
  const workspace = flow.goal_binding?.envelope.workspace;
  if (!workspace) {
    throw new Error(`Missing workspace for ${flowId}`);
  }
  return fingerprintReviewedImplementation(workspace, flow.changed_files, process.platform, {
    allowedMissingFiles: flow.deleted_files ?? []
  });
}

async function repeatFiscalBlock(flowId: string, evidenceId: string, times: number): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Risco material ainda sem review explicito.",
        evidence_ids: [evidenceId],
        residual_risks: ["sem review explicito"],
        next_step: "tentar resolver blocker fiscal"
      })
    ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED/i);
  }
}

describe("T-2 caracterizacao do fiscal de loop: progresso real e eventos legados continuam resetando a janela", () => {
  it("evidence_attached de kind NAO-review reseta a janela do loop_monitor", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("t2-preserved-nao-review", "Evidencia comum reseta janela");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });

    await repeatFiscalBlock(flowId, evidenceId, 3);
    expect((await engine.goalStatus({ flow_id: flowId })).loop_monitor).toMatchObject({ count: 3 });

    await engine.addGoalEvidence({
      flow_id: flowId,
      title: "evidencia comum pos-bloqueio",
      content: "log de progresso real",
      satisfies: ["npm run check"]
    });

    await repeatFiscalBlock(flowId, evidenceId, 2);
    expect((await engine.goalStatus({ flow_id: flowId })).loop_monitor).toMatchObject({ count: 2 });
  });

  it("evento evidence_attached persistido SEM campo de validade (legado) continua resetando a janela", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("t2-preserved-legado", "Evento legado reseta janela");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });

    await repeatFiscalBlock(flowId, evidenceId, 3);
    expect((await engine.goalStatus({ flow_id: flowId })).loop_monitor).toMatchObject({ count: 3 });

    const flow = await engine.store.loadFlow(flowId);
    flow.history.push({
      at: new Date().toISOString(),
      type: "evidence_attached",
      data: { evidence_id: "evd_legacy_sem_validade", title: "evento legado persistido antes do campo de validade" }
    });
    await engine.store.saveFlow(flow);

    await repeatFiscalBlock(flowId, evidenceId, 2);
    expect((await engine.goalStatus({ flow_id: flowId })).loop_monitor).toMatchObject({ count: 2 });
  });

  it("evidence_attached de review VALIDA reseta a janela (e resolve review_required ate o fingerprint stalar)", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("t2-preserved-review-valida", "Review valida reseta janela");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });

    await repeatFiscalBlock(flowId, evidenceId, 3);
    expect((await engine.goalStatus({ flow_id: flowId })).loop_monitor).toMatchObject({ count: 3 });

    await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review estruturada valida",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["padrao de caracterizacao"],
        findings: [],
        regression_risks: ["review valida deve resetar janela"]
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    const resolved = await engine.goalStatus({ flow_id: flowId });
    expect(resolved.blockers).not.toContain("review_required");

    // Mesma assinatura volta quando o fingerprint stala: os 3 bloqueios
    // antigos ficaram atras do evidence_attached da review valida — se o
    // reset funcionou, a contagem recomeca em 2 (e nao em 5).
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts", "src/server.ts"] });
    await repeatFiscalBlock(flowId, evidenceId, 2);
    expect((await engine.goalStatus({ flow_id: flowId })).loop_monitor).toMatchObject({ count: 2 });
  });
});
