import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Flow } from "../src/domain.js";
import {
  declaredReviewPaths,
  fingerprintReviewedImplementation,
  freezeGitHeadBase,
  gitHeadAt,
  isSensitiveWorkspacePath,
  normalizeReviewPath,
  pendingReviewAdditionsFor,
  restoreBlockedVerdictSnapshot,
} from "../src/review-snapshot.js";

// Rede D-48 (corte review-snapshot): its de caracterização para lacunas (b)
// provadas por mutação repo-wide. Cada it amarra o mutante correspondente
// (vigílias M1b/M4/M5/M6/M7/M8/M9b/M10b/M11b/M13 em MUTACOES/).

let tempRoot = "";

function git(workspace: string, args: string[]) {
  return execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
}

async function gitWorkspace(prefix: string): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const workspace = path.join(tempRoot, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "seed.txt"), "seed\n", "utf8");
  git(workspace, ["init"]);
  git(workspace, ["config", "user.email", "fixture@example.com"]);
  git(workspace, ["config", "user.name", "Fixture"]);
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-m", "base"]);
  return workspace;
}

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

function flowLike(partial: Record<string, unknown>): Flow {
  return partial as unknown as Flow;
}

describe("rede D-48 review-snapshot", () => {
  it("freezeGitHeadBase e idempotente em reuse: base original permanece apos novo commit (R14)", async () => {
    const workspace = await gitWorkspace("d48-freeze-");
    const baseHead = git(workspace, ["rev-parse", "HEAD"]).trim();
    const flow = flowLike({});
    await freezeGitHeadBase(flow, workspace);
    expect(flow.git_head_base).toBe(baseHead);
    await writeFile(path.join(workspace, "novo.txt"), "novo\n", "utf8");
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-m", "segundo"]);
    const novoHead = git(workspace, ["rev-parse", "HEAD"]).trim();
    expect(novoHead).not.toBe(baseHead);
    await freezeGitHeadBase(flow, workspace);
    expect(flow.git_head_base).toBe(baseHead);
  });

  it("declaredReviewPaths expoe as 3 fontes: gates.provided, criterion_proof.revision_set e history (flow_facts_updated + gate_checked)", () => {
    const flow = flowLike({
      gates: {
        planejamento: { provided: { changed_files: ["src/gate.ts"] } }
      },
      evidence: [
        {
          criterion_proof: {
            revision_set: [{ paths: [{ path: "src/proof.ts" }] }]
          }
        }
      ],
      history: [
        { type: "flow_facts_updated", data: { changed_files: ["src/facts.ts"] } },
        { type: "gate_checked", data: { provided: { changed_files: ["src/checked.ts"] } } }
      ]
    });
    const declared = declaredReviewPaths(flow);
    expect(declared.has("src/gate.ts")).toBe(true);
    expect(declared.has("src/proof.ts")).toBe(true);
    expect(declared.has("src/facts.ts")).toBe(true);
    expect(declared.has("src/checked.ts")).toBe(true);
    expect(declared.size).toBe(4);
  });

  it("isSensitiveWorkspacePath vigia nomes de credenciais e irmãos (regex basename)", () => {
    expect(isSensitiveWorkspacePath("config/secrets.json")).toBe(true);
    expect(isSensitiveWorkspacePath("credentials.toml")).toBe(true);
    expect(isSensitiveWorkspacePath("pkg/tokens.yaml")).toBe(true);
    expect(isSensitiveWorkspacePath("cookies.db")).toBe(true);
    expect(isSensitiveWorkspacePath("authorization.ini")).toBe(true);
    expect(isSensitiveWorkspacePath(".npmrc")).toBe(true);
    expect(isSensitiveWorkspacePath(".codex/config.toml")).toBe(true);
    expect(isSensitiveWorkspacePath(".git/config")).toBe(true);
    expect(isSensitiveWorkspacePath("secrets.json.example")).toBe(false);
    expect(isSensitiveWorkspacePath("tokens.ts")).toBe(false);
  });

  it("restoreBlockedVerdictSnapshot devolve restored_from no formato phase@checked_at do gate aprovado MAIS RECENTE", () => {
    const persisted = flowLike({
      gates: {
        antigo: { phase: "antigo", status: "passed", checked_at: "2026-11-13T10:00:00Z", changed_files_snapshot: ["a.ts"] },
        recente: { phase: "recente", status: "passed", checked_at: "2026-11-13T12:00:00Z", changed_files_snapshot: ["a.ts", "b.ts"] }
      },
      deleted_files: ["gone.ts"]
    });
    const corroborated = flowLike({ changed_files: ["a.ts", "b.ts", "c.ts"], deleted_files: [] });
    const restoration = restoreBlockedVerdictSnapshot(persisted, corroborated);
    expect(restoration.restored_from).toBe("recente@2026-11-13T12:00:00Z");
    expect(restoration.changed_files).toEqual(["a.ts", "b.ts"]);
    expect(restoration.pending_additions).toEqual(["c.ts"]);
    expect(restoration.deleted_files).toEqual(["gone.ts"]);
  });

  it("restoreBlockedVerdictSnapshot sem gate aprovado mantem o corroborado com pendentes VAZIOS e restored_from nulo", () => {
    const persisted = flowLike({ gates: { planejamento: { status: "failed", checked_at: "2026-11-13T10:00:00Z" } }, deleted_files: [] });
    const corroborated = flowLike({ changed_files: ["x.ts"], deleted_files: [] });
    const restoration = restoreBlockedVerdictSnapshot(persisted, corroborated);
    expect(restoration.restored_from).toBeNull();
    expect(restoration.changed_files).toEqual(["x.ts"]);
    expect(restoration.pending_additions).toEqual([]);
  });

  it("pendingReviewAdditionsFor: full expoes additions, lean nao, verdict posterior anula e sem evento devolve null", () => {
    const blockedEvent = { type: "fiscal_policy_blocked", data: { pending_review_additions: ["p.md", "q.md"], restored_changed_files_from: "execucao@2026-11-13T10:00:00Z" } };
    const flow = flowLike({ history: [blockedEvent] });
    const full = pendingReviewAdditionsFor(flow, "full");
    expect(full?.count).toBe(2);
    expect(full?.additions).toEqual(["p.md", "q.md"]);
    expect(full?.restored_from).toBe("execucao@2026-11-13T10:00:00Z");
    const lean = pendingReviewAdditionsFor(flow, "lean");
    expect(lean?.count).toBe(2);
    expect(lean?.additions).toBeUndefined();
    const flowComVerdict = flowLike({ history: [blockedEvent, { type: "verdict_recorded", data: {} }] });
    expect(pendingReviewAdditionsFor(flowComVerdict, "full")).toBeNull();
    expect(pendingReviewAdditionsFor(flowLike({ history: [] }), "full")).toBeNull();
    const semAdditions = flowLike({ history: [{ type: "fiscal_policy_blocked", data: { pending_review_additions: [] } }] });
    expect(pendingReviewAdditionsFor(semAdditions, "full")).toBeNull();
  });

  it("fingerprintReviewedImplementation redige sensivel alcancado por realpath (rota resolved) quando o RESOLVED esta declarado", async () => {
    const workspace = await gitWorkspace("d48-resolved-");
    await writeFile(path.join(workspace, ".env"), "TOKEN=1\n", "utf8");
    await symlink(".env", path.join(workspace, "alias.cfg"));
    await expect(
      fingerprintReviewedImplementation(workspace, ["alias.cfg"], "linux", {})
    ).rejects.toThrow("REVIEW_SNAPSHOT_SENSITIVE_PATH");
    const fingerprint = await fingerprintReviewedImplementation(workspace, ["alias.cfg"], "linux", {
      redactedSensitivePaths: [".env"]
    });
    expect(fingerprint).toMatch(/^sha256:/);
  });

  it("gitHeadAt devolve o head exato do workspace (identidade com rev-parse)", async () => {
    const workspace = await gitWorkspace("d48-head-");
    const head = git(workspace, ["rev-parse", "HEAD"]).trim();
    expect(await gitHeadAt(workspace)).toBe(head);
  });

  it.skipIf(process.platform !== "win32")("normalizeReviewPath usa process.platform: no win32 dobra casing para comparacao", () => {
    expect(normalizeReviewPath("SRC\\Flow.TS")).toBe("src/flow.ts");
  });
});
