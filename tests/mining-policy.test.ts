import { describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import { linkParkingToGold } from "../src/memory/parking-lot.js";
import {
  collectMemoryNuggets,
  isBookkeepingNugget,
  isWritableCandidate,
  type MemoryCandidate
} from "../src/memory/mining-policy.js";

function buildCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: "mc-test",
    title: "Candidato de teste",
    source: "gold_mining",
    scope: "projeto",
    layer: "L2",
    has_l1: true,
    score: { reaproveitamento: 2, evidencia: 2, custo_esquecimento: 1, transferibilidade: 1, total: 6 },
    confidence: "media",
    l1_gatilho: "[TEST] gatilho",
    l2_bloco: "## Teste\nProblema: teste",
    target_files: [],
    blocked: false,
    blocked_reason: null,
    ...overrides
  };
}

describe("isWritableCandidate", () => {
  it("aceita candidato com reaproveitamento >= 1, evidencia >= 1 e total >= 6", () => {
    expect(isWritableCandidate(buildCandidate())).toBe(true);
  });

  it("rejeita candidato bloqueado mesmo com score alto", () => {
    expect(isWritableCandidate(buildCandidate({ blocked: true }))).toBe(false);
  });

  it("rejeita candidato com scope ledger_only mesmo com score alto", () => {
    expect(isWritableCandidate(buildCandidate({ scope: "ledger_only" }))).toBe(false);
  });

  it("rejeita candidato com total < 6", () => {
    expect(
      isWritableCandidate(
        buildCandidate({
          score: { reaproveitamento: 2, evidencia: 1, custo_esquecimento: 1, transferibilidade: 1, total: 5 }
        })
      )
    ).toBe(false);
  });

  it("BUG2: rejeita candidato com reaproveitamento = 0 mesmo com total >= 6 e evidencia >= 1", () => {
    // Fala processual de reuniao: tem evidencia (existiu), custo de esquecimento,
    // transferibilidade, mas reaproveitamento=0. Nao vira L1/L2/L3.
    expect(
      isWritableCandidate(
        buildCandidate({
          title: "Turno de reuniao processual",
          score: { reaproveitamento: 0, evidencia: 2, custo_esquecimento: 2, transferibilidade: 2, total: 6 }
        })
      )
    ).toBe(false);
  });

  it("aceita candidato limiar com reaproveitamento = 1, evidencia = 1 e total = 6", () => {
    expect(
      isWritableCandidate(
        buildCandidate({
          score: { reaproveitamento: 1, evidencia: 1, custo_esquecimento: 2, transferibilidade: 2, total: 6 }
        })
      )
    ).toBe(true);
  });
});

// Regressao ACH-01 (flow_20260914103135338_2081_0063): bookkeeping do proprio
// flow nao pode ser promovido a candidato de memoria.
describe("isBookkeepingNugget", () => {
  it("reconhece os 5 prefixos de bookkeeping do flow", () => {
    expect(isBookkeepingNugget("Racional de veredito: objetivo atendido")).toBe(true);
    expect(isBookkeepingNugget("Risco residual: PEND-01 aberto")).toBe(true);
    expect(isBookkeepingNugget("Risco residual estacionado: PEND-01 aberto")).toBe(true);
    expect(isBookkeepingNugget("Evidencia usada no veredito: C-01 backup")).toBe(true);
    expect(isBookkeepingNugget("Achado garimpado do veredito: resumo do veredito")).toBe(true);
  });

  it("nao classifica aprendizado real como bookkeeping", () => {
    expect(isBookkeepingNugget("Gate dinamico exige fonte viva em vez de piso fixo")).toBe(false);
    expect(isBookkeepingNugget("Risco de regressao no parser exige teste de caracterizacao")).toBe(false);
    expect(isBookkeepingNugget("")).toBe(false);
  });
});

describe("collectMemoryNuggets", () => {
  it("nao promove bookkeeping do veredito a nugget e preserva o aprendizado real", () => {
    const flow = {
      gold_mining: ["Gate dinamico exige fonte viva em vez de piso fixo"],
      parking_lot: [],
      evidence: [],
      goal_learning_links: [],
      verdicts: [
        {
          gold_mining: ["Achado garimpado do veredito: resumo do veredito"],
          parking_lot: [
            "Evidencia usada no veredito: C-01 backup externo",
            "Risco residual estacionado: PEND-01 aberto"
          ],
          review_findings: [],
          rationale: "Racional de veredito: objetivo atendido com evidencia",
          residual_risks: ["Risco residual: PEND-01 aberto"]
        }
      ]
    } as unknown as Flow;

    const nuggets = collectMemoryNuggets(flow, []);
    const items = nuggets.map((nugget) => nugget.item);

    expect(items.some((item) => isBookkeepingNugget(item))).toBe(false);
    expect(items).toContain("Gate dinamico exige fonte viva em vez de piso fixo");
    expect(items).toHaveLength(1);
  });
});

// RED 2026-09-14 (evd_20260914114519433_2448_0038): o filtro olhava a forma
// INTERMEDIARIA do item. O deposito de parking-lot embrulha o item antes de o
// coletor ve-lo (flow-engine.ts:1569 promove ANTES de collectMemoryNuggets),
// entao o prefixo cru nao casava e o bookkeeping virava candidato.
describe("isBookkeepingNugget na forma final do item", () => {
  it("reconhece os 5 prefixos de bookkeeping do flow", () => {
    expect(isBookkeepingNugget("Racional de veredito: objetivo atendido")).toBe(true);
    expect(isBookkeepingNugget("Risco residual: PEND-01 aberto")).toBe(true);
    expect(isBookkeepingNugget("Risco residual estacionado: PEND-01 aberto")).toBe(true);
    expect(isBookkeepingNugget("Evidencia usada no veredito: ER-01 backup")).toBe(true);
    expect(isBookkeepingNugget("Achado garimpado do veredito: resumo")).toBe(true);
  });

  it("preserva o contrato de produto: achado de review continua elegivel a candidato", () => {
    // tests/engine.test.ts T33 exige que review findings cheguem a candidatos
    // editaveis (classify_only + edit_queue). Nao filtrar review aqui.
    expect(isBookkeepingNugget("Achado de review: P1 achado real")).toBe(false);
    expect(isBookkeepingNugget("Armadilha observada: Achado de review: Diagnostic de hardware RTX 5090")).toBe(false);
  });

  it("reconhece bookkeeping embrulhado pelo prefixo de promocao, inclusive duplo", () => {
    expect(isBookkeepingNugget("Armadilha observada: Risco residual estacionado: P-01 aberto")).toBe(true);
    expect(isBookkeepingNugget("Ponto cego observado: Racional de veredito: objetivo atendido")).toBe(true);
    expect(isBookkeepingNugget("Dica de ouro observada: Achado garimpado do veredito: resumo")).toBe(true);
    expect(isBookkeepingNugget("Heuristica pratica: Risco residual: P-01 aberto")).toBe(true);
    expect(isBookkeepingNugget("Armadilha observada: Heuristica pratica: Evidencia usada no veredito: ER-01")).toBe(true);
    expect(isBookkeepingNugget("Heurística prática: Racional de veredito: objetivo atendido")).toBe(true);
  });

  it("preserva aprendizado legitimo, inclusive embrulhado", () => {
    expect(isBookkeepingNugget("Armadilha observada: Risco de regressao no parser exige teste de caracterizacao")).toBe(false);
    expect(isBookkeepingNugget("Dica de ouro observada: Gate dinamico exige fonte viva em vez de piso fixo")).toBe(false);
    expect(isBookkeepingNugget("Heuristica pratica: filtrar na forma final do item, nao na intermediaria")).toBe(false);
    expect(isBookkeepingNugget("Armadilha observada: risco de perder aprendizado embrulhado")).toBe(false);
  });

  it("respeita o limite declarado de desembrulho (P-KIMI-02)", () => {
    // 4 wrappers + prefixo de bookkeeping = dentro do limite declarado
    expect(
      isBookkeepingNugget("Armadilha observada: Armadilha observada: Armadilha observada: Armadilha observada: Risco residual: P-01")
    ).toBe(true);
    // 5o wrapper: fora do limite declarado (risco R-01, com owner e quando no SPT)
    expect(
      isBookkeepingNugget("Armadilha observada: Armadilha observada: Armadilha observada: Armadilha observada: Armadilha observada: Risco residual: P-01")
    ).toBe(false);
  });
});

describe("caminho real de promocao (linkParkingToGold -> collectMemoryNuggets)", () => {
  it("nao promove bookkeeping embrulhado a nugget e preserva o aprendizado legitimo", () => {
    const legitimo = "Risco de regressao no parser exige teste de caracterizacao";
    const flow = {
      // Sem goal_binding o linkParkingToGold retorna [] e o teste passaria por
      // vacuidade (W-01 da revisao semantica): este campo e obrigatorio aqui.
      goal_binding: { envelope: { workspace: "C:\\CodexProjetos\\dex-PPIRTV" } },
      goal_learning_links: [],
      gold_mining: [],
      parking_lot: [
        legitimo,
        "Risco residual estacionado: P-01 aberto",
        "Evidencia usada no veredito: ER-01 backup externo"
      ],
      evidence: [],
      verdicts: [
        {
          gold_mining: ["Achado de review: P1 achado real de review"],
          parking_lot: ["Artefato de review para consulta: C:\\tmp\\review.json"],
          review_findings: [],
          rationale: "Racional de veredito: objetivo atendido com evidencia",
          residual_risks: ["Risco residual: P-01 aberto"]
        }
      ]
    } as unknown as Flow;

    const promotedFlow = linkParkingToGold(flow, flow.parking_lot, "memory_mining", "flow_teste", "2026-09-14T00:00:00.000Z");
    const promotedVerdict = linkParkingToGold(
      flow,
      flow.verdicts[0].parking_lot,
      "verdict_record",
      "vrd_teste",
      "2026-09-14T00:00:00.000Z"
    );
    flow.gold_mining = [...flow.gold_mining, ...promotedFlow, ...promotedVerdict];

    // Anti-vacuidade (W-01): a promocao precisa ter acontecido de verdade.
    expect(flow.gold_mining.some((item) => item.startsWith("Armadilha observada: Risco residual estacionado:"))).toBe(true);
    expect(flow.gold_mining.some((item) => item.startsWith("Armadilha observada: Risco de regressao"))).toBe(true);

    const items = collectMemoryNuggets(flow, []).map((nugget) => nugget.item);

    // P-KIMI-01: oraculo EXPLICITO por string, nao a propria funcao sob teste.
    // Sem isso, um isBookkeepingNugget sempre-falso faria o teste passar.
    const proibidos = [
      "Armadilha observada: Risco residual estacionado: P-01 aberto",
      "Armadilha observada: Evidencia usada no veredito: ER-01 backup externo",
      "Risco residual estacionado: P-01 aberto",
      "Evidencia usada no veredito: ER-01 backup externo",
      "Racional de veredito: objetivo atendido com evidencia",
      "Risco residual: P-01 aberto",
      "Achado garimpado do veredito: objetivo atendido com evidencia"
    ];
    for (const proibido of proibidos) {
      expect(items).not.toContain(proibido);
    }

    expect(items).toContain(`Armadilha observada: ${legitimo}`);
    expect(items).toContain("Achado de review: P1 achado real de review");
    expect(items).toContain("Artefato de review para consulta: C:\\tmp\\review.json");
  });
});
