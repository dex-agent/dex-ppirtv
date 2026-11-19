import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// EST-D50B-1 / onda-cluster-verdict-d50b1 (2026-11-18): a decisão
// "verdict positivo" morava em 8 sítios inline do motor enquanto a fonte
// única domain.isPositiveVerdict existia (SRP p.101/p.121 autenticado,
// $oraculo-solid). Este teste vigia a TABELA de sítios contra o registro
// vivo (molde D-33: registro vivo no teste mata a CLASSE) — NUNCA podar.
// Singulares l.2630/l.3981 (semântica só-"pronto" deliberada) e
// flow.status complete/archived são OUTRO conceito: ficam fora do swap e
// vigiados como fronteira.
const MOTOR = readFileSync(path.resolve(import.meta.dirname, "../src/flow-engine.ts"), "utf8");

// Issue #26: o grupo intermediário engole QUALQUER forma de acesso ao campo
// (variável nua, .y, ?.y, encadeado) — o "?."-only deixava flow.status
// direto escapar da varredura E da contagem.
const PAR_INLINE = /===\s*"pronto"\s*\|\|\s*\w+(?:\?\.\w+|\.\w+)*\s*===\s*"pronto_com_ressalvas"/g;
const PAR_INLINE_INVERSO = /===\s*"pronto_com_ressalvas"\s*\|\|\s*\w+(?:\?\.\w+|\.\w+)*\s*===\s*"pronto"/g;

describe("onda cluster verdict d50b1 — 8 sítios usam a fonte única isPositiveVerdict", () => {
  it("motor consome isPositiveVerdict em ao menos 8 sitios e 1 import", () => {
    const usos = MOTOR.match(/isPositiveVerdict\(/g)?.length ?? 0;
    const importado = /import\s*\{[^}]*isPositiveVerdict[^}]*\}\s*from\s*"\.\/domain\.js"/.test(MOTOR);
    expect(importado).toBe(true);
    expect(usos).toBeGreaterThanOrEqual(8);
  });

  it("zero pares inline de pronto OU pronto_com_ressalvas no motor", () => {
    const pares = (MOTOR.match(PAR_INLINE) ?? []).length + (MOTOR.match(PAR_INLINE_INVERSO) ?? []).length;
    expect(pares).toBe(0);
  });

  it("sitio negado vira negacao de isPositiveVerdict", () => {
    expect(MOTOR).toMatch(/!isPositiveVerdict\(/);
  });

  it("fronteira preservada: singulares só-pronto deliberados permanecem (l.2630 e l.3981)", () => {
    const singulares = MOTOR.match(/===\s*"pronto"\s*&&|status\s*===\s*"pronto"\s*\)/g) ?? [];
    expect(singulares.length).toBeGreaterThanOrEqual(2);
  });

  it("fonte única intocada no swap: POSITIVE_VERDICTS segue fechada em domain.ts", async () => {
    const domain = readFileSync(path.resolve(import.meta.dirname, "../src/domain.ts"), "utf8");
    expect(domain).toMatch(/export const POSITIVE_VERDICTS = \["pronto", "pronto_com_ressalvas"\] as const/);
    const mod = await import("../src/domain.js");
    expect(mod.isPositiveVerdict("pronto")).toBe(true);
    expect(mod.isPositiveVerdict("pronto_com_ressalvas")).toBe(true);
    expect(mod.isPositiveVerdict("nao_pronto")).toBe(false);
  });
});

// Issue #26 (corte D-prime 2026-11-19): o ponto de intercepção da sentinela
// era incompleto — o grupo intermediário só engolia ?.\w+, deixando o MESMO
// par inline com acesso direto flow.status escapar da varredura E da
// contagem. Os its abaixo atestam o COMPORTAMENTO da sentinela contra as
// formas de acesso (molde its-sem-meta-regex) — NUNCA podar.
describe("issue 26 — sentinela pega o par inline em TODAS as formas de acesso ao campo", () => {
  const FORMAS = ["status", "flow.status", "flow?.status", "ctx.flow?.verdict.status"];

  it("as duas regex casam o par inline nas 4 formas de acesso, nas duas ordens", () => {
    for (const operando of FORMAS) {
      const direto = `${operando} === "pronto" || ${operando} === "pronto_com_ressalvas"`;
      const inverso = `${operando} === "pronto_com_ressalvas" || ${operando} === "pronto"`;
      expect((direto.match(PAR_INLINE) ?? []).length).toBeGreaterThanOrEqual(1);
      expect((inverso.match(PAR_INLINE_INVERSO) ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("fronteira sem falso positivo: singulares deliberados e complete/archived continuam fora das regex", () => {
    const fronteira = [
      'if (flow.status === "pronto")',
      "status === \"pronto\" &&",
      'flow.status === "complete"',
      'flow?.status === "archived"'
    ];
    for (const trecho of fronteira) {
      expect((trecho.match(PAR_INLINE) ?? []).length).toBe(0);
      expect((trecho.match(PAR_INLINE_INVERSO) ?? []).length).toBe(0);
    }
  });
});
