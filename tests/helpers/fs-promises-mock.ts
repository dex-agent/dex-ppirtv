// Mock de node:fs/promises para testes de disputa de lock: writeFile e readFile
// viram vi.fn cujo padrão é a implementação REAL (nenhum outro consumidor do
// módulo é afetado); só as chamadas interceptadas por mockImplementationOnce
// desviam.
//
// Importe este módulo ANTES de qualquer módulo de src/: o vi.mock é içado para
// o topo DESTE arquivo e vale para todo import avaliado depois dele. Um teste
// que importe src/ primeiro enxerga o fs real — e a própria premissa do ensaio
// (toda rodada enfileirada foi vivida) acusa.
import { readFile, writeFile } from "node:fs/promises";
import { vi } from "vitest";

export * from "./lock-fixture.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), readFile: vi.fn(actual.readFile) };
});

// O namespace importado AQUI é o mockado; o real mora no padrão do vi.fn. A
// referência REAL é capturada NA CARGA — antes de qualquer Once
// (getMockImplementation() depois de a fila esvaziar não serve para reentrar).
const writeFileMock = vi.mocked(writeFile);
const readFileMock = vi.mocked(readFile);
const realWriteFile = writeFileMock.getMockImplementation()!;
const realReadFile = readFileMock.getMockImplementation()!;

export const fsPromises = {
  writeFile: writeFileMock,
  readFile: readFileMock,
  realWriteFile,
  realReadFile,
  /** Descarta mockImplementationOnce que sobrou: um caso que falha não contamina o próximo. */
  limparFilas(): void {
    writeFileMock.mockReset();
    writeFileMock.mockImplementation(realWriteFile);
    readFileMock.mockReset();
    readFileMock.mockImplementation(realReadFile);
  }
};
