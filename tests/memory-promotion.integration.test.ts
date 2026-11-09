import { describe, expect, it } from "vitest";
import type { MemoryCandidate, MemoryCandidateResolution } from "../src/domain.js";
import {
  applyMemoryCandidateResolution,
  candidateScoreTotal,
  isMemoryCandidateScope,
  isPromotionScope,
  latestTraceableCandidateResolutionMap,
  memoryNonWriteReason,
  memoryV2CandidateId,
  memoryV2Slug,
  memoryWriteDecision,
  promotionScopeForDestinations,
} from "../src/memory-promotion.js";
import { makeFlow } from "./helpers/policy-modules-fixture.js";

function makeCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: "mc_abc",
    title: "lição do corte",
    source: "gold_mining",
    scope: "projeto",
    layer: "L2",
    has_l1: true,
    score: { reaproveitamento: 3, evidencia: 3, custo_esquecimento: 2, transferibilidade: 2, total: 10 },
    confidence: "alta",
    l1_gatilho: "GATILHO-X",
    l2_bloco: "bloco",
    target_files: ["a.md"],
    blocked: false,
    blocked_reason: null,
    ...overrides,
  };
}

function makeResolution(overrides: Partial<MemoryCandidateResolution> = {}): MemoryCandidateResolution {
  return {
    resolution_id: "res-1",
    candidate_id: "mc_abc",
    action: "park",
    rationale: "lateral útil, ainda sem dono",
    traceable: true,
    when: "quando o Trilho de testes abrir",
    created_at: "2026-11-09T00:00:00.000Z",
    source: "mm_memory_candidate_resolve",
    ...overrides,
  };
}

describe("memory-promotion integration (import direto do módulo)", () => {
  it("memoryV2Slug normaliza acentos para kebab e anexa sufixo de identidade hex", () => {
    // sem sufixo de identidade: slug legível puro (fallback de item vazio = "memory")
    expect(memoryV2Slug("Configuração Rápida--DO Servidor!", "")).toBe("configuracao-rapida-do-servidor");
    expect(memoryV2Slug("   ", "")).toBe("memory");
    // com identidade: só chars hex do 2º parâmetro entram como sufixo (últimos 12)
    expect(memoryV2Slug("Configuração Rápida--DO Servidor!", "op-abc123def456")).toBe(
      "configuracao-rapida-do-servidor-abc123def456"
    );
  });

  it("memoryV2CandidateId é determinístico (NFC + colapso de espaços) com prefixo e 24 hex", () => {
    const a = memoryV2CandidateId("mesma lição  do corte");
    const b = memoryV2CandidateId("  mesma\tlição do corte ");
    expect(a).toBe(b);
    expect(a).toMatch(/^mc_[0-9a-f]{24}$/);
    // acento é SEMÂNTICA: lição ≠ licao (NFC não remove diacrítico)
    expect(memoryV2CandidateId("mesma licao do corte")).not.toBe(a);
    expect(memoryV2CandidateId("outra lição")).not.toBe(a);
  });

  it("guards de escopo distinguem promote-scopes de candidate-scopes", () => {
    for (const s of ["global", "tema", "projeto"]) {
      expect(isPromotionScope(s)).toBe(true);
      expect(isMemoryCandidateScope(s)).toBe(true);
    }
    expect(isPromotionScope("ledger_only")).toBe(false);
    expect(isPromotionScope("estacionamento")).toBe(false);
    expect(isPromotionScope("descartar")).toBe(false);
    expect(isMemoryCandidateScope("descartar")).toBe(true);
    expect(isMemoryCandidateScope("inventado")).toBe(false);
  });

  it("latestTraceableCandidateResolutionMap só retém resoluções rastreáveis (última vence)", () => {
    const flow = makeFlow({
      memory_candidate_resolutions: [
        makeResolution({ resolution_id: "r0", candidate_id: "cX", traceable: false }),
        makeResolution({ resolution_id: "r1", candidate_id: "c1", action: "park", when: undefined }), // park sem when
        makeResolution({ resolution_id: "r2", candidate_id: "c2", action: "promote", target_scope: "tema", theme: undefined }), // tema sem theme
        makeResolution({ resolution_id: "r3", candidate_id: "c3", action: "promote", target_scope: "projeto" }),
        makeResolution({ resolution_id: "r4", candidate_id: "c4", action: "discard" }),
        makeResolution({ resolution_id: "r5", candidate_id: "c3", action: "accept_ledger_only" }), // sobrescreve c3
      ],
    });
    const map = latestTraceableCandidateResolutionMap(flow);
    expect(map.has("cX")).toBe(false);
    expect(map.has("c1")).toBe(false);
    expect(map.has("c2")).toBe(false);
    expect(map.get("c3")?.resolution_id).toBe("r5");
    expect(map.get("c4")?.action).toBe("discard");
  });

  it("applyMemoryCandidateResolution aplica cada ação no candidato (promote/park/discard/no-op)", () => {
    const base = makeCandidate({ blocked: true, blocked_reason: "sem resolução" });
    const intacto = applyMemoryCandidateResolution(base, undefined, "C:/w", "C:/mem");
    expect(intacto).toEqual(base);

    const promovido = applyMemoryCandidateResolution(
      base,
      makeResolution({ action: "promote", target_scope: "tema", theme: "graphify" }),
      "C:/w",
      "C:/mem"
    );
    expect(promovido.scope).toBe("tema");
    expect(promovido.theme).toBe("graphify");
    expect(promovido.blocked).toBe(false);
    expect(promovido.target_files[0]).toContain("temas");

    const estacionado = applyMemoryCandidateResolution(
      base,
      makeResolution({ action: "park", when: "amanhã" }),
      "C:/w",
      "C:/mem"
    );
    expect(estacionado.scope).toBe("estacionamento");
    expect(estacionado.target_files).toEqual([]);

    const descartado = applyMemoryCandidateResolution(
      base,
      makeResolution({ action: "discard" }),
      "C:/w",
      "C:/mem"
    );
    expect(descartado.scope).toBe("descartar");
  });

  it("memoryWriteDecision decide action/reason pelos estados written/resolved/blocked/classify_only", () => {
    const candidato = makeCandidate();

    const escrito = memoryWriteDecision(candidato, "auto_write", new Set([candidato.id]));
    expect(escrito.action).toBe("written");
    expect(escrito.editable).toBe(false);

    const resolvido = memoryWriteDecision(candidato, "classify_only", new Set(), makeResolution({ action: "promote", target_scope: "projeto" }));
    expect(resolvido.action).toBe("resolved_promote");
    expect(resolvido.reason).toBe("traceable_resolution_registered");
    expect(resolvido.editable).toBe(false);

    const bloqueado = memoryWriteDecision(makeCandidate({ blocked: true, blocked_reason: "sensível" }), "auto_write", new Set());
    expect(bloqueado.action).toBe("blocked");
    expect(bloqueado.reason).toBe("sensível");

    const classificar = memoryWriteDecision(candidato, "classify_only", new Set());
    expect(classificar.action).toBe("classify_only");
    expect(classificar.editable).toBe(true);
    expect(memoryNonWriteReason(makeCandidate({ scope: "ledger_only" }), "auto_write", new Set())).toContain("ledger");
  });

  it("candidateScoreTotal lê score.total e devolve undefined sem score válido", () => {
    expect(candidateScoreTotal(makeCandidate())).toBe(10);
    expect(candidateScoreTotal(makeCandidate({ score: undefined as unknown as MemoryCandidate["score"] }))).toBeUndefined();
    expect(candidateScoreTotal({ score: { total: "não-número" } } as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it("promotionScopeForDestinations exige destino ÚNICO (0 ou 2+ = undefined)", () => {
    expect(promotionScopeForDestinations([])).toBeUndefined();
    expect(
      promotionScopeForDestinations([{ scope: "project" }, { scope: "global" }])
    ).toBeUndefined();
    expect(promotionScopeForDestinations([{ scope: "global" }])).toBe("global");
    expect(promotionScopeForDestinations([{ scope: "theme", theme: "graphify" }])).toBe("tema");
    expect(promotionScopeForDestinations([{ scope: "project" }])).toBe("projeto");
    // DOCUMENTAL (adversarial A1/A2): destino theme SEM theme também devolve
    // "tema" aqui — o guard que exige o nome mora em promotionDestination/
    // requireV2CandidateDestinations (motor); consumidor direto deve saber.
    expect(promotionScopeForDestinations([{ scope: "theme" }] as never)).toBe("tema");
  });
});
