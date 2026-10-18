import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { restoreEnvSnapshot, snapshotEnv, TEST_ENV_KEYS } from "./review-loop-helpers.js";

// SPT gate-integrity-f4f5f6 (T-1): RED triplo do corte 2 do laudo
// .agents/REVIEWS/2026-10-17-laudo-gate-integrity-hardening.md — F4 (segredo
// persiste no flow JSON), F5 (gate de review obsoleto apos changed_files),
// F6 (requisito evidence aceita qualquer coisa). Bootstrap espelha
// tests/gate-integrity-hardening.test.ts.

const envSnapshot = snapshotEnv(TEST_ENV_KEYS);
const SYNTHETIC_SECRET = `ghp_${"a".repeat(36)}`;

function fakeSpt(workspace: string, objective: string): string {
  return [
    "---", "dex_contract: spt", "version: 2", "status: EM_TESTE", "owner: Teste",
    "date: '2026-10-18'", `workspace: ${JSON.stringify(workspace)}`, "origin: teste",
    "goal:", "  id: fake-goal-spt", "  title: Fake GOAL SPT",
    `  objective: ${objective}`, "context: Teste local.",
    "problem: Garantir campos normalizados.", "decision: SPT v2 de teste.",
    "scope:", "  include:", "    - Validar SPT local.", "  exclude:", "    - Externo.",
    "spec: Ponte GOAL/SPT com evidencia rastreavel.", "plan:", "  - Validar SPT.",
    "tasks:", "  - Rodar teste local.", "expected_evidence:", "  - npm run check.",
    "done_criteria:", "  - npm run check.", "risks:", "  - Falso pronto.",
    "uncertainties:", "  - nenhuma.", "gates:", "  - preenchidos.",
    "validation:", "  - npm run check.", "execution_prompt: |", "  /GOAL", "---", "# t", ""
  ].join("\n");
}

async function fixtureBase(objective = "Objetivo de teste f4f5f6") {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gih-f456-"));
  const engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
  const workspace = path.join(tempRoot, "ws");
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-10-18-fake-goal-spt.md");
  await writeFile(sptPath, fakeSpt(workspace, objective), "utf8");
  for (const rel of ["src/a.ts", "src/new-after-review.ts", "docs/note.md"]) {
    const target = path.join(workspace, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `fixture:${rel}\n`, "utf8");
  }
  return { engine, tempRoot, workspace, sptPath, objective };
}

async function fixtureGoal(objective = "Objetivo de teste f4f5f6") {
  const base = await fixtureBase(objective);
  const started = (await base.engine.startGoal({
    workspace: base.workspace, spt_path: base.sptPath, objective,
    idempotency_key: `f456-${Math.random().toString(36).slice(2, 8)}`,
    evidence_required: true, required_evidence: ["npm run check"],
    requested_verdict_policy: "evidence_required", source: "dex-code"
  } as never)) as Record<string, unknown>;
  return { ...base, engine: base.engine, flowId: String(started.flow_id) };
}

type Fixture = ReturnType<typeof fixtureGoal> extends Promise<infer T> ? T : never;

async function phaseOf(f: Fixture): Promise<string> {
  const status = (await f.engine.goalStatus({ flow_id: f.flowId, detail: "lean" })) as Record<string, unknown>;
  return String(status.phase);
}

async function reachImplementacao(f: Fixture): Promise<void> {
  await f.engine.goalAdvance({ flow_id: f.flowId }); // concepcao -> implementacao
}

async function flowFilesContain(f: Fixture, needle: string): Promise<boolean> {
  const flowsDir = path.join(f.tempRoot, "flows");
  const files = await readdir(flowsDir).catch(() => [] as string[]);
  for (const file of files) {
    const content = await readFile(path.join(flowsDir, file), "utf8");
    if (content.includes(needle)) return true;
  }
  return false;
}

beforeAll(() => {
  for (const [k, v] of Object.entries(process.env)) if (v === undefined) delete process.env[k];
  restoreEnvSnapshot(envSnapshot);
});

afterAll(() => restoreEnvSnapshot(envSnapshot));

describe("F4 (cenario C): segredo sintetico nao persiste no flow", () => {
  it("createFlow com segredo no goal/context rejeita antes de persistir", async () => {
    const f = await fixtureGoal();
    try {
      await expect(f.engine.createFlow({ goal: `usar token ${SYNTHETIC_SECRET} agora`, context: "ctx" }))
        .rejects.toThrow(/secret/i);
      expect(await flowFilesContain(f, SYNTHETIC_SECRET)).toBe(false);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });

  it("updateFlowFacts com segredo em fato rejeita antes de persistir", async () => {
    const f = await fixtureGoal();
    try {
      await expect(f.engine.updateFlowFacts(f.flowId, { context: `token ${SYNTHETIC_SECRET} vazou` }))
        .rejects.toThrow(/secret/i);
      expect(await flowFilesContain(f, SYNTHETIC_SECRET)).toBe(false);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });

  it("goal_start com segredo no objective rejeita antes de persistir", async () => {
    const f = await fixtureBase(`Objetivo com token ${SYNTHETIC_SECRET} embutido`);
    try {
      await expect(f.engine.startGoal({
        workspace: f.workspace, spt_path: f.sptPath, objective: f.objective,
        idempotency_key: "f456-secret-goal-start",
        evidence_required: true, required_evidence: ["npm run check"],
        requested_verdict_policy: "evidence_required", source: "dex-code"
      } as never)).rejects.toThrow(/secret/i);
      expect(await flowFilesContain(f as unknown as Fixture, SYNTHETIC_SECRET)).toBe(false);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });

  it("nao-regressao: goal/context normais continuam criando flow", async () => {
    const f = await fixtureGoal();
    try {
      const flow = (await f.engine.createFlow({ goal: "objetivo legitimo sem segredo", context: "ctx normal" })) as Record<string, unknown>;
      expect(flow.flow_id).toBeTruthy();
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("F6: requisito evidence exige evidencia relevante (escape provided morre)", () => {
  it("revisao compact com provided.evidence 'false' e zero evidencias bloqueia", async () => {
    const f = await fixtureGoal();
    try {
      await reachImplementacao(f);
      await f.engine.goalAdvance({
        flow_id: f.flowId,
        provided: { implementation_done: true, changed_files: ["src/a.ts"] }
      }); // implementacao -> revisao
      const advance = (await f.engine.goalAdvance({
        flow_id: f.flowId,
        provided: { diff_reviewed: true, barata_scan: true, test_executed: true, evidence: "false", review_findings: ["diff revisado"] }
      })) as Record<string, unknown>;
      expect(advance.advanced).not.toBe(true);
      expect(advance.missing ?? []).toContain("evidence");
      expect(await phaseOf(f)).not.toBe("validacao");
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });

  it("nao-regressao: evidencia com satisfies cobrindo required_evidence satisfaz o gate", async () => {
    const f = await fixtureGoal();
    try {
      await f.engine.addGoalEvidence({
        flow_id: f.flowId, title: "npm run check", content: "pass", satisfies: ["npm run check"]
      } as never);
      await reachImplementacao(f);
      await f.engine.goalAdvance({
        flow_id: f.flowId,
        provided: { implementation_done: true, changed_files: ["src/a.ts"] }
      });
      const advance = (await f.engine.goalAdvance({
        flow_id: f.flowId,
        provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["diff revisado"] }
      })) as Record<string, unknown>;
      expect(advance.advanced).toBe(true);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("F5 (cenario D): gate de revisao stale apos changed_files invalida", () => {
  it("gate revisao passed + novo arquivo em changed_files bloqueia o avanço sem nova revisao", async () => {
    const f = await fixtureGoal();
    try {
      await f.engine.addGoalEvidence({
        flow_id: f.flowId, title: "npm run check", content: "pass", satisfies: ["npm run check"]
      } as never);
      await reachImplementacao(f);
      await f.engine.goalAdvance({
        flow_id: f.flowId,
        provided: { implementation_done: true, changed_files: ["src/a.ts"] }
      }); // -> revisao
      // Passa o gate de revisao SEM avancar (goal_gate_check persiste passed).
      const gate = (await f.engine.goalGateCheck({
        flow_id: f.flowId, phase: "revisao",
        provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] }
      } as never)) as Record<string, unknown>;
      expect(gate.status).toBe("passed");
      // Novo arquivo entra DEPOIS do gate passado (fase anterior atualiza fatos).
      await f.engine.updateFlowFacts(f.flowId, { changed_files: ["src/a.ts", "src/new-after-review.ts"] });
      const advance = (await f.engine.goalAdvance({ flow_id: f.flowId })) as Record<string, unknown>;
      expect(advance.advanced).not.toBe(true);
      expect(await phaseOf(f)).toBe("revisao");
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });

  it("nao-regressao: gate passed com snapshot identico continua reutilizavel", async () => {
    const f = await fixtureGoal();
    try {
      await f.engine.addGoalEvidence({
        flow_id: f.flowId, title: "npm run check", content: "pass", satisfies: ["npm run check"]
      } as never);
      await reachImplementacao(f);
      await f.engine.goalAdvance({
        flow_id: f.flowId,
        provided: { implementation_done: true, changed_files: ["src/a.ts"] }
      }); // -> revisao
      const gate = (await f.engine.goalGateCheck({
        flow_id: f.flowId, phase: "revisao",
        provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] }
      } as never)) as Record<string, unknown>;
      expect(gate.status).toBe("passed");
      const reused = (await f.engine.goalAdvance({ flow_id: f.flowId })) as Record<string, unknown>;
      expect(reused.advanced).toBe(true);
      expect(await phaseOf(f)).toBe("validacao");
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });
});
