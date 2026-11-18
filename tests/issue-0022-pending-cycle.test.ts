// Corte B' — CICLO PENDING COMPLETO (2026-11-18, issues #22 #23 #24 #25).
// Causa-raiz única: o anexo evidence_add e o fiscal goal_verdict consultam
// fontes diferentes para o mesmo escopo pending (veredito $oraculo-legado:
// intercepção de nível superior na A2 deixou os vizinhos sem intercepção).
// Contratos por issue — NUNCA podar:
// - #24 (C-01/C-07): exclusão confirmada pelo Git tem a MESMA representação
//   na avaliação e no anexo — review com o hash do evento anexa com checkout
//   estável; ausente SEM exclusão comprovada continua FILE_REQUIRED.
// - #25 (C-02/C-08): após attribution válida, o anexo admite a review do
//   escopo CORRENTE e rejeita a do escopo congelado antigo; o fiscal
//   reconhece a mesma revisão no retry sem exigir review_required.
// - #23 (C-03): recarregado após o anexo aceito, o recálculo do fingerprint
//   pelo próprio flow é idêntico ao persistido (uma só verdade).
// - #22 (C-04): goal_status com pendência publica pending_review_scope com
//   changed_files e fingerprint que o anexo aceita sem alteração intermediária.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { fingerprintReviewedImplementation, strictReviewSnapshotFingerprint } from "../src/review-snapshot.js";
import { PpirtvStore } from "../src/store.js";
import type { Flow } from "../src/domain.js";

let tempRoot = "";
afterEach(async () => {
  vi.unstubAllEnvs();
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

const git = (workspace: string, args: string[]) =>
  execFileSync("git", ["-C", workspace, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();

const sha = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

async function makeWorkspace(): Promise<{ workspace: string; sptPath: string }> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-bp-"));
  const workspace = path.join(tempRoot, "ws");
  await mkdir(path.join(workspace, ".agents", "PLAN-TASKS"), { recursive: true });
  await mkdir(path.join(workspace, "src"), { recursive: true });
  git(workspace, ["init", "-q"]);
  git(workspace, ["config", "user.email", "test@fixture"]);
  git(workspace, ["config", "user.name", "test"]);
  git(workspace, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(workspace, "README.md"), "# base\n", "utf8");
  await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  // #24: removed.ts EXISTE no base — o commit pós-start o remove.
  await writeFile(path.join(workspace, "removed.ts"), "export const gone = 1;\n", "utf8");
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-qm", "base"]);
  const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "2026-11-18-fake-bp.md");
  await writeFile(sptPath, [
    "---", "dex_contract: spt", "version: 3", "status: EM_TESTE", "owner: Teste",
    "date: '2026-11-18'", `workspace: ${JSON.stringify(workspace)}`, "origin: fixture",
    "goal:", "  id: fake-bp", "  title: Fake",
    `  objective: ${JSON.stringify("Fixture: ciclo pending anexo e fiscal consultam a mesma fonte.")}`,
    "context: Fixture.", "problem: Pending.", "decision: Testar.",
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
    objective: "Fixture: ciclo pending anexo e fiscal consultam a mesma fonte.",
    idempotency_key: `bp-test-${Math.random().toString(36).slice(2, 8)}`,
    evidence_required: true, required_evidence: ["teste"],
    requested_verdict_policy: "evidence_required", source: "dex-code"
  } as never)) as Record<string, unknown>;
  const flowId = String(started.flow_id);
  // Gate aprovado congela o snapshot base {src/a.ts} e o CP prova C-01.
  await engine.goalGateCheck({
    flow_id: flowId, phase: "implementacao", persist: true,
    provided: { implementation_done: true, changed_files: ["src/a.ts"], deleted_files: [] }
  });
  await engine.attachEvidence({
    flow_id: flowId, kind: "goal_evidence", title: "Prova C-01",
    criterion_proof: {
      task_id: "A-01", requirement_id: "REQ-01", criterion_id: "C-01", evidence_requirement_id: "ER-01",
      observed_value: true,
      // CP bound ao README (estável): o it 24 modifica src/a.ts e remove
      // removed.ts no commit pós-start — CP em arquivo mutável morre em
      // SPT_V3_EVIDENCE_STALE antes de registrar o bloqueio pending.
      revision_set: [{
        workspace,
        paths: [{ path: "README.md", sha256: sha("# base\n") }]
      }],
      environment: "test", producer: "vitest", timestamp: new Date().toISOString(), limits: ["fixture"]
    }
  });
  const flowAfterProof = await engine.store.loadFlow(flowId);
  const proofId = flowAfterProof.evidence.at(-1)!.evidence_id;
  return { engine, flowId, proofId };
}

/** Commit pós-start + verdict positivo → bloqueia review_required e registra pending. */
async function bloquearComPending(
  engine: FlowEngine, flowId: string, proofId: string, workspace: string,
  commit: (ws: string) => Promise<void>
): Promise<{ pending: { changed_files: string[]; fingerprint: string } }> {
  await commit(workspace);
  await expect(
    engine.goalVerdict({ flow_id: flowId, status: "pronto", rationale: "Fixture.", evidence_ids: [proofId], next_step: "registrar o bloqueio" })
  ).rejects.toThrow(/review_required/);
  const flow = await engine.store.loadFlow(flowId);
  const block = flow.history.filter((event) => event.type === "fiscal_policy_blocked").at(-1)?.data as Record<string, unknown>;
  const pending = {
    changed_files: (block.pending_changed_files as string[]) ?? [],
    fingerprint: String(block.pending_review_fingerprint ?? "")
  };
  expect(pending.changed_files.length).toBeGreaterThan(1);
  expect(pending.fingerprint).toMatch(/^sha256:/);
  return { pending };
}

function reviewBody(flowId: string, fingerprint: string, targets: string[], scopeReference = "src/a.ts") {
  return {
    flow_id: flowId, kind: "code_review" as const, title: "Review estrutural fixture",
    scope_classification: "target" as const, scope_reference: scopeReference,
    reviewed_implementation_fingerprint: fingerprint,
    satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
    observed_result: {
      diff_reviewed: true, barata_scan: true,
      reviewed_targets: targets,
      searched_patterns: ["pending cycle"], findings: [],
      regression_risks: ["fixture"]
    }
  };
}

// Réplica do excludedPathsFingerprint (privado): o binding da attribution
// exige exatamente este valor — fingerprintReviewedImplementation é export.
async function bindingFingerprint(workspace: string, paths: string[]): Promise<string> {
  const missing: string[] = [];
  for (const relative of paths) {
    try { await lstat(path.resolve(workspace, relative)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(relative);
    }
  }
  return fingerprintReviewedImplementation(workspace, paths, process.platform, {
    requireReviewableFiles: true, allowedMissingFiles: missing
  });
}

describe("issue 24 — exclusao confirmada pelo Git com a mesma representacao", () => {
  it("cura review com o hash do evento anexa quando o pending contem arquivo removido por commit", async () => {
    vi.stubEnv("PPIRTV_GRAPHIFY_RECALL", "1");
    const { workspace, sptPath } = await makeWorkspace();
    const { engine, flowId, proofId } = await startFixtureGoal(workspace, sptPath);
    const { pending } = await bloquearComPending(engine, flowId, proofId, workspace, async (ws) => {
      // Commit pós-start: modifica src/a.ts E remove removed.ts (diff D).
      await writeFile(path.join(ws, "src", "a.ts"), "export const a = 2;\n", "utf8");
      git(ws, ["rm", "-q", "removed.ts"]);
      git(ws, ["add", "."]);
      git(ws, ["commit", "-qm", "remove e modifica"]);
    });
    // review com o fp publicado no evento, targets = conjunto pending
    await expect(
      engine.attachEvidence(reviewBody(flowId, pending.fingerprint, pending.changed_files))
    ).resolves.toBeTruthy();
  });

  it("caracterizacao ausente sem exclusao comprovada continua FILE_REQUIRED", async () => {
    const { workspace, sptPath } = await makeWorkspace();
    const { engine, flowId } = await startFixtureGoal(workspace, sptPath);
    const flow = await engine.store.loadFlow(flowId);
    const comFantasma: Flow = { ...flow, changed_files: ["zz inexistente.ts"] };
    await expect(
      strictReviewSnapshotFingerprint(comFantasma, { requireReviewableFiles: true })
    ).rejects.toThrow("REVIEW_SNAPSHOT_FILE_REQUIRED");
  });
});

describe("issue 25 — escopo corrente pos-attribution admitido na primeira revisao", () => {
  it("cura attribution valida admite a review do escopo corrente e rejeita a do congelado antigo", async () => {
    vi.stubEnv("PPIRTV_GRAPHIFY_RECALL", "1");
    const { workspace, sptPath } = await makeWorkspace();
    const { engine, flowId, proofId } = await startFixtureGoal(workspace, sptPath);
    const { pending } = await bloquearComPending(engine, flowId, proofId, workspace, async (ws) => {
      await writeFile(path.join(ws, "a b.txt"), "spaced real content\n", "utf8");
      git(ws, ["add", "."]);
      git(ws, ["commit", "-qm", "adiciona espacado"]);
    });
    expect(pending.changed_files).toContain("a b.txt");
    // Attribution válida: a b.txt é trabalho de outro escopo.
    const flowPre = await engine.store.loadFlow(flowId);
    const binding = {
      git_head_base: flowPre.git_head_base ?? null,
      fingerprint: await bindingFingerprint(workspace, ["a b.txt"])
    };
    await engine.attachEvidence({
      flow_id: flowId, kind: "review_scope_attribution", title: "a b.txt e de outro trabalho",
      scope_classification: "outside", scope_reference: "a b.txt",
      observed_result: {
        reviewer: "revisor-fixture",
        excluded_paths: [{ path: "a b.txt", reason: "commit de terceiro", source: "git diff" }],
        attribution_binding: { version: 1, ...binding }
      }
    });
    const flowPos = await engine.store.loadFlow(flowId);
    const attributionId = flowPos.evidence.at(-1)!.evidence_id;
    // Escopo CORRENTE pós-attribution = corroborado filtrado = {src/a.ts}.
    const corrente: Flow = { ...flowPos, changed_files: ["src/a.ts"] };
    const fpCorrente = await strictReviewSnapshotFingerprint(corrente);
    await expect(
      engine.attachEvidence(reviewBody(flowId, fpCorrente, ["src/a.ts"]))
    ).resolves.toBeTruthy();
    // A review do escopo CONGELADO antigo (2 arquivos) passa a ser rejeitada.
    await expect(
      engine.attachEvidence(reviewBody(flowId, pending.fingerprint, pending.changed_files))
    ).rejects.toThrow(/REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH/);
    expect(attributionId).toBeTruthy();
  });

  it("cura fiscal reconhece a mesma revisao no retry sem exigir review_required", async () => {
    vi.stubEnv("PPIRTV_GRAPHIFY_RECALL", "1");
    const { workspace, sptPath } = await makeWorkspace();
    const { engine, flowId, proofId } = await startFixtureGoal(workspace, sptPath);
    await bloquearComPending(engine, flowId, proofId, workspace, async (ws) => {
      await writeFile(path.join(ws, "a b.txt"), "spaced real content\n", "utf8");
      git(ws, ["add", "."]);
      git(ws, ["commit", "-qm", "adiciona espacado"]);
    });
    const flowPre = await engine.store.loadFlow(flowId);
    const binding = {
      git_head_base: flowPre.git_head_base ?? null,
      fingerprint: await bindingFingerprint(workspace, ["a b.txt"])
    };
    await engine.attachEvidence({
      flow_id: flowId, kind: "review_scope_attribution", title: "a b.txt e de outro trabalho",
      scope_classification: "outside", scope_reference: "a b.txt",
      observed_result: {
        reviewer: "revisor-fixture",
        excluded_paths: [{ path: "a b.txt", reason: "commit de terceiro", source: "git diff" }],
        attribution_binding: { version: 1, ...binding }
      }
    });
    const flowPos = await engine.store.loadFlow(flowId);
    const attributionId = flowPos.evidence.at(-1)!.evidence_id;
    const corrente: Flow = { ...flowPos, changed_files: ["src/a.ts"] };
    const fpCorrente = await strictReviewSnapshotFingerprint(corrente);
    await engine.attachEvidence(reviewBody(flowId, fpCorrente, ["src/a.ts"]));
    const flowRev = await engine.store.loadFlow(flowId);
    const reviewId = flowRev.evidence.at(-1)!.evidence_id;
    // Retry: o fiscal corrobora {src/a.ts}, a review vigente CITADA satisfaz —
    // sem segunda rodada (o verdict valida as reviews que ele cita).
    await expect(
      engine.goalVerdict({
        flow_id: flowId, status: "pronto", rationale: "Fixture.",
        evidence_ids: [proofId, reviewId], scope_attribution_evidence_ids: [attributionId],
        next_step: "encerrar fixture"
      })
    ).resolves.toBeTruthy();
  });
});

describe("issue 23 — persistencia os-dois-ou-nenhum", () => {
  it("cura recarregado apos o anexo aceito o recalculo pelo proprio flow e identico ao persistido", async () => {
    vi.stubEnv("PPIRTV_GRAPHIFY_RECALL", "1");
    const { workspace, sptPath } = await makeWorkspace();
    const { engine, flowId, proofId } = await startFixtureGoal(workspace, sptPath);
    const { pending } = await bloquearComPending(engine, flowId, proofId, workspace, async (ws) => {
      await writeFile(path.join(ws, "a b.txt"), "spaced real content\n", "utf8");
      git(ws, ["add", "."]);
      git(ws, ["commit", "-qm", "adiciona espacado"]);
    });
    await expect(
      engine.attachEvidence(reviewBody(flowId, pending.fingerprint, pending.changed_files))
    ).resolves.toBeTruthy();
    const reloaded = await engine.store.loadFlow(flowId);
    const recalculado = await strictReviewSnapshotFingerprint(reloaded);
    expect(recalculado).toBe(reloaded.implementation_fingerprint);
  });
});

describe("issue 22 — status expoe o escopo que o cliente deve atestar", () => {
  it("cura goal_status com pendencia publica pending_review_scope que o anexo aceita", async () => {
    vi.stubEnv("PPIRTV_GRAPHIFY_RECALL", "1");
    const { workspace, sptPath } = await makeWorkspace();
    const { engine, flowId, proofId } = await startFixtureGoal(workspace, sptPath);
    const { pending } = await bloquearComPending(engine, flowId, proofId, workspace, async (ws) => {
      await writeFile(path.join(ws, "a b.txt"), "spaced real content\n", "utf8");
      git(ws, ["add", "."]);
      git(ws, ["commit", "-qm", "adiciona espacado"]);
    });
    const status = (await engine.goalStatus({ flow_id: flowId, detail: "full" })) as Record<string, unknown>;
    const scope = status.pending_review_scope as { changed_files: string[]; fingerprint: string } | null;
    expect(scope).not.toBeNull();
    expect(scope!.fingerprint).toBe(pending.fingerprint);
    expect(scope!.changed_files).toEqual(pending.changed_files);
    expect(status.implementation_fingerprint).toBe(pending.fingerprint);
    // Cliente só do status anexa sem alteração intermediária.
    await expect(
      engine.attachEvidence(reviewBody(flowId, String(status.implementation_fingerprint), scope!.changed_files))
    ).resolves.toBeTruthy();
  });
});
