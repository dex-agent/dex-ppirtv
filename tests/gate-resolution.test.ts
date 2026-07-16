import { describe, expect, it } from "vitest";
import type { Evidence, Flow } from "../src/domain.js";
import { evidenceSatisfiesRequirement, resolveGateRequirements } from "../src/gate-resolution.js";

describe("gate requirement resolution", () => {
  it("accepts only exact structured review satisfactions", () => {
    const flow = flowWithEvidence(reviewEvidence({ satisfies: ["diff_reviewed", "barata_scan"] }));
    const resolved = resolveGateRequirements({
      flow,
      requirements: [
        { key: "diff_reviewed", label: "diff", source: "provided" },
        { key: "barata_scan", label: "barata", source: "provided" },
        { key: "regression_risks", label: "riscos", source: "provided" }
      ]
    });

    expect(resolved.map(({ key, satisfied, satisfied_by }) => ({ key, satisfied, satisfied_by }))).toEqual([
      { key: "diff_reviewed", satisfied: true, satisfied_by: "evidence" },
      { key: "barata_scan", satisfied: true, satisfied_by: "evidence" },
      { key: "regression_risks", satisfied: false, satisfied_by: null }
    ]);
  });

  it.each([
    ["free text only", reviewEvidence({ satisfies: undefined, observed_result: undefined })],
    ["missing observed result", reviewEvidence({ observed_result: undefined })],
    ["outside", reviewEvidence({ scope_classification: "outside" })],
    ["undeclared dependency", reviewEvidence({ scope_classification: "declared_dependency", scope_reference: "pkg" })],
    ["missing scope reference", reviewEvidence({ scope_reference: undefined })],
    ["foreign flow", reviewEvidence({ flow_id: "flow_foreign" })],
    ["partial observed result", reviewEvidence({ observed_result: { diff_reviewed: true } })],
    ["legacy marker", reviewEvidence({ satisfies: undefined, observed_result: undefined, gold_mining: ["evidence_required:diff_reviewed"] })],
    ["wrong casing", reviewEvidence({ satisfies: ["Diff_Reviewed"] })],
    ["wrong kind", reviewEvidence({ kind: "test_run" })]
  ])("rejects %s for diff_reviewed", (_label, evidence) => {
    expect(evidenceSatisfiesRequirement(flowWithEvidence(evidence), evidence, "diff_reviewed")).toBe(false);
  });

  it("accepts an explicitly declared dependency that exists in scope.in", () => {
    const evidence = reviewEvidence({ scope_classification: "declared_dependency" });
    expect(evidenceSatisfiesRequirement(flowWithEvidence(evidence), evidence, "diff_reviewed")).toBe(true);
  });

  it.each(["target", "declared_dependency"] as const)("lets scope.out override %s authorization", (classification) => {
    const evidence = reviewEvidence({ scope_classification: classification });
    const flow = flowWithEvidence(evidence);
    flow.scope.out.push("target");
    expect(evidenceSatisfiesRequirement(flow, evidence, "diff_reviewed")).toBe(false);
  });

  it("requires a real successful test result", () => {
    const valid = testEvidence({ passed: 7, failed: 0, exit_code: 0 });
    const zeroTests = testEvidence({ passed: 0, failed: 0, exit_code: 0 });
    const failed = testEvidence({ passed: 6, failed: 1, exit_code: 1 });
    const wrongKind = { ...valid, kind: "code_review" };

    expect(evidenceSatisfiesRequirement(flowWithEvidence(valid), valid, "test_executed")).toBe(true);
    expect(evidenceSatisfiesRequirement(flowWithEvidence(zeroTests), zeroTests, "test_executed")).toBe(false);
    expect(evidenceSatisfiesRequirement(flowWithEvidence(failed), failed, "test_executed")).toBe(false);
    expect(evidenceSatisfiesRequirement(flowWithEvidence(wrongKind), wrongKind, "test_executed")).toBe(false);
  });

  it("rejects incomplete or mistyped review observations", () => {
    const missingTargets = reviewEvidence({ observed_result: { diff_reviewed: true } });
    const placeholderPattern = reviewEvidence({ observed_result: {
      diff_reviewed: true,
      reviewed_targets: ["target"],
      barata_scan: true,
      searched_patterns: ["  <required:pattern>  "],
      findings: [],
      regression_risks: []
    } });
    const nonTextRisk = reviewEvidence({ observed_result: {
      diff_reviewed: true,
      reviewed_targets: ["target"],
      barata_scan: true,
      searched_patterns: ["neighbors"],
      findings: [],
      regression_risks: [7]
    } });

    expect(evidenceSatisfiesRequirement(flowWithEvidence(missingTargets), missingTargets, "diff_reviewed")).toBe(false);
    expect(evidenceSatisfiesRequirement(flowWithEvidence(placeholderPattern), placeholderPattern, "barata_scan")).toBe(false);
    expect(evidenceSatisfiesRequirement(flowWithEvidence(nonTextRisk), nonTextRisk, "regression_risks")).toBe(false);
  });
});

function reviewEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidence_id: "evd_review",
    flow_id: "flow_gate",
    kind: "code_review",
    title: "review",
    content: "review concluido",
    satisfies: ["diff_reviewed"],
    observed_result: {
      diff_reviewed: true,
      reviewed_targets: ["target"],
      barata_scan: true,
      searched_patterns: ["neighboring target consumers"],
      findings: [],
      regression_risks: []
    },
    scope_classification: "target",
    scope_reference: "target",
    parking_lot: [],
    gold_mining: [],
    cooperators: [],
    active_credits: [],
    created_at: "2026-07-16T00:00:00.000Z",
    ...overrides
  };
}

function testEvidence(observed_result: Record<string, unknown>): Evidence {
  return reviewEvidence({
    evidence_id: "evd_test",
    kind: "test_run",
    satisfies: ["test_executed"],
    observed_result
  });
}

function flowWithEvidence(evidence: Evidence): Flow {
  return {
    flow_id: "flow_gate",
    goal: "resolver gate",
    context: "ctx",
    phase: "revisao",
    status: "active",
    scope: { in: ["target"], out: ["outside"] },
    risks: ["false green"],
    uncertainties: [],
    tasks: [],
    done_criteria: [],
    expected_evidence: [],
    changed_files: [],
    decisions: [],
    parking_lot: [],
    gold_mining: [],
    goal_learning_links: [],
    cooperators: [],
    active_credits: [],
    evidence: [evidence],
    meetings: [],
    verdicts: [],
    gates: {},
    history: [],
    created_at: "2026-07-16T00:00:00.000Z",
    updated_at: "2026-07-16T00:00:00.000Z"
  };
}
