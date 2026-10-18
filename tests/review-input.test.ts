import { describe, expect, it } from "vitest";
import { unwrapReviewValueWrappers } from "../src/review-input.js";

describe("unwrapReviewValueWrappers (artefato de cliente {\"value\": X})", () => {
  it("desembrulha chave unica value nas seis chaves de review e anuncia as chaves", () => {
    const observed = {
      diff_reviewed: { value: true },
      barata_scan: { value: true },
      reviewed_targets: { value: ["a.php"] },
      searched_patterns: { value: ["x"] },
      findings: { value: ["F1"] },
      regression_risks: { value: ["R1"] }
    };
    const unwrapped = unwrapReviewValueWrappers(observed);
    expect(unwrapped).toEqual(["diff_reviewed", "barata_scan", "reviewed_targets", "searched_patterns", "findings", "regression_risks"]);
    expect(observed).toEqual({
      diff_reviewed: true,
      barata_scan: true,
      reviewed_targets: ["a.php"],
      searched_patterns: ["x"],
      findings: ["F1"],
      regression_risks: ["R1"]
    });
  });

  it("NAO mexe em shapes multi-chave (incidente 2026-10-17 vira ressalva, nao unwrap)", () => {
    const observed = { diff_reviewed: { true: true, reviewed_targets: ["a.php"] } };
    expect(unwrapReviewValueWrappers(observed)).toEqual([]);
    expect(observed.diff_reviewed).toEqual({ true: true, reviewed_targets: ["a.php"] });
  });

  it("input ausente ou nao-objeto e no-op", () => {
    expect(unwrapReviewValueWrappers(undefined)).toEqual([]);
    expect(unwrapReviewValueWrappers(["array"] as unknown as Record<string, unknown>)).toEqual([]);
  });
});
