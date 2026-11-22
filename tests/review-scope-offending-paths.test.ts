import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Evidence, Flow } from "../src/domain.js";
import {
  applyReviewScopeAttributions,
  bindReviewScopeAttribution,
} from "../src/review-scope-attribution.js";
import { declaredReviewPaths, fingerprintReviewedImplementation } from "../src/review-snapshot.js";
import { makeFlow } from "./helpers/policy-modules-fixture.js";
import { createPpirtvServer } from "../src/server.js";
import { FlowEngine } from "../src/flow-engine.js";
import { hasRequirement } from "../src/gate-resolution.js";
import { PpirtvStore } from "../src/store.js";

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
  return execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8", timeout: 30_000 });
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

async function withEr06Mcp(
  key: string,
  run: (fixture: {
    workspace: string; baseSha: string; plans: string; sptPath: string; objective: string;
    store: PpirtvStore; flowId: string;
    call: (name: string, args: Record<string, unknown>) => Promise<{ error?: boolean; value: any }>;
  }) => Promise<void>,
) {
    const { workspace, baseSha } = await workspaceGitComBase();
    const plans = path.join(workspace, ".agents", "PLAN-TASKS");
    await mkdir(plans, { recursive: true });
    const source = await readFile(".agents/PLAN-TASKS/2026-11-20-amaze-0092-er06.md", "utf8");
    const sptPath = path.join(plans, "fixture.md");
    await writeFile(sptPath, source.replace(/^workspace: .*$/m, `workspace: '${workspace.replaceAll("\\", "/")}'`));
    const objective = source.match(/^  objective: '(.+)'$/m)![1];
    const store = new PpirtvStore(path.join(workspace, ".ppirtv"));
    const server = createPpirtvServer({ storeRoot: path.join(workspace, ".ppirtv") });
    const [caller, handler] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: key, version: "1" });
    await server.connect(handler);
    await client.connect(caller);
    try {
      async function call(name: string, args: Record<string, unknown>) {
        const reply = await client.callTool({ name, arguments: args });
        const [item] = reply.content as Array<{ text: string }>;
        return { error: reply.isError, value: item.text.startsWith("{") ? JSON.parse(item.text) : item.text };
      }
      const started = await call("goal_start", {
        workspace, spt_path: sptPath, objective, idempotency_key: key,
        source: "test", evidence_required: true,
      });
      expect(started.error, JSON.stringify(started.value)).toBeFalsy();
      await run({ workspace, baseSha, plans, sptPath, objective, store, flowId: started.value.flow_id, call });
    } finally {
      await client.close();
      await server.close();
    }
}

describe("erros de escopo nomeiam os paths ofensivos (ISSUE-LOCAL-0003)", () => {
  it("ER06-A01 admite atomicamente, reabre, mantém retry e recusa conflitos sem escrita", async () => {
    await withEr06Mcp("ER06-A01", async ({ workspace, baseSha, plans, sptPath, objective, store, flowId, call }) => {
      const file = "src/app.ts";
      const sha256 = createHash("sha256").update(await readFile(path.join(workspace, file))).digest("hex");
      const proof = {
        task_id: "A-01", requirement_id: "REQ-01", criterion_id: "C-01", evidence_requirement_id: "ER-01",
        observed_value: 0, revision_set: [{ workspace, head: baseSha, paths: [{ path: file, sha256 }] }],
        environment: "fixture", producer: "executor", timestamp: new Date().toISOString(), limits: ["synthetic flow"],
      };
      const args = { flow_id: flowId, title: "historical proof", detail: "full", criterion_proof: proof };
      const historical = await call("evidence_add", args);
      expect(historical.error, JSON.stringify(historical.value)).toBeFalsy();
      const oldId = historical.value.evidence_id;
      const replacement = { ...args, title: "replacement proof", replaces_criterion_proof: { evidence_id: oldId, actor: "executor", reason: "corrected proof scope" } };
      const before = await store.loadFlow(flowId);
      const beforeBytes = await readFile(store.flowPath(flowId), "utf8");
      const beforeFiles = await readdir(store.evidenceDir);
      let copiedBeforeFailure = false;
      const save = vi.spyOn(PpirtvStore.prototype, "saveFlow").mockImplementationOnce(async (candidate) => {
        const copy = JSON.parse(await readFile(store.evidencePath(candidate.evidence.at(-1)!.evidence_id), "utf8"));
        copiedBeforeFailure = copy.flow_id === flowId && copy.title === replacement.title;
        throw new Error("ER06-A01 injected flow write failure");
      });
      try {
        const interrupted = await call("evidence_add", replacement);
        expect(interrupted.error).toBe(true);
        expect(JSON.stringify(interrupted.value)).toContain("ER06-A01 injected flow write failure");
      } finally {
        save.mockRestore();
      }
      expect(copiedBeforeFailure).toBe(true);
      expect(await readFile(store.flowPath(flowId), "utf8")).toBe(beforeBytes);
      expect(await readdir(store.evidenceDir)).toEqual(beforeFiles);
      expect(await store.loadFlow(flowId)).toEqual(before);

      const foreignPath = path.join(plans, "foreign.md");
      await writeFile(foreignPath, (await readFile(sptPath, "utf8"))
        .replace("amaze-0092-er06-2026-11-20", "er06-a01-foreign"));
      const foreign = await call("goal_start", {
        workspace, spt_path: foreignPath, objective, idempotency_key: "ER06-A01-foreign",
        source: "test", evidence_required: true,
      });
      expect(foreign.error, JSON.stringify(foreign.value)).toBeFalsy();
      const foreignId = foreign.value.flow_id;
      const foreignBefore = await readFile(store.flowPath(foreignId), "utf8");
      const foreignRefusal = await call("evidence_add", { ...replacement, flow_id: foreignId });
      expect(foreignRefusal.error).toBe(true);
      expect(JSON.stringify(foreignRefusal.value)).toContain("SPT_V3_PROOF_REPLACEMENT_INVALID");
      expect(await readFile(store.flowPath(foreignId), "utf8")).toBe(foreignBefore);
      expect(await readFile(store.flowPath(flowId), "utf8")).toBe(beforeBytes);
      expect(await readdir(store.evidenceDir)).toEqual(beforeFiles);

      const added = await call("evidence_add", replacement);
      expect(added.error, JSON.stringify(added.value)).toBeFalsy();
      const newId = added.value.evidence_id;
      expect(newId).not.toBe(oldId);
      const reopened = await store.loadFlow(flowId);
      expect(reopened.evidence.slice(0, -1)).toEqual(before.evidence);
      expect(reopened.evidence.at(-1)?.evidence_id).toBe(newId);
      expect(reopened.verdicts).toEqual(before.verdicts);
      const event = reopened.history.at(-1);
      expect(event).toMatchObject({
        type: "criterion_proof_superseded",
        at: reopened.evidence.at(-1)?.created_at,
        data: { ...replacement.replaces_criterion_proof, replacement_evidence_id: newId },
      });
      const snapshot = await readFile(store.flowPath(flowId), "utf8");
      const files = await readdir(store.evidenceDir);
      const retry = await call("evidence_add", replacement);
      expect(retry.value.evidence_id).toBe(newId);
      for (const invalid of [
        { ...replacement, title: "conflicting retry" },
        { ...replacement, replaces_criterion_proof: { ...replacement.replaces_criterion_proof, evidence_id: "unknown" } },
        { ...replacement, criterion_proof: { ...proof, observed_value: 1 }, replaces_criterion_proof: { ...replacement.replaces_criterion_proof, evidence_id: newId } },
        { ...replacement, criterion_proof: { ...proof, revision_set: [{ workspace, head: baseSha, paths: [{ path: file, sha256: "0".repeat(64) }] }] }, replaces_criterion_proof: { ...replacement.replaces_criterion_proof, evidence_id: newId } },
      ]) {
        const refused = await call("evidence_add", invalid);
        expect(refused.error, JSON.stringify(refused.value)).toBe(true);
        expect(await readFile(store.flowPath(flowId), "utf8")).toBe(snapshot);
        expect(await readdir(store.evidenceDir)).toEqual(files);
      }
    });
  });

  it("ER06-A02 MCP encadeia substituição, atribuição, veredito e reabertura", async () => {
    await withEr06Mcp("ER06-A02", async ({ workspace, baseSha, store, flowId, call }) => {
      async function ok(name: string, args: Record<string, unknown>) {
        const reply = await call(name, { flow_id: flowId, ...args });
        expect(reply.error, JSON.stringify(reply.value)).toBeFalsy();
        return reply.value;
      }
      const targets = ["src/app.ts", "src/gate.ts"];
      await Promise.all(targets.map((file) => writeFile(path.join(workspace, file), "target\n")));
      await ok("goal_advance", {});
      await ok("goal_advance", { provided: { implementation_done: true, changed_files: targets } });
      const historicalVerdict = await ok("goal_verdict", {
        status: "nao_pronto", rationale: "fixture before replacement", next_step: "reconcile proof",
      });
      const external = Array.from({ length: 38 }, (_, index) => `external-${index + 1}.txt`);
      await Promise.all(external.map((file) => writeFile(path.join(workspace, file), file)));
      async function proofPaths(paths: string[]) {
        return Promise.all(paths.map(async (file) => ({
          path: file,
          sha256: createHash("sha256").update(await readFile(path.join(workspace, file))).digest("hex"),
        })));
      }
      const proof = {
        task_id: "A-01", requirement_id: "REQ-01", criterion_id: "C-01", evidence_requirement_id: "ER-01",
        observed_value: 0, environment: "fixture", producer: "executor",
        timestamp: new Date().toISOString(), limits: ["synthetic flow"],
      };
      const old = await ok("evidence_add", {
        title: "historical ER-06 proof", detail: "full",
        criterion_proof: { ...proof, revision_set: [{ workspace, head: baseSha, paths: await proofPaths([...targets, ...external]) }] },
      });
      const overlap = await ok("evidence_add", {
        title: "independent overlap proof",
        declarative_proof: { task_id: "A-02", evidence_requirement_id: "ER-02", observed_value: 0, paths: [targets[1]] },
      });
      const attribution = (paths: string[]) => ({
        flow_id: flowId, kind: "review_scope_attribution", title: "Independent scope review", scope_classification: "outside", detail: "full",
        observed_result: {
          reviewer: "fixture reviewer",
          excluded_paths: paths.map((file) => ({ path: file, reason: "parallel work", source: "fixture Git workspace" })),
        },
      });
      const blockedBefore = await call("evidence_add", attribution(external));
      expect(blockedBefore.error).toBe(true);
      expect(JSON.stringify(blockedBefore.value)).toContain("REVIEW_SCOPE_DECLARED_PATH");
      const current = await ok("evidence_add", {
        title: "replacement ER-06 proof", detail: "full",
        replaces_criterion_proof: { evidence_id: old.evidence_id, reason: "correct proof scope", actor: "executor" },
        criterion_proof: { ...proof, revision_set: [{ workspace, head: baseSha, paths: await proofPaths([targets[0]]) }] },
      });
      const reopened = await store.loadFlow(flowId);
      expect(reopened.evidence.map((item) => item.evidence_id)).toEqual(expect.arrayContaining([old.evidence_id, current.evidence_id, ...overlap.evidence_ids]));
      expect(reopened.history).toContainEqual(expect.objectContaining({
        type: "criterion_proof_superseded",
        data: expect.objectContaining({ evidence_id: old.evidence_id, replacement_evidence_id: current.evidence_id }),
      }));
      for (const target of targets) {
        const protectedPath = await call("evidence_add", attribution([target]));
        expect(protectedPath.error).toBe(true);
        expect(JSON.stringify(protectedPath.value)).toContain("REVIEW_SCOPE_DECLARED_PATH");
      }
      const attached = await ok("evidence_add", attribution(external));
      expect(attached.evidence.observed_result.excluded_paths.map((item: { path: string }) => item.path)).toEqual(external);
      expect(attached.evidence.observed_result.attribution_binding.git_head_base).toBe(baseSha);
      expect(attached.evidence.observed_result.attribution_binding.fingerprint).toBe(await fingerprintDos(workspace, external));
      const verdictArgs = {
        flow_id: flowId, status: "pronto_com_ressalvas", rationale: "fixture after replacement", next_step: "verify fixture",
        scope_attribution_evidence_ids: [attached.evidence_id],
      };
      const beforeRefusal = await readFile(store.flowPath(flowId), "utf8");
      const refused = await call("goal_verdict", { ...verdictArgs, evidence_ids: [old.evidence_id] });
      expect(refused.error).toBe(true);
      expect(JSON.stringify(refused.value)).toContain("SPT_V3_EVIDENCE_SUPERSEDED");
      expect(await readFile(store.flowPath(flowId), "utf8")).toBe(beforeRefusal);
      const status = await ok("goal_status", { detail: "full" });
      const review = await ok("evidence_add", {
        kind: "code_review", title: "review of both targets", scope_classification: "target", scope_reference: targets[0],
        reviewed_implementation_fingerprint: status.implementation_fingerprint,
        satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
        observed_result: { diff_reviewed: true, barata_scan: true, reviewed_targets: targets, searched_patterns: ["target"], findings: [], regression_risks: [] },
      });
      const verdict = await ok("goal_verdict", {
        ...verdictArgs, evidence_ids: [current.evidence_id, ...overlap.evidence_ids, review.evidence_id],
      });
      expect(verdict.verdict.status).toBe("pronto_com_ressalvas");
      const final = await store.loadFlow(flowId);
      expect(final.changed_files.toSorted()).toEqual(targets);
      expect(final.verdicts.map((item) => item.verdict_id)).toEqual([historicalVerdict.verdict.verdict_id, verdict.verdict.verdict_id]);
      expect(final.evidence.find((item) => item.evidence_id === old.evidence_id)).toEqual(reopened.evidence.find((item) => item.evidence_id === old.evidence_id));
      expect(final.history.slice(0, reopened.history.length)).toEqual(reopened.history);
    });
  });

  it("ER06-A02 C-02 protege declarações e sobreposições e libera apenas os 38 externos atribuídos", async () => {
    const { workspace, baseSha } = await workspaceGitComBase();
    const externalPaths = Array.from({ length: 38 }, (_, index) => `external-${index + 1}.txt`);
    await Promise.all(externalPaths.map((file) => writeFile(path.join(workspace, file), file)));
    const gatePath = "src/gate.ts";
    const historical = {
      evidence_id: "er06-historical",
      flow_id: "flow_test",
      kind: "test_run",
      scope_classification: "target",
      scope_reference: "src/app.ts",
      satisfies: ["test_executed"],
      observed_result: { passed: 1, failed: 0, exit_code: 0 },
      criterion_proof: {
        evidence_requirement_id: "ER-06",
        revision_set: [{ paths: [...externalPaths, "src/app.ts", gatePath].map((file) => ({ path: file })) }],
      },
    };
    const replacement = {
      evidence_id: "er06-current",
      criterion_proof: {
        passed: true,
        evidence_requirement_id: "ER-06",
        revision_set: [{ paths: [{ path: "src/app.ts" }] }],
      },
    };
    await writeFile(path.join(workspace, gatePath), "gate");
    const corroborated = flowComBinding(workspace, baseSha, {
      changed_files: ["src/app.ts", gatePath, ...externalPaths],
    });
    const historicalFlow = flowComBinding(workspace, baseSha, {
      evidence: [historical, {
        evidence_id: "independent-current",
        criterion_proof: { passed: true, revision_set: [{ paths: [{ path: gatePath }] }] },
      }] as unknown as Evidence[],
      gates: { planejamento: { provided: { changed_files: ["src/app.ts"] } } } as Flow["gates"],
      history: [{ type: "flow_facts_updated", data: { changed_files: [gatePath] } }] as Flow["history"],
    });
    const attribution = {
      evidence_id: "external-attribution",
      flow_id: historicalFlow.flow_id,
      kind: "review_scope_attribution",
      scope_classification: "outside",
      observed_result: {
        reviewer: "independent reviewer",
        excluded_paths: externalPaths.map((file) => ({ path: file, reason: "external work", source: "git status" })),
        attribution_binding: { version: 1, git_head_base: baseSha, fingerprint: await fingerprintDos(workspace, externalPaths) },
      },
    } as Evidence;
    const evidence = [...historicalFlow.evidence, attribution];
    const selected = [attribution.evidence_id];
    await expect(applyReviewScopeAttributions({ ...historicalFlow, evidence }, corroborated, selected))
      .rejects.toThrow("REVIEW_SCOPE_DECLARED_PATH");

    const bothProofs = [...evidence, replacement as unknown as Evidence];
    await expect(applyReviewScopeAttributions({ ...historicalFlow, evidence: bothProofs }, corroborated, selected))
      .rejects.toThrow("REVIEW_SCOPE_DECLARED_PATH");

    const control = { ...historicalFlow, evidence: bothProofs.slice(1) };
    const controlResult = await applyReviewScopeAttributions(control, corroborated, selected);
    expect(controlResult.changed_files).toEqual(["src/app.ts", gatePath]);
    expect(declaredReviewPaths(control).has(gatePath)).toBe(true);
    expect(declaredReviewPaths(control).has("src/app.ts")).toBe(true);

    const supersession = {
      type: "criterion_proof_superseded",
      data: { evidence_id: historical.evidence_id, replacement_evidence_id: replacement.evidence_id },
    } as unknown as Flow["history"][number];
    const superseded = { ...historicalFlow, evidence: bothProofs, history: [...historicalFlow.history, supersession] };
    const before = structuredClone(superseded);
    const testGate = { key: "test_executed", label: "test", source: "provided", kind: "boolean" } as const;
    expect(hasRequirement(historicalFlow, testGate, {})).toBe(true);
    expect(hasRequirement(superseded, testGate, {})).toBe(false);
    const result = await applyReviewScopeAttributions(superseded, corroborated, selected);
    expect(result.changed_files).toEqual(controlResult.changed_files);
    expect(declaredReviewPaths(superseded)).toEqual(declaredReviewPaths(control));
    expect(superseded).toEqual(before);
    expect(superseded.evidence.map((item) => item.evidence_id)).toContain(historical.evidence_id);
  });

  it("ER06-A02 C-03 recusa novo veredito com prova substituída e reabre o histórico", async () => {
    const { workspace, baseSha } = await workspaceGitComBase();
    const older = {
      evidence_id: "er06-prior",
      criterion_proof: { passed: true, revision_set: [] },
    } as Evidence;
    const newer = { ...older, evidence_id: "er06-replacement" };
    const flow = flowComBinding(workspace, baseSha, {
      evidence: [older, newer],
      history: [{
        at: "2026-11-20T00:00:00.000Z",
        type: "criterion_proof_superseded",
        data: { evidence_id: older.evidence_id, replacement_evidence_id: newer.evidence_id },
      }],
      verdicts: [{ verdict_id: "historical", evidence_ids: [older.evidence_id] }] as Flow["verdicts"],
    });
    const store = new PpirtvStore(path.join(workspace, ".ppirtv"));
    await store.saveFlow(flow);
    const before = await readFile(store.flowPath(flow.flow_id), "utf8");
    const historical = await store.loadFlow(flow.flow_id);
    await expect(new FlowEngine(store).goalVerdict({
      flow_id: flow.flow_id, status: "pronto_com_ressalvas", rationale: "fixture",
      next_step: "fixture", evidence_ids: [older.evidence_id],
    })).rejects.toThrow("SPT_V3_EVIDENCE_SUPERSEDED");
    expect(await readFile(store.flowPath(flow.flow_id), "utf8")).toBe(before);
    const reopened = await store.loadFlow(flow.flow_id);
    expect(reopened.evidence).toEqual(historical.evidence);
    expect(reopened.history).toEqual(historical.history);
    expect(reopened.verdicts).toEqual(historical.verdicts);
  });

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
      } satisfies Pick<Evidence, "kind" | "scope_classification" | "observed_result">)
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
