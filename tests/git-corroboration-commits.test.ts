import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { execFileSync } from "node:child_process";
import { addDeclarativeEvidence, declarativeDefaults } from "../src/spt-declarative-proof.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DexMemoriaV2Executor, DexMemoriaV2FlowWriterConfig } from "../src/memory/dex-memoria-v2-adapter.js";

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
async function fixtureGoalGit(objective: string, options: { gitignore: boolean }) {
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
