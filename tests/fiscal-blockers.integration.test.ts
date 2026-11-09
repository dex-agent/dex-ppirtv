import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockedArchiveDirectAction,
  blockedDirectAction,
  blockerFamily,
  blockerInterpretation,
  blockerOwner,
  isBlockerStillActive,
  latestFiscalBlock,
  librarianRequired,
  memoryMiningVerdictStillBlocked,
  phaseAdvanceDirectAction,
  reconciledBlockers,
  whyFiscalModeNotActive,
} from "../src/fiscal-blockers.js";
import { historyEvent, makeFlow } from "./helpers/policy-modules-fixture.js";

describe("fiscal-blockers integration (import direto do módulo)", () => {
  it("isBlockerStillActive reconcilia required_cooperation pelo gatilho textual vivo", () => {
    const comTrigger = makeFlow({
      tasks: ["reuniao obrigatoria com cooperadores materiais neste corte"],
    });
    expect(isBlockerStillActive(comTrigger, "required_cooperation")).toBe(true);

    const semSinal = makeFlow({ tasks: [] });
    expect(isBlockerStillActive(semSinal, "required_cooperation")).toBe(false);
  });

  it("reconciledBlockers deduplica e descarta blockers inativos", () => {
    const flow = makeFlow({ tasks: [] });
    const reconciled = reconciledBlockers(flow, [
      "required_cooperation",
      "required_cooperation",
      "implementation_done",
    ]);
    expect(reconciled).toContain("implementation_done");
    expect(reconciled).not.toContain("required_cooperation");
    expect(reconciled).toHaveLength(1);
  });

  it("latestFiscalBlock reconcilia blockers vivos e esvazia quando verdict é gravado depois", () => {
    const bloqueio = historyEvent("fiscal_policy_blocked", {
      blocking_reasons: ["required_cooperation", "implementation_done"],
      required_cooperation: [],
    });
    // sem trigger textual, required_cooperation está inativo e o diagnóstico
    // reconciliado NÃO o repete (anti falso-verde); implementation_done permanece
    const vivo = makeFlow({ history: [bloqueio] });
    expect(latestFiscalBlock(vivo).blocking_reasons).toEqual(["implementation_done"]);

    // com o sinal vivo (trigger textual), o blocker de cooperation permanece
    const vivoComSinal = makeFlow({
      tasks: ["reuniao obrigatoria com cooperadores materiais neste corte"],
      history: [bloqueio],
    });
    expect(latestFiscalBlock(vivoComSinal).blocking_reasons).toContain("required_cooperation");

    const consumido = makeFlow({
      history: [bloqueio, historyEvent("verdict_recorded", { verdict_id: "v1" })],
    });
    expect(latestFiscalBlock(consumido).blocking_reasons).toEqual([]);
    expect(latestFiscalBlock(consumido).required_cooperation).toEqual([]);

    expect(latestFiscalBlock(makeFlow({})).blocking_reasons).toEqual([]);
  });

  it("blockerFamily classifica as famílias conhecidas e devolve unknown fora do mapa", () => {
    expect(blockerFamily("scope_in")).toBe("planning_requirement");
    expect(blockerFamily("context")).toBe("thought_requirement");
    expect(blockerFamily("implementation_done")).toBe("implementation_requirement");
    expect(blockerFamily("diff_reviewed")).toBe("review_requirement");
    expect(blockerFamily("test_executed")).toBe("test_requirement");
    expect(blockerFamily("verdict")).toBe("canonical_verdict");
    expect(blockerFamily("residual_risks")).toBe("validation_requirement");
    expect(blockerFamily("required_cooperation")).toBe("fiscal_cooperation");
    expect(blockerFamily("memory_required_but_empty")).toBe("fiscal_memory");
    expect(blockerFamily("hygiene_blocking")).toBe("fiscal_material");
    expect(blockerFamily("razao-desconhecida")).toBe("unknown");
  });

  it("blockerInterpretation explica cada política com linguagem acionável", () => {
    expect(blockerInterpretation("mixed", false)).toContain("requisitos de fase");
    expect(blockerInterpretation("fiscal_material_policy", false)).toContain("politica fiscal");
    expect(blockerInterpretation("phase_gate_requirements", false)).toContain("gate da fase");
    expect(blockerInterpretation("phase_gate_requirements", true)).toContain("modo material");
    expect(blockerInterpretation("none", false)).toContain("sem bloqueio");
  });

  it("ações diretas preservam os blockers na mensagem ensinável", () => {
    expect(blockedDirectAction(["review_required"]).action).toContain("review_required");
    expect(phaseAdvanceDirectAction(["review_required"], "revisao").action).toContain(
      "pendencias fiscais"
    );
    expect(phaseAdvanceDirectAction([], "revisao").action).not.toContain("pendencias");
    expect(blockedArchiveDirectAction(["a", "b"]).action).toContain("a, b");
  });

  it("blockerOwner roteia o blocker para a tool dona da cura (registro real de tools)", () => {
    expect(blockerOwner("review_required")).toBe("evidence_add");
    expect(blockerOwner("memory_required_but_empty")).toBe("mm_memory_mining");
    expect(blockerOwner("hygiene_blocking")).toBe("hygiene_scan");
  });

  it("guidance de blockers aponta SOMENTE tools reais do registro — librarian_status para ppirtv_checkout (ISSUE-LOCAL-0004 curada)", () => {
    // Achado da adversarial (contratos P2-1, 2026-11-09): o servidor registra
    // 32 tools e `memory_recall` NÃO estava entre elas — a SENTINELA esperava o
    // bug e foi consumida pela cura (veredito documental oraculo-clean-code
    // cap2: guidance revela intenção executável; padrão da tabela = tool de
    // ação especializada). Agora a tabela INTEIRA é julgada contra o registro
    // VIVO de tools do servidor — nenhuma tool fantasma passa.
    const serverSource = readFileSync(path.join(__dirname, "..", "src", "server.ts"), "utf8");
    const registered = new Set<string>();
    for (const match of serverSource.matchAll(/registerPpirtvTool\(\s*\n?\s*server,\s*\n?\s*"([a-z0-9_]+)"/g)) {
      registered.add(match[1]);
    }
    expect(registered.size).toBeGreaterThanOrEqual(30);
    expect(blockerOwner("librarian_status")).toBe("ppirtv_checkout");
    expect(registered.has("ppirtv_checkout")).toBe(true);
    for (const blocker of ["review_required", "memory_required_but_empty", "hygiene_blocking", "librarian_status"]) {
      expect(registered.has(blockerOwner(blocker))).toBe(true);
    }
  });

  it("librarianRequired é TEXTUAL por desenho (palavra no rationale aciona; binding real é do motor, não daqui)", () => {
    // contrato da função: gatilho lexical no texto do verdict (bibliotec|graphify|
    // retorno visual); o carregamento/validação do grafo mora no motor e é coberto
    // pela suíte do engine — este teste não afirma cobertura de binding.
    const flow = makeFlow({});
    expect(librarianRequired(flow, { rationale: "conferir retorno visual do graphify" })).toBe(true);
    expect(librarianRequired(flow, { rationale: " corte simples sem mencoes" })).toBe(false);

    const reasons = whyFiscalModeNotActive(makeFlow({}));
    expect(reasons).toContain("flow sem goal_binding oficial");
    expect(reasons.some((r) => r.includes("sem sinal material"))).toBe(true);
  });

  it("memoryMiningVerdictStillBlocked sem mining rodado não bloqueia", () => {
    expect(memoryMiningVerdictStillBlocked(makeFlow({}))).toBe(false);
  });
});
