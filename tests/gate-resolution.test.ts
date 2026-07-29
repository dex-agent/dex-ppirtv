import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Evidence, Flow } from "../src/domain.js";
import { evidenceSatisfiesRequirement, resolveGateRequirements } from "../src/gate-resolution.js";
import {
  fingerprintReviewedImplementation,
  normalizeReviewPathForPlatform
} from "../src/review-snapshot.js";

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

  it("treats equivalent Windows review paths as the same target", () => {
    expect(normalizeReviewPathForPlatform("SRC\\flow-engine.ts", "win32")).toBe(
      normalizeReviewPathForPlatform("src/flow-engine.ts", "win32")
    );
  });

  it("keeps differently cased review paths distinct outside Windows", () => {
    expect(normalizeReviewPathForPlatform("src/Flow-Engine.ts", "linux")).not.toBe(
      normalizeReviewPathForPlatform("src/flow-engine.ts", "linux")
    );
  });

  it("fingerprints the same implementation deterministically and rejects paths outside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ppirtv-review-snapshot-"));
    try {
      await writeFile(join(workspace, "implementation.ts"), "export const value = 1;\n", "utf8");

      const first = await fingerprintReviewedImplementation(workspace, ["implementation.ts"], "linux");
      const retry = await fingerprintReviewedImplementation(workspace, ["implementation.ts"], "linux");

      expect(retry).toBe(first);
      await expect(
        fingerprintReviewedImplementation(workspace, ["../outside.ts"], "linux")
      ).rejects.toThrow("REVIEW_SNAPSHOT_OUTSIDE_WORKSPACE");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects sensitive paths before filesystem lookup", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ppirtv-review-sensitive-"));
    try {
      await expect(
        fingerprintReviewedImplementation(workspace, [".env.not-created"], "linux")
      ).rejects.toThrow("REVIEW_SNAPSHOT_SENSITIVE_PATH");
      await expect(
        fingerprintReviewedImplementation(workspace, ["config.toml"], "linux")
      ).rejects.toThrow("REVIEW_SNAPSHOT_SENSITIVE_PATH");
      for (const sensitivePath of [".npmrc", ".netrc", ".pypirc", ".git/config"]) {
        await expect(
          fingerprintReviewedImplementation(workspace, [sensitivePath], "linux")
        ).rejects.toThrow("REVIEW_SNAPSHOT_SENSITIVE_PATH");
      }
      await expect(
        fingerprintReviewedImplementation(workspace, ["vendor/project/.git/config"], "linux")
      ).rejects.toThrow("REVIEW_SNAPSHOT_SENSITIVE_PATH");
      await mkdir(join(workspace, "src", "config"), { recursive: true });
      await writeFile(join(workspace, ".env.example"), "PUBLIC_FIXTURE=value\n", "utf8");
      await writeFile(join(workspace, "src", "config", "config.toml"), "mode = \"fixture\"\n", "utf8");
      await expect(
        fingerprintReviewedImplementation(workspace, [".env.example", "src/config/config.toml"], "linux", { requireReviewableFiles: true })
      ).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
      await mkdir(join(workspace, "src", "tokens"), { recursive: true });
      await writeFile(join(workspace, "src", "tokens", "token-service.ts"), "export const tokenKind = 'domain';\n", "utf8");
      await expect(
        fingerprintReviewedImplementation(workspace, ["src/tokens/token-service.ts"], "linux", { requireReviewableFiles: true })
      ).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
      await writeFile(join(workspace, "authorization.ts"), "export const headerName = 'Authorization';\n", "utf8");
      await expect(
        fingerprintReviewedImplementation(workspace, ["authorization.ts"], "linux", { requireReviewableFiles: true })
      ).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("refuses to attest missing files and directories as reviewed implementation", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ppirtv-review-file-only-"));
    try {
      await mkdir(join(workspace, "src"), { recursive: true });
      await expect(
        fingerprintReviewedImplementation(workspace, ["missing.ts"], "linux", { requireReviewableFiles: true })
      ).rejects.toThrow("REVIEW_SNAPSHOT_FILE_REQUIRED");
      await expect(
        fingerprintReviewedImplementation(workspace, ["missing.ts"], "linux", {
          requireReviewableFiles: true,
          allowedMissingFiles: ["missing.ts"]
        })
      ).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(
        fingerprintReviewedImplementation(workspace, ["src"], "linux", { requireReviewableFiles: true })
      ).rejects.toThrow("REVIEW_SNAPSHOT_FILE_REQUIRED");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects a declared deletion while the filesystem entry still exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ppirtv-review-false-deletion-"));
    try {
      await writeFile(join(workspace, "still-here.ts"), "export const present = true;\n", "utf8");

      await expect(
        fingerprintReviewedImplementation(workspace, ["still-here.ts"], "linux", {
          requireReviewableFiles: true,
          allowedMissingFiles: ["still-here.ts"]
        })
      ).rejects.toThrow("REVIEW_SNAPSHOT_DECLARED_DELETION_STILL_EXISTS");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects a broken symlink declared as a deletion", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ppirtv-review-broken-link-"));
    try {
      await symlink(join(workspace, "missing-target.ts"), join(workspace, "broken.ts"), "file");

      await expect(
        fingerprintReviewedImplementation(workspace, ["broken.ts"], "linux", {
          requireReviewableFiles: true,
          allowedMissingFiles: ["broken.ts"]
        })
      ).rejects.toThrow("REVIEW_SNAPSHOT_DECLARED_DELETION_STILL_EXISTS");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects a symlink that escapes the review workspace before reading it", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ppirtv-review-link-"));
    const outside = await mkdtemp(join(tmpdir(), "ppirtv-review-outside-"));
    try {
      const outsideFile = join(outside, "external.ts");
      await writeFile(outsideFile, "external\n", "utf8");
      await symlink(outsideFile, join(workspace, "external.ts"), "file");

      await expect(
        fingerprintReviewedImplementation(workspace, ["external.ts"], "linux", { requireReviewableFiles: true })
      ).rejects.toThrow("REVIEW_SNAPSHOT_OUTSIDE_WORKSPACE");
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects an innocent-looking internal symlink whose real target is sensitive", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ppirtv-review-sensitive-link-"));
    try {
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(join(workspace, ".env"), "DO_NOT_HASH=fixture\n", "utf8");
      await symlink(join(workspace, ".env"), join(workspace, "src", "review.ts"), "file");

      await expect(
        fingerprintReviewedImplementation(workspace, ["src/review.ts"], "linux", { requireReviewableFiles: true })
      ).rejects.toThrow("REVIEW_SNAPSHOT_SENSITIVE_PATH");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
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
