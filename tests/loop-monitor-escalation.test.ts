import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TEST_ENV_KEYS,
  createFixtureEngine,
  disposeFixtureEngine,
  currentImplementationFingerprint,
  expectFiscalBlock,
  restoreEnvSnapshot,
  snapshotEnv,
  startGoalWithEvidence
} from "./review-loop-helpers.js";
import type { FlowEngine } from "../src/flow-engine.js";

// T-3 (parte fiscal) do SPT review-gate-loop-proof: RED com o CICLO REAL do
// incidente 2026-10-17 — evidence_add de review INVALIDA intercalada com
// re-checagem que emite fiscal_policy_blocked (goal_verdict e o unico
// emissor; goal_status NAO persiste evento fiscal). Com o fix, evidencia de
// review invalida deixa de contar como progresso: o ciclo acumula count e
// dispara a escada existente (6 = research_subagent). Hoje cada evidence_
// attached zera a janela e o count fica 1 — o fiscal anestesiado do incidente.

let tempRoot: string;
let engine: FlowEngine;
let originalTestEnv: Record<string, string | undefined>;

beforeEach(async () => {
  ({ tempRoot, engine } = await createFixtureEngine());
  originalTestEnv = snapshotEnv(TEST_ENV_KEYS);
  for (const key of TEST_ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(async () => {
  restoreEnvSnapshot(originalTestEnv);
  await disposeFixtureEngine(tempRoot);
});

describe("T-3 fiscal sao: ciclo do incidente acumula count e escala", () => {
  it("7 ciclos de review invalida + re-checagem bloqueada levam count a >= 6 com escalonamento research_subagent", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      engine,
      tempRoot,
      "t3-ciclo-incidente",
      "Ciclo do incidente escala o fiscal"
    );
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });

    for (let cycle = 0; cycle < 7; cycle += 1) {
      await engine.addGoalEvidence({
        flow_id: flowId,
        kind: "code_review",
        title: `Revisao invalida ${cycle + 1} (forma aninhada do incidente)`,
        satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
        observed_result: {
          diff_reviewed: { true: true, reviewed_targets: ["src/flow-engine.ts"] },
          barata_scan: { true: true, searched_patterns: ["padrao"] },
          findings: { F1: "achado" },
          regression_risks: { R1: "risco" }
        },
        scope_classification: "target",
        scope_reference: "src/flow-engine.ts",
        reviewed_implementation_fingerprint: await currentImplementationFingerprint(engine, flowId)
      });
      await expectFiscalBlock(engine, flowId, evidenceId);
    }

    const status = await engine.goalStatus({ flow_id: flowId });
    expect(status.loop_monitor).toMatchObject({
      count: expect.any(Number)
    });
    expect((status.loop_monitor?.count ?? 0) >= 6).toBe(true);
    expect(status.loop_monitor?.escalation).toMatchObject({ active: true, level: "research_subagent" });
  });

  it("a invalida NAO resolve review_required (blocker persiste no ciclo)", async () => {
    const { flowId } = await startGoalWithEvidence(
      engine,
      tempRoot,
      "t3-invalida-persiste",
      "Review invalida nao resolve blocker"
    );
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });

    await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Revisao invalida unica",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: { true: true },
        barata_scan: { true: true },
        findings: {},
        regression_risks: {}
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(engine, flowId)
    });

    const status = await engine.goalStatus({ flow_id: flowId });
    expect(status.blockers).toContain("review_required");
  });
});
