// SPT 2026-10-29-env-snapshot-sensitive-redaction (T-1, RED-first).
// Consumo da pendência PPIRTV-ENV-SNAPSHOT-001 (laudo
// .agents/AUDITORIAS/2026-10-29-ppirtv-env-snapshot-untracked-sensivel-laudo.md,
// recepção confirmada por reprodução independente).
// Comportamentos contratados:
// - C-1: a corroboração git NUNCA incorpora paths sensíveis (prevenção do
//   congelamento de .env untracked de terceiros).
// - C-2: sensível NÃO declarado (vítima com estado persistido) é REDIGIDO no
//   snapshot (state redacted_sensitive, conteúdo nunca lido — fingerprint
//   independe do conteúdo) e o flow destrava (gate de revisão e verdict sem
//   REVIEW_SNAPSHOT_SENSITIVE_PATH).
// - C-3: sensível DECLARADO (provided.changed_files) e revision_set de prova
//   seguem fail-closed (contrato do produto próprio preservado).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { fingerprintReviewedImplementation, withGitCorroboratedChangedFiles } from "../src/review-snapshot.js";
import { PpirtvStore } from "../src/store.js";
import type { Flow } from "../src/domain.js";

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

const git = (workspace: string, args: string[]) =>
  execFileSync("git", ["-C", workspace, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();

async function makeVictimWorkspace(): Promise<{ workspace: string; sptPath: string }> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "env-snapshot-"));
  const workspace = path.join(tempRoot, "ws");
  await mkdir(path.join(workspace, ".agents", "PLAN-TASKS"), { recursive: true });
  await mkdir(path.join(workspace, "src"), { recursive: true });
  git(workspace, ["init", "-q"]);
  git(workspace, ["config", "user.email", "test@fixture"]);
  git(workspace, ["config", "user.name", "test"]);
  // Fixture sintética: .env untracked de TERCEIROS (conteúdo nunca lido pelos testes além da reescrita controlada)
  await writeFile(path.join(workspace, ".env"), "FIXTURE_THIRD_PARTY=1\n", "utf8");
  await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "2026-10-29-fake-env.md");
  await writeFile(sptPath, [
    "---", "dex_contract: spt", "version: 3", "status: EM_TESTE", "owner: Teste",
    "date: '2026-10-29'", `workspace: ${JSON.stringify(workspace)}`, "origin: fixture",
    "goal:", "  id: fake-env", "  title: Fake",
    `  objective: ${JSON.stringify("Fixture de vítima: .env untracked de terceiros no workspace.")}`,
    "context: Fixture.", "problem: Union.", "decision: Testar.",
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
    objective: "Fixture de vítima: .env untracked de terceiros no workspace.",
    idempotency_key: `env-test-${Math.random().toString(36).slice(2, 8)}`,
    evidence_required: true, required_evidence: ["teste"],
    requested_verdict_policy: "evidence_required", source: "dex-code"
  } as never)) as Record<string, unknown>;
  return { engine, flowId: String(started.flow_id) };
}

const sha256FileContent = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

async function lastEvidenceId(engine: FlowEngine, flowId: string): Promise<string> {
  const flow = await engine.store.loadFlow(flowId);
  return flow.evidence.at(-1)!.evidence_id;
}

async function attachCriterionProof(engine: FlowEngine, flowId: string, workspace: string, extraPath?: string) {
  const paths = extraPath ? ["src/a.ts", extraPath] : ["src/a.ts"];
  const revisionSet = [{
    workspace,
    paths: paths.map((rel) => ({
      path: rel,
      sha256: createHash("sha256").update(
        rel === "src/a.ts" ? "export const a = 1;\n" : "FIXTURE_DECLARED=1\n"
      ).digest("hex")
    }))
  }];
  await engine.attachEvidence({
    flow_id: flowId,
    kind: "goal_evidence",
    title: "Prova C-01",
    criterion_proof: {
      task_id: "A-01", requirement_id: "REQ-01", criterion_id: "C-01", evidence_requirement_id: "ER-01",
      observed_value: true,
      revision_set: revisionSet,
      environment: "test", producer: "vitest", timestamp: new Date().toISOString(),
      limits: ["fixture"]
    }
  });
  return lastEvidenceId(engine, flowId);
}

describe("C-1: corroboração git não incorpora sensíveis", () => {
  it("workspace com .env untracked: merge não inclui .env no changed_files", async () => {
    const { workspace } = await makeVictimWorkspace();
    const flow = {
      flow_id: "flow_fixture", changed_files: ["src/a.ts"], deleted_files: [],
      goal_binding: { envelope: { workspace } }
    } as unknown as Flow;
    const merged = await withGitCorroboratedChangedFiles(flow);
    expect(merged.changed_files).toContain("src/a.ts");
    expect(merged.changed_files).not.toContain(".env");
  });
});

describe("C-2: sensível não-declarado é redigido (nunca lido)", () => {
  it("opção redactedSensitivePaths redige .env: resolve, sem sha, e independe do conteúdo", async () => {
    const { workspace } = await makeVictimWorkspace();
    const fingerprintA = await fingerprintReviewedImplementation(
      workspace, ["src/a.ts", ".env"], "linux", { redactedSensitivePaths: [".env"] }
    );
    expect(fingerprintA).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Conteúdo NUNCA lido: reescrever .env não muda o fingerprint (entry sem sha).
    await writeFile(path.join(workspace, ".env"), "FIXTURE_REWRITTEN=2\n", "utf8");
    const fingerprintB = await fingerprintReviewedImplementation(
      workspace, ["src/a.ts", ".env"], "linux", { redactedSensitivePaths: [".env"] }
    );
    expect(fingerprintB).toBe(fingerprintA);
    // E o arquivo real (não-sensível) CONTINUA hasheado: mudança em src/a.ts muda o fingerprint.
    await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 2;\n", "utf8");
    const fingerprintC = await fingerprintReviewedImplementation(
      workspace, ["src/a.ts", ".env"], "linux", { redactedSensitivePaths: [".env"] }
    );
    expect(fingerprintC).not.toBe(fingerprintA);
    expect(sha256FileContent("export const a = 2;\n")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sem a opção, o comportamento atual (throw) permanece — contrato antigo intacto", async () => {
    const { workspace } = await makeVictimWorkspace();
    await expect(
      fingerprintReviewedImplementation(workspace, ["src/a.ts", ".env"], "linux")
    ).rejects.toThrow("REVIEW_SNAPSHOT_SENSITIVE_PATH");
  });

  it("vítima end-to-end: flow com .env congelado destrava (gate revisão + verdict sem SENSITIVE_PATH)", async () => {
    const { workspace, sptPath } = await makeVictimWorkspace();
    const { engine, flowId } = await startFixtureGoal(workspace, sptPath);
    await engine.goalGateCheck({
      flow_id: flowId, phase: "implementacao", persist: true,
      provided: { implementation_done: true, changed_files: ["src/a.ts"], deleted_files: [] }
    });
    const proofId = await attachCriterionProof(engine, flowId, workspace);
    // Verdict positivo bloquea (review_required) SEM congelar .env (prevenção C-1 ativa).
    await expect(
      engine.goalVerdict({ flow_id: flowId, status: "pronto", rationale: "Vítima.", evidence_ids: [proofId] })
    ).rejects.toThrow(/review_required/);
    // Fixture de VÍTIMA LEGADA: estado persistido com .env congelado (o que a
    // corroboração antiga deixou nos flows reais, ex. flow_20261029164933895_0043_0001).
    const persisted = await engine.store.loadFlow(flowId);
    persisted.changed_files = [...persisted.changed_files, ".env"];
    await engine.store.saveFlow(persisted);
    const frozen = await engine.store.loadFlow(flowId);
    expect(frozen.changed_files).toContain(".env");

    // A CURA: fingerprint computa (redação) → review estruturada anexa → gate revisão passa → verdict sem SENSITIVE.
    const status = (await engine.goalStatus({ flow_id: flowId, detail: "full" })) as Record<string, unknown>;
    const fingerprint = String(status.implementation_fingerprint);
    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    await engine.attachEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review estrutural fixture",
      scope_classification: "target",
      scope_reference: "src/a.ts",
      reviewed_implementation_fingerprint: fingerprint,
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true, barata_scan: true,
        reviewed_targets: ["src/a.ts", ".env"],
        searched_patterns: ["fixture"], findings: [], regression_risks: ["fixture"]
      }
    });
    const reviewId = await lastEvidenceId(engine, flowId);
    const revisao = (await engine.goalGateCheck({
      flow_id: flowId, phase: "revisao", persist: true,
      provided: { test_executed: true }
    })) as Record<string, unknown>;
    expect(revisao.status, `gate revisão bloqueado: ${JSON.stringify(revisao)}`).toBe("passed");
    let verdictError = "SEM_ERRO";
    try {
      await engine.goalVerdict({ flow_id: flowId, status: "pronto", rationale: "Vítima destravada.", evidence_ids: [proofId, reviewId] });
    } catch (error) {
      verdictError = String((error as Error).message);
    }
    expect(verdictError).not.toMatch(/REVIEW_SNAPSHOT_SENSITIVE_PATH/);
  });
});

describe("C-3: sensível declarado permanece fail-closed", () => {
  it("provided.changed_files declarando .env → snapshot continua lançando na rota do flow", async () => {
    const { workspace, sptPath } = await makeVictimWorkspace();
    const { engine, flowId } = await startFixtureGoal(workspace, sptPath);
    // A declaração encontra o snapshot já no gate de implementação (fingerprint
    // sobre o provided merged em checkGateUnlocked): fail-closed imediato.
    await expect(
      engine.goalGateCheck({
        flow_id: flowId, phase: "implementacao", persist: true,
        provided: { implementation_done: true, changed_files: ["src/a.ts", ".env"], deleted_files: [] }
      })
    ).rejects.toThrow(/REVIEW_SNAPSHOT_SENSITIVE_PATH/);
  });

  it("revision_set de criterion_proof com .env continua rejeitado (revision_path_sensitive)", async () => {
    const { workspace, sptPath } = await makeVictimWorkspace();
    const { engine, flowId } = await startFixtureGoal(workspace, sptPath);
    await expect(attachCriterionProof(engine, flowId, workspace, ".env")).rejects.toThrow(/sensitive/i);
  });
});
