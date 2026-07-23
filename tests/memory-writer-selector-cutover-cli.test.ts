import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMemoryWriterSelectorCutoverCli } from "../src/memory-writer-selector-cutover-cli.js";

const CONFIG = '[mcp_servers.dex_ppirtv.env]\nPPIRTV_MEMORY_WRITER_PROFILE = "legacy-v1"\nDEX_MEMORIA_HOME = "C:/synthetic/memories"\n';

async function workspace() {
  const controlRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-selector-workspace-"));
  const configPath = path.join(controlRoot, ".codex", "config.toml");
  const journalPath = path.join(controlRoot, ".agents", "CUTOVER", "memory-writer-selector.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, CONFIG, "utf8");
  return { controlRoot, configPath, journalPath };
}

function baseArgs(command: string, paths: Awaited<ReturnType<typeof workspace>>) {
  return [command, "--control-root", paths.controlRoot, "--config", paths.configPath, "--journal", paths.journalPath];
}

function prepareArgs(paths: Awaited<ReturnType<typeof workspace>>) {
  const canonicalRoot = path.join(paths.controlRoot, "dex-memoria");
  return [
    ...baseArgs("prepare", paths), "--before", "legacy-v1", "--after", "v2",
    "--canonical-root", canonicalRoot, "--entrypoint", path.join(canonicalRoot, "bin", "dex-memoria.js")
  ];
}

function receiptFrom(status: any, reason: "activate" | "rollback") {
  const activating = reason === "activate";
  const bundle = activating ? status.bundle_after : status.bundle_before;
  return {
    contract: "dex.ppirtv.memory-writer-selector.restart-receipt.v2",
    action: activating ? status.activation_action : status.rollback_action,
    reason,
    challenge: activating ? status.activation_challenge : status.rollback_challenge,
    config_path: status.config_path,
    config_sha256: activating ? status.selector_after_sha256 : status.selector_before_sha256,
    workspace: status.control_root,
    canonical_root: bundle.canonical_root,
    entrypoint: bundle.entrypoint,
    memory_home: bundle.memory_home,
    profile: bundle.profile ?? "unconfigured",
    effective_profile: reason === "activate" ? status.bundle_after.profile : (status.bundle_before.profile ?? "unconfigured"),
    effective_canonical_root: reason === "activate" ? status.bundle_after.canonical_root : null,
    effective_entrypoint: reason === "activate" ? status.bundle_after.entrypoint : null,
    effective_memory_home: bundle.memory_home,
    process_generation: `process-${reason}`,
    session_generation: `session-${reason}`,
    evidence: `temporary workspace runtime observed ${reason}`,
    at: "2026-07-19T13:00:00.000Z"
  };
}

describe("memory writer selector cutover CLI", () => {
  it("drives prepare/status/resume/rollback without fabricating restart evidence", async () => {
    const paths = await workspace();
    const output: string[] = [];
    const io = { stdout: (line: string) => output.push(line) };

    expect(await runMemoryWriterSelectorCutoverCli(prepareArgs(paths), io)).toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({ status: "PENDING" });

    expect(await runMemoryWriterSelectorCutoverCli(baseArgs("resume", paths), io)).toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({ status: "PENDING_RESTART" });
    expect(await readFile(paths.configPath, "utf8")).toContain('PPIRTV_MEMORY_WRITER_PROFILE = "v2"');

    expect(await runMemoryWriterSelectorCutoverCli(baseArgs("status", paths), io)).toBe(0);
    const activationStatus = JSON.parse(output.pop()!);
    expect(activationStatus).toMatchObject({ state: "ACTIVATION_PENDING", runtime_activation: { status: "restart_required" } });

    const receiptPath = path.join(paths.controlRoot, ".agents", "CUTOVER", "restart-receipt.json");
    await writeFile(receiptPath, JSON.stringify(receiptFrom(activationStatus, "activate")));
    await expect(runMemoryWriterSelectorCutoverCli([
      ...baseArgs("resume", paths), "--restart-receipt", receiptPath
    ], io)).rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_MANUAL_RECEIPT_NOT_ACCEPTED");
  });

  it("rejects config and journal paths outside the explicit control root", async () => {
    const paths = await workspace();
    const outsideConfig = path.join(path.dirname(paths.controlRoot), "outside-config.toml");
    await writeFile(outsideConfig, CONFIG, "utf8");

    await expect(runMemoryWriterSelectorCutoverCli([
      "prepare", "--control-root", paths.controlRoot, "--config", outsideConfig,
      "--journal", paths.journalPath, "--before", "legacy-v1", "--after", "v2",
      "--canonical-root", path.join(paths.controlRoot, "dex-memoria"),
      "--entrypoint", path.join(paths.controlRoot, "dex-memoria", "bin", "dex-memoria.js")
    ], { stdout: () => undefined })).rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_PATH_OUTSIDE_CONTROL_ROOT");
  });

  it("rejects selector profiles outside the public cutover contract", async () => {
    const invalidBefore = await workspace();
    await expect(runMemoryWriterSelectorCutoverCli([
      ...baseArgs("prepare", invalidBefore), "--before", "mystery-v0", "--after", "v2",
      "--canonical-root", path.join(invalidBefore.controlRoot, "dex-memoria"),
      "--entrypoint", path.join(invalidBefore.controlRoot, "dex-memoria", "bin", "dex-memoria.js")
    ], { stdout: () => undefined })).rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_ARG_INVALID: --before");

    const invalidAfter = await workspace();
    await expect(runMemoryWriterSelectorCutoverCli([
      ...baseArgs("prepare", invalidAfter), "--before", "legacy-v1", "--after", "v3",
      "--canonical-root", path.join(invalidAfter.controlRoot, "dex-memoria"),
      "--entrypoint", path.join(invalidAfter.controlRoot, "dex-memoria", "bin", "dex-memoria.js")
    ], { stdout: () => undefined })).rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_ARG_INVALID: --after");
  });

  it("documents both valid before states without inventing legacy-v1 for an absent key", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("--before unconfigured --after v2");
    expect(readme).toContain("--before legacy-v1 --after v2");
  });

  it("runs as an executable process against explicit workspace paths", async () => {
    const paths = await workspace();
    await runMemoryWriterSelectorCutoverCli(prepareArgs(paths), { stdout: () => undefined });

    const processResult = await runCliProcess(baseArgs("status", paths));
    expect(processResult.code).toBe(0);
    expect(JSON.parse(processResult.stdout)).toMatchObject({ state: "PREPARED", config_path: expect.any(String) });
  });
});

function runCliProcess(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/memory-writer-selector-cutover-cli.ts", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
