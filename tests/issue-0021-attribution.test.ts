import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import {
  applyReviewScopeAttributions,
  attributedVerdictSnapshot,
  prepareVerdictSnapshot
} from "../src/review-scope-attribution.js";
import { fingerprintReviewedImplementation } from "../src/review-snapshot.js";
import { makeFlow } from "./helpers/policy-modules-fixture.js";

// Issue #21 Corte A (2026-11-18, auditoria externa): 3 falhas de attribution
// reproduzidas no 94a9b0c. Este teste carrega as reproduções publicadas
// (funções reais na ordem que o motor encadeia l.2577-2582 + l.2654 + l.3963)
// com fixture sintética sem Git — NUNCA podar. Títulos SEM metacaracteres.
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "ppirtv-issue21-a-"));
});

afterEach(() => {
  if (tempRoot.startsWith(tmpdir())) rmSync(tempRoot, { recursive: true, force: true });
});

function flowDe(evidence: Flow["evidence"], changed: string[]): Flow {
  const flow = makeFlow({
    goal_binding: {
      envelope: { workspace: tempRoot, idempotency_key: "issue21-a", source: "test" },
      spt_path: ".agents/PLAN-TASKS/x.md",
      objective: "issue 21 corte a",
      started_at: "2026-11-18T00:00:00.000Z",
      last_seen_at: "2026-11-18T00:00:00.000Z"
    } as unknown as Flow["goal_binding"],
    changed_files: changed,
  });
  return { ...flow, evidence: evidence.map((item) => ({ ...item, flow_id: flow.flow_id })) };
}

async function fixtureAtribuicaoExterna(opcoes: { mutarOther?: boolean } = {}) {
  const workspace = tempRoot;
  writeFileSync(path.join(workspace, "app.ts"), "v1", "utf8");
  writeFileSync(path.join(workspace, "other.ts"), "outside", "utf8");
  const hashOther = await fingerprintReviewedImplementation(workspace, ["other.ts"], process.platform, {
    requireReviewableFiles: true, allowedMissingFiles: []
  });
  if (opcoes.mutarOther) writeFileSync(path.join(workspace, "other.ts"), "outside v2", "utf8");
  const evidence = [{
    evidence_id: "e1", kind: "review_scope_attribution",
    scope_classification: "outside",
    observed_result: {
      reviewer: "qa",
      excluded_paths: [{ path: "other.ts", reason: "outro trabalho", source: "fixture" }],
      attribution_binding: { version: 1, git_head_base: null, fingerprint: hashOther }
    }
  }] as unknown as Flow["evidence"];
  const flowBase = flowDe(evidence, []);
  return { workspace, evidence: flowBase.evidence, flowBase };
}

describe("issue 21 corte A — attribution nas tres falhas publicadas", () => {
  it("cura P1-1 modo automatico rejeita gravacao quando bytes mudam apos a avaliacao", async () => {
    const { workspace, flowBase } = await fixtureAtribuicaoExterna();
    const flow = { ...flowBase, changed_files: ["app.ts"] } as Flow;
    const corroborated = { ...flowBase, changed_files: ["app.ts", "other.ts"] } as Flow;
    const evaluated = await applyReviewScopeAttributions(flow, corroborated, []);
    expect(evaluated.changed_files).toEqual(["app.ts"]);
    writeFileSync(path.join(workspace, "app.ts"), "v2", "utf8");
    const snapshot = attributedVerdictSnapshot({ status: "pronto" } as never, evaluated);
    await expect(prepareVerdictSnapshot(flow, snapshot))
      .rejects.toThrow(/REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH/);
  });

  it("caracterizacao P1-1 modo explicito ja rejeita a mesma mudanca", async () => {
    const { workspace, flowBase } = await fixtureAtribuicaoExterna();
    const flow = { ...flowBase, changed_files: ["app.ts"] } as Flow;
    const corroborated = { ...flowBase, changed_files: ["app.ts", "other.ts"] } as Flow;
    const evaluated = await applyReviewScopeAttributions(flow, corroborated, []);
    writeFileSync(path.join(workspace, "app.ts"), "v2", "utf8");
    const snapshot = attributedVerdictSnapshot({ status: "pronto", scope_attribution_evidence_ids: ["e1"] } as never, evaluated);
    expect(snapshot).toBeDefined();
    await expect(prepareVerdictSnapshot(flow, snapshot))
      .rejects.toThrow(/REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH/);
  });

  it("caracterizacao C-08 arquivos estaveis gravam o mesmo resultado nos dois modos", async () => {
    const { flowBase } = await fixtureAtribuicaoExterna();
    const flow = { ...flowBase, changed_files: ["app.ts"] } as Flow;
    const corroborated = { ...flowBase, changed_files: ["app.ts", "other.ts"] } as Flow;
    const evaluated = await applyReviewScopeAttributions(flow, corroborated, []);
    const auto = await prepareVerdictSnapshot(flow, attributedVerdictSnapshot({ status: "pronto" } as never, evaluated));
    const explicita = await prepareVerdictSnapshot(flow, attributedVerdictSnapshot({ status: "pronto", scope_attribution_evidence_ids: ["e1"] } as never, evaluated));
    expect(auto.implementation_fingerprint).toBe(explicita.implementation_fingerprint);
    expect(auto.changed_files).toEqual(explicita.changed_files);
  });

  it("cura P2-5 rota automatica conserva arquivo incorporado quando exclusao historica colide", async () => {
    const { flowBase } = await fixtureAtribuicaoExterna();
    const expanded = { ...flowBase, changed_files: ["app.ts", "other.ts"] } as Flow;
    const result = await applyReviewScopeAttributions(expanded, expanded, []);
    expect(result.changed_files).toEqual(["app.ts", "other.ts"]);
  });

  it("cura C-06 citar o ID antigo produz erro acionavel nomeando o path ofensivo", async () => {
    const { flowBase } = await fixtureAtribuicaoExterna();
    const expanded = { ...flowBase, changed_files: ["app.ts", "other.ts"] } as Flow;
    await expect(applyReviewScopeAttributions(expanded, expanded, ["e1"]))
      .rejects.toThrow(/REVIEW_SCOPE_DECLARED_PATH[\s\S]*other\.ts/);
  });

  it("cura P3-9 hint so oferece ids adotaveis e orienta renovacao quando existe vencida", async () => {
    const { flowBase } = await fixtureAtribuicaoExterna({ mutarOther: true });
    const flow = { ...flowBase, changed_files: ["app.ts"] } as Flow;
    const mod = await import("../src/review-scope-attribution.js") as {
      collectAdoptableAttributionIds?: (flow: Flow) => Promise<string[]>;
    };
    expect(typeof mod.collectAdoptableAttributionIds).toBe("function");
    const adotaveis = await mod.collectAdoptableAttributionIds!(flow);
    expect(adotaveis).toEqual([]);
    const policy = await import("../src/verdict-fiscal-policy.js") as {
      attributionHint: (flow: Flow, cited?: string[], reusable?: string[]) => string | null;
    };
    const hintVencida = policy.attributionHint(flow, undefined, adotaveis);
    expect(hintVencida).not.toMatch(/cite scope_attribution_evidence_ids \(e1\)/);
    expect(hintVencida ?? "").toMatch(/renov|vencid|nova evidence/);
  });

  it("cura P1-1 caminho sem nenhuma attribution nao gera falso mismatch pos ampliacao", async () => {
    const { flowBase } = await fixtureAtribuicaoExterna();
    const flow = { ...flowBase, evidence: [], changed_files: ["app.ts"] } as Flow;
    const corroborated = { ...flowBase, evidence: [], changed_files: ["app.ts", "other.ts"] } as Flow;
    const evaluated = await applyReviewScopeAttributions(flow, corroborated, []);
    expect(evaluated.changed_files).toEqual(["app.ts", "other.ts"]);
    const gravado = await prepareVerdictSnapshot(flow, attributedVerdictSnapshot({ status: "pronto" } as never, evaluated));
    expect(gravado.changed_files).toEqual(["app.ts", "other.ts"]);
  });

  it("cura P3-9 hint com adotavel valida oferece exatamente ela", async () => {
    const { flowBase } = await fixtureAtribuicaoExterna();
    const flow = { ...flowBase, changed_files: ["app.ts"] } as Flow;
    const mod = await import("../src/review-scope-attribution.js") as {
      collectAdoptableAttributionIds: (flow: Flow) => Promise<string[]>;
    };
    const adotaveis = await mod.collectAdoptableAttributionIds!(flow);
    expect(adotaveis).toEqual(["e1"]);
    const policy = await import("../src/verdict-fiscal-policy.js") as {
      attributionHint: (flow: Flow, cited?: string[], reusable?: string[]) => string | null;
    };
    expect(policy.attributionHint(flow, undefined, adotaveis)).toMatch(/e1/);
    expect(policy.attributionHint(flow, ["e1"], adotaveis)).toBeNull();
  });
});
