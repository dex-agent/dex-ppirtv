import { mkdir, readFile, readdir, rename, stat, writeFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { PPIRTV_RUNTIME_DIRS, resolveRuntimePaths, runtimePathsFromHome } from "./config.js";
import type { PpirtvRuntimeDir, PpirtvRuntimePaths } from "./config.js";
import { scrubSecretLike } from "./security/secret-redaction.js";
import type { Evidence, Flow, LedgerEvent, Meeting } from "./domain.js";

let idSequence = 0;

export type RuntimeLayoutStatus = {
  project_root: string;
  ppirtv_home: string;
  ledger_path: string;
  ledger_exists: boolean;
  required_directories: PpirtvRuntimeDir[];
  missing_directories: PpirtvRuntimeDir[];
  directories: Record<PpirtvRuntimeDir, string>;
  status: "ready" | "missing";
};

export class PpirtvStore {
  readonly root: string;
  readonly runtimePaths: PpirtvRuntimePaths;
  readonly flowsDir: string;
  readonly meetingsDir: string;
  readonly evidenceDir: string;
  readonly memoryDir: string;
  readonly reviewDir: string;
  readonly verdictsDir: string;
  readonly logsDir: string;
  readonly specsDir: string;
  readonly tasksDir: string;
  readonly ledgerPath: string;

  constructor(root?: string) {
    this.runtimePaths = root ? runtimePathsFromHome(projectRootForExplicitStoreRoot(root), root) : resolveRuntimePaths();
    this.root = this.runtimePaths.ppirtvHome;
    this.flowsDir = this.runtimePaths.dirs.flows;
    this.meetingsDir = this.runtimePaths.dirs.meetings;
    this.evidenceDir = this.runtimePaths.dirs.evidence;
    this.memoryDir = this.runtimePaths.dirs.memory;
    this.reviewDir = this.runtimePaths.dirs.review;
    this.verdictsDir = this.runtimePaths.dirs.verdicts;
    this.logsDir = this.runtimePaths.dirs.logs;
    this.specsDir = this.runtimePaths.dirs.specs;
    this.tasksDir = this.runtimePaths.dirs.tasks;
    this.ledgerPath = this.runtimePaths.ledgerPath;
  }

  async init(): Promise<void> {
    await Promise.all(PPIRTV_RUNTIME_DIRS.map((dir) => mkdir(this.runtimePaths.dirs[dir], { recursive: true })));
    if (!existsSync(this.ledgerPath)) {
      await writeFile(this.ledgerPath, "", "utf8");
    }
  }

  async runtimeLayoutStatus(): Promise<RuntimeLayoutStatus> {
    await this.init();
    const missing: PpirtvRuntimeDir[] = [];
    for (const dir of PPIRTV_RUNTIME_DIRS) {
      if (!(await this.pathExists(this.runtimePaths.dirs[dir]))) {
        missing.push(dir);
      }
    }
    const ledgerExists = await this.pathExists(this.ledgerPath);
    return {
      project_root: this.runtimePaths.projectRoot,
      ppirtv_home: this.runtimePaths.ppirtvHome,
      ledger_path: this.ledgerPath,
      ledger_exists: ledgerExists,
      required_directories: [...PPIRTV_RUNTIME_DIRS],
      missing_directories: missing,
      directories: this.runtimePaths.dirs,
      status: missing.length === 0 && ledgerExists ? "ready" : "missing"
    };
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
    await appendFile(this.ledgerPath, `${JSON.stringify(scrubSecretLike(event))}\n`, "utf8");
  }

  async readLedger(flowId?: string): Promise<LedgerEvent[]> {
    await this.init();
    const text = await readFile(this.ledgerPath, "utf8");
    // #2 (security/estabilidade): tolerar linhas corrompidas sem derrubar
    // o sistema. Linhas invalidas sao filtradas (nao crasham o readLedger).
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LedgerEvent];
        } catch {
          return [];
        }
      })
      .filter((event) => !flowId || event.flow_id === flowId)
      .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "") || (a.event_id ?? "").localeCompare(b.event_id ?? ""));
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

function projectRootForExplicitStoreRoot(root: string): string {
  const resolved = path.resolve(root);
  return path.basename(resolved).toLowerCase() === ".ppirtv" ? path.dirname(resolved) : process.cwd();
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

// #3 (security): writeJsonAtomic usa temp unico com randomUUID para evitar
// race condition em escritas concorrentes. No Windows, fs.rename falha com
// EPERM se o destino existe ou ha handle aberto; usamos retry com unlink.
// NOTA: writeJsonAtomic NAO redaciona segredos — o flow JSON em .ppirtv/ e'
// estado interno do runtime, e o fiscal policy precisa ler o conteudo original.
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(tempPath, filePath);
  } catch (renameError) {
    // Windows: rename falha se o destino existe. Tentar unlink + rename.
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(filePath);
    } catch {
      // arquivo pode nao existir ainda; ignorar
    }
    await rename(tempPath, filePath);
  }
}

function normalizeFlow(flow: Flow): Flow {
  flow.parking_lot ??= [];
  flow.gold_mining ??= [];
  // P3a (hardening): default explicito para flow.mode. Antes dependia do
  // fallback em profileFor(undefined); agora o ponto de leitura seta o
  // default, eliminando fragilidade defensiva.
  flow.mode ??= "full";
  flow.goal_learning_links ??= [];
  flow.cooperators ??= [];
  flow.active_credits ??= [];
  flow.memory_candidate_resolutions ??= [];
  flow.memory_mining ??= {
    required: flow.gold_mining.length > 0 || flow.parking_lot.length > 0,
    blocked_verdict: false,
    candidates_count: 0,
    written_count: 0,
    blocked_count: 0,
    ledger_only_count: 0,
    discarded_count: 0,
    estacionamento: [],
    write_decisions: [],
    edit_queue: [],
    destination_warnings: [],
    strong_unwritten_count: 0
  };
  flow.memory_mining.estacionamento ??= [];
  flow.memory_mining.write_decisions ??= [];
  flow.memory_mining.edit_queue ??= [];
  flow.memory_mining.destination_warnings ??= [];
  flow.memory_mining.strong_unwritten_count ??= 0;
  flow.memory_mining.resolved_candidate_ids ??= [];
  flow.memory_mining.resolved_strong_unwritten_count ??= 0;
  flow.memory_mining.candidate_resolutions ??= flow.memory_candidate_resolutions;
  flow.memory_mining.memory_written ??= (flow.memory_mining.written_count ?? 0) > 0;
  flow.memory_mining.write_failures_count ??= flow.memory_mining.write_failures?.length ?? 0;
  flow.memory_mining.memory_validated ??= flow.memory_mining.memory_post_write_validation?.status === "passed";
  flow.memory_mining.memory_consolidated ??= flow.memory_mining.memory_validated === true && flow.memory_mining.write_failures_count === 0;
  flow.memory_mining.memory_post_write_validation ??= {
    required: false,
    status: "not_required",
    validator: "consciencia-memorias-post-write",
    touched_files: [],
    l1_files: [],
    l2_files: [],
    l3_files: [],
    checked_triggers: [],
    recall_proof: [],
    findings: [],
    parking_lot: [],
    commands_required: []
  };
  flow.memory_mining.memory_post_write_validation.parking_lot ??= [];
  flow.evidence = (flow.evidence ?? []).map((evidence) => ({
    ...evidence,
    parking_lot: evidence.parking_lot ?? [],
    gold_mining: evidence.gold_mining ?? [],
    cooperators: evidence.cooperators ?? [],
    active_credits: evidence.active_credits ?? []
  }));
  flow.verdicts = (flow.verdicts ?? []).map((verdict) => ({
    ...verdict,
    review_findings: verdict.review_findings ?? [],
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
  meeting.suggested_cooperators ??= [];
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
