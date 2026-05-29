import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { promptText } from "../src/catalogs.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-engine-"));
  engine = new FlowEngine(new PpirtvStore(tempRoot));
});

afterEach(async () => {
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
    const meeting = await engine.goalMeetingOpen({
      flow_id: started.flow_id as string,
      type: "divergent",
      question: "Item neutro promove?"
    });
    await engine.goalMeetingRecord({
      flow_id: started.flow_id as string,
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
    const recordedWithoutMaterial = await engine.goalMeetingRecord({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
      risks: ["GOAL pode virar checklist passivo sem gate persistido."],
      cooperators: [{ name: "Questionador", reason: "sugeriu pergunta de escopo", material: false }],
      active_credits: ["Questionador sugeriu pergunta de escopo"]
    });
    const convergent = await engine.goalMeetingOpen({
      flow_id: flowId,
      type: "convergent",
      question: "Qual decisao fecha a fase de pensamentos?"
    });
    const recorded = await engine.goalMeetingRecord({
      flow_id: flowId,
      meeting_id: convergent.meeting_id as string,
      decisions: ["Persistir gate antes de avancar fase."],
      risks: ["Falso pronto sem ledger."],
      parking_lot: ["Avaliar resource futuro para especialistas vivos."],
      gold_mining: ["Credito material nasce de meeting_record, nao de sugestao."],
      cooperators: [{ name: "Chato", reason: "bloqueou credito decorativo e exigiu gate persistido", material: true }],
      active_credits: ["Chato bloqueou credito decorativo e exigiu gate persistido"]
    });
    const gate = await engine.goalGateCheck({ flow_id: flowId });
    const advanced = await engine.goalAdvance({ flow_id: flowId });
    const status = await engine.goalStatus({ flow_id: flowId });
    const ledger = await engine.store.readLedger(flowId);

    expect((opened.suggested_cooperators as Array<Record<string, unknown>>)[0].material).toBe(false);
    expect(recordedWithoutMaterial.active_credits).toEqual([]);
    expect(recorded.active_credits).toEqual(
      expect.arrayContaining([
        "Chato bloqueou credito decorativo e exigiu gate persistido",
        "Chato: bloqueou credito decorativo e exigiu gate persistido"
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
    expect(status.gold_mining).toEqual(expect.arrayContaining(["Credito material nasce de meeting_record, nao de sugestao."]));
    expect(ledger.map((event) => event.type)).toEqual(
      expect.arrayContaining(["goal_started", "meeting_opened", "meeting_recorded", "gate_checked", "phase_advanced"])
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
      await engine.goalMeetingRecord({
        flow_id: flowId,
        meeting_id: opened.meeting_id as string,
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
      const ledger = await engine.store.readLedger(flowId);

      expect(mined.write_policy).toBe("auto_write");
      expect(mined.blocked_verdict).toBe(false);
      expect(written.length).toBeGreaterThan(0);
      expect(lembranca).toContain("DUnitX standalone");
      expect(memoria).toContain("Delphi DUnitX standalone");
      expect(memoryStatus.written_count).toBeGreaterThan(0);
      expect(ledger.map((event) => event.type)).toContain("memory_mined");
    } finally {
      restoreDexMemoriaHome(originalDexMemoriaHome);
    }
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
    await engine.goalMeetingRecord({
      flow_id: flowId,
      meeting_id: opened.meeting_id as string,
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
      expect.arrayContaining(["ponto_cego", "armadilha", "heuristica", "nao_promover"])
    );
    expect(links.some((link) => link.garimpo_vinculado.classificacao === "dica_de_ouro")).toBe(false);
    const mined = await engine.mineMemory({ flow_id: flowId, write_policy: "classify_only" });
    const candidates = mined.candidates as Array<Record<string, unknown>>;
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ theme: "delphi", scope: "tema" })]));
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ theme: "mcp", scope: "tema" })]));
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ scope: "descartar" })]));
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ blocked_reason: "secret_like_value_detected" })]));
  });

  it("blocks positive GOAL verdict when memory mining finds an invalid theme route", async () => {
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
      ).rejects.toThrow(/MEMORY_MINING_BLOCKED_VERDICT/);
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
