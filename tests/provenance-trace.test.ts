import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Evidence, Flow, LedgerEvent, Meeting, Verdict } from "../src/domain.js";
import { FlowEngine } from "../src/flow-engine.js";
import { tracePpirtvArtifact } from "../src/provenance-trace.js";
import { fingerprintSptV2Contract, parseSptV2Document } from "../src/spt-contract.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let workspace: string;
let store: PpirtvStore;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-trace-"));
  workspace = path.join(tempRoot, "workspace");
  await mkdir(workspace, { recursive: true });
  store = new PpirtvStore(path.join(workspace, ".ppirtv"));
  engine = new FlowEngine(store);
  await store.init();
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("PPIRTV provenance trace", () => {
  it("rejects zero or multiple exact selectors before reading artifacts", async () => {
    await expect(tracePpirtvArtifact(store, {})).rejects.toThrow(/exactly one selector/i);
    await expect(tracePpirtvArtifact(store, {
      flow_id: "flow_one",
      evidence_id: "evd_one"
    })).rejects.toThrow(/exactly one selector/i);
  });

  it("returns deterministic empty success for a missing exact selector without mutation", async () => {
    const before = await runtimeHashes(store);
    const receipt = await tracePpirtvArtifact(store, { evidence_id: "evd_missing" });
    const after = await runtimeHashes(store);

    expect(receipt).toEqual({
      contract: "ppirtv.trace.receipt.v1",
      selector_type: "evidence_id",
      selector_value: "evd_missing",
      matches: [],
      warnings: [],
      consistency: "non_transactional_read",
      mutated: false
    });
    expect(after).toEqual(before);
  });

  it("does not initialize an absent runtime while serving an empty read-only trace", async () => {
    const absentWorkspace = path.join(tempRoot, "absent-workspace");
    const absentRoot = path.join(absentWorkspace, ".ppirtv");
    const absentStore = new PpirtvStore(absentRoot);

    const receipt = await tracePpirtvArtifact(absentStore, { flow_id: "flow_missing" });

    expect(receipt.matches).toEqual([]);
    await expect(access(absentRoot)).rejects.toThrow();
  });

  it("locates evidence, meeting, verdict and ledger event through their real storage forms without leaking payloads", async () => {
    const privateSentinel = "PRIVATE_SENTINEL_DO_NOT_LEAK_7391";
    const fixture = await createExplicitFixture("goal-trace-primary", "dex-code:trace-primary", privateSentinel);
    const before = await runtimeHashes(store);

    const evidenceReceipt = await tracePpirtvArtifact(store, { evidence_id: fixture.evidence.evidence_id });
    const meetingReceipt = await tracePpirtvArtifact(store, { meeting_id: fixture.meeting.meeting_id });
    const verdictReceipt = await tracePpirtvArtifact(store, { verdict_id: fixture.verdict.verdict_id });
    const eventReceipt = await tracePpirtvArtifact(store, { event_id: fixture.event.event_id });
    const after = await runtimeHashes(store);

    expect(locatorKinds(evidenceReceipt)).toContain("file:evidence");
    expect(locatorKinds(meetingReceipt)).toContain("file:meeting");
    expect(locatorKinds(verdictReceipt)).toContain("json_pointer:verdict");
    expect(verdictReceipt.matches[0]?.locators).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifact_id: fixture.verdict.verdict_id,
        json_pointer: "/verdicts/0"
      })
    ]));
    expect(locatorKinds(eventReceipt)).toContain("ndjson_record:event");
    expect(eventReceipt.matches[0]?.locators).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifact_id: fixture.event.event_id,
        record_id: fixture.event.event_id
      })
    ]));
    for (const receipt of [evidenceReceipt, meetingReceipt, verdictReceipt, eventReceipt]) {
      expect(receipt.mutated).toBe(false);
      expect(JSON.stringify(receipt)).not.toContain(privateSentinel);
      expect(receipt.matches[0]?.locators).toEqual(expect.arrayContaining([
        expect.objectContaining({ artifact_type: "flow", artifact_id: fixture.flow.flow_id }),
        expect.objectContaining({ artifact_type: "spt", artifact_id: fixture.goalId })
      ]));
      expect(new Set(receipt.matches[0]?.locators.map((locator) => locator.artifact_type))).toEqual(
        new Set(["spt", "flow", "evidence", "meeting", "verdict", "event"])
      );
    }
    expect(after).toEqual(before);
  });

  it("returns every matching flow when historical ledger event ids are duplicated", async () => {
    const first = await createExplicitFixture("goal-event-duplicate-one", "dex-code:event-duplicate-one", "PRIVATE_DUP_ONE");
    const second = await createExplicitFixture("goal-event-duplicate-two", "dex-code:event-duplicate-two", "PRIVATE_DUP_TWO");
    await store.appendLedger({ ...second.event, event_id: first.event.event_id });

    const receipt = await tracePpirtvArtifact(store, { event_id: first.event.event_id });

    expect(receipt.matches.map((match) => match.flow_id).sort()).toEqual(
      [first.flow.flow_id, second.flow.flow_id].sort()
    );
  });

  it("warns and deduplicates locators when an event id repeats inside the same flow", async () => {
    const fixture = await createExplicitFixture("goal-event-duplicate-local", "dex-code:event-duplicate-local", "PRIVATE_DUP_LOCAL");
    await store.appendLedger({ ...fixture.event });

    const receipt = await tracePpirtvArtifact(store, { event_id: fixture.event.event_id });
    const eventLocators = receipt.matches[0]?.locators.filter((locator) =>
      locator.artifact_type === "event" && locator.artifact_id === fixture.event.event_id
    ) ?? [];

    expect(receipt.warnings).toContain("duplicate_event_id_in_flow");
    expect(eventLocators).toHaveLength(1);
  });

  it("returns every flow for the same goal_id in deterministic order instead of choosing one", async () => {
    const first = await createExplicitFixture("shared-goal", "dex-code:shared-one", "PRIVATE_ONE");
    const second = await createExplicitFixture("shared-goal", "dex-code:shared-two", "PRIVATE_TWO");

    const receipt = await tracePpirtvArtifact(store, { goal_id: "shared-goal" });
    const expectedIds = [first.flow.flow_id, second.flow.flow_id].sort();

    expect(receipt.matches.map((match) => match.flow_id)).toEqual(expectedIds);
    expect(receipt.matches.every((match) => match.classification === "explicit")).toBe(true);
  });

  it("classifies explicit, legacy_derived, unresolved and unbound history without rewriting it", async () => {
    const explicit = await createExplicitFixture("goal-explicit", "dex-code:explicit", "PRIVATE_EXPLICIT");
    const legacy = await createLegacyFixture("goal-legacy");
    const unresolved = await createUnresolvedFixture();
    const unbound = await engine.createFlow({ goal: "Unbound history" });
    const before = await runtimeHashes(store);

    const receipts = await Promise.all([
      tracePpirtvArtifact(store, { flow_id: explicit.flow.flow_id }),
      tracePpirtvArtifact(store, { flow_id: legacy.flow_id }),
      tracePpirtvArtifact(store, { flow_id: unresolved.flow_id }),
      tracePpirtvArtifact(store, { flow_id: unbound.flow_id })
    ]);
    const after = await runtimeHashes(store);

    expect(receipts.map((receipt) => receipt.matches[0]?.classification)).toEqual([
      "explicit",
      "legacy_derived",
      "unresolved",
      "unbound"
    ]);
    expect(receipts[1]?.matches[0]?.goal_id).toBe("goal-legacy");
    expect(receipts[2]?.matches[0]?.goal_id).toBeNull();
    expect(receipts[3]?.matches[0]?.goal_id).toBeNull();
    expect(after).toEqual(before);
  });

  it("does not classify an explicit binding as coherent when its workspace escapes the active project", async () => {
    const fixture = await createExplicitFixture("goal-explicit-mismatch", "dex-code:explicit-mismatch", "PRIVATE_MISMATCH");
    const flow = await store.loadFlow(fixture.flow.flow_id);
    flow.goal_binding!.envelope.workspace = path.join(tempRoot, "other-workspace");
    await store.saveFlow(flow);

    const receipt = await tracePpirtvArtifact(store, { flow_id: flow.flow_id });

    expect(receipt.matches[0]?.classification).toBe("unresolved");
    expect(receipt.matches[0]?.goal_id).toBeNull();
  });

  it("classifies contradictory explicit goal or document sha fields as unresolved, never legacy", async () => {
    const goalMismatch = await createExplicitFixture("goal-field-mismatch", "dex-code:goal-field-mismatch", "PRIVATE_FIELD");
    const goalMismatchFlow = await store.loadFlow(goalMismatch.flow.flow_id);
    goalMismatchFlow.goal_binding!.goal_id = "another-goal";
    await store.saveFlow(goalMismatchFlow);

    const shaMismatch = await createExplicitFixture("goal-sha-mismatch", "dex-code:sha-mismatch", "PRIVATE_SHA");
    const shaMismatchFlow = await store.loadFlow(shaMismatch.flow.flow_id);
    shaMismatchFlow.goal_binding!.spt_document_sha256_at_start = "not-a-sha";
    await store.saveFlow(shaMismatchFlow);

    const receipts = await Promise.all([
      tracePpirtvArtifact(store, { flow_id: goalMismatchFlow.flow_id }),
      tracePpirtvArtifact(store, { flow_id: shaMismatchFlow.flow_id })
    ]);

    expect(receipts.map((receipt) => receipt.matches[0]?.classification)).toEqual(["unresolved", "unresolved"]);
  });

  it("does not trust an evidence file whose flow id disagrees with the selected flow", async () => {
    const fixture = await createExplicitFixture("goal-evidence-mismatch", "dex-code:evidence-mismatch", "PRIVATE_EVIDENCE");
    await writeFile(
      store.evidencePath(fixture.evidence.evidence_id),
      `${JSON.stringify({ ...fixture.evidence, flow_id: "flow_other" }, null, 2)}\n`,
      "utf8"
    );

    const receipt = await tracePpirtvArtifact(store, { evidence_id: fixture.evidence.evidence_id });

    expect(receipt.warnings).toContain("evidence_file_identity_mismatch");
    expect(receipt.matches[0]?.locators).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ artifact_type: "evidence", source_kind: "file" })
    ]));
  });

  it("preserves valid matches when an unrelated historical flow file is unreadable", async () => {
    const fixture = await createExplicitFixture("goal-corrupt-neighbor", "dex-code:corrupt-neighbor", "PRIVATE_CORRUPT");
    await writeFile(path.join(store.flowsDir, "flow_corrupt.json"), "{not-json", "utf8");

    const receipt = await tracePpirtvArtifact(store, { flow_id: fixture.flow.flow_id });

    expect(receipt.matches[0]?.flow_id).toBe(fixture.flow.flow_id);
    expect(receipt.warnings).toContain("unreadable_flow_files:1");
  });

  it("omits a flow file whose internal identity disagrees with its filename", async () => {
    const fixture = await createExplicitFixture("goal-flow-identity", "dex-code:flow-identity", "PRIVATE_FLOW_ID");
    const stored = await readFile(store.flowPath(fixture.flow.flow_id), "utf8");
    await writeFile(
      path.join(store.flowsDir, "flow_wrong_filename.json"),
      stored.replace(fixture.flow.flow_id, "flow_internal_other"),
      "utf8"
    );

    const receipt = await tracePpirtvArtifact(store, { flow_id: "flow_internal_other" });

    expect(receipt.matches).toEqual([]);
    expect(receipt.warnings).toContain("unreadable_flow_files:1");
  });

  it("supports flow_id, idempotency_key and spt_path selectors with an independent locator oracle", async () => {
    const fixture = await createExplicitFixture("goal-oracle", "dex-code:oracle", "PRIVATE_ORACLE");
    const expectedFlowPath = relativeSource(store.flowPath(fixture.flow.flow_id));
    const expectedSptPath = relativeSource(fixture.sptPath);

    const byFlow = await tracePpirtvArtifact(store, { flow_id: fixture.flow.flow_id });
    const byKey = await tracePpirtvArtifact(store, { idempotency_key: fixture.idempotencyKey });
    const bySpt = await tracePpirtvArtifact(store, { spt_path: fixture.sptPath });
    const bySptDifferentWindowsCasing = process.platform === "win32"
      ? await tracePpirtvArtifact(store, { spt_path: fixture.sptPath.toUpperCase() })
      : null;

    for (const receipt of [byFlow, byKey, bySpt]) {
      expect(receipt.matches).toHaveLength(1);
      expect(receipt.matches[0]).toMatchObject({
        goal_id: fixture.goalId,
        flow_id: fixture.flow.flow_id,
        classification: "explicit"
      });
      expect(receipt.matches[0]?.locators).toEqual(expect.arrayContaining([
        expect.objectContaining({ source_path: expectedFlowPath }),
        expect.objectContaining({ source_path: expectedSptPath })
      ]));
    }
    expect(byKey.selector_value).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(byKey.selector_value).not.toContain(fixture.idempotencyKey);
    if (bySptDifferentWindowsCasing) {
      expect(bySptDifferentWindowsCasing.matches[0]?.flow_id).toBe(fixture.flow.flow_id);
    }
  });
});

async function createExplicitFixture(goalId: string, idempotencyKey: string, privateSentinel: string) {
  const sptPath = await writeSpt(goalId);
  const started = await engine.startGoal({
    workspace,
    spt_path: sptPath,
    objective: `Trace ${goalId}`,
    idempotency_key: idempotencyKey,
    evidence_required: true,
    required_evidence: ["trace"],
    requested_verdict_policy: "evidence_required",
    source: "test",
    mode: "full"
  });
  const flow = await store.loadFlow(started.flow_id as string);
  const evidence: Evidence = {
    evidence_id: `evd_${goalId.replace(/-/g, "_")}`,
    flow_id: flow.flow_id,
    kind: "test",
    title: "Synthetic evidence",
    content: privateSentinel,
    parking_lot: [],
    gold_mining: [],
    cooperators: [],
    active_credits: [],
    created_at: "2026-07-24T00:00:00.000Z"
  };
  const meeting: Meeting = {
    meeting_id: `mtg_${goalId.replace(/-/g, "_")}`,
    flow_id: flow.flow_id,
    type: "transversal",
    kind: "transversal",
    question: privateSentinel,
    status: "closed",
    opened_at: "2026-07-24T00:00:00.000Z",
    closed_at: "2026-07-24T00:01:00.000Z",
    participants_required: [],
    participants_present: [],
    suggested_cooperators: [],
    questions: [],
    findings: [],
    hypotheses: [],
    alternatives: [],
    decisions: [],
    satisfies_blockers: [],
    evidence_ids: [evidence.evidence_id],
    turns: [],
    risks: [],
    next_steps: [],
    affected_areas: [],
    impacts: [],
    owners: [],
    gates_extra: [],
    parking_lot: [],
    gold_mining: [],
    cooperators: [],
    active_credits: []
  };
  const verdict: Verdict = {
    verdict_id: `vrd_${goalId.replace(/-/g, "_")}`,
    flow_id: flow.flow_id,
    status: "pronto_com_ressalvas",
    rationale: privateSentinel,
    evidence_ids: [evidence.evidence_id],
    residual_risks: [],
    review_findings: [],
    parking_lot: [],
    gold_mining: [],
    cooperators: [],
    active_credits: [],
    next_step: "none",
    created_at: "2026-07-24T00:02:00.000Z"
  };
  flow.evidence.push(evidence);
  flow.meetings.push(meeting.meeting_id);
  flow.verdicts.push(verdict);
  await store.saveEvidence(evidence);
  await store.saveMeeting(meeting);
  await store.saveFlow(flow);
  const event: LedgerEvent = {
    event_id: `evt_${goalId.replace(/-/g, "_")}`,
    flow_id: flow.flow_id,
    type: "synthetic_private_event",
    timestamp: "2026-07-24T00:03:00.000Z",
    actor: "test",
    data: { private_payload: privateSentinel }
  };
  await store.appendLedger(event);
  return { goalId, idempotencyKey, sptPath, flow, evidence, meeting, verdict, event };
}

async function createLegacyFixture(goalId: string): Promise<Flow> {
  const sptPath = await writeSpt(goalId);
  const parsed = parseSptV2Document(await readFile(sptPath, "utf8"));
  const created = await engine.createFlow({ goal: `Legacy ${goalId}` });
  const flow = await store.loadFlow(created.flow_id);
  flow.goal_binding = {
    envelope: {
      workspace,
      spt_path: sptPath,
      objective: `Trace ${goalId}`,
      flow_id: flow.flow_id,
      idempotency_key: `legacy:${goalId}`,
      evidence_required: false,
      required_evidence: [],
      requested_verdict_policy: "draft",
      source: "legacy"
    },
    spt_contract_fingerprint: fingerprintSptV2Contract(parsed.contract!),
    started_at: "2026-07-24T00:00:00.000Z",
    last_seen_at: "2026-07-24T00:00:00.000Z"
  };
  await store.saveFlow(flow);
  return flow;
}

async function createUnresolvedFixture(): Promise<Flow> {
  const created = await engine.createFlow({ goal: "Unresolved history" });
  const flow = await store.loadFlow(created.flow_id);
  flow.goal_binding = {
    envelope: {
      workspace,
      spt_path: path.join(tempRoot, "outside", "missing.md"),
      objective: "Unresolved history",
      flow_id: flow.flow_id,
      idempotency_key: "legacy:unresolved",
      evidence_required: false,
      required_evidence: [],
      requested_verdict_policy: "draft",
      source: "legacy"
    },
    spt_contract_fingerprint: "a".repeat(64),
    started_at: "2026-07-24T00:00:00.000Z",
    last_seen_at: "2026-07-24T00:00:00.000Z"
  };
  await store.saveFlow(flow);
  return flow;
}

async function writeSpt(goalId: string): Promise<string> {
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, `${goalId}.md`);
  await writeFile(sptPath, [
    "---",
    "dex_contract: spt",
    "version: 2",
    "status: EM_TESTE",
    "owner: Teste",
    "date: '2026-07-24'",
    `workspace: ${JSON.stringify(workspace)}`,
    "origin: teste",
    "goal:",
    `  id: ${goalId}`,
    `  title: Trace ${goalId}`,
    `  objective: Trace ${goalId}`,
    "context: Fixture sintética sem dados privados.",
    "problem: Provar rastreamento.",
    "decision: Usar fontes canônicas existentes.",
    "scope:",
    "  include:",
    "    - Proveniência.",
    "  exclude:",
    "    - Índice novo.",
    "spec: Rastrear sem mutação.",
    "plan:",
    "  - Criar fixture.",
    "tasks:",
    "  - Rastrear fixture.",
    "expected_evidence:",
    "  - Receipt.",
    "done_criteria:",
    "  - Receipt determinístico.",
    "risks:",
    "  - Vazamento.",
    "uncertainties:",
    "  - Histórico legado.",
    "gates:",
    "  - Sem mutação.",
    "validation:",
    "  - npm test.",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute.",
    "---",
    "# Fixture sintética"
  ].join("\n"), "utf8");
  return sptPath;
}

async function runtimeHashes(targetStore: PpirtvStore): Promise<Record<string, string>> {
  const flows = await targetStore.listFlows();
  const files = [
    targetStore.ledgerPath,
    ...flows.map((flow) => targetStore.flowPath(flow.flow_id)),
    ...flows.flatMap((flow) =>
      flow.evidence.map((evidence) => targetStore.evidencePath(evidence.evidence_id))
    ),
    ...(await targetStore.listMeetings()).map((meeting) => targetStore.meetingPath(meeting.meeting_id))
  ].sort();
  const result: Record<string, string> = {};
  for (const file of files) {
    result[relativeSource(file)] = createHash("sha256").update(await readFile(file)).digest("hex");
  }
  return result;
}

function relativeSource(file: string): string {
  return path.relative(workspace, file);
}

function locatorKinds(receipt: Awaited<ReturnType<typeof tracePpirtvArtifact>>): string[] {
  return receipt.matches.flatMap((match) =>
    match.locators.map((locator) => `${locator.source_kind}:${locator.artifact_type}`)
  );
}
