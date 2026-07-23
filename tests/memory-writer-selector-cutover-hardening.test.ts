import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getMemoryWriterSelectorCutoverStatus,
  prepareMemoryWriterSelectorCutover,
  resumeMemoryWriterSelectorCutover,
  type MemoryWriterSelectorRestartRequest
} from "../src/memory/memory-writer-selector-cutover.js";

const BEFORE_WITHOUT_PROFILE = [
  "[mcp_servers.dex_ppirtv.env]",
  'DEX_MEMORIA_HOME = "C:/synthetic/memories"',
  'UNRELATED = "preserve-me"',
  ""
].join("\r\n");

async function workspace() {
  const controlRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-selector-hardening-"));
  const configPath = path.join(controlRoot, ".codex", "config.toml");
  const journalPath = path.join(controlRoot, ".agents", "CUTOVER", "memory-writer-selector.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(configPath, BEFORE_WITHOUT_PROFILE, "utf8");
  return {
    controlRoot,
    configPath,
    journalPath,
    selector_before: "unconfigured",
    selector_after: "v2",
    canonical_root: path.join(controlRoot, "dex-memoria"),
    entrypoint: path.join(controlRoot, "dex-memoria", "bin", "dex-memoria.js")
  };
}

function causalReceipt(request: MemoryWriterSelectorRestartRequest) {
  return {
    contract: "dex.ppirtv.memory-writer-selector.restart-receipt.v2" as const,
    action: request.expected_action,
    reason: request.reason,
    challenge: request.challenge,
    config_path: request.config_path,
    config_sha256: request.expected_config_sha256,
    workspace: request.workspace,
    canonical_root: request.canonical_root,
    entrypoint: request.entrypoint,
    memory_home: request.memory_home,
    profile: request.expected_profile,
    effective_profile: request.effective_profile,
    effective_canonical_root: request.effective_canonical_root,
    effective_entrypoint: request.effective_entrypoint,
    effective_memory_home: request.effective_memory_home,
    process_generation: "process-2",
    session_generation: "session-2",
    evidence: "new MCP process returned the observed runtime summary",
    at: "2026-07-19T14:00:00.000Z"
  };
}

describe("selector cutover hardening", () => {
  it("inserts the complete V2 bundle when the selector is absent and preserves DEX_MEMORIA_HOME", async () => {
    const paths = await workspace();
    await prepareMemoryWriterSelectorCutover(paths);
    expect((await getMemoryWriterSelectorCutoverStatus(paths)).state).toBe("PREPARED");
    expect(await readFile(paths.configPath, "utf8")).toBe(BEFORE_WITHOUT_PROFILE);

    expect((await resumeMemoryWriterSelectorCutover(paths)).status).toBe("PENDING_RESTART");
    const after = await readFile(paths.configPath, "utf8");
    expect(after).toContain('PPIRTV_MEMORY_WRITER_PROFILE = "v2"');
    expect(after).toContain(`PPIRTV_DEX_MEMORIA_CANONICAL_ROOT = "${paths.canonical_root.replace(/\\/g, "\\\\")}"`);
    expect(after).toContain(`PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT = "${paths.entrypoint.replace(/\\/g, "\\\\")}"`);
    expect(after).toContain('DEX_MEMORIA_HOME = "C:/synthetic/memories"');
    expect((await getMemoryWriterSelectorCutoverStatus(paths)).state).toBe("ACTIVATION_PENDING");
  });

  it("rejects legacy-v1 as the declared before profile when the selector key is absent", async () => {
    const paths = await workspace();
    await expect(prepareMemoryWriterSelectorCutover({ ...paths, selector_before: "legacy-v1" }))
      .rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_UNEXPECTED_PROFILE: unconfigured");
  });

  it("rejects every caller-supplied receipt hook on the public core route", async () => {
    const paths = await workspace();
    await prepareMemoryWriterSelectorCutover(paths);
    await resumeMemoryWriterSelectorCutover(paths);
    await expect(resumeMemoryWriterSelectorCutover({
      ...paths,
      restart_hook: async (request: MemoryWriterSelectorRestartRequest) => causalReceipt(request)
    } as any)).rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_MANUAL_RECEIPT_NOT_ACCEPTED");
  });

  it("recovers a stale mutex but rejects a live owner", async () => {
    const stale = await workspace();
    await writeFile(`${stale.journalPath}.lock`, JSON.stringify({ owner_token: "stale", pid: 2147483647, created_at: "2026-07-19T00:00:00Z" }));
    expect((await prepareMemoryWriterSelectorCutover(stale)).status).toBe("PENDING");

    const live = await workspace();
    await writeFile(`${live.journalPath}.lock`, JSON.stringify({ owner_token: "live", pid: process.pid, created_at: new Date().toISOString() }));
    await expect(prepareMemoryWriterSelectorCutover(live)).rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_LOCKED");
  });

  it("reuses a byte-identical orphan snapshot without overwriting it", async () => {
    const paths = await workspace();
    const snapshotPath = `${paths.journalPath}.selector-before.bin`;
    await writeFile(snapshotPath, BEFORE_WITHOUT_PROFILE, { flag: "wx" });
    const before = await readFile(snapshotPath);

    await prepareMemoryWriterSelectorCutover(paths);
    expect(await readFile(snapshotPath)).toEqual(before);
    expect((await getMemoryWriterSelectorCutoverStatus(paths)).state).toBe("PREPARED");
  });

  it("rejects journal fields outside the exact versioned contract", async () => {
    const paths = await workspace();
    await prepareMemoryWriterSelectorCutover(paths);
    const journal = JSON.parse(await readFile(paths.journalPath, "utf8"));
    journal.unexpected = "must fail closed";
    await writeFile(paths.journalPath, JSON.stringify(journal));

    await expect(getMemoryWriterSelectorCutoverStatus(paths)).rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_JOURNAL_KEYS_INVALID");
  });
});
