import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryCandidate } from "../src/domain.js";
import { writeMemoryCandidate } from "../src/memory/memory-writer.js";

let tempRoot = "";

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  tempRoot = "";
});

describe("memory writer hardening", () => {
  it("propagates non-ENOENT read errors instead of appending over unknown state", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-writer-"));
    const l1AsDirectory = path.join(tempRoot, "LEMBRANCA.md");
    await mkdir(l1AsDirectory, { recursive: true });
    const candidate = buildCandidate([
      l1AsDirectory,
      path.join(tempRoot, "MEMORIA.md")
    ]);

    await expect(writeMemoryCandidate(candidate)).rejects.toThrow(/EISDIR|illegal operation.*read/i);
  });
});

function buildCandidate(targetFiles: string[]): MemoryCandidate {
  return {
    id: "mc_read_error",
    title: "Memoria com erro de leitura",
    source: "gold_mining",
    scope: "projeto",
    layer: "L2",
    has_l1: true,
    score: { reaproveitamento: 2, evidencia: 2, custo_esquecimento: 1, transferibilidade: 1, total: 6 },
    confidence: "media",
    l1_gatilho: "[MEMORY-READ-ERROR] Memoria com erro de leitura.",
    l2_bloco: "## Memoria com erro de leitura\n\nProblema: erro real nao pode virar arquivo vazio.",
    target_files: targetFiles,
    blocked: false,
    blocked_reason: null
  };
}
