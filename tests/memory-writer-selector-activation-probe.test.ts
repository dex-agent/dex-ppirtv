import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMemoryWriterSelectorCutoverCli } from "../src/memory-writer-selector-cutover-cli.js";
import {
  prepareMemoryWriterSelectorCutover,
  resumeMemoryWriterSelectorCutover,
  rollbackMemoryWriterSelectorCutover,
  type MemoryWriterSelectorRestartReceipt
} from "../src/memory/memory-writer-selector-cutover.js";
import { createTempRootRegistry } from "./temp-root-registry.js";

const tempRoots = createTempRootRegistry();

afterEach(async () => {
  await tempRoots.cleanup();
});

describe("memory writer selector causal activation probe", () => {
  it("starts a new MCP launcher and derives a challenge-bound receipt from observed runtime", async () => {
    const controlRoot = await tempRoots.create("ppirtv-selector-probe-");
    const configPath = path.join(controlRoot, ".codex", "config.toml");
    const journalPath = path.join(controlRoot, ".agents", "CUTOVER", "memory-writer-selector.json");
    const canonicalRoot = path.join(controlRoot, "dex-memoria");
    const entrypoint = path.join(canonicalRoot, "bin", "dex-memoria.js");
    const memoryHome = path.join(controlRoot, "memory-home");
    const stagedCanonicalRoot = path.join(controlRoot, "staged-dex-memoria");
    const stagedEntrypoint = path.join(stagedCanonicalRoot, "bin", "dex-memoria.js");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(path.join(controlRoot, "AGENTS.md"), "# synthetic consumer\n", "utf8");
    await writeFile(configPath, [
      "[mcp_servers.dex_ppirtv]",
      'command = "node"',
      `args = ["${toml(path.join(process.cwd(), "dist", "launcher.js"))}", "--workspace", "${toml(controlRoot)}"]`,
      `cwd = "${toml(process.cwd())}"`,
      "",
      "[mcp_servers.dex_ppirtv.env]",
      `DEX_MEMORIA_HOME = "${toml(memoryHome)}"`,
      `PPIRTV_DEX_MEMORIA_CANONICAL_ROOT = "${toml(stagedCanonicalRoot)}"`,
      `PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT = "${toml(stagedEntrypoint)}"`,
      ""
    ].join("\n"), "utf8");
    await writeCapabilityCli(entrypoint);

    const paths = {
      controlRoot, configPath, journalPath,
      selector_before: "unconfigured", selector_after: "v2",
      canonical_root: canonicalRoot, entrypoint
    };
    await prepareMemoryWriterSelectorCutover(paths);
    expect((await resumeMemoryWriterSelectorCutover(paths)).status).toBe("PENDING_RESTART");

    const output: string[] = [];
    expect(await runMemoryWriterSelectorCutoverCli([
      "confirm",
      "--control-root", controlRoot, "--config", configPath, "--journal", journalPath,
      "--server", "dex_ppirtv", "--reason", "activate", "--action", "restart"
    ], { stdout: (line) => output.push(line) })).toBe(0);
    expect(JSON.parse(output[0])).toMatchObject({ status: "COMMITTED" });
    const committedJournal = JSON.parse(await readFile(journalPath, "utf8"));
    const receipt = committedJournal.runtime_activation.receipt as MemoryWriterSelectorRestartReceipt;
    expect(receipt).toMatchObject({
      contract: "dex.ppirtv.memory-writer-selector.restart-receipt.v2",
      reason: "activate",
      action: "restart",
      workspace: expect.any(String),
      canonical_root: canonicalRoot,
      entrypoint,
      memory_home: memoryHome,
      profile: "v2",
      process_generation: expect.any(String),
      session_generation: expect.any(String)
    });
    expect((await rollbackMemoryWriterSelectorCutover(paths)).status).toBe("PENDING_RESTART");
    expect(await runMemoryWriterSelectorCutoverCli([
      "confirm",
      "--control-root", controlRoot, "--config", configPath, "--journal", journalPath,
      "--server", "dex_ppirtv", "--reason", "rollback", "--action", "restart"
    ], { stdout: () => undefined })).toBe(0);
    const rolledBackJournal = JSON.parse(await readFile(journalPath, "utf8"));
    const rollbackReceipt = rolledBackJournal.rollback_activation.receipt as MemoryWriterSelectorRestartReceipt;
    expect(rollbackReceipt).toMatchObject({
      reason: "rollback", profile: "unconfigured",
      canonical_root: stagedCanonicalRoot, entrypoint: stagedEntrypoint,
      effective_profile: "unconfigured", effective_canonical_root: null, effective_entrypoint: null
    });
  }, 15_000);

  it("rejects confirmation when the selected dex_ppirtv server is disabled", async () => {
    const fixture = await cutoverFixture({ enabled: false });
    await prepareMemoryWriterSelectorCutover(fixture.paths);
    await resumeMemoryWriterSelectorCutover(fixture.paths);

    await expect(runMemoryWriterSelectorCutoverCli([
      "confirm",
      "--control-root", fixture.controlRoot, "--config", fixture.configPath, "--journal", fixture.journalPath,
      "--server", "dex_ppirtv", "--reason", "activate", "--action", "restart"
    ], { stdout: () => undefined })).rejects.toThrow("PPIRTV_SELECTOR_PROBE_SERVER_DISABLED");
  }, 15_000);

  it("preserves legacy-v1 when the before profile is explicitly configured", async () => {
    const fixture = await cutoverFixture({ explicitLegacy: true });
    await prepareMemoryWriterSelectorCutover(fixture.paths);
    await resumeMemoryWriterSelectorCutover(fixture.paths);
    await runMemoryWriterSelectorCutoverCli([
      "confirm",
      "--control-root", fixture.controlRoot, "--config", fixture.configPath, "--journal", fixture.journalPath,
      "--server", "dex_ppirtv", "--reason", "activate", "--action", "restart"
    ], { stdout: () => undefined });
    await rollbackMemoryWriterSelectorCutover(fixture.paths);
    await runMemoryWriterSelectorCutoverCli([
      "confirm",
      "--control-root", fixture.controlRoot, "--config", fixture.configPath, "--journal", fixture.journalPath,
      "--server", "dex_ppirtv", "--reason", "rollback", "--action", "restart"
    ], { stdout: () => undefined });

    const journal = JSON.parse(await readFile(fixture.journalPath, "utf8"));
    expect(journal.rollback_activation.receipt).toMatchObject({
      profile: "legacy-v1",
      effective_profile: "legacy-v1"
    });
  }, 15_000);

  it("rejects confirmation through a server name not bound to the cutover journal", async () => {
    const fixture = await cutoverFixture({ includeAlias: true });
    await prepareMemoryWriterSelectorCutover(fixture.paths);
    await resumeMemoryWriterSelectorCutover(fixture.paths);

    await expect(runMemoryWriterSelectorCutoverCli([
      "confirm",
      "--control-root", fixture.controlRoot, "--config", fixture.configPath, "--journal", fixture.journalPath,
      "--server", "dex_ppirtv_alias", "--reason", "activate", "--action", "restart"
    ], { stdout: () => undefined })).rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_SERVER_MISMATCH");
  }, 15_000);

  it("rejects activation when the configured canonical root does not exist", async () => {
    const fixture = await cutoverFixture({ canonicalState: "missing-root" });
    await prepareMemoryWriterSelectorCutover(fixture.paths);
    await resumeMemoryWriterSelectorCutover(fixture.paths);

    await expect(confirmActivation(fixture)).rejects.toThrow("PPIRTV_SELECTOR_PROBE_CANONICAL_ROOT_NOT_DIRECTORY");
  });

  it("rejects activation when the configured entrypoint is not a regular file", async () => {
    const fixture = await cutoverFixture({ canonicalState: "entrypoint-directory" });
    await prepareMemoryWriterSelectorCutover(fixture.paths);
    await resumeMemoryWriterSelectorCutover(fixture.paths);

    await expect(confirmActivation(fixture)).rejects.toThrow("PPIRTV_SELECTOR_PROBE_ENTRYPOINT_NOT_REGULAR_FILE");
  });

  it("rejects activation when the entrypoint escapes the canonical root", async () => {
    const fixture = await cutoverFixture({ canonicalState: "outside-entrypoint" });
    await prepareMemoryWriterSelectorCutover(fixture.paths);
    await resumeMemoryWriterSelectorCutover(fixture.paths);

    await expect(confirmActivation(fixture)).rejects.toThrow("PPIRTV_SELECTOR_PROBE_ENTRYPOINT_OUTSIDE_CANONICAL_ROOT");
  });

  it("rejects activation through a symlinked canonical root", async () => {
    const fixture = await cutoverFixture({ canonicalState: "symlink-root" });
    await prepareMemoryWriterSelectorCutover(fixture.paths);
    await resumeMemoryWriterSelectorCutover(fixture.paths);

    await expect(confirmActivation(fixture)).rejects.toThrow("PPIRTV_SELECTOR_PROBE_CANONICAL_ROOT_SYMLINK");
  });

  it("requires the selected CLI to return the exact successful V2 capability receipt", async () => {
    const fixture = await cutoverFixture({ canonicalState: "invalid-capability" });
    await prepareMemoryWriterSelectorCutover(fixture.paths);
    await resumeMemoryWriterSelectorCutover(fixture.paths);

    await expect(confirmActivation(fixture)).rejects.toThrow("PPIRTV_SELECTOR_PROBE_CAPABILITY_RECEIPT_INVALID");
  });
});

type CanonicalState = "valid" | "missing-root" | "entrypoint-directory" | "outside-entrypoint" | "symlink-root" | "invalid-capability";

async function cutoverFixture(options: { enabled?: boolean; includeAlias?: boolean; explicitLegacy?: boolean; canonicalState?: CanonicalState }) {
  const controlRoot = await tempRoots.create("ppirtv-selector-probe-boundary-");
  const configPath = path.join(controlRoot, ".codex", "config.toml");
  const journalPath = path.join(controlRoot, ".agents", "CUTOVER", "memory-writer-selector.json");
  const canonicalRoot = path.join(controlRoot, "dex-memoria");
  const canonicalState = options.canonicalState ?? "valid";
  const entrypoint = canonicalState === "outside-entrypoint"
    ? path.join(controlRoot, "outside", "dex-memoria.js")
    : path.join(canonicalRoot, "bin", "dex-memoria.js");
  const memoryHome = path.join(controlRoot, "memory-home");
  const launcher = toml(path.join(process.cwd(), "dist", "launcher.js"));
  const serverBlock = (name: string, enabled: boolean, v2: boolean, explicitLegacy = false) => [
    `[mcp_servers.${name}]`,
    `enabled = ${enabled}`,
    'command = "node"',
    `args = ["${launcher}", "--workspace", "${toml(controlRoot)}"]`,
    `cwd = "${toml(process.cwd())}"`,
    "",
    `[mcp_servers.${name}.env]`,
    `DEX_MEMORIA_HOME = "${toml(memoryHome)}"`,
    ...(explicitLegacy ? ['PPIRTV_MEMORY_WRITER_PROFILE = "legacy-v1"'] : []),
    ...(v2 ? [
      'PPIRTV_MEMORY_WRITER_PROFILE = "v2"',
      `PPIRTV_DEX_MEMORIA_CANONICAL_ROOT = "${toml(canonicalRoot)}"`,
      `PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT = "${toml(entrypoint)}"`
    ] : []),
    ""
  ];
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(path.join(controlRoot, "AGENTS.md"), "# synthetic consumer\n", "utf8");
  if (canonicalState === "entrypoint-directory") {
    await mkdir(entrypoint, { recursive: true });
  } else if (canonicalState === "outside-entrypoint") {
    await mkdir(canonicalRoot, { recursive: true });
    await writeCapabilityCli(entrypoint);
  } else if (canonicalState === "symlink-root") {
    const physicalRoot = path.join(controlRoot, "physical-dex-memoria");
    await writeCapabilityCli(path.join(physicalRoot, "bin", "dex-memoria.js"));
    await symlink(physicalRoot, canonicalRoot, "junction");
  } else if (canonicalState !== "missing-root") {
    await writeCapabilityCli(entrypoint, canonicalState === "invalid-capability");
  }
  await writeFile(configPath, [
    ...serverBlock("dex_ppirtv", options.enabled ?? true, false, options.explicitLegacy ?? false),
    ...(options.includeAlias ? serverBlock("dex_ppirtv_alias", true, true) : [])
  ].join("\n"), "utf8");
  return {
    controlRoot, configPath, journalPath,
    paths: {
      controlRoot, configPath, journalPath,
      selector_before: options.explicitLegacy ? "legacy-v1" : "unconfigured", selector_after: "v2",
      canonical_root: canonicalRoot, entrypoint
    }
  };
}

async function confirmActivation(fixture: Awaited<ReturnType<typeof cutoverFixture>>): Promise<number> {
  return runMemoryWriterSelectorCutoverCli([
    "confirm",
    "--control-root", fixture.controlRoot, "--config", fixture.configPath, "--journal", fixture.journalPath,
    "--server", "dex_ppirtv", "--reason", "activate", "--action", "restart"
  ], { stdout: () => undefined });
}

async function writeCapabilityCli(entrypoint: string, invalid = false): Promise<void> {
  await mkdir(path.dirname(entrypoint), { recursive: true });
  const receipt = invalid
    ? { contract: "dex.memory.capability.receipt.v2", capability: "v2-obsidian", require_obsidian: true, expected_require_obsidian: true, ok: true, errors: [], untrusted_extra: true }
    : { contract: "dex.memory.capability.receipt.v2", capability: "v2-obsidian", require_obsidian: true, expected_require_obsidian: true, ok: true, errors: [] };
  await writeFile(entrypoint, [
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => {",
    "  const request = JSON.parse(input);",
    "  if (process.argv[2] !== 'v2' || process.argv[3] !== 'capability' || request.capability !== 'v2-obsidian') process.exit(9);",
    `  process.stdout.write(${JSON.stringify(JSON.stringify(receipt))} + '\\n');`,
    "});",
    ""
  ].join("\n"), "utf8");
}

function toml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
