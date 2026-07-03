import { describe, expect, it } from "vitest";
import { isWritableCandidate, type MemoryCandidate } from "../src/memory/mining-policy.js";

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
