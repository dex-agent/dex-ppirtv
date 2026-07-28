import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { GOAL_FLOW_ROLES, type Flow, type GoalFlowRole, type LedgerEvent, type Meeting } from "./domain.js";
import { sameRuntimePath } from "./config.js";
import { fingerprintSptV2Contract, parseSptV2Document } from "./spt-contract.js";
import type { PpirtvStore } from "./store.js";

export const PPIRTV_TRACE_SELECTOR_KEYS = [
  "flow_id",
  "goal_id",
  "idempotency_key",
  "evidence_id",
  "meeting_id",
  "verdict_id",
  "event_id",
  "spt_path"
] as const;

export type PpirtvTraceSelectorKey = (typeof PPIRTV_TRACE_SELECTOR_KEYS)[number];
export type PpirtvTraceSelector = Partial<Record<PpirtvTraceSelectorKey, string>>;
export type PpirtvTraceClassification = "explicit" | "legacy_derived" | "unresolved" | "unbound";
export type PpirtvTraceSourceKind = "file" | "json_pointer" | "ndjson_record";
export type PpirtvTraceFlowRole = GoalFlowRole | "unknown";

export type PpirtvTraceBindingComparison = {
  field: "goal_id" | "spt_contract_fingerprint";
  registered: string | null;
  current: string | null;
  match: boolean;
};

export type PpirtvTraceBindingReasonCode =
  | "goal_binding_absent"
  | "workspace_drift"
  | "spt_path_missing"
  | "spt_path_outside_plan_tasks"
  | "spt_contract_invalid"
  | "spt_contract_unreadable"
  | "spt_contract_fingerprint_missing"
  | "spt_contract_fingerprint_drift"
  | "goal_id_invalid"
  | "goal_id_drift"
  | "spt_document_sha256_invalid"
  | "legacy_binding_without_explicit_identity";

export type PpirtvTraceBindingIntegrity = {
  status: "coherent" | "drifted" | "legacy" | "unverifiable" | "not_applicable";
  reason_code: PpirtvTraceBindingReasonCode | null;
  fields_compared: PpirtvTraceBindingComparison[];
};

export type PpirtvTraceLocator = {
  artifact_type: "spt" | "flow" | "evidence" | "meeting" | "verdict" | "event";
  artifact_id: string;
  source_kind: PpirtvTraceSourceKind;
  source_path: string;
  json_pointer?: string;
  record_id?: string;
};

export type PpirtvTraceMatch = {
  goal_id: string | null;
  flow_id: string;
  classification: PpirtvTraceClassification;
  flow_role: PpirtvTraceFlowRole;
  binding_integrity: PpirtvTraceBindingIntegrity;
  locators: PpirtvTraceLocator[];
};

export type PpirtvTraceReceipt = {
  contract: "ppirtv.trace.receipt.v1";
  selector_type: PpirtvTraceSelectorKey;
  selector_value: string;
  matches: PpirtvTraceMatch[];
  warnings: string[];
  consistency: "non_transactional_read";
  mutated: false;
};

type ClassifiedFlow = {
  flow: Flow;
  goalId: string | null;
  classification: PpirtvTraceClassification;
  sptPath: string | null;
  flowRole: PpirtvTraceFlowRole;
  bindingIntegrity: PpirtvTraceBindingIntegrity;
};

export async function tracePpirtvArtifact(
  store: PpirtvStore,
  input: PpirtvTraceSelector
): Promise<PpirtvTraceReceipt> {
  const selected = PPIRTV_TRACE_SELECTOR_KEYS
    .map((key) => [key, input[key]?.trim()] as const)
    .filter((entry): entry is readonly [PpirtvTraceSelectorKey, string] => Boolean(entry[1]));
  if (selected.length !== 1) {
    throw new Error("PPIRTV_TRACE_SELECTOR_INVALID: exactly one selector is required");
  }
  const [selectorType, selectorValue] = selected[0];
  validateSelector(selectorType, selectorValue);
  const projectRoot = path.resolve(store.runtimePaths.projectRoot);
  const warnings: string[] = [];
  if (selectorType === "spt_path" && !insideWorkspace(projectRoot, path.resolve(selectorValue))) {
    return baseReceipt(selectorType, "[outside-workspace]", [], ["selector_path_outside_workspace"]);
  }

  const [flowRead, meetingRead, ledgerRead] = await Promise.all([
    store.listFlowsReadOnly(),
    store.listMeetingsReadOnly(),
    store.readLedgerReadOnly()
  ]);
  if (flowRead.unreadable_count > 0) {
    warnings.push(`unreadable_flow_files:${flowRead.unreadable_count}`);
  }
  if (meetingRead.unreadable_count > 0) {
    warnings.push(`unreadable_meeting_files:${meetingRead.unreadable_count}`);
  }
  if (ledgerRead.unreadable_count > 0) {
    warnings.push(`unreadable_ledger_records:${ledgerRead.unreadable_count}`);
  }
  const meetings = meetingRead.items;
  const events = ledgerRead.items;
  if (hasDuplicateEventWithinFlow(events)) {
    warnings.push("duplicate_event_id_in_flow");
  }
  const classified = await Promise.all(flowRead.items.map((flow) => classifyFlow(store, flow, projectRoot)));
  const matches: PpirtvTraceMatch[] = [];

  for (const candidate of classified) {
    if (!matchesSelector(candidate, selectorType, selectorValue, meetings, events)) {
      continue;
    }
    const locators = await buildLocators(
      store,
      candidate,
      meetings,
      events,
      projectRoot,
      warnings
    );
    matches.push({
      goal_id: candidate.goalId,
      flow_id: candidate.flow.flow_id,
      classification: candidate.classification,
      flow_role: candidate.flowRole,
      binding_integrity: candidate.bindingIntegrity,
      locators: sortLocators(locators)
    });
  }

  matches.sort((left, right) =>
    compareOrdinal(left.flow_id, right.flow_id)
    || compareOrdinal(left.goal_id ?? "", right.goal_id ?? "")
    || compareOrdinal(left.classification, right.classification)
  );
  if (selectorType === "spt_path") {
    await addSptSelectorDiagnostics(
      store,
      projectRoot,
      selectorValue,
      matches,
      flowRead.unreadable_count,
      warnings
    );
  }
  return baseReceipt(selectorType, sanitizedSelectorValue(selectorType, selectorValue, projectRoot), matches, [...new Set(warnings)].sort());
}

async function classifyFlow(store: PpirtvStore, flow: Flow, projectRoot: string): Promise<ClassifiedFlow> {
  const binding = flow.goal_binding;
  const flowRole = traceFlowRole(binding?.flow_role);
  if (!binding) {
    return {
      flow,
      goalId: null,
      classification: "unbound",
      sptPath: null,
      flowRole,
      bindingIntegrity: integrity("not_applicable", "goal_binding_absent")
    };
  }
  const registeredGoalId = stableRegisteredGoalId(binding.goal_id);
  if (!sameRuntimePath(binding.envelope.workspace, projectRoot)) {
    return unresolved(flow, null, null, flowRole, "workspace_drift");
  }
  const sptPath = binding.envelope.spt_path ? path.resolve(binding.envelope.spt_path) : null;
  if (!sptPath) {
    return unresolved(flow, null, null, flowRole, "spt_path_missing");
  }
  if (!insidePlanTasks(projectRoot, sptPath)) {
    return unresolved(flow, null, sptPath, flowRole, "spt_path_outside_plan_tasks");
  }
  if (!(await store.pathExists(sptPath))) {
    return unresolved(flow, null, sptPath, flowRole, "spt_path_missing");
  }
  let parsedGoalId: string;
  let currentFingerprint: string;
  try {
    const parsed = parseSptV2Document(await readFile(sptPath, "utf8"));
    if (!parsed.contract) {
      return unresolved(flow, null, sptPath, flowRole, "spt_contract_invalid");
    }
    currentFingerprint = fingerprintSptV2Contract(parsed.contract);
    parsedGoalId = parsed.contract.goal.id;
  } catch {
    return unresolved(flow, null, sptPath, flowRole, "spt_contract_unreadable");
  }
  if (!binding.spt_contract_fingerprint) {
    return unresolved(flow, null, sptPath, flowRole, "spt_contract_fingerprint_missing", [
      comparison("goal_id", registeredGoalId, parsedGoalId)
    ]);
  }
  if (currentFingerprint !== binding.spt_contract_fingerprint) {
    return unresolved(flow, registeredGoalId, sptPath, flowRole, "spt_contract_fingerprint_drift", [
      comparison(
        "spt_contract_fingerprint",
        binding.spt_contract_fingerprint,
        currentFingerprint
      ),
      comparison("goal_id", registeredGoalId, parsedGoalId)
    ], "drifted");
  }
  const explicitGoalId = binding.goal_id?.trim();
  const hasExplicitGoalId = binding.goal_id !== undefined;
  const hasDocumentSha = binding.spt_document_sha256_at_start !== undefined;
  if (hasExplicitGoalId || hasDocumentSha) {
    if (
      explicitGoalId
      && isStableGoalId(explicitGoalId)
      && explicitGoalId === parsedGoalId
      && /^[a-f0-9]{64}$/.test(binding.spt_document_sha256_at_start ?? "")
    ) {
      return {
        flow,
        goalId: explicitGoalId,
        classification: "explicit",
        sptPath,
        flowRole,
        bindingIntegrity: integrity("coherent", null, [
          comparison("spt_contract_fingerprint", binding.spt_contract_fingerprint, currentFingerprint),
          comparison("goal_id", explicitGoalId, parsedGoalId)
        ])
      };
    }
    const reasonCode = !explicitGoalId || !isStableGoalId(explicitGoalId)
      ? "goal_id_invalid"
      : explicitGoalId !== parsedGoalId
        ? "goal_id_drift"
        : "spt_document_sha256_invalid";
    return unresolved(flow, null, sptPath, flowRole, reasonCode, [
      comparison("spt_contract_fingerprint", binding.spt_contract_fingerprint, currentFingerprint),
      comparison("goal_id", registeredGoalId, parsedGoalId)
    ]);
  }
  return {
    flow,
    goalId: parsedGoalId,
    classification: "legacy_derived",
    sptPath,
    flowRole,
    bindingIntegrity: integrity("legacy", "legacy_binding_without_explicit_identity", [
      comparison("spt_contract_fingerprint", binding.spt_contract_fingerprint, currentFingerprint),
      comparison("goal_id", null, parsedGoalId)
    ])
  };
}

function unresolved(
  flow: Flow,
  goalId: string | null,
  sptPath: string | null,
  flowRole: PpirtvTraceFlowRole,
  reasonCode: PpirtvTraceBindingReasonCode,
  fieldsCompared: PpirtvTraceBindingComparison[] = [],
  status: PpirtvTraceBindingIntegrity["status"] = "unverifiable"
): ClassifiedFlow {
  return {
    flow,
    goalId,
    classification: "unresolved",
    sptPath,
    flowRole,
    bindingIntegrity: integrity(status, reasonCode, fieldsCompared)
  };
}

function stableRegisteredGoalId(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return isStableGoalId(normalized) ? normalized : null;
}

function traceFlowRole(value: unknown): PpirtvTraceFlowRole {
  return typeof value === "string" && GOAL_FLOW_ROLES.includes(value as GoalFlowRole)
    ? value as GoalFlowRole
    : "unknown";
}

function comparison(
  field: PpirtvTraceBindingComparison["field"],
  registered: string | null,
  current: string | null
): PpirtvTraceBindingComparison {
  return { field, registered, current, match: registered === current };
}

function integrity(
  status: PpirtvTraceBindingIntegrity["status"],
  reasonCode: PpirtvTraceBindingReasonCode | null,
  fieldsCompared: PpirtvTraceBindingComparison[] = []
): PpirtvTraceBindingIntegrity {
  return { status, reason_code: reasonCode, fields_compared: fieldsCompared };
}

async function addSptSelectorDiagnostics(
  store: PpirtvStore,
  projectRoot: string,
  selectorValue: string,
  matches: PpirtvTraceMatch[],
  unreadableFlowCount: number,
  warnings: string[]
): Promise<void> {
  const sptPath = path.resolve(selectorValue);
  if (!insidePlanTasks(projectRoot, sptPath)) {
    return;
  }
  if (!(await store.pathExists(sptPath))) {
    warnings.push("spt_path_missing");
    return;
  }
  if (matches.length > 0) {
    return;
  }
  if (unreadableFlowCount > 0) {
    warnings.push("spt_binding_indeterminate_due_to_unreadable_flows");
    return;
  }
  try {
    const parsed = parseSptV2Document(await readFile(sptPath, "utf8"));
    if (parsed.contract) {
      if (sameRuntimePath(parsed.contract.workspace, projectRoot)) {
        warnings.push("spt_valid_without_goal_binding");
      } else {
        warnings.push("spt_workspace_mismatch_without_goal_binding");
      }
    }
  } catch {
    // A read failure is not equivalent to a valid unbound SPT.
  }
}

function matchesSelector(
  candidate: ClassifiedFlow,
  selectorType: PpirtvTraceSelectorKey,
  selectorValue: string,
  meetings: Meeting[],
  events: LedgerEvent[]
): boolean {
  const flow = candidate.flow;
  switch (selectorType) {
    case "flow_id":
      return flow.flow_id === selectorValue;
    case "goal_id":
      return candidate.goalId === selectorValue;
    case "idempotency_key":
      return flow.goal_binding?.envelope.idempotency_key === selectorValue;
    case "spt_path":
      return Boolean(candidate.sptPath && sameRuntimePath(candidate.sptPath, selectorValue));
    case "evidence_id":
      return flow.evidence.some((evidence) => evidence.evidence_id === selectorValue);
    case "meeting_id":
      return meetings.some((meeting) => meeting.meeting_id === selectorValue && meeting.flow_id === flow.flow_id);
    case "verdict_id":
      return flow.verdicts.some((verdict) => verdict.verdict_id === selectorValue);
    case "event_id":
      return events.some((event) => event.event_id === selectorValue && event.flow_id === flow.flow_id);
  }
}

async function buildLocators(
  store: PpirtvStore,
  candidate: ClassifiedFlow,
  meetings: Meeting[],
  events: LedgerEvent[],
  projectRoot: string,
  warnings: string[]
): Promise<PpirtvTraceLocator[]> {
  const flow = candidate.flow;
  const locators: PpirtvTraceLocator[] = [{
    artifact_type: "flow",
    artifact_id: flow.flow_id,
    source_kind: "file",
    source_path: relativeSource(projectRoot, store.flowPath(flow.flow_id))
  }];
  if (candidate.sptPath && insideWorkspace(projectRoot, candidate.sptPath) && await store.pathExists(candidate.sptPath)) {
    locators.push({
      artifact_type: "spt",
      artifact_id: candidate.goalId ?? "unresolved-spt",
      source_kind: "file",
      source_path: relativeSource(projectRoot, candidate.sptPath)
    });
  }

  for (const [evidenceIndex, evidence] of flow.evidence.entries()) {
    if (!isArtifactId(evidence.evidence_id)) {
      warnings.push("invalid_evidence_id_omitted");
      continue;
    }
    locators.push({
      artifact_type: "evidence",
      artifact_id: evidence.evidence_id,
      source_kind: "json_pointer",
      source_path: relativeSource(projectRoot, store.flowPath(flow.flow_id)),
      json_pointer: `/evidence/${evidenceIndex}`
    });
    const evidencePath = store.evidencePath(evidence.evidence_id);
    if (await store.pathExists(evidencePath)) {
      try {
        const storedEvidence = JSON.parse(await readFile(evidencePath, "utf8")) as Partial<{
          evidence_id: string;
          flow_id: string;
        }>;
        if (storedEvidence.evidence_id === evidence.evidence_id && storedEvidence.flow_id === flow.flow_id) {
          locators.push({
            artifact_type: "evidence",
            artifact_id: evidence.evidence_id,
            source_kind: "file",
            source_path: relativeSource(projectRoot, evidencePath)
          });
        } else {
          warnings.push("evidence_file_identity_mismatch");
        }
      } catch {
        warnings.push("evidence_file_unreadable");
      }
    } else {
      warnings.push("evidence_file_missing");
    }
  }
  for (const meeting of meetings) {
    if (meeting.flow_id === flow.flow_id && isArtifactId(meeting.meeting_id)) {
      locators.push({
        artifact_type: "meeting",
        artifact_id: meeting.meeting_id,
        source_kind: "file",
        source_path: relativeSource(projectRoot, store.meetingPath(meeting.meeting_id))
      });
    }
  }
  flow.verdicts.forEach((verdict, verdictIndex) => {
    if (isArtifactId(verdict.verdict_id)) {
      locators.push({
        artifact_type: "verdict",
        artifact_id: verdict.verdict_id,
        source_kind: "json_pointer",
        source_path: relativeSource(projectRoot, store.flowPath(flow.flow_id)),
        json_pointer: `/verdicts/${verdictIndex}`
      });
    }
  });
  for (const event of events) {
    if (event.flow_id === flow.flow_id && isArtifactId(event.event_id)) {
      locators.push({
        artifact_type: "event",
        artifact_id: event.event_id,
        source_kind: "ndjson_record",
        source_path: relativeSource(projectRoot, store.ledgerPath),
        record_id: event.event_id
      });
    }
  }
  return locators;
}

function baseReceipt(
  selectorType: PpirtvTraceSelectorKey,
  selectorValue: string,
  matches: PpirtvTraceMatch[],
  warnings: string[]
): PpirtvTraceReceipt {
  return {
    contract: "ppirtv.trace.receipt.v1",
    selector_type: selectorType,
    selector_value: selectorValue,
    matches,
    warnings,
    consistency: "non_transactional_read",
    mutated: false
  };
}

function sanitizedSelectorValue(selectorType: PpirtvTraceSelectorKey, selectorValue: string, projectRoot: string): string {
  if (selectorType !== "spt_path") {
    return selectorType === "idempotency_key"
      ? `sha256:${createHash("sha256").update(selectorValue, "utf8").digest("hex")}`
      : selectorValue;
  }
  const resolved = path.resolve(selectorValue);
  return insideWorkspace(projectRoot, resolved) ? relativeSource(projectRoot, resolved) : "[outside-workspace]";
}

function validateSelector(selectorType: PpirtvTraceSelectorKey, selectorValue: string): void {
  if (selectorType === "spt_path" || selectorType === "idempotency_key") {
    return;
  }
  const valid = selectorType === "goal_id" ? isStableGoalId(selectorValue) : isArtifactId(selectorValue);
  if (!valid) {
    throw new Error(`PPIRTV_TRACE_SELECTOR_INVALID: ${selectorType} has an invalid exact identifier`);
  }
}

function isArtifactId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function isStableGoalId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(value);
}

function relativeSource(projectRoot: string, sourcePath: string): string {
  const relative = path.relative(canonicalPath(projectRoot), canonicalPath(sourcePath));
  return relative || ".";
}

function insideWorkspace(projectRoot: string, candidate: string): boolean {
  const relative = path.relative(canonicalPath(projectRoot), canonicalPath(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function insidePlanTasks(projectRoot: string, candidate: string): boolean {
  return insideWorkspace(path.join(projectRoot, ".agents", "PLAN-TASKS"), candidate);
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(canonicalPath(parent), path.basename(resolved));
  }
}

function sortLocators(locators: PpirtvTraceLocator[]): PpirtvTraceLocator[] {
  const sorted = [...locators].sort((left, right) =>
    compareOrdinal([
      left.artifact_type,
      left.artifact_id,
      left.source_kind,
      left.source_path,
      left.json_pointer ?? "",
      left.record_id ?? ""
    ].join("\u0000"), [
      right.artifact_type,
      right.artifact_id,
      right.source_kind,
      right.source_path,
      right.json_pointer ?? "",
      right.record_id ?? ""
    ].join("\u0000"))
  );
  return sorted.filter((locator, index) =>
    index === 0 || locatorKey(locator) !== locatorKey(sorted[index - 1]!)
  );
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasDuplicateEventWithinFlow(events: LedgerEvent[]): boolean {
  const seen = new Set<string>();
  for (const event of events) {
    const key = `${event.flow_id}\u0000${event.event_id}`;
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
}

function locatorKey(locator: PpirtvTraceLocator): string {
  return [
    locator.artifact_type,
    locator.artifact_id,
    locator.source_kind,
    locator.source_path,
    locator.json_pointer ?? "",
    locator.record_id ?? ""
  ].join("\u0000");
}
