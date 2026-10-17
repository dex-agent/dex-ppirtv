import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TEST_ENV_KEYS,
  createFixtureEngine,
  disposeFixtureEngine,
  restoreEnvSnapshot,
  snapshotEnv,
  startGoalWithEvidence
} from "./review-loop-helpers.js";
import { reviewEvidenceDiagnostics } from "../src/gate-resolution.js";
import type { Evidence, Flow } from "../src/domain.js";
import type { FlowEngine } from "../src/flow-engine.js";

// T-4 do SPT review-gate-loop-proof: diagnostico de review classifica shape
// (nested/missing) vs conteudo (flat incompleto) SEM quebrar as strings de
// reason existentes (consumidores de string-contract intactos).

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

async function loadFlowWithChangedFiles(changedFiles: string[]): Promise<Flow> {
  const { flowId } = await startGoalWithEvidence(engine, tempRoot, "t4-shape-" + changedFiles.length, "Diagnostico de shape");
  await engine.updateFlowFacts(flowId, { changed_files: changedFiles });
  return await engine.store.loadFlow(flowId);
}

function nestedEvidence(flowId: string): Evidence {
  return {
    evidence_id: "evd_t4_nested",
    flow_id: flowId,
    kind: "code_review",
    title: "nested",
    satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
    observed_result: {
      diff_reviewed: { true: true, reviewed_targets: ["src/flow-engine.ts"] },
      barata_scan: { true: true, searched_patterns: ["x"] },
      findings: { F1: "a" },
      regression_risks: { R1: "r" }
    },
    scope_classification: "target",
    scope_reference: "src/flow-engine.ts",
    created_at: new Date().toISOString()
  } as unknown as Evidence;
}

function flatIncompleteEvidence(flowId: string): Evidence {
  return {
    evidence_id: "evd_t4_flat",
    flow_id: flowId,
    kind: "code_review",
    title: "flat incompleto",
    satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
    observed_result: {
      diff_reviewed: true,
      barata_scan: true,
      reviewed_targets: ["src/flow-engine.ts"],
      searched_patterns: ["x"],
      findings: "não é array",
      regression_risks: []
    },
    scope_classification: "target",
    scope_reference: "src/flow-engine.ts",
    created_at: new Date().toISOString()
  } as unknown as Evidence;
}

describe("T-4 diagnostico aditivo: shape vs conteudo, reasons intactos", () => {
  it("observed_result aninhado classifica shape=nested com guidance ecoando recebido vs esperado", async () => {
    const flow = await loadFlowWithChangedFiles(["src/flow-engine.ts"]);
    const diagnostics = reviewEvidenceDiagnostics(flow, nestedEvidence(flow.flow_id));
    expect(diagnostics.valid).toBe(false);
    expect(diagnostics.observed_result_shape).toBe("nested");
    expect(diagnostics.shape_guidance).toContain("flat top-level booleans");
    expect(diagnostics.reasons).toContain("diff_reviewed_not_observed");
    expect(diagnostics.reasons).toContain("barata_scan_not_observed");
  });

  it("flat incompleto classifica shape=flat com reasons de conteudo e guidance nula", async () => {
    const flow = await loadFlowWithChangedFiles(["src/flow-engine.ts"]);
    const diagnostics = reviewEvidenceDiagnostics(flow, flatIncompleteEvidence(flow.flow_id));
    expect(diagnostics.valid).toBe(false);
    expect(diagnostics.observed_result_shape).toBe("flat");
    expect(diagnostics.shape_guidance).toBeNull();
    expect(diagnostics.reasons).toContain("findings_array_required");
    expect(diagnostics.reasons).not.toContain("diff_reviewed_not_observed");
  });

  it("sem observed_result classifica shape=missing mantendo o reason historico", async () => {
    const flow = await loadFlowWithChangedFiles(["src/flow-engine.ts"]);
    const evidence = nestedEvidence(flow.flow_id) as unknown as Record<string, unknown>;
    delete evidence.observed_result;
    const diagnostics = reviewEvidenceDiagnostics(flow, evidence as unknown as Evidence);
    expect(diagnostics.observed_result_shape).toBe("missing");
    expect(diagnostics.reasons).toContain("observed_result_required");
  });
});
