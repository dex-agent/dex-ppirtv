import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TEST_ENV_KEYS,
  createFixtureEngine,
  disposeFixtureEngine,
  restoreEnvSnapshot,
  snapshotEnv,
  startGoalWithEvidence
} from "./review-loop-helpers.js";
import type { FlowEngine } from "../src/flow-engine.js";

// T-3 (parte snippet) do SPT review-gate-loop-proof: o snippet de
// required_tool_sequence do review_required ensina a forma correta COMPLETA —
// reviewed_targets com TODOS os changed_files (o snippet de 1 arquivo so foi
// o gerador do bloqueio changed_files_not_fully_reviewed no incidente),
// reviewed_implementation_fingerprint visivel e operator_must_replace
// listando reviewed_targets quando ha 2+ arquivos.

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

type SequenceStep = {
  tool?: string;
  args?: {
    observed_result?: { reviewed_targets?: string[] };
    reviewed_implementation_fingerprint?: string;
    operator_must_replace?: string[];
    content?: string;
  };
};

async function attachReviewSequence(flowId: string): Promise<SequenceStep> {
  const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });
  const action = status.next_required_action as
    | { type?: string; required_tool_sequence?: SequenceStep[] }
    | undefined;
  expect(action?.type).toBe("attach_review");
  const first = action?.required_tool_sequence?.[0];
  expect(first?.tool).toBe("evidence_add");
  return first as SequenceStep;
}

describe("T-3 snippet verdadeiro: required_tool_sequence do review_required", () => {
  it("com 2 changed_files, reviewed_targets do snippet lista TODOS (nao so o primeiro)", async () => {
    const { flowId } = await startGoalWithEvidence(engine, tempRoot, "t3-snippet-dois-arquivos", "Snippet com dois arquivos");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts", "src/server.ts"] });

    const first = await attachReviewSequence(flowId);
    expect(first.args?.observed_result?.reviewed_targets).toEqual(["src/flow-engine.ts", "src/server.ts"]);
  });

  it("snippet expoe reviewed_implementation_fingerprint com placeholder apontando goal_status", async () => {
    const { flowId } = await startGoalWithEvidence(engine, tempRoot, "t3-snippet-fingerprint", "Snippet expoe fingerprint");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });

    const first = await attachReviewSequence(flowId);
    expect(String(first.args?.reviewed_implementation_fingerprint)).toContain("goal_status");
  });

  it("com 2+ changed_files, operator_must_replace inclui observed_result.reviewed_targets; content usa prefixo <required:", async () => {
    const { flowId } = await startGoalWithEvidence(engine, tempRoot, "t3-snippet-replace", "Snippet lista o que substituir");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts", "src/server.ts"] });

    const first = await attachReviewSequence(flowId);
    expect(first.args?.operator_must_replace).toContain("observed_result.reviewed_targets");
    expect(String(first.args?.content)).toContain("<required:");
  });
});
