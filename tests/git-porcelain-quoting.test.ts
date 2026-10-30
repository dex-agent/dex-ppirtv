// SPT 2026-10-30-git-porcelain-nul-quoting (T-1, RED-first).
// Consumo da pendência PPIRTV-GIT-QUOTING-UNWRAP-001 (laudo
// .agents/AUDITORIAS/2026-10-30-ppirtv-git-quoting-unwrap-laudo.md, recepção
// confirmada por reprodução independente + divergência D1: diff --name-only
// quoteia non-ASCII com escapes octais).
// Comportamentos contratados:
// - C-1: parsers de corroboração imunes a C-quoting (status espaçado cru,
//   diff non-ASCII cru, rename mantém o alvo novo) — saída -z NUL-delimited.
// - C-2: e2e strict — untracked espaçado NÃO congela entrada quotada no
//   changed_files e a review estrutural anexa sem REVIEW_SNAPSHOT_FILE_REQUIRED.
// - C-3: ponte legacy — entry congelada '"a b.txt"' resolve via
//   prefer-exact-then-unquoted (fingerprint idêntico ao do path despido);
//   ambas as formas ausentes seguem fail-closed (guard, verde nas duas épocas).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { fingerprintReviewedImplementation, gitChangedFiles, gitCommittedFilesSince } from "../src/review-snapshot.js";
import { PpirtvStore } from "../src/store.js";
import type { Flow } from "../src/domain.js";

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

const git = (workspace: string, args: string[]) =>
  execFileSync("git", ["-C", workspace, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();

async function makeQuotingWorkspace(): Promise<{ workspace: string; sptPath: string }> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "git-quoting-"));
  const workspace = path.join(tempRoot, "ws");
  await mkdir(path.join(workspace, ".agents", "PLAN-TASKS"), { recursive: true });
  await mkdir(path.join(workspace, "src"), { recursive: true });
  git(workspace, ["init", "-q"]);
  git(workspace, ["config", "user.email", "test@fixture"]);
  git(workspace, ["config", "user.name", "test"]);
  // Fixture: untracked com ESPAÇO no nome (o gatilho do quoting no porcelain).
  await writeFile(path.join(workspace, "a b.txt"), "spaced real content\n", "utf8");
  await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "2026-10-30-fake-quoting.md");
  await writeFile(sptPath, [
    "---", "dex_contract: spt", "version: 3", "status: EM_TESTE", "owner: Teste",
    "date: '2026-10-30'", `workspace: ${JSON.stringify(workspace)}`, "origin: fixture",
    "goal:", "  id: fake-quoting", "  title: Fake",
    `  objective: ${JSON.stringify("Fixture: untracked espaçado não congela entry quotada.")}`,
    "context: Fixture.", "problem: Quoting.", "decision: Testar.",
    "scope:", "  include:", "    - Validar snapshot.", "  exclude:", "    - Externo.",
    "requirements:",
    "  - id: REQ-01", "    statement: O flow deve iniciar.",
    "    criteria:",
    "      - id: C-01", "        statement: goal_start retorna flow_id.",
    "plan: [Teste.]", "tasks:",
    "  - id: A-01", "    action: Chamar goal_start e verdict.", "    covers: [REQ-01]",
    "    done_when: [C-01]", "    depends_on: []",
    "    evidence_requirements:",
    "      - id: ER-01", "        proves: [C-01]", "        method: test",
    "        procedure: Observar flow_id.", "        expectation:", "          kind: boolean_assertion", "          expected: true",
    "closure_gates: [Nenhum.]", "risks:", "  - Falso pronto.", "uncertainties:", "  - nenhuma.",
    "gates:", "  - preenchidos.", "validation:", "  - local.", "execution_prompt: |", "  /GOAL", "---", "# t", ""
  ].join("\n"), "utf8");
  return { workspace, sptPath };
}

async function startFixtureGoal(workspace: string, sptPath: string) {
  const engine = new FlowEngine(new PpirtvStore(path.join(workspace, ".ppirtv")), undefined, {});
  const started = (await engine.startGoal({
    workspace, spt_path: sptPath,
    objective: "Fixture: untracked espaçado não congela entry quotada.",
    idempotency_key: `quoting-test-${Math.random().toString(36).slice(2, 8)}`,
    evidence_required: true, required_evidence: ["teste"],
    requested_verdict_policy: "evidence_required", source: "dex-code"
  } as never)) as Record<string, unknown>;
  return { engine, flowId: String(started.flow_id) };
}

describe("C-1: parsers imunes a C-quoting (saída -z)", () => {
  it("status com untracked espaçado devolve o path cru (sem aspas)", async () => {
    const { workspace } = await makeQuotingWorkspace();
    const files = await gitChangedFiles(workspace);
    expect(files).toContain("a b.txt");
    expect(files?.some((file) => file.startsWith('"'))).toBe(false);
  });

  it("diff committed-since com non-ASCII devolve o path cru (sem escapes octais)", async () => {
    const { workspace } = await makeQuotingWorkspace();
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-qm", "base"]);
    const base = git(workspace, ["rev-parse", "HEAD"]).trim();
    await writeFile(path.join(workspace, "ação.txt"), "conteudo não ascii\n", "utf8");
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-qm", "acao"]);
    const since = await gitCommittedFilesSince(workspace, base);
    expect(since?.files).toContain("ação.txt");
    expect(since?.files?.some((file) => file.startsWith('"'))).toBe(false);
  });

  it("rename no status mantém o ALVO novo (origem do -z consumida)", async () => {
    const { workspace } = await makeQuotingWorkspace();
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-qm", "base"]);
    git(workspace, ["mv", "a b.txt", "e f.txt"]);
    const files = await gitChangedFiles(workspace);
    expect(files).toContain("e f.txt");
    expect(files).not.toContain("a b.txt");
    expect(files?.some((file) => file.startsWith('"'))).toBe(false);
  });
});

describe("C-2: e2e strict — espaçado não congela entry quotada", () => {
  it("verdict congela corroboração SEM aspas e review anexa sem FILE_REQUIRED", async () => {
    const { workspace, sptPath } = await makeQuotingWorkspace();
    const { engine, flowId } = await startFixtureGoal(workspace, sptPath);
    await engine.goalGateCheck({
      flow_id: flowId, phase: "implementacao", persist: true,
      provided: { implementation_done: true, changed_files: ["src/a.ts"], deleted_files: [] }
    });
    await engine.attachEvidence({
      flow_id: flowId, kind: "goal_evidence", title: "Prova C-01",
      criterion_proof: {
        task_id: "A-01", requirement_id: "REQ-01", criterion_id: "C-01", evidence_requirement_id: "ER-01",
        observed_value: true,
        revision_set: [{
          workspace,
          paths: [{ path: "src/a.ts", sha256: createHash("sha256").update("export const a = 1;\n").digest("hex") }]
        }],
        environment: "test", producer: "vitest", timestamp: new Date().toISOString(), limits: ["fixture"]
      }
    });
    const flowAfterProof = await engine.store.loadFlow(flowId);
    const proofId = flowAfterProof.evidence.at(-1)!.evidence_id;
    // Verdict positivo bloqueado (review_required) persiste a união de
    // corroboração: o espaçado entra — e o contrato é entrar SEM aspas.
    await expect(
      engine.goalVerdict({ flow_id: flowId, status: "pronto", rationale: "Fixture.", evidence_ids: [proofId] })
    ).rejects.toThrow(/review_required/);
    const persisted = await engine.store.loadFlow(flowId);
    expect(persisted.changed_files.some((file) => /^".*"$/s.test(file))).toBe(false);
    expect(persisted.changed_files).toContain("a b.txt");
    // A review estrutural strict anexa sobre o fp corrente SEM FILE_REQUIRED
    // (o espaçado real é hasheado; nada de path impossível com aspas).
    const status = (await engine.goalStatus({ flow_id: flowId, detail: "full" })) as Record<string, unknown>;
    const fingerprint = String(status.implementation_fingerprint);
    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    await engine.attachEvidence({
      flow_id: flowId, kind: "code_review", title: "Review estrutural fixture",
      scope_classification: "target", scope_reference: "src/review-snapshot.ts",
      reviewed_implementation_fingerprint: fingerprint,
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true, barata_scan: true,
        reviewed_targets: persisted.changed_files,
        searched_patterns: ["porcelain quoting", "diff name-only"], findings: [],
        regression_risks: ["fixture"]
      }
    });
  });
});

describe("C-3: ponte legacy para entry quotada congelada", () => {
  it('entry \'"a b.txt"\' resolve o arquivo real: fingerprint IGUAL ao do path despido', async () => {
    const { workspace } = await makeQuotingWorkspace();
    const viaLegacy = await fingerprintReviewedImplementation(
      workspace, ['"a b.txt"'], "linux", { requireReviewableFiles: true }
    );
    const viaReal = await fingerprintReviewedImplementation(
      workspace, ["a b.txt"], "linux", { requireReviewableFiles: true }
    );
    expect(viaLegacy).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(viaLegacy).toBe(viaReal);
  });

  it("guard: ambas as formas ausentes seguem fail-closed FILE_REQUIRED", async () => {
    const { workspace } = await makeQuotingWorkspace();
    await expect(
      fingerprintReviewedImplementation(workspace, ['"zz inexistente.txt"'], "linux", { requireReviewableFiles: true })
    ).rejects.toThrow("REVIEW_SNAPSHOT_FILE_REQUIRED");
  });
});
