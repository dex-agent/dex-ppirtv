import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import { makeFlow } from "./helpers/policy-modules-fixture.js";

// EMENDA A2 — DEADLOCK-ANEXO-FISCAL (2026-11-18, GO-PADRAO ao veredito do
// $oraculo-legado: Esboço de Efeitos cap.12 + Pontos de Intercepção cap.13):
// quando commit sai entre goal_start e goal_verdict, o anexo valida o fp
// contra o PERSISTIDO-restaurado e o fiscal contra o CORROBORADO — o ciclo
// fecha registrando o escopo corroborado como pending no evento de bloqueio
// (ponto de intercepção) e o anexo aceitando o fp da UNIÃO. Fiscal INTACTO.
// Caracterização do CICLO com funções reais — NUNCA podar. Títulos SEM
// metacaracteres.
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "ppirtv-a2-"));
});

afterEach(() => {
  if (tempRoot.startsWith(tmpdir())) rmSync(tempRoot, { recursive: true, force: true });
});

function flowComHistoria(eventos: unknown[], changed: string[]): Flow {
  const flow = makeFlow({
    goal_binding: {
      envelope: { workspace: tempRoot, idempotency_key: "emenda-a2", source: "test" },
      spt_path: ".agents/PLAN-TASKS/x.md",
      objective: "emenda a2",
      started_at: "2026-11-18T00:00:00.000Z",
      last_seen_at: "2026-11-18T00:00:00.000Z"
    } as unknown as Flow["goal_binding"],
    changed_files: changed,
  });
  return { ...flow, history: eventos as Flow["history"] };
}

const BLOQUEIO = {
  at: "2026-11-18T16:00:00.000Z",
  type: "fiscal_policy_blocked",
  data: {
    source: "goal_verdict",
    blocking_reasons: ["review_required"],
    pending_review_additions: ["playbook.md", "playbook.index.json"],
    pending_changed_files: ["src/app.ts", "playbook.md", "playbook.index.json"],
    pending_review_fingerprint: "sha256:corroborado"
  }
};

describe("emenda A2 — anexo aceita escopo corroborado pendente do bloqueio", () => {
  it("cura ciclo pendingReviewScopeForAttach devolve o escopo do ultimo bloqueio pendente", async () => {
    const mod = await import("../src/review-snapshot.js") as {
      pendingReviewScopeForAttach?: (flow: Flow) => { changed_files: string[]; fingerprint: string } | null;
    };
    expect(typeof mod.pendingReviewScopeForAttach).toBe("function");
    const flow = flowComHistoria([BLOQUEIO], ["src/app.ts"]);
    const pending = mod.pendingReviewScopeForAttach!(flow);
    expect(pending).not.toBeNull();
    expect(pending!.changed_files).toEqual(["src/app.ts", "playbook.md", "playbook.index.json"]);
    expect(pending!.fingerprint).toBe("sha256:corroborado");
  });

  it("caracterizacao sem bloqueio pendente devolve null e anexo segue exato", async () => {
    const mod = await import("../src/review-snapshot.js") as {
      pendingReviewScopeForAttach?: (flow: Flow) => unknown;
    };
    if (typeof mod.pendingReviewScopeForAttach !== "function") return;
    const limpo = flowComHistoria([], ["src/app.ts"]);
    expect(mod.pendingReviewScopeForAttach!(limpo)).toBeNull();
    const comVerdict = flowComHistoria([BLOQUEIO, { at: "2026-11-18T16:05:00.000Z", type: "verdict_recorded", data: {} }], ["src/app.ts"]);
    expect(mod.pendingReviewScopeForAttach!(comVerdict)).toBeNull();
  });

  it("cura ciclo fingerprint da uniao persistido com pending iguala o corroborado", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    writeFileSync(path.join(tempRoot, "src", "app.ts"), "v1", "utf8");
    writeFileSync(path.join(tempRoot, "playbook.md"), "projecao", "utf8");
    const mod = await import("../src/review-snapshot.js") as {
      pendingReviewScopeForAttach?: (flow: Flow) => { changed_files: string[]; fingerprint: string } | null;
      strictReviewSnapshotFingerprint: (flow: Flow, opts?: { requireReviewableFiles?: boolean }) => Promise<string>;
    };
    expect(typeof mod.strictReviewSnapshotFingerprint).toBe("function");
    expect(typeof mod.pendingReviewScopeForAttach).toBe("function");
    // corroborado: o conjunto ampliado que o fiscal avaliara
    const corroborado = flowComHistoria([], ["src/app.ts", "playbook.md"]);
    const fpCorroborado = await mod.strictReviewSnapshotFingerprint(corroborado, { requireReviewableFiles: true });
    // flow persistido com bloqueio pendente apontando o escopo corroborado
    const persistido = flowComHistoria([{
      ...BLOQUEIO,
      data: { ...BLOQUEIO.data, pending_changed_files: corroborado.changed_files, pending_review_fingerprint: fpCorroborado }
    }], ["src/app.ts"]);
    const pending = mod.pendingReviewScopeForAttach!(persistido);
    expect(pending!.fingerprint).toBe(fpCorroborado);
    // o anexo valida o fp da UNIAO persistido∪pending — bytes estaveis: igual ao corroborado
    const uniao = { ...persistido, changed_files: Array.from(new Set([...persistido.changed_files, ...pending!.changed_files])) };
    const fpUniao = await mod.strictReviewSnapshotFingerprint(uniao, { requireReviewableFiles: true });
    expect(fpUniao).toBe(fpCorroborado);
  });

  it("caracterizacao fiscal intacto exige fingerprint corrente do flow avaliado", async () => {
    const gate = await import("../src/gate-resolution.js");
    writeFileSync(path.join(tempRoot, "app.ts"), "v1", "utf8");
    const flow = flowComHistoria([], ["app.ts"]);
    flow.implementation_fingerprint = "sha256:corrente";
    const reviewBase = {
      evidence_id: "r1", flow_id: flow.flow_id, kind: "code_review",
      scope_classification: "target", scope_reference: "app.ts",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      reviewed_implementation_fingerprint: "sha256:corrente",
      observed_result: {
        diff_reviewed: true, barata_scan: true,
        reviewed_targets: ["app.ts"],
        searched_patterns: ["padrao"], findings: [],
        regression_risks: ["risco"]
      }
    };
    expect(gate.isStructuredReviewEvidence(flow, reviewBase as never)).toBe(true);
    const reviewStale = { ...reviewBase, reviewed_implementation_fingerprint: "sha256:velho" };
    expect(gate.isStructuredReviewEvidence(flow, reviewStale as never)).toBe(false);
  });
});
