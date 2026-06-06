import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-goal-fiscal-"));
  engine = new FlowEngine(new PpirtvStore(tempRoot));
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("GOAL fiscal canonical verdict boundary", () => {
  it("blocks official GOAL validation when provided verdict text is not canonical", async () => {
    const flow = await createOfficialValidationFlow("official-provided-verdict");

    const gate = await engine.goalGateCheck({
      flow_id: flow.flow_id,
      phase: "validacao",
      provided: validationProvidedVerdict()
    });
    const advanced = await engine.goalAdvance({ flow_id: flow.flow_id });
    const checkout = await engine.goalCheckout({ flow_id: flow.flow_id });
    const ledgerTypes = await ledgerEventTypes(flow.flow_id);

    expect(gate).toMatchObject({
      status: "blocked",
      missing: ["verdict"]
    });
    expect(advanced).toMatchObject({
      advanced: false,
      blocked: true,
      status: "blocked",
      missing: ["verdict"],
      status_snapshot: {
        phase: "validacao",
        current_verdict: null,
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict",
          can_retry_verdict: true
        }
      }
    });
    expect(checkout).toMatchObject({
      status: "blocked",
      phase: "validacao",
      blockers: ["verdict"],
      complete: false,
      verdict: null,
      resolution_guidance: {
        blockers: ["verdict"],
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict"
        }
      }
    });
    expect(ledgerTypes).not.toContain("verdict_recorded");
    expect(ledgerTypes).not.toContain("flow_completed");
  });

  it("keeps goal_status, goal_advance and ppirtv_checkout coherent for a stale official validation gate", async () => {
    const flow = await createOfficialValidationFlow("official-stale-gate");
    flow.gates.validacao = {
      phase: "validacao",
      status: "passed",
      checked_at: new Date().toISOString(),
      provided: validationProvidedVerdict(),
      missing: [],
      next: "advance_to_complete",
      back_to: null
    };
    await engine.store.saveFlow(flow);

    const before = await engine.goalStatus({ flow_id: flow.flow_id });
    const advanced = await engine.goalAdvance({ flow_id: flow.flow_id });
    const checkout = await engine.goalCheckout({ flow_id: flow.flow_id });
    const ledgerTypes = await ledgerEventTypes(flow.flow_id);

    expect(before).toMatchObject({
      status: "active",
      phase: "validacao",
      blockers: ["verdict"],
      current_verdict: null,
      next_required_action: {
        type: "goal_verdict_required",
        tool: "goal_verdict",
        can_retry_verdict: true
      }
    });
    expect(advanced).toMatchObject({
      advanced: false,
      blocked: true,
      status: "blocked",
      missing: ["verdict"],
      status_snapshot: {
        status: "blocked",
        phase: "validacao",
        blockers: ["verdict"],
        current_verdict: null,
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict",
          can_retry_verdict: true
        }
      }
    });
    expect(checkout).toMatchObject({
      status: "blocked",
      phase: "validacao",
      blockers: ["verdict"],
      complete: false,
      verdict: null,
      resolution_guidance: {
        blockers: ["verdict"],
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict"
        }
      }
    });
    expect(ledgerTypes).not.toContain("verdict_recorded");
    expect(ledgerTypes).not.toContain("flow_completed");
  });

  it("keeps goal_verdict_required visible when validation has verdict and another blocker", async () => {
    const flow = await createOfficialValidationFlow("official-verdict-plus-clean-house");

    const gate = await engine.goalGateCheck({
      flow_id: flow.flow_id,
      phase: "validacao",
      provided: {
        verdict: "pronto_com_ressalvas",
        residual_risks: ["veredito canonico pendente"],
        next_step: "chamar goal_verdict antes de completar"
      }
    });
    const status = await engine.goalStatus({ flow_id: flow.flow_id });

    expect(gate).toMatchObject({
      status: "blocked",
      missing: expect.arrayContaining(["verdict", "clean_house"])
    });
    expect(status).toMatchObject({
      status: "blocked",
      phase: "validacao",
      blockers: expect.arrayContaining(["verdict", "clean_house"]),
      current_verdict: null,
      next_required_action: {
        type: "goal_verdict_required",
        tool: "goal_verdict",
        other_blockers: ["clean_house"]
      }
    });
  });

  it("preserves legacy manual flow compatibility without goal_binding", async () => {
    const flow = await createLegacyValidationFlow("legacy-manual-flow");

    const gate = await engine.checkGate({
      flow_id: flow.flow_id,
      phase: "validacao",
      provided: validationProvidedVerdict()
    });
    const advanced = await engine.advance({ flow_id: flow.flow_id });
    const status = await engine.status(flow.flow_id);
    const ledgerTypes = await ledgerEventTypes(flow.flow_id);

    expect(gate).toMatchObject({
      status: "passed",
      missing: [],
      next: "advance_to_complete"
    });
    expect(advanced).toMatchObject({
      advanced: true,
      from: "validacao",
      to: null,
      status: "complete"
    });
    expect(status).toMatchObject({
      status: "complete",
      phase: "validacao"
    });
    expect(ledgerTypes).toContain("flow_completed");
    expect(ledgerTypes).not.toContain("verdict_recorded");
  });
});

async function createOfficialValidationFlow(idempotencyKey: string): Promise<Flow> {
  const flow = await engine.createFlow({
    goal: `Official fiscal boundary ${idempotencyKey}`,
    context: "ctx",
    risks: ["baixo"],
    uncertainties: ["nenhuma"]
  });
  flow.goal_binding = {
    envelope: {
      workspace: path.join(tempRoot, idempotencyKey),
      spt_path: path.join(tempRoot, idempotencyKey, ".agents", "PLAN-TASKS", `${idempotencyKey}.md`),
      objective: flow.goal,
      idempotency_key: `dex-ppirtv:${idempotencyKey}`,
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "codex-test"
    },
    started_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  };
  flow.phase = "validacao";
  await engine.store.saveFlow(flow);
  return flow;
}

async function createLegacyValidationFlow(goal: string): Promise<Flow> {
  const flow = await engine.createFlow({
    goal,
    context: "ctx",
    risks: ["baixo"],
    uncertainties: ["nenhuma"]
  });
  flow.phase = "validacao";
  await engine.store.saveFlow(flow);
  return flow;
}

function validationProvidedVerdict(): Record<string, unknown> {
  return {
    verdict: "pronto_com_ressalvas",
    residual_risks: ["veredito canonico pendente"],
    next_step: "chamar goal_verdict antes de completar",
    clean_house: true
  };
}

async function ledgerEventTypes(flowId: string): Promise<string[]> {
  const ledger = await engine.store.readLedger(flowId);
  return ledger.map((event) => event.type);
}
