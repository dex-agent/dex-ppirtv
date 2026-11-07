import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { execFileSync } from "node:child_process";
import { addDeclarativeEvidence, declarativeDefaults } from "../src/spt-declarative-proof.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DexMemoriaV2Executor, DexMemoriaV2FlowWriterConfig } from "../src/memory/dex-memoria-v2-adapter.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

let tempRoot = "";

function fakeSpt(workspace: string, objective: string): string {
  return [
    "---", "dex_contract: spt", "version: 3", "status: EM_TESTE", "owner: Teste",
    "date: '2026-10-18'", "workspace: " + JSON.stringify(workspace), "origin: teste git corroboration",
    "goal:", "  id: fake-goal-git", "  title: Fake GOAL Git",
    "  objective: " + JSON.stringify(objective),
    "context: Fixture sintetica do corroboration por commit.",
    "problem: Probes NOVO-1/NOVO-2.", "decision: RED primeiro.",
    "scope:", "  include:", "    - Validar gates.", "  exclude:", "    - Externo.",
    "requirements:", "  - id: REQ-01", "    statement: O flow deve iniciar para o probe.", "    criteria:",
    "      - id: C-01", "        statement: goal_start retorna flow_id.",
    "plan: [Probe.]", "tasks:", "  - id: A-01", "    action: Chamar goal_start e validar verdict.",
    "    covers: [REQ-01]", "    done_when: [C-01]", "    depends_on: []",
    "    evidence_requirements:", "      - id: ER-01", "        proves: [C-01]", "        method: inspection",
    "        procedure: Observar flow_id.", "        expectation:", "          kind: boolean_assertion", "          expected: true",
    "closure_gates: [Nenhum para o probe.]",
    "risks:", "  - Risco de fixture.", "uncertainties:", "  - nenhuma.",
    "gates:", "  - preenchidos.", "validation:", "  - vitest local.",
    "execution_prompt: |", "  /GOAL", "---", "# t", ""
  ].join("\n");
}

function configuredWriter(): DexMemoriaV2FlowWriterConfig {
  return {
    profile: "v2",
    executor: vi.fn() as unknown as DexMemoriaV2Executor,
    memory_home: path.join(tempRoot, "memory-home"),
    workspace_root: path.join(tempRoot, "workspace")
  };
}

function git(workspace: string, args: string[]) {
  return execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
}

// Git inicial ANTES do startGoal: a base congelada (git_head_base) e o head
// do commit base — pre-condicao do fix NOVO-1.
async function fixtureGoalGit(objective: string, options: { gitignore: boolean; preexistingOutside?: boolean }) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "git-corroboration-"));
  const workspace = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspace, ".agents", "PLAN-TASKS"), { recursive: true });
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, "docs"), { recursive: true });
  await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  await writeFile(path.join(workspace, "docs", "note.md"), "# note\n", "utf8");
  if (options.gitignore) {
    await writeFile(path.join(workspace, ".gitignore"), ".ppirtv/\n.agents/\n", "utf8");
  }
  git(workspace, ["init"]);
  git(workspace, ["config", "user.email", "fixture@example.com"]);
  git(workspace, ["config", "user.name", "Fixture"]);
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-m", "base"]);
  if (options.preexistingOutside) {
    await writeFile(path.join(workspace, "src", "outside.ts"), "export {};\n", "utf8");
  }
  const engine = new FlowEngine(
    new PpirtvStore(path.join(workspace, ".ppirtv")),
    undefined,
    { memory_writer: configuredWriter() }
  );
  const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "2026-10-18-fake-goal-git.md");
  await writeFile(sptPath, fakeSpt(workspace, objective), "utf8");
  const started = (await engine.startGoal({
    workspace, spt_path: sptPath, objective,
    idempotency_key: "git-" + Math.random().toString(36).slice(2, 8),
    evidence_required: true, required_evidence: ["npm run check"],
    risk_level: "mechanical",
    requested_verdict_policy: "evidence_required", source: "dex-code"
  } as never)) as Record<string, unknown>;
  return { engine, workspace, flowId: String(started.flow_id) };
}

type Fixture = Awaited<ReturnType<typeof fixtureGoalGit>>;

async function attachTestReceipt(f: Fixture) {
  return (await f.engine.attachEvidence({
    flow_id: f.flowId,
    kind: "test",
    title: "Suite de fixture (2 passed | 0 failed | exit 0)",
    content: "Probe interno do corroboration por commit.",
    observed_result: { passed: 2, failed: 0, exit_code: 0 }
  } as never)) as Record<string, unknown>;
}

async function climbToVerdictInput(f: Fixture, declaredFiles: string[]) {
  await f.engine.goalAdvance({ flow_id: f.flowId } as never);
  await f.engine.goalAdvance({
    flow_id: f.flowId,
    provided: { implementation_done: true, changed_files: declaredFiles }
  } as never);
  await f.engine.goalGateCheck({
    flow_id: f.flowId,
    provided: { implementation_done: true, changed_files: declaredFiles }
  } as never);
  const receipt = await attachTestReceipt(f);
  await f.engine.goalAdvance({
    flow_id: f.flowId,
    provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] }
  } as never);
  const proof = await addDeclarativeEvidence(
    f.engine as never,
    f.engine as never,
    {
      flow_id: f.flowId,
      title: "declared inspection",
      declarative_proof: {
        task_id: "A-01",
        evidence_requirement_id: "ER-01",
        observed_value: true,
        paths: declaredFiles
      }
    },
    declarativeDefaults()
  );
  const evidenceIds = [receipt.evidence_id, ...proof.evidence_ids].filter(Boolean) as string[];
  return evidenceIds;
}

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("git corroboration: commits e runtime (NOVO-1/NOVO-2)", () => {
  it.each(["accept", "excluded_changed", "new_path", "declared_path", "bad_review", "target_changed"])("attribution MCP stdio: %s", async (scenario) => {
    const f = await fixtureGoalGit("Issue 11 attribution MCP.", { gitignore: true, preexistingOutside: true });
    await writeFile(path.join(f.workspace, "src", "a.ts"), "export const a = 2;\n", "utf8");
    const evidenceIds = await climbToVerdictInput(f, ["src/a.ts"]);
    const client = new Client({ name: "issue11-consumer", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(process.cwd(), "dist", "index.js")],
      cwd: f.workspace,
      env: { ...getDefaultEnvironment(), PPIRTV_HOME: path.join(f.workspace, ".ppirtv"), PPIRTV_WORKSPACE: f.workspace },
      stderr: "pipe"
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      return (response.structuredContent as { result: Record<string, any> }).result;
    };
    try {
      await client.connect(transport);
      expect((await call("runtime_probe", {})).project_root).toBe(f.workspace);
      const status = await call("goal_status", { flow_id: f.flowId, detail: "full" });
      const review = await call("evidence_add", {
        flow_id: f.flowId, kind: "code_review", title: "Review of the declared code change",
        scope_classification: "target", scope_reference: "src/a.ts",
        satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
        reviewed_implementation_fingerprint: scenario === "bad_review" ? `sha256:${"0".repeat(64)}` : status.implementation_fingerprint,
        observed_result: { diff_reviewed: true, barata_scan: true, reviewed_targets: ["src/a.ts"], searched_patterns: ["export const a"], findings: [], regression_risks: [] }
      });
      if (scenario === "bad_review") {
        expect(JSON.stringify(review)).toContain("REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH");
        return;
      }
      expect(review.error).toBeUndefined();
      const attribution = await call("evidence_add", {
        flow_id: f.flowId, kind: "review_scope_attribution", title: "Preexisting fixture work attributed outside this flow",
        scope_classification: "outside",
        observed_result: {
          reviewer: "fixture-reviewer",
          attribution_binding: { version: 1, git_head_base: "client-forgery", fingerprint: "sha256:client-forgery" },
          excluded_paths: [{ path: scenario === "declared_path" ? "docs/../src/a.ts" : "src/outside.ts", reason: "Independent fixture work predates this mission", source: "fixtureGoalGit creates outside.ts before startGoal" }]
        }
      });
      if (scenario === "declared_path") {
        expect(attribution.error).toBeDefined();
        return;
      }
      expect(attribution.error).toBeUndefined();
      expect(attribution.evidence_id).toBeTruthy();
      const persisted = await f.engine.store.loadFlow(f.flowId);
      const bound = persisted.evidence.find((item) => item.evidence_id === attribution.evidence_id)!;
      expect((bound.observed_result!.attribution_binding as { git_head_base: string }).git_head_base).not.toBe("client-forgery");
      if (scenario === "excluded_changed") await writeFile(path.join(f.workspace, "src", "outside.ts"), "export const changed = true;\n");
      if (scenario === "new_path") await writeFile(path.join(f.workspace, "docs", "new.md"), "# Unassigned\n");
      if (scenario === "target_changed") await writeFile(path.join(f.workspace, "src", "a.ts"), "export const a = 3;\n");
      const verdict = await call("goal_verdict", {
        flow_id: f.flowId, status: "pronto", rationale: "Reviewed mission with explicit, recorded external attribution",
        evidence_ids: [...evidenceIds, review.evidence_id], scope_attribution_evidence_ids: [attribution.evidence_id],
        next_step: "Upon acceptance, close the synthetic flow", review_findings: []
      });
      const after = await call("goal_status", { flow_id: f.flowId, detail: "lean" });
      expect(after.flow_id).toBe(f.flowId);
      if (scenario === "accept") {
        expect(verdict.error).toBeUndefined();
        expect(verdict.verdict.status).toMatch(/^pronto/);
        expect(verdict.verdict.evidence_ids).toContain(attribution.evidence_id);
        expect(after.current_verdict_status).toMatch(/^pronto/);
        expect(after.closure_blockers).not.toContain("review_required");
      } else {
        expect(verdict.error).toBeDefined();
        const expectedError = {
          excluded_changed: "REVIEW_SCOPE_ATTRIBUTION_STALE",
          new_path: "REVIEW_SCOPE_UNATTRIBUTED_PATH",
          target_changed: "SPT_V3_EVIDENCE_STALE"
        }[scenario];
        expect(JSON.stringify(verdict.error)).toContain(expectedError);
        expect(after.current_verdict_status).toBeNull();
      }
    } finally {
      await client.close();
      await transport.close();
    }
  }, 30_000);

  it("NOVO-2: runtime .ppirtv/ nao conta como code no veredito doc-only (sem .gitignore)", async () => {
    const f = await fixtureGoalGit("Probe NOVO-2 .ppirtv runtime.", { gitignore: false });
    await writeFile(path.join(f.workspace, "docs", "note.md"), "# note atualizada\n", "utf8");
    const evidenceIds = await climbToVerdictInput(f, ["docs/note.md"]);
    const verdict = (await f.engine.goalVerdict({
      flow_id: f.flowId,
      status: "pronto",
      rationale: "doc-only legitimo com runtime .ppirtv vivo",
      evidence_ids: evidenceIds,
      next_step: "concluir agora",
      review_findings: ["none"]
    } as never)) as Record<string, unknown>;
    expect((verdict.verdict as Record<string, unknown>)?.status).toBe("pronto");
    const status = (await f.engine.goalStatus({ flow_id: f.flowId } as never)) as Record<string, unknown>;
    expect(JSON.stringify(status.blockers ?? [])).not.toContain("review_required");
  });

  it("NOVO-1: commit-then-verdict de codigo nao passa de doc-only (worktree limpo)", async () => {
    const f = await fixtureGoalGit("Probe NOVO-1 commit then verdict.", { gitignore: true });
    await writeFile(path.join(f.workspace, "src", "a.ts"), "export const a = 2;\n", "utf8");
    git(f.workspace, ["add", "."]);
    git(f.workspace, ["commit", "-m", "code change"]);
    const evidenceIds = await climbToVerdictInput(f, ["docs/note.md"]);
    await expect(
      f.engine.goalVerdict({
        flow_id: f.flowId,
        status: "pronto",
        rationale: "mechanical spoofed doc com commit",
        evidence_ids: evidenceIds,
        next_step: "concluir agora",
        review_findings: ["none"]
      } as never)
    ).rejects.toThrow(/review_required/);
  });

  it("NOVO-1 legitimo: commit doc-only aceito (status e diff enxergam o mesmo doc)", async () => {
    const f = await fixtureGoalGit("Probe NOVO-1 legitimo doc commit.", { gitignore: false });
    await writeFile(path.join(f.workspace, "docs", "note.md"), "# note atualizada por commit\n", "utf8");
    git(f.workspace, ["add", "."]);
    git(f.workspace, ["commit", "-m", "doc change"]);
    const evidenceIds = await climbToVerdictInput(f, ["docs/note.md"]);
    await f.engine.goalVerdict({
      flow_id: f.flowId,
      status: "pronto",
      rationale: "doc-only legitimo commitado",
      evidence_ids: evidenceIds,
      next_step: "concluir agora",
      review_findings: ["none"]
    } as never);
    const status = (await f.engine.goalStatus({ flow_id: f.flowId } as never)) as Record<string, unknown>;
    expect(JSON.stringify(status.blockers ?? [])).not.toContain("review_required");
  });

  it("NOVO-1 fail-closed: base Git orfa (divergencia insolvel) exige review mesmo doc-only", async () => {
    const f = await fixtureGoalGit("Probe NOVO-1 base orfa.", { gitignore: true });
    await writeFile(path.join(f.workspace, "docs", "note.md"), "# note orfa\n", "utf8");
    const evidenceIds = await climbToVerdictInput(f, ["docs/note.md"]);
    const flow = await f.engine.store.loadFlow(f.flowId);
    flow.git_head_base = "0".repeat(40);
    await f.engine.store.saveFlow(flow);
    await expect(
      f.engine.goalVerdict({
        flow_id: f.flowId,
        status: "pronto",
        rationale: "base orfa exige review",
        evidence_ids: evidenceIds,
        next_step: "concluir agora",
        review_findings: ["none"]
      } as never)
    ).rejects.toThrow(/review_required/);
  });
});

describe("issue #11: verdict bloqueado nao persiste a ampliacao do snapshot", () => {
  const verdictInput = (f: Fixture, evidenceIds: string[]) => ({
    flow_id: f.flowId,
    status: "pronto",
    rationale: "probe issue 11 ampliacao persistida",
    evidence_ids: evidenceIds,
    next_step: "concluir agora",
    review_findings: ["none"]
  } as never);

  const lastBlockEvent = (flow: { history: Array<{ type: string; data?: Record<string, unknown> }> }) =>
    flow.history.filter((event) => event.type === "fiscal_policy_blocked").at(-1);

  it("commit pos-base: rejeicao restaura o snapshot aprovado e registra os acrescimos como pending", async () => {
    const f = await fixtureGoalGit("Probe issue11 commit pos base.", { gitignore: true });
    await writeFile(path.join(f.workspace, "src", "b.ts"), "export const b = 1;\n", "utf8");
    git(f.workspace, ["add", "."]);
    git(f.workspace, ["commit", "-m", "commit alheio pos base"]);
    const evidenceIds = await climbToVerdictInput(f, ["docs/note.md"]);
    await expect(f.engine.goalVerdict(verdictInput(f, evidenceIds))).rejects.toThrow(/review_required/);
    const flow = await f.engine.store.loadFlow(f.flowId);
    // O snapshot persistido apos a rejeicao e o do ultimo gate aprovado, nao o ampliado
    expect(flow.changed_files).not.toContain("src/b.ts");
    // A ampliacao da corroboracao fica registrada como pendente auditavel no evento de bloqueio
    const blockEvent = lastBlockEvent(flow);
    const pending = (blockEvent?.data?.pending_review_additions as string[] | undefined) ?? [];
    expect(pending).toContain("src/b.ts");
    // Recuperacao publica no mesmo flow (C-04/C-05): goal_status expoe o pending
    const statusLean = (await f.engine.goalStatus({ flow_id: f.flowId, detail: "lean" } as never)) as Record<string, unknown>;
    const pendingLean = statusLean.pending_review_additions as { count: number; attribution_hint: string } | null;
    expect(pendingLean?.count).toBe(1);
    expect(pendingLean?.attribution_hint).toContain("provided.changed_files");
    const statusFull = (await f.engine.goalStatus({ flow_id: f.flowId, detail: "full" } as never)) as Record<string, unknown>;
    const pendingFull = statusFull.pending_review_additions as { count: number; additions: string[] } | null;
    expect(pendingFull?.additions).toContain("src/b.ts");
  });

  it("untracked pre-existente: rejeicao nao persiste o untracked como conjunto aprovado", async () => {
    const f = await fixtureGoalGit("Probe issue11 untracked pre-existente.", { gitignore: true });
    await writeFile(path.join(f.workspace, "src", "preexisting.ts"), "export const pre = 1;\n", "utf8");
    const evidenceIds = await climbToVerdictInput(f, ["docs/note.md"]);
    await expect(f.engine.goalVerdict(verdictInput(f, evidenceIds))).rejects.toThrow(/review_required/);
    const flow = await f.engine.store.loadFlow(f.flowId);
    expect(flow.changed_files).not.toContain("src/preexisting.ts");
    const blockEvent = lastBlockEvent(flow);
    const pending = (blockEvent?.data?.pending_review_additions as string[] | undefined) ?? [];
    expect(pending).toContain("src/preexisting.ts");
  });
});
