import { describe, expect, it } from "vitest";
import {
  blockerDiagnosticsFor,
  blockerLoopId,
  fiscalBackTo,
  hasHygieneScan,
  hasMemoryMiningRun,
  lastIndexWhere,
  latestLibrarianStatusFromLedger,
} from "../src/fiscal-blockers.js";
import type { Flow, GateRecord } from "../src/domain.js";
import { historyEvent, makeFlow } from "./helpers/policy-modules-fixture.js";

// Corte de rede D-49 (2026-11-14): caracterização das 7 lacunas (b) provadas
// por mutação repo-wide sobrevivente (MUTACOES/M*-repo.json) — cada it
// endereça o símbolo nominal e a vigília re-mutada deve PEGAR.

describe("rede D-49: lacunas pagas de fiscal-blockers", () => {
  it("lastIndexWhere devolve o índice do ÚLTIMO match (varre de trás, SEM pular índices) e -1 sem match", () => {
    expect(lastIndexWhere([1, 2, 3, 2], (item) => item === 2)).toBe(3);
    expect(lastIndexWhere([2, 9], (item) => item === 2)).toBe(0);
    expect(lastIndexWhere([1, 2, 3], (item) => item === 9)).toBe(-1);
    expect(lastIndexWhere([], () => true)).toBe(-1);
  });

  it("blockerLoopId normaliza (lowercase/underscore), trunca o token em 90 e usa unknown quando vazio", () => {
    expect(blockerLoopId(["Review Required!"])).toBe("loop_review_required");
    expect(blockerLoopId([])).toBe("loop_unknown");
    const longo = blockerLoopId(["x".repeat(120)]);
    expect(longo).toBe(`loop_${"x".repeat(90)}`);
    expect(longo.length).toBe(95);
  });

  it("blockerDiagnosticsFor marca a fonte current_fiscal_policy para blocker vivo só no fiscal ATIVO (não no gate)", () => {
    const flow = makeFlow({});
    const gate = { status: "blocked" } as unknown as GateRecord;
    const fiscal = {
      blocking_reasons: ["implementation_done"],
      required_cooperation: [],
    } as unknown as Parameters<typeof blockerDiagnosticsFor>[4];
    const diagnostics = blockerDiagnosticsFor(
      flow,
      [],
      gate,
      [],
      fiscal,
      { blocking_reasons: [], required_cooperation: [] },
      ["implementation_done"],
      []
    );
    const family = diagnostics.blocker_families.find((entry) => entry.blocker === "implementation_done");
    expect(family?.source).toEqual(["current_fiscal_policy"]);
    expect(diagnostics.fiscal_blockers).toContain("implementation_done");
  });

  it("fiscalBackTo é mode-aware no fallback: fase desconhecida em full volta a pensamentos, em compact a concepcao", () => {
    const full = makeFlow({ phase: "zzz" as unknown as Flow["phase"] });
    const compact = makeFlow({ phase: "zzz" as unknown as Flow["phase"] });
    (compact as unknown as { mode: string }).mode = "compact";
    expect(fiscalBackTo(full)).toBe("pensamentos");
    expect(fiscalBackTo(compact)).toBe("concepcao");
  });

  it("hasMemoryMiningRun aceita evento memory_mined OU memory_mining.last_run_at; sem ambos é false", () => {
    const porEvento = makeFlow({ history: [historyEvent("memory_mined", {})] });
    const porCampo = makeFlow({ memory_mining: { last_run_at: "2026-11-14T00:00:00Z" } } as Partial<Flow>);
    expect(hasMemoryMiningRun(porEvento)).toBe(true);
    expect(hasMemoryMiningRun(porCampo)).toBe(true);
    expect(hasMemoryMiningRun(makeFlow({}))).toBe(false);
  });

  it("hasHygieneScan é true somente com evento hygiene_scanned no histórico (independente de bloquear)", () => {
    const escaneado = makeFlow({ history: [historyEvent("hygiene_scanned", { blocking_findings_count: 0 })] });
    expect(hasHygieneScan(escaneado)).toBe(true);
    expect(hasHygieneScan(makeFlow({ history: [historyEvent("outra_coisa", {})] }))).toBe(false);
  });

  it("latestLibrarianStatusFromLedger extrai o ÚLTIMO evento de recall (não o primeiro nem o último da lista)", () => {
    const eventos = [
      { type: "memory_recalled", data: { librarian_status: "recalled", recalled_count: 3 } },
      { type: "fiscal_policy_blocked", data: { blocking_reasons: ["x"] } },
      { type: "memory_recalled", data: { librarian_status: "empty", recalled_count: 0 } },
      { type: "goal_status", data: { detail: "full" } },
    ];
    const status = latestLibrarianStatusFromLedger(eventos);
    expect(status?.status).toBe("empty");
    expect(status?.recalled_count).toBe(0);
    expect(latestLibrarianStatusFromLedger([])).toBeNull();
  });
});
