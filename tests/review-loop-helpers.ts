import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { fingerprintReviewedImplementation } from "../src/review-snapshot.js";

// Helpers compartilhados dos testes do SPT review-gate-loop-proof (T-3).
// Bootstrap espelha tests/engine.test.ts (isolamento de env + store fixture).

export const TEST_ENV_KEYS = [
  "PPIRTV_GRAPHIFY_RECALL",
  "PPIRTV_GRAPHIFY_COMMAND",
  "PPIRTV_GRAPHIFY_GRAPH_PATH",
  "PPIRTV_GRAPHIFY_TIMEOUT_MS",
  "PPIRTV_GRAPHIFY_BUDGET",
  "PPIRTV_PRINCIPLES_PATH",
  "DEX_MEMORIA_HOME",
  "USERPROFILE"
] as const;

export function snapshotEnv(keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

export function restoreEnvSnapshot(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export async function createFixtureEngine(): Promise<{ tempRoot: string; engine: FlowEngine }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-review-loop-"));
  const engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
  return { tempRoot, engine };
}

export async function disposeFixtureEngine(tempRoot: string): Promise<void> {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
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

export async function startGoalWithEvidence(
  engine: FlowEngine,
  tempRoot: string,
  idempotencyKey: string,
  objective: string
): Promise<{ flowId: string; evidenceId: string }> {
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

export async function currentImplementationFingerprint(engine: FlowEngine, flowId: string): Promise<string> {
  const flow = await engine.store.loadFlow(flowId);
  const workspace = flow.goal_binding?.envelope.workspace;
  if (!workspace) {
    throw new Error(`Missing workspace for ${flowId}`);
  }
  return fingerprintReviewedImplementation(workspace, flow.changed_files, process.platform, {
    allowedMissingFiles: flow.deleted_files ?? []
  });
}

export async function expectFiscalBlock(
  engine: FlowEngine,
  flowId: string,
  evidenceId: string
): Promise<void> {
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
