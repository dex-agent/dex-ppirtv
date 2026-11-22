// Frente H — GitHub #39 (auditoria 377f94a): S11 decide por nomes COMPLETOS.
//
// O fiscal S11 do spt-kit/preflight.mjs testava !/npm run check/.test(proc)
// — casamento por SUBSTRING: "npm run check:capacity" CONTÉM o prefixo
// "npm run check", então um ER com prova PARCIAL de tipos (tsc -p src-only)
// acompanhada do script de CAPACIDADE (que não faz typecheck — package.json
// l.19) silenciava o S11. O contrato (spt-kit/RULES.md:51-55 + package.json
// l.26/l.27) admite "npm run check:types" ou "npm run check" INTEIRO por
// nomes completos. Cura: regex com boundary de fim de token.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..");
const PREFLIGHT = path.join(REPO, "spt-kit", "preflight.mjs");
const MOLDE = readFileSync(path.join(REPO, "spt-kit", "MOLDE.md"), "utf8");
// O MOLDE abre com prosa de instrução que CITAM '---' antes do bloco real
// (linha `^---$`) — o template válido começa no primeiro '---' DE LINHA.
const MOLDE_FENCE = MOLDE.indexOf("\n---\n");
const MOLDE_BLOCK = MOLDE.slice(MOLDE_FENCE + 1);
const PROCEDURE_PLACEHOLDER =
  "TODO-PREENCHER comando literal com resultado esperado (prova de tipos: npm run check:types ou npm run check INTEIRO — nunca tsc -p parcial, R9)";

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

async function fixtureWithProcedure(procedure: string): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-h39-"));
  const doc = MOLDE_BLOCK.replace(PROCEDURE_PLACEHOLDER, procedure);
  const trilho = path.join(tempRoot, "trilho.md");
  await writeFile(trilho, doc, "utf8");
  return trilho;
}

const runPreflight = (trilho: string): string => {
  // Achados = exit != 0 (execFileSync lança) — o stdout vem no erro.
  try {
    return execFileSync(process.execPath, [PREFLIGHT, trilho], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (err) {
    const e = err as { stdout?: string | Buffer };
    return (e.stdout ?? "").toString();
  }
};

describe("frente H (#39) — S11 decide por nomes completos, não por prefixo", () => {
  it("CASO (a): tsc parcial + npm run check:capacity MANTÉM o S11 (capacity não é prova de tipagem)", async () => {
    const trilho = await fixtureWithProcedure(
      "npx tsc -p tsconfig.json && npm run check:capacity"
    );
    const out = runPreflight(trilho);
    expect(out).toContain("S11");
  });

  it("CASO (b): tsc parcial + npm run check:types (nome completo) LIMPA o S11", async () => {
    const trilho = await fixtureWithProcedure(
      "npx tsc -p tsconfig.json && npm run check:types"
    );
    const out = runPreflight(trilho);
    expect(out).not.toContain("S11");
  });

  it("CASO (c): tsc parcial sozinho MANTÉM o S11 (controle vivo)", async () => {
    const trilho = await fixtureWithProcedure("npx tsc -p tsconfig.json");
    const out = runPreflight(trilho);
    expect(out).toContain("S11");
  });

  it("CASO (d): tsc parcial + npm run check INTEIRO (guarda-chuva) LIMPA o S11 (boundary preserva automação legítima)", async () => {
    const trilho = await fixtureWithProcedure(
      "npx tsc -p tsconfig.json && npm run check"
    );
    const out = runPreflight(trilho);
    expect(out).not.toContain("S11");
  });

  it("CLASSE: tsc parcial + npm run check:flow-engine (outro vizinho de prefixo SEM typecheck) MANTÉM o S11", async () => {
    const trilho = await fixtureWithProcedure(
      "npx tsc -p tsconfig.json && npm run check:flow-engine"
    );
    const out = runPreflight(trilho);
    expect(out).toContain("S11");
  });
});
