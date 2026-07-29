import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { fingerprintReviewedImplementation } from "../src/review-snapshot.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-meeting-outcome-"));
  engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("GOAL meeting outcomes", () => {
  it("keeps lean, compact and full review blockers reconciled after valid structured evidence", async () => {
    const { flowId } = await startGoal("meeting-outcome-review-parity");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });
    const flow = await engine.store.loadFlow(flowId);
    flow.phase = "revisao";
    await engine.store.saveFlow(flow);
    const persistedGate = await engine.goalGateCheck({
      flow_id: flowId,
      phase: "revisao",
      persist: true,
      provided: {
        diff_reviewed: true,
        barata_scan: true,
        regression_risks: ["risco de regressao"],
        changed_files: ["src/flow-engine.ts"]
      }
    });
    expect(persistedGate.status).toBe("blocked");
    expect(persistedGate.missing).toContain("review_evidence_coherent");

    await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review estruturado",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      content: "Diff e vizinhos revisados; nenhum blocker de review permanece.",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["review_required", "gate_missing"],
        findings: [],
        regression_risks: ["risco de regressao"]
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });

    for (const detail of ["lean", "compact", "full"] as const) {
      const status = await engine.goalStatus({ flow_id: flowId, detail });
      expect(status.blockers).not.toContain("review_required");
      expect(status.gate_missing).not.toContain("review_required");
      expect(status.gate_missing).not.toContain("review_evidence_coherent");
      expect(status.gate_status).toBe("passed");
      expect(status.next_required_action).not.toMatchObject({ type: "attach_review" });
    }
  });

  it("rejects blocker claims not owned by meetings and never inherits current blockers", async () => {
    const { flowId } = await startGoal("meeting-outcome-owner");
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "decisao",
      question: "Qual mecanismo resolve o review?"
    });
    const meetingId = opened.meeting_id as string;

    await expect(
      engine.goalMeetingClose({
        flow_id: flowId,
        meeting_id: meetingId,
        participants_present: [],
        decision: "Review pertence a evidence_add.",
        satisfies_blockers: ["review_required"]
      })
    ).rejects.toThrow(/MEETING_BLOCKER_NOT_OWNED.*review_required.*evidence_add/i);

    const second = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "decisao",
      question: "Fechar sem herdar blockers?"
    });
    const secondMeetingId = second.meeting_id as string;
    const flow = await engine.store.loadFlow(flowId);
    flow.history.push({
      at: new Date().toISOString(),
      type: "fiscal_policy_blocked",
      data: { blocking_reasons: ["review_required"] }
    });
    await engine.store.saveFlow(flow);

    const closed = await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: secondMeetingId,
      participants_present: [],
      decision: "Fechar sem alegar quitacao fiscal."
    });
    expect(closed.satisfies_blockers).toEqual([]);
  });

  it("freezes the first closed result", async () => {
    const { flowId } = await startGoal("meeting-outcome-immutable");
    const opened = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Congelar decisao?" });
    const meetingId = opened.meeting_id as string;
    await engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Decisao original." });
    const before = await readFile(engine.store.meetingPath(meetingId), "utf8");

    await expect(
      engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Decisao adulterada." })
    ).rejects.toThrow(/MEETING_ALREADY_CLOSED/i);
    await expect(engine.recordMeeting({ meeting_id: meetingId, decisions: ["Outra decisao"] })).rejects.toThrow(
      /MEETING_ALREADY_CLOSED/i
    );

    expect(await readFile(engine.store.meetingPath(meetingId), "utf8")).toBe(before);
  });

  it("serializes concurrent closes so exactly one immutable result wins", async () => {
    const { flowId } = await startGoal("meeting-outcome-concurrent-close");
    const opened = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Qual fechamento vence?" });
    const meetingId = opened.meeting_id as string;

    const attempts = await Promise.allSettled([
      engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Primeiro candidato." }),
      engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Segundo candidato." })
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const winner = attempts.find((attempt) => attempt.status === "fulfilled") as PromiseFulfilledResult<{ decision?: string }>;
    const persisted = await engine.store.loadMeeting(meetingId);
    expect(persisted.decision).toBe(winner.value.decision);
  });

  it("serializes different meeting closes that mutate the same flow", async () => {
    const { flowId } = await startGoal("meeting-outcome-flow-lock");
    const first = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Primeira?" });
    const second = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Segunda?" });

    const results = await Promise.all([
      engine.goalMeetingClose({ flow_id: flowId, meeting_id: first.meeting_id as string, decision: "Decisao A." }),
      engine.goalMeetingClose({ flow_id: flowId, meeting_id: second.meeting_id as string, decision: "Decisao B." })
    ]);
    expect(results).toHaveLength(2);
    const flow = await engine.store.loadFlow(flowId);
    expect(flow.decisions).toEqual(expect.arrayContaining(["Decisao A.", "Decisao B."]));
    expect(flow.history.filter((event) => event.type === "meeting_closed")).toHaveLength(2);
  });

  it("recovers the frozen close when flow persistence failed after meeting persistence", async () => {
    const { flowId } = await startGoal("meeting-outcome-close-recovery");
    const opened = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Recuperar?" });
    const meetingId = opened.meeting_id as string;
    const originalSaveFlow = engine.store.saveFlow.bind(engine.store);
    let injectFailure = true;
    engine.store.saveFlow = async (flow) => {
      if (injectFailure && flow.history.some((event) => event.type === "meeting_closed")) {
        injectFailure = false;
        throw new Error("INJECTED_FLOW_SAVE_FAILURE");
      }
      await originalSaveFlow(flow);
    };

    await expect(engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Resultado congelado." }))
      .rejects.toThrow(/INJECTED_FLOW_SAVE_FAILURE/);
    expect((await engine.store.loadMeeting(meetingId)).status).toBe("closed");
    expect(meetingClosedEvents(await engine.store.loadFlow(flowId), meetingId)).toHaveLength(0);

    await engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Resultado congelado." });
    expect(meetingClosedEvents(await engine.store.loadFlow(flowId), meetingId)).toHaveLength(1);
  });

  it("reconciles a missing close ledger event without duplicating the frozen flow event", async () => {
    const { flowId } = await startGoal("meeting-outcome-ledger-recovery");
    const opened = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Ledger recuperavel?" });
    const meetingId = opened.meeting_id as string;
    const originalAppendLedger = engine.store.appendLedger.bind(engine.store);
    let injectFailure = true;
    engine.store.appendLedger = async (event) => {
      if (injectFailure && event.type === "meeting_closed") {
        injectFailure = false;
        throw new Error("INJECTED_LEDGER_APPEND_FAILURE");
      }
      await originalAppendLedger(event);
    };

    await expect(engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Resultado congelado com ledger recuperavel." }))
      .rejects.toThrow(/INJECTED_LEDGER_APPEND_FAILURE/);
    expect(meetingClosedEvents(await engine.store.loadFlow(flowId), meetingId)).toHaveLength(1);
    expect((await engine.store.readLedger(flowId)).filter((event) => event.type.includes("meeting_closed"))).toHaveLength(0);

    await engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Resultado congelado com ledger recuperavel." });
    expect(meetingClosedEvents(await engine.store.loadFlow(flowId), meetingId)).toHaveLength(1);
    expect((await engine.store.readLedger(flowId)).filter(
      (event) => event.type === "meeting_closed" && event.data.meeting_id === meetingId
    )).toHaveLength(1);
  });

  it("treats the same frozen close as idempotent when ledger append succeeded before transport failure", async () => {
    const { flowId } = await startGoal("meeting-outcome-ledger-ambiguous-success");
    const opened = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Append ambiguo?" });
    const meetingId = opened.meeting_id as string;
    const originalAppendLedger = engine.store.appendLedger.bind(engine.store);
    let injectFailure = true;
    engine.store.appendLedger = async (event) => {
      await originalAppendLedger(event);
      if (injectFailure && event.type === "meeting_closed") {
        injectFailure = false;
        throw new Error("INJECTED_AFTER_LEDGER_APPEND_FAILURE");
      }
    };

    await expect(engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Decisao idempotente." }))
      .rejects.toThrow(/INJECTED_AFTER_LEDGER_APPEND_FAILURE/);
    await expect(engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Decisao idempotente." }))
      .resolves.toMatchObject({ meeting_id: meetingId, decision: "Decisao idempotente." });
    expect(meetingClosedEvents(await engine.store.loadFlow(flowId), meetingId)).toHaveLength(1);
    expect((await engine.store.readLedger(flowId)).filter(
      (event) => event.type === "meeting_closed" && event.data.meeting_id === meetingId
    )).toHaveLength(1);
  });

  it("serializes meeting open and verdict mutations without losing either flow update", async () => {
    const { flowId } = await startGoal("meeting-outcome-open-verdict-race");
    const [opened, verdict] = await Promise.all([
      engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Nova decisao concorrente?" }),
      engine.goalVerdict({
        flow_id: flowId,
        status: "nao_pronto",
        rationale: "Veredito concorrente preservado.",
        evidence_ids: [],
        residual_risks: ["ainda em revisao"],
        next_step: "fechar a reuniao quando houver decisao"
      })
    ]);
    const persisted = await engine.store.loadFlow(flowId);
    expect(persisted.meetings).toContain(opened.meeting_id);
    expect(persisted.verdicts.map((item) => item.verdict_id)).toContain(
      (verdict.verdict as Record<string, unknown>).verdict_id
    );
  });

  it("serializes many concurrent meeting opens on the same flow", async () => {
    const { flowId } = await startGoal("meeting-outcome-many-open-race");
    const opened = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: `Questao concorrente ${index + 1}?` })
    ));
    const persisted = await engine.store.loadFlow(flowId);
    expect(new Set(opened.map((meeting) => meeting.meeting_id)).size).toBe(20);
    expect(new Set(persisted.meetings).size).toBe(20);
    expect(persisted.history.filter((event) => event.type === "meeting_opened")).toHaveLength(20);
  });

  it("retries a transient lock identity change without losing the bounded acquisition", async () => {
    const { flowId } = await startGoal("meeting-outcome-lock-identity-churn");
    let releaseHolder!: () => void;
    let holderEntered!: () => void;
    const entered = new Promise<void>((resolve) => { holderEntered = resolve; });
    const holder = engine.store.withFlowLock(flowId, async () => {
      holderEntered();
      await new Promise<void>((resolve) => { releaseHolder = resolve; });
    });
    await entered;

    class IdentityChurnStore extends PpirtvStore {
      readCalls = 0;
      identityChanges = 0;

      protected override async readFlowLock(lockPath: string, lockedFlowId: string) {
        this.readCalls += 1;
        if (this.readCalls === 1) {
          this.identityChanges += 1;
          releaseHolder();
          await holder;
          throw Object.assign(
            new Error(`MEETING_LOCK_IDENTITY_CHANGED: ${lockedFlowId}`),
            { code: "MEETING_LOCK_IDENTITY_CHANGED" }
          );
        }
        return super.readFlowLock(lockPath, lockedFlowId);
      }
    }

    const contender = new IdentityChurnStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true });
    await expect(contender.withFlowLock(flowId, async () => "acquired")).resolves.toBe("acquired");
    expect(contender.identityChanges).toBe(1);
    expect(contender.readCalls).toBeGreaterThanOrEqual(2);
  });

  it("does not let a turn race reopen or overwrite a closed meeting", async () => {
    const { flowId } = await startGoal("meeting-outcome-turn-close-race");
    const opened = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Turno ou close?" });
    const meetingId = opened.meeting_id as string;
    const results = await Promise.allSettled([
      engine.goalMeetingAddTurn({ flow_id: flowId, meeting_id: meetingId, speaker: "chato", finding: "Achado preservado." }),
      engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision: "Fechado sem reabrir." })
    ]);
    const persisted = await engine.store.loadMeeting(meetingId);
    expect(persisted.status).toBe("closed");
    if (results[0]?.status === "fulfilled") {
      expect(persisted.findings).toContain("Achado preservado.");
    }
  });

  it("does not steal a live cross-process flow lock even when its timestamp is old", async () => {
    const { flowId } = await startGoal("meeting-outcome-cross-process-lock");
    const storeUrl = pathToFileURL(path.resolve("src/store.ts")).href;
    const script = [
      `const { PpirtvStore } = await import(${JSON.stringify(storeUrl)});`,
      `const store = new PpirtvStore(${JSON.stringify(tempRoot)});`,
      `await store.withFlowLock(${JSON.stringify(flowId)}, async () => { process.stdout.write("LOCKED\\n"); await new Promise((resolve) => setTimeout(resolve, 350)); });`
    ].join("\n");
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.stdout.once("data", () => resolve());
    });
    await expect(engine.store.withFlowLock(flowId, async () => undefined)).rejects.toThrow(/MEETING_LOCKED/i);
    await new Promise<void>((resolve, reject) => {
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`child lock process exited ${code}`)));
    });
    await expect(engine.store.withFlowLock(flowId, async () => "ok")).resolves.toBe("ok");
  });

  it("recovers a valid flow lock owned by a process that no longer exists", async () => {
    const { flowId } = await startGoal("meeting-outcome-dead-process-lock");
    const lockPath = `${engine.store.flowPath(flowId)}.meeting.lock`;
    await writeFile(lockPath, `${JSON.stringify({
      owner_token: "dead-process-owner",
      pid: 2_147_483_647,
      created_at: "2000-01-01T00:00:00.000Z"
    })}\n`, "utf8");

    await expect(engine.store.withFlowLock(flowId, async () => "recovered")).resolves.toBe("recovered");
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed for a malformed flow lock instead of deleting unknown state", async () => {
    const { flowId } = await startGoal("meeting-outcome-invalid-lock");
    const lockPath = `${engine.store.flowPath(flowId)}.meeting.lock`;
    await writeFile(lockPath, "not-json\n", "utf8");

    await expect(engine.store.withFlowLock(flowId, async () => "unsafe"))
      .rejects.toThrow(/MEETING_LOCK_INVALID/i);
    await expect(readFile(lockPath, "utf8")).resolves.toBe("not-json\n");
  });

  it("rejects open meetings as downstream evidence in verdict and regress routes", async () => {
    const { flowId } = await startGoal("meeting-outcome-open-reference");
    const opened = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Ainda aberta?" });
    const meetingId = opened.meeting_id as string;

    await expect(engine.recordVerdict({
      flow_id: flowId,
      status: "nao_pronto",
      rationale: "Nao pode consumir reuniao aberta.",
      evidence_ids: [],
      residual_risks: ["aberta"],
      meeting_ids: [meetingId],
      next_step: "fechar reuniao"
    })).rejects.toThrow(/OFFICIAL_GOAL_REQUIRES_GOAL_VERDICT/i);
    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "nao_pronto",
      rationale: "Nao pode consumir reuniao aberta.",
      evidence_ids: [],
      residual_risks: ["aberta"],
      meeting_id: meetingId,
      next_step: "fechar reuniao"
    })).rejects.toThrow(/MEETING_NOT_CLOSED/i);
    await expect(engine.goalRegress({
      flow_id: flowId,
      meeting_id: meetingId,
      to: "pensamentos",
      reason: "Nao pode regredir com reuniao aberta."
    })).rejects.toThrow(/MEETING_NOT_CLOSED/i);
  });

  it("labels a historical meeting_recorded state explicitly after restart", async () => {
    const { flowId } = await startGoal("meeting-outcome-recorded-legacy");
    const opened = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: "Registro legado?" });
    const meetingId = opened.meeting_id as string;
    await engine.recordMeeting({ meeting_id: meetingId, decisions: ["Registro anterior ao close explicito."] });

    const restarted = new FlowEngine(new PpirtvStore(tempRoot));
    const status = await restarted.goalStatus({ flow_id: flowId, detail: "full" });
    expect(status.meeting_outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ meeting_id: meetingId, traceability_status: "recorded_legacy" })
    ]));
  });

  it("keeps compact meeting accountability bounded to counts", async () => {
    const { flowId } = await startGoal("meeting-outcome-compact-counts");
    await closeDecisionMeeting(flowId, "Compacta A");
    await closeDecisionMeeting(flowId, "Compacta B");
    const compact = await engine.goalStatus({ flow_id: flowId, detail: "compact" });
    const checkout = compact.ppirtv_checkout as Record<string, unknown>;
    const accountability = checkout.meeting_outcome_accountability as Record<string, unknown>;
    expect(accountability).not.toHaveProperty("outcomes");
    expect(compact).not.toHaveProperty("meeting_outcomes");
    expect(compact.meeting_outcome_summary).toMatchObject({ closed_unconsumed: 2 });
  });

  it("attributes verdict consumption only to exact persisted meeting ids", async () => {
    const { flowId } = await startGoal("meeting-outcome-verdict-link");
    const first = await closeDecisionMeeting(flowId, "Primeira decisao");
    const second = await closeDecisionMeeting(flowId, "Segunda decisao");

    const verdictReceipt = await engine.goalVerdict({
      flow_id: flowId,
      status: "nao_pronto",
      rationale: "Consumir somente a primeira reuniao.",
      evidence_ids: [],
      residual_risks: ["teste"],
      meeting_ids: [first],
      next_step: "continuar"
    });
    const verdict = verdictReceipt.verdict as Record<string, unknown>;
    expect(verdict.meeting_ids).toEqual([first]);

    const restarted = new FlowEngine(new PpirtvStore(tempRoot));
    const status = await restarted.goalStatus({ flow_id: flowId, detail: "full" });
    expect(status.meeting_outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ meeting_id: first, traceability_status: "consumed_by_verdict" }),
        expect.objectContaining({ meeting_id: second, traceability_status: "closed_unconsumed" })
      ])
    );
  });

  it("does not treat credits, turns or a later unlinked verdict as meeting consumption", async () => {
    const { flowId } = await startGoal("meeting-outcome-anti-goodhart");
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "decisao",
      question: "Muitos sinais rituais provam efeito?"
    });
    const meetingId = opened.meeting_id as string;
    await engine.goalMeetingAddTurn({ flow_id: flowId, meeting_id: meetingId, speaker: "chato", finding: "Nao." });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: meetingId,
      participants_present: ["chato"],
      decision: "Exigir consumo posterior exato.",
      active_credits: ["chato"],
      cooperators: [{ name: "chato", reason: "bloqueou prova circular", material: true }]
    });
    await engine.goalVerdict({
      flow_id: flowId,
      status: "nao_pronto",
      rationale: "Veredito posterior sem vinculo.",
      evidence_ids: [],
      residual_risks: ["sem vinculo"],
      next_step: "continuar"
    });

    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    expect(status.meeting_outcomes).toEqual(
      expect.arrayContaining([expect.objectContaining({ meeting_id: meetingId, traceability_status: "closed_unconsumed" })])
    );
  });

  it("attributes a successful regress to the exact meeting id", async () => {
    const { flowId } = await startGoal("meeting-outcome-regress-link");
    const meetingId = await closeDecisionMeeting(flowId, "Regredir para corrigir o plano");
    const flow = await engine.store.loadFlow(flowId);
    flow.phase = "planejamento";
    await engine.store.saveFlow(flow);

    await engine.goalRegress({
      flow_id: flowId,
      meeting_id: meetingId,
      to: "pensamentos",
      reason: "Decisao da reuniao exige recorte anterior."
    });

    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    expect(status.meeting_outcomes).toEqual(
      expect.arrayContaining([expect.objectContaining({ meeting_id: meetingId, traceability_status: "consumed_by_regress" })])
    );
  });

  it("labels old unlinked verdict events as unattributed legacy", async () => {
    const { flowId } = await startGoal("meeting-outcome-legacy-link");
    const meetingId = await closeDecisionMeeting(flowId, "Decisao antiga");
    const flow = await engine.store.loadFlow(flowId);
    flow.history.push({
      at: new Date().toISOString(),
      type: "verdict_recorded",
      data: { verdict_id: "vrd_legacy_without_meeting_ids", status: "nao_pronto" }
    });
    await engine.store.saveFlow(flow);

    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    expect(status.meeting_outcomes).toEqual(
      expect.arrayContaining([expect.objectContaining({ meeting_id: meetingId, traceability_status: "unattributed_legacy" })])
    );
  });

  it("reports exact review evidence rejection reasons", async () => {
    const { flowId } = await startGoal("meeting-outcome-review-diagnostics");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });
    const result = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review fora do escopo",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      content: "Review real, mas referencia de escopo invalida.",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["review_required"],
        findings: [],
        regression_risks: []
      },
      scope_classification: "target",
      scope_reference: "SPT entrada cotidiana V2"
    });

    expect(result.review_evidence_diagnostics).toMatchObject({
      valid: false,
      reasons: expect.arrayContaining(["scope_reference_not_authorized", "scope_reference_not_in_reviewed_targets"]),
      owner: "evidence_add"
    });
  });

  it("omits review diagnostics for evidence that does not claim review", async () => {
    const { flowId } = await startGoal("meeting-outcome-non-review-evidence");
    const result = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "test_run",
      title: "Teste focal",
      content: "Vitest executado com sucesso.",
      satisfies: ["tests_passed"],
      observed_result: { passed: 1, failed: 0 }
    });

    expect(result).not.toHaveProperty("review_evidence_diagnostics");
  });
});

async function closeDecisionMeeting(flowId: string, decision: string): Promise<string> {
  const opened = await engine.goalMeetingOpen({ flow_id: flowId, kind: "decisao", question: decision });
  const meetingId = opened.meeting_id as string;
  await engine.goalMeetingClose({ flow_id: flowId, meeting_id: meetingId, decision });
  return meetingId;
}

async function startGoal(idempotencyKey: string): Promise<{ flowId: string }> {
  const objective = `Validar ${idempotencyKey}`;
  const workspace = path.join(tempRoot, idempotencyKey);
  const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "meeting-outcome.md");
  await mkdir(path.dirname(sptPath), { recursive: true });
  await writeFile(sptPath, fakeSpt(workspace, objective), "utf8");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "flow-engine.ts"), "export const meetingOutcomeFixture = true;\n", "utf8");
  const started = await engine.startGoal({
    workspace,
    spt_path: sptPath,
    objective,
    idempotency_key: idempotencyKey,
    evidence_required: true,
    required_evidence: [],
    requested_verdict_policy: "evidence_required",
    source: "meeting-outcome-test",
    mode: "full"
  });
  return { flowId: started.flow_id as string };
}

async function currentImplementationFingerprint(flowId: string): Promise<string> {
  const flow = await engine.store.loadFlow(flowId);
  return fingerprintReviewedImplementation(
    flow.goal_binding!.envelope.workspace,
    flow.changed_files
  );
}

function fakeSpt(workspace: string, objective: string): string {
  return [
    "---",
    "dex_contract: spt",
    "version: 2",
    "status: EM_TESTE",
    "owner: Teste",
    "date: '2026-07-22'",
    `workspace: ${JSON.stringify(workspace)}`,
    "origin: teste RED meeting outcome",
    "goal:",
    "  id: meeting-outcome-test",
    "  title: Meeting outcome test",
    `  objective: ${objective}`,
    "context: Teste local.",
    "problem: Reuniao sem consumo causal.",
    "decision: Exigir referencia exata.",
    "scope:",
    "  include:",
    "    - src/flow-engine.ts",
    "  exclude:",
    "    - vault",
    "spec: Medir consumo sem score.",
    "plan:",
    "  - Criar RED.",
    "tasks:",
    "  - Executar teste.",
    "expected_evidence:",
    "  - RED e GREEN.",
    "done_criteria:",
    "  - meeting_id exato.",
    "risks:",
    "  - falso positivo.",
    "uncertainties:",
    "  - legado.",
    "gates:",
    "  - teste verde.",
    "validation:",
    "  - vitest.",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute teste.",
    "---",
    "# Fixture sintetica"
  ].join("\n");
}

function meetingClosedEvents(flow: Awaited<ReturnType<PpirtvStore["loadFlow"]>>, meetingId: string) {
  return flow.history.filter((event) => event.type === "meeting_closed" && event.data.meeting_id === meetingId);
}
