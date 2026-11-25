// @regressao github:32 github:46 tracker:0038 familia:lock-eperm assinatura:"EPERM: operation not permitted, open '[^']*\.meeting\.lock'"
//
// Trilho E — a CLASSE dos erros transitórios do lock (GitHub #32 e #46;
// TRACKER local 0038; CI runs 44509417046, 44592021021, 44970769615,
// 44972221596, 44975462717, 44977965436, 44978793534, 45203987470).
//
// Quatro curas pontuais foram feitas uma a uma, cada uma descoberta num run
// vermelho novo, e cada teste novo fixava A SEQUÊNCIA daquela emenda
// (tests/issue-0046-lock-disputa-intercalada.test.ts ensaia uma). Este teste
// fixa a classe: todas as sequências de até 3 rodadas do alfabeto que o CI já
// mostrou, mais as de 5 e 6 com EPERM intercalado (a sonda do #46).
//
// Alfabeto (uma rodada = uma volta do laço de aquisição do withFlowLock):
//   A   criação → EPERM; o lock NÃO existe na consulta (lstat ENOENT)
//   BD  criação → EEXIST; o lock já saiu quando é lido (readFile ENOENT)
//   BC  criação → EEXIST; a leitura dá EPERM (remoção pendente no Windows)
//   PE  criação → EPERM; existe um lock STALE (titular morto) — quebra de stale
//   PJ  criação → EPERM; existe o lock do PRÓPRIO processo — espera e adquire
// PJ é terminal (deixa o lock adquirido); as outras devolvem o mundo com o
// lock livre, por isso toda sequência é model-closed.
//
// Invariante: a operação só NÃO roda quando três A consecutivos provam
// permissão negada (MEETING_LOCK_EPERM_PERSISTENT). Errno cru de
// EPERM/EEXIST/ENOENT escapando é falha daqui. Até 3 rodadas bastam para o
// laço inteiro: o contador só tem os estados 0, 1 e 2.
//
// Mock e fixture: tests/helpers/fs-promises-mock.ts (primeiro import — instala
// o mock de node:fs/promises antes de src/).
import { PID_MORTO, ehCriacaoDoLock, erroDeSistema, fsPromises, registroDeLock } from "./helpers/fs-promises-mock.js";
import { lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PpirtvStore } from "../src/store.js";
import { createTempRootRegistry } from "./temp-root-registry.js";

const { writeFile: writeFileMock, readFile: readFileMock, realWriteFile, realReadFile } = fsPromises;

type Rodada = "A" | "BD" | "BC" | "PE" | "PJ";
const NAO_TERMINAIS: Rodada[] = ["A", "BD", "BC", "PE"];
const NOME: Record<Rodada, string> = {
  A: "EPERM+ausente",
  BD: "EEXIST+leitura-ENOENT",
  BC: "EEXIST+leitura-EPERM",
  PE: "EPERM+stale",
  PJ: "EPERM+próprio"
};
// Eventos que a rodada precisa VIVER no laço.
const VIVIDOS: Record<Rodada, string[]> = {
  A: ["A"],
  BD: ["BD"],
  BC: ["BC", "BC·leitura"],
  PE: ["PE"],
  PJ: ["PJ", "PJ·aquisição"]
};

function enfileirar(lockPath: string, rodadas: Rodada[]): () => string[] {
  // Cada evento entra aqui SÓ quando o mock intercepta o lock de verdade: a
  // lista final prova que o laço viveu as rodadas.
  const vividos: string[] = [];
  const criarFalhando = (code: "EPERM" | "EEXIST", evento: string, lockDeOutro?: string) =>
    async (target: unknown, data: unknown, options: unknown) => {
      if (!ehCriacaoDoLock(target, options, lockPath)) {
        return realWriteFile(target as never, data as never, options as never);
      }
      vividos.push(evento);
      if (lockDeOutro !== undefined) await realWriteFile(target as never, lockDeOutro, { flag: "w" });
      throw erroDeSistema(code);
    };
  for (const rodada of rodadas) {
    if (rodada === "A") {
      writeFileMock.mockImplementationOnce(criarFalhando("EPERM", "A"));
    } else if (rodada === "BD") {
      writeFileMock.mockImplementationOnce(criarFalhando("EEXIST", "BD"));
    } else if (rodada === "BC") {
      writeFileMock.mockImplementationOnce(criarFalhando("EEXIST", "BC"));
      readFileMock.mockImplementationOnce(async (target: unknown, encoding: unknown) => {
        if (String(target) !== lockPath) return realReadFile(target as never, encoding as never);
        vividos.push("BC·leitura");
        throw erroDeSistema("EPERM");
      });
    } else if (rodada === "PE") {
      writeFileMock.mockImplementationOnce(criarFalhando("EPERM", "PE", registroDeLock("stale", PID_MORTO)));
    } else {
      writeFileMock.mockImplementationOnce(criarFalhando("EPERM", "PJ", registroDeLock("nosso-outro", process.pid)));
      // O titular (o próprio processo) solta o lock e a criação acontece em
      // seguida — coordenado, como em tests/store-lock-eperm.test.ts (flag "w"
      // após unlink: sem wx real disputando com o unlink real).
      writeFileMock.mockImplementationOnce(async (target: unknown, data: unknown, options: unknown) => {
        if (!ehCriacaoDoLock(target, options, lockPath)) {
          return realWriteFile(target as never, data as never, options as never);
        }
        vividos.push("PJ·aquisição");
        await unlink(lockPath).catch(() => {});
        await realWriteFile(target as never, data as never, { flag: "w" });
      });
    }
  }
  return () => vividos;
}

// Todas as sequências de 1 a `max` rodadas não-terminais; as que ainda não
// reprovaram ganham também uma versão com PJ no fim. 4 + 16 + 64 = 84 prefixos
// com max = 3; um deles ([A, A, A]) já é permissão persistente e não alcança PJ.
function sequencias(max: number): Rodada[][] {
  const saida: Rodada[][] = [];
  const gerar = (prefixo: Rodada[]) => {
    if (prefixo.length > 0) {
      saida.push(prefixo);
      if (!persiste(prefixo)) saida.push([...prefixo, "PJ"]);
    }
    if (prefixo.length === max) return;
    for (const rodada of NAO_TERMINAIS) gerar([...prefixo, rodada]);
  };
  gerar([]);
  return saida;
}

// "A" é a única rodada de uma letra: três A seguidos são a única fonte de
// "AAA" na junção.
const persiste = (rodadas: Rodada[]) => rodadas.join("").includes("AAA");
const resumo = (rodadas: Rodada[]) => rodadas.map((rodada) => NOME[rodada]).join(" → ");
const EXAUSTIVAS = sequencias(3).map((rodadas) => ({ rodadas, persistente: persiste(rodadas) }));
// As longas que o exaustivo curto não alcança: EPERM intercalado (a sonda do
// auditor do #46 é A → BD → A → BD → A) e o limiar no fim da sequência.
const LONGAS: Array<{ rodadas: Rodada[]; persistente: boolean }> = [
  { rodadas: ["A", "BD", "A", "BD", "A"], persistente: false },
  { rodadas: ["A", "BC", "A", "BC", "A"], persistente: false },
  { rodadas: ["A", "PE", "A", "PE", "A"], persistente: false },
  { rodadas: ["A", "A", "BD", "A", "A", "A"], persistente: true }
];
const CASOS = [...EXAUSTIVAS, ...LONGAS].map((caso, indice) => ({
  ...caso,
  indice,
  rotulo: resumo(caso.rodadas),
  desfecho: caso.persistente ? "PERSISTENT" : "adquire"
}));

describe("withFlowLock — a classe dos erros transitórios (todas as sequências do alfabeto do CI)", () => {
  const roots = createTempRootRegistry();
  let dir = "";
  let store!: PpirtvStore;

  beforeAll(async () => {
    dir = await roots.create("ppirtv-lock-classe-");
    store = new PpirtvStore(dir, { fixtureOnlyNoncanonicalRoot: true });
    await store.init();
  });

  // Um caso que falha pode deixar mockImplementationOnce na fila: sem a
  // limpeza, o caso seguinte herdaria a rodada dele (168 falhas em cascata na
  // primeira versão deste arquivo, por causa de UM caso).
  afterEach(() => fsPromises.limparFilas());

  it("premissa: o gerador produz todas as sequências (84 prefixos + 83 com PJ + 4 longas)", () => {
    expect(EXAUSTIVAS.length).toBe(84 + 83);
    expect(new Set(EXAUSTIVAS.map((caso) => caso.rodadas.join(","))).size).toBe(EXAUSTIVAS.length);
    expect(EXAUSTIVAS.filter((caso) => caso.rodadas.at(-1) === "PJ").length).toBe(83);
    expect(CASOS.filter((caso) => caso.persistente).length).toBe(2);
  });

  it.each(CASOS)(
    "$rotulo → $desfecho",
    async ({ rodadas, persistente, indice }) => {
      const flowId = `flow-classe-${indice}`;
      const lockPath = path.join(dir, "flows", `${flowId}.json.meeting.lock`);
      const vividos = enfileirar(lockPath, rodadas);
      const operacao = vi.fn(async () => "ok");

      if (persistente) {
        await expect(store.withFlowLock(flowId, operacao)).rejects.toMatchObject({
          code: "EPERM",
          message: expect.stringContaining("MEETING_LOCK_EPERM_PERSISTENT")
        });
        expect(operacao).not.toHaveBeenCalled();
      } else {
        await expect(store.withFlowLock(flowId, operacao)).resolves.toBe("ok");
        expect(operacao).toHaveBeenCalledTimes(1);
      }

      // Premissa do ensaio: toda rodada enfileirada foi vivida, na ordem.
      expect(vividos()).toEqual(rodadas.flatMap((rodada) => VIVIDOS[rodada]));
      // O lock nunca fica para trás (adquirido e solto, ou nunca criado).
      await expect(lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  );
});
