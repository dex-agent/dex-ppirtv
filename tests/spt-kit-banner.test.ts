import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// SPT revisao-pr9-issues-vacina-banner (GO 2026-11-07): vacina da classe
// "Obsolete Comment" paga na issue #8 — o banner do --schema anunciava
// S00..S09 enquanto o codigo ja emitia S10. O anuncio do inventario deixa
// de ser string cravada sem prova: este teste casa o RANGE anunciado no
// --schema com o conjunto de checks realmente emitidos no codigo
// (padrao de emissao: add("Snn", ...)). Check novo sem bump do banner
// reprova AQUI, nao no usuario.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preflightPath = path.join(repoRoot, "spt-kit", "preflight.mjs");
const preflightSource = readFileSync(preflightPath, "utf8");

function emittedCheckNumbers(): number[] {
  const numbers = new Set<number>();
  for (const match of preflightSource.matchAll(/add\("S(\d{2})"/g)) {
    numbers.add(Number(match[1]));
  }
  return [...numbers].sort((a, b) => a - b);
}

function announcedRange(): { min: number; max: number } {
  const schema = execFileSync(process.execPath, [preflightPath, "--schema"], { encoding: "utf8" });
  const match = schema.match(/S(\d{2})\.\.S(\d{2})/);
  if (!match) {
    throw new Error("banner --schema do preflight nao anuncia range Snn..Snn");
  }
  return { min: Number(match[1]), max: Number(match[2]) };
}

describe("spt-kit preflight: banner do --schema x checks emitidos (vacina issue #8)", () => {
  it("o range anunciado cobre exatamente os checks que o codigo emite", () => {
    const emitted = emittedCheckNumbers();
    expect(emitted.length, 'nenhum add("Snn") encontrado no fonte — o padrao de emissao mudou? atualize a regex do teste').toBeGreaterThan(0);
    const { min, max } = announcedRange();
    const pad = (n: number) => `S${String(n).padStart(2, "0")}`;
    for (const id of emitted) {
      expect(
        id,
        `check emitido ${pad(id)} fora do range anunciado ${pad(min)}..${pad(max)} — bump do banner esquecido (classe da issue #8)`,
      ).toBeGreaterThanOrEqual(min);
      expect(id, `check emitido ${pad(id)} acima do range anunciado ${pad(min)}..${pad(max)}`).toBeLessThanOrEqual(max);
    }
  });

  it("o cabecalho do fonte declara o mesmo shape maximo do banner (S00..S10 hoje)", () => {
    const { max } = announcedRange();
    const headerMentionsShape = /S(\d{2})\s*\+\s*shape\s*S(\d{2})/.exec(preflightSource.split("\n", 3).join("\n"));
    if (headerMentionsShape) {
      expect(Number(headerMentionsShape[2]), "cabecalho do preflight declara shape menor que o banner do --schema").toBe(max);
    }
  });
});
