import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import {
  evaluatePhaseGate,
  type PhaseGateRequirementSnapshot
} from "../src/vnext/phase-gate/evaluate-phase-gate.js";
import { normalizeLegacyPhaseGate } from "../src/vnext/phase-gate/legacy-preflight-normalizer.js";

let runtimeRoot: string;
let engine: FlowEngine;

beforeEach(async () => {
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-vnext-gate-baseline-"));
  engine = new FlowEngine(new PpirtvStore(runtimeRoot, { fixtureOnlyNoncanonicalRoot: true }));
});

afterEach(async () => {
  if (runtimeRoot.startsWith(os.tmpdir())) {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

describe("EvaluatePhaseGate legacy oracle baseline", () => {
  it("captures a passed full thoughts gate", async () => {
    const flow = await officialFixture({
      goal: "Map full gate",
      context: "Known context",
      risks: ["Known risk"],
      uncertainties: ["Known uncertainty"]
    });

    const preflight = await engine.goalGatePreflight({ flow_id: flow.flow_id, phase: "pensamentos" });

    expect(semanticPreflight(preflight)).toEqual({
      phase: "pensamentos",
      status: "passed",
      missing: [],
      phase_blockers: [],
      phase_advance_allowed: true,
      next_required_action: { tool: "goal_advance", provided: {} }
    });
    expect(sideBySideDecision(preflight, "pensamentos", true, [
      requirement("goal", true),
      requirement("context", true),
      requirement("risks", true),
      requirement("uncertainties", true)
    ])).toEqual(normalizeLegacyPhaseGate(preflight));
  });

  it("captures a passed compact conception gate", async () => {
    const flow = await officialFixture({
      goal: "Map compact gate",
      context: "Known context",
      risks: ["Known risk"]
    });
    flow.mode = "compact";
    flow.phase = "concepcao";
    flow.scope.in = ["src/vnext/"];
    flow.tasks = ["Evaluate gate"];
    flow.done_criteria = ["Semantic equivalence"];
    await engine.store.saveFlow(flow);

    const preflight = await engine.goalGatePreflight({ flow_id: flow.flow_id, phase: "concepcao" });

    expect(semanticPreflight(preflight)).toEqual({
      phase: "concepcao",
      status: "passed",
      missing: [],
      phase_blockers: [],
      phase_advance_allowed: true,
      next_required_action: { tool: "goal_advance", provided: {} }
    });
    expect(sideBySideDecision(preflight, "concepcao", true, [
      requirement("goal", true),
      requirement("context", true),
      requirement("risks", true),
      requirement("scope_in", true),
      requirement("tasks", true),
      requirement("done_criteria", true)
    ])).toEqual(normalizeLegacyPhaseGate(preflight));
  });

  it("captures missing requirements and a future-phase preview", async () => {
    const flow = await officialFixture({ goal: "Map blocked gate" });

    const blocked = await engine.goalGatePreflight({ flow_id: flow.flow_id, phase: "pensamentos" });
    const future = await engine.goalGatePreflight({ flow_id: flow.flow_id, phase: "planejamento" });

    expect(semanticPreflight(blocked)).toEqual({
      phase: "pensamentos",
      status: "blocked",
      missing: ["context", "risks", "uncertainties"],
      phase_blockers: ["context", "risks", "uncertainties"],
      phase_advance_allowed: false,
      next_required_action: { tool: "goal_advance", missing: ["context", "risks", "uncertainties"] }
    });
    expect(future.next_required_action).toEqual({
      type: "preview_future_phase",
      executable: false,
      current_phase: "pensamentos"
    });
    expect(sideBySideDecision(blocked, "pensamentos", true, [
      requirement("goal", true),
      requirement("context", false),
      requirement("risks", false),
      requirement("uncertainties", false)
    ])).toEqual(normalizeLegacyPhaseGate(blocked));
  });

  it("keeps preflight and status read-only while exposing closure blockers", async () => {
    const flow = await officialFixture({
      goal: "Map closure blockers",
      context: "Known context",
      risks: ["sem memoria L1/L2 gerada pelo motor"],
      uncertainties: ["Known uncertainty"]
    });
    flow.changed_files = ["src/vnext/phase-gate/evaluate-phase-gate.ts"];
    flow.scope.in = ["src/vnext/phase-gate/evaluate-phase-gate.ts"];
    await engine.store.saveFlow(flow);
    await mkdir(path.dirname(engine.store.ledgerPath), { recursive: true });
    const beforeFlow = await readFile(engine.store.flowPath(flow.flow_id), "utf8");
    const beforeLedger = await readFile(engine.store.ledgerPath, "utf8");

    const preflight = await engine.goalGatePreflight({ flow_id: flow.flow_id, phase: "pensamentos" });
    const status = await engine.goalStatus({ flow_id: flow.flow_id, detail: "lean" });

    expect(preflight.closure_blockers).toEqual(
      expect.arrayContaining(["memory_required_but_empty", "review_required"])
    );
    expect(status.closure_blockers).toEqual(
      expect.arrayContaining(["memory_required_but_empty", "review_required"])
    );
    expect(sideBySideDecision(preflight, "pensamentos", true, [
      requirement("goal", true),
      requirement("context", true),
      requirement("risks", true),
      requirement("uncertainties", true)
    ])).toEqual(normalizeLegacyPhaseGate(preflight));
    expect(await readFile(engine.store.flowPath(flow.flow_id), "utf8")).toBe(beforeFlow);
    expect(await readFile(engine.store.ledgerPath, "utf8")).toBe(beforeLedger);
  });

  it("blocks terminal advancement when closure blockers remain", async () => {
    const flow = await officialFixture({
      goal: "Map terminal closure blockers",
      context: "Known context",
      risks: ["sem memoria L1/L2 gerada pelo motor"],
      uncertainties: ["Known uncertainty"]
    });
    flow.phase = "validacao";
    await engine.store.saveFlow(flow);

    const preflight = await engine.goalGatePreflight({ flow_id: flow.flow_id, phase: "validacao" });
    const legacy = normalizeLegacyPhaseGate(preflight);
    const comparison = sideBySideDecision(preflight, "validacao", false, [
      requirement("verdict", false),
      requirement("residual_risks", false),
      requirement("next_step", false),
      requirement("memoria_viva_reconciled", false)
    ]);

    expect(legacy.closure_blockers).toEqual(expect.arrayContaining(["memory_required_but_empty"]));
    expect(legacy.phase_advance_allowed).toBe(false);
    expect(comparison).toEqual(legacy);
  });

  it("measures the core and oracle in separate blocks without a product speed verdict", async () => {
    const flow = await officialFixture({
      goal: "Measure isolated gate cost",
      context: "Known context",
      risks: ["Known risk"],
      uncertainties: ["Known uncertainty"]
    });
    const coreSnapshot = {
      phase: "pensamentos",
      current_phase: "pensamentos",
      has_next_phase: true,
      requirements: [
        requirement("goal", true),
        requirement("context", true),
        requirement("risks", true),
        requirement("uncertainties", true)
      ],
      closure_blockers: [] as string[],
      provided: {},
      action_signature: "pensamentos:passed",
      attempt_count: 1,
      before_fingerprint: null,
      after_fingerprint: null,
      required_proof: [] as string[]
    };
    const coreSamples = 10_000;
    const oracleSamples = 20;

    const coreStartedAt = performance.now();
    for (let index = 0; index < coreSamples; index += 1) {
      evaluatePhaseGate(coreSnapshot);
    }
    const coreDurationMs = performance.now() - coreStartedAt;

    const oracleStartedAt = performance.now();
    for (let index = 0; index < oracleSamples; index += 1) {
      await engine.goalGatePreflight({ flow_id: flow.flow_id, phase: "pensamentos" });
    }
    const oracleDurationMs = performance.now() - oracleStartedAt;

    const measurement = {
      core: { samples: coreSamples, duration_ms: coreDurationMs },
      oracle: { samples: oracleSamples, duration_ms: oracleDurationMs },
      limits: [
        "different sample counts; no direct speed ratio",
        "local in-memory fixture; excludes MCP host, queue, model and transport",
        "measurement is not evidence of product latency improvement"
      ]
    };
    console.info("[vnext-phase-gate-measurement]", JSON.stringify(measurement));

    expect(measurement.core).toMatchObject({ samples: coreSamples });
    expect(measurement.oracle).toMatchObject({ samples: oracleSamples });
    expect(coreDurationMs).toBeGreaterThan(0);
    expect(oracleDurationMs).toBeGreaterThan(0);
  });
});

async function officialFixture(input: {
  goal: string;
  context?: string;
  risks?: string[];
  uncertainties?: string[];
}): Promise<Flow> {
  const flow = await engine.createFlow(input);
  const workspace = path.join(runtimeRoot, "workspace", flow.flow_id);
  flow.goal_binding = {
    envelope: {
      workspace,
      spt_path: path.join(workspace, ".agents", "PLAN-TASKS", "fixture.md"),
      objective: flow.goal,
      idempotency_key: `baseline:${flow.flow_id}`,
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "vnext-baseline"
    },
    started_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  };
  await engine.store.saveFlow(flow);
  return flow;
}

function semanticPreflight(value: Record<string, unknown>): Record<string, unknown> {
  return {
    phase: value.phase,
    status: value.status,
    missing: value.missing,
    phase_blockers: value.phase_blockers,
    phase_advance_allowed: value.phase_advance_allowed,
    next_required_action: value.next_required_action
  };
}

function sideBySideDecision(
  legacy: Record<string, unknown>,
  currentPhase: string,
  hasNextPhase: boolean,
  requirements: PhaseGateRequirementSnapshot[]
) {
  const result = evaluatePhaseGate({
    phase: String(legacy.phase),
    current_phase: currentPhase,
    has_next_phase: hasNextPhase,
    requirements,
    closure_blockers: legacy.closure_blockers as string[],
    provided: {},
    action_signature: `${String(legacy.phase)}:${requirements.filter((item) => !item.satisfied).map((item) => item.key).join("|") || "passed"}`,
    attempt_count: 1,
    before_fingerprint: null,
    after_fingerprint: null,
    required_proof: requirements.filter((item) => !item.satisfied).map((item) => item.key)
  });
  return {
    phase: result.phase,
    status: result.passed ? "passed" as const : "blocked" as const,
    missing: result.missing,
    blockers: result.blockers,
    phase_blockers: result.missing,
    closure_blockers: result.closure_blockers,
    phase_advance_allowed: result.phase_advance_allowed,
    next_required_action: result.next_required_action
  };
}

function requirement(key: string, satisfied: boolean): PhaseGateRequirementSnapshot {
  return {
    key,
    satisfied
  };
}
