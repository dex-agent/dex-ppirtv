import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareMemoryWriterSelectorCutover, resumeMemoryWriterSelectorCutover, rollbackMemoryWriterSelectorCutover } from "../src/memory/memory-writer-selector-cutover.js";
import { createTempRootRegistry } from "./temp-root-registry.js";

const BEFORE = Buffer.from('[mcp_servers.dex_ppirtv.env]\r\nDEX_MEMORIA_HOME = "C:/synthetic/memories"\r\n', "utf8");

const tempRoots = createTempRootRegistry();

afterEach(async () => {
  await tempRoots.cleanup();
});

async function workspace() {
  const controlRoot = await tempRoots.create("ppirtv-selector-core-");
  const configPath = path.join(controlRoot, ".codex", "config.toml");
  const journalPath = path.join(controlRoot, ".agents", "CUTOVER", "selector.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, BEFORE);
  const canonical_root = path.join(controlRoot, "dex-memoria");
  return { controlRoot, configPath, journalPath, selector_before: "unconfigured", selector_after: "v2", canonical_root, entrypoint: path.join(canonical_root, "bin", "dex-memoria.js") };
}

describe("memory writer selector cutover control plane", () => {
  it("prepares without editing and resumes idempotently only to ACTIVATION_PENDING", async () => {
    const paths = await workspace();
    expect((await prepareMemoryWriterSelectorCutover(paths)).status).toBe("PENDING");
    expect(await readFile(paths.configPath)).toEqual(BEFORE);
    expect((await resumeMemoryWriterSelectorCutover(paths)).status).toBe("PENDING_RESTART");
    const applied = await readFile(paths.configPath);
    expect((await resumeMemoryWriterSelectorCutover(paths)).status).toBe("PENDING_RESTART");
    expect(await readFile(paths.configPath)).toEqual(applied);
  });

  it("rejects caller-provided hooks on the public core route", async () => {
    const paths = await workspace();
    await prepareMemoryWriterSelectorCutover(paths);
    await expect(resumeMemoryWriterSelectorCutover({ ...paths, restart_hook: async () => ({}) } as any)).rejects.toThrow("PPIRTV_SELECTOR_CUTOVER_MANUAL_RECEIPT_NOT_ACCEPTED");
  });

  it("restores exact bytes but remains pending when after may have been observed", async () => {
    const paths = await workspace();
    await prepareMemoryWriterSelectorCutover(paths);
    await resumeMemoryWriterSelectorCutover(paths);
    expect((await rollbackMemoryWriterSelectorCutover(paths)).status).toBe("PENDING_RESTART");
    expect(await readFile(paths.configPath)).toEqual(BEFORE);
    expect((await rollbackMemoryWriterSelectorCutover(paths)).status).toBe("PENDING_RESTART");
  });
});
