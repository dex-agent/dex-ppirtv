import { mkdir, readFile, readdir, rename, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { resolvePpirtvHome } from "./config.js";
import type { Evidence, Flow, LedgerEvent, Meeting } from "./domain.js";

let idSequence = 0;

export class PpirtvStore {
  readonly root: string;
  readonly flowsDir: string;
  readonly meetingsDir: string;
  readonly evidenceDir: string;
  readonly ledgerPath: string;

  constructor(root = resolvePpirtvHome()) {
    this.root = root;
    this.flowsDir = path.join(root, "flows");
    this.meetingsDir = path.join(root, "meetings");
    this.evidenceDir = path.join(root, "evidence");
    this.ledgerPath = path.join(root, "ledger.ndjson");
  }

  async init(): Promise<void> {
    await mkdir(this.flowsDir, { recursive: true });
    await mkdir(this.meetingsDir, { recursive: true });
    await mkdir(this.evidenceDir, { recursive: true });
    if (!existsSync(this.ledgerPath)) {
      await writeFile(this.ledgerPath, "", "utf8");
    }
  }

  async nextId(prefix: "flow" | "evt" | "mtg" | "evd" | "vrd" | "pipe"): Promise<string> {
    await this.init();
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
    const ledgerLines = await this.readLedger();
    const count = ledgerLines.length + 1;
    idSequence = (idSequence % 9999) + 1;
    return `${prefix}_${timestamp}_${String(count).padStart(4, "0")}_${String(idSequence).padStart(4, "0")}`;
  }

  flowPath(flowId: string): string {
    return path.join(this.flowsDir, `${safeArtifactId(flowId, "flow_id")}.json`);
  }

  meetingPath(meetingId: string): string {
    return path.join(this.meetingsDir, `${safeArtifactId(meetingId, "meeting_id")}.json`);
  }

  evidencePath(evidenceId: string, extension = ".json"): string {
    return path.join(this.evidenceDir, `${safeArtifactId(evidenceId, "evidence_id")}${safeExtension(extension)}`);
  }

  async saveFlow(flow: Flow): Promise<void> {
    await this.init();
    safeArtifactId(flow.flow_id, "flow_id");
    await writeJsonAtomic(this.flowPath(flow.flow_id), flow);
  }

  async loadFlow(flowId: string): Promise<Flow> {
    await this.init();
    return normalizeFlow(await readJson<Flow>(this.flowPath(flowId)));
  }

  async listFlows(): Promise<Flow[]> {
    await this.init();
    const files = (await readdir(this.flowsDir)).filter((file) => file.endsWith(".json")).sort();
    const flows = await Promise.all(files.map((file) => readJson<Flow>(path.join(this.flowsDir, file))));
    const normalized = flows.map(normalizeFlow);
    return normalized.sort((a, b) => a.flow_id.localeCompare(b.flow_id));
  }

  async saveMeeting(meeting: Meeting): Promise<void> {
    await this.init();
    safeArtifactId(meeting.meeting_id, "meeting_id");
    safeArtifactId(meeting.flow_id, "flow_id");
    await writeJsonAtomic(this.meetingPath(meeting.meeting_id), meeting);
  }

  async loadMeeting(meetingId: string): Promise<Meeting> {
    await this.init();
    return normalizeMeeting(await readJson<Meeting>(this.meetingPath(meetingId)));
  }

  async listMeetings(flowId?: string): Promise<Meeting[]> {
    await this.init();
    const files = (await readdir(this.meetingsDir)).filter((file) => file.endsWith(".json")).sort();
    const meetings = await Promise.all(files.map((file) => readJson<Meeting>(path.join(this.meetingsDir, file))));
    return meetings
      .map(normalizeMeeting)
      .filter((meeting) => !flowId || meeting.flow_id === flowId)
      .sort((a, b) => a.meeting_id.localeCompare(b.meeting_id));
  }

  async saveEvidence(evidence: Evidence): Promise<void> {
    await this.init();
    safeArtifactId(evidence.evidence_id, "evidence_id");
    safeArtifactId(evidence.flow_id, "flow_id");
    await writeJsonAtomic(this.evidencePath(evidence.evidence_id), evidence);
  }

  async appendLedger(event: LedgerEvent): Promise<void> {
    await this.init();
    await appendFile(this.ledgerPath, `${JSON.stringify(scrubSecrets(event))}\n`, "utf8");
  }

  async readLedger(flowId?: string): Promise<LedgerEvent[]> {
    await this.init();
    const text = await readFile(this.ledgerPath, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LedgerEvent)
      .filter((event) => !flowId || event.flow_id === flowId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.event_id.localeCompare(b.event_id));
  }

  async pathExists(target: string): Promise<boolean> {
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  }
}

function safeArtifactId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${label}: expected non-empty string`);
  }
  const id = value.trim();
  if (!id || /^(?:undefined|null)$/i.test(id)) {
    throw new Error(`Invalid ${label}: value cannot be empty, undefined or null`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ${label}: only letters, numbers, underscore and dash are allowed`);
  }
  return id;
}

function safeExtension(extension: string): string {
  if (!/^\.[A-Za-z0-9]+$/.test(extension)) {
    throw new Error("Invalid artifact extension");
  }
  return extension;
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrubSecrets);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/secret|token|password|api[_-]?key|authorization/i.test(key)) {
        result[key] = "[redacted]";
      } else {
        result[key] = scrubSecrets(nested);
      }
    }
    return result;
  }
  return value;
}

function normalizeFlow(flow: Flow): Flow {
  flow.parking_lot ??= [];
  flow.gold_mining ??= [];
  flow.goal_learning_links ??= [];
  flow.cooperators ??= [];
  flow.active_credits ??= [];
  flow.memory_mining ??= {
    required: flow.gold_mining.length > 0 || flow.parking_lot.length > 0,
    blocked_verdict: false,
    candidates_count: 0,
    written_count: 0,
    blocked_count: 0,
    ledger_only_count: 0,
    discarded_count: 0
  };
  flow.evidence = (flow.evidence ?? []).map((evidence) => ({
    ...evidence,
    parking_lot: evidence.parking_lot ?? [],
    gold_mining: evidence.gold_mining ?? [],
    cooperators: evidence.cooperators ?? [],
    active_credits: evidence.active_credits ?? []
  }));
  flow.verdicts = (flow.verdicts ?? []).map((verdict) => ({
    ...verdict,
    parking_lot: verdict.parking_lot ?? [],
    gold_mining: verdict.gold_mining ?? [],
    cooperators: verdict.cooperators ?? [],
    active_credits: verdict.active_credits ?? []
  }));
  return flow;
}

function normalizeMeeting(meeting: Meeting): Meeting {
  meeting.kind ??= meetingKindForLegacyType(meeting.type);
  meeting.participants_required ??= [];
  meeting.participants_present ??= [];
  meeting.findings ??= [];
  meeting.decision ??= meeting.decisions?.[0];
  meeting.next_required_action ??= null;
  meeting.satisfies_blockers ??= [];
  meeting.evidence_ids ??= [];
  meeting.turns ??= [];
  meeting.parking_lot ??= [];
  meeting.gold_mining ??= [];
  meeting.cooperators ??= [];
  meeting.active_credits ??= [];
  return meeting;
}

function meetingKindForLegacyType(type: Meeting["type"]): Meeting["kind"] {
  if (type === "convergent") {
    return "convergente";
  }
  if (type === "transversal") {
    return "transversal";
  }
  if (type === "decision") {
    return "decisao";
  }
  return "divergente";
}
