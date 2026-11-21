#!/usr/bin/env node
// ISSUE-LOCAL-0015 — probe de diagnóstico cross-platform (Trilho
// 2026-11-21-issue0015-pre-upgrade-cross-platform, task A-01).
//
// Reproduz o cenário do it "keeps a pre-upgrade review without a fingerprint
// fail-closed" (tests/engine.test.ts) contra o motor COMPILADO (dist/) e
// dumpa todos os valores que entram na validação da review do verdict:
// fingerprint da review x fingerprint do flow (persistido/corroborado),
// reviewEvidenceDiagnostics.reasons, changed_files persistido x corroborado,
// realpath do workspace e resultado do goalVerdict.
//
// Descartável por desenho: removido no corte da cura (task A-03 do Trilho).
// RED histórico que motivou: run 44617044985 (job ubuntu, commit 0696e6b) —
// o PRIMEIRO goalVerdict lança PPIRTV_FISCAL_BLOCKED review_required.
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { FlowEngine } from "../dist/flow-engine.js";
import { PpirtvStore } from "../dist/store.js";
import { reviewEvidenceDiagnostics, isStructuredReviewEvidence } from "../dist/gate-resolution.js";
import {
  withGitCorroboratedChangedFiles,
  withCurrentImplementationFingerprint,
  fingerprintReviewedImplementation,
  strictReviewSnapshotFingerprint
} from "../dist/review-snapshot.js";

const KEY = "dex-code:test-terminal-review-pre-upgrade-diag";

function fakeSptTextV2(workspace, objective) {
  return [
    "---",
    "dex_contract: spt",
    "version: 2",
    "status: EM_TESTE",
    "owner: Teste",
    "date: '2026-05-24'",
    `workspace: ${JSON.stringify(workspace)}`,
    "origin: teste",
    "goal:",
    "  id: fake-goal-spt",
    "  title: Fake GOAL SPT",
    `  objective: ${objective}`,
    "context: Teste local do contrato GOAL/SPT.",
    "problem: Garantir que o flow receba campos normalizados.",
    "decision: Usar SPT v2 em .agents/PLAN-TASKS.",
    "scope:",
    "  include:",
    "    - Validar SPT local.",
    "  exclude:",
    "    - Alterar componentes externos.",
    "spec: Executar ponte GOAL/SPT com evidencia rastreavel.",
    "plan:",
    "  - Validar SPT.",
    "  - Criar flow.",
    "  - Registrar evidencia.",
    "tasks:",
    "  - Rodar teste local.",
    "expected_evidence:",
    "  - npm run check.",
    "done_criteria:",
    "  - npm run check.",
    "risks:",
    "  - Falso pronto sem evidencia.",
    "uncertainties:",
    "  - Cliente de teste pode variar o objective do envelope.",
    "gates:",
    "  - tasks, expected_evidence e done_criteria preenchidos.",
    "validation:",
    "  - npm run check.",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute este SPT.",
    "---",
    "# Human test notes"
  ].join("\n");
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-diag-0015-"));
  const previousUserProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = path.join(tempRoot, "home-without-shared-principles");
  const report = { platform: process.platform, tmpdir: os.tmpdir() };
  try {
    const engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const workspace = path.join(tempRoot, KEY.replace(/[^a-z0-9_-]+/gi, "-"));
    const sptDir = path.join(workspace, ".agents", "PLAN-TASKS");
    await mkdir(sptDir, { recursive: true });
    const sptPath = path.join(sptDir, "2026-05-24-fake-goal-spt.md");
    const objective = "Preservar review legitimo criado antes do snapshot versionado";
    await writeFile(sptPath, fakeSptTextV2(workspace, objective), "utf8");
    for (const relativePath of ["docs/contract.md", "docs/status.md", "src/flow-engine.ts", "src/l1-adapter.ts", "src/server.ts", "src/x.ts"]) {
      const target = path.join(workspace, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `fixture:${relativePath}\n`, "utf8");
    }

    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective,
      idempotency_key: KEY,
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    });
    const flowId = started.flow_id;
    const baseEvidence = await engine.addGoalEvidence({ flow_id: flowId, title: "npm run check", content: "pass", satisfies: ["npm run check"] });

    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId, provided: { implementation_done: true, changed_files: ["src\\flow-engine.ts"] } });

    let flow = await engine.store.loadFlow(flowId);
    const helperFingerprint = await fingerprintReviewedImplementation(
      workspace,
      flow.changed_files,
      process.platform,
      { allowedMissingFiles: flow.deleted_files ?? [] }
    );
    const review = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review estruturado anterior ao upgrade",
      reviewed_implementation_fingerprint: helperFingerprint,
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["compatibilidade de upgrade"],
        findings: [],
        regression_risks: ["compatibilidade de upgrade"]
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });

    flow = await engine.store.loadFlow(flowId);
    const reviewEvidence = flow.evidence.find((item) => item.evidence_id === review.evidence_id);
    const corroborated = await withGitCorroboratedChangedFiles(flow);
    const reanchored = await withCurrentImplementationFingerprint(corroborated);
    const strictPersisted = await strictReviewSnapshotFingerprint(flow).catch((error) => `ERROR: ${error.message}`);

    report.workspace = workspace;
    report.workspace_realpath = await realpath(workspace);
    report.git_head_base = flow.git_head_base ?? null;
    report.phase = flow.phase;
    report.changed_files_persisted = flow.changed_files;
    report.deleted_files_persisted = flow.deleted_files ?? [];
    report.changed_files_corroborated = corroborated.changed_files;
    report.git_unresolved_commits = corroborated.git_unresolved_commits ?? null;
    report.fingerprint_review_evidence = reviewEvidence.reviewed_implementation_fingerprint ?? null;
    report.fingerprint_flow_persisted = flow.implementation_fingerprint ?? null;
    report.fingerprint_helper_recomputed = helperFingerprint;
    report.fingerprint_strict_persisted_flow = strictPersisted;
    report.fingerprint_reanchored = reanchored.implementation_fingerprint ?? null;
    report.diagnostics_persisted = reviewEvidenceDiagnostics(flow, reviewEvidence);
    report.diagnostics_corroborated = reviewEvidenceDiagnostics(reanchored, reviewEvidence);
    report.structured_valid_persisted = isStructuredReviewEvidence(flow, reviewEvidence);
    report.structured_valid_corroborated = isStructuredReviewEvidence(reanchored, reviewEvidence);

    try {
      const verdict = await engine.goalVerdict({
        flow_id: flowId,
        status: "pronto",
        rationale: "Review anterior ao campo de snapshot.",
        evidence_ids: [baseEvidence.evidence_id, review.evidence_id],
        review_artifact_path: ".agents/REPORTS/review-pre-upgrade.md",
        review_findings: ["SRC/flow-engine.ts foi revisado"],
        next_step: "encerrar agora"
      });
      report.verdict_thrown = false;
      report.verdict_keys = Object.keys(verdict ?? {});
    } catch (error) {
      report.verdict_thrown = true;
      report.verdict_error = String(error.message ?? error);
    }
  } finally {
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
  console.log("DIAG-0015-REPORT " + JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("DIAG-0015-FAILED", error);
  process.exit(1);
});
