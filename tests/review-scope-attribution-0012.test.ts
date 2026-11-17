import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import { applyReviewScopeAttributions } from "../src/review-scope-attribution.js";
import { restoreBlockedVerdictSnapshot } from "../src/review-snapshot.js";
import { fingerprintReviewedImplementation } from "../src/review-snapshot.js";
import { makeFlow } from "./helpers/policy-modules-fixture.js";

// ISSUE-LOCAL-0012 (2026-11-17): (a) goal_verdict SEM scope_attribution_
// evidence_ids re-executava applyReviewScopeAttributions com lista vazia e
// IGNORAVA attribution aprovada com binding válido — corroborated voltava ao
// git inteiro e o fiscal rejeitava SEM nomear o campo faltante; (b) verdict
// rejeitado persistia changed_files restaurado + fingerprint do conjunto
// corroborado (híbrido) bloqueando evidence_add com FINGERPRINT_MISMATCH.
// RED-first: its das 3 curas reprovam hoje (dynamic import para vermelho
// limpo por it até as funções novas existirem). NUNCA podar.
let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-attribution-0012-"));
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function git(workspace: string, args: string[]) {
  return execFileSync("git", ["-C", workspace, ...args], { encoding: "utf-8", timeout: 30_000 });
}

async function workspaceGitComBase(): Promise<{ workspace: string; baseSha: string }> {
  const workspace = path.join(tempRoot, "repo");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "app.ts"), "export const base = true;\n", "utf8");
  git(workspace, ["init", "-q"]);
  git(workspace, ["config", "user.email", "test@example.com"]);
  git(workspace, ["config", "user.name", "test"]);
  git(workspace, ["add", "src/app.ts"]);
  git(workspace, ["commit", "-q", "-m", "base"]);
  return { workspace, baseSha: git(workspace, ["rev-parse", "HEAD"]).trim() };
}

function flowComBinding(workspace: string, baseSha: string, overrides: Partial<Flow> = {}): Flow {
  return makeFlow({
    goal_binding: {
      envelope: { workspace, idempotency_key: "attribution-0012-261117", source: "test" },
      spt_path: ".agents/PLAN-TASKS/x.md",
      objective: "curar 0012",
      ...overrides.goal_binding,
    } as Flow["goal_binding"],
    git_head_base: baseSha,
    changed_files: ["src/app.ts"],
    ...overrides,
  });
}

async function fingerprintDos(workspace: string, paths: string[]): Promise<string> {
  return fingerprintReviewedImplementation(workspace, paths, process.platform, {
    requireReviewableFiles: true,
    allowedMissingFiles: [],
  });
}

async function flowComAttributionValida(): Promise<{ flow: Flow; corroborated: Flow; workspace: string; baseSha: string; externos: string[] }> {
  const { workspace, baseSha } = await workspaceGitComBase();
  const externos = ["janela-irma/a.txt", "janela-irma/b.txt"];
  for (const rel of externos) {
    await mkdir(path.join(workspace, path.dirname(rel)), { recursive: true });
    await writeFile(path.join(workspace, rel), "conteudo alheio\n", "utf8");
  }
  const flow = flowComBinding(workspace, baseSha, {
    evidence: [{
      evidence_id: "evd_attr_aprovada", flow_id: "flow_test", kind: "review_scope_attribution",
      scope_classification: "outside", scope_reference: "src/app.ts", created_at: "2026-11-17T00:00:00.000Z",
      title: "attribution aprovada", parking_lot: [], gold_mining: [], cooperators: [], active_credits: [],
      observed_result: {
        reviewer: "janela-irma",
        excluded_paths: externos.map((p) => ({ path: p, reason: "terceiro", source: "git status" })),
        attribution_binding: { version: 1, git_head_base: baseSha, fingerprint: await fingerprintDos(workspace, externos) },
      },
    } as Flow["evidence"][number]],
  });
  const corroborated = flowComBinding(workspace, baseSha, {
    changed_files: ["src/app.ts", ...externos],
  });
  return { flow, corroborated, workspace, baseSha, externos };
}

describe("ISSUE-LOCAL-0012 — verdict reutiliza attribution aprovada e restaura atomicamente", () => {
  it("cura a1 chamada SEM ids com attribution aprovada válida NÃO re-traz alheios", async () => {
    const { flow, corroborated, externos } = await flowComAttributionValida();
    const result = await applyReviewScopeAttributions(flow, corroborated, []);
    for (const externo of externos) {
      expect(result.changed_files).not.toContain(externo);
    }
    expect(result.changed_files).toContain("src/app.ts");
  });

  it("caracterização a1 sem attribution válida a lista vazia mantém corroborated", async () => {
    const { workspace, baseSha } = await workspaceGitComBase();
    const flow = flowComBinding(workspace, baseSha);
    const corroborated = flowComBinding(workspace, baseSha, {
      changed_files: ["src/app.ts", "outro/arquivo.txt"],
    });
    const result = await applyReviewScopeAttributions(flow, corroborated, []);
    expect(result.changed_files).toEqual(["src/app.ts", "outro/arquivo.txt"]);
  });

  it("cura a2 hint do fiscal nomeia scope_attribution_evidence_ids quando existe attribution não citada", async () => {
    const { flow } = await flowComAttributionValida();
    const mod = await import("../src/verdict-fiscal-policy.js") as { attributionHint?: (flow: Flow, cited: string[] | undefined) => string | null };
    expect(typeof mod.attributionHint).toBe("function");
    const hintNaoCitada = mod.attributionHint!(flow, undefined);
    expect(hintNaoCitada).toMatch(/scope_attribution_evidence_ids/);
    expect(hintNaoCitada).toMatch(/evd_attr_aprovada/);
    expect(mod.attributionHint!(flow, ["evd_attr_aprovada"])).toBeNull();
    expect(mod.attributionHint!(flowComBinding(flow.goal_binding!.envelope.workspace, flow.git_head_base!), undefined)).toBeNull();
  });

  it("cura b restauro com fingerprint do MESMO conjunto sem híbrido FINGERPRINT_MISMATCH", async () => {
    const { workspace, baseSha } = await workspaceGitComBase();
    const restaurado = ["src/app.ts"];
    const alheio = "janela-irma/c.txt";
    await mkdir(path.join(workspace, "janela-irma"), { recursive: true });
    await writeFile(path.join(workspace, alheio), "alheio\n", "utf8");
    const persisted = flowComBinding(workspace, baseSha, {
      changed_files: restaurado,
      gates: {
        implementacao: { status: "passed", checked_at: "2026-11-17T10:00:00.000Z", changed_files_snapshot: restaurado } as never,
      },
    });
    const corroborated = flowComBinding(workspace, baseSha, {
      changed_files: [...restaurado, alheio],
    });
    const mod = await import("../src/review-snapshot.js") as { withRestoredBlockedVerdictSnapshot?: (persisted: Flow, corroborated: Flow) => Promise<Flow> };
    expect(typeof mod.withRestoredBlockedVerdictSnapshot).toBe("function");
    const restored = await mod.withRestoredBlockedVerdictSnapshot!(persisted, corroborated);
    expect(restored.changed_files).toEqual(restaurado);
    const esperado = await fingerprintReviewedImplementation(workspace, restaurado, process.platform, {
      requireReviewableFiles: true, allowedMissingFiles: [],
    });
    expect(restored.implementation_fingerprint).toBe(esperado);
  });

  it("caracterização b restoreBlockedVerdictSnapshot puro mantém contrato do último gate aprovado", async () => {
    const { workspace, baseSha } = await workspaceGitComBase();
    const snapshot = ["src/app.ts"];
    const persisted = flowComBinding(workspace, baseSha, {
      changed_files: snapshot,
      gates: {
        implementacao: { status: "passed", checked_at: "2026-11-17T10:00:00.000Z", changed_files_snapshot: snapshot } as never,
      },
    });
    const corroborated = flowComBinding(workspace, baseSha, {
      changed_files: [...snapshot, "janela-irma/x.txt"],
    });
    const restoration = restoreBlockedVerdictSnapshot(persisted, corroborated);
    expect(restoration.changed_files).toEqual(snapshot);
    expect(restoration.pending_additions).toEqual(["janela-irma/x.txt"]);
  });
});
