import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    await writeFile(path.join(tempRoot, "sandbox.toml"), 'api_key = "fake-test-secret-value"\n', "utf8");
    process.chdir(tempRoot);
    try {
      const hygiene = await engine.hygieneScan();
      const finding = hygiene.findings.find((item) => item.id === "security:secret_like_config:sandbox.toml");

      expect(finding).toMatchObject({
        category: "security",
        severity: "warning"
      });
      expect(JSON.stringify(finding)).toContain("sandbox.toml:api_key");
      expect(JSON.stringify(finding)).not.toContain("fake-test-secret-value");
    } finally {
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
