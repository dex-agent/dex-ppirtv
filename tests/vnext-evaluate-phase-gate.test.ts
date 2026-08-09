import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  evaluatePhaseGate,
  evaluatePhaseGateWithHistory,
  type PhaseGateHistoryPort,
  type PhaseGateSnapshot
} from "../src/vnext/phase-gate/evaluate-phase-gate.js";
import { normalizeLegacyPhaseGate } from "../src/vnext/phase-gate/legacy-preflight-normalizer.js";

describe("EvaluatePhaseGate vNext", () => {
  it("matches the normalized legacy happy path", () => {
    const snapshot = gateSnapshot();
    const legacy = normalizeLegacyPhaseGate({
      phase: "pensamentos",
      status: "passed",
      missing: [],
      phase_blockers: [],
      closure_blockers: ["review_required"],
      phase_advance_allowed: true,
      next_required_action: { tool: "goal_advance", provided: {} }
    });

    expect(compatibilityDecision(evaluatePhaseGate(snapshot))).toEqual(legacy);
  });

  it("matches missing requirements and future preview semantics", () => {
    const missing = evaluatePhaseGate(gateSnapshot({
      requirements: [requirement("context", false), requirement("risks", false)]
    }));
    const future = evaluatePhaseGate(gateSnapshot({
      phase: "planejamento",
      current_phase: "pensamentos"
    }));

    expect(compatibilityDecision(missing)).toEqual(normalizeLegacyPhaseGate({
      phase: "pensamentos",
      status: "blocked",
      missing: ["context", "risks"],
      phase_blockers: ["context", "risks"],
      closure_blockers: ["review_required"],
      phase_advance_allowed: false,
      next_required_action: { tool: "goal_advance", missing: ["context", "risks"] }
    }));
    expect(future.next_required_action).toEqual({
      type: "preview_future_phase",
      executable: false,
      current_phase: "pensamentos"
    });
  });

  it("blocks a fully satisfied terminal phase while a closure blocker remains", () => {
    const result = evaluatePhaseGate(gateSnapshot({
      phase: "validacao",
      current_phase: "validacao",
      has_next_phase: false,
      requirements: [requirement("verdict", true), requirement("next_step", true)],
      closure_blockers: ["memory_required_but_empty"]
    }));

    expect(result).toMatchObject({
      passed: true,
      missing: [],
      blockers: ["memory_required_but_empty"],
      closure_blockers: ["memory_required_but_empty"],
      phase_advance_allowed: false,
      next_required_action: { tool: "goal_advance", provided: {} }
    });
  });

  it("is deterministic and does not mutate its snapshot", () => {
    const snapshot = gateSnapshot({
      requirements: [requirement("context", false)],
      provided: { risks: ["known"] }
    });
    const before = structuredClone(snapshot);

    expect(evaluatePhaseGate(snapshot)).toEqual(evaluatePhaseGate(snapshot));
    expect(snapshot).toEqual(before);
  });

  it("does not expose nested provided references through its decision", () => {
    const snapshot = gateSnapshot({ provided: { risks: ["known"] } });
    const result = evaluatePhaseGate(snapshot);
    const provided = (result.next_required_action as { provided: { risks: string[] } }).provided;

    provided.risks.push("mutated outside");

    expect(snapshot.provided).toEqual({ risks: ["known"] });
  });

  it("escalates an unchanged repeated action instead of repeating it", () => {
    const result = evaluatePhaseGate(gateSnapshot({
      requirements: [requirement("context", false)],
      action_signature: "pensamentos:context",
      attempt_count: 2,
      before_fingerprint: "sha256:same",
      after_fingerprint: "sha256:same",
      required_proof: ["context"]
    }));

    expect(result.classification).toBe("extension");
    expect(result.next_required_action).toEqual({
      type: "resolve_repeated_gate_failure",
      executable: false,
      owner: "executor_orchestrator",
      action_signature: "pensamentos:context",
      attempt_count: 2,
      required_proof: ["context"]
    });
  });

  it("resets the repeated-action extension when the fingerprint changes", () => {
    const result = evaluatePhaseGate(gateSnapshot({
      requirements: [requirement("context", false)],
      action_signature: "pensamentos:context",
      attempt_count: 2,
      before_fingerprint: "sha256:before",
      after_fingerprint: "sha256:after",
      required_proof: ["context"]
    }));

    expect(result.classification).toBe("compatibility");
    expect(result.attempt_count).toBe(1);
    expect(result.next_required_action).toEqual({ tool: "goal_advance", missing: ["context"] });
  });

  it("resets history when the required proof changes", async () => {
    const port: PhaseGateHistoryPort = {
      load: async () => ({
        action_signature: "pensamentos:context",
        attempt_count: 4,
        after_fingerprint: "sha256:same",
        required_proof: ["context"]
      })
    };

    const result = await evaluatePhaseGateWithHistory(gateSnapshot({
      requirements: [requirement("context", false), requirement("risks", false)],
      action_signature: "pensamentos:context",
      attempt_count: 4,
      before_fingerprint: "sha256:same",
      after_fingerprint: "sha256:same",
      required_proof: ["context", "risks"]
    }), port);

    expect(result.classification).toBe("compatibility");
    expect(result.attempt_count).toBe(1);
    expect(result.next_required_action).toEqual({ tool: "goal_advance", missing: ["context", "risks"] });
  });

  it("loads a serialized previous summary through a new read-only port after restart", async () => {
    const calls: string[] = [];
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-vnext-history-"));
    const summaryPath = path.join(runtimeRoot, "phase-gate-history.json");
    await writeFile(summaryPath, JSON.stringify({
      action_signature: "pensamentos:context",
      attempt_count: 1,
      after_fingerprint: "sha256:same",
      required_proof: ["context"]
    }), "utf8");
    const restartedPort: PhaseGateHistoryPort = {
      load: async (actionSignature) => {
        calls.push(actionSignature);
        return JSON.parse(await readFile(summaryPath, "utf8"));
      }
    };

    try {
      const result = await evaluatePhaseGateWithHistory(gateSnapshot({
        requirements: [requirement("context", false)],
        action_signature: "pensamentos:context",
        attempt_count: 1,
        before_fingerprint: "sha256:same",
        after_fingerprint: "sha256:same",
        required_proof: ["context"]
      }), restartedPort);

      expect(calls).toEqual(["pensamentos:context"]);
      expect(result.attempt_count).toBe(2);
      expect(result.next_required_action).toMatchObject({
        type: "resolve_repeated_gate_failure",
        executable: false
      });
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("treats missing history and missing fingerprints as an unproven first attempt", async () => {
    const noHistory: PhaseGateHistoryPort = { load: async () => null };
    const missingFingerprints: PhaseGateHistoryPort = {
      load: async () => ({
        action_signature: "pensamentos:context",
        attempt_count: 8,
        after_fingerprint: null,
        required_proof: ["context"]
      })
    };
    const staleSnapshot = gateSnapshot({
      requirements: [requirement("context", false)],
      action_signature: "pensamentos:context",
      attempt_count: 8,
      before_fingerprint: null,
      after_fingerprint: null,
      required_proof: ["context"]
    });

    await expect(evaluatePhaseGateWithHistory(staleSnapshot, noHistory)).resolves.toMatchObject({
      classification: "compatibility",
      attempt_count: 1,
      next_required_action: { tool: "goal_advance", missing: ["context"] }
    });
    await expect(evaluatePhaseGateWithHistory(staleSnapshot, missingFingerprints)).resolves.toMatchObject({
      classification: "compatibility",
      attempt_count: 1,
      next_required_action: { tool: "goal_advance", missing: ["context"] }
    });
  });

  it("uses a stable copy even if the caller mutates the snapshot while history loads", async () => {
    let releaseHistory!: () => void;
    const loading = new Promise<void>((resolve) => { releaseHistory = resolve; });
    const snapshot = gateSnapshot({
      requirements: [requirement("context", false)],
      action_signature: "pensamentos:context",
      before_fingerprint: "sha256:same",
      after_fingerprint: "sha256:same",
      required_proof: ["context"]
    });
    const port: PhaseGateHistoryPort = {
      load: async () => {
        await loading;
        return {
          action_signature: "pensamentos:context",
          attempt_count: 1,
          after_fingerprint: "sha256:same",
          required_proof: ["context"]
        };
      }
    };

    const pending = evaluatePhaseGateWithHistory(snapshot, port);
    (snapshot as { action_signature: string }).action_signature = "mutated";
    (snapshot.requirements as Array<{ satisfied: boolean }>)[0].satisfied = true;
    releaseHistory();

    await expect(pending).resolves.toMatchObject({
      action_signature: "pensamentos:context",
      passed: false,
      attempt_count: 2
    });
  });
});

function gateSnapshot(patch: Partial<PhaseGateSnapshot> = {}): PhaseGateSnapshot {
  return {
    phase: "pensamentos",
    current_phase: "pensamentos",
    has_next_phase: true,
    requirements: [requirement("goal", true)],
    closure_blockers: ["review_required"],
    provided: {},
    action_signature: "pensamentos:passed",
    attempt_count: 1,
    before_fingerprint: "sha256:initial",
    after_fingerprint: "sha256:initial",
    required_proof: [],
    ...patch
  };
}

function requirement(key: string, satisfied: boolean) {
  return {
    key,
    satisfied
  };
}

function compatibilityDecision(result: ReturnType<typeof evaluatePhaseGate>) {
  return {
    phase: result.phase,
    status: result.passed ? "passed" : "blocked",
    missing: result.missing,
    blockers: result.blockers,
    phase_blockers: result.missing,
    closure_blockers: result.closure_blockers,
    phase_advance_allowed: result.phase_advance_allowed,
    next_required_action: result.next_required_action
  };
}
