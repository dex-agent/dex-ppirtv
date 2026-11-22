// R19 — abertura obrigatória: as 3 perguntas base viram gate (GO PADRAO do
// dono no desenho do $o-arquiteto, 2026-11-22).
//
// O bloco `abertura` do Trilho SPT v3 carrega as 3 respostas (contexto =
// o que sabemos / ferramentas = o que temos / mentor = qual
// mentor-documental interrogar na dificuldade). O preflight S12 cobra a
// PRESENÇA não-vazia dos 3 (forma determinística — doc 10 lei 1: o hook
// cobra a forma, o LLM paga o conteúdo); o validateSpt do motor rejeita SPT
// sem o bloco na cadeia MCP.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..");
const PREFLIGHT = path.join(REPO, "spt-kit", "preflight.mjs");
const MOLDE = readFileSync(path.join(REPO, "spt-kit", "MOLDE.md"), "utf8");
// O bloco YAML real começa no primeiro '---' DE LINHA (a prosa do MOLDE cita
// '---' dentro de instrução — vacina da frente H).
const MOLDE_BLOCK = MOLDE.slice(MOLDE.indexOf("\n---\n") + 1);
// Cenário "sem abertura": o MOLDE CURADO carrega o bloco — a fixture remove
// (linhas de `abertura:` + subcampos indentados) para simular o Trilho
// escrito sem pagar as 3 perguntas.
const MOLDE_SEM_ABERTURA = MOLDE_BLOCK.replace(/^abertura:\n(?:  .*\n)+/m, "");

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

async function fixture(doc: string): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-r19-"));
  const trilho = path.join(tempRoot, "trilho.md");
  await writeFile(trilho, doc, "utf8");
  return trilho;
}

// Achados = exit != 0 (execFileSync lança) — stdout vem no erro (vacina frente H).
const runPreflight = (trilho: string): string => {
  try {
    return execFileSync(process.execPath, [PREFLIGHT, trilho], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { stdout?: string | Buffer };
    return (e.stdout ?? "").toString();
  }
};

describe("R19 — bloco abertura obrigatório no SPT v3 (preflight S12)", () => {
  it("SEM o bloco abertura dispara S12 — o MOLDE sem bloco não passa mais", async () => {
    const trilho = await fixture(MOLDE_SEM_ABERTURA);
    const out = runPreflight(trilho);
    expect(out).toContain("S12");
  });

  it("COM o bloco completo LIMPA o S12", async () => {
    const comBloco = MOLDE_BLOCK.replace(
      /^goal:/m,
      ["abertura:", "  contexto: 'pagamos $dex-find-contexto-integrado'", "  ferramentas: 'pagamos $dex-find-tools'", "  mentor: 'mentor-documental-do-assunto'", "goal:"].join("\n")
    );
    const trilho = await fixture(comBloco);
    const out = runPreflight(trilho);
    expect(out).not.toContain("S12");
  });

  it("bloco INCOMPLETO dispara S12 nomeando o campo faltante — diagnóstico que ensina", async () => {
    const incompleto = MOLDE_BLOCK.replace(
      /^goal:/m,
      ["abertura:", "  contexto: 'so isto'", "goal:"].join("\n")
    );
    const trilho = await fixture(incompleto);
    const out = runPreflight(trilho);
    expect(out).toContain("S12");
    expect(out).toContain("ferramentas");
  });
});
