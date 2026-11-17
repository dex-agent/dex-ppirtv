import { describe, expect, it } from "vitest";
import { normalizePipelineItem, pipelineEvidenceText } from "../src/pipeline-policy.js";
import type { PipelineItem } from "../src/domain.js";

// Caracterizacao do cluster pipeline (caracterizacoes da maratona NUNCA sao
// podadas — Trilho maratona-pipeline-binding-261117, A-01). Asserts derivados
// do comportamento historico do flow-engine.ts l.4539-4634 antes da extracao.

describe("pipeline policy (caracterizacao maratona 2026-11-17)", () => {
  const baseItem: PipelineItem = { goal: "cortar a onda", context: "ctx da onda" };

  it("aplica defaults de risks/uncertainties e fallback de context quando ausentes", () => {
    const item = normalizePipelineItem({ ...baseItem, context: undefined }, 2);

    expect(item.risks).toEqual([
      "Automacao de pipeline nao substitui evidencia externa quando a tarefa exigir execucao real."
    ]);
    expect(item.uncertainties).toEqual([
      "mm_pipeline_run orquestra gates PPIRTV; execucao externa deve ser anexada como evidencia quando existir."
    ]);
    expect(item.context).toBe("Pipeline item 3: cortar a onda");
  });

  it("preserva risks/uncertainties declarados e deduplica todos os campos colecao", () => {
    const item = normalizePipelineItem(
      {
        ...baseItem,
        scope_in: ["src/a.ts", "src/a.ts", "src/b.ts"],
        tasks: ["t1", "t1"],
        risks: ["risco proprio"],
        uncertainties: ["lacuna propria"]
      },
      0
    );

    expect(item.scope_in).toEqual(["src/a.ts", "src/b.ts"]);
    expect(item.tasks).toEqual(["t1"]);
    expect(item.risks).toEqual(["risco proprio"]);
    expect(item.uncertainties).toEqual(["lacuna propria"]);
  });

  it("fallback: changed_files herda scope_in e evidence herda expected_evidence quando vazios", () => {
    const item = normalizePipelineItem(
      { ...baseItem, scope_in: ["src/x.ts"], expected_evidence: ["npm run check"] },
      0
    );

    expect(item.changed_files).toEqual(["src/x.ts"]);
    expect(item.evidence).toEqual(["npm run check"]);
  });

  it("mantem changed_files/evidence declarados quando preenchidos", () => {
    const item = normalizePipelineItem(
      {
        ...baseItem,
        scope_in: ["src/x.ts"],
        changed_files: ["docs/mapa.md"],
        expected_evidence: ["check"],
        evidence: ["receipt real"]
      },
      0
    );

    expect(item.changed_files).toEqual(["docs/mapa.md"]);
    expect(item.evidence).toEqual(["receipt real"]);
  });

  it("exige goal preenchido", () => {
    expect(() => normalizePipelineItem({ ...baseItem, goal: "  " }, 0)).toThrow();
  });

  it("bloqueia segredo em qualquer campo do item (assert agregada)", () => {
    expect(() =>
      normalizePipelineItem({ ...baseItem, tasks: ["Authorization: Bearer abcdefghijklmnop"] }, 0)
    ).toThrow(/pipeline\[0\]/);
    expect(() => normalizePipelineItem({ ...baseItem, goal: "Authorization: Bearer abcdefghijklmnop" }, 1)).toThrow();
  });

  it("serializa o evidence text com as secoes na ordem historica", () => {
    const item = normalizePipelineItem(
      {
        ...baseItem,
        scope_in: ["src/a.ts"],
        tasks: ["t1"],
        expected_evidence: ["check"],
        done_criteria: ["c1"]
      },
      0
    );

    const text = pipelineEvidenceText(item);
    const sections = ["Goal:", "Scope in:", "Tasks:", "Expected evidence declared:", "Done criteria:", "Pipeline evidence:"];
    const positions = sections.map((section) => text.indexOf(section));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain("- check");
  });

  it("serializa no extra evidence declared somente quando expected_evidence tambem esta vazio", () => {
    const item = normalizePipelineItem({ ...baseItem }, 0);
    expect(pipelineEvidenceText(item)).toContain("- no extra evidence declared");
  });

  it("serializa evidence declarado quando preenchido", () => {
    const item = normalizePipelineItem({ ...baseItem, evidence: ["receipt-1"] }, 0);
    expect(pipelineEvidenceText(item)).toContain("- receipt-1");
    expect(pipelineEvidenceText(item)).not.toContain("no extra evidence declared");
  });
});
