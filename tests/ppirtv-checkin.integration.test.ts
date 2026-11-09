import { describe, expect, it } from "vitest";
import type { Evidence } from "../src/domain.js";
import {
  classifyEvidenceQuality,
  compactPpirtvCheckout,
  evidenceQualityReasons,
  hasFutureAction,
  hasQuando,
  missingQuandoGate,
  progressText,
  validateProgressNumbers,
  workProgressEvents,
  workProgressSummary,
} from "../src/ppirtv-checkin.js";
import { historyEvent, makeFlow } from "./helpers/policy-modules-fixture.js";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidence_id: "ev-1",
    flow_id: "flow_test",
    kind: "command",
    title: "suíte executada",
    content: "npm run check passou com exit 0",
    satisfies: [],
    parking_lot: [],
    gold_mining: [],
    created_at: "2026-11-09T00:00:00.000Z",
    ...overrides,
  } as Evidence;
}

function makeProgressEvent(overrides: Record<string, unknown> = {}) {
  return {
    progress_id: "p1",
    event_key: "k1",
    source: "tests",
    operation: "vitest",
    stage: "run",
    current: 1,
    total: 2,
    percent: 50,
    status: "running",
    recorded_at: "2026-11-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("ppirtv-checkin integration (import direto do módulo)", () => {
  it("classifyEvidenceQuality cobre legacy, weak, strong e missing_context", () => {
    const legada = classifyEvidenceQuality(makeEvidence({ created_at: undefined }));
    expect(legada.status).toBe("legacy_unclassified");
    expect(legada.blocking).toBe(false);

    const fraca = classifyEvidenceQuality(
      makeEvidence({ content: undefined, title: "titulo seco", kind: "note" })
    );
    expect(fraca.status).toBe("weak");
    expect(fraca.missing_fields.length).toBeGreaterThanOrEqual(4);

    const forte = classifyEvidenceQuality(
      makeEvidence({
        kind: "command",
        title: "validacao da fase com origem e objetivo",
        content:
          "procedimento: npm run check; resultado observado: pass; limitacao/risco residual declarado",
      })
    );
    expect(forte.status).toBe("strong");
    expect(forte.missing_fields.length).toBeLessThanOrEqual(1);
  });

  it("evidenceQualityReasons explica a causa por rastreabilidade e campos ausentes", () => {
    expect(evidenceQualityReasons("weak", false, ["origin"])).toContain(
      "sem conteudo, nota, uri ou satisfacao rastreavel"
    );
    expect(evidenceQualityReasons("weak", true, ["origin", "phase"])[0]).toContain("campos ausentes");
  });

  it("Gate do Quando: next_step com acao futura exige quando verificavel", () => {
    expect(missingQuandoGate("")).toBeNull();
    expect(missingQuandoGate("corte concluido, nada pendente")).toBeNull();
    expect(missingQuandoGate("corrigir o modulo quando der tempo")).toBeNull(); // tem "quando"
    const gate = missingQuandoGate("corrigir o modulo de policy");
    expect(gate).toContain("Gate do Quando");
    expect(hasFutureAction("corrigir")).toBe(true);
    expect(hasQuando("quando der tempo")).toBe(true);
  });

  it("SENTINELA de falso-positivo conhecido: falhar aqui = regex future-action foi consertado (atualizar EST-ONDA6)", () => {
    // valid\w* casa "validade"; test\w* casa "testemunha" — comportamento
    // pré-existente fiel, estacionado na emenda Onda 6 como dívida de produto.
    // Este teste é SENTINELA deliberada (não endosso): quando o regex for
    // corrigido, esta asserção FALHA de propósito para lembrar de atualizar o
    // estacionamento e remover a ressalva.
    expect(hasFutureAction("checar a validade do certificado")).toBe(true);
    expect(hasQuando("validade vence em 2026-11-10")).toBe(true);
    expect(missingQuandoGate("checar a validade do certificado que vence em 2026-11-10")).toBeNull();
    // a classe é MAIOR que "validade"/"testemunha" (adversarial F3): qualquer
    // palavra com prefixo de verbo da tabela casa — "rodoviaria" casa `rodar?`
    expect(hasFutureAction("analise rodoviaria concluida")).toBe(true);
  });

  it("progressText normaliza controle/espacos e trunca ao maximo", () => {
    expect(progressText("  a\tb\u0007c  ", 10, "texto")).toBe("a b c");
    expect(progressText("abcdef", 3, "texto")).toBe("abc");
    expect(() => progressText("", 10, "texto")).toThrow();
  });

  it("validateProgressNumbers rejeita totais/estados invalidos e aceita o caminho sao (DOCUMENTAL: status nao e validado aqui)", () => {
    expect(() => validateProgressNumbers(0, 0, "queued")).toThrow(/PROGRESS_TOTAL_INVALID/);
    expect(() => validateProgressNumbers(-1, 2, "queued")).toThrow(/PROGRESS_CURRENT_INVALID/);
    expect(() => validateProgressNumbers(3, 2, "queued")).toThrow(/PROGRESS_CURRENT_INVALID/);
    expect(() => validateProgressNumbers(1, 2, "completed")).toThrow(/PROGRESS_COMPLETED_INCOMPLETE/);
    expect(() => validateProgressNumbers(2, 2, "completed")).not.toThrow();
    expect(() => validateProgressNumbers(1, 2, "running")).not.toThrow();
    // DOCUMENTAL (adversarial D1): a funcao NAO valida o vocabulario de status
    // — "failed" com current<total passa; eventos com status fora da uniao sao
    // descartados por workProgressEvents (sentinela de contrato)
    expect(() => validateProgressNumbers(1, 2, "failed")).not.toThrow();
  });

  it("workProgressEvents filtra eventos deformados (data corrompida não quebra o summary)", () => {
    const fluxo = makeFlow({
      history: [
        historyEvent("work_progress_recorded", makeProgressEvent({ progress_id: "p1" })),
        historyEvent("work_progress_recorded", "evento-deformado-sem-shape" as unknown as Record<string, unknown>),
        historyEvent("work_progress_recorded", makeProgressEvent({ progress_id: "p2", operation: "tsc", current: 2, total: 2, percent: 100, status: "completed" })),
      ],
    });
    const events = workProgressEvents(fluxo);
    expect(events.map((e) => e.progress_id)).toEqual(["p1", "p2"]);
    const summary = workProgressSummary(fluxo);
    expect(summary.event_count).toBe(2);
    expect(summary.operations_count).toBe(2);
    expect(summary.last?.progress_id).toBe("p2");
    expect(workProgressSummary(makeFlow({})).last).toBeNull();
  });

  it("compactPpirtvCheckout conta prestação legada (array) e objetada sem perder full", () => {
    const legado = { prestacao_de_contas: [{ a: 1 }, { a: 2 }] };
    expect(compactPpirtvCheckout(legado, "full")).toBe(legado);
    const compactoLegado = compactPpirtvCheckout(legado, "compact") as Record<string, unknown>;
    expect(compactoLegado.prestacao_de_contas_count).toBe(2);

    const moderno = { prestacao_de_contas: { utilidade: {}, memoria: {} } };
    const compactoModerno = compactPpirtvCheckout(moderno, "compact") as Record<string, unknown>;
    expect(compactoModerno.prestacao_de_contas_count).toBe(2);
  });
});
