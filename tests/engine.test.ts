import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { promptText } from "../src/catalogs.js";
import { validateMemoryPostWrite, type MemoryGraphProvider, MemoryLibrarian, type MemoryHookRunner } from "../src/memory/index.js";
import { AUTO_WRITE_REVIEW_MARKER, AUTO_WRITE_REVIEW_TAGS, memoryAnchor } from "../src/memory/mining-policy.js";
import { loadOperationalContractSync } from "../src/principles.js";
import { PpirtvStore } from "../src/store.js";
import { exportRedactedDiagnosticBundle } from "../src/diagnostic-bundle.js";
import type { Flow, LedgerEvent } from "../src/domain.js";
import { fingerprintReviewedImplementation } from "../src/review-snapshot.js";

let tempRoot: string;
let engine: FlowEngine;
let originalTestEnv: Record<string, string | undefined>;

const TEST_ENV_KEYS = [
  "PPIRTV_GRAPHIFY_RECALL",
  "PPIRTV_GRAPHIFY_COMMAND",
  "PPIRTV_GRAPHIFY_GRAPH_PATH",
  "PPIRTV_GRAPHIFY_TIMEOUT_MS",
  "PPIRTV_GRAPHIFY_BUDGET",
  "PPIRTV_PRINCIPLES_PATH",
  "DEX_MEMORIA_HOME",
  "USERPROFILE"
] as const;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-engine-"));
  originalTestEnv = snapshotEnv(TEST_ENV_KEYS);
  for (const key of TEST_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.USERPROFILE = path.join(tempRoot, "home-without-shared-principles");
  engine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
});

afterEach(async () => {
  restoreEnvSnapshot(originalTestEnv);
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("PPIRTV flow engine", () => {
  it("creates a flow and persists it across engine restart", async () => {
    const flow = await engine.createFlow({
      goal: "Implementar harness MCP",
      context: "Repo documental existente",
      risks: ["estado implicito"],
      uncertainties: ["cliente alvo"]
    });

    const restarted = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const status = await restarted.status(flow.flow_id);
    const ledger = await restarted.store.readLedger(flow.flow_id);

    expect(status.flow_id).toBe(flow.flow_id);
    expect(status.phase).toBe("pensamentos");
    expect(ledger.some((event) => event.type === "flow_created")).toBe(true);
  });

  it("blocks advance when the current gate is incomplete", async () => {
    const flow = await engine.createFlow({ goal: "Sem contexto ainda" });
    const result = await engine.advance({ flow_id: flow.flow_id });

    expect(result.advanced).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.missing).toEqual(["context", "risks", "uncertainties"]);
    expect(result.back_to).toBeNull();
    expect(result.aliases?.faltando).toEqual(result.missing);
    expect(result.aliases?.proximo).toBe(result.next);
    expect(result.aliases?.voltar_para).toBe(result.back_to);
    expect(result.display?.phase_emoji).toBe("🧠");
    expect(result.display?.active_credits).toEqual([]);
    expect(result.suggested_cooperation?.every((item) => item.material === false)).toBe(true);
  });

  it("advances when gate data is supplied and records a return", async () => {
    const flow = await engine.createFlow({ goal: "Avancar fase" });
    const advanced = await engine.advance({
      flow_id: flow.flow_id,
      provided: {
        context: "contexto conhecido",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      }
    });

    expect(advanced).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });

    const returned = await engine.returnTo({
      flow_id: flow.flow_id,
      to: "pensamentos",
      reason: "criterio de pronto ficou ambiguo"
    });
    const ledger = await engine.store.readLedger(flow.flow_id);

    expect(returned.phase).toBe("pensamentos");
    expect(ledger.some((event) => event.type === "phase_returned")).toBe(true);
  });

  it("recalls curated memory before a phase and records runtime recall", async () => {
    const workspace = path.join(tempRoot, "workspace");
    await mkdir(path.join(workspace, ".agents"), { recursive: true });
    await writeFile(path.join(workspace, ".agents", "LEMBRANCA.md"), "- [PPIRTV-RECALL] PPIRTV advance lembra contexto antes da fase.\n", "utf8");
    await writeFile(path.join(workspace, ".agents", "MEMORIA.md"), "## PPIRTV advance\n\nUse recall antes de entrar na fase.\n", "utf8");
    const flow = await engine.createFlow({ goal: "PPIRTV advance recall" });
    flow.goal_binding = {
      envelope: {
        workspace,
        spt_path: path.join(workspace, "trail.md"),
        objective: flow.goal,
        idempotency_key: "memory-before-phase",
        evidence_required: true,
        required_evidence: [],
        requested_verdict_policy: "evidence_required",
        source: "test"
      },
      started_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
    const librarian = new MemoryLibrarian(tempRoot);

    const recalled = await librarian.beforePhase({ flow, phase: "planejamento" });
    const recallRuntime = await readFile(path.join(tempRoot, "memory", "recalls.jsonl"), "utf8");

    expect(recalled.items.some((item) => item.source === "curated_l1")).toBe(true);
    expect(recallRuntime).toContain("PPIRTV advance");
  });

  it("recalls graphify hints before a phase with a graph provider", async () => {
    const flow = await engine.createFlow({ goal: "Graphify beforePhase recall", context: "Bibliotecario com grafo" });
    const provider: MemoryGraphProvider = {
      recall: async (input) => ({
        flow_id: input.flow_id,
        phase: input.phase,
        queried_at: new Date().toISOString(),
        warnings: [],
        items: [
          graphHit(input.question, "MemoryLibrarian", "src/memory/memory-hooks.ts", 20),
          graphHit(input.question, "beforePhase()", "src/memory/memory-recall.ts", 19),
          { ...graphHit(input.question, "memory_recalled", "src/flow-engine.ts", 18), observation: "Authorization: Bearer abcdefghijklmnop" },
          graphHit(input.question, "extra node", "src/extra.ts", 17)
        ]
      })
    };
    const librarian = new MemoryLibrarian(tempRoot, { graphProvider: provider });

    const recalled = await librarian.beforePhase({ flow, phase: "planejamento" });
    const graphItems = recalled.items.filter((item) => item.source === "graphify");
    const recallRuntime = await readFile(path.join(tempRoot, "memory", "recalls.jsonl"), "utf8");

    expect(graphItems).toHaveLength(3);
    expect(graphItems[0]).toMatchObject({
      source: "graphify",
      question: expect.stringContaining("Graphify beforePhase recall"),
      destination: "recall_hint",
      observation: "Graphify node at L1"
    });
    expect(recalled.warnings).toContain("graphify_recalled: 3");
    expect(recallRuntime).toContain("\"source\":\"graphify\"");
    expect(recallRuntime).toContain("[redacted]");
    expect(recallRuntime).not.toContain("abcdefghijklmnop");
    expect(recallRuntime).not.toContain("extra node");
  });

  it("records afterPhase candidates and parking in runtime memory", async () => {
    const flow = await engine.createFlow({ goal: "Preparar garimpo" });
    flow.gold_mining = ["Regra PPIRTV: validar contrato antes do veredito."];
    flow.parking_lot = ["Avaliar depois uma UI para estacionamento."];
    const librarian = new MemoryLibrarian(tempRoot);

    const recorded = await librarian.afterPhase({ flow, phase: "pensamentos", meetings: [] });
    const candidates = await readFile(path.join(tempRoot, "memory", "candidates.jsonl"), "utf8");
    const parking = await readFile(path.join(tempRoot, "memory", "parking-lot.jsonl"), "utf8");

    expect(recorded.candidates_count).toBeGreaterThan(0);
    expect(candidates).toContain("Regra PPIRTV");
    expect(parking).toContain("Avaliar depois");
  });

  it("deduplicates repeated afterPhase candidates and parking for the same flow content", async () => {
    const flow = await engine.createFlow({ goal: "Lean audit garimpo" });
    flow.gold_mining = ["Regra PPIRTV: validar contrato antes do veredito."];
    flow.parking_lot = ["Avaliar depois uma UI para estacionamento."];
    const librarian = new MemoryLibrarian(tempRoot);

    await librarian.afterPhase({ flow, phase: "pensamentos", meetings: [] });
    await librarian.afterPhase({ flow, phase: "planejamento", meetings: [] });
    const candidates = await readJsonl(path.join(tempRoot, "memory", "candidates.jsonl"));
    const parking = await readJsonl(path.join(tempRoot, "memory", "parking-lot.jsonl"));

    expect(candidates.filter((record) => record.flow_id === flow.flow_id)).toHaveLength(2);
    expect(parking.filter((record) => record.flow_id === flow.flow_id)).toHaveLength(1);
  });

  it("deduplicates repeated beforePhase recall records by content signature", async () => {
    const workspace = path.join(tempRoot, "workspace");
    await mkdir(path.join(workspace, ".agents"), { recursive: true });
    await writeFile(path.join(workspace, ".agents", "LEMBRANCA.md"), "- PPIRTV advance: consultar contrato antes de seguir\n", "utf8");
    const flow = await engine.createFlow({ goal: "PPIRTV advance", context: "contrato antes de seguir" });
    flow.goal_binding = {
      envelope: {
        workspace,
        spt_path: path.join(workspace, "trail.md"),
        objective: flow.goal,
        idempotency_key: "memory-before-phase-dedupe",
        evidence_required: true,
        required_evidence: [],
        requested_verdict_policy: "evidence_required",
        source: "test"
      },
      started_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
    const librarian = new MemoryLibrarian(tempRoot);

    const first = await librarian.beforePhase({ flow, phase: "planejamento" });
    const second = await librarian.beforePhase({ flow, phase: "planejamento" });
    const recalls = await readJsonl(path.join(tempRoot, "memory", "recalls.jsonl"));

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(recalls.filter((record) => record.flow_id === flow.flow_id)).toHaveLength(1);
  });

  it("reuses a persisted passing gate when advancing", async () => {
    const flow = await engine.createFlow({ goal: "Runbook gate then advance" });
    const gate = await engine.checkGate({
      flow_id: flow.flow_id,
      provided: {
        context: "contexto conhecido",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      }
    });

    const advanced = await engine.advance({ flow_id: flow.flow_id });

    expect(gate.status).toBe("passed");
    expect(advanced).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });
  });

  it("advance records librarian hooks across a normal phase change", async () => {
    const flow = await engine.createFlow({ goal: "Hooks no advance" });

    const advanced = await engine.advance({
      flow_id: flow.flow_id,
      provided: {
        context: "contexto conhecido",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      }
    });
    const ledger = await engine.store.readLedger(flow.flow_id);
    const eventTypes = ledger.map((event) => event.type);
    const recalls = await readFile(path.join(tempRoot, "memory", "recalls.jsonl"), "utf8");
    const hooks = await readFile(path.join(tempRoot, "memory", "hooks.jsonl"), "utf8");

    expect(advanced).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });
    expect(eventTypes).toEqual(expect.arrayContaining(["memory_hook_recorded", "phase_advanced", "memory_recalled"]));
    expect(eventTypes.indexOf("memory_hook_recorded")).toBeLessThan(eventTypes.indexOf("phase_advanced"));
    expect(eventTypes.indexOf("phase_advanced")).toBeLessThan(eventTypes.indexOf("memory_recalled"));
    expect(recalls).toContain("recalled_count");
    expect(hooks).toContain("promoted_curated_memory");
  });

  it("advance records graphify recall hints when the provider is enabled", async () => {
    const provider: MemoryGraphProvider = {
      recall: async (input) => ({
        flow_id: input.flow_id,
        phase: input.phase,
        queried_at: new Date().toISOString(),
        warnings: [],
        items: [graphHit(input.question, "MemoryLibrarian", "src/memory/memory-hooks.ts", 12)]
      })
    };
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
    const flow = await graphEngine.createFlow({ goal: "Graphify ledger recall" });

    const advanced = await graphEngine.advance({
      flow_id: flow.flow_id,
      provided: {
        context: "contexto conhecido",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      }
    });
    const ledger = await graphEngine.store.readLedger(flow.flow_id);
    const recallEvent = ledger.findLast((event) => event.type === "memory_recalled");

    expect(advanced).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });
    expect(recallEvent?.data).toMatchObject({
      phase: "planejamento",
      recalled_count: expect.any(Number),
      warnings: expect.arrayContaining(["graphify_recalled: 1"])
    });
    expect(JSON.stringify(recallEvent?.data)).toContain("\"source\":\"graphify\"");
    expect(JSON.stringify(recallEvent?.data)).toContain("\"destination\":\"recall_hint\"");
    expect(JSON.stringify(recallEvent?.data)).not.toContain("Traversal:");
  });

  it("keeps librarian display but skips duplicate memory_recalled ledger events", async () => {
    const dedupedHooks: MemoryHookRunner = {
      beforePhase: async () => ({
        flow_id: "x",
        phase: "planejamento",
        recalled_at: new Date().toISOString(),
        items: [],
        warnings: [],
        visual_status: { librarian: "empty", graphify: "disabled" },
        deduped: true
      }),
      afterPhase: async () => ({
        flow_id: "x",
        phase: "pensamentos",
        recorded_at: new Date().toISOString(),
        candidates_count: 0,
        parking_count: 0,
        warnings: []
      })
    };
    const dedupedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), dedupedHooks);
    const flow = await dedupedEngine.createFlow({ goal: "Dedup recall ledger" });

    const advanced = await dedupedEngine.advance({
      flow_id: flow.flow_id,
      provided: {
        context: "contexto conhecido",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      }
    });
    const ledger = await dedupedEngine.store.readLedger(flow.flow_id);

    expect(advanced.display?.librarian).toMatchObject({ status: "empty", recalled_count: 0 });
    expect(ledger.some((event) => event.type === "memory_recalled")).toBe(false);
  });

  it("keeps advance working when graphify provider fails", async () => {
    const provider: MemoryGraphProvider = {
      recall: async () => {
        throw new Error("graphify unavailable");
      }
    };
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
    const flow = await graphEngine.createFlow({ goal: "Graphify falha tolerada" });

    const advanced = await graphEngine.advance({
      flow_id: flow.flow_id,
      provided: {
        context: "contexto conhecido",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      }
    });
    const ledger = await graphEngine.store.readLedger(flow.flow_id);
    const recallEvent = ledger.findLast((event) => event.type === "memory_recalled");

    expect(advanced).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });
    expect(recallEvent?.data).toMatchObject({
      warnings: expect.arrayContaining(["graphify_recall_failed: graphify unavailable"])
    });
  });

  it("final advance records afterPhase without beforePhase", async () => {
    const flow = await engine.createFlow({ goal: "Final hooks PPIRTV" });
    await engine.advance({ flow_id: flow.flow_id, provided: { context: "ctx", risks: ["r"], uncertainties: ["u"] } });
    await engine.advance({
      flow_id: flow.flow_id,
      provided: { scope_in: ["mvp"], scope_out: ["http"], tasks: ["codar"], expected_evidence: ["teste"], done_criteria: ["passar"] }
    });
    await engine.advance({ flow_id: flow.flow_id, provided: { implementation_done: true, changed_files: ["src/index.ts"] } });
    await engine.advance({ flow_id: flow.flow_id, provided: { diff_reviewed: true, barata_scan: true, regression_risks: ["baixo"] } });
    await engine.attachEvidence({ flow_id: flow.flow_id, kind: "note", title: "evidencia final", content: "ok" });
    await engine.advance({ flow_id: flow.flow_id, provided: { test_executed: true } });
    await engine.recordVerdict({
      flow_id: flow.flow_id,
      status: "pronto",
      rationale: "E2E passou",
      evidence_ids: ["e2e"],
      residual_risks: [],
      next_step: "arquivar"
    });
    const beforeFinal = await engine.store.readLedger(flow.flow_id);
    const beforeRecallCount = beforeFinal.filter((event) => event.type === "memory_recalled").length;

    const finalAdvance = await engine.advance({
      flow_id: flow.flow_id,
      provided: { residual_risks: ["baixo"], next_step: "arquivar", memoria_viva_reconciled: true }
    });
    const afterFinal = await engine.store.readLedger(flow.flow_id);
    const afterRecallCount = afterFinal.filter((event) => event.type === "memory_recalled").length;
    const finalHook = afterFinal.findLast((event) => event.type === "memory_hook_recorded");

    expect(finalAdvance).toMatchObject({ advanced: true, from: "validacao", to: null, status: "complete" });
    expect(afterRecallCount).toBe(beforeRecallCount);
    expect(finalHook?.data).toMatchObject({ phase: "validacao" });
  });

  it("keeps advance working when the librarian fails", async () => {
    const failingHooks: MemoryHookRunner = {
      beforePhase: async () => {
        throw new Error("before unavailable");
      },
      afterPhase: async () => {
        throw new Error("after unavailable");
      }
    };
    const guardedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), failingHooks);
    const flow = await guardedEngine.createFlow({ goal: "Bibliotecario tolerante" });

    const advanced = await guardedEngine.advance({
      flow_id: flow.flow_id,
      provided: {
        context: "contexto conhecido",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      }
    });
    const ledger = await guardedEngine.store.readLedger(flow.flow_id);

    expect(advanced).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });
    expect(ledger.filter((event) => event.type === "memory_hook_warning")).toHaveLength(2);
  });

  it("stops the pipeline and leaves remaining items pending while memoria-viva is not attested", async () => {
    const result = await engine.runPipeline({
      pipeline: [
        validPipelineItem("Pipeline item 1"),
        {
          goal: "Pipeline item 2 missing planning facts",
          context: "ctx",
          scope_in: ["src/b.ts"],
          risks: ["risco"],
          uncertainties: ["lacuna"]
        },
        validPipelineItem("Pipeline item 3")
      ],
      stop_on_failure: true,
      auto_memory_mining: true
    });
    const flows = result.flows as Array<Record<string, unknown>>;
    const firstLedger = await engine.store.readLedger(flows[0].flow_id as string);

    expect(result).toMatchObject({ total: 3, completed: 0, failed: 1, pending: 2, auto_memory_mining: true });
    expect(flows.map((flow) => flow.status)).toEqual(["bloqueado", "pending", "pending"]);
    expect(String(flows[0].blocker)).toContain("memoria_viva_reconciled");
    const firstEventTypes = firstLedger.map((event) => event.type);
    expect(firstEventTypes).toEqual(
      expect.arrayContaining([
        "pipeline_item_started",
        "flow_facts_updated",
        "evidence_attached",
        "verdict_recorded",
        "memory_mined",
        "pipeline_item_blocked"
      ])
    );
    expect(firstEventTypes).not.toContain("pipeline_item_completed");
    expect(firstEventTypes.indexOf("verdict_recorded")).toBeLessThan(firstEventTypes.indexOf("memory_mined"));
  });

  it("does not let the pipeline auto-attest memoria-viva reconciliation", async () => {
    const result = await engine.runPipeline({
      pipeline: [validPipelineItem("Pipeline must wait for memoria-viva")],
      stop_on_failure: true,
      auto_memory_mining: true
    });
    const flows = result.flows as Array<Record<string, unknown>>;
    const ledger = await engine.store.readLedger(flows[0].flow_id as string);

    expect(result).toMatchObject({ total: 1, completed: 0, failed: 1, pending: 0 });
    expect(flows[0]).toMatchObject({ status: "bloqueado" });
    expect(String(flows[0].blocker)).toContain("memoria_viva_reconciled");
    expect(ledger.map((event) => event.type)).not.toContain("pipeline_item_completed");
  });

  it("generates unique pipeline ids for rapid sequential runs", async () => {
    const first = await engine.runPipeline({
      pipeline: [validPipelineItem("Rapid pipeline A")],
      stop_on_failure: true,
      auto_memory_mining: false
    });
    const second = await engine.runPipeline({
      pipeline: [validPipelineItem("Rapid pipeline B")],
      stop_on_failure: true,
      auto_memory_mining: false
    });

    expect(first.pipeline_id).toMatch(/^pipe_/);
    expect(second.pipeline_id).toMatch(/^pipe_/);
    expect(first.pipeline_id).not.toBe(second.pipeline_id);
  });

  it("mines memory after the pipeline verdict so verdict gold_mining is visible", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "pipeline-memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const result = await engine.runPipeline({
        pipeline: [
          {
            ...validPipelineItem("Pipeline verdict mining"),
            verdict_gold_mining: ["Ponto cego Delphi DUnitX standalone vs provider vindo do veredito do pipeline."]
          }
        ],
        stop_on_failure: true,
        auto_memory_mining: true
      });
      const flow = (result.flows as Array<Record<string, unknown>>)[0];
      const ledger = await engine.store.readLedger(flow.flow_id as string);
      const eventTypes = ledger.map((event) => event.type);
      const mined = ledger.findLast((event) => event.type === "memory_mined")?.data as Record<string, unknown>;
      const memoria = await readFile(path.join(memRoot, "temas", "delphi", "MEMORIA.md"), "utf8");

      expect(flow).toMatchObject({ status: "bloqueado" });
      expect(String(flow.blocker)).toContain("memoria_viva_reconciled");
      expect(eventTypes.indexOf("verdict_recorded")).toBeLessThan(eventTypes.indexOf("memory_mined"));
      expect(mined.written).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            files: expect.arrayContaining([expect.stringContaining(path.join("temas", "delphi", "MEMORIA.md"))])
          })
        ])
      );
      expect(memoria).toContain("Delphi DUnitX standalone");
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("marks a pipeline item blocked when post-verdict memory mining blocks", async () => {
    const result = await engine.runPipeline({
      pipeline: [
        {
          ...validPipelineItem("Pipeline mining blocked"),
          verdict_gold_mining: ["pythia-deepseek deve bloquear tema com cara de projeto."]
        }
      ],
      stop_on_failure: true,
      auto_memory_mining: true
    });
    const flow = (result.flows as Array<Record<string, unknown>>)[0];
    const ledger = await engine.store.readLedger(flow.flow_id as string);

    expect(result).toMatchObject({ completed: 0, failed: 1, pending: 0 });
    expect(flow).toMatchObject({ status: "bloqueado", blocker: "MEMORY_MINING_BLOCKED_VERDICT" });
    expect(flow.verdict_id).toMatch(/^vrd_/);
    expect(ledger.map((event) => event.type)).toEqual(expect.arrayContaining(["verdict_recorded", "memory_mined", "pipeline_item_blocked"]));
  });

  it("keeps mm_pipeline_run moving when stop_on_failure is false", async () => {
    const result = await engine.runPipeline({
      pipeline: [
        {
          goal: "Pipeline broken item",
          context: "ctx",
          scope_in: ["src/a.ts"],
          risks: ["risco"],
          uncertainties: ["lacuna"]
        },
        validPipelineItem("Pipeline recovered item")
      ],
      stop_on_failure: false,
      auto_memory_mining: false
    });
    const flows = result.flows as Array<Record<string, unknown>>;

    expect(result).toMatchObject({ total: 2, completed: 0, failed: 2, pending: 0, auto_memory_mining: false });
    expect(flows.map((flow) => flow.status)).toEqual(["bloqueado", "bloqueado"]);
    expect(String(flows[0].blocker)).toContain("complete_gate_planejamento");
    expect(String(flows[1].blocker)).toContain("memoria_viva_reconciled");
  });

  it("requires goal_verdict to operate on a flow started by goal_start", async () => {
    const flow = await engine.createFlow({
      goal: "Nao e GOAL oficial",
      context: "ctx",
      risks: ["risco"],
      uncertainties: ["lacuna"]
    });
    const evidence = await engine.attachEvidence({ flow_id: flow.flow_id, kind: "test", title: "teste", content: "pass" });

    await expect(
      engine.goalVerdict({
        flow_id: flow.flow_id,
        status: "pronto",
        rationale: "nao deve aceitar wrapper GOAL sem goal_start",
        evidence_ids: [evidence.evidence_id],
        next_step: "corrigir"
      })
    ).rejects.toThrow(/not bound to an official GOAL/);
  });

  it("requires goal_resume to operate on a flow started by goal_start", async () => {
    const flow = await engine.createFlow({
      goal: "Nao e GOAL oficial",
      context: "ctx",
      risks: ["risco"],
      uncertainties: ["lacuna"]
    });

    await expect(engine.resumeGoal({ flow_id: flow.flow_id, note: "nao deve retomar flow comum" })).rejects.toThrow(
      /not bound to an official GOAL/
    );
  });

  it("keeps goal_resume working for official GOAL flows", async () => {
    const workspace = path.join(tempRoot, "workspace-goal-resume-official");
    const sptPath = await writeFakeSpt(workspace, "Retomar GOAL oficial");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Retomar GOAL oficial",
      idempotency_key: "dex-code:test-goal-resume-official",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    });

    const resumed = await engine.resumeGoal({ flow_id: started.flow_id as string, note: "retomada oficial" });

    expect(resumed).toMatchObject({
      flow_id: started.flow_id,
      resumed: true,
      goal_envelope: expect.objectContaining({ idempotency_key: "dex-code:test-goal-resume-official" })
    });
  });

  it("does not promote unknown parking items to gold by default", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace, "Auditar fallback do garimpo");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Auditar fallback do garimpo",
      idempotency_key: "dex-code:test-garimpo-fallback",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    });
    const meeting = await engine.openMeeting({
      flow_id: started.flow_id as string,
      type: "divergent",
      question: "Item neutro promove?"
    });
    await engine.recordMeeting({
      meeting_id: meeting.meeting_id as string,
      parking_lot: ["Item neutro de estacionamento sem palavra de promocao"]
    });
    const status = await engine.goalStatus({ flow_id: started.flow_id as string });
    const links = status.goal_learning_links as Array<Record<string, Record<string, unknown>>>;

    expect(links[0].garimpo_vinculado).toMatchObject({
      classificacao: "nao_promover",
      promovido_para_gold_mining: false
    });
    expect(status.gold_mining).toEqual([]);
  });

  it("records divergent, convergent and transversal meetings", async () => {
    const flow = await engine.createFlow({ goal: "Modelar reunioes" });
    const divergent = await engine.openMeeting({ flow_id: flow.flow_id, type: "divergent", question: "O que pode falhar?" });
    const convergent = await engine.openMeeting({ flow_id: flow.flow_id, type: "convergent", question: "Qual trilho escolher?" });
    const transversal = await engine.openMeeting({ flow_id: flow.flow_id, type: "transversal", question: "Quais areas impacta?" });

    await engine.recordMeeting({
      meeting_id: divergent.meeting_id,
      alternatives: ["engine puro", "MCP direto"],
      risks: ["estado implicito"],
      parking_lot: ["avaliar tool dedicada para estacionamento depois do MVP"],
      gold_mining: ["artefatos existentes antes de tools novas"]
    });
    await engine.recordMeeting({
      meeting_id: convergent.meeting_id,
      decisions: ["engine puro com adaptador MCP"],
      next_steps: ["testar restart"]
    });
    await engine.recordMeeting({
      meeting_id: transversal.meeting_id,
      affected_areas: ["seguranca", "docs", "testes"],
      impacts: ["sem secrets no ledger"]
    });

    const meetings = await engine.store.listMeetings(flow.flow_id);
    expect(meetings.map((meeting) => meeting.type).sort()).toEqual(["convergent", "divergent", "transversal"]);
    expect(meetings.find((meeting) => meeting.type === "divergent")?.alternatives).toContain("engine puro");
    expect(meetings.find((meeting) => meeting.type === "divergent")?.parking_lot).toContain("avaliar tool dedicada para estacionamento depois do MVP");
    expect(meetings.find((meeting) => meeting.type === "convergent")?.decisions).toContain("engine puro com adaptador MCP");
    expect(meetings.find((meeting) => meeting.type === "transversal")?.affected_areas).toContain("seguranca");
  });

  it("rejects invalid artifact ids before writing undefined json files", async () => {
    const flow = await engine.createFlow({ goal: "Validar ids de artefatos" });
    await expect(
      engine.store.saveMeeting({
        meeting_id: undefined as unknown as string,
        flow_id: flow.flow_id,
        type: "divergent",
        question: "Nao deve gravar undefined",
        status: "open",
        opened_at: new Date().toISOString(),
        questions: [],
        hypotheses: [],
        alternatives: [],
        decisions: [],
        risks: [],
        next_steps: [],
        affected_areas: [],
        impacts: [],
        owners: [],
        gates_extra: [],
        parking_lot: [],
        gold_mining: [],
        cooperators: [],
        active_credits: []
      })
    ).rejects.toThrow(/Invalid meeting_id/);
    await expect(
      engine.store.saveEvidence({
        evidence_id: "undefined",
        flow_id: flow.flow_id,
        kind: "note",
        title: "Nao deve gravar undefined",
        parking_lot: [],
        gold_mining: [],
        cooperators: [],
        active_credits: [],
        created_at: new Date().toISOString()
      })
    ).rejects.toThrow(/Invalid evidence_id/);
    await expect(engine.openMeeting({ flow_id: undefined as unknown as string, type: "divergent", question: "Flow invalido" })).rejects.toThrow(
      /Invalid flow_id/
    );

    const meetingFiles = await readdir(path.join(tempRoot, "meetings"));
    const evidenceFiles = await readdir(path.join(tempRoot, "evidence"));

    expect(meetingFiles).not.toContain("undefined.json");
    expect(evidenceFiles).not.toContain("undefined.json");
  });

  it("attaches evidence, downgrades unsupported pronto verdicts and scans hygiene", async () => {
    const flow = await engine.createFlow({ goal: "Validar evidencia" });
    const unsupported = await engine.recordVerdict({
      flow_id: flow.flow_id,
      status: "pronto",
      rationale: "Sem evidencia para testar downgrade",
      next_step: "anexar evidencia"
    });
    const evidence = await engine.attachEvidence({
      flow_id: flow.flow_id,
      kind: "test_log",
      title: "vitest run",
      content: "pass"
    });
    const supported = await engine.recordVerdict({
      flow_id: flow.flow_id,
      status: "pronto",
      rationale: "Teste executado",
      evidence_ids: [evidence.evidence_id],
      residual_risks: [],
      next_step: "arquivar"
    });
    const hygiene = await engine.hygieneScan(flow.flow_id);

    expect(unsupported.status).toBe("nao_pronto");
    expect(unsupported.display.active_credits).toEqual([]);
    expect(supported.status).toBe("pronto");
    expect(hygiene.rule).toBe("barata nunca esta sozinha");
    expect(Array.isArray(hygiene.findings)).toBe(true);
  });

  it("classifies evidence quality without blocking legacy evidence", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-evidence-quality", "Classificar qualidade de evidencia");
    const weak = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "print solto"
    });
    const strong = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "npm run check",
      content:
        "Origem: terminal local. Objetivo: validar suite. Fase: teste. Procedimento: npm run check. Resultado observado: pass. Limitacao: ambiente local.",
      satisfies: ["npm run check"]
    });

    const status = await engine.goalStatus({ flow_id: flowId });
    const evidence = status.evidence as Array<Record<string, unknown>>;
    const weakQuality = evidence.find((item) => item.evidence_id === weak.evidence_id)?.evidence_quality as Record<string, unknown>;
    const strongQuality = evidence.find((item) => item.evidence_id === strong.evidence_id)?.evidence_quality as Record<string, unknown>;
    const checkout = status.ppirtv_checkout as Record<string, unknown>;
    const evidenceAccountability = checkout.evidence_accountability as Record<string, unknown>;

    expect(weakQuality).toMatchObject({ status: "weak", blocking: false });
    expect(strongQuality).toMatchObject({ status: "strong", blocking: false });
    expect(evidenceAccountability).toMatchObject({
      total: expect.any(Number),
      weak_count: expect.any(Number),
      strong_count: expect.any(Number),
      blocks_ready: false
    });
    expect((evidenceAccountability.items as Array<Record<string, unknown>>).map((item) => item.evidence_id)).toEqual(
      expect.arrayContaining([weak.evidence_id, strong.evidence_id])
    );
  });

  it("exports a redacted diagnostic bundle without reading env files", async () => {
    await writeFile(path.join(tempRoot, ".env"), "API_KEY=SHOULD_NOT_READ\n", "utf8");
    const flow = await engine.createFlow({
      goal: "Diagnostico redatado",
      context: "ctx",
      risks: ["risco"],
      uncertainties: ["lacuna"]
    });
    await engine.attachEvidence({
      flow_id: flow.flow_id,
      kind: "log",
      title: "runtime log",
      content: "Authorization: Bearer abcdefghijklmnop"
    });
    const bundle = await exportRedactedDiagnosticBundle(engine.store, { flow_id: flow.flow_id, include_evidence_content: true });
    const text = JSON.stringify(bundle);

    expect(bundle.flow).toMatchObject({ flow_id: flow.flow_id, status: "active" });
    expect(bundle.evidence[0]).toMatchObject({ content: "[redacted]" });
    expect(bundle.limitations).toEqual(expect.arrayContaining([expect.stringContaining("redacted snapshot")]));
    // SSOT redaction pode registrar "secret-like-value" em vez de "Authorization".
    expect(bundle.redactions_applied.length).toBeGreaterThan(0);
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).not.toContain("SHOULD_NOT_READ");
  });

  it("starts GOAL/SPT flows idempotently after validating a local SPT", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace);
    const initialSptBytes = await readFile(sptPath);
    const initialSptSha256 = createHash("sha256").update(initialSptBytes).digest("hex");
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-goal-001",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code" as const,
      mode: "full" as const
    };

    const validation = await engine.validateSpt({ workspace, spt_path: sptPath, objective: envelope.objective });
    const started = await engine.startGoal(envelope);
    const reused = await engine.startGoal(envelope);
    const status = await engine.goalStatus({ idempotency_key: envelope.idempotency_key });

    expect(validation.valid).toBe(true);
    expect(validation.document_sha256).toBe(initialSptSha256);
    expect(validation.tasks).toContain("Rodar teste local.");
    expect(validation.expected_evidence).toContain("npm run check.");
    expect(validation.done_criteria).toContain("npm run check.");
    expect(started.started).toBe(true);
    expect(reused.reused).toBe(true);
    expect(reused.flow_id).toBe(started.flow_id);
    expect(status.flow_id).toBe(started.flow_id);
    expect(status.tasks).toEqual(expect.arrayContaining(["Rodar teste local."]));
    expect(status.expected_evidence).toEqual(expect.arrayContaining(["npm run check."]));
    expect(status.done_criteria).toEqual(expect.arrayContaining(["npm run check."]));
    expect((status.goal_envelope as Record<string, unknown>).source).toBe("dex-code");
    expect((status.checklist as Record<string, unknown>).phase).toBe("pensamentos");
    const ledger = await engine.store.readLedger(started.flow_id as string);
    const goalStarted = ledger.find((event) => event.type === "goal_started");
    const persisted = await engine.store.loadFlow(started.flow_id as string);
    expect(persisted.goal_binding).toMatchObject({
      goal_id: "fake-goal-spt",
      spt_document_sha256_at_start: initialSptSha256
    });
    expect(goalStarted?.data).toMatchObject({
      goal_id: "fake-goal-spt",
      spt_document_sha256_at_start: initialSptSha256
    });
    expect(goalStarted?.data.tasks).toEqual(expect.arrayContaining(["Rodar teste local."]));
    expect(goalStarted?.data.expected_evidence).toEqual(expect.arrayContaining(["npm run check."]));
    expect(goalStarted?.data.done_criteria).toEqual(expect.arrayContaining(["npm run check."]));
  });

  it("claims the idempotency key before concurrent first goal_start calls create a flow", async () => {
    const workspace = path.join(tempRoot, "goal-start-concurrent-claim");
    const sptPath = await writeFakeSpt(workspace);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-goal-start-concurrent-claim",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code" as const,
      mode: "full" as const
    };

    const results = await Promise.all(Array.from({ length: 5 }, () => engine.startGoal(envelope)));
    const flowIds = new Set(results.map((result) => result.flow_id as string));
    const matchingFlows = (await engine.store.listFlows()).filter(
      (flow) => flow.goal_binding?.envelope.idempotency_key === envelope.idempotency_key
    );

    expect(flowIds.size).toBe(1);
    expect(results.filter((result) => result.started === true)).toHaveLength(1);
    expect(results.filter((result) => result.reused === true)).toHaveLength(4);
    expect(matchingFlows).toHaveLength(1);
    const ledger = await engine.store.readLedger(matchingFlows[0].flow_id);
    expect(ledger.filter((event) => event.type === "goal_started")).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "goal_reused")).toHaveLength(4);
  });

  it("goal start recovery keeps one bound flow and records explicit recovery events when state persisted before ledger", async () => {
    const workspace = path.join(tempRoot, "goal-start-recovery-before-ledger");
    const sptPath = await writeFakeSpt(workspace);
    const faultStore = new LedgerFaultStore(tempRoot, "flow_created", "before");
    const faultEngine = new FlowEngine(faultStore);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-goal-start-recovery-before-ledger",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code",
      mode: "full" as const
    };

    await expect(faultEngine.startGoal(envelope)).rejects.toThrow(/LEDGER_FAULT_BEFORE_APPEND/);
    const reloadedEngineA = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const reloadedEngineB = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const retries = await Promise.all([
      reloadedEngineA.startGoal(envelope),
      reloadedEngineB.startGoal(envelope)
    ]);
    const retried = retries[0];
    const flows = await faultStore.listFlows();

    expect(flows).toHaveLength(1);
    expect(flows[0].goal_binding?.envelope.idempotency_key).toBe(envelope.idempotency_key);
    expect(retried).toMatchObject({ flow_id: flows[0].flow_id, reused: true });
    const ledger = await faultStore.readLedger(flows[0].flow_id);
    expect(ledger.filter((event) => event.type === "flow_created")).toHaveLength(0);
    expect(ledger.filter((event) => event.type === "goal_started")).toHaveLength(0);
    expect(ledger.filter((event) => event.type === "flow_created_recovered")).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "goal_started_recovered")).toHaveLength(1);
    expect(ledger.find((event) => event.type === "flow_created_recovered")?.data).toMatchObject({
      original_event_type: "flow_created",
      original_at: flows[0].created_at,
      recovery_reason: "state_persisted_ledger_missing"
    });
    expect(ledger.find((event) => event.type === "goal_started_recovered")?.data).toMatchObject({
      original_event_type: "goal_started",
      original_at: flows[0].goal_binding?.started_at,
      recovery_reason: "state_persisted_ledger_missing"
    });
  });

  it("goal start recovery does not append a recovery event when the original append persisted before transport failure", async () => {
    const workspace = path.join(tempRoot, "goal-start-recovery-after-ledger");
    const sptPath = await writeFakeSpt(workspace);
    const faultStore = new LedgerFaultStore(tempRoot, "goal_started", "after");
    const faultEngine = new FlowEngine(faultStore);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-goal-start-recovery-after-ledger",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code",
      mode: "full" as const
    };

    await expect(faultEngine.startGoal(envelope)).rejects.toThrow(/LEDGER_FAULT_AFTER_APPEND/);
    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const retried = await reloadedEngine.startGoal(envelope);
    const flows = await faultStore.listFlows();
    const ledger = await faultStore.readLedger(retried.flow_id as string);

    expect(flows).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "goal_started")).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "goal_started_recovered")).toHaveLength(0);
  });

  it("goal start recovery preserves flow_created and recovers only goal_started when the second append is missing", async () => {
    const workspace = path.join(tempRoot, "goal-start-recovery-second-append");
    const sptPath = await writeFakeSpt(workspace);
    const faultStore = new LedgerFaultStore(tempRoot, "goal_started", "before");
    const faultEngine = new FlowEngine(faultStore);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-goal-start-recovery-second-append",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code",
      mode: "full" as const
    };

    await expect(faultEngine.startGoal(envelope)).rejects.toThrow(/LEDGER_FAULT_BEFORE_APPEND/);
    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const retried = await reloadedEngine.startGoal(envelope);
    const ledger = await reloadedEngine.store.readLedger(retried.flow_id as string);

    expect(ledger.filter((event) => event.type === "flow_created")).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "flow_created_recovered")).toHaveLength(0);
    expect(ledger.filter((event) => event.type === "goal_started")).toHaveLength(0);
    expect(ledger.filter((event) => event.type === "goal_started_recovered")).toHaveLength(1);
  });

  it("goal start recovery persists the official binding in the first saved state before retry", async () => {
    const workspace = path.join(tempRoot, "goal-start-first-save-bound");
    const sptPath = await writeFakeSpt(workspace);
    const faultStore = new FirstOfficialSaveThenThrowStore(tempRoot);
    const faultEngine = new FlowEngine(faultStore);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-goal-start-first-save-bound",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code",
      mode: "full" as const
    };

    await expect(faultEngine.startGoal(envelope)).rejects.toThrow(/FIRST_OFFICIAL_SAVE_THEN_THROW/);
    const persistedAfterFailure = await faultStore.listFlows();
    expect(persistedAfterFailure).toHaveLength(1);
    expect(persistedAfterFailure[0].goal_binding?.envelope.idempotency_key).toBe(envelope.idempotency_key);

    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const retried = await reloadedEngine.startGoal(envelope);
    expect(retried).toMatchObject({ flow_id: persistedAfterFailure[0].flow_id, reused: true });
    expect(await reloadedEngine.store.listFlows()).toHaveLength(1);
  });

  it("binds an existing active legacy flow with an original goal_started event instead of fabricating recovery", async () => {
    const workspace = path.join(tempRoot, "goal-start-existing-active-unbound");
    const sptPath = await writeFakeSpt(workspace);
    const legacyFlow = await engine.createFlow({ goal: "Executar ponte GOAL/SPT" });
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      flow_id: legacyFlow.flow_id,
      idempotency_key: "dex-code:test-goal-start-existing-active-unbound",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    });
    const persisted = await engine.store.loadFlow(legacyFlow.flow_id);
    const ledger = await engine.store.readLedger(legacyFlow.flow_id);

    expect(started).toMatchObject({ flow_id: legacyFlow.flow_id, started: true, reused: false });
    expect(persisted.goal_binding?.envelope.idempotency_key).toBe(
      "dex-code:test-goal-start-existing-active-unbound"
    );
    expect(persisted.history.filter((event) => event.type === "goal_started")).toHaveLength(1);
    expect(persisted.history.filter((event) => event.type === "goal_reused")).toHaveLength(0);
    expect(ledger.filter((event) => event.type === "goal_started")).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "goal_started_recovered")).toHaveLength(0);
  });

  it("rejects first GOAL binding when a legacy flow has a different objective without mutation", async () => {
    const workspace = path.join(tempRoot, "goal-start-existing-objective-mismatch");
    const sptPath = await writeFakeSpt(workspace);
    const legacyFlow = await engine.createFlow({ goal: "Objetivo advisory diferente" });
    const flowBytesBefore = await readFile(engine.store.flowPath(legacyFlow.flow_id), "utf8");
    const ledgerBefore = await readFile(engine.store.ledgerPath, "utf8");

    await expect(
      engine.startGoal({
        workspace,
        spt_path: sptPath,
        objective: "Executar ponte GOAL/SPT",
        flow_id: legacyFlow.flow_id,
        idempotency_key: "dex-code:test-goal-start-existing-objective-mismatch",
        evidence_required: true,
        required_evidence: ["npm run check"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code",
        mode: "full"
      })
    ).rejects.toThrow(/GOAL_LEGACY_FLOW_OBJECTIVE_MISMATCH/);

    expect(await readFile(engine.store.flowPath(legacyFlow.flow_id), "utf8")).toBe(flowBytesBefore);
    expect(await readFile(engine.store.ledgerPath, "utf8")).toBe(ledgerBefore);
  });

  it("rejects first GOAL binding when a legacy flow already has advisory verdict authority", async () => {
    const workspace = path.join(tempRoot, "goal-start-existing-advisory-verdict");
    const sptPath = await writeFakeSpt(workspace);
    const legacyFlow = await engine.createFlow({ goal: "Executar ponte GOAL/SPT" });
    const evidence = await engine.attachEvidence({
      flow_id: legacyFlow.flow_id,
      kind: "test_log",
      title: "legacy advisory evidence",
      content: "pass"
    });
    await engine.recordVerdict({
      flow_id: legacyFlow.flow_id,
      status: "pronto",
      rationale: "Veredito advisory anterior ao GOAL oficial",
      evidence_ids: [evidence.evidence_id],
      residual_risks: [],
      next_step: "bind official goal"
    });
    const flowBytesBefore = await readFile(engine.store.flowPath(legacyFlow.flow_id), "utf8");
    const ledgerBefore = await readFile(engine.store.ledgerPath, "utf8");

    await expect(
      engine.startGoal({
        workspace,
        spt_path: sptPath,
        objective: "Executar ponte GOAL/SPT",
        flow_id: legacyFlow.flow_id,
        idempotency_key: "dex-code:test-goal-start-existing-advisory-verdict",
        evidence_required: true,
        required_evidence: ["npm run check"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code",
        mode: "full"
      })
    ).rejects.toThrow(/GOAL_LEGACY_FLOW_VERDICTS_PRESENT/);

    expect(await readFile(engine.store.flowPath(legacyFlow.flow_id), "utf8")).toBe(flowBytesBefore);
    expect(await readFile(engine.store.ledgerPath, "utf8")).toBe(ledgerBefore);
  });

  it("serializes concurrent first GOAL bindings with different idempotency keys on one legacy flow", async () => {
    const workspace = path.join(tempRoot, "goal-start-existing-concurrent-bindings");
    const sptPath = await writeFakeSpt(workspace);
    const legacyFlow = await engine.createFlow({ goal: "Executar ponte GOAL/SPT" });
    const baseEnvelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      flow_id: legacyFlow.flow_id,
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code",
      mode: "full" as const
    };

    const results = await Promise.allSettled([
      engine.startGoal({ ...baseEnvelope, idempotency_key: "dex-code:test-concurrent-binding-a" }),
      engine.startGoal({ ...baseEnvelope, idempotency_key: "dex-code:test-concurrent-binding-b" })
    ]);
    const persisted = await engine.store.loadFlow(legacyFlow.flow_id);
    const ledger = await engine.store.readLedger(legacyFlow.flow_id);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(persisted.goal_binding?.envelope.idempotency_key).toMatch(
      /^dex-code:test-concurrent-binding-[ab]$/
    );
    expect(persisted.history.filter((event) => event.type === "goal_started")).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "goal_started")).toHaveLength(1);
  });

  it("rejects first GOAL binding of an already terminal legacy flow without mutation or TypeError", async () => {
    const workspace = path.join(tempRoot, "goal-start-existing-terminal-unbound");
    const sptPath = await writeFakeSpt(workspace);
    const legacyFlow = await engine.createFlow({ goal: "Fluxo legado terminal sem GOAL oficial" });
    await engine.archiveFlow({ flow_id: legacyFlow.flow_id, reason: "terminal before official binding" });
    const flowBytesBefore = await readFile(engine.store.flowPath(legacyFlow.flow_id), "utf8");
    const ledgerBefore = await readFile(engine.store.ledgerPath, "utf8");

    await expect(
      engine.startGoal({
        workspace,
        spt_path: sptPath,
        objective: "Executar ponte GOAL/SPT",
        flow_id: legacyFlow.flow_id,
        idempotency_key: "dex-code:test-goal-start-existing-terminal-unbound",
        evidence_required: true,
        required_evidence: ["npm run check"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code",
        mode: "full"
      })
    ).rejects.toThrow(/GOAL_TERMINAL_FLOW_UNBOUND/);

    expect(await readFile(engine.store.flowPath(legacyFlow.flow_id), "utf8")).toBe(flowBytesBefore);
    expect(await readFile(engine.store.ledgerPath, "utf8")).toBe(ledgerBefore);
  });

  it("duplicate bindings fail closed with a structured actionable error and zero mutation", async () => {
    const workspace = path.join(tempRoot, "goal-start-duplicate-bindings");
    const sptPath = await writeFakeSpt(workspace);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-goal-start-duplicate-bindings",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code",
      mode: "full" as const
    };
    const validation = await engine.validateSpt({ workspace, spt_path: sptPath, objective: envelope.objective });
    const first = await engine.createFlow({ goal: envelope.objective });
    const second = await engine.createFlow({ goal: envelope.objective });
    for (const flowId of [first.flow_id, second.flow_id]) {
      const flow = await engine.store.loadFlow(flowId);
      flow.goal_binding = {
        envelope: { ...envelope, flow_id: flowId },
        goal_id: validation.goal_id ?? undefined,
        spt_contract_fingerprint: validation.contract_fingerprint ?? undefined,
        spt_document_sha256_at_start: validation.document_sha256 ?? undefined,
        started_at: flow.created_at,
        last_seen_at: flow.created_at
      };
      await engine.store.saveFlow(flow);
    }
    const flowIds = [first.flow_id, second.flow_id].sort();
    const beforeFlows = await Promise.all(flowIds.map((flowId) => readFile(engine.store.flowPath(flowId), "utf8")));
    const beforeLedger = await readFile(engine.store.ledgerPath, "utf8");

    await expect(engine.startGoal(envelope)).rejects.toMatchObject({
      code: "GOAL_IDEMPOTENCY_DUPLICATE_BINDINGS",
      conflicting_flow_ids: flowIds,
      next_required_action: {
        type: "inspect_goal_bindings",
        tool: "ppirtv_trace"
      }
    });
    expect(await Promise.all(flowIds.map((flowId) => readFile(engine.store.flowPath(flowId), "utf8")))).toEqual(beforeFlows);
    expect(await readFile(engine.store.ledgerPath, "utf8")).toBe(beforeLedger);
  });

  it("rejects goal_start when the envelope objective diverges from the SPT v2 contract", async () => {
    const workspace = path.join(tempRoot, "spt-objective-mismatch");
    const sptPath = await writeFakeSpt(workspace);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Objetivo divergente do contrato",
      idempotency_key: "dex-code:test-spt-objective-mismatch",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code",
      mode: "full" as const
    };

    const validation = await engine.validateSpt({ workspace, spt_path: sptPath, objective: envelope.objective });

    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain("spt_v2.objective_matches_request");
    await expect(engine.startGoal(envelope)).rejects.toThrow(/spt_v2\.objective_matches_request/i);
  });

  it("keeps the SPT binding immutable across retries while allowing human-body edits", async () => {
    const workspace = path.join(tempRoot, "spt-contract-fingerprint-retry");
    const sptPath = await writeFakeSpt(workspace);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-spt-contract-fingerprint-retry",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code",
      mode: "full" as const
    };

    const started = await engine.startGoal(envelope);
    const originalFlow = await engine.store.loadFlow(started.flow_id as string);
    const originalFingerprint = originalFlow.goal_binding?.spt_contract_fingerprint;
    const originalDocumentSha256 = originalFlow.goal_binding?.spt_document_sha256_at_start;

    await writeFile(sptPath, fakeSptText(workspace, envelope.objective, "# Human notes rewritten\n\nHeadings and prose are free.\n"), "utf8");
    await expect(engine.startGoal(envelope)).resolves.toMatchObject({ reused: true });

    const changedContract = fakeSptText(workspace).replace("  - Rodar teste local.", "  - Rodar teste alterado.");
    await writeFile(sptPath, changedContract, "utf8");
    await expect(engine.startGoal(envelope)).rejects.toThrow(/GOAL_BINDING_MISMATCH.*spt_contract/i);

    const persisted = await engine.store.loadFlow(started.flow_id as string);
    expect(persisted.goal_binding?.spt_contract_fingerprint).toBe(originalFingerprint);
    expect(persisted.goal_binding?.spt_document_sha256_at_start).toBe(originalDocumentSha256);
    expect(persisted.tasks).toContain("Rodar teste local.");
    expect(persisted.tasks).not.toContain("Rodar teste alterado.");

    await writeFile(sptPath, fakeSptText(workspace), "utf8");
    if (persisted.goal_binding) {
      delete persisted.goal_binding.spt_contract_fingerprint;
    }
    await engine.store.saveFlow(persisted);
    await expect(engine.startGoal(envelope)).rejects.toThrow(/GOAL_BINDING_MISMATCH.*spt_contract_fingerprint/i);
  });

  it("does not silently upgrade historical bindings during an idempotent retry", async () => {
    const workspace = path.join(tempRoot, "legacy-binding-retry");
    const sptPath = await writeFakeSpt(workspace);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-legacy-binding-retry",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code",
      mode: "full" as const
    };
    const started = await engine.startGoal(envelope);
    const historical = await engine.store.loadFlow(started.flow_id as string);
    if (!historical.goal_binding) {
      throw new Error("fixture must have a goal binding");
    }
    delete historical.goal_binding.goal_id;
    delete historical.goal_binding.spt_document_sha256_at_start;
    await engine.store.saveFlow(historical);

    await expect(engine.startGoal(envelope)).resolves.toMatchObject({ reused: true });
    const retried = await engine.store.loadFlow(started.flow_id as string);
    expect(retried.goal_binding?.goal_id).toBeUndefined();
    expect(retried.goal_binding?.spt_document_sha256_at_start).toBeUndefined();
  });

  it("rejects goal_start before persistence when the requested workspace differs from the runtime store project", async () => {
    const runtimeWorkspace = path.join(tempRoot, "runtime-workspace");
    const requestedWorkspace = path.join(tempRoot, "requested-workspace");
    const isolatedEngine = new FlowEngine(new PpirtvStore(path.join(runtimeWorkspace, ".ppirtv")));
    const sptPath = await writeFakeSpt(requestedWorkspace);

    await expect(isolatedEngine.startGoal({
      workspace: requestedWorkspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-workspace-store-mismatch",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    })).rejects.toThrow(/GOAL_WORKSPACE_STORE_MISMATCH/i);

    expect(await isolatedEngine.store.listFlows()).toEqual([]);
  });

  it("does not bypass the workspace boundary when an explicit store root has a noncanonical name", async () => {
    const runtimeWorkspace = path.join(tempRoot, "runtime-custom-store");
    const requestedWorkspace = path.join(tempRoot, "requested-custom-store");
    const isolatedEngine = new FlowEngine(new PpirtvStore(path.join(runtimeWorkspace, "custom-store")));
    const sptPath = await writeFakeSpt(requestedWorkspace);

    await expect(isolatedEngine.startGoal({
      workspace: requestedWorkspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-custom-store-workspace-mismatch",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    })).rejects.toThrow(/GOAL_WORKSPACE_STORE_MISMATCH|PPIRTV_STORE_PROJECT_ROOT_REQUIRED/i);
  });

  it("does not authorize a nested workspace merely because it lives below a noncanonical store root", async () => {
    const customStoreRoot = path.join(tempRoot, "custom-store-nested");
    const requestedWorkspace = path.join(customStoreRoot, "consumer");
    const isolatedEngine = new FlowEngine(new PpirtvStore(customStoreRoot));
    const sptPath = await writeFakeSpt(requestedWorkspace);

    await expect(isolatedEngine.startGoal({
      workspace: requestedWorkspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-nested-custom-store-mismatch",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    })).rejects.toThrow(/PPIRTV_STORE_PROJECT_ROOT_REQUIRED/i);
  });

  it("runs live GOAL gates, meetings and phase advance with material credits", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace);
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-live-goal-001",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    });
    const flowId = started.flow_id as string;

    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      type: "divergent",
      question: "O que pode transformar o GOAL em fluxo passivo?",
      suggested_cooperators: [{ name: "Chato", reason: "fiscalizar falso fluxo vivo", material: true }]
    });
    const turnWithoutMaterial = await engine.goalMeetingAddTurn({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
      speaker: "Questionador",
      finding: "GOAL pode virar checklist passivo sem gate persistido."
    });
    const convergent = await engine.goalMeetingOpen({
      flow_id: flowId,
      type: "convergent",
      question: "Qual decisao fecha a fase de pensamentos?"
    });
    const recorded = await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: convergent.meeting_id as string,
      participants_present: ["Chato", "questionador", "reuniao", "validador-pronto"],
      decision: "Persistir gate antes de avancar fase.",
      decisions: ["Persistir gate antes de avancar fase."],
      risks: ["Falso pronto sem ledger."],
      parking_lot: ["Avaliar resource futuro para especialistas vivos."],
      gold_mining: ["Credito material nasce de goal_meeting_close, nao de sugestao."],
      satisfies_blockers: ["required_cooperation"],
      cooperators: [{ name: "Chato", reason: "bloqueou credito decorativo e exigiu gate persistido", material: true }],
      active_credits: ["Chato bloqueou credito decorativo e exigiu gate persistido"]
    });
    const gate = await engine.goalGateCheck({ flow_id: flowId });
    const advanced = await engine.goalAdvance({ flow_id: flowId });
    const status = await engine.goalStatus({ flow_id: flowId });
    const ledger = await engine.store.readLedger(flowId);

    expect((opened.suggested_cooperators as Array<Record<string, unknown>>)[0].material).toBe(false);
    expect(turnWithoutMaterial.turns).toEqual(expect.arrayContaining([expect.objectContaining({ speaker: "Questionador" })]));
    expect(recorded.active_credits).toEqual(
      expect.arrayContaining([
        "Chato bloqueou credito decorativo e exigiu gate persistido"
      ])
    );
    expect(gate.status).toBe("passed");
    expect(gate.persisted).toBe(true);
    expect(advanced).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });
    expect(status.phase).toBe("planejamento");
    expect(status.cooperators).toEqual(
      expect.arrayContaining([{ name: "Chato", reason: "bloqueou credito decorativo e exigiu gate persistido", material: true }])
    );
    expect(status.active_credits).toEqual(expect.arrayContaining(["Chato bloqueou credito decorativo e exigiu gate persistido"]));
    expect(status.parking_lot).toEqual(expect.arrayContaining(["Avaliar resource futuro para especialistas vivos."]));
    expect(status.gold_mining).toEqual(expect.arrayContaining(["Credito material nasce de goal_meeting_close, nao de sugestao."]));
    expect(ledger.map((event) => event.type)).toEqual(
      expect.arrayContaining(["goal_started", "meeting_opened", "meeting_turn_added", "meeting_closed", "gate_checked", "phase_advanced"])
    );
  });

  it("links GOAL parking lot to gold mining and writes memory candidates automatically", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const workspace = path.join(tempRoot, "workspace");
    const memRoot = path.join(tempRoot, "memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const sptPath = await writeFakeSpt(workspace, "Minerar memoria GOAL");
      const started = await engine.startGoal({
        workspace,
        spt_path: sptPath,
        objective: "Minerar memoria GOAL",
        idempotency_key: "dex-code:test-mm-memory-mining",
        evidence_required: true,
        required_evidence: ["npm run check"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      });
      const flowId = started.flow_id as string;
      const opened = await engine.goalMeetingOpen({
        flow_id: flowId,
        type: "divergent",
        question: "Qual aprendizado nao pode se perder?"
      });
      await engine.goalMeetingClose({
        flow_id: flowId,
        meeting_id: opened.meeting_id as string,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "Garimpo de memoria fechado com decisao material.",
        satisfies_blockers: ["required_cooperation"],
        parking_lot: ["Ponto cego Delphi DUnitX standalone vs provider precisa virar memoria reutilizavel."]
      });

      const statusBefore = await engine.goalStatus({ flow_id: flowId });
      expect(statusBefore.gold_mining).toEqual(
        expect.arrayContaining(["Ponto cego observado: Ponto cego Delphi DUnitX standalone vs provider precisa virar memoria reutilizavel."])
      );
      expect(statusBefore.goal_learning_links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            parking_item: "Ponto cego Delphi DUnitX standalone vs provider precisa virar memoria reutilizavel.",
            garimpo_vinculado: expect.objectContaining({
              classificacao: "ponto_cego",
              promovido_para_gold_mining: true
            })
          })
        ])
      );

      const mined = await engine.mineMemory({ flow_id: flowId });
      const written = mined.written as Array<{ candidate_id: string; files: string[] }>;
      const memoryStatus = (await engine.goalStatus({ flow_id: flowId })).memory_mining as Record<string, unknown>;
      const lembranca = await readFile(path.join(memRoot, "temas", "delphi", "LEMBRANCA.md"), "utf8");
      const memoria = await readFile(path.join(memRoot, "temas", "delphi", "MEMORIA.md"), "utf8");
      const l3File = written[0]?.files.find((file) => file.replace(/\\/g, "/").includes("/conhecimento/") && !file.endsWith("INDEX.md"));
      const l3Index = written[0]?.files.find((file) => file.replace(/\\/g, "/").endsWith("/conhecimento/INDEX.md"));
      const conhecimento = await readFile(l3File!, "utf8");
      const ledger = await engine.store.readLedger(flowId);

      expect(mined.write_policy).toBe("auto_write");
      expect(mined.blocked_verdict).toBe(false);
      expect(mined).toMatchObject({
        memory_written: true,
        memory_validated: true,
        memory_consolidated: false,
        memory_review_status: "pending_consciencia_memorias",
        memory_post_write_validation: expect.objectContaining({
          status: "passed",
          validator: "consciencia-memorias-post-write",
          evidence_id: expect.stringMatching(/^evd_/),
          checked_triggers: expect.arrayContaining(["PPIRTV-MM-AUTO-WRITE-REVIEW"]),
          l3_files: expect.arrayContaining([expect.stringContaining("conhecimento")])
        })
      });
      expect(written.length).toBeGreaterThan(0);
      expect(written[0]?.files).toEqual(
        expect.arrayContaining([
          path.join(memRoot, "temas", "delphi", "LEMBRANCA.md"),
          path.join(memRoot, "temas", "delphi", "MEMORIA.md"),
          expect.stringContaining(path.join("conhecimento", "INDEX.md"))
        ])
      );
      expect(l3File).toBeTruthy();
      expect(l3Index).toBeTruthy();
      expect(lembranca).toContain("DUnitX standalone");
      expect(lembranca).toContain("PPIRTV-MM-AUTO-WRITE-REVIEW");
      expect(lembranca).toContain("#ppirtv/mm-auto-write");
      expect(lembranca).toContain("[memoria]");
      expect(lembranca).toContain("[[MEMORIA#^");
      expect(memoria).toContain("Delphi DUnitX standalone");
      expect(memoria).toContain("{#");
      expect(memoria).toContain("ReviewStatus: pending_consciencia_memorias");
      expect(memoria).toContain("Obsidian: L1");
      expect(memoria).toContain("Obsidian: L3");
      expect(conhecimento).toContain("L2 relacionada: ../MEMORIA.md#");
      expect(conhecimento).toContain("Obsidian: L2 [[MEMORIA#^");
      expect(memoryStatus.written_count).toBeGreaterThan(0);
      expect(memoryStatus).toMatchObject({
        memory_written: true,
        memory_validated: true,
        memory_consolidated: false,
        memory_review_status: "pending_consciencia_memorias"
      });
      const evidence = await engine.addGoalEvidence({
        flow_id: flowId,
        title: "npm run check",
        content: "pass",
        satisfies: ["npm run check"]
      });
      const verdict = await engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Captura estrutural validada; revisao consciencia-memorias pendente pertence ao ciclo posterior.",
        evidence_ids: [evidence.evidence_id as string],
        meeting_id: opened.meeting_id as string,
        residual_risks: ["curadoria posterior pelo owner de memoria"],
        next_step: "consciencia-memorias revisa quando o lote de consolidacao for executado"
      });
      expect(verdict.verdict).toMatchObject({ status: "pronto_com_ressalvas" });
      expect(ledger.map((event) => event.type)).toContain("memory_mined");
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("normalizes legacy consolidation into pending review and only consolidates after explicit approval", async () => {
    const flow = await engine.createFlow({ goal: "Normalizar memoria consolidada legada" });
    flow.memory_mining = memoryMiningSummary({
      write_policy: "auto_write",
      candidates_count: 1,
      written_count: 1,
      memory_written: true,
      memory_validated: true,
      memory_consolidated: true,
      memory_review_status: undefined,
      memory_post_write_validation: {
        required: true,
        status: "passed",
        validator: "consciencia-memorias-post-write",
        validated_at: new Date().toISOString(),
        touched_files: ["LEMBRANCA.md", "MEMORIA.md"],
        l1_files: ["LEMBRANCA.md"],
        l2_files: ["MEMORIA.md"],
        l3_files: [],
        checked_triggers: ["PPIRTV-MM-AUTO-WRITE-REVIEW"],
        recall_proof: [],
        findings: [],
        parking_lot: [],
        commands_required: []
      }
    });
    await engine.store.saveFlow(flow);

    const pending = await engine.store.loadFlow(flow.flow_id);
    expect(pending.memory_mining).toMatchObject({
      memory_validated: true,
      memory_review_status: "pending_consciencia_memorias",
      memory_consolidated: false
    });

    pending.memory_mining!.memory_review_status = "approved";
    await engine.store.saveFlow(pending);
    const approved = await engine.store.loadFlow(flow.flow_id);
    expect(approved.memory_mining).toMatchObject({
      memory_validated: true,
      memory_review_status: "approved",
      memory_consolidated: true
    });
  });

  it("blocks written memory from being treated as consolidated when post-write L1/L2 links fail", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-post-write-validation-blocks",
      "Memoria escrita nao pode virar consolidada sem links bidirecionais"
    );
    const workspace = path.join(tempRoot, "broken-post-write-memory");
    const l1Path = path.join(workspace, "LEMBRANCA.md");
    const l2Path = path.join(workspace, "MEMORIA.md");
    await mkdir(workspace, { recursive: true });
    await writeFile(l1Path, "- [PPIRTV-MEMORY-MINING-VALIDA-POS-WRITE] gatilho sem links governados.\n", "utf8");
    await writeFile(
      l2Path,
      [
        "## Memoria escrita sem anchor",
        "Localizador: `PPIRTV-MEMORY-MINING-VALIDA-POS-WRITE`",
        "Tags: #ppirtv/mm-auto-write",
        "Aliases: memoria fraca"
      ].join("\n"),
      "utf8"
    );
    const candidate = {
      id: "mc_1",
      title: "Memoria escrita sem anchor",
      source: "gold_mining" as const,
      scope: "projeto" as const,
      layer: "L2" as const,
      has_l1: true,
      score: { reaproveitamento: 2, evidencia: 2, custo_esquecimento: 1, transferibilidade: 1, total: 6 },
      confidence: "media" as const,
      l1_gatilho: "[PPIRTV-MEMORY-MINING-VALIDA-POS-WRITE] Memoria escrita sem anchor.",
      l2_bloco: "## Memoria escrita sem anchor\nProblema: falta anchor",
      target_files: [l1Path, l2Path],
      blocked: false,
      blocked_reason: null
    };
    const validation = await validateMemoryPostWrite({
      written: [{ candidate_id: candidate.id, files: [l1Path, l2Path] }],
      candidates: [candidate],
      validatedAt: new Date().toISOString()
    });

    expect(validation).toMatchObject({
      status: "failed",
      validator: "consciencia-memorias-post-write",
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "l2-heading-missing-anchor", file: l2Path }),
        expect.objectContaining({ code: "l1-missing-obsidian-block-link", file: l1Path })
      ]),
      parking_lot: expect.arrayContaining([
        expect.stringContaining("Achado pos-write memoria estacionado: l2-heading-missing-anchor"),
        expect.stringContaining("Quando: corrigir links/anchors L1<->L2/L3")
      ])
    });

    const flow = await engine.store.loadFlow(flowId);
    flow.gold_mining.push("PPIRTV-MEMORY-MINING-VALIDA-POS-WRITE precisa bloquear falso verde.");
    flow.memory_mining = {
      required: true,
      last_run_at: new Date().toISOString(),
      write_policy: "auto_write",
      blocked_verdict: true,
      candidates_count: 1,
      written_count: 1,
      blocked_count: 0,
      ledger_only_count: 0,
      discarded_count: 0,
      memory_required_but_empty: false,
      candidates: [{ id: candidate.id, title: candidate.title, score: candidate.score, scope: candidate.scope }],
      written: [{ candidate_id: candidate.id, files: [l1Path, l2Path] }],
      write_decisions: [{ candidate_id: candidate.id, action: "written", reason: "written_by_auto_write_policy" }],
      edit_queue: [],
      destination_warnings: validation.findings.map((finding) => `post_write_validation:${finding.code}:${finding.file}`),
      strong_unwritten_count: 0,
      memory_written: true,
      memory_validated: false,
      memory_consolidated: false,
      memory_review_status: "failed_post_write_validation",
      memory_post_write_validation: validation
    };
    await engine.store.saveFlow(flow);

    const status = await engine.goalStatus({ flow_id: flowId });
    const diagnostics = status.blocker_diagnostics as Record<string, unknown>;
    const memoryRequired = diagnostics.memory_required as Record<string, unknown>;
    const checkout = status.ppirtv_checkout as Record<string, unknown>;
    const memoryAccountability = checkout.memory_accountability as Record<string, unknown>;

    expect(diagnostics.effective_blockers).toEqual(expect.arrayContaining(["memory_required_but_empty", "memory_mining_blocked_verdict"]));
    expect(memoryRequired).toMatchObject({
      memory_written: true,
      memory_validated: false,
      memory_consolidated: false,
      memory_review_status: "failed_post_write_validation"
    });
    expect(memoryAccountability).toMatchObject({
      memory_written: true,
      memory_validated: false,
      memory_consolidated: false,
      memory_review_status: "failed_post_write_validation"
    });
    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Memoria escrita sem anchor nao pode sustentar consolidacao.",
        evidence_ids: [evidenceId],
        residual_risks: ["validacao pos-write falhou"],
        next_step: "revisar com consciencia-memorias quando os findings forem corrigidos"
      })
    ).rejects.toThrow(/memory_required_but_empty|MEMORY_MINING_BLOCKED_VERDICT/i);
  });

  it("blocks written memory from being treated as consolidated when touched L2 anchors or block ids are duplicated", async () => {
    const workspace = path.join(tempRoot, "duplicate-post-write-memory");
    const l1Path = path.join(workspace, "LEMBRANCA.md");
    const l2Path = path.join(workspace, "MEMORIA.md");
    const l3Dir = path.join(workspace, "conhecimento");
    const candidateTitle = "Memoria pos-write com anchor duplicada";
    const anchor = memoryAnchor(candidateTitle);
    const l3Path = path.join(l3Dir, `${anchor}.md`);
    const localizer = "PPIRTV-MEMORY-MINING-VALIDA-POS-WRITE";
    await mkdir(l3Dir, { recursive: true });
    await writeFile(
      l1Path,
      [
        `- [${localizer}] ${candidateTitle}. Tags: ${AUTO_WRITE_REVIEW_TAGS.join(" ")} ${AUTO_WRITE_REVIEW_MARKER}`,
        `  L2: [${candidateTitle}](MEMORIA.md#${anchor}) / [[MEMORIA#^${anchor}|memoria]] ^${anchor}`
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      l2Path,
      [
        `## ${candidateTitle} {#${anchor}}`,
        `^${anchor}`,
        `Localizador: \`${localizer}\``,
        `Tags: ${AUTO_WRITE_REVIEW_TAGS.join(" ")}`,
        `Aliases: ${candidateTitle}, ${AUTO_WRITE_REVIEW_MARKER}`,
        `Obsidian: L1 [[LEMBRANCA#^${anchor}|${localizer}]]`,
        `L3 relacionada: [conhecimento/${anchor}.md](conhecimento/${anchor}.md)`,
        `Obsidian: L3 [[${anchor}#^${anchor}|conhecimento]]`,
        "OrigemAuto: mm_memory_mining",
        "ReviewStatus: pending_consciencia_memorias",
        `ReviewMarker: \`${AUTO_WRITE_REVIEW_MARKER}\``,
        "",
        `## ${candidateTitle} duplicada {#${anchor}}`,
        `^${anchor}`,
        "Duplicidade reconstruida a partir do backup PPIRTV-MEMORY-MINING-VALIDA-POS-WRITE."
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      l3Path,
      [`# ${candidateTitle}`, "", `Volta L2: [${candidateTitle}](../MEMORIA.md#${anchor}) / [[MEMORIA#^${anchor}|memoria]]`].join("\n"),
      "utf8"
    );
    const candidate = {
      id: "mc_duplicate",
      title: candidateTitle,
      source: "gold_mining" as const,
      scope: "projeto" as const,
      layer: "L2" as const,
      has_l1: true,
      score: { reaproveitamento: 2, evidencia: 2, custo_esquecimento: 1, transferibilidade: 1, total: 6 },
      confidence: "media" as const,
      l1_gatilho: `[${localizer}] ${candidateTitle}.`,
      l2_bloco: `## ${candidateTitle}\nProblema: duplicidade`,
      target_files: [l1Path, l2Path, l3Path],
      blocked: false,
      blocked_reason: null
    };

    const validation = await validateMemoryPostWrite({
      written: [{ candidate_id: candidate.id, files: [l1Path, l2Path, l3Path] }],
      candidates: [candidate],
      validatedAt: new Date().toISOString()
    });

    expect(validation.status).toBe("failed");
    expect(validation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "l2-duplicate-heading-anchor", file: l2Path }),
        expect.objectContaining({ code: "l2-duplicate-block-id", file: l2Path })
      ])
    );
    expect(validation.parking_lot).toEqual(expect.arrayContaining([expect.stringContaining("l2-duplicate-heading-anchor")]));
  });

  it("gives auto_classify a real contract and keeps weak parking candidates out of memory", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const workspace = path.join(tempRoot, "workspace");
    const memRoot = path.join(tempRoot, "memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const flow = await engine.createFlow({
        goal: "Legacy parking sem evidencia",
        context: "ctx",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      });
      const meeting = await engine.openMeeting({ flow_id: flow.flow_id, type: "divergent", question: "O que ficou sem evidencia?" });
      await engine.recordMeeting({
        meeting_id: meeting.meeting_id,
        parking_lot: ["Quando contrato MCP falhar, validar gate antes do veredito."]
      });

      await expect(engine.mineMemory({ flow_id: flow.flow_id, auto_classify: false, write_policy: "auto_write" })).rejects.toThrow(
        /AUTO_CLASSIFY_DISABLED_AUTO_WRITE/
      );

      const skipped = await engine.mineMemory({ flow_id: flow.flow_id, auto_classify: false, write_policy: "classify_only" });
      expect(skipped).toMatchObject({ auto_classify: false, classification_skipped: true, candidates: [], written: [] });

      const mined = await engine.mineMemory({ flow_id: flow.flow_id });
      const candidates = mined.candidates as Array<Record<string, unknown>>;
      expect(candidates[0]).toMatchObject({
        source: "parking_lot",
        scope: "ledger_only",
        score: expect.objectContaining({ evidencia: 0 })
      });
      expect(mined.written).toEqual([]);
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("continues mm_memory_mining when one auto-write candidate fails and reports the failed candidate", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "partial-write-memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const flow = await engine.createFlow({
        goal: "Falha parcial de escrita de memoria",
        context: "ctx",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      });
      flow.gold_mining.push(
        "Ponto cego Delphi DUnitX standalone vs provider precisa virar memoria reutilizavel.",
        "Ponto cego PPIRTV goal_verdict com snapshot divergente precisa virar memoria reutilizavel."
      );
      await engine.store.saveFlow(flow);
      await mkdir(path.join(memRoot, "temas", "delphi", "LEMBRANCA.md"), { recursive: true });

      const mined = await engine.mineMemory({ flow_id: flow.flow_id, auto_classify: true, write_policy: "auto_write" });

      expect(mined.write_policy).toBe("auto_write");
      expect(mined.written).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidate_id: "mc_2",
            files: expect.arrayContaining([path.join(memRoot, "temas", "ppirtv", "LEMBRANCA.md")])
          })
        ])
      );
      expect(mined.write_failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidate_id: "mc_1",
            reason: expect.stringContaining("EISDIR")
          })
        ])
      );
      expect(mined.destination_warnings as string[]).toEqual(expect.arrayContaining([expect.stringContaining("write_failed:mc_1")]));
      expect(mined.blocked_verdict).toBe(true);
      expect(mined.write_failures_count).toBe(1);
      expect(mined.memory_consolidated).toBe(false);
      expect(mined.memory_review_status).toBe("pending_consciencia_memorias");
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("surfaces strong ledger-only memory candidates as effective blockers before retrying goal_verdict", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "strong-ledger-only-memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const { flowId, evidenceId } = await startGoalWithEvidence(
        "dex-code:test-strong-ledger-only-blocker",
        "Resolver mineracao de memoria com candidatos fortes sem destino"
      );
      const meeting = await engine.goalMeetingOpen({
        flow_id: flowId,
        type: "transversal",
        question: "Como resolver candidatos fortes sem destino?",
        participants_required: ["chato", "questionador", "reuniao", "validador-pronto"]
      });
      await engine.goalMeetingClose({
        flow_id: flowId,
        meeting_id: meeting.meeting_id as string,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "A memoria canonica escrita nao elimina candidatos fortes sem destino.",
        satisfies_blockers: ["required_cooperation"],
        findings: [
          "Quando contrato bloquear, validar gate antes do veredito positivo.",
          "Quando veredito falhar, registrar origem e procedimento antes de repetir."
        ],
        gold_mining: ["Ponto cego Delphi DUnitX standalone vs provider precisa virar memoria reutilizavel."]
      });

      const mined = await engine.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "auto_write" });
      const status = await engine.goalStatus({ flow_id: flowId });
      const diagnostics = status.blocker_diagnostics as Record<string, unknown>;
      const nextAction = status.next_required_action as Record<string, unknown>;

      expect(mined).toMatchObject({
        blocked_verdict: true,
        strong_unwritten_count: 2
      });
      expect((mined.written as unknown[]).length).toBeGreaterThan(0);
      expect(diagnostics.effective_blockers).toEqual(expect.arrayContaining(["memory_mining_blocked_verdict"]));
      expect(nextAction).toMatchObject({
        type: "resolve_memory_candidates",
        tool: "mm_memory_candidate_resolve",
        can_retry_verdict: false
      });
      expect(String(nextAction.reason)).toContain("strong_unwritten_count");
      await expect(
        engine.goalVerdict({
          flow_id: flowId,
          status: "pronto",
          rationale: "Memoria escrita parcialmente, mas ainda ha candidatos fortes sem destino.",
          evidence_ids: [evidenceId],
          meeting_id: meeting.meeting_id as string,
          residual_risks: [],
          next_step: "arquivar quando goal_status nao listar blockers"
        })
      ).rejects.toThrow(/MEMORY_MINING_BLOCKED_VERDICT.*mm_memory_candidate_resolve/i);
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("resolves strong ledger-only candidates with a traceable ledger-only decision before goal_verdict", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "resolved-ledger-only-memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const { flowId, evidenceId } = await startGoalWithEvidence(
        "dex-code:test-resolve-ledger-only-candidates",
        "Resolver candidatos fortes ledger-only com destino rastreavel"
      );
      const meeting = await engine.goalMeetingOpen({
        flow_id: flowId,
        type: "transversal",
        question: "Como registrar destino rastreavel para candidatos fortes?",
        participants_required: ["chato", "questionador", "reuniao", "validador-pronto"]
      });
      await engine.goalMeetingClose({
        flow_id: flowId,
        meeting_id: meeting.meeting_id as string,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "Ledger-only forte pode ser aceito apenas com regra explicita e auditavel.",
        satisfies_blockers: ["required_cooperation"],
        findings: [
          "Quando veredito falhar, registrar origem e procedimento antes de repetir.",
          "Quando candidato forte for apenas ledger, declarar se fica ledger-only nao bloqueante."
        ],
        gold_mining: ["Ponto cego Delphi DUnitX standalone vs provider precisa virar memoria reutilizavel."]
      });

      const mined = await engine.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "auto_write" });
      const candidateIds = (mined.destination_warnings as string[]).map((warning) => warning.split(":")[0]);

      expect(candidateIds).toHaveLength(2);
      await expect(
        engine.resolveMemoryCandidates({
          flow_id: flowId,
          candidate_ids: [candidateIds[0]],
          action: "park",
          rationale: "Estacionar precisa de quando para ser destino rastreavel."
        })
      ).rejects.toThrow(/when/);

      const resolved = await engine.resolveMemoryCandidates({
        flow_id: flowId,
        candidate_ids: candidateIds,
        action: "accept_ledger_only",
        rationale: "Candidatos fortes ficam no ledger como aprendizado local deste flow; nao viram memoria canonica porque faltou destino L1/L2 reutilizavel."
      });
      const resolvedMining = resolved.memory_mining as Record<string, unknown>;
      const status = await engine.goalStatus({ flow_id: flowId });
      const diagnostics = status.blocker_diagnostics as Record<string, unknown>;

      expect(resolvedMining).toMatchObject({
        blocked_verdict: false,
        strong_unwritten_count: 0,
        resolved_strong_unwritten_count: 2,
        resolved_candidate_ids: expect.arrayContaining(candidateIds)
      });
      expect(diagnostics.effective_blockers).not.toContain("memory_mining_blocked_verdict");
      expect(resolvedMining.write_decisions as Array<Record<string, unknown>>).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ candidate_id: candidateIds[0], action: "resolved_accept_ledger_only", editable: false }),
          expect.objectContaining({ candidate_id: candidateIds[1], action: "resolved_accept_ledger_only", editable: false })
        ])
      );

      const verdict = await engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Candidatos fortes receberam destino rastreavel antes do veredito.",
        evidence_ids: [evidenceId],
        meeting_id: meeting.meeting_id as string,
        residual_risks: ["ledger-only aceito como decisao local rastreavel"],
        next_step: "arquivar quando goal_status permanecer sem memory_mining_blocked_verdict"
      });
      expect(verdict.verdict).toMatchObject({ status: "pronto_com_ressalvas" });
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("covers the memory classification matrix without promoting parking-only leftovers", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace, "Matriz de classificacao");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Matriz de classificacao",
      idempotency_key: "dex-code:test-classification-matrix",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    });
    const flowId = started.flow_id as string;
    const opened = await engine.goalMeetingOpen({ flow_id: flowId, type: "divergent", question: "Como classificar achados?" });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
      decision: "Classificar achados de memoria sem usar atalho antigo.",
      satisfies_blockers: ["required_cooperation"],
      parking_lot: [
        "Ponto cego Delphi DUnitX standalone vs provider.",
        "Risco de regressao no contrato MCP.",
        "Quando validar GOAL, manter gate antes do veredito.",
        "Aprendizado reutilizavel em qualquer projeto sobre evidencia.",
        "Avaliar depois uma UI para memory mining.",
        "Descartar ruido de experimento local."
      ]
    });
    const syntheticTokenLikeValue = ["token", "REDACTED_VALUE_123456"].join("=");
    await engine.attachEvidence({
      flow_id: flowId,
      kind: "note",
      title: "segredo sintetico",
      gold_mining: [`${syntheticTokenLikeValue} deve bloquear memoria.`]
    });

    const status = await engine.goalStatus({ flow_id: flowId });
    const links = status.goal_learning_links as Array<Record<string, Record<string, unknown>>>;
    expect(links.map((link) => link.garimpo_vinculado.classificacao)).toEqual(
      expect.arrayContaining(["ponto_cego", "armadilha", "heuristica", "dica_de_ouro", "nao_promover"])
    );
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parking_item: "Aprendizado reutilizavel em qualquer projeto sobre evidencia.",
          garimpo_vinculado: expect.objectContaining({
            classificacao: "dica_de_ouro",
            simbolo: "💎",
            promovido_para_gold_mining: true
          })
        })
      ])
    );
    const mined = await engine.mineMemory({ flow_id: flowId, write_policy: "classify_only" });
    const candidates = mined.candidates as Array<Record<string, unknown>>;
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ theme: "delphi", scope: "tema" })]));
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ theme: "mcp", scope: "tema" })]));
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ scope: "descartar" })]));
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ blocked_reason: "secret_like_value_detected" })]));
  });

  it("raises fiscal blocking before a positive GOAL verdict when memory mining finds an invalid theme route", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const workspace = path.join(tempRoot, "workspace");
    process.env.DEX_MEMORIA_HOME = path.join(tempRoot, "memories");
    try {
      const sptPath = await writeFakeSpt(workspace, "Bloquear tema invalido");
      const started = await engine.startGoal({
        workspace,
        spt_path: sptPath,
        objective: "Bloquear tema invalido",
        idempotency_key: "dex-code:test-mm-memory-blocked",
        evidence_required: true,
        required_evidence: ["npm run check"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      });
      const flowId = started.flow_id as string;
      await engine.attachEvidence({
        flow_id: flowId,
        kind: "note",
        title: "pepita invalida",
        gold_mining: ["pythia-deepseek deve ser corrigido para tema deepseek antes de gravar memoria."]
      });
      const evidence = await engine.addGoalEvidence({
        flow_id: flowId,
        title: "vitest run",
        content: "pass",
        satisfies: ["npm run check"]
      });

      await expect(
        engine.goalVerdict({
          flow_id: flowId,
          status: "pronto",
          rationale: "Tem evidencia mas memoria esta bloqueada",
          evidence_ids: [evidence.evidence_id as string],
          residual_risks: [],
          next_step: "corrigir tema"
        })
      ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED.*memory_required_but_empty/i);
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("blocks live GOAL advance when the persisted gate is incomplete", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace);
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-live-goal-002",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full",
      risk_level: "mechanical"
    });
    const flowId = started.flow_id as string;
    await engine.goalAdvance({ flow_id: flowId });
    await engine.updateFlowFacts(flowId, { scope: { in: [], out: [] } });
    const blocked = await engine.goalAdvance({ flow_id: flowId });

    expect(blocked.advanced).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.missing).toEqual(["scope_in", "scope_out"]);
    const status = blocked.status_snapshot as Record<string, unknown>;
    expect(status.phase).toBe("planejamento");
    expect(status.blockers).toEqual(["scope_in", "scope_out"]);
  });

  it("diagnoses planning blockers separately from fiscal material blockers", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-blocker-diagnostics-planning", "Diagnosticar blocker de planejamento");
    await engine.goalAdvance({ flow_id: flowId });
    await engine.updateFlowFacts(flowId, { scope: { in: [], out: [] } });

    const status = await engine.goalStatus({ flow_id: flowId });
    const diagnostics = status.blocker_diagnostics as Record<string, unknown>;
    const checkout = await engine.goalCheckout({ flow_id: flowId });

    expect(status.phase).toBe("planejamento");
    expect(status.blockers).toEqual(["scope_in", "scope_out"]);
    expect(diagnostics).toMatchObject({
      policy: "phase_gate_requirements",
      fiscal_mode_active: false,
      gate_blockers: ["scope_in", "scope_out"],
      fiscal_blockers: [],
      persisted_fiscal_blockers: []
    });
    expect(diagnostics.blocker_families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blocker: "scope_in", family: "planning_requirement", source: ["phase_gate"] }),
        expect.objectContaining({ blocker: "scope_out", family: "planning_requirement", source: ["phase_gate"] })
      ])
    );
    expect((checkout.blocker_diagnostics as Record<string, unknown>).policy).toBe("phase_gate_requirements");
  });

  it("diagnoses fiscal material blockers without confusing them with planning gaps", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-blocker-diagnostics-fiscal", "Diagnosticar blocker fiscal");

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Risco material sem reuniao material registrada.",
        evidence_ids: [evidenceId],
        residual_risks: ["sem reuniao material"],
        next_step: "abrir reuniao material agora antes de novo veredito"
      })
    ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED.*required_cooperation/i);

    const status = await engine.goalStatus({ flow_id: flowId });
    const diagnostics = status.blocker_diagnostics as Record<string, unknown>;
    const checkout = await engine.goalCheckout({ flow_id: flowId });

    expect(status.blockers).toEqual(expect.arrayContaining(["required_cooperation"]));
    expect(diagnostics).toMatchObject({
      policy: "fiscal_material_policy",
      fiscal_mode_active: true,
      gate_blockers: [],
      fiscal_blockers: [],
      persisted_fiscal_blockers: ["required_cooperation"]
    });
    expect(diagnostics.blocker_families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blocker: "required_cooperation",
          family: "fiscal_cooperation",
          source: ["persisted_fiscal_block"]
        })
      ])
    );
    expect((checkout.blocker_diagnostics as Record<string, unknown>).policy).toBe("fiscal_material_policy");
  });

  it("phase gate allows full thoughts advance while closure blockers stay visible", async () => {
    const { flowId } = await startGoalWithEvidence(
      "dex-code:test-phase-gate-full-closure-blockers",
      "Corrigir codigo com review material e memoria recuperavel"
    );
    await engine.updateFlowFacts(flowId, {
      risks: ["sem memoria L1/L2 gerada pelo motor"],
      changed_files: ["src/flow-engine.ts"]
    });

    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    const preflight = await engine.goalGatePreflight({ flow_id: flowId, phase: "pensamentos" });
    const advanced = await engine.goalAdvance({ flow_id: flowId, detail: "full" });

    expect(status).toMatchObject({
      phase: "pensamentos",
      phase_blockers: [],
      phase_advance_allowed: true,
      next_step: "advance_to_planejamento"
    });
    expect(status.closure_blockers).toEqual(expect.arrayContaining(["memory_required_but_empty", "review_required"]));
    expect(status.blockers).toEqual(expect.arrayContaining(["memory_required_but_empty", "review_required"]));
    const fullCheckout = await engine.goalCheckout({ flow_id: flowId, detail: "full" });
    const leanCheckout = await engine.goalCheckout({ flow_id: flowId, detail: "lean" });
    expect(fullCheckout).toMatchObject({
      phase_blockers: [],
      phase_advance_allowed: true
    });
    expect(fullCheckout.closure_blockers).toEqual(expect.arrayContaining(["memory_required_but_empty", "review_required"]));
    expect(leanCheckout).toMatchObject({
      phase_blockers: [],
      phase_advance_allowed: true
    });
    expect(leanCheckout.closure_blockers).toEqual(expect.arrayContaining(["memory_required_but_empty", "review_required"]));
    expect(preflight).toMatchObject({
      status: "passed",
      missing: [],
      phase_advance_allowed: true
    });
    expect(preflight.closure_blockers).toEqual(expect.arrayContaining(["memory_required_but_empty", "review_required"]));
    expect(advanced).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });
  });

  it("phase gate allows compact conception advance while closure blockers stay visible", async () => {
    const workspace = path.join(tempRoot, "phase-gate-compact-closure-blockers");
    const objective = "Corrigir codigo compacto com review e memoria";
    const sptPath = await writeFakeSpt(workspace, objective);
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective,
      idempotency_key: "dex-code:test-phase-gate-compact-closure-blockers",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "compact"
    });
    const flowId = started.flow_id as string;
    await engine.updateFlowFacts(flowId, {
      risks: ["sem memoria L1/L2 gerada pelo motor"],
      changed_files: ["src/flow-engine.ts"]
    });

    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    const preflight = await engine.goalGatePreflight({ flow_id: flowId, phase: "concepcao" });
    const advanced = await engine.goalAdvance({ flow_id: flowId, detail: "compact" });

    expect(status).toMatchObject({
      phase: "concepcao",
      phase_blockers: [],
      phase_advance_allowed: true,
      next_step: "advance_to_implementacao"
    });
    expect(status.closure_blockers).toEqual(expect.arrayContaining(["memory_required_but_empty", "review_required"]));
    expect(status.status).toBe("blocked");
    expect(preflight).toMatchObject({ status: "passed", missing: [], phase_advance_allowed: true });
    expect(advanced).toMatchObject({
      advanced: true,
      from: "concepcao",
      phase: "implementacao",
      status: "blocked"
    });
  });

  it("terminal completion rejects a non-positive verdict even when validation fields pass", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-terminal-completion-non-positive",
      "Nao concluir GOAL com veredito negativo"
    );
    const flow = await engine.store.loadFlow(flowId);
    flow.goal_binding!.envelope.risk_level = "mechanical";
    await engine.store.saveFlow(flow);

    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: {
        diff_reviewed: true,
        barata_scan: true,
        regression_risks: ["falso complete"],
        review_findings: ["veredito negativo nao pode concluir o flow"]
      }
    });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { test_executed: true }
    });
    await engine.goalVerdict({
      flow_id: flowId,
      status: "nao_pronto",
      rationale: "O objetivo ainda nao foi atendido.",
      evidence_ids: [evidenceId],
      residual_risks: ["falso complete"],
      next_step: "corrigir agora antes de concluir"
    });

    const completion = await engine.goalAdvance({
      flow_id: flowId,
      provided: {
        residual_risks: ["falso complete"],
        next_step: "corrigir agora antes de concluir",
        memoria_viva_reconciled: true
      }
    });
    const fresh = await engine.store.loadFlow(flowId);
    const ledger = await engine.store.readLedger(flowId);
    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const status = await reloadedEngine.goalStatus({ flow_id: flowId, detail: "full" });
    const checkout = await reloadedEngine.goalCheckout({ flow_id: flowId, detail: "full" });
    const retry = await reloadedEngine.goalAdvance({ flow_id: flowId, detail: "compact" });

    expect(completion).toMatchObject({
      advanced: false,
      status: "blocked",
      phase: "validacao"
    });
    expect(completion.missing).toEqual(expect.arrayContaining(["goal_positive_verdict_required"]));
    expect(fresh.status).not.toBe("complete");
    expect(ledger.some((event) => event.type === "flow_completed")).toBe(false);
    expect(status.closure_blockers).toEqual(expect.arrayContaining(["goal_positive_verdict_required"]));
    expect(status.phase_advance_allowed).toBe(false);
    expect(checkout.closure_blockers).toEqual(expect.arrayContaining(["goal_positive_verdict_required"]));
    expect(status.loop_monitor).toMatchObject({
      count: 1,
      terminal_block_count: 1
    });
    expect(retry).toMatchObject({ advanced: false, status: "blocked" });
    expect(retry.remaining_blockers).toEqual(expect.arrayContaining(["goal_positive_verdict_required"]));
    const retriedLedger = await reloadedEngine.store.readLedger(flowId);
    expect(retriedLedger.some((event) => event.type === "flow_completed")).toBe(false);
    expect(retriedLedger.filter((event) => event.type === "goal_terminal_blocked")).toHaveLength(2);
    expect((await reloadedEngine.goalStatus({ flow_id: flowId })).loop_monitor).toMatchObject({
      count: 2,
      terminal_block_count: 2
    });
    await reloadedEngine.goalAdvance({ flow_id: flowId, detail: "compact" });
    expect((await reloadedEngine.goalStatus({ flow_id: flowId })).loop_monitor).toMatchObject({
      count: 3,
      terminal_block_count: 3,
      escalation: { active: true, level: "convergence_transversal", threshold: 3 }
    });
  });

  it("exposes and escalates terminal retries when no verdict exists", async () => {
    const { flowId } = await startGoalWithEvidence(
      "dex-code:test-terminal-completion-without-verdict",
      "Nao esconder retry terminal sem veredito"
    );
    const flow = await engine.store.loadFlow(flowId);
    flow.goal_binding!.envelope.risk_level = "mechanical";
    await engine.store.saveFlow(flow);

    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["docs/contract.md"] }
    });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: {
        diff_reviewed: true,
        barata_scan: true,
        regression_risks: ["retry sem veredito"],
        review_findings: ["docs/contract.md revisado"]
      }
    });
    await engine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });

    const first = await engine.goalAdvance({
      flow_id: flowId,
      provided: { residual_risks: [], next_step: "registrar veredito agora", memoria_viva_reconciled: true }
    });
    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    await reloadedEngine.goalAdvance({ flow_id: flowId });
    await reloadedEngine.goalAdvance({ flow_id: flowId });
    const status = await reloadedEngine.goalStatus({ flow_id: flowId, detail: "full" });

    expect(first).toMatchObject({
      advanced: false,
      status: "blocked",
      missing: expect.arrayContaining(["verdict"])
    });
    expect(status).toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining(["verdict"]),
      closure_blockers: [],
      next_required_action: {
        type: "convergence_transversal_meetings",
        tool: "goal_meeting_open"
      },
      loop_monitor: {
        count: 3,
        gate_block_count: 3,
        terminal_block_count: 0,
        escalation: { active: true, level: "convergence_transversal", threshold: 3 }
      }
    });
  });

  it("rejects a review fingerprint when no structured review claim is declared", async () => {
    const { flowId } = await startGoalWithEvidence(
      "dex-code:test-review-fingerprint-without-claims",
      "Rejeitar fingerprint de review sem claims estruturados"
    );
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });
    const implementationFingerprint = await currentImplementationFingerprint(flowId);

    await expect(
      engine.addGoalEvidence({
        flow_id: flowId,
        kind: "code_review",
        title: "Review sem claims estruturados",
        reviewed_implementation_fingerprint: implementationFingerprint
      })
    ).rejects.toThrow(/REVIEW_ATTESTATION_CLAIMS_REQUIRED/);
    await expect(
      engine.addGoalEvidence({
        flow_id: flowId,
        kind: "goal_evidence",
        title: "Claims de review em evidencia de outro tipo",
        satisfies: ["diff_reviewed"],
        reviewed_implementation_fingerprint: implementationFingerprint
      })
    ).rejects.toThrow(/REVIEW_ATTESTATION_CLAIMS_REQUIRED/);
  });

  it("persists verdict review metadata so a positive official GOAL can complete", async () => {
    const idempotencyKey = "dex-code:test-terminal-review-from-verdict";
    const objective = "Corrigir codigo com review fornecido no veredito";
    const { flowId, evidenceId, workspace, sptPath } = await startGoalWithEvidence(idempotencyKey, objective);
    const terminalMeeting = await engine.goalMeetingOpen({
      flow_id: flowId,
      question: "Qual decisao deve ficar congelada no terminal?"
    });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: terminalMeeting.meeting_id as string,
      decision: "Congelar a proveniencia ao concluir",
      participants_present: [],
      findings: ["rotas tardias nao podem reescrever o ciclo"]
    });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    const review = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review estruturado do contrato terminal",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["review terminal"],
        findings: [],
        regression_risks: ["review precisa sobreviver ao reload"]
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const reloadedStatus = await reloadedEngine.goalStatus({ flow_id: flowId, detail: "full" });
    expect(reloadedStatus.closure_blockers).not.toContain("review_required");
    expect((await reloadedEngine.store.loadFlow(flowId)).implementation_fingerprint).toBe(
      await currentImplementationFingerprint(flowId)
    );
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });
    await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Codigo revisado e validado.",
      evidence_ids: [evidenceId, review.evidence_id],
      review_artifact_path: ".agents/REPORTS/review-terminal.md",
      review_findings: ["review material fornecido pelo contrato publico"],
      next_step: "encerrar agora"
    });

    const pendingStatus = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    const pendingCheckout = await engine.goalCheckout({ flow_id: flowId, detail: "full" });
    const pendingLedger = await engine.store.readLedger(flowId);
    expect(pendingStatus).toMatchObject({ phase: "validacao" });
    expect(pendingStatus.status).not.toBe("complete");
    expect(pendingCheckout).toMatchObject({ complete: false });
    expect(pendingLedger.some((event) => event.type === "flow_completed")).toBe(false);

    const completed = await engine.goalAdvance({
      flow_id: flowId,
      provided: { residual_risks: [], next_step: "encerrar agora", memoria_viva_reconciled: true }
    });

    expect(completed).toMatchObject({ advanced: true, from: "validacao", to: null, status: "complete" });
    expect((await engine.goalStatus({ flow_id: flowId, detail: "full" })).phase_advance_allowed).toBe(false);
    const completedFlow = await engine.store.loadFlow(flowId);
    expect(completedFlow.verdicts.at(-1)).toMatchObject({
      review_artifact_path: ".agents/REPORTS/review-terminal.md",
      review_findings: ["review material fornecido pelo contrato publico"],
      reviewed_implementation_fingerprint: completedFlow.implementation_fingerprint
    });
    expect(completedFlow.implementation_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    await writeFile(path.join(workspace, "src", "flow-engine.ts"), "export const afterCompletion = true;\n", "utf8");
    const historicalStatus = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    expect(historicalStatus).toMatchObject({ status: "complete", closure_blockers: [] });
    expect((await engine.store.loadFlow(flowId)).implementation_fingerprint).toBe(completedFlow.implementation_fingerprint);
    await expect(
      engine.updateFlowFacts(flowId, { changed_files: ["src/new-after-completion.ts"] })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    const ledgerBeforeRejectedMutations = await engine.store.readLedger(flowId);
    await expect(
      engine.goalGateCheck({
        flow_id: flowId,
        phase: "implementacao",
        persist: true,
        provided: { implementation_done: true, changed_files: ["src/new-after-completion.ts"] }
      })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.addGoalEvidence({
        flow_id: flowId,
        kind: "note",
        title: "Tentativa posterior",
        content: "nao deve entrar"
      })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.goalRegress({
        flow_id: flowId,
        to: "revisao",
        reason: "nao pode reabrir ciclo concluido"
      })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "nao_pronto",
        rationale: "nao pode reescrever veredito terminal",
        evidence_ids: [evidenceId, review.evidence_id],
        next_step: "abrir outro ciclo"
      })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.resumeGoal({ flow_id: flowId, note: "nao pode tocar ciclo terminal" })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.recordGoalProgress({
        flow_id: flowId,
        event_key: "post-terminal-progress",
        source: "test",
        operation: "late-work",
        stage: "done",
        current: 1,
        total: 1,
        status: "completed"
      })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.goalMeetingOpen({ flow_id: flowId, question: "reabrir decisao concluida?" })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.addMeetingTurn({ meeting_id: terminalMeeting.meeting_id as string, note: "turno tardio" })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.recordMeeting({ meeting_id: terminalMeeting.meeting_id as string, decision: "reescrever decisao" })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.closeMeeting({ meeting_id: terminalMeeting.meeting_id as string, decision: "reescrever decisao" })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.mineMemory({ flow_id: flowId, write_policy: "classify_only" })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await expect(
      engine.resolveMemoryCandidates({
        flow_id: flowId,
        candidate_ids: ["candidate-after-terminal"],
        action: "discard",
        rationale: "nao pode alterar memoria terminal"
      })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
    await engine.hygieneScan(flowId);
    const reusedTerminal = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective,
      idempotency_key: idempotencyKey,
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    });
    expect(reusedTerminal).toMatchObject({ reused: true, started: false, status: "complete" });
    const flowAfterRejectedMutations = await engine.store.loadFlow(flowId);
    expect(flowAfterRejectedMutations).toMatchObject({
      status: "complete",
      changed_files: completedFlow.changed_files,
      evidence: completedFlow.evidence,
      verdicts: completedFlow.verdicts,
      implementation_fingerprint: completedFlow.implementation_fingerprint
    });
    expect(await engine.store.readLedger(flowId)).toEqual(ledgerBeforeRejectedMutations);
    const archived = await engine.archiveFlow({ flow_id: flowId, reason: "encerramento administrativo" });
    const ledgerAfterArchive = await engine.store.readLedger(flowId);
    const archiveRetry = await engine.archiveFlow({ flow_id: flowId, reason: "retry identico" });
    expect(archiveRetry.archived_at).toBe(archived.archived_at);
    expect(await engine.store.readLedger(flowId)).toEqual(ledgerAfterArchive);
    await expect(
      engine.addMeetingTurn({ meeting_id: terminalMeeting.meeting_id as string, note: "turno depois do archive" })
    ).rejects.toThrow("FLOW_IMMUTABLE_AFTER_COMPLETION");
  });

  it("does not let verdict text self-declare the required code review", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-terminal-review-text-is-metadata",
      "Impedir texto livre de autodeclarar review"
    );
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: {
        diff_reviewed: true,
        barata_scan: true,
        regression_risks: ["texto livre nao prova revisao"],
        review_findings: ["eu mesmo declaro que revisei"]
      }
    });
    await engine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });

    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Metadados textuais foram fornecidos sem evidencia estruturada.",
      evidence_ids: [evidenceId],
      review_artifact_path: ".agents/REPORTS/autodeclarado.md",
      review_findings: ["eu mesmo declaro que revisei"],
      next_step: "encerrar agora"
    })).rejects.toThrow(/review_required/);
  });

  it("rejects review evidence when the reviewer cites a snapshot older than the current bytes", async () => {
    const { flowId, workspace } = await startGoalWithEvidence(
      "dex-code:test-review-observed-fingerprint-mismatch",
      "Vincular a atestacao ao snapshot realmente observado"
    );
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    const observedFingerprint = await currentImplementationFingerprint(flowId);
    await writeFile(path.join(workspace, "src", "flow-engine.ts"), "export const changedAfterReview = true;\n", "utf8");

    await expect(engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Atestacao de snapshot anterior",
      reviewed_implementation_fingerprint: observedFingerprint,
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["snapshot anterior"],
        findings: [],
        regression_risks: []
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    })).rejects.toThrow("REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH");
  });

  it("attests an explicit deletion but rejects an undeclared missing changed file", async () => {
    const { flowId, workspace } = await startGoalWithEvidence(
      "dex-code:test-review-explicit-deletion",
      "Distinguir delecao intencional de arquivo ausente por engano"
    );
    const deletedPath = path.join(workspace, "src", "flow-engine.ts");
    await rm(deletedPath);
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: {
        implementation_done: true,
        changed_files: ["src/flow-engine.ts"],
        deleted_files: ["src/flow-engine.ts"]
      }
    });
    await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review da delecao explicita",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["consumidores do arquivo removido"],
        findings: [],
        regression_risks: ["import residual"]
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    expect((await engine.goalStatus({ flow_id: flowId, detail: "full" })).closure_blockers).not.toContain("review_required");

    await writeFile(deletedPath, "export const restored = true;\n", "utf8");
    await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      persist: true,
      provided: {
        implementation_done: true,
        changed_files: ["src/flow-engine.ts"],
        deleted_files: []
      }
    });
    const restoredFlow = await engine.store.loadFlow(flowId);
    expect(restoredFlow.deleted_files).toEqual([]);
    expect(restoredFlow.implementation_fingerprint).toBe(
      await fingerprintReviewedImplementation(workspace, ["src/flow-engine.ts"], process.platform)
    );

    await expect(
      engine.updateFlowFacts(flowId, { deleted_files: ["src/not-in-changed-files.ts"] })
    ).rejects.toThrow("DELETED_FILES_NOT_CHANGED");
  });

  it("invalidates a structured review when the same changed file gets new content", async () => {
    const { flowId, evidenceId, workspace } = await startGoalWithEvidence(
      "dex-code:test-terminal-review-stale-same-path-content",
      "Invalidar review depois de reimplementacao no mesmo caminho"
    );
    const changedFile = path.join(workspace, "src", "flow-engine.ts");
    await mkdir(path.dirname(changedFile), { recursive: true });
    await writeFile(changedFile, "export const revision = 1;\n", "utf8");
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    const review = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review estruturado da revisao 1",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["revision"],
        findings: [],
        regression_risks: []
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });
    await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Revisao 1 comprovada.",
      evidence_ids: [evidenceId, review.evidence_id],
      next_step: "encerrar agora"
    });

    await writeFile(changedFile, "export const revision = 2;\n", "utf8");

    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    const completion = await engine.goalAdvance({
      flow_id: flowId,
      provided: { residual_risks: [], next_step: "encerrar agora", memoria_viva_reconciled: true }
    });

    expect(status.closure_blockers).toContain("review_required");
    expect(completion).toMatchObject({ advanced: false, status: "blocked" });
    expect(completion.missing).toContain("review_required");
  });

  it("invalidates review when changed_files becomes empty instead of preserving the old fingerprint", async () => {
    const { flowId } = await startGoalWithEvidence(
      "dex-code:test-review-invalidated-empty-changed-files",
      "Esvaziar changed_files nao preserva review antigo"
    );
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    const review = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review antes de esvaziar changed_files",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["changed_files vazio"],
        findings: [],
        regression_risks: []
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    const reviewedFingerprint = await currentImplementationFingerprint(flowId);

    await engine.updateFlowFacts(flowId, { changed_files: [] });
    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });

    expect(status.implementation_fingerprint).not.toBe(reviewedFingerprint);
    expect(status.closure_blockers).toContain("review_required");
  });

  it("requires the positive verdict to cite the review evidence that grants fingerprint credit", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-verdict-cites-review-evidence",
      "Vincular veredito ao evidence_id de review"
    );
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    const review = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review corrente nao citado",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["evidence_ids"],
        findings: [],
        regression_risks: []
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });

    await expect(engine.recordVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Rota legada nao pode contornar o fiscal do GOAL.",
      evidence_ids: [evidenceId, review.evidence_id],
      next_step: "usar goal_verdict"
    })).rejects.toThrow("OFFICIAL_GOAL_REQUIRES_GOAL_VERDICT");

    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Review existe no flow, mas nao foi citado.",
      evidence_ids: [evidenceId],
      next_step: "citar review"
    })).rejects.toThrow(/review_required/);

    await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Primeiro veredito cita a review corrente.",
      evidence_ids: [evidenceId, review.evidence_id],
      next_step: "tentar novo veredito"
    });
    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Segundo veredito tenta herdar review anterior.",
      evidence_ids: [evidenceId],
      next_step: "deve continuar bloqueado"
    })).rejects.toThrow(/review_required/);
  });

  it("keeps a pre-upgrade review without a fingerprint fail-closed", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-terminal-review-pre-upgrade",
      "Preservar review legitimo criado antes do snapshot versionado"
    );
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src\\flow-engine.ts"] }
    });
    const review = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review estruturado anterior ao upgrade",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
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
    await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Review anterior ao campo de snapshot.",
      evidence_ids: [evidenceId, review.evidence_id],
      review_artifact_path: ".agents/REPORTS/review-pre-upgrade.md",
      review_findings: ["SRC/flow-engine.ts foi revisado"],
      next_step: "encerrar agora"
    });

    const legacyFlow = await engine.store.loadFlow(flowId);
    delete legacyFlow.verdicts.at(-1)?.reviewed_changed_files;
    delete legacyFlow.verdicts.at(-1)?.reviewed_implementation_fingerprint;
    delete legacyFlow.evidence.find((item) => item.evidence_id === review.evidence_id)?.reviewed_implementation_fingerprint;
    const legacyHistoryVerdict = legacyFlow.history.findLast((event) => event.type === "verdict_recorded");
    delete legacyHistoryVerdict?.data.reviewed_changed_files;
    delete legacyHistoryVerdict?.data.reviewed_implementation_fingerprint;
    await engine.store.saveFlow(legacyFlow);

    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const status = await reloadedEngine.goalStatus({ flow_id: flowId, detail: "full" });
    const completed = await reloadedEngine.goalAdvance({
      flow_id: flowId,
      provided: { residual_risks: [], next_step: "encerrar agora", memoria_viva_reconciled: true }
    });

    expect(status.closure_blockers).toContain("review_required");
    expect(completed).toMatchObject({ advanced: false, status: "blocked" });
  });

  it("invalidates persisted review evidence when changed files change after the verdict", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-terminal-review-stale-after-change",
      "Impedir review antigo de liberar alteracao posterior"
    );
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    const review = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review estruturado original",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/flow-engine.ts"],
        barata_scan: true,
        searched_patterns: ["review stale"],
        findings: [],
        regression_risks: ["review stale"]
      },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });
    await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Alteracao original revisada.",
      evidence_ids: [evidenceId, review.evidence_id],
      review_artifact_path: ".agents/REPORTS/review-original.md",
      review_findings: ["src/flow-engine.ts foi revisado"],
      next_step: "encerrar agora"
    });

    await engine.updateFlowFacts(flowId, { changed_files: ["SRC\\flow-engine.ts"] });
    await engine.updateFlowFacts(flowId, { changed_files: ["src/server.ts"] });

    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    const completion = await engine.goalAdvance({
      flow_id: flowId,
      provided: { residual_risks: [], next_step: "encerrar agora", memoria_viva_reconciled: true }
    });
    const latestVerdict = (await engine.store.loadFlow(flowId)).verdicts.at(-1);

    expect(latestVerdict?.reviewed_changed_files).toEqual(["src/flow-engine.ts"]);
    expect(status.closure_blockers).toContain("review_required");
    expect(completion).toMatchObject({ advanced: false, status: "blocked" });
    expect(completion.missing).toContain("review_required");
  });

  it("serializes and reuses terminal completion without duplicating hooks or ledger events", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-terminal-idempotent-concurrent",
      "Concluir GOAL oficial uma unica vez"
    );
    const flow = await engine.store.loadFlow(flowId);
    flow.goal_binding!.envelope.risk_level = "mechanical";
    await engine.store.saveFlow(flow);
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["docs/contract.md"] }
    });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: {
        diff_reviewed: true,
        barata_scan: true,
        regression_risks: ["retry terminal"],
        review_findings: ["mudanca mecanica revisada"]
      }
    });
    await engine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });
    await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "GOAL mecanico validado.",
      evidence_ids: [evidenceId],
      next_step: "encerrar agora"
    });

    const results = await Promise.all([
      engine.goalAdvance({
        flow_id: flowId,
        provided: { residual_risks: [], next_step: "encerrar agora", memoria_viva_reconciled: true }
      }),
      engine.goalAdvance({
        flow_id: flowId,
        provided: { residual_risks: [], next_step: "encerrar agora", memoria_viva_reconciled: true }
      })
    ]);
    const retried = await engine.goalAdvance({ flow_id: flowId, detail: "full" });
    const ledger = await engine.store.readLedger(flowId);

    expect(results.filter((result) => result.advanced === true)).toHaveLength(1);
    expect(results.some((result) => result.reused === true)).toBe(true);
    expect(retried).toMatchObject({ advanced: false, reused: true, status: "complete" });
    expect(ledger.filter((event) => event.type === "flow_completed")).toHaveLength(1);
  });

  it("flow completed recovery appends one explicit recovery without rerunning terminal hooks or rewriting state", async () => {
    const faultStore = new LedgerFaultStore(tempRoot, "flow_completed", "before");
    const hookCounter = countingMemoryHooks();
    const faultEngine = new FlowEngine(faultStore, hookCounter.runner);
    const flowId = await prepareCompletableMechanicalGoal(
      faultEngine,
      "dex-code:test-flow-completed-recovery-before-ledger",
      "Recuperar ledger de conclusao sem repetir terminal"
    );

    await expect(
      faultEngine.goalAdvance({
        flow_id: flowId,
        evidence_ids: ["ev_terminal_recovery"],
        provided: { residual_risks: [], next_step: "encerrar agora", memoria_viva_reconciled: true }
      })
    ).rejects.toThrow(/LEDGER_FAULT_BEFORE_APPEND/);
    const hooksAfterFailedCompletion = hookCounter.afterPhaseCalls();
    const persistedBeforeRetry = await readFile(faultStore.flowPath(flowId), "utf8");
    const reloadedEngineA = new FlowEngine(
      new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }),
      hookCounter.runner
    );
    const reloadedEngineB = new FlowEngine(
      new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }),
      hookCounter.runner
    );
    const retries = await Promise.all([
      reloadedEngineA.goalAdvance({ flow_id: flowId, detail: "full" }),
      reloadedEngineB.goalAdvance({ flow_id: flowId, detail: "full" })
    ]);
    const retried = retries[0];
    const persistedAfterRetry = await readFile(faultStore.flowPath(flowId), "utf8");
    const ledger = await faultStore.readLedger(flowId);
    const completedHistory = (await faultStore.loadFlow(flowId)).history.find((event) => event.type === "flow_completed");

    expect(retried).toMatchObject({ advanced: false, reused: true, status: "complete" });
    expect(hookCounter.afterPhaseCalls()).toBe(hooksAfterFailedCompletion);
    expect(persistedAfterRetry).toBe(persistedBeforeRetry);
    expect(ledger.filter((event) => event.type === "flow_completed")).toHaveLength(0);
    expect(ledger.filter((event) => event.type === "flow_completed_recovered")).toHaveLength(1);
    expect(ledger.find((event) => event.type === "flow_completed_recovered")?.data).toMatchObject({
      original_event_type: "flow_completed",
      original_at: completedHistory?.at,
      recovery_reason: "state_persisted_ledger_missing",
      evidence_ids: ["ev_terminal_recovery"]
    });
  });

  it("archive reconciles an earlier missing flow_completed event before making the flow terminally archived", async () => {
    const faultStore = new LedgerFaultStore(tempRoot, "flow_completed", "before");
    const faultEngine = new FlowEngine(faultStore);
    const flowId = await prepareCompletableMechanicalGoal(
      faultEngine,
      "dex-code:test-archive-recovers-prior-completion",
      "Arquivar sem perder a proveniencia da conclusao"
    );

    await expect(
      faultEngine.goalAdvance({
        flow_id: flowId,
        evidence_ids: ["ev_before_archive"],
        provided: { residual_risks: [], next_step: "arquivar depois", memoria_viva_reconciled: true }
      })
    ).rejects.toThrow(/LEDGER_FAULT_BEFORE_APPEND/);

    await faultEngine.archiveFlow({ flow_id: flowId, reason: "archive after completion transport failure" });
    await faultEngine.archiveFlow({ flow_id: flowId, reason: "idempotent archive retry" });
    const ledger = await faultStore.readLedger(flowId);

    expect(ledger.filter((event) => event.type === "flow_completed")).toHaveLength(0);
    expect(ledger.filter((event) => event.type === "flow_completed_recovered")).toHaveLength(1);
    expect(ledger.find((event) => event.type === "flow_completed_recovered")?.data).toMatchObject({
      original_event_type: "flow_completed",
      evidence_ids: ["ev_before_archive"]
    });
    expect(ledger.filter((event) => event.type === "flow_archived")).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "flow_archived_recovered")).toHaveLength(0);
  });

  it("flow completed recovery preserves one original and zero recovery events after append-then-throw", async () => {
    const faultStore = new LedgerFaultStore(tempRoot, "flow_completed", "after");
    const faultEngine = new FlowEngine(faultStore);
    const flowId = await prepareCompletableMechanicalGoal(
      faultEngine,
      "dex-code:test-flow-completed-recovery-after-ledger",
      "Preservar append terminal confirmado apos falha de retorno"
    );

    await expect(
      faultEngine.goalAdvance({
        flow_id: flowId,
        provided: { residual_risks: [], next_step: "encerrar agora", memoria_viva_reconciled: true }
      })
    ).rejects.toThrow(/LEDGER_FAULT_AFTER_APPEND/);
    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    await reloadedEngine.goalAdvance({ flow_id: flowId, detail: "full" });
    const ledger = await faultStore.readLedger(flowId);

    expect(ledger.filter((event) => event.type === "flow_completed")).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "flow_completed_recovered")).toHaveLength(0);
  });

  it("flow archived recovery appends one explicit recovery without rewriting archived state", async () => {
    const faultStore = new LedgerFaultStore(tempRoot, "flow_archived", "before");
    const faultEngine = new FlowEngine(faultStore);
    const flow = await faultEngine.createFlow({ goal: "Recuperar ledger de archive" });

    await expect(
      faultEngine.archiveFlow({ flow_id: flow.flow_id, reason: "archive causal" })
    ).rejects.toThrow(/LEDGER_FAULT_BEFORE_APPEND/);
    const persistedBeforeRetry = await readFile(faultStore.flowPath(flow.flow_id), "utf8");
    const reloadedEngineA = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const reloadedEngineB = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const retries = await Promise.all([
      reloadedEngineA.archiveFlow({ flow_id: flow.flow_id, reason: "retry A" }),
      reloadedEngineB.archiveFlow({ flow_id: flow.flow_id, reason: "retry B" })
    ]);
    const retried = retries[0];
    const persistedAfterRetry = await readFile(faultStore.flowPath(flow.flow_id), "utf8");
    const ledger = await faultStore.readLedger(flow.flow_id);
    const archivedHistory = (await faultStore.loadFlow(flow.flow_id)).history.find((event) => event.type === "flow_archived");

    expect(retried.status).toBe("archived");
    expect(persistedAfterRetry).toBe(persistedBeforeRetry);
    expect(ledger.filter((event) => event.type === "flow_archived")).toHaveLength(0);
    expect(ledger.filter((event) => event.type === "flow_archived_recovered")).toHaveLength(1);
    expect(ledger.find((event) => event.type === "flow_archived_recovered")?.data).toMatchObject({
      original_event_type: "flow_archived",
      original_at: archivedHistory?.at,
      recovery_reason: "state_persisted_ledger_missing"
    });
  });

  it("flow archived recovery preserves one original and zero recovery events after append-then-throw", async () => {
    const faultStore = new LedgerFaultStore(tempRoot, "flow_archived", "after");
    const faultEngine = new FlowEngine(faultStore);
    const flow = await faultEngine.createFlow({ goal: "Preservar append de archive" });

    await expect(
      faultEngine.archiveFlow({ flow_id: flow.flow_id, reason: "archive causal" })
    ).rejects.toThrow(/LEDGER_FAULT_AFTER_APPEND/);
    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    await reloadedEngine.archiveFlow({ flow_id: flow.flow_id, reason: "retry" });
    const ledger = await faultStore.readLedger(flow.flow_id);

    expect(ledger.filter((event) => event.type === "flow_archived")).toHaveLength(1);
    expect(ledger.filter((event) => event.type === "flow_archived_recovered")).toHaveLength(0);
  });

  it("renders a clean phase advance action without inventing closure debt", async () => {
    const { flowId } = await startGoalWithEvidence(
      "dex-code:test-phase-action-without-closure",
      "Executar fluxo sem divida fiscal futura"
    );

    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });

    expect(status.closure_blockers).toEqual([]);
    expect(status.phase_direct_action).toMatchObject({
      available: true,
      action: "Avanco de fase permitido para planejamento"
    });
  });

  it("phase gate reconciles a persisted fiscal blocker after reload", async () => {
    const { flowId } = await startGoalWithEvidence(
      "dex-code:test-phase-gate-stale-fiscal-reload",
      "Reconciliar blocker fiscal persistido sem prender Pensamentos"
    );
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });
    const flow = await engine.store.loadFlow(flowId);
    flow.status = "blocked";
    flow.gates.pensamentos = {
      phase: "pensamentos",
      status: "blocked",
      checked_at: new Date().toISOString(),
      provided: {},
      missing: ["review_required"],
      next: "complete_gate_pensamentos",
      back_to: null
    };
    await engine.store.saveFlow(flow);

    const reloadedEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }));
    const advanced = await reloadedEngine.goalAdvance({ flow_id: flowId, detail: "full" });
    const status = await reloadedEngine.goalStatus({ flow_id: flowId, detail: "full" });

    expect(advanced).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });
    expect(status.phase).toBe("planejamento");
    expect((status.phase_blockers as string[])).not.toContain("review_required");
    expect(status.closure_blockers).toEqual(expect.arrayContaining(["review_required"]));
  });

  it("blocks official GOAL completion when validation only has provided verdict text", async () => {
    const workspace = path.join(tempRoot, "validation-provided-verdict");
    const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "validation-provided-verdict.md");
    const flow = await engine.createFlow({
      goal: "Validacao com texto de veredito",
      context: "ctx",
      risks: ["baixo"],
      uncertainties: ["u"]
    });
    flow.goal_binding = {
      envelope: {
        workspace,
        spt_path: sptPath,
        objective: flow.goal,
        idempotency_key: "dex-code:test-validation-provided-verdict",
        evidence_required: true,
        required_evidence: ["npm run check"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      },
      started_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
    await engine.store.saveFlow(flow);
    const flowId = flow.flow_id;
    await mkdir(path.join(workspace, "docs"), { recursive: true });
    await writeFile(path.join(workspace, "docs", "status.md"), "validation status\n", "utf8");
    await engine.updateFlowFacts(flowId, {
      scope: { in: ["validar texto de veredito"], out: ["alterar contrato MCP publico"] },
      tasks: ["percorrer validacao"],
      expected_evidence: ["npm run check"],
      done_criteria: ["veredito canonico registrado antes de completar"],
      changed_files: ["docs/status.md"]
    });
    await engine.addGoalEvidence({
      flow_id: flowId,
      title: "npm run check",
      content: "pass",
      satisfies: ["npm run check"]
    });
    await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review do fluxo de validacao",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      content: "Review executado para isolar o requisito de veredito canonico.",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: { diff_reviewed: true, reviewed_targets: ["docs/status.md"], barata_scan: true, searched_patterns: ["verdict neighbors"], findings: [], regression_risks: ["falso pronto por texto livre"] },
      scope_classification: "target",
      scope_reference: "docs/status.md"
    });
    const meeting = await engine.goalMeetingOpen({
      flow_id: flowId,
      type: "convergent",
      question: "O veredito textual pode substituir evento canonico?",
      participants_required: ["Chato", "questionador", "reuniao", "validador-pronto"]
    });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: meeting.meeting_id as string,
      participants_present: ["Chato", "questionador", "reuniao", "validador-pronto"],
      decision: "Veredito textual nao substitui evento canonico.",
      satisfies_blockers: ["required_cooperation"]
    });

    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({ flow_id: flowId });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["docs/status.md"] }
    });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { diff_reviewed: true, barata_scan: true, regression_risks: ["provided verdict nao e evento canonico"] }
    });
    await engine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });

    const validationGate = await engine.goalGateCheck({
      flow_id: flowId,
      phase: "validacao",
      provided: {
        verdict: "pronto_com_ressalvas",
        residual_risks: ["veredito canonico pendente"],
        next_step: "chamar goal_verdict antes de completar",
        memoria_viva_reconciled: true
      }
    });
    const advanced = await engine.goalAdvance({ flow_id: flowId });
    const status = await engine.goalStatus({ flow_id: flowId });
    const ledger = await engine.store.readLedger(flowId);

    expect(validationGate.status).toBe("blocked");
    expect(validationGate.missing).toContain("verdict");
    expect(advanced).toMatchObject({ advanced: false, blocked: true, status: "blocked" });
    expect(status).toMatchObject({
      status: "blocked",
      phase: "validacao",
      current_verdict: null,
      next_required_action: {
        type: "goal_verdict_required",
        tool: "goal_verdict",
        can_retry_verdict: true
      }
    });
    expect(ledger.map((event) => event.type)).not.toContain("verdict_recorded");
    expect(ledger.map((event) => event.type)).not.toContain("flow_completed");
  });

  it("keeps goal_verdict_required after goal_advance on a stale validation gate", async () => {
    const workspace = path.join(tempRoot, "stale-validation-gate");
    const sptPath = path.join(workspace, ".agents", "PLAN-TASKS", "stale-validation-gate.md");
    const flow = await engine.createFlow({
      goal: "Stale validation gate",
      context: "ctx",
      risks: ["baixo"],
      uncertainties: ["u"]
    });
    flow.goal_binding = {
      envelope: {
        workspace,
        spt_path: sptPath,
        objective: flow.goal,
        idempotency_key: "dex-code:test-stale-validation-gate",
        evidence_required: true,
        required_evidence: ["npm run check"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      },
      started_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
    flow.phase = "validacao";
    flow.gates.validacao = {
      phase: "validacao",
      status: "passed",
      checked_at: new Date().toISOString(),
      provided: {
        verdict: "pronto_com_ressalvas",
        residual_risks: ["veredito canonico pendente"],
        next_step: "chamar goal_verdict antes de completar",
        memoria_viva_reconciled: true
      },
      missing: [],
      next: "advance_to_complete",
      back_to: null
    };
    await engine.store.saveFlow(flow);

    const before = await engine.goalStatus({ flow_id: flow.flow_id });
    const advanced = await engine.goalAdvance({ flow_id: flow.flow_id });
    const after = advanced.status_snapshot as Record<string, unknown>;
    const ledger = await engine.store.readLedger(flow.flow_id);

    expect(before).toMatchObject({
      phase: "validacao",
      current_verdict: null,
      next_required_action: {
        type: "goal_verdict_required",
        tool: "goal_verdict",
        can_retry_verdict: true
      }
    });
    expect(advanced).toMatchObject({ advanced: false, blocked: true, status: "blocked" });
    expect(after).toMatchObject({
      phase: "validacao",
      current_verdict: null,
      next_required_action: {
        type: "goal_verdict_required",
        tool: "goal_verdict",
        can_retry_verdict: true
      }
    });
    expect(ledger.map((event) => event.type)).not.toContain("verdict_recorded");
    expect(ledger.map((event) => event.type)).not.toContain("flow_completed");
  });

  it("reports actionable canonical SPT gaps", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const dir = path.join(workspace, ".agents", "PLAN-TASKS");
    await mkdir(dir, { recursive: true });
    const sptPath = path.join(dir, "2026-05-24-incomplete-spt.md");
    await writeFile(
      sptPath,
      [
        "# Trilho - Incompleto",
        "",
        "Tipo: SPEC-PLAN-TASKs",
        "Status: RASCUNHO",
        "Owner: Teste",
        "Data: 2026-05-24",
        "",
        "## SPEC",
        "",
        "Sem campos canonicos.",
        "",
        "## PLAN",
        "",
        "1. Fazer algo.",
        "",
        "## TASKs",
        "",
        "- [ ] Fazer algo.",
        "",
        "## Validacao",
        "",
        "- Fazer algo."
      ].join("\n"),
      "utf8"
    );

    const validation = await engine.validateSpt({ workspace, spt_path: sptPath });

    expect(validation.valid).toBe(false);
    expect(validation.contract_version).toBeNull();
    expect(validation.contract_errors).toContain("spt_v2.frontmatter: missing opening --- at the start of the file");
    expect(validation.missing).toEqual(expect.arrayContaining(["spt_v2.frontmatter", "spt_v2.schema"]));
    expect(validation.next_step).toContain("corrigir_spt");
  });

  it("rejects unsupported SPT versions without falling back to V1", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace, "Modo compact wire-up");
    const text = (await readFile(sptPath, "utf8")).replace("version: 2", "version: 1");
    await writeFile(sptPath, text, "utf8");

    const validation = await engine.validateSpt({ workspace, spt_path: sptPath });

    expect(validation.valid).toBe(false);
    expect(validation.contract_errors).toContain("spt_v2.version: unsupported explicit version 1; expected 2 or 3");
  });

  it("reports malformed SPT v2 YAML without inspecting the human body", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const dir = path.join(workspace, ".agents", "PLAN-TASKS");
    await mkdir(dir, { recursive: true });
    const sptPath = path.join(dir, "malformed-v2.md");
    await writeFile(sptPath, "---\ngoal: [broken\n---\n## TASKs\n- this body must not rescue the contract\n", "utf8");

    const validation = await engine.validateSpt({ workspace, spt_path: sptPath });

    expect(validation.valid).toBe(false);
    expect(validation.checks.spt_v2_yaml_valid).toBe(false);
    expect(validation.contract_errors[0]).toMatch(/^spt_v2\.yaml:/);
  });

  it("keeps SPT extraction stable when the human Markdown is rewritten", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const dir = path.join(workspace, ".agents", "PLAN-TASKS");
    await mkdir(dir, { recursive: true });
    const firstPath = path.join(dir, "body-a.md");
    const secondPath = path.join(dir, "body-b.md");
    await writeFile(firstPath, `\uFEFF${fakeSptText(workspace, undefined, "# Human notes\n\n## TASKs\n- misleading body task\n")}`, "utf8");
    await writeFile(secondPath, fakeSptText(workspace, undefined, "Texto livre sem qualquer heading canonico.\n"), "utf8");

    const first = await engine.validateSpt({ workspace, spt_path: firstPath });
    const second = await engine.validateSpt({ workspace, spt_path: secondPath });

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    expect(first.tasks).toEqual(second.tasks);
    expect(first.tasks).toEqual(["Rodar teste local."]);
    expect(first.tasks).not.toContain("misleading body task");
  });

  it("rejects positive GOAL verdicts without traceable evidence", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace, "Validar evidencia obrigatoria");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Validar evidencia obrigatoria",
      idempotency_key: "dex-code:test-goal-002",
      evidence_required: true,
      required_evidence: ["log de teste"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    });
    const flowId = started.flow_id as string;

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto",
        rationale: "Sem evidencia nao pode concluir",
        next_step: "anexar evidencia"
      })
    ).rejects.toThrow(/traceable evidence_ids/);

    const added = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "vitest run",
      content: "pass",
      satisfies: ["log de teste"]
    });
    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Teste executado com evidencia rastreavel",
      evidence_ids: [added.evidence_id as string],
      residual_risks: [],
      next_step: "arquivar"
    });

    expect((verdict.verdict as Record<string, unknown>).status).toBe("pronto");
  });

  it("T1 blocks material pronto_com_ressalvas without meeting, review, memory and visual librarian status", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-t1", "Provar ressalva material frouxa");

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "A propria ressalva confessa ausencia dos fiscais.",
        evidence_ids: [evidenceId],
        residual_risks: [
          "sem reuniao divergente/convergente/transversal",
          "sem revisor-codigo material",
          "sem memoria L1/L2 gerada pelo motor",
          "sem retorno visual Bibliotecario/Graphify",
          "hygiene_scan ainda nao consumido como bloqueador"
        ],
        next_step: "nao concluir; regressar para reuniao e review"
      })
    ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED.*required_cooperation.*memory_required_but_empty/i);

    const status = await engine.goalStatus({ flow_id: flowId });
    expect(status.status).not.toBe("complete");
    expect(status.required_cooperation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "chato", material: true }),
        expect.objectContaining({ name: "questionador", material: true }),
        expect.objectContaining({ name: "revisor-codigo", material: true }),
        expect.objectContaining({ name: "validador-pronto", material: true })
      ])
    );
  });

  it("T2 keeps principles blocked when memory is required but no L1/L2 was produced", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t2", "Memoria exigida no checklist");
    await engine.updateFlowFacts(flowId, { risks: ["memoria L1/L2 exigida para nao repetir erro"], tasks: ["promover aprendizado reutilizavel"] });

    const checklist = await engine.renderChecklist(flowId, "full");
    const memoryPrinciple = checklist.operational_principles.find((item) => item.id === "memoria_sem_lembranca");

    expect(memoryPrinciple?.checked).toBe(false);
    expect(checklist.display.checklist_visual).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: expect.stringContaining("L1/L2"), checked: false })])
    );
  });

  it("T3 consumes hygiene warning as a blocker before a positive verdict", async () => {
    const originalCwd = process.cwd();
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-t3", "Higiene bloqueia veredito");
    await writeFile(path.join(tempRoot, "README.md"), "Fixture com path fixo C:\\Users\\Someone\\repo para higiene.\n", "utf8");
    process.chdir(tempRoot);
    try {
      await engine.updateFlowFacts(flowId, { tasks: ["task sem evidencia material suficiente"] });
      const hygiene = await engine.hygieneScan(flowId);

      expect(hygiene.blocking_findings_count).toBeGreaterThan(0);
      expect(hygiene.required_cooperation).toEqual([]);
      await expect(
        engine.goalVerdict({
          flow_id: flowId,
          status: "pronto",
          rationale: "Tentando concluir com hygiene warning pendente.",
          evidence_ids: [evidenceId],
          residual_risks: [],
          next_step: "arquivar"
        })
      ).rejects.toThrow(/hygiene_blocking/i);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("drops legacy persisted required_cooperation when the current flow has no meeting trigger", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-legacy-required-cooperation-drop", "Legacy COO nao ritualiza");
    const flow = await engine.store.loadFlow(flowId);
    flow.history.push({
      at: new Date().toISOString(),
      type: "fiscal_policy_blocked",
      data: {
        source: "legacy_pre_reuniao_sem_ritual",
        blocking_reasons: ["required_cooperation", "review_required"],
        required_cooperation: [{ name: "reuniao", reason: "legacy materialidade fiscal", material: true }]
      }
    });
    flow.updated_at = new Date().toISOString();
    await engine.store.saveFlow(flow);

    const status = await engine.goalStatus({ flow_id: flowId });

    expect(status.blockers).toContain("review_required");
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.required_cooperation).toEqual([]);
    expect(status.meeting_required).toBe(false);
  });

  it("does not convert regress limit into required_cooperation when direct blockers remain", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-regress-limit-no-ritual-coo", "Regress limit sem COO ritual");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Erro recorrente no review ainda sem evidencia.",
        evidence_ids: [evidenceId],
        residual_risks: ["erro recorrente sem review anexado"],
        next_step: "abrir decisao de limite agora",
        regress_count: 3
      })
    ).rejects.toThrow(/attempt_regress_count|review_required/i);

    const status = await engine.goalStatus({ flow_id: flowId });

    expect(status.regress_limit_reached).toBe(true);
    expect(status.blockers).toEqual(expect.arrayContaining(["review_required", "attempt_regress_count"]));
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.required_cooperation).toEqual([]);
    expect(status.next_required_action).toMatchObject({
      type: "open_decision_meeting",
      tool: "goal_meeting_open"
    });
  });

  it("T4 keeps memory_required_but_empty when mining has not run yet, and clears after classify_only with 0 strong unwritten", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t4", "Garimpo vazio apos classify_only libera verdict");
    await engine.updateFlowFacts(flowId, { risks: ["memoria L1/L2 obrigatoria para este risco material"] });

    // Antes de rodar a mineracao, o blocker de memoria vazia permanece.
    const statusBefore = await engine.goalStatus({ flow_id: flowId });
    expect(statusBefore.blockers as string[]).toContain("memory_required_but_empty");

    // BUG 1: classify_only executou, nao ha candidato nenhum e nenhum
    // strong_unwritten pendente. O blocker de "memoria vazia" deve sair.
    const mined = await engine.mineMemory({ flow_id: flowId, write_policy: "classify_only" });

    expect(mined.candidates).toEqual([]);
    expect(mined.strong_unwritten_count).toBe(0);
    expect(mined.write_policy).toBe("classify_only");
    expect(mined.memory_required_but_empty).toBe(false);
    expect(mined.blocked_verdict).toBe(false);

    const statusAfter = await engine.goalStatus({ flow_id: flowId });
    expect(statusAfter.blockers as string[]).not.toContain("memory_required_but_empty");
  });

  it("T4b clears memory_required_but_empty after canonical auto_write mining returns 0 candidates", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t4b", "Garimpo vazio apos auto_write libera checkout");
    await engine.updateFlowFacts(flowId, { risks: ["memoria L1/L2 obrigatoria para este risco material"] });

    const statusBefore = await engine.goalStatus({ flow_id: flowId });
    expect(statusBefore.blockers as string[]).toContain("memory_required_but_empty");

    const mined = await engine.mineMemory({ flow_id: flowId });

    expect(mined).toMatchObject({
      write_policy: "auto_write",
      candidates: [],
      written: [],
      strong_unwritten_count: 0,
      memory_required_but_empty: false,
      blocked_verdict: false
    });

    const statusAfter = await engine.goalStatus({ flow_id: flowId });
    const checkout = statusAfter.ppirtv_checkout as Record<string, unknown>;
    const memory = checkout.memory_accountability as Record<string, unknown>;
    const directAction = String(checkout.direct_action ?? "");

    expect(statusAfter.blockers as string[]).not.toContain("memory_required_but_empty");
    expect(directAction).not.toContain("memory_required_but_empty");
    expect(directAction).not.toContain("mm_memory_candidate_resolve");
    expect(directAction).not.toContain("candidate_ids");
    expect(memory).toMatchObject({
      required: true,
      mined: true,
      write_policy: "auto_write",
      candidates_count: 0,
      written_count: 0,
      strong_unwritten_count: 0,
      memory_required_but_empty: false,
      candidates: []
    });
    expect(String(memory.summary ?? "")).toContain("nenhum candidato");
  });

  it("T4c preserves implementation_done across subsequent goal_gate_check calls without re-sending provided", async () => {
    // BUG 3: o usuario registra implementation_done:true + changed_files via
    // goal_gate_check na fase implementacao. Em chamadas seguintes (ex.: para
    // checar status), sem reenviar implementation_done, o item volta para
    // missing. Isso trava o flow ate alguem arquivar com flow_archive.
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t4c", "implementation_done persiste no gate");
    // Avanca ate implementacao
    await engine.goalAdvance({ flow_id: flowId, provided: { context: "ctx", risks: ["risco"], uncertainties: ["u"] } });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { scope_in: ["src"], scope_out: ["fora"], tasks: ["codar"], expected_evidence: ["review"], done_criteria: ["passar"] }
    });

    // Primeira chamada: registra implementation_done:true + changed_files
    const firstGate = await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    expect(firstGate.missing).not.toContain("implementation_done");
    expect(firstGate.missing).not.toContain("changed_files");

    // Segunda chamada sem reenviar implementation_done: deve continuar resolvido
    // porque ja foi registrado no provided persistido da fase.
    const secondGate = await engine.goalGateCheck({
      flow_id: flowId,
      phase: "implementacao",
      provided: {}
    });

    expect(secondGate.missing).not.toContain("implementation_done");
  });

  it("T4d keeps auto_write from promoting candidates with reaproveitamento=0 to L1/L2/L3 (integration)", async () => {
    // R5: teste de integracao confirmando que mineMemory com write_policy=auto_write
    // rebaixa candidato reaproveitamento=0 para ledger_only/estacionamento, nunca
    // para written. O teste unitario em tests/mining-policy.test.ts cobre
    // isWritableCandidate isolado; este cobre o fluxo real de mineMemory.
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "r5-reaproveitamento-zero");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t4d-r5", "Auto_write nao promove reaproveitamento=0");
      const meeting = await engine.goalMeetingOpen({
        flow_id: flowId,
        type: "transversal",
        question: "Turno processual deve virar memoria?",
        participants_required: ["chato", "reuniao"]
      });
      // Fala processual do Chato: tem evidencia e custo de esquecimento, mas
      // reaproveitamento proximo de zero — e' registro de conversa, nao regra
      // reaplicavel.
      await engine.goalMeetingClose({
        flow_id: flowId,
        meeting_id: meeting.meeting_id as string,
        participants_present: ["chato", "reuniao"],
        decision: "Turno processual nao vira memoria de reuso.",
        satisfies_blockers: ["required_cooperation"],
        findings: ["E SE falhar? git rollback via git reset --hard HEAD~2 por que o patch quebrou encoding."],
        gold_mining: ["Turno do Chato: e se falhar, fazer git rollback reset HEAD~2."]
      });

      const mined = await engine.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "auto_write" });
      const candidates = mined.candidates as Array<Record<string, unknown>>;

      // Helper: retorno de mineMemory traz ledger_only/estacionamento/discarded
      // como arrays de objetos (Candidates). written traz registros de escrita.
      const idsIn = (list: unknown): string[] => Array.isArray(list) ? list.map((item) => (item as Record<string, unknown>).id as string) : [];

      // Se houver candidato classificado, nenhum dele pode estar em `written`
      // quando reaproveitamento for 0.
      for (const candidate of candidates) {
        const score = candidate.score as { reaproveitamento?: number };
        if ((score.reaproveitamento ?? 0) === 0) {
          const writtenIds = idsIn(mined.written);
          expect(writtenIds).not.toContain(candidate.id);
          // Deve ter ido para ledger_only ou estacionamento ou discarded, nunca
          // ficar sem destino (R5: rebaixamento automatico para ledger_only).
          const ledgerOnlyIds = idsIn(mined.ledger_only);
          const estacionamentoIds = idsIn(mined.estacionamento);
          const discardedIds = idsIn(mined.discarded);
          const candidateId = candidate.id as string;
          const destination = ledgerOnlyIds.includes(candidateId)
            || estacionamentoIds.includes(candidateId)
            || discardedIds.includes(candidateId);
          expect(destination).toBe(true);
        }
      }
    } finally {
      process.env.DEX_MEMORIA_HOME = originalDexMemoriaHome;
    }
  });

  it("T-MC-D startGoal with mode:compact propagates flow.mode and starts at concepcao", async () => {
    const workspace = path.join(tempRoot, "mc-mode-compact-start");
    const sptPath = await writeFakeSpt(workspace, "Modo compact wire-up");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Modo compact wire-up",
      idempotency_key: "dex-code:test-mc-mode-start",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "compact"
    });
    const flowId = started.flow_id as string;
    const flow = await engine.store.loadFlow(flowId);

    expect(flow.mode).toBe("compact");
    expect(flow.phase).toBe("concepcao");
  });

  it("T-LEAN-CONTRACT maps mode:lean to canonical compact and returns a lean start response", async () => {
    const workspace = path.join(tempRoot, "lean-mode-alias-start");
    const sptPath = await writeFakeSpt(workspace, "Lean alias wire-up");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Lean alias wire-up",
      idempotency_key: "dex-code:test-lean-mode-alias-start",
      evidence_required: false,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "lean"
    });
    const flowId = started.flow_id as string;
    const flow = await engine.store.loadFlow(flowId);

    expect(flow.mode).toBe("compact");
    expect(flow.phase).toBe("concepcao");
    expect(flow.goal_binding?.envelope.mode).toBe("compact");
    expect(started.mode).toBe("compact");
    expect(started.checklist).toBeUndefined();
    expect(JSON.stringify(started).length).toBeLessThan(5120);
  });

  it("T-LEAN-MUTATION goal_advance defaults to a lean snapshot for compact flows", async () => {
    const workspace = path.join(tempRoot, "lean-goal-advance-snapshot");
    const sptPath = await writeFakeSpt(workspace, "Lean mutation snapshot");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Lean mutation snapshot",
      idempotency_key: "dex-code:test-lean-goal-advance-snapshot",
      evidence_required: false,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "compact",
      risk_level: "mechanical"
    });
    const advanced = await engine.goalAdvance({
      flow_id: started.flow_id as string,
      provided: {
        context: "ctx",
        risks: ["risco"],
        scope_in: ["src"],
        scope_out: ["fora"],
        tasks: ["codar"],
        done_criteria: ["passar"]
      }
    });
    const snapshot = advanced.status_snapshot as Record<string, unknown>;

    expect(snapshot.mode).toBe("compact");
    expect(snapshot.checklist).toBeUndefined();
    expect(snapshot.ppirtv_checkout).toBeUndefined();
    expect(JSON.stringify(snapshot).length).toBeLessThan(5120);
  });

  it("T-LEAN-EVIDENCE evidence_add defaults to lean for compact flows and honors an explicit full override", async () => {
    const workspace = path.join(tempRoot, "lean-evidence-snapshot");
    const sptPath = await writeFakeSpt(workspace, "Lean evidence snapshot");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Lean evidence snapshot",
      idempotency_key: "dex-code:test-lean-evidence-snapshot",
      evidence_required: false,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "compact"
    });
    const flowId = started.flow_id as string;
    const leanEvidence = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "lean evidence",
      content: "pass"
    });
    const leanStatus = leanEvidence.status as Record<string, unknown>;
    const fullEvidence = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "full evidence",
      content: "pass",
      detail: "full"
    });
    const fullStatus = fullEvidence.status as Record<string, unknown>;

    expect(leanStatus.mode).toBe("compact");
    expect(leanStatus.checklist).toBeUndefined();
    expect(JSON.stringify(leanStatus).length).toBeLessThan(5120);
    expect(fullStatus.checklist).toBeDefined();
    expect(fullStatus.ppirtv_checkout).toBeDefined();
  });

  it("T-GATE-EVIDENCE-RED reuses explicit structured review evidence without redeclaring provided fields", async () => {
    const flow = await engine.createFlow({
      goal: "Reutilizar evidencia estruturada no gate",
      context: "Revisao ja executada e anexada",
      risks: ["falso GREEN"],
      uncertainties: ["nenhuma"],
      scope: { in: ["resolver de gates"], out: ["recall policy"] }
    });
    flow.tasks = ["validar evidencia"];
    flow.expected_evidence = ["review estruturado"];
    flow.done_criteria = ["sem redeclaracao"];
    flow.phase = "revisao";
    await engine.store.saveFlow(flow);

    await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      kind: "code_review",
      title: "Review estruturado",
      content: "Review executado; detalhes no resultado observado.",
      satisfies: ["diff_reviewed", "barata_scan"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["resolver de gates"],
        barata_scan: true,
        searched_patterns: ["consumidores vizinhos"],
        findings: [],
        regression_risks: []
      },
      scope_classification: "target",
      scope_reference: "resolver de gates"
    } as Parameters<FlowEngine["addGoalEvidence"]>[0]);

    const gate = await engine.checkGate({ flow_id: flow.flow_id, phase: "revisao", persist: false });

    expect(gate.missing).not.toContain("diff_reviewed");
    expect(gate.missing).not.toContain("barata_scan");
    expect(gate.missing).toContain("regression_risks");
  });

  it("loads legacy review evidence without granting it new structured gate authority", async () => {
    const flow = await engine.createFlow({
      goal: "Carregar evidencia legada",
      context: "compatibilidade de leitura",
      risks: ["autoridade retroativa"],
      uncertainties: [],
      scope: { in: ["src/flow-engine.ts"], out: [] }
    });
    flow.phase = "revisao";
    flow.changed_files = ["src/flow-engine.ts"];
    await engine.store.saveFlow(flow);
    await engine.addGoalEvidence({
      flow_id: flow.flow_id,
      kind: "code_review",
      title: "Review legado",
      content: "texto livre historico",
      satisfies: ["review_required"]
    });

    const restarted = new FlowEngine(engine.store);
    const loaded = await restarted.store.loadFlow(flow.flow_id);
    const gate = await restarted.checkGate({ flow_id: flow.flow_id, phase: "revisao", persist: false });

    expect(loaded.evidence).toHaveLength(1);
    expect(gate.missing).toEqual(expect.arrayContaining(["diff_reviewed", "barata_scan", "regression_risks"]));
  });

  it("T-GATE-PREFLIGHT is read-only and shares structured evidence resolution", async () => {
    let recallCalls = 0;
    const hooks: MemoryHookRunner = {
      beforePhase: async ({ flow, phase }) => {
        recallCalls += 1;
        return {
          flow_id: flow.flow_id,
          phase,
          recalled_at: new Date().toISOString(),
          items: [],
          warnings: [],
          visual_status: { librarian: "empty", graphify: "disabled" }
        };
      },
      afterPhase: async ({ flow, phase }) => ({
        flow_id: flow.flow_id,
        phase,
        recorded_at: new Date().toISOString(),
        candidates_count: 0,
        parking_count: 0,
        warnings: []
      })
    };
    const preflightStore = new PpirtvStore(path.join(tempRoot, "preflight-runtime"), { fixtureOnlyNoncanonicalRoot: true });
    const preflightEngine = new FlowEngine(preflightStore, hooks);
    const workspace = path.join(tempRoot, "preflight-workspace");
    const sptPath = await writeFakeSpt(workspace, "Preflight read only");
    const started = await preflightEngine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Preflight read only",
      idempotency_key: "dex-code:test-preflight-read-only",
      evidence_required: false,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    });
    const flowId = started.flow_id as string;
    const flow = await preflightStore.loadFlow(flowId);
    flow.phase = "teste";
    flow.scope.in = ["tests/preflight.ts"];
    flow.changed_files = ["tests/preflight.ts"];
    await preflightStore.saveFlow(flow);
    await preflightEngine.addGoalEvidence({
      flow_id: flowId,
      kind: "test_run",
      title: "vitest",
      content: "sete testes executados",
      satisfies: ["test_executed"],
      observed_result: { passed: 7, failed: 0, exit_code: 0 },
      scope_classification: "target",
      scope_reference: "tests/preflight.ts"
    });
    const beforeFlow = JSON.stringify(await preflightStore.loadFlow(flowId));
    const beforeLedger = await readFile(preflightStore.ledgerPath, "utf8");
    const beforeRecallCalls = recallCalls;

    const preflight = await preflightEngine.goalGatePreflight({ flow_id: flowId, phase: "teste", detail: "compact" });

    expect(preflight.already_satisfied).toEqual(expect.arrayContaining(["test_executed", "evidence"]));
    expect(preflight.missing).not.toEqual(expect.arrayContaining(["test_executed"]));
    expect(preflight).toMatchObject({ read_only: true, persisted: false });
    const transientProvided = { test_executed: true };
    const actionableCurrentPreflight = await preflightEngine.goalGatePreflight({
      flow_id: flowId,
      phase: "teste",
      provided: transientProvided
    });
    expect(actionableCurrentPreflight.next_required_action).toEqual({
      tool: "goal_advance",
      provided: transientProvided
    });
    const futureValidation = await preflightEngine.goalGatePreflight({
      flow_id: flowId,
      phase: "validacao",
      provided: {
        verdict: "texto nao canonico",
        residual_risks: ["nenhum"],
        next_step: "fechar",
        memoria_viva_reconciled: true
      }
    });
    expect(futureValidation.missing).toContain("verdict");
    expect(futureValidation.next_required_action).toEqual({
      type: "preview_future_phase",
      executable: false,
      current_phase: "teste"
    });
    const futurePersistlessGate = await preflightEngine.checkGate({
      flow_id: flowId,
      phase: "validacao",
      provided: {
        verdict: "texto nao canonico",
        residual_risks: ["nenhum"],
        next_step: "fechar",
        memoria_viva_reconciled: true
      },
      persist: false
    });
    expect(futurePersistlessGate.missing).toContain("verdict");
    expect(JSON.stringify(await preflightStore.loadFlow(flowId))).toBe(beforeFlow);
    expect(await readFile(preflightStore.ledgerPath, "utf8")).toBe(beforeLedger);
    expect(recallCalls).toBe(beforeRecallCalls);
  });

  it("T-MUTATION-RECEIPT keeps compact evidence_add and goal_advance bounded without changing lean/full", async () => {
    const workspace = path.join(tempRoot, "compact-mutation-receipt");
    const sptPath = await writeFakeSpt(workspace, "Compact mutation receipt");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Compact mutation receipt",
      idempotency_key: "dex-code:test-compact-mutation-receipt",
      evidence_required: false,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    });
    const flowId = started.flow_id as string;

    const evidenceReceipt = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "test_run",
      title: "compact receipt",
      content: "pass",
      satisfies: ["test_executed"],
      observed_result: { passed: 1, failed: 0, exit_code: 0 },
      scope_classification: "target",
      scope_reference: "Executar fluxo PPIRTV do SPT validado",
      detail: "compact"
    });
    expect(evidenceReceipt).toMatchObject({ action: "evidence_add", flow_id: flowId, phase: "pensamentos" });
    expect(evidenceReceipt).not.toHaveProperty("evidence");
    expect(evidenceReceipt).not.toHaveProperty("status_snapshot");
    expect(JSON.stringify(evidenceReceipt).length).toBeLessThanOrEqual(6144);

    const receiptFlow = await engine.store.loadFlow(flowId);
    receiptFlow.context = "";
    receiptFlow.risks = [];
    receiptFlow.uncertainties = [];
    await engine.store.saveFlow(receiptFlow);

    const advanceReceipt = await engine.goalAdvance({
      flow_id: flowId,
      provided: { context: "ctx", risks: ["risk"], uncertainties: ["none"] },
      detail: "compact"
    });
    expect(advanceReceipt).toMatchObject({ action: "goal_advance", flow_id: flowId, advanced: true, from: "pensamentos", phase: "planejamento" });
    expect(advanceReceipt).not.toHaveProperty("gate");
    expect(advanceReceipt).not.toHaveProperty("status_snapshot");
    expect(advanceReceipt.cleared_blockers).toEqual(expect.arrayContaining(["context", "risks", "uncertainties"]));
    expect(JSON.stringify(advanceReceipt).length).toBeLessThanOrEqual(6144);

    const leanEvidence = await engine.addGoalEvidence({ flow_id: flowId, title: "legacy lean", content: "pass" });
    const fullEvidence = await engine.addGoalEvidence({ flow_id: flowId, title: "legacy full", content: "pass", detail: "full" });
    expect(leanEvidence).toHaveProperty("status");
    expect(fullEvidence).toHaveProperty("status");
    expect(fullEvidence).toHaveProperty("evidence");
  });

  it("T-MC-A advance in compact flow follows concepcao->implementacao->revisao->validacao", async () => {
    const workspace = path.join(tempRoot, "mc-mode-compact-advance");
    const sptPath = await writeFakeSpt(workspace, "Avanco compact");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Avanco compact",
      idempotency_key: "dex-code:test-mc-mode-advance",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "compact",
      risk_level: "mechanical"
    });
    const flowId = started.flow_id as string;

    // Concepcao -> Implementacao (fornecendo o que o gate compact de concepcao exige)
    const advanced1 = await engine.goalAdvance({
      flow_id: flowId,
      provided: { context: "ctx", risks: ["risco"], scope_in: ["src"], scope_out: ["fora"], tasks: ["codar"], done_criteria: ["passar"] }
    });
    expect(advanced1.flow?.phase ?? (advanced1 as Record<string, unknown>).phase).toBe("implementacao");

    // Implementacao -> Revisao. Em compact, a revisao acontece na proxima
    // fase. usamos risk_level "mechanical" para nao exigir review_required
    // no gate de implementacao (o fiscal policy exige review quando ha
    // changed_files; mechanical desliga essa exigencia antecipada).
    const advanced2 = await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    const afterImpl = await engine.store.loadFlow(flowId);
    expect(afterImpl.phase).toBe("revisao");
  });

  it("T-MC-C checkGate for concepcao in compact flow returns compact gates (not undefined)", async () => {
    const workspace = path.join(tempRoot, "mc-mode-compact-gate");
    const sptPath = await writeFakeSpt(workspace, "Gate compact");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Gate compact",
      idempotency_key: "dex-code:test-mc-mode-gate",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "compact"
    });
    const flowId = started.flow_id as string;

    // O gate compact de concepcao inclui requisitos que so existem no perfil
    // compact (escopo definido, tarefas, criterio de pronto). Confirmar via
    // checklist do goal_status que esses labels aparecem para a fase concepcao.
    const status = await engine.goalStatus({ flow_id: flowId });
    const checklist = (status.checklist as Record<string, unknown> | undefined) ?? {};
    const items = (checklist.items as Array<Record<string, unknown>> | undefined) ?? [];
    const labels = items.map((item) => String(item.label ?? ""));
    // Gates compact de concepcao tem labels especificos.
    expect(labels).toEqual(expect.arrayContaining([
      expect.stringContaining("escopo definido"),
      expect.stringContaining("tarefas ordenadas"),
      expect.stringContaining("criterio de pronto")
    ]));

    // E NAO deve ter labels full-only de pensamentos/planejamento.
    expect(labels).not.toEqual(expect.arrayContaining([expect.stringContaining("incertezas marcadas")]));
  });

  it("T-MC-B flow without mode defaults to compact and starts at concepcao", async () => {
    const workspace = path.join(tempRoot, "mc-mode-default-compact");
    const sptPath = await writeFakeSpt(workspace, "Default compact contract");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Default compact contract",
      idempotency_key: "dex-code:test-mc-mode-default-compact",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    });
    const flowId = started.flow_id as string;
    const flow = await engine.store.loadFlow(flowId);

    expect(flow.mode).toBe("compact");
    expect(flow.phase).toBe("concepcao");
    expect(started.mode).toBe("compact");
    expect(started.checklist).toBeUndefined();
    expect(JSON.stringify(started).length).toBeLessThan(5120);
  });

  it("T-MC-B-FULL keeps the six-phase profile only when mode full is explicit", async () => {
    const workspace = path.join(tempRoot, "mc-mode-explicit-full");
    const sptPath = await writeFakeSpt(workspace, "Explicit full contract");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Explicit full contract",
      idempotency_key: "dex-code:test-mc-mode-explicit-full",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    });
    const flow = await engine.store.loadFlow(started.flow_id as string);

    expect(flow.mode).toBe("full");
    expect(flow.phase).toBe("pensamentos");
  });

  it("T-MC-R2 rejects mode mismatch when reusing goal flow by idempotency key", async () => {
    // R2: se um flow ja existe com mode "full" e um novo goal_start chega com
    // mode "compact" usando a mesma idempotency_key, o engine deve rejeitar
    // em vez de sobrescrever silenciosamente o modo (o que quebraria o fluxo
    // em fase avancada).
    const workspace = path.join(tempRoot, "mc-mode-mismatch-reuse");
    const sptPath = await writeFakeSpt(workspace, "Flow original full");
    const idempotencyKey = "dex-code:test-mc-mode-mismatch";
    await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Flow original full",
      idempotency_key: idempotencyKey,
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    });

    await expect(
      engine.startGoal({
        workspace,
        spt_path: sptPath,
        objective: "Flow original full",
        idempotency_key: idempotencyKey,
        evidence_required: true,
        required_evidence: ["npm run check"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code",
        mode: "compact"
      })
    ).rejects.toThrow(/mode mismatch|MODE_MISMATCH/i);
  });

  it("T-HARD-P1 returnTo invalidates gate of destination phase forcing revalidation", async () => {
    // P1 (adversario-codigo): regresso fiscal para fase com gate "passed"
    // stale nao deve liberar sem revalidacao. O gate da fase destino deve
    // ser invalidado para forcar nova checagem.
    const workspace = path.join(tempRoot, "hard-p1-regress-gate");
    const sptPath = await writeFakeSpt(workspace, "Regresso invalida gate");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Regresso invalida gate",
      idempotency_key: "dex-code:test-hard-p1-regress",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "compact",
      risk_level: "mechanical"
    });
    const flowId = started.flow_id as string;

    // Avancar concepcao -> implementacao -> revisao (com gate passed)
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { context: "ctx", risks: ["risco"], scope_in: ["src"], scope_out: ["fora"], tasks: ["codar"], done_criteria: ["passar"] }
    });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/x.ts"] }
    });
    // Confirmar que o gate de revisao foi registrado (qualquer status)
    const gateBeforeRegress = await engine.goalGateCheck({ flow_id: flowId, phase: "revisao", persist: true, provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] } });
    // Guardar o estado pre-regresso para comparar
    const statusBeforeRegress = await engine.goalStatus({ flow_id: flowId });
    const savedGateBefore = (statusBeforeRegress as Record<string, unknown>).gate as Record<string, unknown> | undefined;

    // Regredir para revisao (simulando fiscal block em validacao)
    await engine.returnTo({ flow_id: flowId, to: "revisao" as AnyPhase as Phase, reason: "Fiscal bloqueou; revisar novamente" });

    // APOS regresso, o gate de revisao deve estar invalidado. Se havia
    // savedGate, ele nao deve mais existir (ou nao ser "passed" stale).
    const statusAfterRegress = await engine.goalStatus({ flow_id: flowId });
    const savedGateAfter = (statusAfterRegress as Record<string, unknown>).gate as Record<string, unknown> | undefined;
    // Se antes havia gate e agora ainda ha, o status nao pode ser "passed"
    // stale igual ao pre-regresso.
    if (savedGateBefore) {
      expect(savedGateAfter?.status ?? "absent").not.toBe(savedGateBefore.status === "passed" ? "passed" : "__keep__");
    }
    // Em qualquer caso, apos regresso o flow deve poder re-checar o gate
    // sem depender de cache stale.
    const recheckedGate = await engine.goalGateCheck({ flow_id: flowId, phase: "revisao", persist: false, provided: {} });
    expect(recheckedGate).toBeDefined();
    expect(Array.isArray(recheckedGate.missing)).toBe(true);
  });

  it("T-HARD-D returnTo invalidates ALL downstream gates not just destination", async () => {
    // D (design-patterns-gof): returnTo so invalidava o gate da fase destino.
    // Gates de fases POSTERIORES continuavam "passed" com provided stale
    // (do BUG 3 merge), permitindo avance sem revalidacao.
    const workspace = path.join(tempRoot, "hard-d-downstream-gates");
    const sptPath = await writeFakeSpt(workspace, "Downstream gates invalidados");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Downstream gates invalidados",
      idempotency_key: "dex-code:test-hard-d-downstream",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "compact",
      risk_level: "mechanical"
    });
    const flowId = started.flow_id as string;

    // Avancar ate revisao (concepcao -> implementacao -> revisao)
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { context: "ctx", risks: ["risco"], scope_in: ["src"], scope_out: ["fora"], tasks: ["codar"], done_criteria: ["passar"] }
    });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/x.ts"] }
    });
    // Registrar gate passed em revisao
    await engine.goalGateCheck({ flow_id: flowId, phase: "revisao", persist: true, provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["ok"] } });

    // Confirmar que revisao tem gate registrado
    const flowBeforeRegress = await engine.store.loadFlow(flowId);
    expect(flowBeforeRegress.gates["revisao"]).toBeDefined();

    // Regredir para implementacao (uma fase ANTES de revisao)
    await engine.returnTo({ flow_id: flowId, to: "implementacao" as AnyPhase as Phase, reason: "Fiscal bloqueou; refazer implementacao" });

    // APOS regresso, o gate de revisao (fase POSTERIOR a implementacao)
    // tambem deve ter sido invalidado, nao so o de implementacao.
    const flowAfterRegress = await engine.store.loadFlow(flowId);
    expect(flowAfterRegress.gates["implementacao"]).toBeUndefined();
    expect(flowAfterRegress.gates["revisao"]).toBeUndefined();
  });

  it("T-HARD-P2b normalizeGoalEnvelope rejects invalid mode value at boundary", async () => {
    // P2b (adversario-codigo): mode invalido (case errado, typo, etc.) deve
    // ser rejeitado na borda e nao entrar cru no store. O Zod do MCP protege,
    // mas chamadas diretas ao engine precisam do mesmo guard.
    const workspace = path.join(tempRoot, "hard-p2b-mode-invalid");
    const sptPath = await writeFakeSpt(workspace, "Mode invalido rejeitado");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Mode invalido rejeitado",
      idempotency_key: "dex-code:test-hard-p2b-mode-invalid",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "Compact" as AnyPhase as never // Typo de case proposital
    });
    const flowId = started.flow_id as string;
    const flow = await engine.store.loadFlow(flowId);

    // Mode invalido deve ter sido normalizado para o default "compact", nao
    // salvo cru como "Compact".
    expect(flow.mode).toBe("compact");
    expect(flow.mode).not.toBe("Compact");
  });

  it("T-BUG5 detail:compact omits operational_principles and prestacao_de_contas from goal_status", async () => {
    // BUG 5: goal_status com detail:"compact" deve omitir arrays grandes
    // (operational_principles, ready_definition, gate_final_output,
    // final_report_model, prestacao_de_contas) e manter contagens.
    const flow = await engine.createFlow({ goal: "BUG5 detail compact" });

    // Default (full): operational_principles presente.
    const statusFull = await engine.goalStatus({ flow_id: flow.flow_id }) as Record<string, unknown>;
    const checklistFull = statusFull.checklist as Record<string, unknown>;
    expect(checklistFull.operational_principles).toBeDefined();
    expect(Array.isArray(checklistFull.operational_principles)).toBe(true);

    // Compact: operational_principles ausente, mas count presente.
    const statusCompact = await engine.goalStatus({ flow_id: flow.flow_id, detail: "compact" }) as Record<string, unknown>;
    const checklistCompact = statusCompact.checklist as Record<string, unknown>;
    expect(checklistCompact.operational_principles).toBeUndefined();
    expect(checklistCompact.operational_principles_count).toBeDefined();
    expect(typeof checklistCompact.operational_principles_count).toBe("number");

    // Compact: ppirtv_checkout nao tem prestacao_de_contas completa.
    const checkoutCompact = statusCompact.ppirtv_checkout as Record<string, unknown>;
    expect(checkoutCompact.prestacao_de_contas).toBeUndefined();
    expect(checkoutCompact.prestacao_de_contas_count).toBeDefined();
  });

  it("T-BUG5-CO ppirtv_checkout with detail:compact reports correct prestacao_de_contas_count", async () => {
    // A (adversario): ppirtv_checkout com detail:compact reportava count=0
    // porque lia prestacao_de_contas ja removido por compactPpirtvCheckout.
    const flow = await engine.createFlow({ goal: "BUG5 checkout compact count" });
    // Adicionar alguma atividade para gerar prestacao_de_contas
    await engine.attachEvidence({ flow_id: flow.flow_id, kind: "note", title: "ev", content: "x" });

    const checkoutFull = await engine.goalCheckout({ flow_id: flow.flow_id }) as Record<string, unknown>;
    // prestacao_de_contas pode ser array ou objeto; contar de forma compativel.
    const fullPrestacao = checkoutFull.prestacao_de_contas;
    const fullCount = Array.isArray(fullPrestacao)
      ? fullPrestacao.length
      : (fullPrestacao && typeof fullPrestacao === "object" ? Object.keys(fullPrestacao as Record<string, unknown>).length : 0);

    const checkoutCompact = await engine.goalCheckout({ flow_id: flow.flow_id, detail: "compact" }) as Record<string, unknown>;
    // O count em compact deve ser igual ao count em full (nao zero).
    expect(checkoutCompact.prestacao_de_contas).toBeUndefined();
    expect(typeof checkoutCompact.prestacao_de_contas_count).toBe("number");
    expect(checkoutCompact.prestacao_de_contas_count).toBe(fullCount);
    // ready_definition/gate_final_output/final_report_model omitidos em compact.
    expect(checkoutCompact.ready_definition).toBeUndefined();
    expect(checkoutCompact.gate_final_output).toBeUndefined();
    expect(checkoutCompact.final_report_model).toBeUndefined();
  });

  it("T-LEAN goal_status with detail:lean returns <5KB with only core fields", async () => {
    // DT-04 (chato + pragmatic): detail compact ainda e 26KB. Lean deve
    // retornar apenas nucleo (fase, status, blockers, next_step, display,
    // aliases) em <5KB, sem checkout/checkin/checklist/fiscal_policy.
    const flow = await engine.createFlow({ goal: "Lean status test" });

    const statusLean = await engine.goalStatus({ flow_id: flow.flow_id, detail: "lean" as AnyPhase as never }) as Record<string, unknown>;
    const jsonLean = JSON.stringify(statusLean);

    // Deve ter campos nucleo.
    expect(statusLean.phase).toBeDefined();
    expect(statusLean.status).toBeDefined();
    expect(statusLean.blockers).toBeDefined();
    expect((statusLean as Record<string, unknown>).display).toBeDefined();

    // NAO deve ter campos pesados.
    expect(statusLean.ppirtv_checkout).toBeUndefined();
    expect(statusLean.ppirtv_checkin).toBeUndefined();
    expect((statusLean as Record<string, unknown>).checklist).toBeUndefined();
    expect((statusLean as Record<string, unknown>).fiscal_policy).toBeUndefined();
    expect((statusLean as Record<string, unknown>).resolution_guidance).toBeUndefined();

    // Deve ser menor que 5KB.
    expect(jsonLean.length).toBeLessThan(5120);
  });

  it("T-LEAN-CHECKOUT ppirtv_checkout detail:lean returns only actionable accountability under 5KB", async () => {
    const flow = await engine.createFlow({ goal: "Lean checkout contract" });
    const checkout = await engine.goalCheckout({ flow_id: flow.flow_id, detail: "lean" }) as Record<string, unknown>;
    const json = JSON.stringify(checkout);

    expect(checkout).toMatchObject({
      flow_id: flow.flow_id,
      mode: "full",
      blockers: expect.any(Array),
      evidence_count: 0,
      meetings_count: 0,
      librarian_accountability: {
        recall_executed: false,
        consumption_confirmed: false,
        worked: false
      }
    });
    expect(checkout.contract_accountability).toBeUndefined();
    expect(checkout.prestacao_de_contas).toBeUndefined();
    expect(json.length).toBeLessThan(5120);
  });

  it("T-LEAN-ACTION lean includes actionable blocker fields (required_cooperation, next_required_action, meeting_required)", async () => {
    // BUG-LEAN-01: lean omite required_cooperation e next_required_action.
    // Operador fica preso sem saber como destravar o flow.
    const { flowId } = await startGoalWithEvidence("dex-code:test-lean-action", "Lean com fiscal");
    await engine.updateFlowFacts(flowId, { risks: ["risco material de produto"], changed_files: ["src/x.ts"] });
    await engine.goalAdvance({ flow_id: flowId, provided: { context: "ctx", risks: ["risco"], uncertainties: ["u"] } });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { scope_in: ["src"], scope_out: ["fora"], tasks: ["codar"], expected_evidence: ["review"], done_criteria: ["passar"] }
    });

    const statusLean = await engine.goalStatus({ flow_id: flowId, detail: "lean" }) as Record<string, unknown>;

    // Lean DEVE incluir campos acionaveis de blocker (mesmo sendo lean).
    expect(statusLean.required_cooperation).toBeDefined();
    expect(Array.isArray(statusLean.required_cooperation)).toBe(true);
    expect(statusLean.next_required_action).toBeDefined();
    expect(statusLean.meeting_required).toBeDefined();
    expect(statusLean.regress_required).toBeDefined();
    // direct_action deve conter instrucao acionavel quando blocked.
    const display = (statusLean.display as Record<string, unknown>) ?? {};
    const directAction = display.direct_action;
    expect(typeof directAction).toBe("string");
    expect(directAction as string).toContain("Bloqueado");

    // barata_scan: operador deve ver vizinhos do erro (counts, nao arrays).
    expect(statusLean.evidence_count).toBeDefined();
    expect(typeof statusLean.evidence_count).toBe("number");
    expect(statusLean.meetings_count).toBeDefined();
    expect(typeof statusLean.meetings_count).toBe("number");
    expect(statusLean.current_verdict_status).toBeDefined();
    expect(statusLean.loop_monitor).toBeDefined();
  });

  it("T-BUG5-GC goal_gate_check with detail:compact omits operational_principles in status_snapshot", async () => {
    // B (revisor): goal_gate_check com detail:compact nao tinha teste.
    const { flowId } = await startGoalWithEvidence("dex-code:test-bug5-gate-compact", "Gate compact");
    await engine.goalAdvance({ flow_id: flowId, provided: { context: "ctx", risks: ["r"], uncertainties: ["u"] } });

    const gate = await engine.goalGateCheck({
      flow_id: flowId,
      phase: "planejamento",
      provided: { scope_in: ["x"], scope_out: ["y"], tasks: ["t"], expected_evidence: ["e"], done_criteria: ["d"] },
      persist: false,
      detail: "compact"
    }) as Record<string, unknown>;

    const snapshot = gate.status_snapshot as Record<string, unknown>;
    const checklist = snapshot.checklist as Record<string, unknown>;
    expect(checklist.operational_principles).toBeUndefined();
    expect(checklist.operational_principles_count).toBeDefined();
  });



  it("T-MC-S compact flow runs end-to-end concepcao->implementacao->revisao->validacao with verdict (smoke)", async () => {
    // Smoke de aceitacao do modo compact: percorrer as 4 fases e registrar
    // veredito positivo. Protege o valor ponta-a-ponta do modo compact,
    // nao apenas transicoes isoladas.
    const workspace = path.join(tempRoot, "mc-mode-compact-smoke");
    const sptPath = await writeFakeSpt(workspace, "Smoke compact E2E");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Smoke compact E2E",
      idempotency_key: "dex-code:test-mc-mode-smoke",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "compact",
      risk_level: "mechanical"
    });
    const flowId = started.flow_id as string;
    const evidence = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "npm run check",
      content: "pass",
      satisfies: ["npm run check"]
    });

    // Concepcao -> Implementacao
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { context: "ctx", risks: ["risco"], scope_in: ["src"], scope_out: ["fora"], tasks: ["codar"], done_criteria: ["passar"] }
    });
    let flow = await engine.store.loadFlow(flowId);
    expect(flow.phase).toBe("implementacao");

    // Implementacao -> Revisao
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] }
    });
    flow = await engine.store.loadFlow(flowId);
    expect(flow.phase).toBe("revisao");

    // Revisao -> Validacao. O gate compact de revisao exige diff_reviewed,
    // barata_scan, test_executed e review material (review_findings ou
    // artifact). Em mechanical, o fiscal policy nao exige code review formal,
    // mas o gate da fase pede review_evidence_coherent quando ha changed_files.
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { diff_reviewed: true, barata_scan: true, test_executed: true, review_findings: ["diff revisado sem regressao material"] }
    });
    flow = await engine.store.loadFlow(flowId);
    expect(flow.phase).toBe("validacao");

    // Veredito positivo em modo compact com evidence rastreavel.
    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Smoke compact E2E passou pelas 4 fases",
      evidence_ids: [evidence.evidence_id as string],
      residual_risks: [],
      next_step: "arquivar"
    });
    expect(verdict.verdict as Record<string, unknown>).toMatchObject({ status: "pronto" });
  });

  it("T5 blocks code-change GOAL verdicts without review artifact or findings", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-t5", "Mudanca de codigo exige review");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Codigo mudou, mas nao existe review material.",
        evidence_ids: [evidenceId],
        residual_risks: ["mudanca de codigo com risco de regressao"],
        next_step: "arquivar"
      })
    ).rejects.toThrow(/review_required/i);
  });

  it("T6 does not open required_cooperation only because a material risk exists", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t6", "COO sem rito automatico");
    await engine.updateFlowFacts(flowId, { risks: ["risco material de produto e fluxo"] });

    const status = await engine.goalStatus({ flow_id: flowId });

    expect(status.required_cooperation).toEqual([]);
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.meeting_required).toBe(false);
    const checkin = status.ppirtv_checkin as Record<string, unknown>;
    const components = checkin.components as Array<Record<string, unknown>>;
    const coo = components.find((component) => component.name === "coo");
    expect(checkin.ppi_action_required).toBe(false);
    expect(checkin.initial_adjustment_required).toBe(false);
    expect(coo).toMatchObject({
      status: "not_required",
      visible: false,
      auto_repair: "not_required_without_required_cooperation"
    });
  });

  it("T7 shows Graphify enabled but failing in visual librarian status", async () => {
    const provider: MemoryGraphProvider = {
      recall: async (input) => ({
        flow_id: input.flow_id,
        phase: input.phase,
        queried_at: new Date().toISOString(),
        warnings: ["graphify_graph_missing: graphify-out/graph.json"],
        items: []
      })
    };
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
    const flow = await graphEngine.createFlow({ goal: "Status visual Graphify" });

    const advanced = await graphEngine.advance({ flow_id: flow.flow_id, provided: { context: "ctx", risks: ["r"], uncertainties: ["u"] } });
    const ledger = await graphEngine.store.readLedger(flow.flow_id);
    const recall = ledger.findLast((event) => event.type === "memory_recalled");

    expect(advanced.display?.librarian).toMatchObject({ graphify_status: "missing_graph" });
    expect(recall?.data).toMatchObject({
      graphify_status: "missing_graph"
    });
  });

  it("T8 exposes librarian warning and blocks fiscal verdict when Bibliotecario failed", async () => {
    const failingHooks: MemoryHookRunner = {
      beforePhase: async () => {
        throw new Error("Bibliotecario indisponivel");
      },
      afterPhase: async () => ({ flow_id: "x", phase: "pensamentos", recorded_at: new Date().toISOString(), candidates_count: 0, parking_count: 0, warnings: [] })
    };
    const guarded = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), failingHooks);
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-t8", "Hook warning fiscal", guarded);
    const advanced = await guarded.advance({ flow_id: flowId, provided: { context: "ctx", risks: ["risco"], uncertainties: ["u"] } });

    expect(advanced.display?.librarian).toMatchObject({ status: "failed" });
    const status = await guarded.goalStatus({ flow_id: flowId });
    expect(status.librarian_status).toMatchObject({
      bibliotecario: { status: "failed", visible: true },
      graphify: { status: "failed", visible: true }
    });
    await expect(
      guarded.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Sem Bibliotecario vivo nao deve aceitar ressalva material.",
        evidence_ids: [evidenceId],
        residual_risks: ["sem retorno visual Bibliotecario/Graphify"],
        next_step: "corrigir"
      })
    ).rejects.toThrow(/librarian_status/i);
  });

  it("T9 rejects provided=true without coherent evidence in fiscal GOAL gates", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t9", "Provided true sem prova");
    await engine.goalAdvance({ flow_id: flowId, provided: { context: "ctx", risks: ["risco"], uncertainties: ["u"] } });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { scope_in: ["src"], scope_out: ["fora"], tasks: ["codar"], expected_evidence: ["review"], done_criteria: ["passar"] }
    });
    await engine.goalAdvance({ flow_id: flowId, provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] } });

    const gate = await engine.goalGateCheck({
      flow_id: flowId,
      phase: "revisao",
      provided: { diff_reviewed: true, barata_scan: true, regression_risks: ["risco de regressao"], changed_files: ["src/flow-engine.ts"] }
    });

    expect(gate.status).toBe("blocked");
    expect(gate.missing).toEqual(expect.arrayContaining(["review_evidence_coherent"]));

    await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Parecer adversarial dos artefatos finais",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      content: "Findings reais, riscos residuais e decisao de revisao foram registrados.",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: { diff_reviewed: true, reviewed_targets: ["src/flow-engine.ts"], barata_scan: true, searched_patterns: ["review_required neighbors"], findings: [], regression_risks: ["risco de regressao"] },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    const resolved = await engine.goalGateCheck({
      flow_id: flowId,
      phase: "revisao",
      provided: { diff_reviewed: true, barata_scan: true, regression_risks: ["risco de regressao"], changed_files: ["src/flow-engine.ts"] }
    });

    expect(resolved.missing).not.toContain("review_evidence_coherent");
  });

  it("T10 blocks material recurring risk without enough attempts, regressions or meetings", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-t10", "Tentativas insuficientes");

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Erro recorrente ainda sem resolucao suficiente.",
        evidence_ids: [evidenceId],
        residual_risks: [],
        attempt_count: 1,
        regress_count: 0,
        next_step: "arquivar"
      })
    ).rejects.toThrow(/attempt_regress_count/i);
  });

  it("T10a accepts Recorrentes V2 as a legitimate domain name without a recurring failure signal", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-t10a", "Nome de dominio nao e risco recorrente");

    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "A fase foi concluida e validada.",
      evidence_ids: [evidenceId],
      residual_risks: [],
      attempt_count: 1,
      regress_count: 0,
      next_step: "Abrir novo SPT para revisar a interface Recorrentes V2."
    });

    expect(verdict.verdict).toMatchObject({ status: "pronto_com_ressalvas" });
    const status = await engine.goalStatus({ flow_id: flowId });
    expect(status.blockers).not.toContain("attempt_regress_count");
  });

  it("T11 exposes corrective check-in with disabled librarian/Graphify visible and explained", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t11", "Check-in corretivo");
    await engine.updateFlowFacts(flowId, { risks: ["sem reuniao material exige COO visivel"] });

    const status = await engine.goalStatus({ flow_id: flowId });
    const checkin = status.ppirtv_checkin as Record<string, unknown>;
    const components = checkin.components as Array<Record<string, unknown>>;

    expect(checkin.ppi_action_required).toBe(true);
    expect(checkin.mode).toBe("goal_fiscal_blocked");
    expect(checkin.direct_action).toEqual(expect.stringContaining("check-in bloqueado:"));
    expect(components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "coo", visible: true, auto_repair: "already_visible" }),
        expect.objectContaining({ name: "bibliotecario", visible: true, auto_repair: "await_beforePhase_or_report_disabled" }),
        expect.objectContaining({ name: "graphify", visible: true, auto_repair: "optional_disabled_reported" }),
        expect.objectContaining({ name: "meeting_tools", status: "available", visible: true }),
        expect.objectContaining({ name: "ppi", status: "required" })
      ])
    );
  });

  it("T12 exposes check-in librarian and Graphify status after beforePhase", async () => {
    const provider: MemoryGraphProvider = {
      recall: async (input) => ({
        flow_id: input.flow_id,
        phase: input.phase,
        queried_at: new Date().toISOString(),
        warnings: ["graphify_recall_empty"],
        items: []
      })
    };
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
    const flow = await graphEngine.createFlow({ goal: "Check-in visual Graphify" });
    await graphEngine.advance({ flow_id: flow.flow_id, provided: { context: "ctx", risks: ["r"], uncertainties: ["u"] } });

    const status = await graphEngine.goalStatus({ flow_id: flow.flow_id });
    const checkin = status.ppirtv_checkin as Record<string, unknown>;
    const components = checkin.components as Array<Record<string, unknown>>;

    // bibliotecario pode reportar "recalled" quando há curated L1/L2 no workspace real
    const librarianStatuses = new Set(["empty", "recalled"]);
    expect(components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "bibliotecario", visible: true }),
        expect.objectContaining({ name: "graphify", status: "empty", visible: true }),
        expect.objectContaining({ name: "ppirtv", status: "online", visible: true }),
        expect.objectContaining({ name: "coo", visible: false }),
        expect.objectContaining({ name: "meeting_tools", visible: true }),
        expect.objectContaining({ name: "ppi", visible: true })
      ])
    );
    const bibliotecario = components.find((c) => c.name === "bibliotecario");
    expect(bibliotecario).toBeDefined();
    expect(librarianStatuses.has(bibliotecario!.status as string)).toBe(true);
  });

  it("T13 exposes check-out with final evidence, meetings, tests and verdict", async () => {
    const flow = await engine.createFlow({ goal: "Check-out final" });
    const meeting = await engine.openMeeting({ flow_id: flow.flow_id, type: "convergent", question: "Fechar como?" });
    await engine.recordMeeting({
      meeting_id: meeting.meeting_id,
      decisions: ["fechar com evidencia"],
      cooperators: [{ name: "validador-pronto", reason: "validou fechamento", material: true }],
      active_credits: ["validador-pronto validou fechamento"]
    });
    const evidence = await engine.attachEvidence({ flow_id: flow.flow_id, kind: "test_log", title: "npm run check", content: "pass" });
    await engine.recordVerdict({
      flow_id: flow.flow_id,
      status: "pronto",
      rationale: "Evidencia e check-out presentes.",
      evidence_ids: [evidence.evidence_id],
      residual_risks: [],
      next_step: "arquivar"
    });

    const status = await engine.goalStatus({ flow_id: flow.flow_id });
    const checkout = status.ppirtv_checkout as Record<string, unknown>;

    expect(checkout).toMatchObject({
      complete: true,
      status: "complete",
      verdict: "pronto",
      meetings_count: 1,
      evidence_count: 1,
      tests_visible: true,
      direct_action: "fechamento_total_registrado"
    });
  });

  it("T14 does not render false-green direct_action when fiscal blockers are active", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-t14", "Direct action bloqueado");

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Ressalva material sem fiscais.",
        evidence_ids: [evidenceId],
        residual_risks: [
          "sem reuniao divergente/convergente/transversal",
          "sem revisor-codigo material",
          "sem memoria L1/L2 gerada pelo motor",
          "sem retorno visual Bibliotecario/Graphify"
        ],
        next_step: "regressar"
      })
    ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED/i);

    const status = await engine.goalStatus({ flow_id: flowId });
    const directAction = (status.display as Record<string, Record<string, string>>).direct_action.action;

    expect(status.blockers).toEqual(
      expect.arrayContaining(["required_cooperation", "memory_required_but_empty", "review_required", "librarian_status"])
    );
    expect(directAction).toContain("Bloqueado:");
    expect(directAction).toContain("required_cooperation");
    expect(directAction).not.toContain("Gate pronto para avancar");
  });

  it("T15 keeps goal_verdict and mm_memory_mining aligned on memory_required_but_empty", async () => {
    const workspace = path.join(tempRoot, "memory-policy-shared");
    const sptPath = await writeFakeSpt(workspace, "Politica de memoria compartilhada");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Politica de memoria compartilhada",
      idempotency_key: "dex-code:test-fiscal-t15",
      evidence_required: true,
      required_evidence: ["evidencia rastreavel"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    });
    const flowId = started.flow_id as string;
    const evidence = await engine.attachEvidence({
      flow_id: flowId,
      kind: "note",
      title: "evidencia rastreavel sem pepita",
      content: "pass"
    });

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Risco residual exige memoria.",
        evidence_ids: [evidence.evidence_id],
        residual_risks: ["sem memoria L1/L2 gerada pelo motor"],
        next_step: "corrigir memoria"
      })
    ).rejects.toThrow(/memory_required_but_empty/i);

    const mined = await engine.mineMemory({ flow_id: flowId, write_policy: "classify_only" });

    // BUG 1 (novo contrato): classify_only executou com 0 candidatos e 0
    // strong_unwritten -> memory_required_but_empty limpa. Nao ha mais nada
    // a escrever. (O verdict ainda pode bloquear por outros motivos fiscais,
    // mas nao por "memoria vazia".)
    expect(mined.memory_required_but_empty).toBe(false);
  });

  it("T16 always returns structured librarian_status instead of null", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t16", "Bibliotecario status estruturado");

    const status = await engine.goalStatus({ flow_id: flowId });

    expect(status.librarian_status).toMatchObject({
      bibliotecario: {
        enabled: false,
        status: "disabled",
        reason: "await_beforePhase_or_report_disabled",
        visible: true
      },
      graphify: {
        enabled: false,
        status: "disabled",
        reason: "optional_disabled_reported",
        visible: true
      }
    });
  });

  it("T17 keeps proof-dependent checklist principles pending before hygiene/fiscal evidence exists", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t17", "Checklist pendente antes da prova");

    const checklist = await engine.renderChecklist(flowId, "full");
    const proofPrinciples = checklist.operational_principles.filter((item) =>
      ["casa_limpa", "memoria_sem_lembranca", "barata_nunca_esta_sozinha"].includes(item.id)
    );

    expect(proofPrinciples.length).toBeGreaterThan(0);
    expect(proofPrinciples).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "casa_limpa", checked: false, state: "pending" })])
    );
    expect(checklist.display.checklist_visual).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: expect.stringContaining("ouro"), checked: false, state: "pending" })])
    );
  });

  it("T18 preserves goal_gate_check hygiene material findings without opening a meeting by default", async () => {
    const workspace = path.join(tempRoot, "gate-check-hygiene");
    const sptPath = await writeFakeSpt(workspace, "Gate check fiscal preservado");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Gate check fiscal preservado",
      idempotency_key: "dex-code:test-fiscal-t18",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    });
    const flowId = started.flow_id as string;

    await engine.hygieneScan(flowId);
    const gate = await engine.goalGateCheck({ flow_id: flowId, persist: false });
    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });

    expect(gate.status).toBe("passed");
    expect(gate.missing).toEqual([]);
    expect(gate.missing).not.toContain("required_cooperation");
    expect(status.closure_blockers).toEqual(expect.arrayContaining(["hygiene_blocking"]));
    expect(status.phase_advance_allowed).toBe(true);
    expect((status.display as Record<string, Record<string, string>>).direct_action.action).toContain("hygiene_blocking");
  });

  it("T19 routes direct memory and review blockers without manufacturing required_cooperation", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t19", "Blockers diretos sem rito");
    await engine.updateFlowFacts(flowId, {
      risks: ["sem memoria L1/L2 gerada pelo motor"],
      changed_files: ["src/flow-engine.ts"]
    });

    const status = await engine.goalStatus({ flow_id: flowId });

    expect(status.blockers).toEqual(expect.arrayContaining(["memory_required_but_empty", "review_required"]));
    expect(status.blockers).not.toContain("required_cooperation");
    expect(status.required_cooperation).toEqual([]);
    expect(status.meeting_required).toBe(false);
    expect(status.next_required_action).toMatchObject({
      type: "attach_review",
      tool: "evidence_add"
    });
  });

  it("T20 summarizes blockers and next action in ppirtv_checkout for blocked flows", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-t20", "Check-out bloqueado detalhado");

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Bloqueio fiscal precisa aparecer no check-out.",
        evidence_ids: [evidenceId],
        residual_risks: ["sem revisor-codigo material", "sem memoria L1/L2 gerada pelo motor"],
        next_step: "regressar"
      })
    ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED/i);

    const status = await engine.goalStatus({ flow_id: flowId });
    const checkout = status.ppirtv_checkout as Record<string, unknown>;

    expect(checkout).toMatchObject({ complete: false, status: "blocked" });
    expect(checkout.direct_action).toEqual(expect.stringContaining("check-out bloqueado:"));
    expect(checkout.direct_action).not.toEqual(expect.stringContaining("required_cooperation"));
    expect(checkout.direct_action).toEqual(expect.stringContaining("review_required"));
    expect(checkout.direct_action).toEqual(expect.stringContaining("memory_required_but_empty"));
    expect(checkout.direct_action).toEqual(expect.stringContaining("resolution_guidance.next_required_action"));
  });

  it("routes memory_required_but_empty to canonical mm_memory_mining after evidence and material meeting", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-memory-required-route",
      "Memoria externa validada ainda exige mineracao canonica"
    );
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "divergente",
      participants_required: ["chato", "questionador", "reuniao", "garimpeiro", "dex-memoria", "validador-pronto"],
      question: "A evidencia externa de L1/L2 resolve o fiscal interno?"
    });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
      participants_present: ["chato", "questionador", "reuniao", "garimpeiro", "dex-memoria", "validador-pronto"],
      decision: "Evidencia externa e valida, mas o flow ainda precisa de mm_memory_mining canonico.",
      satisfies_blockers: ["required_cooperation"],
      cooperators: [
        { name: "dex-memoria", reason: "validou que L1/L2 externo nao e promocao canonica do flow", material: true },
        { name: "garimpeiro", reason: "separou evidencia externa de mining interno", material: true }
      ],
      active_credits: ["dex-memoria separou memoria externa de mining canonico", "garimpeiro classificou a pendencia"]
    });

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Memorias L1/L2 foram validadas fora do PPIRTV.",
        evidence_ids: [evidenceId],
        meeting_id: opened.meeting_id as string,
        residual_risks: ["memoria L1/L2 externa validada, mas sem mm_memory_mining no flow"],
        next_step: "rodar mm_memory_mining agora"
      })
    ).rejects.toThrow(/memory_required_but_empty/i);

    const status = await engine.goalStatus({ flow_id: flowId });
    const diagnostics = status.blocker_diagnostics as Record<string, unknown>;
    const memoryDiagnostics = diagnostics.memory_required as Record<string, unknown>;
    const nextAction = status.next_required_action as Record<string, unknown>;
    const sequence = nextAction.required_tool_sequence as Array<Record<string, unknown>>;

    expect(status.blockers as string[]).toContain("memory_required_but_empty");
    expect(status.blockers as string[]).not.toContain("required_cooperation");
    expect(nextAction).toMatchObject({
      type: "run_memory_mining",
      tool: "mm_memory_mining",
      can_retry_verdict: false
    });
    expect(sequence[0]).toMatchObject({
      tool: "mm_memory_mining",
      args: { flow_id: flowId, auto_classify: true, write_policy: "auto_write" }
    });
    expect(sequence[1]).toMatchObject({ tool: "goal_status", args: { flow_id: flowId } });
    expect(memoryDiagnostics).toMatchObject({
      required: true,
      mined: false,
      written_count: 0,
      candidates_count: 0,
      memory_required_but_empty: true
    });
  });

  it("T21 reproduces the dex-code-kimi consumer validation without completing a material ressalva", async () => {
    const originalCwd = process.cwd();
    const workspace = path.join(tempRoot, "consumer-kimi");
    const sptPath = await writeFakeSpt(workspace, "Validacao consumidor dex-code-kimi");
    await mkdir(path.join(workspace, "tema"), { recursive: true });
    await writeFile(path.join(workspace, "tema", "memoria.md"), "# Memoria sem L1\n\n## Aprendizado\n", "utf8");

    const validation = await engine.validateSpt({
      workspace,
      spt_path: sptPath,
      objective: "Validacao consumidor dex-code-kimi"
    });
    expect(validation.valid).toBe(true);

    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Validacao consumidor dex-code-kimi",
      idempotency_key: "dex-code:test-fiscal-consumer-kimi",
      evidence_required: true,
      required_evidence: ["evidencia sintetica controlada"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code-kimi"
    });
    const flowId = started.flow_id as string;
    const initialStatus = await engine.goalStatus({ flow_id: flowId });
    expect(initialStatus.librarian_status).toMatchObject({ bibliotecario: { status: "disabled" }, graphify: { status: "disabled" } });

    const evidence = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "synthetic_controlled_evidence",
      title: "evidencia sintetica controlada consumidor",
      content: "Data/hora: 2026-06-02; origem: teste; objetivo: validar fiscal; SPT e Flow identificados.",
      satisfies: ["evidencia sintetica controlada"]
    });

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Validacao consumidor nao pode aceitar ausencia material dos fiscais.",
        evidence_ids: [evidence.evidence_id as string],
        residual_risks: [
          "sem reuniao divergente/convergente/transversal",
          "sem revisor-codigo material",
          "sem memoria L1/L2 gerada pelo motor",
          "sem retorno visual Bibliotecario/Graphify",
          "hygiene_scan ainda nao consumido como bloqueador"
        ],
        next_step: "regressar antes de positivo"
      })
    ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED.*required_cooperation.*memory_required_but_empty.*review_required.*librarian_status/i);

    process.chdir(workspace);
    try {
      const hygiene = await engine.hygieneScan(flowId);
      const mined = await engine.mineMemory({ flow_id: flowId, write_policy: "classify_only" });
      const gate = await engine.goalGateCheck({ flow_id: flowId, persist: false });
      const status = await engine.goalStatus({ flow_id: flowId });
      const archived = await engine.archiveFlow({ flow_id: flowId, reason: "teste consumidor simulado finalizado" });

      expect(hygiene.hygiene_blocking).toBe(true);
      // BUG 1 (novo contrato): classify_only com 0 strong_unwritten limpa o
      // memory_required_but_empty. Os demais blockers fiscais permanecem.
      expect(mined.memory_required_but_empty).toBe(false);
      expect(gate.status).toBe("passed");
      expect(gate.missing).toEqual([]);
      expect(status.status).toBe("blocked");
      expect(status.phase_advance_allowed).toBe(true);
      expect(status.closure_blockers).toEqual(
        expect.arrayContaining(["required_cooperation", "review_required", "librarian_status", "hygiene_blocking"])
      );
      expect(status.blockers).toEqual(
        expect.arrayContaining(["required_cooperation", "review_required", "librarian_status", "hygiene_blocking"])
      );
      expect(status.blockers as string[]).not.toContain("memory_required_but_empty");
      expect(archived.status).toBe("archived");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("T22 rejects false-green direct_action recursively and requires actionable meeting/regress contract", async () => {
    const originalCwd = process.cwd();
    const workspace = path.join(tempRoot, "consumer-kimi-mofo-bruto");
    const sptPath = await writeFakeSpt(workspace, "Validacao consumidor mofo bruto");
    await mkdir(path.join(workspace, "tema"), { recursive: true });
    await writeFile(path.join(workspace, "tema", "memoria.md"), "# Memoria sem L1\n\n## Aprendizado\n", "utf8");

    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Validacao consumidor mofo bruto",
      idempotency_key: "dex-code:test-fiscal-consumer-mofo-bruto",
      evidence_required: true,
      required_evidence: ["evidencia sintetica controlada"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code-kimi"
    });
    assertNoFalseGreenDirectAction(started, "goal_start");
    const flowId = started.flow_id as string;
    const initialStatus = await engine.goalStatus({ flow_id: flowId });
    expect(initialStatus.librarian_status).toMatchObject({
      bibliotecario: { status: "disabled", functional_tested: false },
      graphify: { status: "disabled", functional_tested: false },
      functional_tested: false
    });

    const evidence = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "synthetic_controlled_evidence",
      title: "evidencia sintetica controlada consumidor",
      content: "Data/hora: 2026-06-02; origem: teste; objetivo: validar fiscal; SPT e Flow identificados.",
      satisfies: ["evidencia sintetica controlada"]
    });
    assertNoFalseGreenDirectAction(evidence, "evidence_add_pre_block");

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Validacao consumidor nao pode aceitar ausencia material dos fiscais.",
        evidence_ids: [evidence.evidence_id as string],
        residual_risks: [
          "sem reuniao divergente/convergente/transversal",
          "sem revisor-codigo material",
          "sem memoria L1/L2 gerada pelo motor",
          "sem retorno visual Bibliotecario/Graphify",
          "hygiene_scan ainda nao consumido como bloqueador"
        ],
        next_step: "regressar antes de positivo"
      })
    ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED.*required_cooperation.*memory_required_but_empty.*review_required.*librarian_status/i);

    process.chdir(workspace);
    try {
      const hygiene = await engine.hygieneScan(flowId);
      const mined = await engine.mineMemory({ flow_id: flowId, write_policy: "classify_only" });
      const gate = await engine.goalGateCheck({ flow_id: flowId, persist: false });
      const status = await engine.goalStatus({ flow_id: flowId });
      const evidenceAfterBlock = await engine.addGoalEvidence({
        flow_id: flowId,
        kind: "synthetic_controlled_evidence",
        title: "evidencia pos bloqueio",
        content: "pass",
        detail: "full"
      });
      const archived = await engine.archiveFlow({ flow_id: flowId, reason: "teste consumidor mofo bruto finalizado" });

      for (const [label, payload] of Object.entries({ hygiene, mined, gate, status, evidenceAfterBlock, archived })) {
        assertNoFalseGreenDirectAction(payload, label);
      }
      expect(status).toMatchObject({
        status: "blocked",
        meeting_required: true,
        regress_required: true,
        back_to: expect.any(String),
        can_retry_verdict: false,
        next_required_action: {
          type: "open_meeting",
          tool: "goal_meeting_open",
          can_retry_verdict: false,
          required_tool_sequence: expect.arrayContaining([
            expect.objectContaining({ tool: "goal_meeting_open" }),
            expect.objectContaining({ tool: "goal_meeting_add_turn" }),
            expect.objectContaining({ tool: "goal_meeting_close" }),
            expect.objectContaining({ tool: "goal_status" })
          ])
        }
      });
      expect(status.resolution_guidance).toMatchObject({
        loop_guard: expect.stringContaining("required_cooperation"),
        next_required_action: expect.objectContaining({
          required_tool_sequence: expect.arrayContaining([
            expect.objectContaining({ tool: "goal_meeting_close" })
          ])
        })
      });
      expect(status.ppirtv_checkin).toMatchObject({
        initial_adjustment_required: true,
        resolution_guidance: expect.objectContaining({
          summary: expect.stringContaining("can_retry_verdict=false")
        }),
        direct_action: expect.stringContaining("check-in bloqueado:"),
        trail_alignment: {
          workspace,
          spt_path: sptPath,
          goal: "Validacao consumidor mofo bruto",
          evidence_required: true,
          required_evidence_count: 1,
          adjustment_targets: expect.arrayContaining(["mcp_cwd", "workspace", "spt_path", "goal", "required_evidence"])
        },
        components: expect.arrayContaining([
          expect.objectContaining({ name: "ppirtv", visible: true }),
          expect.objectContaining({ name: "coo", visible: true }),
          expect.objectContaining({ name: "bibliotecario", visible: true }),
          expect.objectContaining({ name: "graphify", visible: true }),
          expect.objectContaining({ name: "ppi", visible: true })
        ])
      });
      expect(status.ppirtv_checkout).toMatchObject({
        complete: false,
        status: "blocked",
        resolution_guidance: expect.objectContaining({
          loop_guard: expect.stringContaining("required_cooperation")
        }),
        direct_action: expect.stringContaining("resolution_guidance")
      });
      expect(status.checklist.display.direct_action.action).toContain("Bloqueado:");
      expect(status.checklist.operational_principles).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "casa_limpa", checked: false, state: "blocked" })])
      );
      expect(evidenceAfterBlock.status.checklist.display.direct_action.action).toContain("Bloqueado:");
      expect(archived.display.direct_action.action).toContain("Arquivado com bloqueios preservados");
      expect(archived.display.direct_action.action).not.toMatch(/Gate pronto para avancar|pronto para avancar/i);
      expect(hygiene.hygiene_blocking).toBe(true);
      // BUG 1 (novo contrato): classify_only com 0 strong_unwritten limpa o
      // memory_required_but_empty. Outros blockers persistem.
      expect(mined.memory_required_but_empty).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("T23 distinguishes disabled librarian/Graphify from functionally tested recall", async () => {
    const provider: MemoryGraphProvider = {
      recall: async (input) => ({
        flow_id: input.flow_id,
        phase: input.phase,
        queried_at: new Date().toISOString(),
        warnings: ["graphify_recalled: 1"],
        items: [graphHit(input.question, "Bibliotecario funcional", "src/memory/memory-recall.ts", 20)]
      })
    };
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
    const flow = await graphEngine.createFlow({ goal: "Bibliotecario funcionalmente testado" });

    await graphEngine.advance({ flow_id: flow.flow_id, provided: { context: "ctx", risks: ["r"], uncertainties: ["u"] } });
    const status = await graphEngine.goalStatus({ flow_id: flow.flow_id });

    expect(status.librarian_status).toMatchObject({
      bibliotecario: { status: "recalled", functional_tested: true },
      graphify: { status: "recalled", functional_tested: true },
      functional_tested: true
    });
  });

  it("T24 stops fiscal regress loops after the Chato maximum and requires a decision meeting", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-regress-limit", "Limite de regressos fiscal");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });
    await engine.returnTo({ flow_id: flowId, to: "pensamentos", reason: "regresso fiscal 1" });
    await engine.returnTo({ flow_id: flowId, to: "pensamentos", reason: "regresso fiscal 2" });
    await engine.returnTo({ flow_id: flowId, to: "pensamentos", reason: "regresso fiscal 3" });

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Ainda ha risco material depois dos regressos.",
        evidence_ids: [evidenceId],
        residual_risks: ["mudanca de codigo sem review material"],
        next_step: "tentar voltar de novo"
      })
    ).rejects.toThrow(/review_required/i);

    const status = await engine.goalStatus({ flow_id: flowId });

    expect(status).toMatchObject({
      status: "blocked",
      regress_count: 3,
      max_regressions: 3,
      regress_limit_reached: true,
      regress_required: false,
      can_retry_verdict: false,
      next_required_action: {
        type: "open_decision_meeting",
        tool: "goal_meeting_open",
        can_retry_verdict: false
      }
    });
  });

  it("T25 requires a closed meeting id before retrying a material positive verdict", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-fiscal-meeting-close", "Reuniao obrigatoria material");

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Sem reuniao material fechada nao pode tentar ressalva positiva.",
        evidence_ids: [evidenceId],
        residual_risks: ["sem reuniao divergente/convergente/transversal"],
        next_step: "abrir reuniao"
      })
    ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED.*required_cooperation/i);

    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "divergente",
      question: "E SE aceitarmos a ressalva sem mesa material?"
    });
    const meetingId = opened.meeting_id as string;
    await engine.goalMeetingAddTurn({
      flow_id: flowId,
      meeting_id: meetingId,
      speaker: "chato",
      question: "Qual evidencia material libera nova tentativa?",
      finding: "Precisa decisao registrada e participantes minimos."
    });
    const statusWithOpenMeeting = await engine.goalStatus({ flow_id: flowId });
    expect(statusWithOpenMeeting.next_required_action).toMatchObject({
      type: "close_existing_meeting",
      tool: "goal_meeting_close",
      meeting_id: meetingId,
      required_satisfies_blockers: ["required_cooperation"],
      loop_guard: expect.stringContaining("nao chamar goal_verdict")
    });
    expect((statusWithOpenMeeting.next_required_action as { required_tool_sequence: Array<Record<string, unknown>> }).required_tool_sequence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "goal_meeting_add_turn" }),
        expect.objectContaining({ tool: "goal_meeting_close" }),
        expect.objectContaining({ tool: "goal_status" })
      ])
    );
    expect((statusWithOpenMeeting.next_required_action as { required_tool_sequence: Array<Record<string, unknown>> }).required_tool_sequence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: "goal_meeting_open" })])
    );
    const insufficient = await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: meetingId,
      participants_present: ["chato"],
      decision: "Nao liberar; faltam participantes minimos.",
      satisfies_blockers: ["required_cooperation"]
    });

    expect(insufficient.satisfies_blockers).not.toContain("required_cooperation");
    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Ainda tentando sem participantes minimos.",
        evidence_ids: [evidenceId],
        residual_risks: ["sem reuniao divergente/convergente/transversal"],
        meeting_id: meetingId,
        next_step: "bloquear"
      })
    ).rejects.toThrow(/required_cooperation/i);

    const reopened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "convergente",
      question: "Quem fecha a decisao material?",
      participants_required: ["chato", "questionador", "reuniao", "validador-pronto"]
    });
    const goodMeetingId = reopened.meeting_id as string;
    const closed = await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: goodMeetingId,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
      findings: ["Ressalva material exige mesa fechada antes de nova tentativa."],
      decision: "Reuniao material fechada; required_cooperation satisfeito.",
      satisfies_blockers: ["required_cooperation"]
    });
    const status = await engine.goalStatus({ flow_id: flowId });

    expect(closed).toMatchObject({
      status: "closed",
      kind: "convergente",
      decision: "Reuniao material fechada; required_cooperation satisfeito.",
      satisfies_blockers: expect.arrayContaining(["required_cooperation"])
    });
    expect(status.meetings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meeting_id: goodMeetingId,
          kind: "convergente",
          status: "closed",
          participants_present: expect.arrayContaining(["chato", "questionador", "reuniao", "validador-pronto"]),
          decision: expect.stringContaining("required_cooperation")
        })
      ])
    );
  });

  it("T25b reconciles review_required after explicit code review evidence without opening another meeting", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-review-required-reconcile", "Review fiscal explicito");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "convergente",
      question: "A cooperacao material libera o veredito sem review?"
    });
    const meetingId = opened.meeting_id as string;
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: meetingId,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto", "revisor-codigo"],
      findings: ["Cooperacao material satisfeita; review explicito ainda precisa existir."],
      decision: "Fechar required_cooperation e exigir review antes de novo veredito.",
      satisfies_blockers: ["required_cooperation"]
    });

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Mudanca de codigo com risco material ainda sem review explicito.",
        evidence_ids: [evidenceId],
        residual_risks: ["review ainda nao anexado"],
        meeting_id: meetingId,
        next_step: "anexar review"
      })
    ).rejects.toThrow(/review_required/i);

    const blocked = await engine.goalStatus({ flow_id: flowId });
    expect(blocked.blockers).toContain("review_required");
    expect(blocked.next_required_action).toMatchObject({
      type: "attach_review",
      tool: "evidence_add",
      loop_guard: expect.stringContaining("nao abrir nova reuniao"),
      required_tool_sequence: expect.arrayContaining([
        expect.objectContaining({
          tool: "evidence_add",
          args: expect.objectContaining({
            satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
            observed_result: expect.objectContaining({
              reviewed_targets: ["src/flow-engine.ts"],
              searched_patterns: expect.any(Array),
              findings: expect.any(Array),
              regression_risks: expect.any(Array)
            }),
            scope_classification: "target",
            scope_reference: "src/flow-engine.ts"
          })
        }),
        expect.objectContaining({ tool: "goal_status" }),
        expect.objectContaining({ tool: "goal_verdict", only_if: expect.stringContaining("review_required") })
      ])
    });
    expect((blocked.next_required_action as { required_tool_sequence: Array<Record<string, unknown>> }).required_tool_sequence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: "goal_meeting_open" })])
    );

    const evidenceResult = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Revisao adversarial dos artefatos finais",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      content: "Review feito sobre src/flow-engine.ts. Achado: blocker antigo nao deve ser preservado apos evidencia. Decisao: liberar nova checagem.",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: { diff_reviewed: true, reviewed_targets: ["src/flow-engine.ts"], barata_scan: true, searched_patterns: ["fiscal blocker neighbors"], findings: [], regression_risks: ["blocker fiscal stale"] },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts",
      detail: "full"
    });
    const evidenceStatus = evidenceResult.status as Record<string, unknown>;
    const evidenceBlockers = evidenceStatus.blockers as string[];
    const nestedCheckout = evidenceStatus.ppirtv_checkout as Record<string, unknown>;

    expect(evidenceBlockers).not.toContain("review_required");
    expect(evidenceStatus.status).toBe(evidenceBlockers.length > 0 ? "blocked" : "active");
    expect(nestedCheckout.status).toBe(evidenceStatus.status);

    const resolved = await engine.goalStatus({ flow_id: flowId });

    expect(resolved.blockers).not.toContain("review_required");
    expect(resolved.next_required_action).not.toMatchObject({ type: "attach_review" });
    expect(resolved.ppirtv_checkout).toMatchObject({
      resolution_guidance: resolved.blockers.length > 0 ? expect.any(Object) : null
    });

    await engine.updateFlowFacts(flowId, { changed_files: ["src/server.ts"] });
    const staleReview = await engine.goalStatus({ flow_id: flowId });

    expect(staleReview.blockers).toContain("review_required");
    expect(staleReview.next_required_action).toMatchObject({ type: "attach_review" });
  });

  it("T25c escalates repeated fiscal review loops by loop_id without relying on elapsed time", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-review-loop-escalation", "Escalonamento de loop fiscal");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });

    await repeatFiscalBlock(flowId, evidenceId, 3);
    const atThree = await engine.goalStatus({ flow_id: flowId });
    expect(atThree.loop_monitor).toMatchObject({
      count: 3,
      escalation: { active: true, level: "convergence_transversal", threshold: 3 }
    });
    expect(atThree.next_required_action).toMatchObject({
      type: "convergence_transversal_meetings",
      required_tool_sequence: expect.arrayContaining([
        expect.objectContaining({ tool: "goal_meeting_open", args: expect.objectContaining({ kind: "convergente" }) }),
        expect.objectContaining({ tool: "goal_meeting_open", args: expect.objectContaining({ kind: "transversal" }) })
      ])
    });

    await repeatFiscalBlock(flowId, evidenceId, 2);
    const atFive = await engine.goalStatus({ flow_id: flowId });
    expect(atFive.loop_monitor).toMatchObject({ count: 5, escalation: { level: "divergence_transversal", threshold: 5 } });
    expect(atFive.next_required_action).toMatchObject({
      type: "divergence_transversal_meetings",
      required_tool_sequence: expect.arrayContaining([
        expect.objectContaining({ tool: "goal_meeting_open", args: expect.objectContaining({ kind: "divergente" }) }),
        expect.objectContaining({ tool: "goal_meeting_open", args: expect.objectContaining({ kind: "transversal" }) })
      ])
    });

    await repeatFiscalBlock(flowId, evidenceId, 1);
    const atSix = await engine.goalStatus({ flow_id: flowId });
    expect(atSix.loop_monitor).toMatchObject({ count: 6, escalation: { level: "research_subagent", threshold: 6 } });
    expect(atSix.next_required_action).toMatchObject({
      type: "research_subagent_request",
      required_tool_sequence: expect.arrayContaining([
        expect.objectContaining({
          tool: "subagent_research_request",
          skill_resolution: expect.objectContaining({
            required_skill: "pesquisador-organizado",
            lookup_paths: [
              "$env:USERPROFILE\\.agents\\skills\\pesquisador-organizado\\SKILL.md",
              "$env:USERPROFILE\\.codex\\skills\\pesquisador-organizado\\SKILL.md",
              expect.stringContaining(".agents\\skills\\pesquisador-organizado\\SKILL.md")
            ],
            if_missing: expect.objectContaining({
              action: "create_local_skill",
              target: expect.stringContaining(".agents\\skills\\pesquisador-organizado\\SKILL.md"),
              role: expect.stringContaining("Pesquisador Organizado local")
            }),
            fallback: expect.objectContaining({
              merit_rule: expect.stringContaining("nao vira merito automatico")
            })
          })
        })
      ])
    });

    await repeatFiscalBlock(flowId, evidenceId, 2);
    const atEight = await engine.goalStatus({ flow_id: flowId });
    expect(atEight.loop_monitor).toMatchObject({ count: 8, escalation: { level: "emergency_meeting", threshold: 8 } });
    expect(atEight.next_required_action).toMatchObject({ type: "emergency_meeting" });

    await repeatFiscalBlock(flowId, evidenceId, 1);
    const atNine = await engine.goalStatus({ flow_id: flowId });
    expect(atNine.loop_monitor).toMatchObject({ count: 9, escalation: { level: "bad_loop_review_work", threshold: 9 } });
    expect(atNine.next_required_action).toMatchObject({
      type: "bad_loop_review_work",
      required_tool_sequence: expect.arrayContaining([
        expect.objectContaining({ tool: "use_skill", args: expect.objectContaining({ skill: "estacionamento" }) }),
        expect.objectContaining({
          tool: "use_skill",
          args: expect.objectContaining({ skill: "garimpeiro" }),
          skill_resolution: expect.objectContaining({
            lookup_paths: expect.arrayContaining([
              "$env:USERPROFILE\\.agents\\skills\\garimpeiro\\SKILL.md",
              "$env:USERPROFILE\\.codex\\skills\\garimpeiro\\SKILL.md",
              expect.stringContaining(".agents\\skills\\garimpeiro\\SKILL.md")
            ]),
            if_missing: expect.objectContaining({ action: "execute_inline_fallback_or_create_local_skill_proposal" }),
            fallback: expect.objectContaining({ merit_rule: expect.stringContaining("nao vira merito automatico") })
          })
        }),
        expect.objectContaining({ tool: "evidence_add", args: expect.objectContaining({ title: "LOOP RUIM REVISAR TRABALHO" }) })
      ])
    });
  });

  it("T25d resets loop count after progress and starts a new blocker signature at one", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-review-loop-reset", "Reset de loop fiscal");
    await engine.updateFlowFacts(flowId, { changed_files: ["src/flow-engine.ts"] });
    await repeatFiscalBlock(flowId, evidenceId, 3);
    const beforeReset = await engine.goalStatus({ flow_id: flowId });
    const oldLoopId = (beforeReset.loop_monitor as Record<string, unknown>).loop_id;
    expect(beforeReset.loop_monitor).toMatchObject({ count: 3, escalation: { active: true } });

    const review = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review explicito reseta loop antigo",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      content: "Review feito sobre src/flow-engine.ts. Achado real registrado; review_required nao deve continuar contando.",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: { diff_reviewed: true, reviewed_targets: ["src/flow-engine.ts"], barata_scan: true, searched_patterns: ["loop fiscal neighbors"], findings: [], regression_risks: ["loop fiscal stale"] },
      scope_classification: "target",
      scope_reference: "src/flow-engine.ts"
    });
    const afterProgress = await engine.goalStatus({ flow_id: flowId });
    expect(afterProgress.blockers).not.toContain("review_required");
    expect(afterProgress.loop_monitor).toMatchObject({ count: 0, escalation: { active: false } });

    await repeatFiscalBlock(flowId, review.evidence_id as string, 1);
    const nextError = await engine.goalStatus({ flow_id: flowId });
    expect(nextError.loop_monitor).toMatchObject({ count: 1, escalation: { active: false } });
    expect((nextError.loop_monitor as Record<string, unknown>).loop_id).not.toEqual(oldLoopId);
  });

  it("T25e escalates repeated blocked gate checks with the same review missing", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-review-gate-loop-escalation", "Escalonamento de gate de revisao");
    await engine.goalAdvance({ flow_id: flowId, provided: { context: "ctx", risks: ["risco"], uncertainties: ["u"] } });
    await engine.goalAdvance({
      flow_id: flowId,
      provided: { scope_in: ["src"], scope_out: ["fora"], tasks: ["codar"], expected_evidence: ["review"], done_criteria: ["passar"] }
    });
    await engine.goalAdvance({ flow_id: flowId, provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] } });

    let gate: Record<string, unknown> = {};
    for (let index = 0; index < 3; index += 1) {
      gate = await engine.goalGateCheck({
        flow_id: flowId,
        phase: "revisao",
        provided: { diff_reviewed: true, barata_scan: true, regression_risks: ["risco de regressao"], changed_files: ["src/flow-engine.ts"] }
      });
    }

    expect(gate.missing).toContain("review_evidence_coherent");
    expect(gate.loop_monitor).toMatchObject({
      count: 3,
      gate_block_count: 3,
      escalation: { active: true, level: "convergence_transversal", threshold: 3 }
    });
    const status = await engine.goalStatus({ flow_id: flowId });
    expect(status.next_required_action).toMatchObject({ type: "convergence_transversal_meetings" });
    const checkout = status.ppirtv_checkout as Record<string, unknown>;
    const loopAccountability = checkout.loop_accountability as Record<string, unknown>;
    const prestacao = checkout.prestacao_de_contas as Record<string, unknown>;

    expect(loopAccountability).toMatchObject({
      current_count: 3,
      gate_checks_count: expect.any(Number),
      blocked_gate_checks_count: expect.any(Number),
      loop_meetings_count: 0,
      research_reports_count: 0,
      bad_loop_reports_count: 0,
      current_escalation: { active: true, level: "convergence_transversal", threshold: 3 },
      organized_recovery_ladder: expect.arrayContaining([
        expect.objectContaining({ count: 3, action: "reuniao_convergente_transversal" }),
        expect.objectContaining({ count: 6, action: "pesquisador_organizado_subagente" }),
        expect.objectContaining({ count: 9, action: "estacionamento_garimpeiro_loop_ruim_revisar_trabalho" })
      ])
    });
    expect((loopAccountability.current as Record<string, unknown>).gate_block_count).toBe(3);
    expect(loopAccountability.blocked_gate_checks_count as number).toBeGreaterThanOrEqual(3);
    expect(loopAccountability.blocked_gate_checks_by_signature as Array<Record<string, unknown>>).toEqual(
      expect.arrayContaining([expect.objectContaining({ signature: "review_evidence_coherent", count: 3 })])
    );
    expect(prestacao.loops).toEqual(loopAccountability);
  });

  it("T26 persists goal_regress and consumes reported regress_count before requiring decision meeting", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-goal-regress-tool", "Regresso fiscal auditavel");

    const regressed = await engine.goalRegress({
      flow_id: flowId,
      to: "pensamentos",
      reason: "regresso material antes da decisao"
    });
    expect(regressed.regressed).toBe(true);
    expect(regressed.regress_count).toBe(1);

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Erro recorrente com regress_count informado pelo consumidor.",
        evidence_ids: [evidenceId],
        residual_risks: ["erro recorrente ainda sem decisao"],
        regress_count: 3,
        next_step: "abrir decisao"
      })
    ).rejects.toThrow(/attempt_regress_count|required_cooperation/i);

    const status = await engine.goalStatus({ flow_id: flowId });
    expect(status).toMatchObject({
      regress_count: 3,
      regress_limit_reached: true,
      locked_by_limit: true,
      next_required_action: {
        type: "open_decision_meeting",
        meeting_kind: "decisao",
        locked_by_limit: true
      }
    });
  });

  it("T26b blocks a positive retry at the regress limit even after a material meeting", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-regress-limit-after-meeting", "Limite vence reuniao parcial");
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "convergente",
      question: "A mesa parcial libera tentativa positiva depois de tres regressos?",
      participants_required: ["chato", "questionador", "reuniao", "validador-pronto"]
    });
    const meetingId = opened.meeting_id as string;
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: meetingId,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
      findings: ["A reuniao satisfaz cooperacao, mas nao substitui decisao anti-loop."],
      decision: "Satisfazer required_cooperation; limite de regressos ainda exige decisao.",
      satisfies_blockers: ["required_cooperation"]
    });

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Erro recorrente depois de tres regressos nao pode virar ressalva comum.",
        evidence_ids: [evidenceId],
        residual_risks: ["erro recorrente de produto ainda sem reuniao de decisao"],
        meeting_id: meetingId,
        regress_count: 3,
        next_step: "abrir decisao"
      })
    ).rejects.toThrow(/attempt_regress_count/i);

    const status = await engine.goalStatus({ flow_id: flowId });
    expect(status).toMatchObject({
      status: "blocked",
      regress_limit_reached: true,
      locked_by_limit: true,
      next_required_action: {
        type: "open_decision_meeting",
        meeting_kind: "decisao",
        can_retry_verdict: false
      }
    });
  });

  it("T27 check-in treats configured empty Graphify as tested while fiscal risk still blocks recall absence", async () => {
    const previousGraphifyRecall = process.env.PPIRTV_GRAPHIFY_RECALL;
    process.env.PPIRTV_GRAPHIFY_RECALL = "1";
    const provider: MemoryGraphProvider = {
      recall: async (input) => ({
        flow_id: input.flow_id,
        phase: input.phase,
        queried_at: new Date().toISOString(),
        warnings: ["graphify_enabled_without_hits"],
        items: []
      })
    };
    try {
      const graphEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
      const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-graphify-checkin", "Graphify check-in funcional", graphEngine);

      await graphEngine.advance({ flow_id: flowId, provided: { context: "ctx", risks: ["bibliotecario graphify"], uncertainties: ["u"] } });
      await expect(
        graphEngine.goalVerdict({
          flow_id: flowId,
          status: "pronto_com_ressalvas",
          rationale: "Sem retorno visual Bibliotecario/Graphify funcional.",
          evidence_ids: [evidenceId],
          residual_risks: ["sem retorno visual Bibliotecario/Graphify"],
          next_step: "corrigir check-in"
        })
      ).rejects.toThrow(/librarian_status/i);

      const status = await graphEngine.goalStatus({ flow_id: flowId });
      expect(status.librarian_status).toMatchObject({
        graphify: {
          enabled: true,
          configured: true,
          status: "empty",
          functional_tested: true
        }
      });
      expect(status.ppirtv_checkin).toMatchObject({
        mode: "goal_fiscal_blocked",
        blockers: expect.arrayContaining(["librarian_status"]),
        components: expect.arrayContaining([
          expect.objectContaining({
            name: "graphify",
            configured: true,
            functional_required: true,
            functional_tested: true,
            needs_adjustment: false
          })
        ])
      });
      expect((status.ppirtv_checkin as { blockers: string[] }).blockers).not.toContain("graphify_config_mismatch");
    } finally {
      if (previousGraphifyRecall === undefined) {
        delete process.env.PPIRTV_GRAPHIFY_RECALL;
      } else {
        process.env.PPIRTV_GRAPHIFY_RECALL = previousGraphifyRecall;
      }
    }
  });

  it("does not block a positive P1 verdict for librarian_status when Graphify/Bibliotecario is explicitly out of scope", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-librarian-p2-out-of-scope",
      "Executar P1 sem exigir Graphify P2"
    );
    const flow = await engine.store.loadFlow(flowId);
    flow.scope.out = Array.from(new Set([...flow.scope.out, "Graphify/Bibliotecario P2/out-of-scope nesta rodada P1"]));
    await engine.store.saveFlow(flow);
    const meeting = await engine.goalMeetingOpen({
      flow_id: flowId,
      type: "decision",
      question: "Graphify P2 deve bloquear P1?"
    });
    const meetingId = meeting.meeting_id as string;
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: meetingId,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
      findings: ["Graphify/Bibliotecario foi declarado fora do corte P1 no scope_out."],
      decision: "Fechar P1 com ressalva rastreada; Graphify fica estacionado para rodada P2.",
      satisfies_blockers: ["required_cooperation"]
    });

    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "P1 validado; Graphify/Bibliotecario permanece P2/out-of-scope conforme scope_out.",
      evidence_ids: [evidenceId],
      residual_risks: ["Graphify/Bibliotecario P2/out-of-scope, estacionado para rodada propria."],
      meeting_id: meetingId,
      next_step: "Retomar Graphify quando abrir o SPT P2 de grafo/bibliotecario."
    });

    expect(verdict.verdict).toMatchObject({ status: "pronto_com_ressalvas" });
    expect((verdict.status as { blockers: string[] }).blockers).not.toContain("librarian_status");
  });

  it("T27b goal_status probes Graphify when configured even before goal_advance", async () => {
    const previousGraphifyRecall = process.env.PPIRTV_GRAPHIFY_RECALL;
    process.env.PPIRTV_GRAPHIFY_RECALL = "1";
    const provider: MemoryGraphProvider = {
      recall: async (input) => ({
        flow_id: input.flow_id,
        phase: input.phase,
        queried_at: new Date().toISOString(),
        warnings: [],
        items: [graphHit(input.question, "checkout accountability", ".agents/PLAN-TASKS/checkout.md", 8)]
      })
    };
    try {
      const graphEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
      const { flowId } = await startGoalWithEvidence("dex-code:test-graphify-status-probe", "Graphify status probe sem advance", graphEngine);

      const status = await graphEngine.goalStatus({ flow_id: flowId });
      const ledger = await graphEngine.store.readLedger(flowId);

      expect(status.librarian_status).toMatchObject({
        graphify: {
          enabled: true,
          configured: true,
          status: "recalled",
          functional_tested: true
        },
        functional_tested: true
      });
      expect(ledger.map((event) => event.type)).toContain("memory_recalled");
    } finally {
      if (previousGraphifyRecall === undefined) {
        delete process.env.PPIRTV_GRAPHIFY_RECALL;
      } else {
        process.env.PPIRTV_GRAPHIFY_RECALL = previousGraphifyRecall;
      }
    }
  });

  it("T-RECALL-CONSUMPTION separates automatic recall from explicitly confirmed Graphify consumption", async () => {
    const previousGraphifyRecall = process.env.PPIRTV_GRAPHIFY_RECALL;
    process.env.PPIRTV_GRAPHIFY_RECALL = "1";
    const graphPath = ".agents/PLAN-TASKS/graphify-consumption.md";
    const provider: MemoryGraphProvider = {
      recall: async (input) => ({
        flow_id: input.flow_id,
        phase: input.phase,
        queried_at: new Date().toISOString(),
        warnings: [],
        items: [graphHit(input.question, "Graphify consumption contract", graphPath, 9)]
      })
    };
    try {
      const graphEngine = new FlowEngine(new PpirtvStore(tempRoot, { fixtureOnlyNoncanonicalRoot: true }), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
      const { flowId } = await startGoalWithEvidence("dex-code:test-recall-consumption", "Separar recall de consumo", graphEngine);

      const recalledOnly = await graphEngine.goalStatus({ flow_id: flowId });
      const recalledLibrarian = recalledOnly.librarian_status as Record<string, any>;
      const recalledCheckout = recalledOnly.ppirtv_checkout as Record<string, any>;
      expect(recalledLibrarian).toMatchObject({
        recall_executed: true,
        consumption_confirmed: false,
        graphify: {
          recall_executed: true,
          consumption_confirmed: false
        }
      });
      expect(recalledCheckout.librarian_accountability).toMatchObject({
        worked: false,
        recall_executed: true,
        consumption_confirmed: false,
        graphify_worked: false,
        graphify_recall_executed: true
      });

      await expect(
        graphEngine.goalAdvance({
          flow_id: flowId,
          provided: {},
          recall_consumption: {
            references: ["invented-memory.md"],
            graphify_references: ["invented-memory.md"]
          }
        })
      ).rejects.toThrow(/RECALL_CONSUMPTION_UNKNOWN_REFERENCES|GRAPHIFY_CONSUMPTION_UNKNOWN_REFERENCES/);
      const afterRejectedConsumption = await graphEngine.goalStatus({ flow_id: flowId });
      expect((afterRejectedConsumption.librarian_status as Record<string, any>).consumption_confirmed).toBe(false);

      await graphEngine.goalAdvance({
        flow_id: flowId,
        provided: { context: "ctx", risks: ["risco"], uncertainties: ["u"] }
      });
      await graphEngine.goalAdvance({
        flow_id: flowId,
        provided: {
          scope_in: ["src"],
          scope_out: ["fora"],
          tasks: ["usar recall"],
          expected_evidence: ["teste"],
          done_criteria: ["consumo confirmado"]
        }
      });

      const blockedAdvance = await graphEngine.goalAdvance({
        flow_id: flowId,
        provided: {},
        recall_consumption: {
          references: [graphPath],
          graphify_references: [graphPath],
          note: "A referencia Graphify foi aberta e usada para decidir o gate atual."
        },
        detail: "full"
      });
      const consumedStatus = blockedAdvance.status_snapshot as Record<string, any>;
      expect(blockedAdvance.blocked).toBe(true);
      expect(consumedStatus.phase).toBe("implementacao");
      expect(consumedStatus.librarian_status).toMatchObject({
        recall_executed: true,
        consumption_confirmed: true,
        graphify: {
          recall_executed: true,
          consumption_confirmed: true
        }
      });
      expect((consumedStatus.ppirtv_checkout as Record<string, any>).librarian_accountability).toMatchObject({
        worked: true,
        recall_executed: true,
        consumption_confirmed: true,
        graphify_worked: true
      });

      const repeatedAdvance = await graphEngine.goalAdvance({
        flow_id: flowId,
        provided: {},
        recall_consumption: {
          references: [graphPath],
          graphify_references: [graphPath],
          note: "Retry da mesma decisao."
        },
        detail: "lean"
      });
      expect(repeatedAdvance.recall_consumption).toMatchObject({ reused: true });
      const consumptionEvents = (await graphEngine.store.readLedger(flowId)).filter((event) => event.type === "memory_recall_consumed");
      expect(consumptionEvents).toHaveLength(1);
    } finally {
      if (previousGraphifyRecall === undefined) {
        delete process.env.PPIRTV_GRAPHIFY_RECALL;
      } else {
        process.env.PPIRTV_GRAPHIFY_RECALL = previousGraphifyRecall;
      }
    }
  });

  it("records idempotent monotonic work progress with bounded retention", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-work-progress", "Progresso estruturado");
    const first = await engine.recordGoalProgress({
      flow_id: flowId,
      event_key: "graphify-chunk-1",
      source: "graphify",
      operation: "deep-extract",
      stage: "chunks",
      current: 1,
      total: 4,
      status: "running"
    });
    const reused = await engine.recordGoalProgress({
      flow_id: flowId,
      event_key: "graphify-chunk-1",
      source: "graphify",
      operation: "deep-extract",
      stage: "chunks",
      current: 1,
      total: 4,
      status: "running"
    });
    const throttled = await engine.recordGoalProgress({
      flow_id: flowId,
      event_key: "graphify-chunk-1-alias",
      source: "graphify",
      operation: "deep-extract",
      stage: "chunks",
      current: 1,
      total: 4,
      status: "running"
    });
    expect(first).toMatchObject({ recorded: true, reused: false, throttled: false });
    expect(reused).toMatchObject({ recorded: false, reused: true, reason: "event_key_reused" });
    expect(throttled).toMatchObject({ recorded: false, throttled: true, reason: "no_material_change" });

    await expect(engine.recordGoalProgress({
      flow_id: flowId,
      event_key: "graphify-total-mismatch",
      source: "graphify",
      operation: "deep-extract",
      stage: "chunks",
      current: 2,
      total: 5,
      status: "running"
    })).rejects.toThrow(/PROGRESS_TOTAL_MISMATCH/);

    const seeded = await engine.store.loadFlow(flowId);
    for (let index = 1; index <= 100; index += 1) {
      seeded.history.push({
        at: new Date().toISOString(),
        type: "work_progress_recorded",
        data: {
          progress_id: `seed-${index}`,
          event_key: `retention-${index}`,
          source: "graphify",
          operation: "retention-probe",
          stage: "chunks",
          current: index,
          total: 200,
          percent: index / 2,
          status: "running",
          recorded_at: new Date().toISOString()
        }
      });
    }
    await engine.store.saveFlow(seeded);
    const capped = await engine.recordGoalProgress({
      flow_id: flowId,
      event_key: "retention-101",
      source: "graphify",
      operation: "retention-probe",
      stage: "chunks",
      current: 101,
      total: 200,
      status: "running"
    });
    const terminal = await engine.recordGoalProgress({
      flow_id: flowId,
      event_key: "retention-completed",
      source: "graphify",
      operation: "retention-probe",
      stage: "completed",
      current: 200,
      total: 200,
      status: "completed"
    });
    expect(capped).toMatchObject({ recorded: false, throttled: true, reason: "retention_limit" });
    expect(terminal).toMatchObject({ recorded: true, progress_event: { status: "completed", current: 200 } });
    const stored = await engine.store.loadFlow(flowId);
    expect(stored.history.filter((event) => event.type === "work_progress_recorded" && event.data.operation === "retention-probe")).toHaveLength(101);
  });

  it("T28 check-out of archived blocked flow preserves blockers instead of closing total", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence("dex-code:test-checkout-archive-blocked", "Archive bloqueado");
    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Bloqueado sem reuniao material.",
        evidence_ids: [evidenceId],
        residual_risks: ["sem reuniao divergente/convergente/transversal"],
        next_step: "arquivar bloqueado"
      })
    ).rejects.toThrow(/required_cooperation/i);

    const archived = await engine.archiveFlow({ flow_id: flowId, reason: "preservar bloqueio" });
    const ledgerAfterArchive = await engine.store.readLedger(flowId);
    const archiveRetry = await engine.archiveFlow({ flow_id: flowId, reason: "retry" });
    const status = await engine.goalStatus({ flow_id: flowId });

    expect(archived).toMatchObject({
      archived_blocked_flow: true,
      preserved_blockers: expect.arrayContaining(["required_cooperation"])
    });
    expect(archived.display.direct_action.action).toContain("Arquivado com bloqueios preservados");
    expect(archiveRetry).toMatchObject({
      archived_blocked_flow: true,
      preserved_blockers: expect.arrayContaining(["required_cooperation"])
    });
    expect(archiveRetry.display.direct_action.action).toContain("Arquivado com bloqueios preservados");
    expect(await engine.store.readLedger(flowId)).toEqual(ledgerAfterArchive);
    expect(status.ppirtv_checkout).toMatchObject({
      status: "archived",
      direct_action: expect.stringContaining("check-out bloqueado:")
    });
    expect((status.ppirtv_checkout as Record<string, unknown>).direct_action).not.toBe("fechamento_total_registrado");
  });

  it("T29 check-out reports memory layers, garimpo, estacionamento, blind spots, merits and librarian work", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "checkout-accountability-memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const { flowId } = await startGoalWithEvidence("dex-code:test-checkout-accountability", "Prestacao de contas do check-out");
      const opened = await engine.goalMeetingOpen({
        flow_id: flowId,
        kind: "divergente",
        question: "O que precisa aparecer no check-out?"
      });
      await engine.goalMeetingClose({
        flow_id: flowId,
        meeting_id: opened.meeting_id as string,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "Check-out precisa prestar contas sem inventar merito.",
        parking_lot: ["Ponto cego Delphi DUnitX standalone vs provider precisa virar memoria reutilizavel."],
        cooperators: [
          { name: "chato", reason: "cobrou prestacao de contas material no check-out", material: true },
          { name: "garimpeiro", reason: "classificou pepita reutilizavel", material: true }
        ],
        active_credits: ["chato cobrou prestacao de contas material", "garimpeiro classificou pepita reutilizavel"]
      });

      const mined = await engine.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "auto_write" });
      const status = await engine.goalStatus({ flow_id: flowId });
      const checkout = status.ppirtv_checkout as Record<string, unknown>;
      const memory = checkout.memory_accountability as Record<string, unknown>;
      const learning = checkout.learning_accountability as Record<string, unknown>;
      const cooperation = checkout.cooperation_accountability as Record<string, unknown>;
      const librarian = checkout.librarian_accountability as Record<string, unknown>;
      const prestacao = checkout.prestacao_de_contas as Record<string, unknown>;

      expect((mined.written as unknown[]).length).toBeGreaterThan(0);
      expect(memory).toMatchObject({
        written_count: expect.any(Number),
        l1_files: expect.any(Array),
        l2_files: expect.any(Array),
        l3_files: expect.any(Array)
      });
      expect(memory.l1_files as string[]).toEqual(expect.arrayContaining([expect.stringContaining("LEMBRANCA.md")]));
      expect(memory.l2_files as string[]).toEqual(expect.arrayContaining([expect.stringContaining("MEMORIA.md")]));
      expect(learning.garimpado as string[]).toEqual(expect.arrayContaining([expect.stringContaining("DUnitX standalone")]));
      expect(learning.estacionado as string[]).toEqual(expect.arrayContaining([expect.stringContaining("Ponto cego Delphi")]));
      expect(learning.pontos_cegos as string[]).toEqual(expect.arrayContaining([expect.stringContaining("DUnitX standalone")]));
      expect(cooperation).toMatchObject({
        material_count: 2,
        active_credits: expect.arrayContaining(["chato cobrou prestacao de contas material"])
      });
      expect(cooperation.merits as Array<Record<string, unknown>>).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "chato",
            reason: expect.stringContaining("prestacao de contas"),
            merit_source: "recorded_material_cooperator"
          })
        ])
      );
      expect(librarian).toMatchObject({
        worked: false,
        graphify_worked: false,
        status: expect.any(Object)
      });
      expect(prestacao).toMatchObject({
        memoria: memory,
        garimpo: learning.garimpado,
        estacionamento: learning.estacionado,
        pontos_cegos: learning.pontos_cegos,
        cooperadores: cooperation,
        bibliotecario: librarian
      });
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("T30 reconciles classify_only memory candidates with final blockers and archive", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-checkout-memory-reconcile",
      "Reconcilia memoria classify_only no checkout"
    );
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "divergente",
      question: "A memoria foi classificada de verdade?"
    });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
      decision: "Classificacao de memoria com candidatos reais resolve memoria vazia sem escrita canonica.",
      satisfies_blockers: ["required_cooperation"],
      parking_lot: ["Ponto cego PPIRTV classify_only com candidatos nao deve preservar blocker de memoria vazia."],
      cooperators: [
        { name: "chato", reason: "cobrou contradicao entre blockers e accountability", material: true },
        { name: "observador-sugerido-controle", reason: "controle negativo sem contribuicao material", material: false }
      ],
      active_credits: ["chato cobrou contradicao entre blockers e accountability"]
    });

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Risco material sem memoria classificada ainda.",
        evidence_ids: [evidenceId],
        meeting_id: opened.meeting_id as string,
        residual_risks: ["sem memoria L1/L2/L3 ainda"],
        next_step: "rodar mineracao classify_only"
      })
    ).rejects.toThrow(/memory_required_but_empty/i);

    const mined = await engine.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "classify_only" });
    const status = await engine.goalStatus({ flow_id: flowId });
    const archived = await engine.archiveFlow({ flow_id: flowId, reason: "preservar apenas blockers reais" });
    const archivedStatus = await engine.goalStatus({ flow_id: flowId });
    const checkout = archivedStatus.ppirtv_checkout as Record<string, unknown>;
    const memory = checkout.memory_accountability as Record<string, unknown>;
    const cooperation = checkout.cooperation_accountability as Record<string, unknown>;

    expect(mined).toMatchObject({
      write_policy: "classify_only",
      written: [],
      memory_required_but_empty: false
    });
    expect((mined.candidates as unknown[]).length).toBeGreaterThan(0);
    expect(status.blockers as string[]).not.toContain("memory_required_but_empty");
    expect((status.fiscal_policy as Record<string, unknown>).blocking_reasons as string[]).not.toContain("memory_required_but_empty");
    expect((status.ppirtv_checkout as Record<string, unknown>).direct_action as string).not.toContain("memory_required_but_empty");
    expect(archived.preserved_blockers as string[]).not.toContain("memory_required_but_empty");
    expect(memory).toMatchObject({
      required: true,
      mined: true,
      candidates_count: expect.any(Number),
      written_count: 0,
      memory_required_but_empty: false,
      candidates: expect.any(Array)
    });
    expect(memory.candidates_count as number).toBeGreaterThan(0);
    expect((memory.candidates as unknown[]).length).toBeGreaterThan(0);
    expect(cooperation).toMatchObject({ material_count: 1 });
    expect(cooperation.material as Array<Record<string, unknown>>).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "observador-sugerido-controle" })])
    );
    expect(cooperation.merits as Array<Record<string, unknown>>).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "chato",
          merit_source: "recorded_material_cooperator"
        })
      ])
    );
    expect(cooperation.merits as Array<Record<string, unknown>>).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "observador-sugerido-controle" })])
    );
  });

  it("T31 keeps memory_required_but_empty when candidates_count has no candidates list", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-checkout-memory-candidates-missing",
      "Candidatos sem lista nao resolvem memoria"
    );

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Risco material sem memoria classificada.",
        evidence_ids: [evidenceId],
        residual_risks: ["sem memoria L1/L2"],
        next_step: "corrigir accountability"
      })
    ).rejects.toThrow(/memory_required_but_empty/i);

    const flow = await engine.store.loadFlow(flowId);
    flow.memory_mining = {
      required: true,
      last_run_at: new Date().toISOString(),
      blocked_verdict: false,
      candidates_count: 3,
      written_count: 0,
      blocked_count: 0,
      ledger_only_count: 0,
      discarded_count: 0,
      memory_required_but_empty: false
    };
    await engine.store.saveFlow(flow);

    const status = await engine.goalStatus({ flow_id: flowId });
    const archived = await engine.archiveFlow({ flow_id: flowId, reason: "candidatos sem lista continuam bloqueando" });

    expect(status.blockers as string[]).toContain("memory_required_but_empty");
    expect(archived.preserved_blockers as string[]).toContain("memory_required_but_empty");
  });

  it("T32 keeps goal_verdict from auto-writing after explicit classify_only mining", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "classify-only-verdict-memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const { flowId, evidenceId, workspace } = await startGoalWithEvidence(
        "dex-code:test-goal-verdict-classify-only-no-autowrite",
        "Veredito respeita memoria classify_only"
      );
      const opened = await engine.goalMeetingOpen({
        flow_id: flowId,
        kind: "divergente",
        participants_required: ["chato", "questionador", "reuniao", "validador-pronto"],
        question: "O veredito pode escrever memoria sozinho?"
      });
      await engine.goalMeetingClose({
        flow_id: flowId,
        meeting_id: opened.meeting_id as string,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "Veredito deve reutilizar classify_only explicito sem promover para auto_write.",
        satisfies_blockers: ["required_cooperation"],
        parking_lot: ["Aprendizado reutilizavel PPIRTV: goal_verdict nao deve trocar classify_only por auto_write implicito."]
      });

      const mined = await engine.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "classify_only" });
      expect(mined).toMatchObject({
        write_policy: "classify_only",
        written: [],
        memory_required_but_empty: false
      });
      expect((mined.candidates as unknown[]).length).toBeGreaterThan(0);

      const verdict = await engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Risco material ja teve memoria classificada sem escrita canonica.",
        evidence_ids: [evidenceId],
        meeting_id: opened.meeting_id as string,
        residual_risks: ["memoria classificada em classify_only sem escrita automatica"],
        next_step: "validar checkout sem auto_write implicito"
      });
      const status = await engine.goalStatus({ flow_id: flowId });
      const checkout = status.ppirtv_checkout as Record<string, unknown>;
      const memory = checkout.memory_accountability as Record<string, unknown>;

      expect(verdict.memory_mining).toMatchObject({
        write_policy: "classify_only",
        written_count: 0,
        memory_required_but_empty: false
      });
      expect(memory).toMatchObject({
        write_policy: "classify_only",
        written_count: 0,
        memory_required_but_empty: false,
        candidates: expect.any(Array)
      });
      expect(memory.candidates_count as number).toBeGreaterThan(0);
      expect(status.blockers as string[]).not.toContain("memory_required_but_empty");
      await expect(readFile(path.join(memRoot, "temas", "ppirtv", "LEMBRANCA.md"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(memRoot, "temas", "ppirtv", "MEMORIA.md"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(workspace, ".agents", "LEMBRANCA.md"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(workspace, ".agents", "MEMORIA.md"), "utf8")).rejects.toThrow();
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("T32b keeps memory candidate resolution from upgrading classify_only to auto_write", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "classify-only-resolve-memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const { flowId, workspace } = await startGoalWithEvidence(
        "dex-code:test-resolve-classify-only-preserves-policy",
        "Resolver candidato preserva classify_only"
      );
      const opened = await engine.goalMeetingOpen({
        flow_id: flowId,
        kind: "divergente",
        participants_required: ["chato", "questionador", "reuniao", "validador-pronto"],
        question: "Resolver candidato pode escrever memoria automaticamente?"
      });
      await engine.goalMeetingClose({
        flow_id: flowId,
        meeting_id: opened.meeting_id as string,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "Resolver candidato classificado deve preservar a politica classify_only.",
        satisfies_blockers: ["required_cooperation"],
        parking_lot: [
          "Aprendizado reutilizavel PPIRTV: mm_memory_candidate_resolve nao deve trocar classify_only por auto_write implicito.",
          "Aprendizado reutilizavel MCP: destino rastreavel de candidato nao e opt-in para escrita canonica."
        ]
      });

      const mined = await engine.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "classify_only" });
      const candidateIds = (mined.candidates as Array<Record<string, unknown>>).map((candidate) => String(candidate.id)).filter(Boolean);

      expect(candidateIds.length).toBeGreaterThan(0);
      expect(mined).toMatchObject({ write_policy: "classify_only", written: [] });

      const resolved = await engine.resolveMemoryCandidates({
        flow_id: flowId,
        candidate_ids: candidateIds,
        action: "accept_ledger_only",
        rationale: "Classificacao aceita como ledger local; sem opt-in para escrita canonica."
      });
      const resolvedMining = resolved.memory_mining as Record<string, unknown>;
      const status = await engine.goalStatus({ flow_id: flowId });
      const memory = (status.ppirtv_checkout as Record<string, unknown>).memory_accountability as Record<string, unknown>;

      expect(resolvedMining).toMatchObject({
        write_policy: "classify_only",
        written: [],
        resolved_candidate_ids: expect.arrayContaining(candidateIds)
      });
      expect(memory).toMatchObject({ write_policy: "classify_only", written_count: 0 });
      await expect(readFile(path.join(memRoot, "temas", "ppirtv", "LEMBRANCA.md"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(memRoot, "temas", "ppirtv", "MEMORIA.md"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(workspace, ".agents", "LEMBRANCA.md"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(workspace, ".agents", "MEMORIA.md"), "utf8")).rejects.toThrow();
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("uses the fresh goalVerdict flow snapshot when memory mining changes between loads", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-goal-verdict-fresh-memory-snapshot",
      "Veredito usa snapshot fresco de memoria"
    );
    const meeting = await engine.goalMeetingOpen({
      flow_id: flowId,
      type: "convergent",
      question: "Snapshot fresco de memoria bloqueia veredito?"
    });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: meeting.meeting_id as string,
      participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
      decision: "Veredito precisa usar a mesma leitura fresca do flow.",
      satisfies_blockers: ["required_cooperation"]
    });
    const clean = await engine.store.loadFlow(flowId);
    clean.memory_mining = memoryMiningSummary({ blocked_verdict: false, write_policy: "classify_only", strong_unwritten_count: 0 });
    await engine.store.saveFlow(clean);

    const driftStore = new DriftMemoryMiningStore(tempRoot, flowId);
    const driftEngine = new FlowEngine(driftStore);

    await expect(
      driftEngine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Veredito com leitura fresca consistente.",
        evidence_ids: [evidenceId],
        meeting_id: meeting.meeting_id as string,
        residual_risks: [],
        next_step: "arquivar quando status fresco nao listar blockers"
      })
    ).rejects.toThrow(/MEMORY_MINING_BLOCKED_VERDICT/i);
  });

  it("T33 mines review findings, residual risks and evidence from goal_verdict into editable accountability", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "goal-verdict-learning-memories");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const { flowId, evidenceId } = await startGoalWithEvidence(
        "dex-code:test-goal-verdict-learning-accountability",
        "Veredito deve alimentar achados estacionados e candidatos editaveis"
      );
      const opened = await engine.goalMeetingOpen({
        flow_id: flowId,
        kind: "divergente",
        participants_required: ["chato", "questionador", "reuniao", "garimpeiro", "dex-memoria", "estacionamento"],
        question: "Qual destino dos achados fortes do veredito?"
      });
      await engine.goalMeetingClose({
        flow_id: flowId,
        meeting_id: opened.meeting_id as string,
        participants_present: ["chato", "questionador", "reuniao", "garimpeiro", "dex-memoria", "estacionamento"],
        decision: "Achados fortes precisam aparecer no checkout com destino editavel.",
        satisfies_blockers: ["required_cooperation"],
        cooperators: [
          { name: "chato", reason: "cobrou destino dos achados fortes", material: true },
          { name: "garimpeiro", reason: "separou pepita de pendencia", material: true }
        ],
        active_credits: ["chato cobrou destino dos achados", "garimpeiro separou pepita de pendencia"]
      });

      const verdict = await engine.goalVerdict({
        flow_id: flowId,
        status: "nao_pronto",
        rationale: "Harness comparou canonical_examples com cases e criou falso verde no contrato PPIRTV.",
        evidence_ids: [evidenceId],
        meeting_id: opened.meeting_id as string,
        review_findings: [
          "Falso verde: harness v2 validava canonical_examples mas o consumo real usava cases/case_count/results.",
          "Diagnostico de hardware: CPU estava ocupada enquanto RTX 5090 ficava sem uso por configuracao de runtime."
        ],
        residual_risks: ["Risco residual: novo ensaio precisa provar caminho real antes de liberar treino."],
        verdict_parking_lot: ["Pendente: transformar o achado de runtime GPU em checklist de preflight quando houver evidencia suficiente."],
        verdict_gold_mining: ["Dica PPIRTV: falso verde de harness nasce quando exemplo canonico e caminho real divergem."],
        next_step: "rodar classificacao controlada e revisar fila editavel"
      });
      const learning = verdict.verdict_learning as Record<string, unknown>;
      expect(learning.gold_mining as string[]).toEqual(expect.arrayContaining([expect.stringContaining("canonical_examples")]));
      expect(learning.parking_lot as string[]).toEqual(expect.arrayContaining([expect.stringContaining("Evidencia usada no veredito")]));

      const mined = await engine.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "classify_only" });
      const candidates = mined.candidates as Array<Record<string, unknown>>;
      expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ title: expect.stringContaining("canonical_examples") })]));
      expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ title: expect.stringContaining("RTX 5090") })]));
      expect(mined).toMatchObject({
        write_policy: "classify_only",
        written: [],
        blocked_verdict: false,
        edit_queue: expect.any(Array),
        write_decisions: expect.any(Array)
      });
      expect((mined.edit_queue as unknown[]).length).toBeGreaterThan(0);
      expect(mined.write_decisions as Array<Record<string, unknown>>).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: "classify_only", reason: "classify_only_policy_requires_user_review_before_write" })])
      );

      const status = await engine.goalStatus({ flow_id: flowId });
      const checkout = status.ppirtv_checkout as Record<string, unknown>;
      const directCheckout = await engine.goalCheckout({ flow_id: flowId });
      const memory = checkout.memory_accountability as Record<string, unknown>;
      const learningCheckout = checkout.learning_accountability as Record<string, unknown>;
      const utility = checkout.utility_accountability as Record<string, unknown>;
      const learningLinks = learningCheckout.links as Array<Record<string, Record<string, unknown>>>;
      expect(memory.edit_queue as unknown[]).not.toEqual([]);
      expect(learningCheckout.garimpado as string[]).toEqual(expect.arrayContaining([expect.stringContaining("falso verde")]));
      expect(learningCheckout.estacionado as string[]).toEqual(expect.arrayContaining([expect.stringContaining("Evidencia usada no veredito")]));
      expect(learningCheckout.garimpo_por_classificacao as Record<string, number>).toMatchObject({
        armadilha: expect.any(Number),
        nao_promover: expect.any(Number)
      });
      expect(learningLinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            parking_item: expect.stringContaining("Evidencia usada no veredito"),
            garimpo_vinculado: expect.objectContaining({
              classificacao: expect.any(String),
              promovido_para_gold_mining: expect.any(Boolean)
            })
          })
        ])
      );
      expect((learningCheckout.conviccao_fraca_ou_frouxa as string[]).length).toBeGreaterThan(0);
      expect(utility).toMatchObject({
        edit_queue_count: expect.any(Number),
        painel: expect.arrayContaining([expect.stringContaining("M memoria")])
      });
      expect((utility.edit_queue_count as number)).toBeGreaterThan(0);
      expect(directCheckout).toMatchObject({
        flow_id: flowId,
        memory_accountability: expect.any(Object),
        learning_accountability: expect.any(Object),
        cooperation_accountability: expect.any(Object),
        librarian_accountability: expect.any(Object),
        utility_accountability: expect.any(Object),
        prestacao_de_contas: expect.any(Object)
      });
      expect((directCheckout.ppirtv_checkout as Record<string, unknown>).prestacao_de_contas).toEqual(directCheckout.prestacao_de_contas);
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("T34a downgrades pronto to pronto_com_ressalvas when next_step promises future action without quando", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-gate-do-quando-sem-quando",
      "Gate do Quando rebaixa veredito sem quando"
    );
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "divergente",
      participants_required: ["ppi", "chato"],
      question: "O next_step sem quando deve bloquear pronto?"
    });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
      participants_present: ["ppi", "chato"],
      decision: "Gate do Quando deve rebaixar pronto para pronto_com_ressalvas quando next_step promete acao futura sem quando.",
      satisfies_blockers: ["required_cooperation"],
      cooperators: [
        { name: "ppi", reason: "fiscalizou Gate do Quando no veredito", material: true }
      ],
      active_credits: ["ppi fiscalizou Gate do Quando"]
    });

    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Implementacao concluida com evidencias.",
      evidence_ids: [evidenceId],
      meeting_id: opened.meeting_id as string,
      next_step: "implementar correcao depois"
    });
    const vr = verdict.verdict as Record<string, unknown>;
    expect(vr.status).toBe("pronto_com_ressalvas");
    const learning = verdict.verdict_learning as Record<string, unknown>;
    expect(learning.gold_mining as string[]).toEqual(
      expect.arrayContaining([expect.stringContaining("Gate do Quando")])
    );
  });

  it("T34b keeps pronto when next_step has a quando (date/trigger)", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-gate-do-quando-com-quando-data",
      "Gate do Quando respeita quando presente"
    );
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "divergente",
      participants_required: ["ppi", "chato"],
      question: "O next_step com data mantem pronto?"
    });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
      participants_present: ["ppi", "chato"],
      decision: "Gate do Quando nao deve rebaixar quando next_step tem data, gatilho ou responsavel.",
      satisfies_blockers: ["required_cooperation"],
      cooperators: [
        { name: "ppi", reason: "confirmou que data no next_step satisfaz o gate", material: true }
      ],
      active_credits: ["ppi confirmou gate do quando com data"]
    });

    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Implementacao concluida.",
      evidence_ids: [evidenceId],
      meeting_id: opened.meeting_id as string,
      next_step: "implementar correcao na segunda-feira"
    });
    const vr = verdict.verdict as Record<string, unknown>;
    expect(vr.status).toBe("pronto");
  });

  it("path/proveniencia nao ativa memoria sem intencao semantica", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-path-l1-proveniencia-nao-ativa-memoria",
      "Entrega concluida sem pendencias"
    );
    await engine.updateFlowFacts(flowId, { changed_files: ["src/l1-adapter.ts"] });
    const statusBeforeReview = await engine.goalStatus({ flow_id: flowId });
    expect(statusBeforeReview.blockers).not.toContain("memory_required_but_empty");
    expect(statusBeforeReview.blockers).toContain("review_required");
    const review = await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review da proveniencia",
      reviewed_implementation_fingerprint: await currentImplementationFingerprint(flowId),
      content: "Path de arquivo revisado sem inferir intencao semantica.",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        reviewed_targets: ["src/l1-adapter.ts"],
        barata_scan: true,
        searched_patterns: ["path provenance"],
        findings: [],
        regression_risks: ["falso blocker fiscal por path"]
      },
      scope_classification: "target",
      scope_reference: "src/l1-adapter.ts"
    });

    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Entrega concluida e validada.",
      evidence_ids: [evidenceId, review.evidence_id as string],
      next_step: "acompanhar somente se surgir nova falha"
    });

    expect(verdict.verdict).toMatchObject({ status: "pronto" });
  });

  it("contexto humano ainda ativa memoria por intencao semantica", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-contexto-humano-semantico",
      "Entrega concluida sem pendencias"
    );
    const flow = await engine.store.loadFlow(flowId);
    flow.context = "Consolidar memoria L1/L2 para evitar repeticao.";
    await engine.store.saveFlow(flow);

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto",
        rationale: "Entrega concluida e validada.",
        evidence_ids: [evidenceId],
        next_step: "acompanhar somente se surgir nova falha"
      })
    ).rejects.toThrow(/memory_required_but_empty/i);
  });

  it("blocker fiscal historico de memoria permanece ativo", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-blocker-fiscal-historico",
      "Entrega concluida sem pendencias"
    );
    const flow = await engine.store.loadFlow(flowId);
    flow.history.push({
      at: new Date().toISOString(),
      type: "fiscal_policy_blocked",
      data: { memory_required: true, blocking_reasons: ["memory_required_but_empty"] }
    });
    await engine.store.saveFlow(flow);

    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto",
        rationale: "Entrega concluida e validada.",
        evidence_ids: [evidenceId],
        next_step: "acompanhar somente se surgir nova falha"
      })
    ).rejects.toThrow(/memory_required_but_empty/i);
  });

  it("T34c keeps pronto when next_step has a quando (trigger word)", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-gate-do-quando-com-quando-gatilho",
      "Gate do Quando respeita gatilho condicional"
    );
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "divergente",
      participants_required: ["ppi", "chato"],
      question: "O next_step com gatilho condicional mantem pronto?"
    });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
      participants_present: ["ppi", "chato"],
      decision: "Gate do Quando nao deve rebaixar quando next_step tem gatilho condicional.",
      satisfies_blockers: ["required_cooperation"],
      cooperators: [
        { name: "ppi", reason: "confirmou que gatilho condicional satisfaz o gate", material: true }
      ],
      active_credits: ["ppi confirmou gate do quando com gatilho condicional"]
    });

    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Implementacao concluida.",
      evidence_ids: [evidenceId],
      meeting_id: opened.meeting_id as string,
      next_step: "corrigir quando houver nova evidencia de falha"
    });
    const vr = verdict.verdict as Record<string, unknown>;
    expect(vr.status).toBe("pronto");
  });

  it("T34d keeps pronto when next_step is a note without future action", async () => {
    const { flowId, evidenceId } = await startGoalWithEvidence(
      "dex-code:test-gate-do-quando-nota-sem-acao",
      "Gate do Quando ignora nota sem acao futura"
    );
    const opened = await engine.goalMeetingOpen({
      flow_id: flowId,
      kind: "divergente",
      participants_required: ["ppi", "chato"],
      question: "Nota sem verbo de acao deve ser ignorada pelo gate?"
    });
    await engine.goalMeetingClose({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
      participants_present: ["ppi", "chato"],
      decision: "Gate do Quando nao deve interpretar nota descritiva como acao futura.",
      satisfies_blockers: ["required_cooperation"],
      cooperators: [
        { name: "ppi", reason: "confirmou que nota sem acao nao dispara o gate", material: true }
      ],
      active_credits: ["ppi confirmou nota sem acao nao dispara gate"]
    });

    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto",
      rationale: "Sprint concluida. Evidencias anexadas.",
      evidence_ids: [evidenceId],
      meeting_id: opened.meeting_id as string,
      next_step: "sprint finalizada"
    });
    const vr = verdict.verdict as Record<string, unknown>;
    expect(vr.status).toBe("pronto");
  });

  it("T34 blocks auto_write when a strong candidate is left without a canonical destination", async () => {
    const originalDexMemoriaHome = process.env.DEX_MEMORIA_HOME;
    const memRoot = path.join(tempRoot, "strong-unwritten-warnings");
    process.env.DEX_MEMORIA_HOME = memRoot;
    try {
      const { flowId } = await startGoalWithEvidence(
        "dex-code:test-strong-unwritten-memory-warning",
        "Auto write precisa avisar quando nao grava candidato forte"
      );
      await engine.attachEvidence({
        flow_id: flowId,
        kind: "code_review",
        title: "Review de destino de memoria",
        gold_mining: ["ledger_only: contrato PPIRTV com falso verde recorrente precisa destino explicito antes de pronto."]
      });

      const mined = await engine.mineMemory({ flow_id: flowId, auto_classify: true, write_policy: "auto_write" });
      expect(mined).toMatchObject({
        written: [],
        blocked_verdict: true,
        strong_unwritten_count: 1,
        destination_warnings: expect.arrayContaining([expect.stringContaining("ledger_only")])
      });
      expect(mined.write_decisions as Array<Record<string, unknown>>).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: "ledger_only", reason: "ledger_only_needs_better_scope_or_destination" })])
      );

      const status = await engine.goalStatus({ flow_id: flowId });
      const checkout = status.ppirtv_checkout as Record<string, unknown>;
      const memory = checkout.memory_accountability as Record<string, unknown>;
      expect(memory).toMatchObject({
        strong_unwritten_count: 1,
        destination_warnings: expect.arrayContaining([expect.stringContaining("ledger_only")]),
        edit_queue: expect.any(Array)
      });
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
  });

  it("does not validate SPT files outside .agents/PLAN-TASKS", async () => {
    const workspace = path.join(tempRoot, "workspace");
    await mkdir(workspace, { recursive: true });
    const outside = path.join(workspace, "loose-spt.md");
    await writeFile(outside, fakeSptText(), "utf8");

    const validation = await engine.validateSpt({ workspace, spt_path: outside, objective: "Solto" });

    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain("spt_under_plan_tasks");
  });

  it("renders only the current phase by default and keeps the full checklist explicit", async () => {
    const flow = await engine.createFlow({
      goal: "Checklist visual",
      context: "ctx",
      risks: ["risco"],
      uncertainties: ["lacuna"]
    });

    const checklist = await engine.renderChecklist(flow.flow_id);

    expect(checklist.markdown).toBeUndefined();
    expect(checklist.items.length).toBeGreaterThan(0);
    expect(checklist.display.phase_label).toBe("Pensamentos");
    expect(checklist.display.phase_emoji).toBe("🧠");
    expect(checklist.display.checklist_visual?.[0]).toHaveProperty("emoji");
    expect(checklist.operational_principles).toBeUndefined();
    expect(checklist.default_workflow).toBeUndefined();
    expect(checklist.aliases.estacionamento).toEqual([]);
    expect(checklist.aliases.garimpo).toEqual([]);

    const fullChecklist = await engine.renderChecklist(flow.flow_id, "full");
    expect(fullChecklist.markdown).toContain("Checklist PPIRTV");
    expect(fullChecklist.operational_principles?.some((item) => item.id === "memoria_sem_lembranca")).toBe(true);
    expect(fullChecklist.operational_principles?.find((item) => item.id === "casa_limpa")?.label).toContain("ouro");
    expect(fullChecklist.display.checklist_visual?.length).toBeGreaterThan(fullChecklist.items.length);
    expect(fullChecklist.default_workflow?.short_line).toContain("P🧠 Pensamentos");
  });

  it("loads editable operational principles into prompts", () => {
    const prompt = promptText("clean-house-review", { flow_id: "flow_demo" });

    expect(prompt).toContain("Principios operacionais");
    expect(prompt).toContain("L1");
    expect(prompt).toContain("L2");
    expect(prompt).toContain("L3");
    expect(prompt).toContain("Nao podemos jogar ouro no lixo");
    expect(prompt).toContain("flow_demo");
  });

  it("finds memory L2 without L1 during hygiene scan", async () => {
    const originalCwd = process.cwd();
    await mkdir(path.join(tempRoot, "php"), { recursive: true });
    await writeFile(path.join(tempRoot, "php", "memoria.md"), "# Memoria PHP\n\n## Include {#include}\n", "utf8");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();

      expect(hygiene.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "memory:php:l2_without_l1",
            category: "memory"
          })
        ])
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("finds secret-like config keys without exposing fake values", async () => {
    const originalCwd = process.cwd();
    const fakeConfigKey = ["api", "key"].join("_");
    const fakeConfigValue = ["fake", "test", "secret", "value"].join("-");
    await writeFile(path.join(tempRoot, "sandbox.toml"), `${fakeConfigKey} = "${fakeConfigValue}"\n`, "utf8");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();
      const finding = hygiene.findings.find((item) => item.id === "security:secret_like_config:sandbox.toml");

      expect(finding).toMatchObject({
        category: "security",
        severity: "warning"
      });
      expect(JSON.stringify(finding)).toContain("sandbox.toml:api_key");
      expect(JSON.stringify(finding)).not.toContain(fakeConfigValue);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("reports .env presence without treating unread content as hygiene blocking", async () => {
    const originalCwd = process.cwd();
    await writeFile(path.join(tempRoot, ".env"), "NOT_READ_BY_TEST=1\n", "utf8");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();
      const finding = hygiene.findings.find((item) => item.id === "security:secret_like_config_present");

      expect(finding).toMatchObject({
        category: "security",
        severity: "info",
        sensitive_content_read: false
      });
      expect(hygiene.blocking_findings).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "security:secret_like_config_present" })])
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("uses the latest hygiene scan when deciding whether hygiene is still blocking", async () => {
    const flow = await engine.createFlow({
      goal: "Higiene reavaliada",
      risks: ["hygiene blocking deve refletir ultimo scan"]
    });
    flow.history.push({
      at: new Date().toISOString(),
      type: "hygiene_scanned",
      data: { findings_count: 1, blocking_findings_count: 1, blocking_findings: ["security:old"] }
    });
    flow.history.push({
      at: new Date().toISOString(),
      type: "hygiene_scanned",
      data: { findings_count: 0, blocking_findings_count: 0, blocking_findings: [] }
    });
    await engine.store.saveFlow(flow);

    const gate = await engine.checkGate({
      flow_id: flow.flow_id,
      phase: "pensamentos",
      provided: { context: "ctx", risks: ["risco"], uncertainties: ["u"] },
      persist: false
    });

    expect(gate.missing).not.toContain("hygiene_blocking");
  });

  it("recognizes the governed V2 memory layer paths during hygiene scan", async () => {
    const originalCwd = process.cwd();
    const originalEnv = process.env.PPIRTV_PRINCIPLES_PATH;
    const contractDir = path.join(tempRoot, "v2-memory-layers");
    await mkdir(contractDir, { recursive: true });
    await writeFile(
      path.join(contractDir, "operational-contract.json"),
      JSON.stringify({
        version: "1.0",
        source: "PRINCIPLES.md",
        principles: [],
        memory_layers: [],
        prompt_guidance: [],
        hygiene_checks: [],
        ready_definition: [],
        gate_final_output: [],
        final_report_model: []
      }),
      "utf8"
    );
    await writeFile(
      path.join(contractDir, "PRINCIPLES.md"),
      [
        "# Camadas V2",
        "L1 `lembranca.md` aponta para um destino.",
        "L2 `memorias/<slug>.md` guarda memoria operacional.",
        "L3 `conhecimento/<slug>/README.md` guarda conhecimento profundo."
      ].join("\n"),
      "utf8"
    );
    process.env.PPIRTV_PRINCIPLES_PATH = path.join(contractDir, "operational-contract.json");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();

      expect(hygiene.findings).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "memory:l1_l2_l3_not_documented" })
        ])
      );
    } finally {
      restoreEnv(originalEnv);
      process.chdir(originalCwd);
    }
  });

  it("accepts a direct V2 L1-to-L3 route without requiring conhecimento INDEX", async () => {
    const originalCwd = process.cwd();
    const agentsRoot = path.join(tempRoot, ".agents");
    await mkdir(path.join(agentsRoot, "conhecimento", "rota-direta"), { recursive: true });
    await writeFile(path.join(agentsRoot, "lembranca.md"), "- ROTA-DIRETA -> [Rota direta](conhecimento/rota-direta/README.md) [[conhecimento/rota-direta/README|Rota direta]] ^rota-direta\n", "utf8");
    await writeFile(path.join(agentsRoot, "conhecimento", "rota-direta", "README.md"), "---\nimplementation_version: v2\nlayer: L3\nslug: rota-direta\nowner_skill: dex-memoria\n---\n# Rota direta\n", "utf8");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();
      expect(hygiene.findings).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "memory:.agents:l3_without_index" })
      ]));
      expect(hygiene.blocking_findings.filter((item) => item.id.startsWith("memory:.agents:v2_"))).toEqual([]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("blocks orphan, dual-target, duplicate-layer and ownerless V2 topology", async () => {
    const originalCwd = process.cwd();
    const agentsRoot = path.join(tempRoot, ".agents");
    await mkdir(path.join(agentsRoot, "memorias"), { recursive: true });
    await mkdir(path.join(agentsRoot, "conhecimento", "duplo"), { recursive: true });
    await mkdir(path.join(agentsRoot, "conhecimento", "sem-owner"), { recursive: true });
    await writeFile(path.join(agentsRoot, "lembranca.md"), [
      "- DUPLO -> [Duplo L2](memorias/duplo.md) [Duplo L3](conhecimento/duplo/README.md) ^duplo",
      "- AUSENTE -> [Ausente](memorias/ausente.md) ^ausente",
      "- SEM-OWNER -> [Sem owner](conhecimento/sem-owner/README.md) ^sem-owner"
    ].join("\n"), "utf8");
    await writeFile(path.join(agentsRoot, "memorias", "duplo.md"), "---\nimplementation_version: v2\nlayer: L2\nslug: duplo\n---\n# Duplo L2\n", "utf8");
    await writeFile(path.join(agentsRoot, "memorias", "orfao.md"), "---\nimplementation_version: v2\nlayer: L2\nslug: orfao\n---\n# Orfao\n", "utf8");
    await writeFile(path.join(agentsRoot, "conhecimento", "duplo", "README.md"), "---\nimplementation_version: v2\nlayer: L3\nslug: duplo\nowner_skill: dex-memoria\n---\n# Duplo L3\n", "utf8");
    await writeFile(path.join(agentsRoot, "conhecimento", "sem-owner", "README.md"), "---\nimplementation_version: v2\nlayer: L3\nslug: sem-owner\n---\n# Sem owner\n", "utf8");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();
      const ids = hygiene.blocking_findings.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining([
        "memory:.agents:v2_l1_multiple_targets:duplo",
        "memory:.agents:v2_target_missing:memorias/ausente.md",
        "memory:.agents:v2_orphan:memorias/orfao.md",
        "memory:.agents:v2_slug_active_in_l2_and_l3:duplo",
        "memory:.agents:v2_l3_owner_skill_missing:sem-owner"
      ]));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("blocks rejected V2 routes, invalid V2 metadata and noncanonical nested casing", async () => {
    const originalCwd = process.cwd();
    const agentsRoot = path.join(tempRoot, ".agents");
    await mkdir(path.join(agentsRoot, "Memorias"), { recursive: true });
    await writeFile(path.join(agentsRoot, "lembranca.md"), "- INVALIDA -> [Invalida](memorias/../invalida.md) ^invalida\n", "utf8");
    await writeFile(path.join(agentsRoot, "Memorias", "invalida.md"), "---\nimplementation_version: v2\nlayer: L3\nslug: outro-slug\n---\n# Invalida\n", "utf8");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();
      const ids = hygiene.blocking_findings.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining([
        "memory:.agents:v2_route_rejected",
        "memory:.agents:v2_noncanonical_casing:Memorias",
        "memory:.agents:v2_metadata_invalid:Memorias/invalida.md"
      ]));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("blocks invalid V2 topology when implementation_version is YAML quoted", async () => {
    const originalCwd = process.cwd();
    const agentsRoot = path.join(tempRoot, ".agents");
    await mkdir(path.join(agentsRoot, "memorias"), { recursive: true });
    await writeFile(path.join(agentsRoot, "memorias", "citada.md"), "---\nimplementation_version: \"v2\"\nlayer: L3\nslug: outro\n---\n# Citada\n", "utf8");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();
      expect(hygiene.blocking_findings.map((item) => item.id)).toContain("memory:.agents:v2_metadata_invalid:memorias/citada.md");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("preserves the legacy L3 INDEX warning beside an active V2 L2 unit", async () => {
    const originalCwd = process.cwd();
    const agentsRoot = path.join(tempRoot, ".agents");
    await mkdir(path.join(agentsRoot, "memorias"), { recursive: true });
    await mkdir(path.join(agentsRoot, "conhecimento", "legacy-topic"), { recursive: true });
    await writeFile(path.join(agentsRoot, "lembranca.md"), "- V2-L2 -> [V2 L2](memorias/v2-l2.md) ^v2-l2\n", "utf8");
    await writeFile(path.join(agentsRoot, "memorias", "v2-l2.md"), "---\nimplementation_version: v2\nlayer: L2\nslug: v2-l2\n---\n# V2 L2\n", "utf8");
    await writeFile(path.join(agentsRoot, "conhecimento", "legacy-topic", "note.md"), "# Conhecimento legado\n", "utf8");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();
      expect(hygiene.blocking_findings.map((item) => item.id)).toContain("memory:.agents:l3_without_index");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("warns when LIXEIRA has discarded content without a garimpo gate", async () => {
    const originalCwd = process.cwd();
    await mkdir(path.join(tempRoot, ".agents"), { recursive: true });
    await writeFile(
      path.join(tempRoot, ".agents", "LIXEIRA.md"),
      "# Lixeira\n\n- script temporario removido sem justificativa.\n",
      "utf8"
    );
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();

      expect(hygiene.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "hygiene:lixeira_without_garimpo_gate",
            category: "docs"
          })
        ])
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("uses PPIRTV_PRINCIPLES_PATH when configured", async () => {
    const originalCwd = process.cwd();
    const originalEnv = process.env.PPIRTV_PRINCIPLES_PATH;
    const contractDir = path.join(tempRoot, "contracts");
    await mkdir(contractDir, { recursive: true });
    await writeFile(
      path.join(contractDir, "operational-contract.json"),
      JSON.stringify({
        version: 1,
        source: "PRINCIPLES.md",
        principles: [
          {
            id: "custom_env_contract",
            label: "Contrato por env",
            summary: "Contrato carregado por PPIRTV_PRINCIPLES_PATH.",
            severity: "info",
            checklist_label: "Contrato por env carregado",
            applies_to: ["checklist_render", "prompts"]
          }
        ],
        memory_layers: [],
        prompt_guidance: ["Guia vindo da env var."],
        hygiene_checks: []
      }),
      "utf8"
    );
    await writeFile(path.join(contractDir, "PRINCIPLES.md"), "# Contrato por env\n", "utf8");
    process.env.PPIRTV_PRINCIPLES_PATH = path.join(contractDir, "operational-contract.json");
    process.chdir(tempRoot);
    try {
      const flow = await engine.createFlow({ goal: "Contrato via env" });
      const checklist = await engine.renderChecklist(flow.flow_id, "full");

      expect(checklist.operational_principles.map((item) => item.id)).toEqual(["custom_env_contract"]);
    } finally {
      restoreEnv(originalEnv);
      process.chdir(originalCwd);
    }
  });

  it("preserves operational-contract v4 metadata and principle details", async () => {
    const originalCwd = process.cwd();
    const originalEnv = process.env.PPIRTV_PRINCIPLES_PATH;
    const contractDir = path.join(tempRoot, "contracts-v4");
    await mkdir(contractDir, { recursive: true });
    await writeFile(
      path.join(contractDir, "operational-contract.json"),
      JSON.stringify({
        version: "1.0",
        numeric_version: 4,
        principles_revision: "2026-06-06.9",
        updated_at: "2026-06-06",
        source: "PRINCIPLES.md",
        canonical_source: "$env:USERPROFILE\\.agents\\memories\\principles\\PRINCIPLES.md",
        canonical_contract: "$env:USERPROFILE\\.agents\\memories\\principles\\operational-contract.json",
        contract_role: "operationalizacao derivada dos principios humanos",
        principles: [
          {
            id: "P7",
            legacy_id: "gate_do_quando",
            name: "Gate do Quando",
            label: "Gate do Quando",
            summary: "Acao futura precisa de quando.",
            trigger: ["acao futura declarada"],
            required_actions: ["exigir data, gatilho, cadencia ou responsavel"],
            evidence: ["quando verificavel registrado"],
            blocks_ready_when: ["acao futura sem quando"],
            default_severity: "BLOCK",
            severity: "error",
            checklist_label: "Gate do Quando verificado",
            applies_to: ["checklist_render", "ppirtv_checkout", "prompts"],
            trace_destination: ["verdict_parking_lot", "SPT"]
          }
        ],
        ready_definition: ["objetivo atendido", "acoes futuras tem quando"],
        gate_final_output: ["Princípios acionados", "Evidências", "Risco restante"],
        memory_layers: [],
        prompt_guidance: ["o que sem quando nao vira plano executavel"],
        hygiene_checks: [],
        ai_application: {
          rule: "aplicar principios como gates",
          required_fields: ["Gatilho", "Acao obrigatoria", "Evidencia"],
          execution_format: ["Princípio acionado", "Ação executada"]
        },
        traceable_destination_definition: {
          rule: "precisa poder ser encontrado depois",
          valid_examples: ["teste", "contrato operacional"],
          blocks_ready_when: ["destino nao recuperavel"]
        },
        operational_severity: {
          rule: "severidade por gatilho",
          levels: { INFO: "registrar", WARN: "declarar risco", BLOCK: "nao declarar pronto" },
          default_by_principle: { P7: "BLOCK" },
          runtime_mapping: { INFO: "info", WARN: "warning", BLOCK: "error" }
        },
        operational_trash_definition: {
          principle_id: "P4",
          includes: ["arquivo temporario", "codigo morto"],
          rule: "garimpar antes de remover"
        },
        sync_contract: {
          human_source: "PRINCIPLES.md",
          derived_contract: "operational-contract.json",
          rules: ["PRINCIPLES.md e fonte humana canonica"]
        },
        final_report_model: ["Objetivo atendido", "Status final: pronto | parcial | bloqueado"]
      }),
      "utf8"
    );
    await writeFile(path.join(contractDir, "PRINCIPLES.md"), "# Gate do Quando\n\nL1 memoria.md L2 memoria.md L3 conhecimento/\n", "utf8");
    process.env.PPIRTV_PRINCIPLES_PATH = path.join(contractDir, "operational-contract.json");
    process.chdir(tempRoot);
    try {
      const contract = loadOperationalContractSync(tempRoot);
      const flow = await engine.createFlow({ goal: "Contrato v4" });
      const checklist = await engine.renderChecklist(flow.flow_id, "full");

      expect(contract.version).toBe("1.0");
      expect(contract.numeric_version).toBe(4);
      expect(contract.principles_revision).toBe("2026-06-06.9");
      expect(contract.ready_definition).toContain("acoes futuras tem quando");
      expect(contract.final_report_model).toContain("Status final: pronto | parcial | bloqueado");
      expect(contract.operational_severity?.runtime_mapping.BLOCK).toBe("error");
      expect(contract.principles[0]).toMatchObject({
        id: "P7",
        legacy_id: "gate_do_quando",
        default_severity: "BLOCK",
        trigger: ["acao futura declarada"],
        required_actions: ["exigir data, gatilho, cadencia ou responsavel"],
        evidence: ["quando verificavel registrado"],
        blocks_ready_when: ["acao futura sem quando"],
        trace_destination: ["verdict_parking_lot", "SPT"]
      });
      expect(checklist.operational_principles[0]).toMatchObject({
        id: "gate_do_quando",
        default_severity: "BLOCK",
        required_actions: ["exigir data, gatilho, cadencia ou responsavel"],
        blocks_ready_when: ["acao futura sem quando"],
        trace_destination: ["verdict_parking_lot", "SPT"]
      });
      expect(checklist.ready_definition).toContain("objetivo atendido");
      expect(checklist.gate_final_output).toContain("Evidências");
      expect(checklist.final_report_model).toContain("Status final: pronto | parcial | bloqueado");
    } finally {
      restoreEnv(originalEnv);
      process.chdir(originalCwd);
    }
  });

  it("preserves operational-contract v8 default workflow and policy blocks in normalized contract and checkout accountability", async () => {
    const originalCwd = process.cwd();
    const originalEnv = process.env.PPIRTV_PRINCIPLES_PATH;
    const contractDir = path.join(tempRoot, "contracts-v8");
    await mkdir(contractDir, { recursive: true });
    await writeFile(
      path.join(contractDir, "operational-contract.json"),
      JSON.stringify({
        version: "1.0",
        numeric_version: 8,
        principles_revision: "2026-07-09.3",
        updated_at: "2026-07-09",
        source: "PRINCIPLES.md",
        principles: [],
        ready_definition: ["objetivo atendido"],
        gate_final_output: ["Principios acionados"],
        memory_layers: [],
        default_workflow: {
          id: "PPIRTV_WORKFLOW_BASE",
          name: "Workflow Base PPIRTV",
          fallback_rule: "Na falta de Trilho ou workflow local, usar PPIRTV.",
          short_line: "P Pensamentos -> P Planejamento -> I Implementacao -> R Revisao -> T Teste -> V Validacao",
          phases: [
            { letter: "P", name: "Pensamentos", role: "entender, pesquisar e analisar" },
            { letter: "P", name: "Planejamento", role: "gerar SPT detalhado" },
            { letter: "I", name: "Implementacao", role: "executar trilhos" },
            { letter: "R", name: "Revisao", role: "revisar e lapidar" },
            { letter: "T", name: "Teste", role: "testar com evidencia" },
            { letter: "V", name: "Validacao", role: "validar objetivo inicial" }
          ]
        },
        prompt_guidance: [],
        hygiene_checks: [],
        secret_env_consumption_policy: {
          principle_id: "P8",
          localizer: "ENV-SECRET-CONSUMO-SEGURO",
          rule: "Consumir somente a chave allowlistada sem eco.",
          allowed_when: ["usuario autorizou fonte, chave e operacao concreta"],
          required_actions: ["parsear apenas a chave nomeada"],
          forbidden: ["varredura ampla de .env"],
          blocks_ready_when: ["o caminho disponivel exporia o segredo"],
          incident_response: ["registrar somente metadado sanitizado"]
        },
        early_security_proportionality_policy: {
          principle_id: "P9",
          localizer: "SEGURANCA-CEDO-DEMAIS-LIMITA",
          rule: "Exigir evidencia local antes de endurecer guardrails.",
          allowed_when: ["experimento e local, reversivel e observavel"],
          required_actions: ["comparar a trava proposta com alternativa mais leve"],
          forbidden: ["bloquear experimento reversivel por medo generico"],
          blocks_ready_when: ["seguranca impede nascimento de V0 reversivel sem evidencia local"]
        },
        final_report_model: ["Status final: pronto | parcial | bloqueado"]
      }),
      "utf8"
    );
    await writeFile(path.join(contractDir, "PRINCIPLES.md"), "# Contrato v8\n", "utf8");
    process.env.PPIRTV_PRINCIPLES_PATH = path.join(contractDir, "operational-contract.json");
    process.chdir(tempRoot);
    try {
      const contract = loadOperationalContractSync(tempRoot);
      const flow = await engine.createFlow({ goal: "Contrato v8" });
      const checklist = await engine.renderChecklist(flow.flow_id, "full");
      const checkout = await engine.goalCheckout({ flow_id: flow.flow_id });
      const contractAccountability = checkout.contract_accountability as Record<string, unknown>;
      const prestacao = checkout.prestacao_de_contas as Record<string, unknown>;
      const prestacaoContrato = prestacao.contrato_operacional as Record<string, unknown>;

      expect(contract.default_workflow).toMatchObject({
        id: "PPIRTV_WORKFLOW_BASE",
        phases: expect.arrayContaining([expect.objectContaining({ name: "Validacao" })])
      });
      expect(contract.secret_env_consumption_policy).toMatchObject({
        localizer: "ENV-SECRET-CONSUMO-SEGURO",
        required_actions: ["parsear apenas a chave nomeada"],
        incident_response: ["registrar somente metadado sanitizado"]
      });
      expect(contract.early_security_proportionality_policy).toMatchObject({
        localizer: "SEGURANCA-CEDO-DEMAIS-LIMITA",
        forbidden: ["bloquear experimento reversivel por medo generico"]
      });
      expect(checklist.secret_env_consumption_policy).toMatchObject({
        localizer: "ENV-SECRET-CONSUMO-SEGURO"
      });
      expect(checklist.early_security_proportionality_policy).toMatchObject({
        localizer: "SEGURANCA-CEDO-DEMAIS-LIMITA"
      });
      expect(checklist.default_workflow).toMatchObject({
        id: "PPIRTV_WORKFLOW_BASE",
        short_line: expect.stringContaining("P Pensamentos")
      });
      expect(checkout.default_workflow).toEqual(contractAccountability.default_workflow);
      expect(contractAccountability.secret_env_consumption_policy).toMatchObject({
        localizer: "ENV-SECRET-CONSUMO-SEGURO"
      });
      expect(contractAccountability.default_workflow).toMatchObject({
        id: "PPIRTV_WORKFLOW_BASE",
        phases: expect.arrayContaining([expect.objectContaining({ letter: "T", name: "Teste" })])
      });
      expect(contractAccountability.early_security_proportionality_policy).toMatchObject({
        localizer: "SEGURANCA-CEDO-DEMAIS-LIMITA"
      });
      expect(prestacaoContrato.default_workflow).toEqual(contractAccountability.default_workflow);
      expect(prestacaoContrato.secret_env_consumption_policy).toEqual(contractAccountability.secret_env_consumption_policy);
      expect(prestacaoContrato.early_security_proportionality_policy).toEqual(contractAccountability.early_security_proportionality_policy);
    } finally {
      restoreEnv(originalEnv);
      process.chdir(originalCwd);
    }
  });

  it("uses the shared principles memory before a local project contract", async () => {
    const originalCwd = process.cwd();
    const originalEnv = process.env.PPIRTV_PRINCIPLES_PATH;
    const originalUserProfile = process.env.USERPROFILE;
    const fakeHome = path.join(tempRoot, "home");
    const sharedDir = path.join(fakeHome, ".agents", "memories", "principles");
    const localPrinciplesDir = path.join(tempRoot, "principles");
    await mkdir(sharedDir, { recursive: true });
    await mkdir(localPrinciplesDir, { recursive: true });
    await writeFile(
      path.join(sharedDir, "operational-contract.json"),
      JSON.stringify({
        version: 1,
        source: "principles/PRINCIPLES.md",
        principles: [
          {
            id: "shared_memory_contract",
            label: "Contrato compartilhado",
            summary: "Contrato carregado da memoria compartilhada.",
            severity: "info",
            checklist_label: "Contrato compartilhado carregado",
            applies_to: ["checklist_render"]
          }
        ],
        memory_layers: [],
        prompt_guidance: ["Guia compartilhado."],
        hygiene_checks: []
      }),
      "utf8"
    );
    await writeFile(path.join(sharedDir, "PRINCIPLES.md"), "# Contrato compartilhado\n", "utf8");
    await writeFile(
      path.join(localPrinciplesDir, "operational-contract.json"),
      JSON.stringify({
        version: 1,
        source: "principles/PRINCIPLES.md",
        principles: [
          {
            id: "local_contract",
            label: "Contrato local",
            summary: "Contrato do projeto atual.",
            severity: "warning",
            checklist_label: "Contrato local carregado",
            applies_to: ["checklist_render"]
          }
        ],
        memory_layers: [],
        prompt_guidance: ["Guia local."],
        hygiene_checks: []
      }),
      "utf8"
    );
    await writeFile(path.join(localPrinciplesDir, "PRINCIPLES.md"), "# Contrato local\n", "utf8");
    delete process.env.PPIRTV_PRINCIPLES_PATH;
    process.env.USERPROFILE = fakeHome;
    process.chdir(tempRoot);
    try {
      const flow = await engine.createFlow({ goal: "Contrato compartilhado" });
      const checklist = await engine.renderChecklist(flow.flow_id, "full");

      expect(checklist.operational_principles.map((item) => item.id)).toEqual(["shared_memory_contract"]);
    } finally {
      restoreEnv(originalEnv);
      restoreUserProfile(originalUserProfile);
      process.chdir(originalCwd);
    }
  });

  it("uses a local principles contract from the project cwd when shared memory is missing", async () => {
    const originalCwd = process.cwd();
    const originalEnv = process.env.PPIRTV_PRINCIPLES_PATH;
    const originalUserProfile = process.env.USERPROFILE;
    const principlesDir = path.join(tempRoot, "principles");
    await mkdir(principlesDir, { recursive: true });
    await writeFile(
      path.join(principlesDir, "operational-contract.json"),
      JSON.stringify({
        version: 1,
        source: "principles/PRINCIPLES.md",
        principles: [
          {
            id: "local_contract",
            label: "Contrato local",
            summary: "Contrato do projeto atual.",
            severity: "warning",
            checklist_label: "Contrato local carregado",
            applies_to: ["checklist_render"]
          }
        ],
        memory_layers: [],
        prompt_guidance: ["Guia local."],
        hygiene_checks: []
      }),
      "utf8"
    );
    await writeFile(path.join(principlesDir, "PRINCIPLES.md"), "# Contrato local\n", "utf8");
    delete process.env.PPIRTV_PRINCIPLES_PATH;
    process.env.USERPROFILE = path.join(tempRoot, "home-without-shared-principles");
    process.chdir(tempRoot);
    try {
      const flow = await engine.createFlow({ goal: "Contrato local" });
      const checklist = await engine.renderChecklist(flow.flow_id, "full");

      expect(checklist.operational_principles.map((item) => item.id)).toEqual(["local_contract"]);
    } finally {
      restoreEnv(originalEnv);
      restoreUserProfile(originalUserProfile);
      process.chdir(originalCwd);
    }
  });

  it("falls back to the harness principles contract and reports it in hygiene", async () => {
    const originalCwd = process.cwd();
    const originalEnv = process.env.PPIRTV_PRINCIPLES_PATH;
    const originalUserProfile = process.env.USERPROFILE;
    delete process.env.PPIRTV_PRINCIPLES_PATH;
    process.env.USERPROFILE = path.join(tempRoot, "home-without-shared-principles");
    process.chdir(tempRoot);
    try {
      const flow = await engine.createFlow({ goal: "Contrato fallback" });
      const checklist = await engine.renderChecklist(flow.flow_id, "full");
      const hygiene = await engine.hygieneScan();

      expect(checklist.operational_principles.some((item) => item.id === "memoria_sem_lembranca")).toBe(true);
      expect(hygiene.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "principles:using_harness_fallback",
            category: "principles"
          })
        ])
      );
    } finally {
      restoreEnv(originalEnv);
      restoreUserProfile(originalUserProfile);
      process.chdir(originalCwd);
    }
  });

  it("records material cooperators only when supplied", async () => {
    const flow = await engine.createFlow({ goal: "Creditos materiais" });
    const meeting = await engine.openMeeting({ flow_id: flow.flow_id, type: "divergent", question: "Quem ajudou?" });

    const recorded = await engine.recordMeeting({
      meeting_id: meeting.meeting_id,
      cooperators: [{ name: "Chato", reason: "encontrou risco de falso pronto", material: true }],
      active_credits: ["Chato encontrou risco de falso pronto"]
    });

    expect(recorded.display.cooperators).toEqual([{ name: "Chato", reason: "encontrou risco de falso pronto", material: true }]);
    expect(recorded.display.active_credits).toEqual(["Chato encontrou risco de falso pronto"]);
  });

  it("runs a complete PPIRTV flow E2E through all phases", async () => {
    const flow = await engine.createFlow({ goal: "Rodar E2E PPIRTV" });
    await engine.openMeeting({ flow_id: flow.flow_id, type: "divergent", question: "Quais riscos existem?" });
    await engine.openMeeting({ flow_id: flow.flow_id, type: "convergent", question: "Qual menor trilho?" });
    await engine.attachEvidence({ flow_id: flow.flow_id, kind: "note", title: "evidencia inicial", content: "ok" });

    await engine.advance({ flow_id: flow.flow_id, provided: { context: "ctx", risks: ["r"], uncertainties: ["u"] } });
    await engine.advance({
      flow_id: flow.flow_id,
      provided: { scope_in: ["mvp"], scope_out: ["http"], tasks: ["codar"], expected_evidence: ["teste"], done_criteria: ["passar"] }
    });
    await engine.advance({ flow_id: flow.flow_id, provided: { implementation_done: true, changed_files: ["src/index.ts"] } });
    await engine.advance({ flow_id: flow.flow_id, provided: { diff_reviewed: true, barata_scan: true, regression_risks: ["baixo"] } });
    await engine.advance({ flow_id: flow.flow_id, provided: { test_executed: true } });
    await engine.recordVerdict({
      flow_id: flow.flow_id,
      status: "pronto",
      rationale: "E2E passou",
      evidence_ids: ["e2e"],
      residual_risks: [],
      next_step: "arquivar"
    });
    const finalAdvance = await engine.advance({
      flow_id: flow.flow_id,
      provided: { residual_risks: ["baixo"], next_step: "arquivar", memoria_viva_reconciled: true }
    });
    const archived = await engine.archiveFlow({ flow_id: flow.flow_id, reason: "E2E completo" });

    expect(finalAdvance).toMatchObject({ advanced: true, from: "validacao", to: null, status: "complete" });
    expect(archived.status).toBe("archived");
  });
});

async function currentImplementationFingerprint(
  flowId: string,
  targetEngine: FlowEngine = engine
): Promise<string> {
  const flow = await targetEngine.store.loadFlow(flowId);
  const workspace = flow.goal_binding?.envelope.workspace;
  if (workspace) {
    return fingerprintReviewedImplementation(
      workspace,
      flow.changed_files,
      process.platform,
      { allowedMissingFiles: flow.deleted_files ?? [] }
    );
  }
  if (!flow.implementation_fingerprint) {
    throw new Error(`Missing implementation fingerprint for ${flowId}`);
  }
  return flow.implementation_fingerprint;
}

async function prepareCompletableMechanicalGoal(
  targetEngine: FlowEngine,
  idempotencyKey: string,
  objective: string
): Promise<string> {
  const { flowId, evidenceId } = await startGoalWithEvidence(idempotencyKey, objective, targetEngine);
  const flow = await targetEngine.store.loadFlow(flowId);
  flow.goal_binding!.envelope.risk_level = "mechanical";
  await targetEngine.store.saveFlow(flow);
  await targetEngine.goalAdvance({ flow_id: flowId });
  await targetEngine.goalAdvance({ flow_id: flowId });
  await targetEngine.goalAdvance({
    flow_id: flowId,
    provided: { implementation_done: true, changed_files: ["docs/contract.md"] }
  });
  await targetEngine.goalAdvance({
    flow_id: flowId,
    provided: {
      diff_reviewed: true,
      barata_scan: true,
      regression_risks: ["recovery terminal"],
      review_findings: ["mudanca mecanica revisada"]
    }
  });
  await targetEngine.goalAdvance({ flow_id: flowId, provided: { test_executed: true } });
  await targetEngine.goalVerdict({
    flow_id: flowId,
    status: "pronto",
    rationale: "GOAL mecanico validado para fixture de recovery.",
    evidence_ids: [evidenceId],
    next_step: "encerrar agora"
  });
  return flowId;
}

function countingMemoryHooks(): {
  runner: MemoryHookRunner;
  afterPhaseCalls: () => number;
} {
  let afterPhaseCalls = 0;
  return {
    afterPhaseCalls: () => afterPhaseCalls,
    runner: {
      beforePhase: async ({ flow, phase }) => ({
        flow_id: flow.flow_id,
        phase,
        recalled_at: new Date().toISOString(),
        items: [],
        warnings: [],
        visual_status: { librarian: "empty", graphify: "disabled" }
      }),
      afterPhase: async ({ flow, phase }) => {
        afterPhaseCalls += 1;
        return {
          flow_id: flow.flow_id,
          phase,
          recorded_at: new Date().toISOString(),
          candidates_count: 0,
          parking_count: 0,
          warnings: []
        };
      }
    }
  };
}

async function startGoalWithEvidence(
  idempotencyKey: string,
  objective: string,
  targetEngine: FlowEngine = engine
): Promise<{ flowId: string; evidenceId: string; workspace: string; sptPath: string }> {
  const workspace = path.join(tempRoot, idempotencyKey.replace(/[^a-z0-9_-]+/gi, "-"));
  const sptPath = await writeFakeSpt(workspace, objective);
  for (const relativePath of [
    "docs/contract.md",
    "docs/status.md",
    "src/flow-engine.ts",
    "src/l1-adapter.ts",
    "src/server.ts",
    "src/x.ts"
  ]) {
    const target = path.join(workspace, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `fixture:${relativePath}\n`, "utf8");
  }
  const started = await targetEngine.startGoal({
    workspace,
    spt_path: sptPath,
    objective,
    idempotency_key: idempotencyKey,
    evidence_required: true,
    required_evidence: ["npm run check"],
    requested_verdict_policy: "evidence_required",
    source: "dex-code",
    mode: "full"
  });
  const flowId = started.flow_id as string;
  const evidence = await targetEngine.addGoalEvidence({
    flow_id: flowId,
    title: "npm run check",
    content: "pass",
    satisfies: ["npm run check"]
  });
  return { flowId, evidenceId: evidence.evidence_id as string, workspace, sptPath };
}

class LedgerFaultStore extends PpirtvStore {
  private pendingFault = true;

  constructor(
    root: string,
    private readonly targetType: string,
    private readonly boundary: "before" | "after"
  ) {
    super(root, { fixtureOnlyNoncanonicalRoot: true });
  }

  override async appendLedger(event: LedgerEvent): Promise<void> {
    if (!this.pendingFault || event.type !== this.targetType) {
      await super.appendLedger(event);
      return;
    }
    this.pendingFault = false;
    if (this.boundary === "before") {
      throw new Error(`LEDGER_FAULT_BEFORE_APPEND: ${event.type}`);
    }
    await super.appendLedger(event);
    throw new Error(`LEDGER_FAULT_AFTER_APPEND: ${event.type}`);
  }
}

class FirstOfficialSaveThenThrowStore extends PpirtvStore {
  private pendingFault = true;

  constructor(root: string) {
    super(root, { fixtureOnlyNoncanonicalRoot: true });
  }

  override async saveFlow(flow: Flow): Promise<void> {
    await super.saveFlow(flow);
    if (this.pendingFault && flow.goal_binding) {
      this.pendingFault = false;
      throw new Error(`FIRST_OFFICIAL_SAVE_THEN_THROW: ${flow.flow_id}`);
    }
  }
}

class DriftMemoryMiningStore extends PpirtvStore {
  private loadCount = 0;

  constructor(root: string, private readonly targetFlowId: string) {
    super(root);
  }

  override async loadFlow(flowId: string): Promise<Flow> {
    const flow = await super.loadFlow(flowId);
    if (flowId !== this.targetFlowId) {
      return flow;
    }
    this.loadCount += 1;
    return {
      ...flow,
      memory_mining:
        this.loadCount >= 2
          ? memoryMiningSummary({ blocked_verdict: true, write_policy: "auto_write", strong_unwritten_count: 1 })
          : memoryMiningSummary({ blocked_verdict: false, write_policy: "classify_only", strong_unwritten_count: 0 })
    };
  }
}

function memoryMiningSummary(overrides: Partial<NonNullable<Flow["memory_mining"]>> = {}): NonNullable<Flow["memory_mining"]> {
  return {
    required: true,
    last_run_at: new Date().toISOString(),
    write_policy: "classify_only",
    blocked_verdict: false,
    candidates_count: 1,
    written_count: 0,
    blocked_count: 0,
    ledger_only_count: 0,
    discarded_count: 0,
    strong_unwritten_count: 0,
    memory_required_but_empty: false,
    candidates: [{ id: "mc_fresh", title: "Snapshot fresco", scope: "ledger_only" }],
    written: [],
    ledger_only: ["mc_fresh"],
    estacionamento: [],
    discarded: [],
    blocked: [],
    write_decisions: [],
    edit_queue: [],
    destination_warnings: [],
    memory_written: false,
    memory_validated: false,
    memory_consolidated: false,
    memory_review_status: "not_required",
    ...overrides
  };
}

async function repeatFiscalBlock(flowId: string, evidenceId: string, times: number): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Mudanca de codigo com risco material ainda sem cooperacao/review.",
        evidence_ids: [evidenceId],
        residual_risks: ["sem reuniao material e sem review explicito"],
        next_step: "tentar resolver blocker fiscal"
      })
    ).rejects.toThrow(/PPIRTV_FISCAL_BLOCKED/i);
  }
}

function assertNoFalseGreenDirectAction(payload: unknown, label: string): void {
  if (!hasBlockingSignal(payload)) {
    return;
  }
  const offenders = collectDirectActionActions(payload).filter((item) => /Gate pronto para avancar|pronto para avancar/i.test(item.action));
  expect(offenders, `${label} false-green direct_action at ${offenders.map((item) => item.path).join(", ")}`).toEqual([]);
}

function hasBlockingSignal(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasBlockingSignal);
  }
  const record = value as Record<string, unknown>;
  if (record.status === "blocked" || record.archived_blocked_flow === true || record.meeting_required === true) {
    return true;
  }
  if (Array.isArray(record.blockers) && record.blockers.length > 0) {
    return true;
  }
  if (Array.isArray(record.missing) && record.missing.some((item) => /required_cooperation|hygiene_blocking|memory_required|review_required|librarian_status/i.test(String(item)))) {
    return true;
  }
  if (Array.isArray(record.preserved_blockers) && record.preserved_blockers.length > 0) {
    return true;
  }
  if (record.fiscal_policy && typeof record.fiscal_policy === "object") {
    const fiscal = record.fiscal_policy as Record<string, unknown>;
    if (Array.isArray(fiscal.blocking_reasons) && fiscal.blocking_reasons.length > 0) {
      return true;
    }
  }
  return Object.values(record).some(hasBlockingSignal);
}

function collectDirectActionActions(value: unknown, pathParts: string[] = []): Array<{ path: string; action: string }> {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectDirectActionActions(item, [...pathParts, String(index)]));
  }
  const record = value as Record<string, unknown>;
  const current =
    record.direct_action && typeof record.direct_action === "object" && typeof (record.direct_action as Record<string, unknown>).action === "string"
      ? [{ path: [...pathParts, "direct_action", "action"].join("."), action: String((record.direct_action as Record<string, unknown>).action) }]
      : [];
  return [
    ...current,
    ...Object.entries(record).flatMap(([key, nested]) => collectDirectActionActions(nested, [...pathParts, key]))
  ];
}

function restoreEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.PPIRTV_PRINCIPLES_PATH;
  } else {
    process.env.PPIRTV_PRINCIPLES_PATH = value;
  }
}

function restoreDexMemoriaHome(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.DEX_MEMORIA_HOME;
  } else {
    process.env.DEX_MEMORIA_HOME = value;
  }
}

function restoreUserProfile(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = value;
  }
}

function snapshotEnv(keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvSnapshot(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function readJsonl(filePath: string): Promise<Array<Record<string, any>>> {
  const text = await readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

function validPipelineItem(goal: string): {
  goal: string;
  context: string;
  scope_in: string[];
  scope_out: string[];
  tasks: string[];
  done_criteria: string[];
  expected_evidence: string[];
  evidence: string[];
  verdict_gold_mining?: string[];
  verdict_parking_lot?: string[];
} {
  return {
    goal,
    context: "ctx",
    scope_in: [`src/${goal.toLowerCase().replace(/\s+/g, "-")}.ts`],
    scope_out: ["mudancas fora do item atual"],
    tasks: ["executar gate sequencial"],
    done_criteria: ["flow completo com veredito"],
    expected_evidence: ["evidencia declarada pelo pipeline"],
    evidence: ["pipeline declarou evidencia para este item"]
  };
}

function graphHit(question: string, title: string, pathName: string, score: number) {
  return {
    source: "graphify" as const,
    question,
    title,
    path: pathName,
    observation: "Graphify node at L1",
    destination: "recall_hint" as const,
    score
  };
}

async function writeFakeSpt(workspace: string, objective = "Executar ponte GOAL/SPT"): Promise<string> {
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-05-24-fake-goal-spt.md");
  await writeFile(sptPath, fakeSptText(workspace, objective), "utf8");
  return sptPath;
}

function fakeSptText(
  workspace = "<workspace>",
  objective = "Executar ponte GOAL/SPT",
  humanBody = "# Human test notes\n\nThis body is intentionally free-form.\n"
): string {
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
    humanBody
  ].join("\n");
}
