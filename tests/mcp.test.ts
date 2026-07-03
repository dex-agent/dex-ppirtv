import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { REQUIRED_PROMPTS, REQUIRED_TOOLS } from "../src/domain.js";

let tempRoot: string;
let mcpWorkspace: string;
let client: Client | undefined;
let transport: StdioClientTransport | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-mcp-"));
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  transport = undefined;
  mcpWorkspace = "";
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("PPIRTV MCP stdio server", () => {
  it("starts and lists tools, resources and prompts deterministically", async () => {
    await connectClient();

    const tools = await client!.listTools();
    const resources = await client!.listResources();
    const resourceTemplates = await client!.listResourceTemplates();
    const prompts = await client!.listPrompts();

    expect(tools.tools.map((tool) => tool.name)).toEqual([...REQUIRED_TOOLS]);
    expect(resources.resources.map((resource) => resource.uri)).toEqual([
      "ppirtv://flows",
      "ppirtv://templates/gates",
      "ppirtv://templates/meetings",
      "ppirtv://reference/mcp"
    ]);
    expect(resourceTemplates.resourceTemplates.map((resource) => resource.uriTemplate)).toEqual([
      "ppirtv://flow/{flow_id}",
      "ppirtv://flow/{flow_id}/checklist",
      "ppirtv://flow/{flow_id}/ledger",
      "ppirtv://flow/{flow_id}/meetings"
    ]);
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual([...REQUIRED_PROMPTS]);
  });

  it("creates a flow through MCP and exposes it through resources after restart", async () => {
    await connectClient();
    const created = await client!.callTool({
      name: "flow_create",
      arguments: {
        goal: "Smoke MCP",
        context: "stdio client",
        risks: ["state loss"],
        uncertainties: ["none"]
      }
    });
    const flowId = resultOf(created).flow_id as string;
    expect(flowId).toMatch(/^flow_/);
    await client!.close();

    await connectClient();
    const status = await client!.callTool({ name: "flow_status", arguments: { flow_id: flowId } });
    const flow = resultOf(status);
    const resource = await client!.readResource({ uri: `ppirtv://flow/${flowId}` });

    expect(flow.flow_id).toBe(flowId);
    expect(resource.contents[0]?.text).toContain(flowId);
  });

  it("runs the GOAL/SPT bridge through MCP with idempotency and evidence", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Auditar ponte GOAL/SPT por MCP",
      idempotency_key: "dex-code:mcp-goal-001",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    };

    const validation = await client!.callTool({ name: "spt_validate", arguments: envelope });
    const started = await client!.callTool({ name: "goal_start", arguments: envelope });
    const reused = await client!.callTool({ name: "goal_start", arguments: envelope });
    const flowId = resultOf(started).flow_id as string;
    const evidence = await client!.callTool({
      name: "evidence_add",
      arguments: { flow_id: flowId, title: "vitest run", content: "pass", satisfies: ["vitest"] }
    });
    const meeting = await client!.callTool({
      name: "goal_meeting_open",
      arguments: { flow_id: flowId, type: "convergent", question: "Evidencia MCP basta para veredito positivo?" }
    });
    await client!.callTool({
      name: "goal_meeting_close",
      arguments: {
        flow_id: flowId,
        meeting_id: resultOf(meeting).meeting_id,
        participants_present: ["chato", "validador-pronto", "reuniao", "questionador"],
        decision: "veredito positivo permitido apos evidencia e validacao material",
        decisions: ["veredito positivo permitido apos evidencia e validacao material"],
        satisfies_blockers: ["required_cooperation"],
        cooperators: [
          { name: "chato", reason: "pressionou falso pronto antes do veredito", material: true },
          { name: "validador-pronto", reason: "validou evidencia rastreavel", material: true }
        ],
        active_credits: ["chato pressionou falso pronto", "validador-pronto validou evidencia"]
      }
    });
    const verdict = await client!.callTool({
      name: "goal_verdict",
      arguments: {
        flow_id: flowId,
        status: "pronto",
        rationale: "Evidencia MCP anexada",
        evidence_ids: [resultOf(evidence).evidence_id],
        residual_risks: [],
        next_step: "arquivar"
      }
    });
    const status = await client!.callTool({ name: "goal_status", arguments: { idempotency_key: envelope.idempotency_key } });
    const checkout = await client!.callTool({ name: "ppirtv_checkout", arguments: { idempotency_key: envelope.idempotency_key } });

    expect(resultOf(validation).valid).toBe(true);
    expect(resultOf(validation).tasks).toContain("Rodar teste MCP.");
    expect(resultOf(validation).expected_evidence).toContain("vitest.");
    expect(resultOf(started).started).toBe(true);
    expect(resultOf(reused).reused).toBe(true);
    expect(resultOf(reused).flow_id).toBe(flowId);
    expect(resultOf(status).tasks).toEqual(expect.arrayContaining(["Rodar teste MCP."]));
    expect(resultOf(status).expected_evidence).toEqual(expect.arrayContaining(["vitest."]));
    expect(resultOf(status).done_criteria).toEqual(expect.arrayContaining(["vitest."]));
    expect(resultOf(status)).toMatchObject({
      project_root: mcpWorkspace,
      ppirtv_home: path.join(mcpWorkspace, ".ppirtv"),
      runtime_layout_status: { status: "ready", missing_directories: [] }
    });
    expect(resultOf(checkout)).toMatchObject({
      project_root: mcpWorkspace,
      ppirtv_home: path.join(mcpWorkspace, ".ppirtv"),
      runtime_layout_status: { status: "ready", missing_directories: [] }
    });
    expect(resultOf(status).phase_emoji).toBe("🧠");
    expect(((resultOf(verdict).verdict as Record<string, unknown>).status)).toBe("pronto");
    expect((resultOf(status).current_verdict as Record<string, unknown>).status).toBe("pronto");
    expect(resultOf(checkout)).toMatchObject({
      flow_id: flowId,
      complete: true,
      verdict: "pronto",
      direct_action: "fechamento_total_registrado",
      memory_accountability: expect.any(Object),
      learning_accountability: expect.any(Object),
      cooperation_accountability: expect.any(Object),
      librarian_accountability: expect.any(Object),
      utility_accountability: expect.any(Object),
      contract_accountability: expect.any(Object),
      ready_definition: expect.any(Array),
      gate_final_output: expect.any(Array),
      final_report_model: expect.any(Array),
      prestacao_de_contas: expect.any(Object)
    });
    expect(resultOf(checkout).memory_accountability).toMatchObject({
      required: false,
      memory_required_but_empty: false,
      memory_written: false,
      memory_validated: false,
      memory_consolidated: false
    });
    expect((resultOf(checkout).blocker_diagnostics as Record<string, unknown>).effective_blockers).toEqual([]);
    expect(resultOf(checkout).ppirtv_checkout).toMatchObject({
      prestacao_de_contas: expect.any(Object),
      utility_accountability: expect.any(Object),
      contract_accountability: expect.any(Object),
      final_report_model: expect.any(Array)
    });
  });

  it("keeps goal_verdict_required over MCP when validation only has provided verdict text", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "workspace-verdict-required");
    const sptPath = await writeFakeSpt(workspace);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Bloquear falso pronto MCP em validacao",
      idempotency_key: "dex-code:mcp-goal-verdict-required",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    };

    const started = await client!.callTool({ name: "goal_start", arguments: envelope });
    const flowId = resultOf(started).flow_id as string;
    const evidence = await client!.callTool({
      name: "evidence_add",
      arguments: { flow_id: flowId, title: "vitest fiscal", content: "pass", satisfies: ["vitest"] }
    });
    await client!.callTool({
      name: "evidence_add",
      arguments: {
        flow_id: flowId,
        kind: "code_review",
        title: "review fiscal",
        content: "review confirmou que provided.verdict nao substitui goal_verdict",
        satisfies: ["review_required"]
      }
    });
    const meeting = await client!.callTool({
      name: "goal_meeting_open",
      arguments: { flow_id: flowId, type: "convergent", question: "Validacao sem veredito canonico pode completar?" }
    });
    await client!.callTool({
      name: "goal_meeting_close",
      arguments: {
        flow_id: flowId,
        meeting_id: resultOf(meeting).meeting_id,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "GOAL oficial precisa de goal_verdict canonico antes de completar.",
        satisfies_blockers: ["required_cooperation"],
        cooperators: [{ name: "chato", reason: "bloqueou falso pronto fiscal", material: true }],
        active_credits: ["chato bloqueou falso pronto fiscal"]
      }
    });
    await client!.callTool({ name: "goal_advance", arguments: { flow_id: flowId } });
    await client!.callTool({ name: "goal_advance", arguments: { flow_id: flowId } });
    await client!.callTool({
      name: "goal_advance",
      arguments: { flow_id: flowId, provided: { implementation_done: true, changed_files: ["src/flow-engine.ts"] } }
    });
    await client!.callTool({
      name: "goal_advance",
      arguments: {
        flow_id: flowId,
        provided: { diff_reviewed: true, barata_scan: true, regression_risks: ["provided.verdict nao e veredito canonico"] }
      }
    });
    await client!.callTool({
      name: "goal_advance",
      arguments: { flow_id: flowId, provided: { test_executed: true, evidence: resultOf(evidence).evidence_id } }
    });

    const gate = await client!.callTool({
      name: "goal_gate_check",
      arguments: {
        flow_id: flowId,
        phase: "validacao",
        provided: {
          verdict: "pronto_com_ressalvas",
          residual_risks: ["veredito canonico pendente"],
          next_step: "chamar goal_verdict antes de completar",
          clean_house: true
        }
      }
    });
    const advanced = await client!.callTool({ name: "goal_advance", arguments: { flow_id: flowId } });
    const status = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId } });
    const checkout = await client!.callTool({ name: "ppirtv_checkout", arguments: { flow_id: flowId } });
    const ledger = await client!.readResource({ uri: `ppirtv://flow/${flowId}/ledger` });
    const ledgerText = ledger.contents[0]?.text ?? "";

    expect(resultOf(gate)).toMatchObject({ status: "blocked", missing: ["verdict"] });
    expect(resultOf(advanced)).toMatchObject({
      advanced: false,
      blocked: true,
      status: "blocked",
      missing: ["verdict"],
      status_snapshot: {
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict"
        }
      }
    });
    expect(resultOf(status)).toMatchObject({
      phase: "validacao",
      current_verdict: null,
      next_required_action: {
        type: "goal_verdict_required",
        tool: "goal_verdict"
      }
    });
    expect(resultOf(checkout).ppirtv_checkout).toMatchObject({
      complete: false,
      verdict: null,
      resolution_guidance: {
        next_required_action: {
          type: "goal_verdict_required",
          tool: "goal_verdict"
        }
      }
    });
    expect(ledgerText).not.toContain("verdict_recorded");
    expect(ledgerText).not.toContain("flow_completed");
  });

  it("runs the live GOAL wrappers through MCP", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Auditar ponte GOAL/SPT por MCP",
      idempotency_key: "dex-code:mcp-live-goal-001",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    };

    const started = await client!.callTool({ name: "goal_start", arguments: envelope });
    const flowId = resultOf(started).flow_id as string;
    const opened = await client!.callTool({
      name: "goal_meeting_open",
      arguments: {
        flow_id: flowId,
        type: "divergent",
        question: "Como provar que a reuniao e viva?",
        suggested_cooperators: [{ name: "Chato", reason: "pressionar credito material falso", material: true }]
      }
    });
    const meetingId = resultOf(opened).meeting_id as string;
    const turn = await client!.callTool({
      name: "goal_meeting_add_turn",
      arguments: {
        flow_id: flowId,
        meeting_id: meetingId,
        speaker: "questionador",
        question: "E SE a reuniao nao tiver decisao?",
        finding: "Sem decisao, nao satisfaz blocker material."
      }
    });
    const closed = await client!.callTool({
      name: "goal_meeting_close",
      arguments: {
        flow_id: flowId,
        meeting_id: meetingId,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "Reuniao MCP fechada com decisao e participantes minimos.",
        satisfies_blockers: ["required_cooperation"],
        risks: ["credito decorativo"],
        cooperators: [{ name: "Chato", reason: "exigiu evidencia de ledger", material: true }],
        active_credits: ["Chato exigiu evidencia de ledger"]
      }
    });
    const regressed = await client!.callTool({
      name: "goal_regress",
      arguments: {
        flow_id: flowId,
        to: "pensamentos",
        meeting_id: meetingId,
        reason: "Regresso MCP auditavel apos reuniao fechada."
      }
    });
    const gate = await client!.callTool({ name: "goal_gate_check", arguments: { flow_id: flowId } });
    const advanced = await client!.callTool({ name: "goal_advance", arguments: { flow_id: flowId } });
    const status = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId } });
    const checkout = await client!.callTool({ name: "ppirtv_checkout", arguments: { flow_id: flowId } });
    const resource = await client!.readResource({ uri: `ppirtv://flow/${flowId}/ledger` });

    expect((resultOf(opened).suggested_cooperators as Array<Record<string, unknown>>)[0].material).toBe(false);
    expect(resultOf(turn).turns).toEqual(expect.arrayContaining([expect.objectContaining({ speaker: "questionador" })]));
    expect(resultOf(closed)).toMatchObject({ status: "closed", decision: "Reuniao MCP fechada com decisao e participantes minimos." });
    expect(resultOf(closed).active_credits).toEqual(expect.arrayContaining(["Chato exigiu evidencia de ledger"]));
    expect(resultOf(regressed)).toMatchObject({ regressed: true, regress_count: 1 });
    expect(resultOf(gate).status).toBe("passed");
    expect(resultOf(gate).persisted).toBe(true);
    expect(resultOf(advanced)).toMatchObject({ advanced: true, from: "pensamentos", to: "planejamento" });
    expect(resultOf(status).phase).toBe("planejamento");
    expect(resultOf(status).active_credits).toEqual(expect.arrayContaining(["Chato exigiu evidencia de ledger"]));
    expect(resultOf(status).meetings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meeting_id: meetingId,
          status: "closed",
          kind: "divergente",
          suggested_cooperators: expect.arrayContaining([expect.objectContaining({ name: "Chato", material: false })])
        })
      ])
    );
    expect(resultOf(checkout).ppirtv_checkout).toMatchObject({
      cooperation_accountability: {
        suggested_count: 1,
        material_count: 1,
        suggested: expect.arrayContaining([expect.objectContaining({ name: "Chato", material: false })])
      }
    });
    expect(resource.contents[0]?.text).toContain("meeting_opened");
    expect(resource.contents[0]?.text).toContain("meeting_turn_added");
    expect(resource.contents[0]?.text).toContain("meeting_closed");
    expect(resource.contents[0]?.text).toContain("goal_regressed");
    expect(resource.contents[0]?.text).toContain("gate_checked");
    expect(resource.contents[0]?.text).toContain("phase_advanced");
  });

  it("exposes mm_memory_mining and writes valid candidates through MCP", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Auditar memoria por MCP",
      idempotency_key: "dex-code:mcp-mm-memory-mining-001",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    };

    const started = await client!.callTool({ name: "goal_start", arguments: envelope });
    const flowId = resultOf(started).flow_id as string;
    const opened = await client!.callTool({
      name: "goal_meeting_open",
      arguments: { flow_id: flowId, type: "divergent", question: "Qual memoria deve ser minerada?" }
    });
    await client!.callTool({
      name: "goal_meeting_close",
      arguments: {
        flow_id: flowId,
        meeting_id: resultOf(opened).meeting_id,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "Garimpo de memoria fechado pelo fluxo novo.",
        satisfies_blockers: ["required_cooperation"],
        parking_lot: ["Ponto cego Delphi DUnitX standalone vs provider precisa virar memoria reutilizavel."]
      }
    });
    const mined = await client!.callTool({ name: "mm_memory_mining", arguments: { flow_id: flowId } });
    const status = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId } });
    const lembranca = await readFile(path.join(tempRoot, "memories", "temas", "delphi", "LEMBRANCA.md"), "utf8");
    const memoria = await readFile(path.join(tempRoot, "memories", "temas", "delphi", "MEMORIA.md"), "utf8");

    expect(resultOf(mined).write_policy).toBe("auto_write");
    expect(resultOf(mined).blocked_verdict).toBe(false);
    expect(resultOf(mined).written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          files: expect.arrayContaining([
            path.join(tempRoot, "memories", "temas", "delphi", "LEMBRANCA.md"),
            path.join(tempRoot, "memories", "temas", "delphi", "MEMORIA.md")
          ])
        })
      ])
    );
    expect(resultOf(status).goal_learning_links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          garimpo_vinculado: expect.objectContaining({ promovido_para_gold_mining: true })
        })
      ])
    );
    expect(lembranca).toContain("DUnitX standalone");
    expect(memoria).toContain("Delphi DUnitX standalone");
  });

  it("enforces mm_memory_mining auto_classify and weak parking rules through MCP", async () => {
    await connectClient();
    const created = await client!.callTool({
      name: "flow_create",
      arguments: {
        goal: "Weak parking MCP",
        context: "ctx",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      }
    });
    const flowId = resultOf(created).flow_id as string;
    const opened = await client!.callTool({
      name: "meeting_open",
      arguments: { flow_id: flowId, type: "divergent", question: "O que ficou fraco?" }
    });
    await client!.callTool({
      name: "meeting_record",
      arguments: {
        meeting_id: resultOf(opened).meeting_id,
        parking_lot: ["Quando contrato MCP falhar, validar gate antes do veredito."]
      }
    });

    const invalidAutoWrite = await client!.callTool({
      name: "mm_memory_mining",
      arguments: { flow_id: flowId, auto_classify: false, write_policy: "auto_write" }
    });
    expect((invalidAutoWrite as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(invalidAutoWrite)).toContain("AUTO_CLASSIFY_DISABLED_AUTO_WRITE");

    const skipped = await client!.callTool({
      name: "mm_memory_mining",
      arguments: { flow_id: flowId, auto_classify: false, write_policy: "classify_only" }
    });
    const mined = await client!.callTool({ name: "mm_memory_mining", arguments: { flow_id: flowId } });

    expect(resultOf(skipped)).toMatchObject({ auto_classify: false, classification_skipped: true, candidates: [], written: [] });
    expect(resultOf(mined).written).toEqual([]);
    expect(resultOf(mined).candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "parking_lot",
          scope: "ledger_only",
          score: expect.objectContaining({ evidencia: 0 })
        })
      ])
    );
  });

  it("returns structured MCP error envelopes without removing human-readable text", async () => {
    await connectClient();

    const missingGoal = await client!.callTool({ name: "goal_status", arguments: {} });
    expect((missingGoal as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(missingGoal)).toContain("flow_id or idempotency_key is required");
    expect(resultOf(missingGoal).error).toMatchObject({
      code: "GOAL_NAO_ATIVO",
      recoverable: true,
      next_required_action: {
        tool: "goal_start"
      },
      contract_source: "docs/contracts/GOAL_SPT_CANONICAL_CONTRACT.md"
    });

    const workspace = path.join(tempRoot, "workspace-mcp-error-envelope");
    const sptPath = await writeFakeSpt(workspace);
    const started = await client!.callTool({
      name: "goal_start",
      arguments: {
        workspace,
        spt_path: sptPath,
        objective: "Validar envelope de erro MCP",
        idempotency_key: "dex-code:mcp-error-envelope",
        evidence_required: true,
        required_evidence: ["vitest"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      }
    });
    const flowId = resultOf(started).flow_id as string;
    const missingEvidence = await client!.callTool({
      name: "goal_verdict",
      arguments: {
        flow_id: flowId,
        status: "pronto",
        rationale: "Tentativa positiva sem evidencia",
        next_step: "anexar evidencia antes de tentar novamente"
      }
    });
    expect((missingEvidence as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(missingEvidence)).toContain("goal_verdict requires traceable evidence_ids");
    expect(resultOf(missingEvidence).error).toMatchObject({
      code: "EVIDENCIA_AUSENTE",
      recoverable: true,
      next_required_action: {
        tool: "evidence_add"
      }
    });
    // BUG 4: o envelope EVIDENCIA_AUSENTE precisa informar o flow_id e o que
    // falta, para o consumidor saber exatamente quais args passar em
    // evidence_add, em vez de adivinhar.
    expect(resultOf(missingEvidence).error.next_required_action).toMatchObject({
      args: { flow_id: flowId }
    });

    const evidence = await client!.callTool({
      name: "evidence_add",
      arguments: {
        flow_id: flowId,
        kind: "note",
        title: "validacao estruturada",
        content: "validadores externos verdes e L1/L2 confirmados por finder"
      }
    });
    const meeting = await client!.callTool({
      name: "goal_meeting_open",
      arguments: {
        flow_id: flowId,
        kind: "divergente",
        participants_required: ["chato", "questionador", "reuniao", "garimpeiro", "dex-memoria", "validador-pronto"],
        question: "Memoria externa validada resolve memoria canonica do flow?"
      }
    });
    await client!.callTool({
      name: "goal_meeting_close",
      arguments: {
        flow_id: flowId,
        meeting_id: resultOf(meeting).meeting_id,
        participants_present: ["chato", "questionador", "reuniao", "garimpeiro", "dex-memoria", "validador-pronto"],
        decision: "Ainda precisa de mm_memory_mining canonico no flow.",
        satisfies_blockers: ["required_cooperation"]
      }
    });
    const memoryBlocked = await client!.callTool({
      name: "goal_verdict",
      arguments: {
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Memoria L1/L2 externa validada fora do PPIRTV.",
        evidence_ids: [resultOf(evidence).evidence_id],
        meeting_id: resultOf(meeting).meeting_id,
        residual_risks: ["memoria L1/L2 externa validada sem mm_memory_mining canonico"],
        next_step: "rodar mm_memory_mining agora"
      }
    });
    expect((memoryBlocked as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(memoryBlocked)).toContain("memory_required_but_empty");
    expect(resultOf(memoryBlocked).error).toMatchObject({
      code: "PPIRTV_FISCAL_BLOCKED",
      recoverable: true,
      next_required_action: {
        type: "run_memory_mining",
        tool: "mm_memory_mining"
      }
    });
    const memoryAction = resultOf(memoryBlocked).error.next_required_action as Record<string, unknown>;
    const memorySequence = memoryAction.required_tool_sequence as Array<{ args?: Record<string, unknown> }>;
    expect(memorySequence[0]?.args?.flow_id).toBe(flowId);
    expect(memorySequence[1]?.args?.flow_id).toBe(flowId);

    const secretBlocked = await client!.callTool({
      name: "evidence_add",
      arguments: {
        flow_id: flowId,
        title: "secret evidence",
        content: "Authorization: Bearer abcdefghijklmnop"
      }
    });
    expect((secretBlocked as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(secretBlocked)).not.toContain("abcdefghijklmnop");
    expect(resultOf(secretBlocked).error).toMatchObject({
      code: "SENSITIVE_CONTENT_BLOCKED",
      recoverable: false
    });
  });

  it("runs five PPIRTV flows sequentially through mm_pipeline_run over MCP", async () => {
    await connectClient();
    const pipeline = Array.from({ length: 5 }, (_, index) => validPipelineItem(`MCP pipeline item ${index + 1}`));

    const response = await client!.callTool({
      name: "mm_pipeline_run",
      arguments: {
        pipeline,
        stop_on_failure: true,
        auto_memory_mining: false
      }
    });
    const result = resultOf(response);
    const flows = result.flows as Array<Record<string, unknown>>;
    const firstFlowId = flows[0].flow_id as string;
    const resource = await client!.readResource({ uri: `ppirtv://flow/${firstFlowId}/ledger` });
    const ledgerText = resource.contents[0]?.text ?? "";

    expect(result.pipeline_id).toMatch(/^pipe_/);
    expect(result).toMatchObject({
      total: 5,
      completed: 5,
      failed: 0,
      pending: 0,
      stop_on_failure: true,
      auto_memory_mining: false
    });
    expect(flows).toHaveLength(5);
    expect(flows.every((flow) => flow.status === "pronto" && /^flow_/.test(String(flow.flow_id)))).toBe(true);
    expect(ledgerText).toContain("pipeline_item_started");
    expect(ledgerText).toContain("pipeline_item_completed");
    expect(ledgerText).toContain("verdict_recorded");
  });

  it("keeps mm_pipeline_run ids unique and mines memory after verdict over MCP", async () => {
    await connectClient();
    const first = resultOf(
      await client!.callTool({
        name: "mm_pipeline_run",
        arguments: { pipeline: [validPipelineItem("MCP rapid pipeline A")], auto_memory_mining: false }
      })
    );
    const second = resultOf(
      await client!.callTool({
        name: "mm_pipeline_run",
        arguments: { pipeline: [validPipelineItem("MCP rapid pipeline B")], auto_memory_mining: false }
      })
    );

    expect(first.pipeline_id).not.toBe(second.pipeline_id);

    const mined = resultOf(
      await client!.callTool({
        name: "mm_pipeline_run",
        arguments: {
          pipeline: [
            {
              ...validPipelineItem("MCP pipeline verdict mining"),
              verdict_gold_mining: ["Ponto cego Delphi DUnitX standalone vs provider vindo do veredito MCP."]
            }
          ],
          auto_memory_mining: true
        }
      })
    );
    const flow = (mined.flows as Array<Record<string, unknown>>)[0];
    const ledger = await client!.readResource({ uri: `ppirtv://flow/${flow.flow_id}/ledger` });
    const ledgerText = ledger.contents[0]?.text ?? "";
    const memoryText = await readFile(path.join(tempRoot, "memories", "temas", "delphi", "MEMORIA.md"), "utf8");

    expect(flow.status).toBe("pronto");
    expect(ledgerText.indexOf("verdict_recorded")).toBeLessThan(ledgerText.indexOf("memory_mined"));
    expect(memoryText).toContain("Delphi DUnitX standalone");
  });


  it("returns missing, next and back_to when gate blocks an advance", async () => {
    await connectClient();
    const created = await client!.callTool({ name: "flow_create", arguments: { goal: "Gate block" } });
    const flowId = resultOf(created).flow_id as string;

    const advanced = await client!.callTool({ name: "flow_advance", arguments: { flow_id: flowId } });
    const result = resultOf(advanced);

    expect(result.advanced).toBe(false);
    expect(result.missing).toEqual(["context", "risks", "uncertainties"]);
    expect(result.next).toBe("complete_gate_pensamentos");
    expect(result.back_to).toBeNull();
    expect((result.aliases as Record<string, unknown>).faltando).toEqual(result.missing);
    expect((result.aliases as Record<string, unknown>).proximo).toBe(result.next);
    expect((result.aliases as Record<string, unknown>).voltar_para).toBe(result.back_to);
    expect(((result.display as Record<string, unknown>).active_credits as unknown[])).toEqual([]);
    expect(((result.suggested_cooperation as Array<Record<string, unknown>>)[0].material)).toBe(false);
  });

  it("returns a visual checklist display through MCP", async () => {
    await connectClient();
    const created = await client!.callTool({
      name: "flow_create",
      arguments: {
        goal: "Checklist visual MCP",
        context: "ctx",
        risks: ["risco"],
        uncertainties: ["lacuna"]
      }
    });
    const flowId = resultOf(created).flow_id as string;

    const checklist = await client!.callTool({ name: "checklist_render", arguments: { flow_id: flowId } });
    const result = resultOf(checklist);
    const display = result.display as Record<string, unknown>;

    expect(result.markdown).toContain("Checklist PPIRTV");
    expect(result.markdown).toContain("Gate Final PPIRTV");
    expect(Array.isArray(result.items)).toBe(true);
    expect(Array.isArray(result.operational_principles)).toBe(true);
    expect(Array.isArray(result.ready_definition)).toBe(true);
    expect(Array.isArray(result.gate_final_output)).toBe(true);
    expect(Array.isArray(result.final_report_model)).toBe(true);
    expect(display.phase_emoji).toBe("🧠");
    expect(Array.isArray(display.checklist_visual)).toBe(true);
    expect((display.checklist_visual as unknown[]).length).toBeGreaterThan((result.items as unknown[]).length);
  });

  it("returns useful prompt templates", async () => {
    await connectClient();
    const prompt = await client!.getPrompt({ name: "final-verdict", arguments: { flow_id: "flow_demo" } });
    expect(prompt.messages[0]?.content.type).toBe("text");
    const text = prompt.messages[0]?.content.type === "text" ? prompt.messages[0].content.text : "";
    expect(text).toContain("flow_demo");
    expect(text).toContain("Principios operacionais");
    expect(text).toContain("Modelo de relatorio final PPIRTV");
    expect(text).toContain("Status final: pronto | parcial | bloqueado");
    expect(text).toContain("goal_verdict");
    expect(text).toContain("L1");
    expect(text).toContain("PLAN-TASKS");

    const convergentPrompt = await client!.getPrompt({ name: "open-convergent-meeting", arguments: { flow_id: "flow_demo" } });
    const convergentText = convergentPrompt.messages[0]?.content.type === "text" ? convergentPrompt.messages[0].content.text : "";
    expect(convergentText).toContain("prompt de handoff/execucao");
    expect(convergentText).toContain("nao e contrato canonico do PPIRTV");
  });
});

async function connectClient(): Promise<void> {
  const workspace = path.join(tempRoot, "mcp-workspace");
  await mkdir(workspace, { recursive: true });
  mcpWorkspace = await realpath(workspace);
  client = new Client({ name: "ppirtv-test-client", version: "0.1.0" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), "dist", "index.js")],
    cwd: workspace,
    env: {
      ...getDefaultEnvironment(),
      PPIRTV_HOME: path.join(workspace, ".ppirtv"),
      DEX_MEMORIA_HOME: path.join(tempRoot, "memories")
    },
    stderr: "pipe"
  });
  await client.connect(transport);
}

function resultOf(response: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  return (response as { structuredContent?: { result?: Record<string, unknown> } }).structuredContent?.result ?? {};
}

function validPipelineItem(goal: string): Record<string, unknown> {
  return {
    goal,
    context: "ctx",
    scope_in: [`src/${goal.toLowerCase().replace(/\s+/g, "-")}.ts`],
    scope_out: ["fora do item atual"],
    tasks: ["executar gates PPIRTV"],
    done_criteria: ["flow completo com veredito"],
    expected_evidence: ["evidencia declarada pelo pipeline"],
    evidence: ["pipeline declarou evidencia para este item"]
  };
}

async function writeFakeSpt(workspace: string): Promise<string> {
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-05-24-fake-goal-spt.md");
  await writeFile(
    sptPath,
    [
      "# Trilho - Fake MCP GOAL SPT",
      "",
      "Tipo: SPEC-PLAN-TASKs",
      "Status: EM TESTE",
      "Owner: Teste",
      "Data: 2026-05-24",
      "Workspace: <workspace>",
      "Origem: teste MCP",
      "",
      "## GoalEnvelope",
      "",
      "```json",
      "{",
      "  \"workspace\": \"<workspace>\",",
      "  \"spt_path\": \"<spt-path>\",",
      "  \"objective\": \"Auditar ponte GOAL/SPT por MCP\",",
      "  \"idempotency_key\": \"dex-code:mcp-goal-001\",",
      "  \"evidence_required\": true,",
      "  \"required_evidence\": [\"vitest\"],",
      "  \"requested_verdict_policy\": \"evidence_required\",",
      "  \"source\": \"dex-code\"",
      "}",
      "```",
      "",
      "## Contexto",
      "",
      "Teste MCP do contrato GOAL/SPT.",
      "",
      "## Problema",
      "",
      "Garantir que o servidor MCP exponha e execute o contrato oficial.",
      "",
      "## Decisao",
      "",
      "Usar SPT canonico e tools oficiais.",
      "",
      "## Escopo",
      "",
      "- Validar SPT por MCP.",
      "",
      "## Fora de escopo",
      "",
      "- Usar tools antigas como substituto silencioso.",
      "",
      "## SPEC",
      "",
      "Auditar ponte GOAL/SPT por MCP.",
      "",
      "## PLAN",
      "",
      "1. Validar SPT.",
      "2. Criar flow.",
      "3. Registrar evidencia.",
      "",
      "## TASKs",
      "",
      "- [ ] Rodar teste MCP.",
      "",
      "## Expected Evidence",
      "",
      "- vitest.",
      "",
      "## Done Criteria",
      "",
      "- vitest.",
      "",
      "## Riscos",
      "",
      "- Cliente MCP antigo nao reiniciado.",
      "",
      "## Gates",
      "",
      "- tasks, expected_evidence e done_criteria preenchidos.",
      "",
      "## Validacao",
      "",
      "- vitest.",
      "",
      "## Prompt /GOAL de execucao",
      "",
      "```text",
      "/GOAL",
      "Execute este SPT.",
      "```"
    ].join("\n"),
    "utf8"
  );
  return sptPath;
}
