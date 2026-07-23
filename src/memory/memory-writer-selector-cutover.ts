import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const JOURNAL_CONTRACT = "dex.ppirtv.memory-writer-selector-cutover.v2" as const;
const RECEIPT_CONTRACT = "dex.ppirtv.memory-writer-selector.restart-receipt.v2" as const;
const PROFILE_KEY = "PPIRTV_MEMORY_WRITER_PROFILE";
const CANONICAL_ROOT_KEY = "PPIRTV_DEX_MEMORIA_CANONICAL_ROOT";
const ENTRYPOINT_KEY = "PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT";
const MEMORY_HOME_KEY = "DEX_MEMORIA_HOME";
const SECTION = "mcp_servers.dex_ppirtv.env";
const SERVER_NAME = "dex_ppirtv" as const;

export type RestartAction = "restart" | "reconnect";
export type RestartReason = "activate" | "rollback";
export type MemoryWriterSelectorBeforeProfile = "unconfigured" | "legacy-v1";
export type MemoryWriterSelectorAfterProfile = "v2";

export type MemoryWriterSelectorRestartRequest = {
  server_name: typeof SERVER_NAME;
  reason: RestartReason;
  expected_action: RestartAction;
  challenge: string;
  config_path: string;
  expected_config_sha256: string;
  workspace: string;
  canonical_root: string | null;
  entrypoint: string | null;
  memory_home: string | null;
  expected_profile: string;
  effective_profile: string;
  effective_canonical_root: string | null;
  effective_entrypoint: string | null;
  effective_memory_home: string | null;
};

export type MemoryWriterSelectorRestartReceipt = {
  contract: typeof RECEIPT_CONTRACT;
  server_name: typeof SERVER_NAME;
  action: RestartAction;
  reason: RestartReason;
  challenge: string;
  config_path: string;
  config_sha256: string;
  workspace: string;
  canonical_root: string | null;
  entrypoint: string | null;
  memory_home: string | null;
  profile: string;
  effective_profile: string;
  effective_canonical_root: string | null;
  effective_entrypoint: string | null;
  effective_memory_home: string | null;
  process_generation: string;
  session_generation: string;
  evidence: string;
  at: string;
};

type CutoverPaths = {
  controlRoot: string;
  configPath: string;
  journalPath: string;
  ownerToken?: string;
};

type PrepareInput = CutoverPaths & {
  selector_before: MemoryWriterSelectorBeforeProfile;
  selector_after: MemoryWriterSelectorAfterProfile;
  canonical_root: string;
  entrypoint: string;
  activation_action?: RestartAction;
  rollback_action?: RestartAction;
};

type ContinueInput = CutoverPaths;

type Bundle = {
  profile: string | null;
  canonical_root: string | null;
  entrypoint: string | null;
  memory_home: string | null;
};

type Activation = { status: "restart_required" | "confirmed"; receipt: MemoryWriterSelectorRestartReceipt | null };

export type MemoryWriterSelectorCutoverStatus = {
  contract: typeof JOURNAL_CONTRACT;
  version: 2;
  server_name: typeof SERVER_NAME;
  state: "PREPARED" | "CONFIG_APPLIED" | "ACTIVATION_PENDING" | "COMMITTED" | "ROLLBACK_CONFIG_APPLIED" | "ROLLBACK_ACTIVATION_PENDING" | "ROLLED_BACK";
  control_root: string;
  config_path: string;
  selector_before_snapshot_path: string;
  selector_before_sha256: string;
  selector_after_sha256: string;
  bundle_before: Bundle;
  bundle_after: Bundle;
  activation_action: RestartAction;
  rollback_action: RestartAction;
  activation_challenge: string;
  rollback_challenge: string | null;
  runtime_activation: Activation;
  rollback_activation: Activation | null;
};

export async function prepareMemoryWriterSelectorCutover(input: PrepareInput): Promise<{ status: "PENDING" }> {
  if (input.selector_before !== "unconfigured" && input.selector_before !== "legacy-v1") throw new Error("PPIRTV_SELECTOR_CUTOVER_PROFILE_INVALID: selector_before");
  if (input.selector_after !== "v2") throw new Error("PPIRTV_SELECTOR_CUTOVER_PROFILE_INVALID: selector_after");
  const paths = await resolveControlPaths(input, true);
  return withMutex(paths, input.ownerToken, async () => {
    if (await pathExists(paths.journalPath)) throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_EXISTS_USE_RESUME_OR_ROLLBACK");
    if (!input.canonical_root || !path.isAbsolute(input.canonical_root)) throw new Error("PPIRTV_SELECTOR_CUTOVER_CANONICAL_ROOT_REQUIRED");
    if (!input.entrypoint || !path.isAbsolute(input.entrypoint)) throw new Error("PPIRTV_SELECTOR_CUTOVER_ENTRYPOINT_REQUIRED");
    const before = await readStableFile(paths.configPath, paths.controlRoot);
    const rendered = renderBundle(before.bytes, {
      profile: input.selector_after,
      canonical_root: path.resolve(input.canonical_root),
      entrypoint: path.resolve(input.entrypoint)
    }, input.selector_before);
    const snapshotPath = `${paths.journalPath}.selector-before.bin`;
    assertWithinControlRoot(paths.controlRoot, snapshotPath, "snapshot");
    if (await pathExists(snapshotPath)) {
      const orphan = await readStableFile(snapshotPath, paths.controlRoot);
      if (!orphan.bytes.equals(before.bytes)) throw new Error("PPIRTV_SELECTOR_CUTOVER_ORPHAN_SNAPSHOT_MISMATCH");
    } else {
      await exclusiveWrite(snapshotPath, before.bytes, paths.controlRoot);
    }
    const journal: MemoryWriterSelectorCutoverStatus = {
      contract: JOURNAL_CONTRACT,
      version: 2,
      server_name: SERVER_NAME,
      state: "PREPARED",
      control_root: paths.controlRoot,
      config_path: paths.configPath,
      selector_before_snapshot_path: snapshotPath,
      selector_before_sha256: sha256(before.bytes),
      selector_after_sha256: sha256(rendered.bytes),
      bundle_before: rendered.before,
      bundle_after: rendered.after,
      activation_action: input.activation_action ?? "restart",
      rollback_action: input.rollback_action ?? "restart",
      activation_challenge: randomUUID(),
      rollback_challenge: null,
      runtime_activation: { status: "restart_required", receipt: null },
      rollback_activation: null
    };
    await writeJournal(paths, journal);
    return { status: "PENDING" };
  });
}

export async function resumeMemoryWriterSelectorCutover(input: ContinueInput): Promise<{ status: "PENDING_RESTART" | "COMMITTED" | "ALREADY_COMMITTED" }> {
  if ("restart_hook" in input) throw new Error("PPIRTV_SELECTOR_CUTOVER_MANUAL_RECEIPT_NOT_ACCEPTED");
  const paths = await resolveControlPaths(input);
  return withMutex(paths, input.ownerToken, async () => {
    const journal = await loadBoundJournal(paths);
    if (journal.state === "COMMITTED") {
      return { status: "ALREADY_COMMITTED" };
    }
    if (journal.state.startsWith("ROLLBACK_") || journal.state === "ROLLED_BACK") throw new Error(`PPIRTV_SELECTOR_CUTOVER_CANNOT_RESUME_FROM_${journal.state}`);
    const current = await readStableFile(paths.configPath, paths.controlRoot);
    const currentHash = sha256(current.bytes);
    if (currentHash === journal.selector_before_sha256) {
      const rendered = renderBundle(current.bytes, {
        profile: journal.bundle_after.profile!,
        canonical_root: journal.bundle_after.canonical_root!,
        entrypoint: journal.bundle_after.entrypoint!
      }, journal.bundle_before.profile ?? "unconfigured");
      if (sha256(rendered.bytes) !== journal.selector_after_sha256) throw new Error("PPIRTV_SELECTOR_CUTOVER_AFTER_HASH_MISMATCH");
      await publishFile(paths.configPath, rendered.bytes, paths.controlRoot, current.identity);
      journal.state = "CONFIG_APPLIED";
      await writeJournal(paths, journal);
    } else if (currentHash !== journal.selector_after_sha256) {
      throw new Error("PPIRTV_SELECTOR_CUTOVER_CONFIG_DRIFT");
    }
    if (journal.state === "PREPARED" || journal.state === "CONFIG_APPLIED") {
      journal.state = "ACTIVATION_PENDING";
      await writeJournal(paths, journal);
    }
    return { status: "PENDING_RESTART" };
  });
}

export async function rollbackMemoryWriterSelectorCutover(input: ContinueInput): Promise<{ status: "PENDING_RESTART" | "ROLLED_BACK" | "ALREADY_ROLLED_BACK" }> {
  if ("restart_hook" in input) throw new Error("PPIRTV_SELECTOR_CUTOVER_MANUAL_RECEIPT_NOT_ACCEPTED");
  const paths = await resolveControlPaths(input);
  return withMutex(paths, input.ownerToken, async () => {
    const journal = await loadBoundJournal(paths);
    if (journal.state === "ROLLED_BACK") {
      return { status: "ALREADY_ROLLED_BACK" };
    }
    const current = await readStableFile(paths.configPath, paths.controlRoot);
    const currentHash = sha256(current.bytes);
    const afterMayHaveBeenObserved = journal.state !== "PREPARED" || currentHash === journal.selector_after_sha256;
    if (currentHash === journal.selector_after_sha256) {
      const snapshot = await readStableFile(journal.selector_before_snapshot_path, paths.controlRoot);
      if (sha256(snapshot.bytes) !== journal.selector_before_sha256) throw new Error("PPIRTV_SELECTOR_CUTOVER_SNAPSHOT_HASH_MISMATCH");
      await publishFile(paths.configPath, snapshot.bytes, paths.controlRoot, current.identity);
      journal.state = "ROLLBACK_CONFIG_APPLIED";
      await writeJournal(paths, journal);
    } else if (currentHash !== journal.selector_before_sha256) {
      throw new Error("PPIRTV_SELECTOR_CUTOVER_CONFIG_DRIFT");
    }
    if (!afterMayHaveBeenObserved) {
      journal.state = "ROLLED_BACK";
      await writeJournal(paths, journal);
      return { status: "ROLLED_BACK" };
    }
    if (!journal.rollback_challenge) journal.rollback_challenge = randomUUID();
    journal.state = "ROLLBACK_ACTIVATION_PENDING";
    journal.rollback_activation = { status: "restart_required", receipt: null };
    await writeJournal(paths, journal);
    return { status: "PENDING_RESTART" };
  });
}

export async function confirmMemoryWriterSelectorCutover(input: CutoverPaths & {
  reason: RestartReason;
  action: RestartAction;
}): Promise<{ status: "COMMITTED" | "ROLLED_BACK" }> {
  const paths = await resolveControlPaths(input);
  const receiptPath = `${paths.journalPath}.probe-${randomUUID()}.json`;
  try {
    const { runMemoryWriterSelectorActivationProbeCli } = await import("../memory-writer-selector-activation-probe-cli.js");
    await runMemoryWriterSelectorActivationProbeCli([
      "--control-root", paths.controlRoot, "--config", paths.configPath, "--journal", paths.journalPath,
      "--receipt", receiptPath, "--server", SERVER_NAME, "--reason", input.reason, "--action", input.action
    ], { stdout: () => undefined });
    const receiptStable = await readStableFile(receiptPath, paths.controlRoot);
    const receipt = JSON.parse(receiptStable.bytes.toString("utf8")) as MemoryWriterSelectorRestartReceipt;
    return withMutex(paths, input.ownerToken, async () => {
      const journal = await loadBoundJournal(paths);
      if (input.reason === "activate") {
        if (journal.state === "COMMITTED") throw new Error("PPIRTV_SELECTOR_CUTOVER_RECEIPT_REPLAY");
        if (journal.state !== "ACTIVATION_PENDING") throw new Error(`PPIRTV_SELECTOR_CUTOVER_CONFIRM_INVALID_STATE: ${journal.state}`);
        validateReceipt(receipt, restartRequest(journal, "activate"));
        journal.runtime_activation = { status: "confirmed", receipt };
        journal.state = "COMMITTED";
        await writeJournal(paths, journal);
        return { status: "COMMITTED" };
      }
      if (journal.state === "ROLLED_BACK") throw new Error("PPIRTV_SELECTOR_CUTOVER_RECEIPT_REPLAY");
      if (journal.state !== "ROLLBACK_ACTIVATION_PENDING") throw new Error(`PPIRTV_SELECTOR_CUTOVER_CONFIRM_INVALID_STATE: ${journal.state}`);
      validateReceipt(receipt, restartRequest(journal, "rollback"));
      journal.rollback_activation = { status: "confirmed", receipt };
      journal.state = "ROLLED_BACK";
      await writeJournal(paths, journal);
      return { status: "ROLLED_BACK" };
    });
  } finally {
    if (await pathExists(receiptPath)) await unlink(receiptPath);
  }
}

export async function getMemoryWriterSelectorCutoverStatus(input: CutoverPaths): Promise<MemoryWriterSelectorCutoverStatus> {
  return loadBoundJournal(await resolveControlPaths(input));
}

function restartRequest(journal: MemoryWriterSelectorCutoverStatus, reason: RestartReason): MemoryWriterSelectorRestartRequest {
  const activating = reason === "activate";
  const bundle = activating ? journal.bundle_after : journal.bundle_before;
  return {
    server_name: journal.server_name,
    reason,
    expected_action: activating ? journal.activation_action : journal.rollback_action,
    challenge: activating ? journal.activation_challenge : journal.rollback_challenge!,
    config_path: journal.config_path,
    expected_config_sha256: activating ? journal.selector_after_sha256 : journal.selector_before_sha256,
    workspace: journal.control_root,
    canonical_root: bundle.canonical_root,
    entrypoint: bundle.entrypoint,
    memory_home: bundle.memory_home,
    expected_profile: bundle.profile ?? "unconfigured",
    effective_profile: activating ? journal.bundle_after.profile! : (journal.bundle_before.profile ?? "unconfigured"),
    effective_canonical_root: activating ? journal.bundle_after.canonical_root : null,
    effective_entrypoint: activating ? journal.bundle_after.entrypoint : null,
    effective_memory_home: bundle.memory_home
  };
}

function validateReceipt(receipt: MemoryWriterSelectorRestartReceipt, request: MemoryWriterSelectorRestartRequest): void {
  if (receipt.contract !== RECEIPT_CONTRACT) throw new Error("PPIRTV_SELECTOR_CUTOVER_RECEIPT_CONTRACT_INVALID");
  if (receipt.server_name !== request.server_name) throw new Error("PPIRTV_SELECTOR_CUTOVER_RECEIPT_SERVER_MISMATCH");
  if (receipt.action !== request.expected_action) throw new Error("PPIRTV_SELECTOR_CUTOVER_RECEIPT_ACTION_MISMATCH");
  if (receipt.reason !== request.reason) throw new Error("PPIRTV_SELECTOR_CUTOVER_RECEIPT_REASON_MISMATCH");
  if (receipt.challenge !== request.challenge) throw new Error("PPIRTV_SELECTOR_CUTOVER_RECEIPT_CHALLENGE_MISMATCH");
  const exact: Array<[unknown, unknown, string]> = [
    [receipt.config_path, request.config_path, "CONFIG_PATH"], [receipt.config_sha256, request.expected_config_sha256, "CONFIG_HASH"],
    [receipt.workspace, request.workspace, "WORKSPACE"], [receipt.canonical_root, request.canonical_root, "CANONICAL_ROOT"],
    [receipt.entrypoint, request.entrypoint, "ENTRYPOINT"], [receipt.memory_home, request.memory_home, "MEMORY_HOME"],
    [receipt.profile, request.expected_profile, "PROFILE"], [receipt.effective_profile, request.effective_profile, "EFFECTIVE_PROFILE"],
    [receipt.effective_canonical_root, request.effective_canonical_root, "EFFECTIVE_CANONICAL_ROOT"],
    [receipt.effective_entrypoint, request.effective_entrypoint, "EFFECTIVE_ENTRYPOINT"],
    [receipt.effective_memory_home, request.effective_memory_home, "EFFECTIVE_MEMORY_HOME"]
  ];
  for (const [actual, expected, label] of exact) if (!sameValue(actual, expected, /PATH|WORKSPACE|ROOT|ENTRYPOINT|MEMORY_HOME/u.test(label))) throw new Error(`PPIRTV_SELECTOR_CUTOVER_RECEIPT_${label}_MISMATCH`);
  if (!receipt.process_generation?.trim() || !receipt.session_generation?.trim() || !receipt.evidence?.trim() || !receipt.at?.trim()) throw new Error("PPIRTV_SELECTOR_CUTOVER_RECEIPT_EVIDENCE_INVALID");
  assertExactKeys(receipt, ["action", "at", "canonical_root", "challenge", "config_path", "config_sha256", "contract", "effective_canonical_root", "effective_entrypoint", "effective_memory_home", "effective_profile", "entrypoint", "evidence", "memory_home", "process_generation", "profile", "reason", "server_name", "session_generation", "workspace"], "RECEIPT");
}

function renderBundle(source: Buffer, after: { profile: string; canonical_root: string; entrypoint: string }, implicitBefore: string): { bytes: Buffer; before: Bundle; after: Bundle } {
  const text = source.toString("utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = text.endsWith("\n");
  const lines = text.split(/\r?\n/u);
  if (finalNewline) lines.pop();
  const sectionIndex = lines.findIndex((line) => line.trim() === `[${SECTION}]`);
  if (sectionIndex < 0) throw new Error("PPIRTV_SELECTOR_CUTOVER_ENV_SECTION_REQUIRED");
  let sectionEnd = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) if (/^\s*\[[^\]]+\]\s*$/u.test(lines[index])) { sectionEnd = index; break; }
  const keys = [PROFILE_KEY, CANONICAL_ROOT_KEY, ENTRYPOINT_KEY, MEMORY_HOME_KEY];
  const found = new Map<string, { index: number; value: string }>();
  for (let index = sectionIndex + 1; index < sectionEnd; index += 1) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*["']([^"']*)["']/u.exec(lines[index]);
    if (!match || !keys.includes(match[1])) continue;
    if (found.has(match[1])) throw new Error(`PPIRTV_SELECTOR_CUTOVER_DUPLICATE_KEY: ${match[1]}`);
    found.set(match[1], { index, value: unescapeToml(match[2]) });
  }
  const profileBefore = found.get(PROFILE_KEY)?.value ?? "unconfigured";
  if (profileBefore !== implicitBefore) throw new Error(`PPIRTV_SELECTOR_CUTOVER_UNEXPECTED_PROFILE: ${profileBefore}`);
  const memoryHome = found.get(MEMORY_HOME_KEY)?.value ?? null;
  if (!memoryHome) throw new Error("PPIRTV_SELECTOR_CUTOVER_MEMORY_HOME_REQUIRED");
  const replacements: Record<string, string> = { [PROFILE_KEY]: after.profile, [CANONICAL_ROOT_KEY]: after.canonical_root, [ENTRYPOINT_KEY]: after.entrypoint };
  const insertion: string[] = [];
  for (const [key, value] of Object.entries(replacements)) {
    const current = found.get(key);
    const line = `${key} = "${escapeToml(value)}"`;
    if (current) lines[current.index] = line; else insertion.push(line);
  }
  lines.splice(sectionIndex + 1, 0, ...insertion);
  const updated = `${lines.join(newline)}${finalNewline ? newline : ""}`;
  return {
    bytes: Buffer.from(updated, "utf8"),
    before: { profile: found.get(PROFILE_KEY)?.value ?? null, canonical_root: found.get(CANONICAL_ROOT_KEY)?.value ?? null, entrypoint: found.get(ENTRYPOINT_KEY)?.value ?? null, memory_home: memoryHome },
    after: { profile: after.profile, canonical_root: after.canonical_root, entrypoint: after.entrypoint, memory_home: memoryHome }
  };
}

async function resolveControlPaths(input: CutoverPaths, createParent = false): Promise<CutoverPaths> {
  const requestedRoot = path.resolve(input.controlRoot);
  const requestedConfig = path.resolve(input.configPath);
  const requestedJournal = path.resolve(input.journalPath);
  assertWithinControlRoot(requestedRoot, requestedConfig, "config");
  assertWithinControlRoot(requestedRoot, requestedJournal, "journal");
  const controlRoot = await realpath(requestedRoot);
  const configPath = await realpath(requestedConfig);
  assertWithinControlRoot(controlRoot, configPath, "config realpath");
  await requireRegularFile(requestedConfig, "CONFIG");
  const parent = path.dirname(requestedJournal);
  if (createParent) await mkdir(parent, { recursive: true });
  const parentReal = await realpath(parent);
  assertWithinControlRoot(controlRoot, parentReal, "journal parent");
  return { controlRoot, configPath, journalPath: path.join(parentReal, path.basename(requestedJournal)), ownerToken: input.ownerToken };
}

async function loadBoundJournal(paths: CutoverPaths): Promise<MemoryWriterSelectorCutoverStatus> {
  const stable = await readStableFile(paths.journalPath, paths.controlRoot);
  const journal = JSON.parse(stable.bytes.toString("utf8")) as MemoryWriterSelectorCutoverStatus;
  validateJournalStrict(journal);
  if (!samePath(journal.control_root, paths.controlRoot)) throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_ROOT_MISMATCH");
  if (!samePath(journal.config_path, paths.configPath)) throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_CONFIG_MISMATCH");
  const snapshot = await readStableFile(journal.selector_before_snapshot_path, paths.controlRoot);
  if (sha256(snapshot.bytes) !== journal.selector_before_sha256) throw new Error("PPIRTV_SELECTOR_CUTOVER_SNAPSHOT_HASH_MISMATCH");
  if (journal.runtime_activation.receipt) validateReceipt(journal.runtime_activation.receipt, restartRequest(journal, "activate"));
  if (journal.rollback_activation?.receipt) validateReceipt(journal.rollback_activation.receipt, restartRequest(journal, "rollback"));
  return journal;
}

function validateJournalStrict(value: MemoryWriterSelectorCutoverStatus): void {
  assertExactKeys(value, ["activation_action", "activation_challenge", "bundle_after", "bundle_before", "config_path", "contract", "control_root", "rollback_action", "rollback_activation", "rollback_challenge", "runtime_activation", "selector_after_sha256", "selector_before_sha256", "selector_before_snapshot_path", "server_name", "state", "version"], "JOURNAL");
  if (value.contract !== JOURNAL_CONTRACT || value.version !== 2) throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_CONTRACT_INVALID");
  if (value.server_name !== SERVER_NAME) throw new Error("PPIRTV_SELECTOR_CUTOVER_SERVER_MISMATCH");
  if (!["PREPARED", "CONFIG_APPLIED", "ACTIVATION_PENDING", "COMMITTED", "ROLLBACK_CONFIG_APPLIED", "ROLLBACK_ACTIVATION_PENDING", "ROLLED_BACK"].includes(value.state)) throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_STATE_INVALID");
  if (!["restart", "reconnect"].includes(value.activation_action) || !["restart", "reconnect"].includes(value.rollback_action)) throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_ACTION_INVALID");
  if (!/^[a-f0-9]{64}$/u.test(value.selector_before_sha256) || !/^[a-f0-9]{64}$/u.test(value.selector_after_sha256)) throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_HASH_INVALID");
  for (const bundle of [value.bundle_before, value.bundle_after]) assertExactKeys(bundle, ["canonical_root", "entrypoint", "memory_home", "profile"], "BUNDLE");
  for (const activation of [value.runtime_activation, value.rollback_activation].filter(Boolean) as Activation[]) assertExactKeys(activation, ["receipt", "status"], "ACTIVATION");
  if (value.state === "COMMITTED" && (value.runtime_activation.status !== "confirmed" || !value.runtime_activation.receipt)) throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_COMMITTED_WITHOUT_RECEIPT");
  if (value.state === "ROLLBACK_ACTIVATION_PENDING" && !value.rollback_challenge) throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_ROLLBACK_CHALLENGE_MISSING");
  if (value.state === "ROLLED_BACK" && value.rollback_activation && value.rollback_activation.status !== "confirmed") throw new Error("PPIRTV_SELECTOR_CUTOVER_JOURNAL_ROLLBACK_RECEIPT_INVALID");
}

async function withMutex<T>(paths: CutoverPaths, requestedToken: string | undefined, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${paths.journalPath}.lock`;
  const ownerToken = requestedToken?.trim() || randomUUID();
  const lock = { owner_token: ownerToken, pid: process.pid, created_at: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { await writeFile(lockPath, `${JSON.stringify(lock)}\n`, { flag: "wx" }); break; }
    catch (error: unknown) {
      if (!isExistsError(error)) throw error;
      const stableLock = await readStableFile(lockPath, paths.controlRoot);
      const existing = JSON.parse(stableLock.bytes.toString("utf8")) as { owner_token?: string; pid?: number; created_at?: string };
      if (typeof existing.pid === "number" && processAlive(existing.pid)) throw new Error(`PPIRTV_SELECTOR_CUTOVER_LOCKED: owner=${existing.owner_token ?? "unknown"} pid=${existing.pid}`);
      if (identity(await lstat(lockPath)) !== stableLock.identity) throw new Error("PPIRTV_SELECTOR_CUTOVER_STALE_LOCK_IDENTITY_CHANGED");
      await unlink(lockPath);
      if (attempt === 1) throw new Error("PPIRTV_SELECTOR_CUTOVER_STALE_LOCK_RECOVERY_FAILED");
    }
  }
  try { return await operation(); }
  finally {
    if (await pathExists(lockPath)) {
      const stableLock = await readStableFile(lockPath, paths.controlRoot);
      const current = JSON.parse(stableLock.bytes.toString("utf8")) as { owner_token?: string };
      if (current.owner_token === ownerToken && identity(await lstat(lockPath)) === stableLock.identity) await unlink(lockPath);
    }
  }
}

async function readStableFile(filePath: string, controlRoot: string): Promise<{ bytes: Buffer; identity: string }> {
  const real = await realpath(filePath);
  assertWithinControlRoot(controlRoot, real, "read realpath");
  await requireRegularFile(filePath, "READ");
  const before = await lstat(filePath);
  const bytes = await readFile(filePath);
  const after = await lstat(filePath);
  const beforeId = identity(before);
  if (beforeId !== identity(after)) throw new Error("PPIRTV_SELECTOR_CUTOVER_FILE_IDENTITY_CHANGED");
  return { bytes, identity: beforeId };
}

async function publishFile(target: string, bytes: Buffer, controlRoot: string, expectedIdentity: string): Promise<void> {
  const current = await lstat(target);
  if (identity(current) !== expectedIdentity) throw new Error("PPIRTV_SELECTOR_CUTOVER_FILE_IDENTITY_CHANGED_BEFORE_PUBLISH");
  await atomicWrite(target, bytes, controlRoot);
  const published = await readStableFile(target, controlRoot);
  if (!published.bytes.equals(bytes)) throw new Error("PPIRTV_SELECTOR_CUTOVER_PUBLISH_VERIFY_FAILED");
}

async function writeJournal(paths: CutoverPaths, journal: MemoryWriterSelectorCutoverStatus): Promise<void> {
  validateJournalStrict(journal);
  await atomicWrite(paths.journalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`), paths.controlRoot);
}

async function atomicWrite(target: string, bytes: Buffer, controlRoot: string): Promise<void> {
  const parentReal = await realpath(path.dirname(target));
  assertWithinControlRoot(controlRoot, parentReal, "publish parent");
  const temporary = path.join(parentReal, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try { await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, target); }
  finally { if (await pathExists(temporary)) await unlink(temporary); }
}

async function exclusiveWrite(target: string, bytes: Buffer, controlRoot: string): Promise<void> {
  const parentReal = await realpath(path.dirname(target));
  assertWithinControlRoot(controlRoot, parentReal, "exclusive parent");
  await writeFile(target, bytes, { flag: "wx" });
  const stable = await readStableFile(target, controlRoot);
  if (!stable.bytes.equals(bytes)) throw new Error("PPIRTV_SELECTOR_CUTOVER_EXCLUSIVE_WRITE_VERIFY_FAILED");
}

function assertWithinControlRoot(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`PPIRTV_SELECTOR_CUTOVER_PATH_OUTSIDE_CONTROL_ROOT: ${label}`);
}

async function requireRegularFile(value: string, label: string): Promise<void> {
  const info = await lstat(value);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`PPIRTV_SELECTOR_CUTOVER_${label}_NOT_REGULAR_FILE`);
}

function identity(info: { dev: number | bigint; ino: number | bigint; size: number; mtimeMs: number }): string { return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`; }
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function escapeToml(value: string): string { return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function unescapeToml(value: string): string { return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\"); }
function samePath(left: string, right: string): boolean { const a = path.resolve(left).replace(/[\\/]+$/u, ""); const b = path.resolve(right).replace(/[\\/]+$/u, ""); return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b; }
function sameValue(actual: unknown, expected: unknown, paths: boolean): boolean { return paths && typeof actual === "string" && typeof expected === "string" ? samePath(actual, expected) : actual === expected; }
function assertExactKeys(value: object, expected: string[], label: string): void { const actual = Object.keys(value).sort(); const wanted = [...expected].sort(); if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`PPIRTV_SELECTOR_CUTOVER_${label}_KEYS_INVALID`); }
function isExistsError(error: unknown): boolean { return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST"; }
function processAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error: unknown) { return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM"; } }
async function pathExists(value: string): Promise<boolean> { try { await lstat(value); return true; } catch { return false; } }
