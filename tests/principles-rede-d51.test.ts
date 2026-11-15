import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  finalReportModel,
  gateFinalOutput,
  loadOperationalContractSync,
  operationalContractMeta,
  promptGuidance,
  readyDefinition
} from "../src/principles.js";

// D-51 (2026-11-15) — corte de rede principles.ts: as 5 lacunas (b) pagas por
// mutação (M1/M3-M6 SOBREVIVERAM contra a suíte) são as delegações de leitura
// do contrato operacional. Caracterização: cada leitor devolve EXATAMENTE o
// campo que nomeia — vigília re-mutada (MUTACOES/*-vigia.json) tem que falhar.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("principles rede D-51: leitores do contrato operacional (lacunas b pagas)", () => {
  it("promptGuidance devolve exatamente contract.prompt_guidance", () => {
    expect(promptGuidance(root)).toEqual(loadOperationalContractSync(root).prompt_guidance);
  });

  it("readyDefinition devolve exatamente contract.ready_definition", () => {
    expect(readyDefinition(root)).toEqual(loadOperationalContractSync(root).ready_definition);
  });

  it("gateFinalOutput devolve exatamente contract.gate_final_output", () => {
    expect(gateFinalOutput(root)).toEqual(loadOperationalContractSync(root).gate_final_output);
  });

  it("finalReportModel devolve exatamente contract.final_report_model", () => {
    expect(finalReportModel(root)).toEqual(loadOperationalContractSync(root).final_report_model);
  });

  it("operationalContractMeta devolve o espelho exato dos campos de identificação", () => {
    const contract = loadOperationalContractSync(root);
    expect(operationalContractMeta(root)).toEqual({
      version: contract.version,
      numeric_version: contract.numeric_version ?? null,
      principles_revision: contract.principles_revision ?? null,
      updated_at: contract.updated_at ?? null,
      source: contract.source,
      canonical_source: contract.canonical_source ?? null,
      canonical_contract: contract.canonical_contract ?? null,
      canonical_repo_copy: contract.canonical_repo_copy ?? null,
      contract_role: contract.contract_role ?? null
    });
  });
});
