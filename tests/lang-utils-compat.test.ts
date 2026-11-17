import { describe, expect, it } from "vitest";
import { normalizeComparable } from "../src/lang-utils.js";

// Caracterizacao direta do helper movido na onda da maratona
// (maratona-pipeline-binding-261117): consumidor duplo (flow-engine startGoal
// + goal-binding-compat) — teste direto mata o test gap do detect-changes.
describe("lang-utils normalizeComparable (maratona 2026-11-17)", () => {
  it("colapsa espacos, ignora case e apar as bordas", () => {
    expect(normalizeComparable("  OBJETIVO   literal ")).toBe("objetivo literal");
    expect(normalizeComparable("A\nB\tc")).toBe("a b c");
    expect(normalizeComparable("mesmo")).toBe(normalizeComparable("  MESMO  "));
  });
});
