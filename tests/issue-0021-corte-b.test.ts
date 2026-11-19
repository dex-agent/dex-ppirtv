// Issue #21 corte B — P1-3 (PRUNE sem prova por símbolo) + P2-7 (espelho
// d.mts sem PRUNE → TS2367). Repros publicadas na issue, decodificadas NA
// FONTE (LAUDO .agents/AUDITORIAS/2026-11-19-corte-b-issue21/). NUNCA podar.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as boundary from "../scripts/validate-flow-engine-boundary.mjs";

const BASE_SOURCE = ["export class FlowEngine {", "  dead() { return 0; }", "  run() { return 1; }", "}"].join("\n");
const HEAD_SOURCE = "export class FlowEngine {}\n";

function pruneDeclaration(removedSymbols: string[], deathProofs: Record<string, string[]>) {
  return {
    id: "fixture-issue21-corte-b",
    owner: "$oraculo-refatoracao",
    mode: "PRUNE" as const,
    spt_path: ".agents/PLAN-TASKS/fixture.md",
    responsibility: "retirar simbolos mortos",
    consumers: ["src/server.ts"],
    evidence: ["tests/flow-engine-boundary.test.ts"],
    changelog_marker: "fixture",
    architecture_marker: "fixture",
    removed_symbols: removedSymbols,
    death_proofs: deathProofs
  };
}

describe("issue 21 P1-3 — PRUNE reprova remoção não declarada (prova por símbolo)", () => {
  it("remover dead+run e declarar só dead REPROVA nomeando o símbolo pendente", () => {
    const receipt = boundary.evaluateFlowEngineChange({
      baseSource: BASE_SOURCE,
      headSource: HEAD_SOURCE,
      declaration: pruneDeclaration(["dead"], { dead: ["prova de dead na fixture"] })
    });
    expect(receipt.status).toBe("FAIL");
    expect(receipt.reasons).toContain("PRUNE_SYMBOL_UNDECLARED:run");
  });

  it("caso positivo preservado: declaração cobrindo todas as remoções segue PASS", () => {
    const receipt = boundary.evaluateFlowEngineChange({
      baseSource: BASE_SOURCE,
      headSource: HEAD_SOURCE,
      declaration: pruneDeclaration(["dead", "run"], { dead: ["prova de dead"], run: ["prova de run"] })
    });
    expect(receipt.status).toBe("PASS");
    expect(receipt.reasons).toEqual([]);
  });
});

describe("issue 21 P2-7 — espelho d.mts com PRUNE + vigia de vocabulário", () => {
  it("probe TS: comparar mode/requested_mode com PRUNE compila sem diagnósticos", () => {
    const probePath = path.resolve(import.meta.dirname, "../scripts/__probe_issue21.mts");
    const input = [
      "import type { BoundaryReceipt } from \"./validate-flow-engine-boundary.mjs\";",
      "declare const r: BoundaryReceipt;",
      "if (r.mode === \"PRUNE\") {}",
      "if (r.requested_mode === \"PRUNE\") {}"
    ].join("\n");
    const options = {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true
    };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    host.readFile = (file: string) => (path.resolve(file) === probePath ? input : readFile(file));
    const program = ts.createProgram([probePath], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => diagnostic.code);
    expect(diagnostics).toEqual([]);
  });

  it("vigia de vocabulário: unions do d.mts cobrem o ALLOWED_MODES vivo exportado", () => {
    const mirror = readFileSync(path.resolve(import.meta.dirname, "../scripts/validate-flow-engine-boundary.d.mts"), "utf8");
    const allowed = boundary.ALLOWED_MODES as Set<string> | undefined;
    expect(allowed).toBeInstanceOf(Set);
    // Âncora exige union com aspas — o FlowEngineChangeDeclaration também tem
    // `mode?: string;` (aberto) e não é o alvo do vigia.
    const modeUnion = mirror.match(/^  mode\?:\s*("[^;]+);/m)?.[1] ?? "";
    const requestedUnion = mirror.match(/^  requested_mode\?:\s*("[^;]+);/m)?.[1] ?? "";
    for (const modo of allowed!) {
      expect(modeUnion).toContain(`"${modo}"`);
      expect(requestedUnion).toContain(`"${modo}"`);
    }
  });
});
