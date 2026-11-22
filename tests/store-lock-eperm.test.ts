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
// Referência REAL capturada ANTES de qualquer Once (getMockImplementation()
// após a fila esvaziar devolve a última Once — reentrar ali é recursão).
const realWriteFile = writeFileMock.getMockImplementation()!;

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
        return realWriteFile(target as never, data as never, options as never);
      }
      // O vencedor da corrida cria o lock NESTE instante (o perdedor não
      // viu EEXIST porque a criação dele perdeu por sharing violation)...
      await realWriteFile(target as never, `${JSON.stringify({ owner_token: "winner", pid: process.pid, created_at: new Date().toISOString() })}\n`, { flag: "w" });
      // ...e o solta quando sua operação conclui — SEM timer: a 1ª versão
      // (unlink por setTimeout 20ms) colidia com o retry de ~10ms do
      // perdedor no disco lento do runner e produzia EPERM REAL + lstat
      // ENOENT = fail-fast crú (CI run 44592021021). A saída agora é
      // coordenada: o vencedor sai ANTES do retry do perdedor adquirir.
      const race = new Error("EPERM: operation not permitted (simulated sharing violation)") as NodeJS.ErrnoException;
      race.code = "EPERM";
      throw race;
    });
    // Retry do perdedor: aquisição coordenada — o lock do vencedor sai e o do
    // perdedor entra DENTRO do mock (flag "w" após unlink awaited), sem
    // writeFile wx real concorrendo com unlink real (a classe exata da
    // sharing violation que o teste introduzia por acidente).
    writeFileMock.mockImplementationOnce(async (target: unknown, data: unknown, options: unknown) => {
      const flag = (options as { flag?: string } | undefined)?.flag;
      if (String(target) !== lockPath || flag !== "wx") {
        return realWriteFile(target as never, data as never, options as never);
      }
      await unlink(String(target)).catch(() => {});
      await realWriteFile(target as never, data as never, { flag: "w" });
    });

    const result = await store.withFlowLock(flowId, async () => "ok");

    expect(result).toBe("ok");
    // Lock liberado no fim da operação (o perdedor adquiriu e soltou).
    const { lstat } = await import("node:fs/promises");
    await expect(lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("EPERM REAL de permissão (lock nunca existe) rejeita rápido com contexto após o limite", async () => {
    const dir = await roots.create("ppirtv-lock-eperm-real-");
    const store = new PpirtvStore(dir, { fixtureOnlyNoncanonicalRoot: true });
    await store.init();
    // Mock PERSISTENTE (não Once): a cura dá retry limitado ao ENOENT — com
    // Once, a 2ª tentativa real (wx) ADQUIRIRIA o lock e o fail-fast viria
    // sucesso falso. Persistente = permissão negada em TODA rodada.
    writeFileMock.mockImplementation(async (target: unknown, _data: unknown, options: unknown) => {
      const flag = (options as { flag?: string } | undefined)?.flag;
      if (!String(target).endsWith(".meeting.lock") || flag !== "wx") {
        return realWriteFile(target as never, _data as never, options as never);
      }
      const denied = new Error("EPERM: operation not permitted (real permission denial)") as NodeJS.ErrnoException;
      denied.code = "EPERM";
      throw denied;
    });
    const startedAt = Date.now();
    try {
      await expect(store.withFlowLock("flow-eperm-denied", async () => "ok")).rejects.toMatchObject({
        code: "EPERM",
        message: expect.stringContaining("MEETING_LOCK_EPERM_PERSISTENT")
      });
      // Rápido: 3 rodadas de mock custam milissegundos — provar que NÃO
      // esperou o deadline de 35s do lock.
      expect(Date.now() - startedAt).toBeLessThan(10_000);
    } finally {
      writeFileMock.mockImplementation(realWriteFile);
    }
  });
});

// Frente E (GitHub #32, auditoria 377f94a): o ENOENT do lstat no ramo EPERM é
// AMÍGUO — pode ser o vencedor liberando o lock ENTRE a falha de criação e a
// consulta (ordem observada no CI; derrubou o run 44977965436 ao vivo). Hoje
// relança o EPERM crú: disputa que se resolveu sozinha vira erro fatal de
// permissão. Cura: continue limitado (3 rodadas EPERM+ENOENT consecutivas).
describe("frente E (#32) — liberação do lock ANTES da consulta (lstat ENOENT)", () => {
  const roots = createTempRootRegistry();

  it("vencedor libera o lock entre o EPERM e o lstat -> retry adquire e a operação conclui", async () => {
    const dir = await roots.create("ppirtv-lock-frentee-");
    const store = new PpirtvStore(dir, { fixtureOnlyNoncanonicalRoot: true });
    await store.init();
    const flowId = "flow-frentee-liberado";
    const lockPath = path.join(dir, "flows", `${flowId}.json.meeting.lock`);
    // O writeFile wx do perdedor perde a corrida (EPERM de sharing violation)
    // e o vencedor JÁ LIBEROU o lock quando o lstat consultar: nada no disco.
    writeFileMock.mockImplementationOnce(async (target: unknown, _data: unknown, options: unknown) => {
      const flag = (options as { flag?: string } | undefined)?.flag;
      if (String(target) !== lockPath || flag !== "wx") {
        return realWriteFile(target as never, _data as never, options as never);
      }
      const race = new Error("EPERM: operation not permitted (winner released before lstat)") as NodeJS.ErrnoException;
      race.code = "EPERM";
      throw race;
    });

    const result = await store.withFlowLock(flowId, async () => "ok");

    expect(result).toBe("ok");
    const { lstat } = await import("node:fs/promises");
    await expect(lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
