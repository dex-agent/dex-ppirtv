import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PPIRTV_RUNTIME_DIRS, resolveRuntimePaths } from "../src/config.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot?.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  tempRoot = undefined;
});

describe("PPIRTV runtime path resolution", () => {
  it("uses <cwd>/.ppirtv when PPIRTV_HOME is absent", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-runtime-paths-"));
    const runtime = resolveRuntimePaths(tempRoot, {});
    const canonicalRoot = await realPath(tempRoot);

    expect(runtime.projectRoot).toBe(canonicalRoot);
    expect(runtime.ppirtvHome).toBe(path.join(canonicalRoot, ".ppirtv"));
    expect(runtime.ledgerPath).toBe(path.join(canonicalRoot, ".ppirtv", "ledger.ndjson"));
    expect(runtime.dirs.flows).toBe(path.join(canonicalRoot, ".ppirtv", "flows"));
  });

  it("accepts PPIRTV_HOME only when it resolves to <cwd>/.ppirtv", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-runtime-paths-"));
    const configured = `${path.join(tempRoot, ".ppirtv")}${path.sep}`;
    const runtime = resolveRuntimePaths(tempRoot, { PPIRTV_HOME: configured });

    expect(runtime.ppirtvHome).toBe(path.join(await realPath(tempRoot), ".ppirtv"));
  });

  it("accepts Windows canonical aliases that point at the same workspace", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-runtime-paths-"));
    const runtime = resolveRuntimePaths(await realPath(tempRoot), { PPIRTV_HOME: path.join(tempRoot, ".ppirtv") });

    expect(runtime.ppirtvHome).toBe(path.join(await realPath(tempRoot), ".ppirtv"));
  });

  it("rejects PPIRTV_HOME from another workspace with an actionable error", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-runtime-paths-"));
    const workspaceA = path.join(tempRoot, "workspace-a");
    const workspaceB = path.join(tempRoot, "workspace-b");
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });

    expect(() => resolveRuntimePaths(workspaceA, { PPIRTV_HOME: path.join(workspaceB, ".ppirtv") })).toThrow(
      /PPIRTV_HOME.*workspace-a.*workspace-b/i
    );
  });

  it("creates the complete canonical runtime layout", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-runtime-layout-"));
    const store = new PpirtvStore(path.join(tempRoot, ".ppirtv"));
    await store.init();

    const created = await readdir(path.join(tempRoot, ".ppirtv"));
    expect(created).toEqual(expect.arrayContaining([...PPIRTV_RUNTIME_DIRS, "ledger.ndjson"]));
  });
});

async function realPath(target: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(target);
}
