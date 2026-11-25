import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryRuntimeStore } from "../src/memory/memory-store.js";
import type { MemoryRuntimeRecord } from "../src/memory/memory-types.js";

// Toda chave que a fonte dona (SECRET_KEY_PATTERN) considera segredo tem de ser
// redigida no que o runtime de memoria grava em disco. A copia privada de regex
// deste arquivo cobria menos chaves que a dona (untangle rodada 2, C1).

async function recordOnDisk(data: Record<string, unknown>): Promise<string> {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-store-redaction-"));
  const store = new MemoryRuntimeStore(runtimeRoot);
  const record: MemoryRuntimeRecord = {
    id: "probe",
    flow_id: "flow-probe",
    phase: "pensamentos",
    type: "hook",
    created_at: "2026-11-25T12:00:00.000Z",
    data
  };
  await store.appendUnique("hooks", record);
  return readFile(path.join(runtimeRoot, "memory", "hooks.jsonl"), "utf8");
}

describe("MemoryRuntimeStore redacao por nome de chave", () => {
  it("redige a chave token (controle positivo do proprio teste)", async () => {
    const onDisk = await recordOnDisk({ token: "valor-de-prova-a" });
    expect(onDisk).toContain("\"token\":\"[redacted]\"");
    expect(onDisk).not.toContain("valor-de-prova-a");
  });

  it.each(["credential", "private_key", "client_credentials", "PRIVATE-KEY"])
  ("redige a chave %s como a fonte dona de segredo", async (key) => {
    const onDisk = await recordOnDisk({ [key]: "valor-de-prova-b", nota: "fica" });
    expect(JSON.parse(onDisk.trim()).data[key]).toBe("[redacted]");
    expect(onDisk).not.toContain("valor-de-prova-b");
    expect(JSON.parse(onDisk.trim()).data.nota).toBe("fica");
  });
});
