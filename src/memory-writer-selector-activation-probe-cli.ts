#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  getMemoryWriterSelectorCutoverStatus,
  type MemoryWriterSelectorRestartReceipt,
  type RestartAction,
  type RestartReason
} from "./memory/memory-writer-selector-cutover.js";

const execFileAsync = promisify(execFile);
type CliIo = { stdout: (line: string) => void };

export async function runMemoryWriterSelectorActivationProbeCli(argv: string[], io: CliIo = { stdout: console.log }): Promise<number> {
  const options = parseOptions(argv);
  const controlRoot = required(options, "control-root");
  const configPath = required(options, "config");
  const journalPath = required(options, "journal");
  const receiptPath = required(options, "receipt");
  const serverName = required(options, "server");
  const reason = enumValue(options, "reason", ["activate", "rollback"] as const);
  const action = enumValue(options, "action", ["restart", "reconnect"] as const);
  const status = await getMemoryWriterSelectorCutoverStatus({ controlRoot, configPath, journalPath });
  if (serverName !== status.server_name) throw new Error("PPIRTV_SELECTOR_CUTOVER_SERVER_MISMATCH");
  const activating = reason === "activate";
  const expectedAction = activating ? status.activation_action : status.rollback_action;
  if (action !== expectedAction) throw new Error("PPIRTV_SELECTOR_PROBE_ACTION_MISMATCH");
  const challenge = activating ? status.activation_challenge : status.rollback_challenge;
  if (!challenge) throw new Error("PPIRTV_SELECTOR_PROBE_CHALLENGE_NOT_READY");
  const expectedHash = activating ? status.selector_after_sha256 : status.selector_before_sha256;
  const configBefore = await readStable(configPath);
  if (sha256(configBefore.bytes) !== expectedHash) throw new Error("PPIRTV_SELECTOR_PROBE_CONFIG_HASH_MISMATCH");

  if (activating) {
    await requireOperationalV2Capability(status.bundle_after.canonical_root, status.bundle_after.entrypoint);
  }

  const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await runSmoke(installRoot, configPath, serverName);
  if (result.server?.enabled !== true) throw new Error("PPIRTV_SELECTOR_PROBE_SERVER_DISABLED");
  if (!result.ok || !result.runtime_probe) throw new Error("PPIRTV_SELECTOR_PROBE_RUNTIME_RECEIPT_MISSING");
  const configAfter = await readStable(configPath);
  if (configAfter.identity !== configBefore.identity || sha256(configAfter.bytes) !== expectedHash) throw new Error("PPIRTV_SELECTOR_PROBE_CONFIG_CHANGED_DURING_PROBE");
  const statusAfter = await getMemoryWriterSelectorCutoverStatus({ controlRoot, configPath, journalPath });
  const challengeAfter = activating ? statusAfter.activation_challenge : statusAfter.rollback_challenge;
  if (challengeAfter !== challenge || (activating ? statusAfter.selector_after_sha256 : statusAfter.selector_before_sha256) !== expectedHash) {
    throw new Error("PPIRTV_SELECTOR_PROBE_JOURNAL_CHANGED_DURING_PROBE");
  }
  const observed = result.runtime_probe;
  const bundle = activating ? status.bundle_after : status.bundle_before;
  const expectedProfile = bundle.profile ?? "unconfigured";
  requireSamePath(observed.project_root, status.control_root, "WORKSPACE");
  if (observed.configured_memory_bundle?.profile !== expectedProfile) throw new Error("PPIRTV_SELECTOR_PROBE_CONFIGURED_PROFILE_MISMATCH");
  requireNullablePath(observed.configured_memory_bundle?.canonical_root, bundle.canonical_root, "CONFIGURED_CANONICAL_ROOT");
  requireNullablePath(observed.configured_memory_bundle?.entrypoint, bundle.entrypoint, "CONFIGURED_ENTRYPOINT");
  requireNullablePath(observed.configured_memory_bundle?.memory_home, bundle.memory_home, "CONFIGURED_MEMORY_HOME");
  const effectiveProfile = activating ? status.bundle_after.profile! : (status.bundle_before.profile ?? "unconfigured");
  const effectiveCanonicalRoot = activating ? status.bundle_after.canonical_root : null;
  const effectiveEntrypoint = activating ? status.bundle_after.entrypoint : null;
  if (observed.memory_writer_runtime?.profile !== effectiveProfile) throw new Error("PPIRTV_SELECTOR_PROBE_EFFECTIVE_PROFILE_MISMATCH");
  requireSamePath(observed.memory_writer_runtime?.workspace_root, status.control_root, "WRITER_WORKSPACE");
  requireNullablePath(observed.memory_writer_runtime?.canonical_root, effectiveCanonicalRoot, "EFFECTIVE_CANONICAL_ROOT");
  requireNullablePath(observed.memory_writer_runtime?.entrypoint, effectiveEntrypoint, "EFFECTIVE_ENTRYPOINT");
  requireNullablePath(observed.memory_writer_runtime?.memory_home, bundle.memory_home, "MEMORY_HOME");
  if (!observed.process_generation || !observed.session_generation || !observed.process_id) throw new Error("PPIRTV_SELECTOR_PROBE_GENERATION_MISSING");

  const receipt: MemoryWriterSelectorRestartReceipt = {
    contract: "dex.ppirtv.memory-writer-selector.restart-receipt.v2",
    server_name: status.server_name,
    action,
    reason,
    challenge,
    config_path: status.config_path,
    config_sha256: expectedHash,
    workspace: status.control_root,
    canonical_root: bundle.canonical_root,
    entrypoint: bundle.entrypoint,
    memory_home: bundle.memory_home,
    profile: expectedProfile,
    effective_profile: effectiveProfile,
    effective_canonical_root: effectiveCanonicalRoot,
    effective_entrypoint: effectiveEntrypoint,
    effective_memory_home: bundle.memory_home,
    process_generation: observed.process_generation,
    session_generation: observed.session_generation,
    evidence: `runtime_probe process_id=${observed.process_id}`,
    at: new Date().toISOString()
  };
  await writeReceiptExclusive(controlRoot, receiptPath, receipt);
  io.stdout(JSON.stringify({ status: "RECEIPT_WRITTEN", receipt_path: await realpath(receiptPath), receipt }));
  return 0;
}

type RuntimeProbe = {
  project_root?: string;
  configured_memory_bundle?: { profile?: string; canonical_root?: string | null; entrypoint?: string | null; memory_home?: string | null };
  memory_writer_runtime?: { profile?: string; workspace_root?: string; canonical_root?: string | null; entrypoint?: string | null; memory_home?: string | null };
  process_generation?: string;
  session_generation?: string;
  process_id?: number;
};

type SmokeResult = { ok?: boolean; server?: { enabled?: boolean }; runtime_probe?: RuntimeProbe; runtime_config_check?: { code?: string } };

async function runSmoke(installRoot: string, configPath: string, serverName: string): Promise<SmokeResult> {
  try {
    const smoke = await execFileAsync(
      process.execPath,
      [path.join(installRoot, "scripts", "smoke-mcp-tools.mjs"), "--config-toml", configPath, "--server", serverName],
      { cwd: installRoot, maxBuffer: 1024 * 1024 }
    );
    return JSON.parse(smoke.stdout) as SmokeResult;
  } catch (error: unknown) {
    const stdout = typeof error === "object" && error !== null && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "";
    try {
      const result = JSON.parse(stdout) as SmokeResult;
      if (result.runtime_config_check?.code === "mcp_server_disabled") throw new Error("PPIRTV_SELECTOR_PROBE_SERVER_DISABLED");
    } catch (parsed: unknown) {
      if (parsed instanceof Error && parsed.message === "PPIRTV_SELECTOR_PROBE_SERVER_DISABLED") throw parsed;
    }
    throw error;
  }
}

type CapabilityReceipt = {
  contract?: unknown;
  capability?: unknown;
  require_obsidian?: unknown;
  expected_require_obsidian?: unknown;
  ok?: unknown;
  errors?: unknown;
};

async function requireOperationalV2Capability(canonicalRootValue: string | null, entrypointValue: string | null): Promise<void> {
  if (!canonicalRootValue) throw new Error("PPIRTV_SELECTOR_PROBE_CANONICAL_ROOT_NOT_DIRECTORY");
  if (!entrypointValue) throw new Error("PPIRTV_SELECTOR_PROBE_ENTRYPOINT_NOT_REGULAR_FILE");

  const canonicalRoot = path.resolve(canonicalRootValue);
  const entrypoint = path.resolve(entrypointValue);
  const rootStat = await safeLstat(canonicalRoot);
  if (rootStat?.isSymbolicLink()) throw new Error("PPIRTV_SELECTOR_PROBE_CANONICAL_ROOT_SYMLINK");
  if (!rootStat?.isDirectory()) throw new Error("PPIRTV_SELECTOR_PROBE_CANONICAL_ROOT_NOT_DIRECTORY");
  const rootReal = await realpath(canonicalRoot);

  if (!isInside(canonicalRoot, entrypoint)) throw new Error("PPIRTV_SELECTOR_PROBE_ENTRYPOINT_OUTSIDE_CANONICAL_ROOT");
  const entrypointStat = await safeLstat(entrypoint);
  if (entrypointStat?.isSymbolicLink()) throw new Error("PPIRTV_SELECTOR_PROBE_ENTRYPOINT_SYMLINK");
  if (!entrypointStat?.isFile()) throw new Error("PPIRTV_SELECTOR_PROBE_ENTRYPOINT_NOT_REGULAR_FILE");
  const entrypointReal = await realpath(entrypoint);
  if (!isInside(rootReal, entrypointReal)) throw new Error("PPIRTV_SELECTOR_PROBE_ENTRYPOINT_OUTSIDE_CANONICAL_ROOT");

  const receipt = await runCapabilityCli(rootReal, entrypointReal);
  const expectedKeys = ["capability", "contract", "errors", "expected_require_obsidian", "ok", "require_obsidian"];
  const actualKeys = Object.keys(receipt).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)
    || receipt.contract !== "dex.memory.capability.receipt.v2"
    || receipt.capability !== "v2-obsidian"
    || receipt.require_obsidian !== true
    || receipt.expected_require_obsidian !== true
    || receipt.ok !== true
    || !Array.isArray(receipt.errors)
    || receipt.errors.length !== 0) {
    throw new Error("PPIRTV_SELECTOR_PROBE_CAPABILITY_RECEIPT_INVALID");
  }
}

async function safeLstat(filePath: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(filePath);
  } catch {
    return null;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function runCapabilityCli(canonicalRoot: string, entrypoint: string): Promise<CapabilityReceipt> {
  const payload = JSON.stringify({
    capability: "v2-obsidian",
    require_obsidian: true,
    block_ids: [],
    markdown_links: ["activation-probe"],
    wikilinks: ["activation-probe"],
    backlinks: ["L1->L2", "L2->L1"],
    unresolved_markdown_links: [],
    unresolved_wikilinks: []
  });
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, "v2", "capability"], {
      cwd: canonicalRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let settled = false;
    let output = "";
    let diagnostic = "";
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("PPIRTV_SELECTOR_PROBE_CAPABILITY_EXECUTION_FAILED")));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 64 * 1024) {
        child.kill();
        finish(() => reject(new Error("PPIRTV_SELECTOR_PROBE_CAPABILITY_RECEIPT_INVALID")));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      diagnostic += chunk;
      if (diagnostic.length > 64 * 1024) child.kill();
    });
    child.on("error", () => finish(() => reject(new Error("PPIRTV_SELECTOR_PROBE_CAPABILITY_EXECUTION_FAILED"))));
    child.on("close", (code) => finish(() => code === 0
      ? resolve(output)
      : reject(new Error("PPIRTV_SELECTOR_PROBE_CAPABILITY_EXECUTION_FAILED"))));
    child.stdin.end(`${payload}\n`);
  });
  try {
    return JSON.parse(stdout.trim()) as CapabilityReceipt;
  } catch {
    throw new Error("PPIRTV_SELECTOR_PROBE_CAPABILITY_RECEIPT_INVALID");
  }
}

async function writeReceiptExclusive(controlRoot: string, receiptPath: string, receipt: MemoryWriterSelectorRestartReceipt): Promise<void> {
  const requestedRoot = path.resolve(controlRoot);
  const target = path.resolve(receiptPath);
  const relative = path.relative(requestedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("PPIRTV_SELECTOR_PROBE_RECEIPT_OUTSIDE_CONTROL_ROOT");
  const root = await realpath(requestedRoot);
  await mkdir(path.dirname(target), { recursive: true });
  const parent = await realpath(path.dirname(target));
  const parentRelative = path.relative(root, parent);
  if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) throw new Error("PPIRTV_SELECTOR_PROBE_RECEIPT_PARENT_OUTSIDE_CONTROL_ROOT");
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  const publishedPath = await realpath(target);
  const before = await lstat(publishedPath);
  const published = JSON.parse(await readFile(publishedPath, "utf8")) as MemoryWriterSelectorRestartReceipt;
  const after = await lstat(publishedPath);
  if (`${before.dev}:${before.ino}:${before.size}:${before.mtimeMs}` !== `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}`) throw new Error("PPIRTV_SELECTOR_PROBE_RECEIPT_IDENTITY_CHANGED");
  if (published.challenge !== receipt.challenge || published.config_sha256 !== receipt.config_sha256) throw new Error("PPIRTV_SELECTOR_PROBE_RECEIPT_PUBLISH_VERIFY_FAILED");
}

function parseOptions(argv: string[]): Map<string, string> { const result = new Map<string, string>(); for (let index = 0; index < argv.length; index += 2) { const key = argv[index]; const value = argv[index + 1]; if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error(`PPIRTV_SELECTOR_PROBE_ARG_INVALID: ${key ?? "<missing>"}`); result.set(key.slice(2), value); } return result; }
function required(options: Map<string, string>, name: string): string { const value = options.get(name)?.trim(); if (!value) throw new Error(`PPIRTV_SELECTOR_PROBE_ARG_REQUIRED: --${name}`); return value; }
function enumValue<T extends readonly string[]>(options: Map<string, string>, name: string, values: T): T[number] { const value = required(options, name); if (!values.includes(value)) throw new Error(`PPIRTV_SELECTOR_PROBE_ARG_INVALID: --${name}`); return value as T[number]; }
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
async function readStable(filePath: string): Promise<{ bytes: Buffer; identity: string }> { const resolved = await realpath(filePath); const before = await lstat(resolved); if (!before.isFile() || before.isSymbolicLink()) throw new Error("PPIRTV_SELECTOR_PROBE_CONFIG_NOT_REGULAR_FILE"); const bytes = await readFile(resolved); const after = await lstat(resolved); const beforeIdentity = `${before.dev}:${before.ino}:${before.size}:${before.mtimeMs}`; if (beforeIdentity !== `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}`) throw new Error("PPIRTV_SELECTOR_PROBE_CONFIG_IDENTITY_CHANGED"); return { bytes, identity: beforeIdentity }; }
function samePath(left: string, right: string): boolean { const a = path.resolve(left).replace(/[\\/]+$/u, ""); const b = path.resolve(right).replace(/[\\/]+$/u, ""); return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b; }
function requireSamePath(actual: string | undefined, expected: string, label: string): void { if (!actual || !samePath(actual, expected)) throw new Error(`PPIRTV_SELECTOR_PROBE_${label}_MISMATCH`); }
function requireNullablePath(actual: string | null | undefined, expected: string | null, label: string): void { if (actual === null && expected === null) return; if (!actual || !expected || !samePath(actual, expected)) throw new Error(`PPIRTV_SELECTOR_PROBE_${label}_MISMATCH`); }

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  runMemoryWriterSelectorActivationProbeCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
