// SPT 2026-10-27-mining-deposit-visibility (T-1, RED-first).
// Comportamentos contratados:
// - C-1: o retorno/summary do mm_memory_mining expõe a entrada (nuggets_collected
//   + deposit_guidance no vazio) nos dois caminhos de writer (legacy e v2).
// - C-2: a rota de resgate memoryRequiredErrorAction ensina o depósito
//   (evidence_attach.gold_mining) ANTES de minerar; a description da tool
//   declara que o minerador classifica somente texto depositado.
// - C-3: o tema delphi reconhece o vocabulário de build (dcc32|dpr|dproj).
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { classifyMemoryCandidate, isWritableCandidate } from "../src/memory/mining-policy.js";
import type { DexMemoriaV2Executor, DexMemoriaV2FlowWriterConfig } from "../src/memory/dex-memoria-v2-adapter.js";
import * as serverModule from "../src/server.js";

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

// Acessos por namespace mantêm a suite carregável no RED: o símbolo ausente
// falha o caso individual em vez de derrubar o arquivo inteiro no import.
function unblockAction(flowId: string) {
  const action = (serverModule as Record<string, unknown>).memoryRequiredErrorAction as
    | ((id: string) => { required_tool_sequence: Array<{ order: number; tool: string; args?: Record<string, unknown>; only_if?: string }> })
    | undefined;
  if (typeof action !== "function") {
    throw new Error("RED: memoryRequiredErrorAction não é exportada por src/server.ts");
  }
  return action(flowId);
}

function miningToolDescription() {
  const description = (serverModule as Record<string, unknown>).MM_MEMORY_MINING_TOOL_DESCRIPTION;
  if (typeof description !== "string") {
    throw new Error("RED: MM_MEMORY_MINING_TOOL_DESCRIPTION não é exportada por src/server.ts");
  }
  return description;
}

async function newLegacyEngine(prefix: string) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  return new FlowEngine(new PpirtvStore(path.join(tempRoot, "workspace", ".ppirtv")));
}

async function newV2Engine(prefix: string) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const writer: DexMemoriaV2FlowWriterConfig = {
    profile: "v2",
    executor: vi.fn() as unknown as DexMemoriaV2Executor,
    memory_home: path.join(tempRoot, "memory-home"),
    workspace_root: path.join(tempRoot, "workspace")
  };
  return new FlowEngine(new PpirtvStore(path.join(tempRoot, "workspace", ".ppirtv")), undefined, { memory_writer: writer });
}

describe("C-1: summary do mining expõe a entrada (fim do 0-anestesiante)", () => {
  it("legacy: flow sem depósito devolve nuggets_collected=0 e deposit_guidance citando evidence_attach.gold_mining", async () => {
    const engine = await newLegacyEngine("mining-deposit-legacy-empty-");
    const flow = await engine.createFlow({ goal: "Objetivo neutro sem aprendizados depositados" });
    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" }) as Record<string, unknown>;
    expect(mined.nuggets_collected).toBe(0);
    expect(String(mined.deposit_guidance)).toContain("evidence_attach");
    expect(String(mined.deposit_guidance)).toContain("gold_mining");
    const persisted = await engine.store.loadFlow(flow.flow_id);
    expect(persisted.memory_mining?.nuggets_collected).toBe(0);
    expect(String(persisted.memory_mining?.deposit_guidance)).toContain("evidence_attach");
  });

  it("legacy: flow com depósito elegível devolve nuggets_collected>=1 e SEM deposit_guidance", async () => {
    const engine = await newLegacyEngine("mining-deposit-legacy-with-");
    const flow = await engine.createFlow({ goal: "Objetivo neutro com aprendizado depositado" });
    flow.gold_mining = ["Regra delphi: sempre compilar dcc32 com caminhos absolutos das units"];
    await engine.store.saveFlow(flow);
    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" }) as Record<string, unknown>;
    expect(mined.nuggets_collected as number).toBeGreaterThanOrEqual(1);
    expect(mined.deposit_guidance).toBeUndefined();
  });

  it("v2: flow sem depósito devolve nuggets_collected=0 e deposit_guidance citando evidence_attach.gold_mining", async () => {
    const engine = await newV2Engine("mining-deposit-v2-empty-");
    const flow = await engine.createFlow({ goal: "Objetivo neutro sem aprendizados depositados" });
    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" }) as Record<string, unknown>;
    expect(mined.memory_profile).toBe("v2");
    expect(mined.nuggets_collected).toBe(0);
    expect(String(mined.deposit_guidance)).toContain("evidence_attach");
    expect(String(mined.deposit_guidance)).toContain("gold_mining");
  });

  it("v2: flow com depósito elegível devolve nuggets_collected>=1 e SEM deposit_guidance", async () => {
    const engine = await newV2Engine("mining-deposit-v2-with-");
    const flow = await engine.createFlow({ goal: "Objetivo neutro com aprendizado depositado" });
    flow.gold_mining = ["Memória local deste projeto: sempre validar o workspace antes de gravar."];
    await engine.store.saveFlow(flow);
    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" }) as Record<string, unknown>;
    expect(mined.nuggets_collected as number).toBeGreaterThanOrEqual(1);
    expect(mined.deposit_guidance).toBeUndefined();
  });
});

describe("C-2: rota de unblock ensina o depósito antes de minerar", () => {
  it("memoryRequiredErrorAction põe evidence_attach com gold_mining de exemplo como passo 1", () => {
    const action = unblockAction("flow_exemplo");
    const sequence = action.required_tool_sequence;
    expect(sequence.map((step) => step.tool)).toEqual(["evidence_attach", "mm_memory_mining", "goal_status", "goal_verdict"]);
    expect(sequence[0]).toMatchObject({ order: 1, tool: "evidence_attach" });
    const args = sequence[0].args ?? {};
    expect(Array.isArray(args.gold_mining)).toBe(true);
    expect((args.gold_mining as unknown[]).length).toBeGreaterThan(0);
    const miningStep = sequence.find((step) => step.tool === "mm_memory_mining");
    expect(miningStep?.order).toBeGreaterThan(sequence[0].order);
  });

  it("description do mm_memory_mining declara que classifica somente texto depositado em gold_mining/parking_lot", () => {
    const description = miningToolDescription();
    expect(description).toContain("gold_mining");
    expect(description).toContain("parking_lot");
    expect(description).toContain("only");
  });
});

describe("C-3: delphi build vocabulary (dcc32|dpr|dproj) gera candidato writable", () => {
  it.each([
    "dcc32 -U com path relativo falha F2613 Unit not found; usar caminho absoluto",
    "dpr principal carregava unit com caminho relativo",
    "dproj herdava search path quebrado do projeto"
  ])("item '%s' vira theme=delphi scope=tema writable sem vocabulário de regra", (item) => {
    const candidate = classifyMemoryCandidate({
      id: "mc_probe",
      item,
      source: "gold_mining",
      evidenceScore: 1,
      workspace: path.resolve("synthetic-workspace"),
      dexMemoriaHome: path.resolve("synthetic-memory-home")
    });
    expect(candidate.theme).toBe("delphi");
    expect(candidate.scope).toBe("tema");
    expect(candidate.score.total).toBeGreaterThanOrEqual(6);
    expect(isWritableCandidate(candidate)).toBe(true);
  });
});
