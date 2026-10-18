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
    "date: '2026-10-18'", "workspace: " + JSON.stringify(workspace), "origin: teste h3",
    "goal:", "  id: fake-goal-h3", "  title: Fake GOAL H3",
    "  objective: " + JSON.stringify(objective),
    "context: Fixture sintetica do hardening-3.",
    "problem: Probes R2/R3/R6.", "decision: RED primeiro.",
    "scope:", "  include:", "    - Validar gates.", "  exclude:", "    - Externo.",
    "requirements:", "  - id: REQ-01", "    statement: O flow deve iniciar para o probe.", "    criteria:",
    "      - id: C-01", "        statement: goal_start retorna flow_id.",
    "plan: [Probe.]", "tasks:", "  - id: A-01", "    action: Chamar goal_start e validar gates.",
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

async function fixtureGoal(objective: string, riskLevel = "medium") {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "h3-hardening-"));
  const engine = new FlowEngine(
    new PpirtvStore(path.join(tempRoot, "workspace", ".ppirtv")),
    undefined,
    { memory_writer: configuredWriter() }
  );
  const workspace = path.join(tempRoot, "workspace");
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-10-18-fake-goal-h3.md");
  await writeFile(sptPath, fakeSpt(workspace, objective), "utf8");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, "docs"), { recursive: true });
  await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  await writeFile(path.join(workspace, "docs", "note.md"), "# note\n", "utf8");
  const started = (await engine.startGoal({
    workspace, spt_path: sptPath, objective,
    idempotency_key: "h3-" + Math.random().toString(36).slice(2, 8),
    evidence_required: true, required_evidence: ["npm run check"],
    risk_level: riskLevel,
    requested_verdict_policy: "evidence_required", source: "dex-code"
  } as never)) as Record<string, unknown>;
  return { engine, tempRoot, workspace, flowId: String(started.flow_id) };
}

type Fixture = Awaited<ReturnType<typeof fixtureGoal>>;

async function attachTestReceipt(f: Fixture) {
  return (await f.engine.attachEvidence({
    flow_id: f.flowId,
    kind: "test",
    title: "Suite de fixture (2 passed | 0 failed | exit 0)",
    content: "Probe interno do hardening-3.",
    observed_result: { passed: 2, failed: 0, exit_code: 0 }
  } as never)) as Record<string, unknown>;
}

async function attachStructuredReview(f: Fixture, changedFile: string) {
  const status = (await f.engine.goalStatus({ flow_id: f.flowId, detail: "full" } as never)) as Record<string, unknown>;
  const fingerprint = String(status.implementation_fingerprint ?? "");
  return (await f.engine.attachEvidence({
    flow_id: f.flowId,
    kind: "code_review",
    title: "Review estruturada do fixture (" + changedFile + ")",
    content: "Escopo: " + changedFile + ". Achados: nenhum. Decisao: liberar.",
    satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
    observed_result: {
      diff_reviewed: true,
      reviewed_targets: [changedFile],
      barata_scan: true,
      searched_patterns: ["consumidores vizinhos no fixture"],
      findings: [],
      regression_risks: ["nenhuma no fixture"]
    },
    scope_classification: "target",
    scope_reference: changedFile,
    reviewed_implementation_fingerprint: fingerprint
  } as never)) as Record<string, unknown>;
}

async function climbToReviewClaimsOnly(f: Fixture, changedFile = "src/a.ts") {
  await f.engine.goalAdvance({ flow_id: f.flowId } as never);
  const implGate = (await f.engine.goalGateCheck({
    flow_id: f.flowId,
    provided: { implementation_done: true, changed_files: [changedFile] }
  } as never)) as Record<string, unknown>;
  expect(implGate.status).toBe("passed");
  await f.engine.goalAdvance({ flow_id: f.flowId } as never);
  await attachTestReceipt(f);
  return (await f.engine.goalGateCheck({
    flow_id: f.flowId,
    provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] }
  } as never)) as Record<string, unknown>;
}

function git(workspace: string, args: string[], input?: string) {
  return execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8", input });
}

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("gate-integrity-hardening-3 (R2/R3/R6)", () => {
  it("R2 strict changed_files rejects scalar/object/empty and does not advance", async () => {
    const f = await fixtureGoal("Probe R2 strict changed_files.");
    await f.engine.goalAdvance({ flow_id: f.flowId } as never);
    for (const junk of ["false", {}, 0]) {
      await expect(
        f.engine.goalGateCheck({
          flow_id: f.flowId,
          provided: { implementation_done: true, changed_files: junk }
        } as never)
      ).rejects.toThrow(/PPIRTV_INPUT_INVALID/);
    }
    const empty = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { implementation_done: true, changed_files: [] }
    } as never)) as Record<string, unknown>;
    expect(empty.status).toBe("blocked");
    expect(empty.missing).toContain("changed_files");
    await expect(
      f.engine.goalAdvance({
        flow_id: f.flowId,
        provided: { implementation_done: true, changed_files: "false" }
      } as never)
    ).rejects.toThrow(/PPIRTV_INPUT_INVALID/);
    const gate = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { implementation_done: true, changed_files: ["src/a.ts"] }
    } as never)) as Record<string, unknown>;
    expect(gate.status).toBe("passed");
  });

  it("R3 review currency: claims-only same-path blocks; structured review current passes", async () => {
    const f = await fixtureGoal("Probe R3 review currency.");
    const gate = await climbToReviewClaimsOnly(f);
    expect(gate.status).toBe("passed");
    await writeFile(path.join(f.workspace, "src", "a.ts"), "export const a = 2;\n", "utf8");
    const blocked = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] }
    } as never)) as Record<string, unknown>;
    expect(blocked.status).toBe("blocked");
    expect(blocked.missing).toContain("review_current");
    const staleAdvance = (await f.engine.goalAdvance({ flow_id: f.flowId } as never)) as Record<string, unknown>;
    expect(staleAdvance.advanced).toBe(false);
    const flow = await f.engine.store.loadFlow(f.flowId);
    expect(flow.phase).toBe("revisao");
    const review = await attachStructuredReview(f, "src/a.ts");
    expect(review.evidence_id).toBeTruthy();
    const fresh = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] }
    } as never)) as Record<string, unknown>;
    expect(fresh.status).toBe("passed");
    const advanced = (await f.engine.goalAdvance({ flow_id: f.flowId } as never)) as Record<string, unknown>;
    expect(advanced.advanced).toBe(true);
  });

  it("R5 evidence relevance (mitigacao): criterion_proof nao substitui review estruturada", async () => {
    const f = await fixtureGoal("Probe R5 evidence relevance.");
    await f.engine.goalAdvance({ flow_id: f.flowId } as never);
    await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { implementation_done: true, changed_files: ["src/a.ts"] }
    } as never);
    await f.engine.goalAdvance({ flow_id: f.flowId } as never);
    await attachTestReceipt(f);
    await addDeclarativeEvidence(
      f.engine as never,
      f.engine as never,
      {
        flow_id: f.flowId,
        title: "ER-01 criterion proof",
        declarative_proof: {
          task_id: "A-01",
          evidence_requirement_id: "ER-01",
          observed_value: true,
          paths: ["src/a.ts"]
        }
      },
      declarativeDefaults()
    );
    const gate = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] }
    } as never)) as Record<string, unknown>;
    expect(gate.status).toBe("passed");
    await writeFile(path.join(f.workspace, "src", "a.ts"), "export const a = 3;\n", "utf8");
    const blocked = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] }
    } as never)) as Record<string, unknown>;
    expect(blocked.status).toBe("blocked");
    expect(blocked.missing).toContain("review_current");
  });

  it("R6 Git corroboration: code changed but declared as doc is review_required", async () => {
    const f = await fixtureGoal("Probe R6 changed_files corroboration.", "mechanical");
    git(f.workspace, ["init"]);
    git(f.workspace, ["config", "user.email", "fixture@example.com"]);
    git(f.workspace, ["config", "user.name", "Fixture"]);
    await writeFile(path.join(f.workspace, ".gitignore"), ".ppirtv/\n.agents/\n", "utf8");
    git(f.workspace, ["add", ".gitignore", "src", "docs"]);
    git(f.workspace, ["commit", "-m", "base"]);
    await writeFile(path.join(f.workspace, "src", "a.ts"), "export const a = 2;\n", "utf8");
    await f.engine.goalAdvance({ flow_id: f.flowId } as never);
    await f.engine.goalAdvance({
      flow_id: f.flowId,
      provided: { implementation_done: true, changed_files: ["docs/note.md"] }
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
          paths: ["docs/note.md"]
        }
      },
      declarativeDefaults()
    );
    const evidenceIds = [receipt.evidence_id, ...proof.evidence_ids].filter(Boolean) as string[];
    await expect(
      f.engine.goalVerdict({
        flow_id: f.flowId,
        status: "pronto",
        rationale: "mechanical spoofed doc",
        evidence_ids: evidenceIds,
        next_step: "concluir agora",
        review_findings: ["none"]
      } as never)
    ).rejects.toThrow(/review_required/);
  });
});