// CI run 5 (44509417046): "claims the idempotency key before concurrent
// first goal_start calls" morria com EPERM ao abrir o .meeting.lock — no
// Windows a sharing violation de criação/deleção concorrente do MESMO path
// é mapeada pelo Node como EPERM (errno -4048), não EEXIST. O loop do
// withFlowLock só tolerava EEXIST, então a disputa legítima de lock
// estourava como erro (lacuna de produção na frota Windows-first: dois
// agentes no mesmo flow batem a mesma corrida). Este teste REPRODUZ a
// disputa de forma determinística: o "vencedor" cria o lock no instante em
// que o "perdedor" recebe EPERM (não EEXIST), e o solta pouco depois.
//
// Mock: espionamos writeFile do "node:fs/promises" com mockImplementationOnce
// (a fila consome o Once primeiro; o default continua o writeFile REAL —
// nenhum outro consumidor do módulo é afetado).
import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PpirtvStore } from "../src/store.js";
import { createTempRootRegistry } from "./temp-root-registry.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

// O namespace importado AQUI é o mockado; o real mora no default do vi.fn.
import { writeFile } from "node:fs/promises";
const writeFileMock = vi.mocked(writeFile);

describe("withFlowLock — EPERM transitório de sharing violation (Windows, CI run 44509417046)", () => {
  const roots = createTempRootRegistry();

  it("EPERM com o lock aparecendo em corrida é tratado como disputa (retry), não erro", async () => {
    const dir = await roots.create("ppirtv-lock-eperm-");
    const store = new PpirtvStore(dir, { fixtureOnlyNoncanonicalRoot: true });
    await store.init();
    const flowId = "flow-eperm-race";
    const lockPath = path.join(dir, "flows", `${flowId}.json.meeting.lock`);
    writeFileMock.mockImplementationOnce(async (target: unknown, data: unknown, options: unknown) => {
      const flag = (options as { flag?: string } | undefined)?.flag;
      if (String(target) !== lockPath || flag !== "wx") {
        return writeFileMock.getMockImplementation()!(target as never, data as never, options as never);
      }
      // O vencedor da corrida cria o lock NESTE instante (o perdedor não
      // viu EEXIST porque a criação dele perdeu por sharing violation)...
      await writeFileMock.getMockImplementation()!(target as never, `${JSON.stringify({ owner_token: "winner", pid: process.pid, created_at: new Date().toISOString() })}\n`, { flag: "w" });
      // ...e o solta pouco depois (operação concluída), como no runner.
      setTimeout(() => { void unlink(String(target)).catch(() => {}); }, 20);
      const race = new Error("EPERM: operation not permitted (simulated sharing violation)") as NodeJS.ErrnoException;
      race.code = "EPERM";
      throw race;
    });

    const result = await store.withFlowLock(flowId, async () => "ok");

    expect(result).toBe("ok");
    // Lock liberado no fim da operação (o perdedor adquiriu e soltou).
    const { lstat } = await import("node:fs/promises");
    await expect(lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("EPERM REAL de permissão (path inexistente) continua fail-fast", async () => {
    const dir = await roots.create("ppirtv-lock-eperm-real-");
    const store = new PpirtvStore(dir, { fixtureOnlyNoncanonicalRoot: true });
    await store.init();
    writeFileMock.mockImplementationOnce(async (target: unknown, data: unknown, options: unknown) => {
      const flag = (options as { flag?: string } | undefined)?.flag;
      if (!String(target).endsWith(".meeting.lock") || flag !== "wx") {
        return writeFileMock.getMockImplementation()!(target as never, data as never, options as never);
      }
      const denied = new Error("EPERM: operation not permitted (real permission denial)") as NodeJS.ErrnoException;
      denied.code = "EPERM";
      throw denied;
    });

    await expect(store.withFlowLock("flow-eperm-denied", async () => "ok")).rejects.toMatchObject({ code: "EPERM" });
  });
});
