import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMemoryWriterConfigFromEnv } from "../src/config.js";

describe("server memory writer selector", () => {
  it("reports an unconfigured non-writer when no explicit selector is configured", () => {
    expect(resolveMemoryWriterConfigFromEnv({})).toEqual({ profile: "unconfigured" });
  });

  it("keeps legacy-v1 only when the compatibility profile is explicit", () => {
    expect(resolveMemoryWriterConfigFromEnv({ PPIRTV_MEMORY_WRITER_PROFILE: "legacy-v1" })).toEqual({ profile: "legacy-v1" });
  });

  it("requires explicit canonical root and entrypoint before selecting V2", () => {
    expect(() => resolveMemoryWriterConfigFromEnv({ PPIRTV_MEMORY_WRITER_PROFILE: "v2" })).toThrow(
      "PPIRTV_DEX_MEMORIA_V2_CONFIG_REQUIRED"
    );
    const canonicalRoot = path.resolve("C:/synthetic/dex-memoria");
    const entrypoint = path.join(canonicalRoot, "bin", "dex-memoria.js");

    expect(() => resolveMemoryWriterConfigFromEnv({
      PPIRTV_MEMORY_WRITER_PROFILE: "v2",
      PPIRTV_DEX_MEMORIA_CANONICAL_ROOT: canonicalRoot,
      PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT: entrypoint
    })).toThrow("PPIRTV_DEX_MEMORIA_HOME_REQUIRED");
    expect(() => resolveMemoryWriterConfigFromEnv({
      PPIRTV_MEMORY_WRITER_PROFILE: "v2", PPIRTV_DEX_MEMORIA_CANONICAL_ROOT: canonicalRoot,
      PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT: entrypoint, DEX_MEMORIA_HOME: "relative-memory-home",
      PPIRTV_WORKSPACE: path.resolve("synthetic-workspace")
    })).toThrow("PPIRTV_DEX_MEMORIA_HOME_MUST_BE_ABSOLUTE");

    const memoryHome = path.resolve("synthetic-memory-home");
    const workspaceRoot = path.resolve("synthetic-workspace");
    expect(() => resolveMemoryWriterConfigFromEnv({
      PPIRTV_MEMORY_WRITER_PROFILE: "v2", PPIRTV_DEX_MEMORIA_CANONICAL_ROOT: canonicalRoot,
      PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT: entrypoint, DEX_MEMORIA_HOME: memoryHome,
      PPIRTV_WORKSPACE_ROOT: workspaceRoot
    })).toThrow("PPIRTV_DEX_MEMORIA_V2_WORKSPACE_REQUIRED");

    const selected = resolveMemoryWriterConfigFromEnv({
      PPIRTV_MEMORY_WRITER_PROFILE: "v2", PPIRTV_DEX_MEMORIA_CANONICAL_ROOT: canonicalRoot,
      PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT: entrypoint, DEX_MEMORIA_HOME: memoryHome,
      PPIRTV_WORKSPACE: workspaceRoot
    });

    expect(selected).toMatchObject({ profile: "v2", memory_home: memoryHome, workspace_root: workspaceRoot, executor: { execute: expect.any(Function), resume: expect.any(Function) } });
  });
});
