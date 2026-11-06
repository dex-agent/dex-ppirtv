import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { strictReviewSnapshotFingerprint, withCurrentImplementationFingerprint, withGitCorroboratedChangedFiles } from "../src/review-snapshot.js";

let workspace = "";
afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

async function fixture(declared = ["mission.txt"]) {
  workspace = await mkdtemp(path.join(os.tmpdir(), "ppirtv-snapshot-recovery-"));
  await writeFile(path.join(workspace, "mission.txt"), "mission\n");
  await mkdir(path.join(workspace, "nested"));
  execFileSync("git", ["-C", workspace, "init", "-q"], { windowsHide: true });
  execFileSync("git", ["-C", path.join(workspace, "nested"), "init", "-q"], { windowsHide: true });
  await writeFile(path.join(workspace, "nested", "README.md"), "third party\n");
  const engine = new FlowEngine(new PpirtvStore(path.join(workspace, ".ppirtv")));
  const created = await engine.createFlow({ goal: "Synthetic legacy snapshot recovery", scope: { in: ["mission.txt"], out: [] } });
  const flow = await engine.store.loadFlow(created.flow_id);
  // Seed only the legacy state; all subsequent status/review calls use public APIs.
  flow.goal_binding = { envelope: { workspace, evidence_required: false, required_evidence: [], requested_verdict_policy: "draft" } } as Flow["goal_binding"];
  flow.changed_files = ["mission.txt", "nested/"];
  flow.history.push({ at: new Date().toISOString(), type: "flow_facts_updated", data: { changed_files: declared } });
  await engine.store.saveFlow(flow);
  return { engine, flow };
}

function reviewInput(flowId: string, fingerprint: string) {
  return {
    flow_id: flowId, kind: "code_review", title: "Recovery review",
    satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
    scope_classification: "target" as const, scope_reference: "mission.txt",
    reviewed_implementation_fingerprint: fingerprint,
    observed_result: { diff_reviewed: true, barata_scan: true, reviewed_targets: ["mission.txt"], searched_patterns: ["nested directory"], findings: [], regression_risks: ["synthetic fixture"] }
  };
}

describe("public legacy snapshot recovery", () => {
  it("recovers undeclared regular files ingested by legacy unborn corroboration through public review", async () => {
    const { engine, flow } = await fixture();
    await writeFile(path.join(workspace, "unrelated.txt"), "preexisting unrelated file\n");
    flow.changed_files.push("unrelated.txt");
    await engine.store.saveFlow(flow);
    const before = await readFile(engine.store.flowPath(flow.flow_id), "utf8");
    const status = await engine.goalStatus({ flow_id: flow.flow_id, detail: "lean" });
    expect(await readFile(engine.store.flowPath(flow.flow_id), "utf8")).toBe(before);
    expect((await withCurrentImplementationFingerprint(flow)).changed_files).toEqual(["mission.txt"]);
    await engine.attachEvidence(reviewInput(flow.flow_id, String(status.implementation_fingerprint)));
    const saved = await engine.store.loadFlow(flow.flow_id);
    expect(saved.changed_files).toEqual(["mission.txt"]);
    expect(saved.review_scope_recovery).toMatchObject({ excluded_legacy_unborn_files: ["unrelated.txt"] });
    expect(saved.history.slice(0, flow.history.length)).toEqual(flow.history);
  });

  it("preserves undeclared files when the repository has acquired a HEAD", async () => {
    const { flow } = await fixture();
    await writeFile(path.join(workspace, "unrelated.txt"), "real delta\n");
    execFileSync("git", ["-C", workspace, "add", "mission.txt"], { windowsHide: true });
    execFileSync("git", ["-C", workspace, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base"], { windowsHide: true });
    flow.changed_files.push("unrelated.txt");
    expect((await withCurrentImplementationFingerprint(flow)).changed_files).toContain("unrelated.txt");
  });

  it("preserves an undeclared file without declaration provenance", async () => {
    const { flow } = await fixture();
    flow.history = [];
    expect((await withCurrentImplementationFingerprint(flow)).changed_files).toContain("mission.txt");
  });

  it("preserves declarations from historical gates when current gates were replaced", async () => {
    const { flow } = await fixture();
    await writeFile(path.join(workspace, "extra.txt"), "authorized\n");
    flow.changed_files.push("extra.txt");
    flow.history.push({ at: new Date().toISOString(), type: "gate_checked", data: { provided: { changed_files: ["extra.txt"] } } });
    expect((await withCurrentImplementationFingerprint(flow)).changed_files).toContain("extra.txt");
  });

  it("preserves legacy files when a frozen base exists even if HEAD disappears", async () => {
    const { flow } = await fixture();
    await writeFile(path.join(workspace, "extra.txt"), "unresolved base\n");
    flow.git_head_base = "a".repeat(40);
    flow.changed_files.push("extra.txt");
    expect((await withCurrentImplementationFingerprint(flow)).changed_files).toContain("extra.txt");
  });

  it("projects without writing and persists recovery only with an accepted review", async () => {
    const { engine, flow } = await fixture();
    const file = engine.store.flowPath(flow.flow_id);
    const before = await readFile(file, "utf8");
    const status = await engine.goalStatus({ flow_id: flow.flow_id, detail: "lean" });
    expect(await readFile(file, "utf8")).toBe(before);
    const projection = await withCurrentImplementationFingerprint(flow);
    expect(projection.changed_files).toEqual(["mission.txt"]);
    expect(projection.history).toEqual(flow.history);
    await expect(engine.attachEvidence(reviewInput(flow.flow_id, `sha256:${"0".repeat(64)}`))).rejects.toThrow("FINGERPRINT_MISMATCH");
    expect(await readFile(file, "utf8")).toBe(before);
    await engine.attachEvidence(reviewInput(flow.flow_id, String(status.implementation_fingerprint)));
    const saved = await engine.store.loadFlow(flow.flow_id);
    expect(saved.changed_files).toEqual(["mission.txt"]);
    expect(saved).toMatchObject({ review_scope_recovery: { excluded_legacy_directories: ["nested/"] } });
    expect(saved.history.slice(0, flow.history.length)).toEqual(flow.history);
    expect(saved.history.at(-1)?.data.review_valid).toBe(true);
    expect((await withCurrentImplementationFingerprint(saved)).changed_files).toEqual(saved.changed_files);
  });

  it.each(["nested", "nested/", "nested\\"])("keeps an explicitly declared directory %s invalid", async (declared) => {
    const { flow } = await fixture(["mission.txt", declared]);
    const projected = await withCurrentImplementationFingerprint(flow);
    expect(projected.changed_files).toContain("nested/");
    const corroborated = await withGitCorroboratedChangedFiles(flow);
    expect(corroborated.changed_files).toContain("nested/");
    await expect(strictReviewSnapshotFingerprint(projected, { requireReviewableFiles: true })).rejects.toThrow("FILE_REQUIRED");
  });

  it("preserves declarations in criterion proofs", async () => {
    const { flow } = await fixture();
    flow.evidence = [{ criterion_proof: { revision_set: [{ paths: [{ path: "nested/" }] }] } }] as Flow["evidence"];
    expect((await withCurrentImplementationFingerprint(flow)).changed_files).toContain("nested/");
  });

  it("uses the existing normalizer for legacy wrapped paths", async () => {
    const { flow } = await fixture();
    flow.changed_files = ["mission.txt", { value: "nested/" } as unknown as string];
    const projected = await withCurrentImplementationFingerprint(flow);
    expect(projected.changed_files).toEqual(["mission.txt"]);
    expect(projected.review_scope_recovery?.excluded_legacy_directories).toEqual(["nested/"]);
  });

  it("does not hide a declared deletion that still exists", async () => {
    const { flow } = await fixture();
    flow.deleted_files = ["nested/"];
    await expect(withCurrentImplementationFingerprint(flow)).rejects.toThrow("DECLARED_DELETION_STILL_EXISTS");
  });

  it.each(["missing/", "ordinary/", "../outside/", ".env/"])("does not hide invalid path %s", async (candidate) => {
    const { flow } = await fixture(["mission.txt", candidate]);
    await mkdir(path.join(workspace, "ordinary"));
    flow.changed_files = ["mission.txt", candidate];
    await expect(withCurrentImplementationFingerprint(flow).then(projected => strictReviewSnapshotFingerprint(projected, { requireReviewableFiles: true }))).rejects.toThrow(/FILE_REQUIRED|OUTSIDE_WORKSPACE|SENSITIVE_PATH/);
  });

  it("full status -> evidence_add -> reload works through fresh MCP processes", async () => {
    const { engine, flow } = await fixture();
    const harness = path.resolve("scripts/call-mcp-tool.mjs");
    const call = (tool: string, args: object) => {
      const processResult = spawnSync(process.execPath, [harness, "--workspace", workspace, "--tool", tool, "--args", JSON.stringify(args)], { encoding: "utf8", windowsHide: true });
      expect(processResult.stdout, processResult.stderr).not.toBe("");
      const result = JSON.parse(processResult.stdout);
      expect(result.tool_count).toBe(32);
      expect(result.ok, JSON.stringify(result.result)).toBe(true);
      return result.result;
    };
    const status = call("goal_status", { flow_id: flow.flow_id, detail: "full" });
    call("evidence_add", reviewInput(flow.flow_id, status.implementation_fingerprint));
    const saved = await engine.store.loadFlow(flow.flow_id);
    expect(saved.changed_files).toEqual(["mission.txt"]);
    expect(saved.evidence).toHaveLength(1);
    expect(saved.history.at(-1)?.data.review_valid).toBe(true);
    const again = call("goal_status", { flow_id: flow.flow_id, detail: "full" });
    expect(again.implementation_fingerprint).toBe(status.implementation_fingerprint);
  });
});
