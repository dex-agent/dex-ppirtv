import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import {
  applyReviewScopeAttributions,
  bindReviewScopeAttribution,
} from "../src/review-scope-attribution.js";
import { fingerprintReviewedImplementation } from "../src/review-snapshot.js";
import { makeFlow } from "./helpers/policy-modules-fixture.js";

// ISSUE-LOCAL-0003 (2026-11-09): UNATTRIBUTED/UNDISCOVERED usavam some() que
// achava o path culpado e o jogava fora — fechar verdict no repo compartilhado
// exigia probe externo (4 rodadas no flow 136). RED-first do corte
// diagnostico-que-ensina: os dois erros NOMEIAM os paths ofensivos (molde da
// irmã STALE, que já nomeia o evidence_id na mensagem).
let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-offending-paths-"));
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function git(workspace: string, args: string[]) {
  return execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
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
      envelope: { workspace, idempotency_key: "offending-paths-261109", source: "test" },
      spt_path: ".agents/PLAN-TASKS/x.md",
      objective: "provar offending paths",
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

describe("erros de escopo nomeiam os paths ofensivos (ISSUE-LOCAL-0003)", () => {
  it("REVIEW_SCOPE_UNATTRIBUTED_PATH nomeia os paths sem destino (antes: some() engolia)", async () => {
    const { workspace, baseSha } = await workspaceGitComBase();
    // janela irmã: 2 arquivos untracked legítimos de terceiro no disco
    await mkdir(path.join(workspace, "janela-irma"), { recursive: true });
    await writeFile(path.join(workspace, "janela-irma", "a.txt"), "a\n", "utf8");
    await writeFile(path.join(workspace, "janela-irma", "b.txt"), "b\n", "utf8");
    const externos = ["janela-irma/a.txt", "janela-irma/b.txt"];

    const flow = flowComBinding(workspace, baseSha, {
      evidence: [{
        evidence_id: "evd_externa_1", flow_id: "flow_test", kind: "review_scope_attribution",
        scope_classification: "outside", scope_reference: "src/app.ts", created_at: "2026-11-09T00:00:00.000Z",
        title: "attribution externa", parking_lot: [], gold_mining: [], cooperators: [], active_credits: [],
        observed_result: {
          reviewer: "janela-irma",
          excluded_paths: externos.map((p) => ({ path: p, reason: "terceiro", source: "git status" })),
          attribution_binding: { version: 1, git_head_base: baseSha, fingerprint: await fingerprintDos(workspace, externos) },
        },
      } as Flow["evidence"][number]],
    });
    // corroborated conhece os externos (worktree compartilhado) e o legítimo
    const corroborated = flowComBinding(workspace, baseSha, {
      changed_files: ["src/app.ts", "janela-irma/c.txt", "janela-irma/d.txt"],
    });

    // C-04 (RED no baseline): os 2 paths sem destino aparecem NA MENSAGEM
    await expect(
      applyReviewScopeAttributions(flow, corroborated, ["evd_externa_1"])
    ).rejects.toThrow(/janela-irma\/c\.txt.*janela-irma\/d\.txt|janela-irma\/d\.txt.*janela-irma\/c\.txt/s);
  });

  it("REVIEW_SCOPE_UNDISCOVERED_PATH nomeia as exclusões fora da corroboração do Git", async () => {
    const { workspace, baseSha } = await workspaceGitComBase();
    const flow = flowComBinding(workspace, baseSha);

    await expect(
      bindReviewScopeAttribution(flow, {
        kind: "review_scope_attribution",
        scope_classification: "outside",
        observed_result: {
          reviewer: "irma",
          excluded_paths: [
            { path: "fora/x.txt", reason: "terceiro", source: "git status" },
            { path: "fora/y.txt", reason: "terceiro", source: "git status" },
          ],
        },
      } as never)
    ).rejects.toThrow(/fora\/x\.txt.*fora\/y\.txt|fora\/y\.txt.*fora\/x\.txt/s);
  });

  it("truncagem: 12 paths ofensivos viram 10 nomeados + contador do total", async () => {
    const { workspace, baseSha } = await workspaceGitComBase();
    await mkdir(path.join(workspace, "muitos"), { recursive: true });
    const externos: string[] = [];
    for (let i = 1; i <= 12; i += 1) {
      const rel = `muitos/e${String(i).padStart(2, "0")}.txt`;
      await writeFile(path.join(workspace, rel), `${i}\n`, "utf8");
      externos.push(rel);
    }
    const semDestino = externos.map((p) => p.replace("muitos/", "muitos-out/"));

    const flow = flowComBinding(workspace, baseSha, {
      evidence: [{
        evidence_id: "evd_externa_2", flow_id: "flow_test", kind: "review_scope_attribution",
        scope_classification: "outside", scope_reference: "src/app.ts", created_at: "2026-11-09T00:00:00.000Z",
        title: "attribution externa", parking_lot: [], gold_mining: [], cooperators: [], active_credits: [],
        observed_result: {
          reviewer: "janela-irma",
          excluded_paths: externos.map((p) => ({ path: p, reason: "terceiro", source: "git status" })),
          attribution_binding: { version: 1, git_head_base: baseSha, fingerprint: await fingerprintDos(workspace, externos) },
        },
      } as Flow["evidence"][number]],
    });
    const corroborated = flowComBinding(workspace, baseSha, {
      changed_files: ["src/app.ts", ...semDestino],
    });

    await expect(
      applyReviewScopeAttributions(flow, corroborated, ["evd_externa_2"])
    ).rejects.toThrow(/offending_paths:.*\(\+2 more\)/s);
  });
});
