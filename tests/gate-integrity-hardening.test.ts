import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { restoreEnvSnapshot, snapshotEnv, TEST_ENV_KEYS } from "./review-loop-helpers.js";

// SPT gate-integrity-hardening (T-1): RED triplo do laudo adversarial
// .agents/REVIEWS/2026-10-17-laudo-gate-integrity-hardening.md — F1 (strings
// negativas como prova), F2 (retorno cross-profile), F3 (mechanical sem
// corroboracao por changed_files). Bootstrap espelha tests/review-loop-helpers.ts.
//
// Escada de fases (cada goalAdvance satisfaz o gate da fase CORRENTE):
// full: pensamentos ->(1) planejamento ->(2) implementacao ->(3) revisao ->(4) teste ->(5) validacao
// compact: concepcao ->(1) implementacao ->(2) revisao ->(3) validacao

const envSnapshot = snapshotEnv(TEST_ENV_KEYS);

function fakeSpt(workspace: string): string {
  return [
    "---", "dex_contract: spt", "version: 2", "status: EM_TESTE", "owner: Teste",
    "date: '2026-05-24'", `workspace: ${JSON.stringify(workspace)}`, "origin: teste",
    "goal:", "  id: fake-goal-spt", "  title: Fake GOAL SPT",
    "  objective: Objetivo de teste do gate integrity", "context: Teste local.",
    "problem: Garantir campos normalizados.", "decision: SPT v2 de teste.",
    "scope:", "  include:", "    - Validar SPT local.", "  exclude:", "    - Externo.",
    "spec: Ponte GOAL/SPT com evidencia rastreavel.", "plan:", "  - Validar SPT.",
    "tasks:", "  - Rodar teste local.", "expected_evidence:", "  - npm run check.",
    "done_criteria:", "  - npm run check.", "risks:", "  - Falso pronto.",
    "uncertainties:", "  - nenhuma.", "gates:", "  - preenchidos.",
    "validation:", "  - npm run check.", "execution_prompt: |", "  /GOAL", "---", "# t", ""
  ].join("\n");
}

async function fixtureGoal(mode: "full" | "compact", riskLevel?: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gate-integrity-"));
  const engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
  const workspace = path.join(tempRoot, "ws");
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-05-24-fake-goal-spt.md");
  await writeFile(sptPath, fakeSpt(workspace), "utf8");
  for (const rel of ["src/a.ts", "docs/note.md"]) {
    const target = path.join(workspace, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `fixture:${rel}\n`, "utf8");
  }
  const started = (await engine.startGoal({
    workspace, spt_path: sptPath, objective: "Objetivo de teste do gate integrity",
    idempotency_key: `gi-${mode}-${Math.random().toString(36).slice(2, 8)}`,
    evidence_required: true, required_evidence: ["npm run check"],
    requested_verdict_policy: "evidence_required", source: "dex-code", mode,
    risk_level: riskLevel
  } as never)) as Record<string, unknown>;
  const flowId = String(started.flow_id);
  const evidence = (await engine.addGoalEvidence({
    flow_id: flowId, title: "npm run check", content: "pass", satisfies: ["npm run check"]
  } as never)) as Record<string, unknown>;
  return { engine, tempRoot, flowId, evidenceId: String(evidence.evidence_id) };
}

type Fixture = ReturnType<typeof fixtureGoal> extends Promise<infer T> ? T : never;
type Phase = "pensamentos" | "planejamento" | "implementacao" | "revisao" | "teste" | "validacao";

const IMPL_KEYS = { implementation_done: true, changed_files: ["src/a.ts"] };
const REVISAO_KEYS = { diff_reviewed: true, barata_scan: true, regression_risks: ["r1"], review_findings: ["linter ok"] };

async function phaseOf(f: Fixture): Promise<string> {
  const status = (await f.engine.goalStatus({ flow_id: f.flowId, detail: "lean" })) as Record<string, unknown>;
  return String(status.phase);
}

// Avanca fases com provided valido ate estar EM target (nao avanca a partir dela).
async function reachPhase(f: Fixture, target: Phase): Promise<void> {
  for (let guard = 0; guard < 8; guard += 1) {
    const current = await phaseOf(f);
    if (current === target) return;
    const provided =
      current === "implementacao" ? IMPL_KEYS
      : current === "revisao" ? REVISAO_KEYS
      : current === "teste" ? { test_executed: true }
      : {};
    const advance = (await f.engine.goalAdvance({ flow_id: f.flowId, provided })) as Record<string, unknown>;
    if (advance.advanced !== true) {
      throw new Error(`reachPhase(${target}) travou em ${current}: ${JSON.stringify(advance.missing)}`);
    }
  }
  throw new Error(`reachPhase(${target}) nao convergiu`);
}

async function blockedMissing(f: Fixture, provided: Record<string, unknown>): Promise<unknown[]> {
  const advance = (await f.engine.goalAdvance({ flow_id: f.flowId, provided })) as Record<string, unknown>;
  expect(advance.advanced).not.toBe(true);
  return ((advance.missing ?? advance.remaining_blockers ?? []) as unknown[]);
}

beforeAll(() => {
  for (const [k, v] of Object.entries(process.env)) if (v === undefined) delete process.env[k];
  restoreEnvSnapshot(envSnapshot);
});

afterAll(() => restoreEnvSnapshot(envSnapshot));

const INVALID_BOOLEAN_VALUES = ["false", "no", [], {}, 0, null, undefined] as const;

// Tabela F1 do laudo (secao 17): requisito x valor — todos rejeitados;
// cada requisito exercido na fase que o exige.
const F1_CASES = [
  { requirement: "implementation_done", phase: "implementacao" as Phase, extra: { changed_files: ["src/a.ts"] } },
  { requirement: "diff_reviewed", phase: "revisao" as Phase, extra: { barata_scan: true, regression_risks: ["r1"], review_findings: ["linter ok"] } },
  { requirement: "barata_scan", phase: "revisao" as Phase, extra: { diff_reviewed: true, regression_risks: ["r1"], review_findings: ["linter ok"] } },
  { requirement: "test_executed", phase: "teste" as Phase, extra: {} },
] as const;

describe("F1: gates booleanos rejeitam valores nao-booleanos (tabela do laudo)", () => {
  it.each(F1_CASES)("requisito $requirement na fase $phase bloqueia valores invalidos", async ({ requirement, phase, extra }) => {
    const f = await fixtureGoal("full");
    try {
      await reachPhase(f, phase);
      expect(await phaseOf(f)).toBe(phase);
      for (const value of INVALID_BOOLEAN_VALUES) {
        const missing = await blockedMissing(f, { [requirement]: value, ...extra });
        expect(missing, `valor ${JSON.stringify(value)} em ${requirement}`).toContain(requirement);
      }
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { key: "implementation_done", phase: "implementacao" as Phase, provided: IMPL_KEYS },
    { key: "diff_reviewed", phase: "revisao" as Phase, provided: REVISAO_KEYS },
    { key: "barata_scan", phase: "revisao" as Phase, provided: REVISAO_KEYS },
  ] as const)("nao-regressao: $key com valor valido avanca a partir de $phase", async ({ phase, provided }) => {
    const f = await fixtureGoal("full");
    try {
      await reachPhase(f, phase);
      const advance = (await f.engine.goalAdvance({ flow_id: f.flowId, provided })) as Record<string, unknown>;
      expect(advance.advanced).toBe(true);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("F1 cenario A: goal compacto mechanical nao fecha com strings negativas", () => {
  it("bloqueia implementacao/revisao com negativas e nao chega a validacao", async () => {
    const f = await fixtureGoal("compact", "mechanical");
    try {
      await reachPhase(f, "implementacao");
      // implementacao: string negativa nao pode valer como implementation_done.
      const implMissing = await blockedMissing(f, { implementation_done: "false", changed_files: ["src/a.ts"] });
      expect(implMissing).toContain("implementation_done");
      // Passa implementacao de forma valida e tenta revisao com negativas
      // (compact: revisao exige diff_reviewed/barata_scan/test_executed).
      await f.engine.goalAdvance({ flow_id: f.flowId, provided: IMPL_KEYS });
      const revMissing = await blockedMissing(f, { diff_reviewed: "no", barata_scan: "false" });
      expect(revMissing).toContain("diff_reviewed");
      expect(revMissing).toContain("barata_scan");
      expect(await phaseOf(f)).not.toBe("validacao");
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("F2: retorno cross-profile falha fechado (cenario B do laudo)", () => {
  it("flow_return para fase full em flow compacto rejeita com erro tipado e preserva phase", async () => {
    const f = await fixtureGoal("compact");
    try {
      const before = (await f.engine.goalStatus({ flow_id: f.flowId, detail: "lean" })) as Record<string, unknown>;
      await expect(f.engine.returnTo({ flow_id: f.flowId, to: "pensamentos", reason: "probe" } as never))
        .rejects.toThrow(/phase/i);
      const after = (await f.engine.goalStatus({ flow_id: f.flowId, detail: "lean" })) as Record<string, unknown>;
      expect(after.phase).toBe(before.phase);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("F3: mechanical com arquivo de codigo exige review estruturada", () => {
  it("veredito bloqueia (review_required) quando changed_files contem src/a.ts", async () => {
    const f = await fixtureGoal("full", "mechanical");
    try {
      await reachPhase(f, "validacao");
      await expect(f.engine.goalVerdict({
        flow_id: f.flowId, status: "pronto_com_ressalvas",
        evidence_ids: [f.evidenceId],
        rationale: "probe mechanical com codigo", residual_risks: [], next_step: "x"
      } as never)).rejects.toThrow(/review_required|PPIRTV_FISCAL_BLOCKED/i);
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });

  it("doc-only mantem fast-track do mechanical (nao-regressao)", async () => {
    const f = await fixtureGoal("full", "mechanical");
    try {
      // Escada doc-only: implementacao registra apenas docs/note.md.
      for (const provided of [
        {},
        {},
        { implementation_done: true, changed_files: ["docs/note.md"] },
        REVISAO_KEYS,
        { test_executed: true },
      ]) {
        await f.engine.goalAdvance({ flow_id: f.flowId, provided });
      }
      expect(await phaseOf(f)).toBe("validacao");
      const verdict = (await f.engine.goalVerdict({
        flow_id: f.flowId, status: "pronto_com_ressalvas",
        evidence_ids: [f.evidenceId],
        rationale: "probe doc-only", residual_risks: [], next_step: "x"
      } as never)) as Record<string, unknown>;
      expect(verdict).toBeTruthy();
    } finally {
      await rm(f.tempRoot, { recursive: true, force: true });
    }
  });
});
