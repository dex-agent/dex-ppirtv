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
  engine = new FlowEngine(new PpirtvStore(tempRoot));
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

    const restarted = new FlowEngine(new PpirtvStore(tempRoot));
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
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
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

  it("keeps advance working when graphify provider fails", async () => {
    const provider: MemoryGraphProvider = {
      recall: async () => {
        throw new Error("graphify unavailable");
      }
    };
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
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

    const finalAdvance = await engine.advance({ flow_id: flow.flow_id, provided: { residual_risks: ["baixo"], next_step: "arquivar", clean_house: true } });
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
    const guardedEngine = new FlowEngine(new PpirtvStore(tempRoot), failingHooks);
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

  it("runs pipeline items sequentially and marks remaining items pending after a gate failure", async () => {
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

    expect(result).toMatchObject({ total: 3, completed: 1, failed: 1, pending: 1, auto_memory_mining: true });
    expect(flows.map((flow) => flow.status)).toEqual(["pronto", "bloqueado", "pending"]);
    expect(String(flows[1].blocker)).toContain("complete_gate_planejamento");
    const firstEventTypes = firstLedger.map((event) => event.type);
    expect(firstEventTypes).toEqual(
      expect.arrayContaining([
        "pipeline_item_started",
        "flow_facts_updated",
        "evidence_attached",
        "verdict_recorded",
        "memory_mined",
        "pipeline_item_completed"
      ])
    );
    expect(firstEventTypes.indexOf("verdict_recorded")).toBeLessThan(firstEventTypes.indexOf("memory_mined"));
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
      const mined = flow.memory_mining as Record<string, unknown>;
      const memoria = await readFile(path.join(memRoot, "temas", "delphi", "MEMORIA.md"), "utf8");

      expect(flow.status).toBe("pronto");
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

    expect(result).toMatchObject({ total: 2, completed: 1, failed: 1, pending: 0, auto_memory_mining: false });
    expect(flows.map((flow) => flow.status)).toEqual(["bloqueado", "pronto"]);
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

  it("does not promote unknown parking items to gold by default", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace);
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
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Executar ponte GOAL/SPT",
      idempotency_key: "dex-code:test-goal-001",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required" as const,
      source: "dex-code" as const
    };

    const validation = await engine.validateSpt({ workspace, spt_path: sptPath, objective: envelope.objective });
    const started = await engine.startGoal(envelope);
    const reused = await engine.startGoal(envelope);
    const status = await engine.goalStatus({ idempotency_key: envelope.idempotency_key });

    expect(validation.valid).toBe(true);
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
    expect(goalStarted?.data.tasks).toEqual(expect.arrayContaining(["Rodar teste local."]));
    expect(goalStarted?.data.expected_evidence).toEqual(expect.arrayContaining(["npm run check."]));
    expect(goalStarted?.data.done_criteria).toEqual(expect.arrayContaining(["npm run check."]));
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
      source: "dex-code"
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
      const sptPath = await writeFakeSpt(workspace);
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
        memory_consolidated: true,
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
        memory_consolidated: true
      });
      expect(ledger.map((event) => event.type)).toContain("memory_mined");
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
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
      memory_consolidated: false
    });
    expect(memoryAccountability).toMatchObject({
      memory_written: true,
      memory_validated: false,
      memory_consolidated: false
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
    const sptPath = await writeFakeSpt(workspace);
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Matriz de classificacao",
      idempotency_key: "dex-code:test-classification-matrix",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
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
      const sptPath = await writeFakeSpt(workspace);
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
      source: "dex-code"
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
      content: "Review executado para isolar o requisito de veredito canonico.",
      satisfies: ["review_required"]
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
        clean_house: true
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
        clean_house: true
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
    expect(validation.missing).toEqual(
      expect.arrayContaining(["Workspace", "Origem", "GoalEnvelope", "Expected Evidence", "Done Criteria", "done_criteria"])
    );
    expect(validation.next_step).toContain("corrigir_spt");
  });

  it("rejects positive GOAL verdicts without traceable evidence", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace);
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

    const checklist = await engine.renderChecklist(flowId);
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
    const sptPath = await writeFakeSpt(workspace);
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

  it("T-MC-A advance in compact flow follows concepcao->implementacao->revisao->validacao", async () => {
    const workspace = path.join(tempRoot, "mc-mode-compact-advance");
    const sptPath = await writeFakeSpt(workspace);
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
    const sptPath = await writeFakeSpt(workspace);
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

  it("T-MC-B flow without mode stays full with 6 phases (regression)", async () => {
    const workspace = path.join(tempRoot, "mc-mode-full-regression");
    const sptPath = await writeFakeSpt(workspace);
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Default full regression",
      idempotency_key: "dex-code:test-mc-mode-full",
      evidence_required: true,
      required_evidence: ["npm run check"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    });
    const flowId = started.flow_id as string;
    const flow = await engine.store.loadFlow(flowId);

    expect(flow.mode).toBe("full");
    expect(flow.phase).toBe("pensamentos");
  });

  it("T-MC-R2 rejects mode mismatch when reusing goal flow by idempotency key", async () => {
    // R2: se um flow ja existe com mode "full" e um novo goal_start chega com
    // mode "compact" usando a mesma idempotency_key, o engine deve rejeitar
    // em vez de sobrescrever silenciosamente o modo (o que quebraria o fluxo
    // em fase avancada).
    const workspace = path.join(tempRoot, "mc-mode-mismatch-reuse");
    const sptPath = await writeFakeSpt(workspace);
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
        objective: "Retry com mode diferente",
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
    const sptPath = await writeFakeSpt(workspace);
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
    const sptPath = await writeFakeSpt(workspace);
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
    const sptPath = await writeFakeSpt(workspace);
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

    // Mode invalido deve ter sido normalizado para o default "full", nao
    // salvo cru como "Compact".
    expect(flow.mode).toBe("full");
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
    const sptPath = await writeFakeSpt(workspace);
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

  it("T6 exposes mandatory COO as required_cooperation and blocks until material participation exists", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t6", "COO obrigatorio");
    await engine.updateFlowFacts(flowId, { risks: ["risco material de produto e fluxo"] });

    const status = await engine.goalStatus({ flow_id: flowId });
    const names = (status.required_cooperation as Array<Record<string, unknown>>).map((item) => item.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "chato",
        "questionador",
        "entrevista-me",
        "garimpeiro",
        "dex-memoria",
        "estacionamento",
        "reuniao",
        "sprinter",
        "duda-dev",
        "mapeador-implementacao",
        "revisor-codigo",
        "tio-testador",
        "validador-pronto"
      ])
    );
    expect(status.required_cooperation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "chato", reason: expect.stringContaining("perguntas de pressao") }),
        expect.objectContaining({ name: "ancora-fluxo", reason: expect.stringContaining("regresso correto") }),
        expect.objectContaining({ name: "validador-pronto", reason: expect.stringContaining("qualquer veredito positivo") })
      ])
    );
    expect(status.blockers).toEqual(expect.arrayContaining(["required_cooperation"]));
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
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
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
    const guarded = new FlowEngine(new PpirtvStore(tempRoot), failingHooks);
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
      kind: "parecer_adversarial",
      title: "Parecer adversarial dos artefatos finais",
      content: "Findings reais, riscos residuais e decisao de revisao foram registrados.",
      satisfies: ["review_evidence_coherent"]
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
        rationale: "Erro recorrente ainda sem regresso suficiente.",
        evidence_ids: [evidenceId],
        residual_risks: ["erro recorrente em risco de produto"],
        attempt_count: 1,
        regress_count: 0,
        next_step: "arquivar"
      })
    ).rejects.toThrow(/attempt_regress_count/i);
  });

  it("T11 exposes corrective check-in with disabled librarian/Graphify visible and explained", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t11", "Check-in corretivo");
    await engine.updateFlowFacts(flowId, { risks: ["risco material exige COO visivel"] });

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
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
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
    const sptPath = await writeFakeSpt(workspace);
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

    const checklist = await engine.renderChecklist(flowId);
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

  it("T18 preserves goal_gate_check blocking required cooperation and hygiene material findings", async () => {
    const workspace = path.join(tempRoot, "gate-check-hygiene");
    const sptPath = await writeFakeSpt(workspace);
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

    expect(gate.status).toBe("blocked");
    expect(gate.missing).toEqual(expect.arrayContaining(["required_cooperation", "hygiene_blocking"]));
    expect((gate.display as Record<string, Record<string, string>>).direct_action.action).toContain("required_cooperation");
  });

  it("T19 explains required_cooperation reasons by blocker and keeps all mandatory COO visible", async () => {
    const { flowId } = await startGoalWithEvidence("dex-code:test-fiscal-t19", "Razoes especificas por fiscal");
    await engine.updateFlowFacts(flowId, {
      risks: ["sem memoria L1/L2 gerada pelo motor"],
      changed_files: ["src/flow-engine.ts"]
    });

    const status = await engine.goalStatus({ flow_id: flowId });
    const required = status.required_cooperation as Array<Record<string, unknown>>;
    const names = required.map((item) => item.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "ancora-fluxo",
        "chato",
        "questionador",
        "entrevista-me",
        "garimpeiro",
        "dex-memoria",
        "estacionamento",
        "reuniao",
        "sprinter",
        "duda-dev",
        "mapeador-implementacao",
        "revisor-codigo",
        "tio-testador",
        "validador-pronto"
      ])
    );
    expect(required).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "revisor-codigo", reason: expect.stringContaining("review_required") }),
        expect.objectContaining({ name: "garimpeiro", reason: expect.stringContaining("memory_required_but_empty") }),
        expect.objectContaining({ name: "dex-memoria", reason: expect.stringContaining("memory_required_but_empty") }),
        expect.objectContaining({ name: "reuniao", reason: expect.stringContaining("required_cooperation") }),
        expect.objectContaining({ name: "sprinter", reason: expect.stringContaining("required_cooperation") }),
        expect.objectContaining({ name: "tio-testador", reason: expect.stringContaining("risco de teste/evidencia") }),
        expect.objectContaining({ name: "validador-pronto", reason: expect.stringContaining("qualquer veredito positivo") }),
        expect.objectContaining({ name: "ancora-fluxo", reason: expect.stringContaining("regresso correto") }),
        expect.objectContaining({ name: "chato", reason: expect.stringContaining("perguntas de pressao") }),
        expect.objectContaining({ name: "questionador", reason: expect.stringContaining("perguntas de pressao") }),
        expect.objectContaining({ name: "entrevista-me", reason: expect.stringContaining("perguntas de pressao") })
      ])
    );
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
    expect(checkout.direct_action).toEqual(expect.stringContaining("required_cooperation"));
    expect(checkout.direct_action).toEqual(expect.stringContaining("review_required"));
    expect(checkout.direct_action).toEqual(expect.stringContaining("abrir reuniao/revisor/memoria"));
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
    const sptPath = await writeFakeSpt(workspace);
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
      expect(gate.status).toBe("blocked");
      expect(status.status).toBe("blocked");
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
    const sptPath = await writeFakeSpt(workspace);
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
        content: "pass"
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
    const graphEngine = new FlowEngine(new PpirtvStore(tempRoot), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
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
        expect.objectContaining({ tool: "evidence_add" }),
        expect.objectContaining({ tool: "goal_status" }),
        expect.objectContaining({ tool: "goal_verdict", only_if: expect.stringContaining("review_required") })
      ])
    });
    expect((blocked.next_required_action as { required_tool_sequence: Array<Record<string, unknown>> }).required_tool_sequence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: "goal_meeting_open" })])
    );

    await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Revisao adversarial dos artefatos finais",
      content: "Review feito sobre src/flow-engine.ts. Achado: blocker antigo nao deve ser preservado apos evidencia. Decisao: liberar nova checagem.",
      satisfies: ["review_required"]
    });
    const resolved = await engine.goalStatus({ flow_id: flowId });

    expect(resolved.blockers).not.toContain("review_required");
    expect(resolved.next_required_action).not.toMatchObject({ type: "attach_review" });
    expect(resolved.ppirtv_checkout).toMatchObject({
      resolution_guidance: resolved.blockers.length > 0 ? expect.any(Object) : null
    });
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

    await engine.addGoalEvidence({
      flow_id: flowId,
      kind: "code_review",
      title: "Review explicito reseta loop antigo",
      content: "Review feito sobre src/flow-engine.ts. Achado real registrado; review_required nao deve continuar contando.",
      satisfies: ["review_required"]
    });
    const afterProgress = await engine.goalStatus({ flow_id: flowId });
    expect(afterProgress.blockers).not.toContain("review_required");
    expect(afterProgress.loop_monitor).toMatchObject({ count: 0, escalation: { active: false } });

    await repeatFiscalBlock(flowId, evidenceId, 1);
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
      const graphEngine = new FlowEngine(new PpirtvStore(tempRoot), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
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
      const graphEngine = new FlowEngine(new PpirtvStore(tempRoot), new MemoryLibrarian(tempRoot, { graphProvider: provider }));
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
    const status = await engine.goalStatus({ flow_id: flowId });

    expect(archived).toMatchObject({
      archived_blocked_flow: true,
      preserved_blockers: expect.arrayContaining(["required_cooperation"])
    });
    expect(archived.display.direct_action.action).toContain("Arquivado com bloqueios preservados");
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

  it("renders a Fernanda display checklist without removing legacy fields", async () => {
    const flow = await engine.createFlow({
      goal: "Checklist visual",
      context: "ctx",
      risks: ["risco"],
      uncertainties: ["lacuna"]
    });

    const checklist = await engine.renderChecklist(flow.flow_id);

    expect(checklist.markdown).toContain("Checklist PPIRTV");
    expect(checklist.items.length).toBeGreaterThan(0);
    expect(checklist.display.phase_label).toBe("Pensamentos");
    expect(checklist.display.phase_emoji).toBe("🧠");
    expect(checklist.display.checklist_visual?.[0]).toHaveProperty("emoji");
    expect(checklist.operational_principles.some((item) => item.id === "memoria_sem_lembranca")).toBe(true);
    expect(checklist.operational_principles.find((item) => item.id === "casa_limpa")?.label).toContain("ouro");
    expect(checklist.display.checklist_visual?.length).toBeGreaterThan(checklist.items.length);
    expect(checklist.aliases.estacionamento).toEqual([]);
    expect(checklist.aliases.garimpo).toEqual([]);
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
      const checklist = await engine.renderChecklist(flow.flow_id);

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
      const checklist = await engine.renderChecklist(flow.flow_id);

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
      const checklist = await engine.renderChecklist(flow.flow_id);

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
      const checklist = await engine.renderChecklist(flow.flow_id);

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
      const checklist = await engine.renderChecklist(flow.flow_id);
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
    const finalAdvance = await engine.advance({ flow_id: flow.flow_id, provided: { residual_risks: ["baixo"], next_step: "arquivar", clean_house: true } });
    const archived = await engine.archiveFlow({ flow_id: flow.flow_id, reason: "E2E completo" });

    expect(finalAdvance).toMatchObject({ advanced: true, from: "validacao", to: null, status: "complete" });
    expect(archived.status).toBe("archived");
  });
});

async function startGoalWithEvidence(
  idempotencyKey: string,
  objective: string,
  targetEngine: FlowEngine = engine
): Promise<{ flowId: string; evidenceId: string; workspace: string; sptPath: string }> {
  const workspace = path.join(tempRoot, idempotencyKey.replace(/[^a-z0-9_-]+/gi, "-"));
  const sptPath = await writeFakeSpt(workspace);
  const started = await targetEngine.startGoal({
    workspace,
    spt_path: sptPath,
    objective,
    idempotency_key: idempotencyKey,
    evidence_required: true,
    required_evidence: ["npm run check"],
    requested_verdict_policy: "evidence_required",
    source: "dex-code"
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

async function writeFakeSpt(workspace: string): Promise<string> {
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-05-24-fake-goal-spt.md");
  await writeFile(sptPath, fakeSptText(), "utf8");
  return sptPath;
}

function fakeSptText(): string {
  return [
    "# Trilho - Fake GOAL SPT",
    "",
    "Tipo: SPEC-PLAN-TASKs",
    "Status: EM TESTE",
    "Owner: Teste",
    "Data: 2026-05-24",
    "Workspace: <workspace>",
    "Origem: teste",
    "",
    "## GoalEnvelope",
    "",
    "```json",
    "{",
    "  \"workspace\": \"<workspace>\",",
    "  \"spt_path\": \"<spt-path>\",",
    "  \"objective\": \"Executar ponte GOAL/SPT\",",
    "  \"idempotency_key\": \"dex-code:test-goal-001\",",
    "  \"evidence_required\": true,",
    "  \"required_evidence\": [\"npm run check\"],",
    "  \"requested_verdict_policy\": \"evidence_required\",",
    "  \"source\": \"dex-code\"",
    "}",
    "```",
    "",
    "## Contexto",
    "",
    "Teste local do contrato GOAL/SPT.",
    "",
    "## Problema",
    "",
    "Garantir que o flow receba campos normalizados.",
    "",
    "## Decisao",
    "",
    "Usar SPT canonico em .agents/PLAN-TASKS.",
    "",
    "## Escopo",
    "",
    "- Validar SPT local.",
    "",
    "## Fora de escopo",
    "",
    "- Ler secrets.",
    "",
    "## SPEC",
    "",
    "Executar ponte GOAL/SPT com evidencia rastreavel.",
    "",
    "## PLAN",
    "",
    "1. Validar SPT.",
    "2. Criar flow.",
    "3. Registrar evidencia.",
    "",
    "## TASKs",
    "",
    "- [ ] Rodar teste local.",
    "",
    "## Expected Evidence",
    "",
    "- npm run check.",
    "",
    "## Done Criteria",
    "",
    "- npm run check.",
    "",
    "## Riscos",
    "",
    "- Falso pronto sem evidencia.",
    "",
    "## Gates",
    "",
    "- tasks, expected_evidence e done_criteria preenchidos.",
    "",
    "## Validacao",
    "",
    "- npm run check.",
    "",
    "## Prompt /GOAL de execucao",
    "",
    "```text",
    "/GOAL",
    "Execute este SPT.",
    "```"
  ].join("\n");
}
