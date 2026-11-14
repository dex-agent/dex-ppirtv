import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACK_TO,
  GOAL_VERDICT_POLICIES,
  REQUIRED_RESOURCES,
  VERDICTS,
} from "../src/domain.js";

// Corte de rede D-50 (2026-11-14): as 4 coleções de contrato de src/domain.ts
// cujas mutações de amostra SOBREVIVERAM à suíte inteira (repo-wide). Os unions
// eram cobertos por typecheck (mutação de valor quebra tsc), mas a COLEÇÃO como
// valor não tinha nenhum assert — caracterização fecha a lacuna (b).
describe("domain D-50 — coleções de contrato caracterizadas", () => {
  it("VERDICTS é exatamente o conjunto canônico de 4 vereditos (M1: duplicata sobrevivia)", () => {
    expect(VERDICTS).toEqual(["pronto", "pronto_com_ressalvas", "nao_pronto", "bloqueado"]);
  });

  it("DEFAULT_BACK_TO mapeia rollback da fase teste para implementacao (M3b: revisao sobrevivia)", () => {
    expect(DEFAULT_BACK_TO.teste).toBe("implementacao");
    expect(DEFAULT_BACK_TO.validacao).toBe("teste");
  });

  it("GOAL_VERDICT_POLICIES é exatamente o conjunto de 3 políticas (M6: draft sumia sobrevivia)", () => {
    expect(GOAL_VERDICT_POLICIES).toEqual(["evidence_required", "allow_ressalvas", "draft"]);
  });

  it("REQUIRED_RESOURCES contém os 8 recursos canônicos do servidor (M8: URI corrompida sobrevivia)", () => {
    expect(REQUIRED_RESOURCES).toEqual([
      "ppirtv://flows",
      "ppirtv://flow/{flow_id}",
      "ppirtv://flow/{flow_id}/checklist",
      "ppirtv://flow/{flow_id}/ledger",
      "ppirtv://flow/{flow_id}/meetings",
      "ppirtv://templates/gates",
      "ppirtv://templates/meetings",
      "ppirtv://reference/mcp",
    ]);
  });
});
