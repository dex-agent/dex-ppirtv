// Trilho R — GitHub #46 (2ª rodada do auditor; reabre #32) e o teste
// intermitente do runner Windows.
//
// #46: no catch do withFlowLock (src/store.ts) o contador epermEnoentRounds só
// zera quando um EPERM encontra o arquivo PRESENTE no lstat. Uma tentativa
// EEXIST no meio (disputa comprovada: o lock de outra pessoa existiu) não zera
// — a sequência EPERM, EEXIST, EPERM, EEXIST, EPERM com o arquivo livre na
// consulta soma 3 e termina em MEETING_LOCK_EPERM_PERSISTENT.
//
// Intermitente (tests/meeting-outcome "serializes many concurrent meeting
// opens on the same flow"; CI runs 45024229827 e 45203987470): o EPERM não é
// na CRIAÇÃO do lock — é na LEITURA. readStableFlowLock faz lstat e depois
// readFile; entre os dois o outro titular remove o arquivo e o Windows devolve
// EPERM no open de arquivo com remoção pendente. O catch da leitura no laço de
// aquisição só tolera ENOENT e MEETING_LOCK_IDENTITY_CHANGED: o resto vira
// erro fatal de uma operação legítima.
//
// Mock: mesmo padrão de tests/store-lock-eperm.test.ts (Once no módulo
// node:fs/promises; default = implementação real). Os its de caracterização de
// lá NUNCA podam — a permissão negada em rodadas consecutivas segue falhando
// rápido.
import { lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PpirtvStore } from "../src/store.js";
import { createTempRootRegistry } from "./temp-root-registry.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), readFile: vi.fn(actual.readFile) };
});

// O namespace importado AQUI é o mockado; o real mora no default do vi.fn.
// Referência REAL capturada ANTES de qualquer Once (getMockImplementation()
// após a fila esvaziar devolve a última Once — reentrar ali é recursão).
import { readFile, writeFile } from "node:fs/promises";
const writeFileMock = vi.mocked(writeFile);
const readFileMock = vi.mocked(readFile);
const realWriteFile = writeFileMock.getMockImplementation()!;
const realReadFile = readFileMock.getMockImplementation()!;

const erro = (code: string, mensagem: string) => Object.assign(new Error(mensagem), { code }) as NodeJS.ErrnoException;
const ehCriacaoDoLock = (target: unknown, options: unknown, lockPath: string) =>
  String(target) === lockPath && (options as { flag?: string } | undefined)?.flag === "wx";

describe("withFlowLock — disputa de lock lida como disputa (Trilho R)", () => {
  const roots = createTempRootRegistry();

  it("#46: EPERM intercalado por EEXIST com o lock livre na consulta adquire em vez de MEETING_LOCK_EPERM_PERSISTENT", async () => {
    const dir = await roots.create("ppirtv-lock-intercalado-");
    const store = new PpirtvStore(dir, { fixtureOnlyNoncanonicalRoot: true });
    await store.init();
    const flowId = "flow-intercalado";
    const lockPath = path.join(dir, "flows", `${flowId}.json.meeting.lock`);
    // Sonda do auditor: 5 falhas de criação simuladas e o arquivo NUNCA existe
    // quando consultado. O EEXIST é a disputa comprovada — o lock de outra
    // pessoa existiu no instante da criação e já saiu.
    for (const code of ["EPERM", "EEXIST", "EPERM", "EEXIST", "EPERM"]) {
      writeFileMock.mockImplementationOnce(async (target: unknown, data: unknown, options: unknown) => {
        if (!ehCriacaoDoLock(target, options, lockPath)) {
          return realWriteFile(target as never, data as never, options as never);
        }
        throw erro(code, `${code}: operation not permitted (simulado)`);
      });
    }

    const result = await store.withFlowLock(flowId, async () => "ok");

    expect(result).toBe("ok");
    await expect(lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("intermitente do Windows: EPERM na LEITURA do lock durante a aquisição repete a tentativa em vez de abortar a operação", async () => {
    const dir = await roots.create("ppirtv-lock-leitura-eperm-");
    const store = new PpirtvStore(dir, { fixtureOnlyNoncanonicalRoot: true });
    await store.init();
    const flowId = "flow-leitura-eperm";
    const lockPath = path.join(dir, "flows", `${flowId}.json.meeting.lock`);
    // A criação perde para o lock de outro titular (EEXIST clássico)...
    writeFileMock.mockImplementationOnce(async (target: unknown, data: unknown, options: unknown) => {
      if (!ehCriacaoDoLock(target, options, lockPath)) {
        return realWriteFile(target as never, data as never, options as never);
      }
      await realWriteFile(
        target as never,
        `${JSON.stringify({ owner_token: "outro-titular", pid: process.pid, created_at: new Date().toISOString() })}\n`,
        { flag: "w" }
      );
      throw erro("EEXIST", "EEXIST: file already exists (lock de outro titular)");
    });
    // ...e entre o lstat e o readFile desse lock o outro titular o remove: o
    // Windows devolve EPERM no open de arquivo com remoção pendente.
    readFileMock.mockImplementationOnce(async (target: unknown, encoding: unknown) => {
      if (String(target) !== lockPath) {
        return realReadFile(target as never, encoding as never);
      }
      await unlink(lockPath).catch(() => {});
      throw erro("EPERM", "EPERM: operation not permitted, open (remoção pendente no Windows)");
    });

    const result = await store.withFlowLock(flowId, async () => "ok");

    expect(result).toBe("ok");
    await expect(lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
