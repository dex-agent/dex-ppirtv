import { describe, expect, it } from "vitest";
import {
  boundedRecallErrorReferences,
  normalizeRecallConsumptionInput,
  RecallConsumptionReferenceError,
  sameRecallReferences,
  validateRecallConsumptionReferences
} from "../src/memory/recall-consumption-contract.js";
import {
  RecallConsumptionReferenceError as FlowEngineRecallConsumptionReferenceError
} from "../src/flow-engine.js";

describe("recall consumption contract", () => {
  it("normalizes declared references while preserving a trimmed note", () => {
    expect(normalizeRecallConsumptionInput({
      references: [" memory.md ", "memory.md", ""],
      graphify_references: [" graph.json ", "graph.json"],
      note: " opened and used "
    })).toEqual({
      references: ["memory.md"],
      graphifyReferences: ["graph.json"],
      note: "opened and used"
    });
  });

  it("rejects an empty reference list before any persistence concern", () => {
    expect(() => normalizeRecallConsumptionInput({ references: [" "] })).toThrow(
      "RECALL_CONSUMPTION_REFERENCES_REQUIRED: informe ao menos uma referencia recuperada"
    );
  });

  it("accepts path variants and validates Graphify references against Graphify items only", () => {
    const input = normalizeRecallConsumptionInput({
      references: ["SRC\\MEMORY.MD", ".agents/graph.json"],
      graphify_references: [".AGENTS\\GRAPH.JSON"]
    });
    expect(validateRecallConsumptionReferences(input, [
      { source: "curated_l2", path: "src/memory.md" },
      { source: "graphify", path: ".agents/graph.json", title: "Graph relation" }
    ])).toEqual({
      validReferences: ["src/memory.md", ".agents/graph.json", "Graph relation"],
      validGraphifyReferences: [".agents/graph.json", "Graph relation"]
    });
  });

  it("returns bounded valid references with the same public error identity", () => {
    expect(FlowEngineRecallConsumptionReferenceError).toBe(RecallConsumptionReferenceError);
    const input = normalizeRecallConsumptionInput({ references: ["unknown.md"] });
    expect.assertions(6);
    try {
      validateRecallConsumptionReferences(input, [{ source: "curated_l1", path: "LEMBRANCA.md" }]);
    } catch (error) {
      expect(error).toBeInstanceOf(RecallConsumptionReferenceError);
      expect(error).toMatchObject({
        code: "RECALL_CONSUMPTION_UNKNOWN_REFERENCES",
        unknownReferences: ["unknown.md"],
        validReferences: ["LEMBRANCA.md"],
        validGraphifyReferences: []
      });
      expect((error as Error).message).toBe("RECALL_CONSUMPTION_UNKNOWN_REFERENCES: 1 unknown reference(s)");
      expect((error as RecallConsumptionReferenceError).validReferences).toEqual(["LEMBRANCA.md"]);
      expect((error as RecallConsumptionReferenceError).unknownReferences).toEqual(["unknown.md"]);
    }
  });

  it("distinguishes a Graphify-only mismatch", () => {
    const input = normalizeRecallConsumptionInput({
      references: ["memory.md"],
      graphify_references: ["memory.md"]
    });
    expect(() => validateRecallConsumptionReferences(input, [
      { source: "curated_l2", path: "memory.md" }
    ])).toThrowError(expect.objectContaining({
      code: "GRAPHIFY_CONSUMPTION_UNKNOWN_REFERENCES",
      validReferences: ["memory.md"],
      validGraphifyReferences: []
    }));
  });

  it("bounds and sanitizes error references", () => {
    const values = Array.from({ length: 20 }, (_, index) => `bad\r\n${index}-${"x".repeat(200)}\u0000.md`);
    const bounded = boundedRecallErrorReferences(values);
    expect(bounded).toHaveLength(12);
    expect(bounded.every((reference) => reference.length <= 160)).toBe(true);
    expect(bounded.every((reference) => !/[\u0000-\u001f\u007f]/.test(reference))).toBe(true);
  });

  it("compares normalized reference sets independent of order and duplicates", () => {
    expect(sameRecallReferences(["A\\B.md", "a/b.md"], ["a/b.MD"])).toBe(true);
    expect(sameRecallReferences(["a.md"], ["b.md"])).toBe(false);
  });
});
