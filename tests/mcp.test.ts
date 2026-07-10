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
    const flowCreateTool = tools.tools.find((tool) => tool.name === "flow_create");
    const flowCreateProperties = (flowCreateTool?.inputSchema as { properties?: Record<string, Record<string, unknown>> }).properties;
    expect(flowCreateTool?.description).toContain("legacy/advisory");
    expect(flowCreateTool?.description).toContain("spt_validate then goal_start");
    expect(flowCreateProperties?.detail?.enum).toEqual(["lean", "full"]);
    expect(flowCreateProperties?.mode).toBeUndefined();
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
    const createdResult = resultOf(created);
    const flowId = createdResult.flow_id as string;
    expect(flowId).toMatch(/^flow_/);
    expect(createdResult).toMatchObject({
      phase: "pensamentos",
      status: "active",
      detail: "lean",
      advisory: true,
      official_goal: false,
      goal_binding: null,
      official_goal_route: {
        when: "only when the client requests an official /GOAL",
        required_tool_sequence: ["spt_validate", "goal_start"]
      }
    });
    expect(createdResult.scope).toBeUndefined();
    expect(createdResult.history).toBeUndefined();
    expect(createdResult.display).toBeUndefined();
    expect(JSON.stringify(createdResult).length).toBeLessThan(1024);
    await client!.close();

    await connectClient();
    const status = await client!.callTool({ name: "flow_status", arguments: { flow_id: flowId } });
    const flow = resultOf(status);
    const resource = await client!.readResource({ uri: `ppirtv://flow/${flowId}` });

    expect(flow.flow_id).toBe(flowId);
    expect(flow).toMatchObject({
      goal: "Smoke MCP",
      context: "stdio client",
      risks: ["state loss"],
      uncertainties: ["none"]
    });
    expect(flow.goal_binding).toBeUndefined();
    expect(resource.contents[0]?.text).toContain(flowId);
  });

  it("preserves the historical flow_create payload only with detail full", async () => {
    await connectClient();
    const created = await client!.callTool({
      name: "flow_create",
      arguments: {
        goal: "Full advisory compatibility",
        context: "explicit full payload",
        scope: { in: ["legacy client"], out: ["official GOAL"] },
        risks: ["payload drift"],
        uncertainties: ["external consumers"],
        detail: "full"
      }
    });
    const result = resultOf(created);

    expect(result).toMatchObject({
      goal: "Full advisory compatibility",
      phase: "pensamentos",
      status: "active",
      scope: { in: ["legacy client"], out: ["official GOAL"] },
      risks: ["payload drift"],
      uncertainties: ["external consumers"]
    });
    expect(Array.isArray(result.history)).toBe(true);
    expect(result.display).toEqual(expect.any(Object));
    expect(result.goal_binding).toBeUndefined();
    expect(result.advisory).toBeUndefined();
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
      source: "dex-code",
      mode: "full"
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
    const status = await client!.callTool({ name: "goal_status", arguments: { idempotency_key: envelope.idempotency_key, detail: "full" } });
    const checkout = await client!.callTool({ name: "ppirtv_checkout", arguments: { idempotency_key: envelope.idempotency_key, detail: "full" } });

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
      memory_consolidated: false,
      memory_review_status: "not_required"
    });
    expect((resultOf(checkout).blocker_diagnostics as Record<string, unknown>).effective_blockers).toEqual([]);
    expect(resultOf(checkout).ppirtv_checkout).toMatchObject({
      prestacao_de_contas: expect.any(Object),
      utility_accountability: expect.any(Object),
      contract_accountability: expect.any(Object),
      final_report_model: expect.any(Array)
    });
  });

  it("returns a recoverable MCP error when an idempotent retry changes the SPT front matter", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "workspace-binding-mismatch");
    const objective = "Manter binding MCP imutavel";
    const sptPath = await writeFakeSpt(workspace, objective);
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective,
      idempotency_key: "dex-code:mcp-goal-binding-mismatch",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
    };

    await client!.callTool({ name: "goal_start", arguments: envelope });
    const original = await readFile(sptPath, "utf8");
    await writeFile(sptPath, original.replace("  - Rodar teste MCP.", "  - Rodar teste MCP alterado."), "utf8");
    const retry = await client!.callTool({ name: "goal_start", arguments: envelope });

    expect((retry as { isError?: boolean }).isError).toBe(true);
    expect(resultOf(retry).error).toMatchObject({
      code: "GOAL_BINDING_MISMATCH",
      recoverable: true,
      next_required_action: {
        type: "restore_original_binding_or_start_new_goal",
        tool: "goal_start"
      }
    });
  });

  it("exposes operational-contract v8 default workflow and policy blocks through MCP checkout accountability", async () => {
    const contractDir = path.join(tempRoot, "contracts-v8");
    await mkdir(contractDir, { recursive: true });
    const contractPath = path.join(contractDir, "operational-contract.json");
    await writeFile(
      contractPath,
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
    await connectClient({ PPIRTV_PRINCIPLES_PATH: contractPath });

    const created = await client!.callTool({
      name: "flow_create",
      arguments: {
        goal: "Contrato v8 MCP",
        context: "stdio client",
        risks: ["drift de contrato"],
        uncertainties: ["nenhuma"]
      }
    });
    const flowId = resultOf(created).flow_id as string;
    const checkout = await client!.callTool({ name: "ppirtv_checkout", arguments: { flow_id: flowId, detail: "full" } });
    const result = resultOf(checkout);
    const accountability = result.contract_accountability as Record<string, unknown>;
    const nestedCheckout = result.ppirtv_checkout as Record<string, unknown>;
    const prestacao = result.prestacao_de_contas as Record<string, unknown>;
    const prestacaoContrato = prestacao.contrato_operacional as Record<string, unknown>;

    expect(result.default_workflow).toEqual(accountability.default_workflow);
    expect(accountability.default_workflow).toMatchObject({
      id: "PPIRTV_WORKFLOW_BASE",
      phases: expect.arrayContaining([expect.objectContaining({ letter: "V", name: "Validacao" })])
    });
    expect(accountability.secret_env_consumption_policy).toMatchObject({
      localizer: "ENV-SECRET-CONSUMO-SEGURO",
      required_actions: ["parsear apenas a chave nomeada"]
    });
    expect(accountability.early_security_proportionality_policy).toMatchObject({
      localizer: "SEGURANCA-CEDO-DEMAIS-LIMITA",
      forbidden: ["bloquear experimento reversivel por medo generico"]
    });
    expect((nestedCheckout.contract_accountability as Record<string, unknown>).secret_env_consumption_policy).toEqual(
      accountability.secret_env_consumption_policy
    );
    expect((nestedCheckout.contract_accountability as Record<string, unknown>).default_workflow).toEqual(accountability.default_workflow);
    expect(prestacaoContrato.default_workflow).toEqual(accountability.default_workflow);
    expect(prestacaoContrato.early_security_proportionality_policy).toEqual(accountability.early_security_proportionality_policy);
  });

  it("keeps goal_verdict_required over MCP when validation only has provided verdict text", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "workspace-verdict-required");
    const sptPath = await writeFakeSpt(workspace, "Bloquear falso pronto MCP em validacao");
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Bloquear falso pronto MCP em validacao",
      idempotency_key: "dex-code:mcp-goal-verdict-required",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code",
      mode: "full"
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
    const status = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId, detail: "full" } });
    const checkout = await client!.callTool({ name: "ppirtv_checkout", arguments: { flow_id: flowId, detail: "full" } });
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

  it("does not turn negative meeting trigger text into required_cooperation over MCP", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "negative-meeting-trigger");
    const sptPath = await writeFakeSpt(workspace, "Validar texto negativo sem rito fiscal");
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Validar texto negativo sem rito fiscal",
      idempotency_key: "dex-code:mcp-negative-meeting-trigger",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    };
    const started = await client!.callTool({ name: "goal_start", arguments: envelope });
    const flowId = resultOf(started).flow_id as string;
    const evidence = await client!.callTool({
      name: "evidence_add",
      arguments: { flow_id: flowId, title: "vitest run", content: "pass", satisfies: ["vitest"] }
    });

    const verdict = await client!.callTool({
      name: "goal_verdict",
      arguments: {
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "required_cooperation nao se aplica neste corte.",
        evidence_ids: [resultOf(evidence).evidence_id],
        residual_risks: ["meeting_id opcional porque nao ha required_cooperation"],
        next_step: "arquivar apos validacao deste teste MCP agora"
      }
    });
    const status = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId, detail: "full" } });

    expect((resultOf(verdict).verdict as Record<string, unknown>).status).toBe("pronto_com_ressalvas");
    expect(resultOf(status).blockers as string[]).not.toContain("required_cooperation");
    expect(resultOf(status).meeting_required).toBe(false);
  });

  it("rejects silent missing meeting_id for eligible required_cooperation meeting over MCP", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "silent-meeting-id-retry");
    const sptPath = await writeFakeSpt(workspace, "Validar retry de meeting_id silencioso");
    const envelope = {
      workspace,
      spt_path: sptPath,
      objective: "Validar retry de meeting_id silencioso",
      idempotency_key: "dex-code:mcp-silent-meeting-id-retry",
      evidence_required: true,
      required_evidence: ["vitest"],
      requested_verdict_policy: "evidence_required",
      source: "dex-code"
    };
    const started = await client!.callTool({ name: "goal_start", arguments: envelope });
    const flowId = resultOf(started).flow_id as string;
    const evidence = await client!.callTool({
      name: "evidence_add",
      arguments: { flow_id: flowId, title: "vitest run", content: "pass", satisfies: ["vitest"] }
    });
    const opened = await client!.callTool({
      name: "goal_meeting_open",
      arguments: { flow_id: flowId, kind: "convergente", question: "Fechar required_cooperation MCP" }
    });
    await client!.callTool({
      name: "goal_meeting_close",
      arguments: {
        flow_id: flowId,
        meeting_id: resultOf(opened).meeting_id,
        participants_present: ["chato", "questionador", "reuniao", "validador-pronto"],
        decision: "Reuniao MCP elegivel para required_cooperation.",
        satisfies_blockers: ["required_cooperation"]
      }
    });

    const blocked = await client!.callTool({
      name: "goal_verdict",
      arguments: {
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "Evidencias e decisao material revisadas.",
        evidence_ids: [resultOf(evidence).evidence_id],
        residual_risks: ["risco residual baixo"],
        next_step: "arquivar apos validacao agora"
      }
    });
    const status = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId } });

    expect((blocked as { isError?: boolean }).isError).toBe(true);
    expect(resultOf(blocked).error).toMatchObject({
      code: "PPIRTV_FISCAL_BLOCKED",
      next_required_action: {
        type: "provide_meeting_id_for_verdict",
        tool: "goal_verdict",
        eligible_meeting_ids: [resultOf(opened).meeting_id]
      }
    });
    expect(resultOf(status).blockers as string[]).toContain("required_cooperation");
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
      source: "dex-code",
      mode: "full"
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
    const status = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId, detail: "full" } });
    const checkout = await client!.callTool({ name: "ppirtv_checkout", arguments: { flow_id: flowId, detail: "full" } });
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

  it("accepts compact phase in goal_gate_check over MCP without treating detail compact as mode", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "compact-phase-workspace");
    const sptPath = await writeFakeSpt(workspace, "Fluxo curto");
    const started = await client!.callTool({
      name: "goal_start",
      arguments: {
        workspace,
        spt_path: sptPath,
        objective: "Fluxo curto",
        idempotency_key: "dex-code:mcp-compact-phase-schema",
        evidence_required: true,
        required_evidence: ["vitest"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code",
        mode: "compact"
      }
    });
    const flowId = resultOf(started).flow_id as string;
    expect(resultOf(started)).toMatchObject({
      phase: "concepcao",
      goal_envelope: { mode: "compact" }
    });

    const gate = await client!.callTool({
      name: "goal_gate_check",
      arguments: {
        flow_id: flowId,
        phase: "concepcao",
        detail: "compact",
        provided: {
          context: "ctx",
          risks: ["baixo"],
          scope_in: ["src/server.ts"],
          tasks: ["ajustar schema"],
          done_criteria: ["gate MCP aceita concepcao"]
        }
      }
    });
    const result = resultOf(gate);

    expect(result).toMatchObject({ phase: "concepcao", status: "passed" });
    expect(result.status_snapshot).not.toHaveProperty("operational_principles");
    expect(result.status_snapshot).toMatchObject({ phase: "concepcao" });
  });

  it("serves compact execution and lean receipts by default over MCP", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "lean-detail-workspace");
    const sptPath = await writeFakeSpt(workspace, "Validar detail lean publico");
    const started = await client!.callTool({
      name: "goal_start",
      arguments: {
        workspace,
        spt_path: sptPath,
        objective: "Validar detail lean publico",
        idempotency_key: "dex-code:mcp-lean-detail-contract",
        evidence_required: true,
        required_evidence: ["vitest"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      }
    });
    const flowId = resultOf(started).flow_id as string;

    const leanStatus = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId } });
    const leanEvidence = await client!.callTool({
      name: "evidence_add",
      arguments: { flow_id: flowId, title: "lean MCP evidence", content: "pass" }
    });
    const leanAdvance = await client!.callTool({
      name: "goal_advance",
      arguments: {
        flow_id: flowId,
        provided: {
          context: "ctx",
          risks: ["baixo"],
          scope_in: ["src/server.ts"],
          scope_out: ["fora"],
          tasks: ["validar lean"],
          done_criteria: ["snapshot lean"]
        }
      }
    });
    const leanCheckout = await client!.callTool({ name: "ppirtv_checkout", arguments: { flow_id: flowId } });
    const statusResult = resultOf(leanStatus);
    const evidenceResult = resultOf(leanEvidence);
    const advanceResult = resultOf(leanAdvance);
    const checkoutResult = resultOf(leanCheckout);

    expect(resultOf(started)).toMatchObject({ phase: "concepcao", mode: "compact", goal_envelope: { mode: "compact" } });
    expect(JSON.stringify(resultOf(started)).length).toBeLessThan(5120);
    expect((leanStatus as { isError?: boolean }).isError).not.toBe(true);
    expect((leanCheckout as { isError?: boolean }).isError).not.toBe(true);
    expect(JSON.stringify(leanStatus)).not.toContain("PPIRTV_TOOL_ERROR");
    expect(JSON.stringify(leanCheckout)).not.toContain("PPIRTV_TOOL_ERROR");
    expect(statusResult).toMatchObject({
      flow_id: flowId,
      phase: expect.any(String),
      status: expect.any(String),
      blockers: expect.any(Array),
      display: expect.objectContaining({ direct_action: expect.any(String) })
    });
    expect(statusResult).not.toHaveProperty("ppirtv_checkout");
    expect(statusResult).not.toHaveProperty("operational_principles");
    expect(evidenceResult.status).toMatchObject({ mode: "compact", phase: "concepcao" });
    expect(evidenceResult.status).not.toHaveProperty("checklist");
    expect(advanceResult.status_snapshot).toMatchObject({ mode: "compact", phase: "implementacao" });
    expect(advanceResult.status_snapshot).not.toHaveProperty("checklist");
    expect(checkoutResult).toMatchObject({
      flow_id: flowId,
      mode: "compact",
      direct_action: expect.any(String),
      complete: expect.any(Boolean),
      librarian_accountability: expect.objectContaining({
        recall_executed: expect.any(Boolean),
        consumption_confirmed: expect.any(Boolean)
      })
    });
    expect(checkoutResult).not.toHaveProperty("ppirtv_checkout");
    expect(JSON.stringify(checkoutResult).length).toBeLessThan(5120);
  });

  it("returns valid recall references when goal_advance receives an unknown reference", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "recall-reference-error-workspace");
    const sptPath = await writeFakeSpt(workspace, "Validar erro acionavel de recall MCP");
    const memoryDir = path.join(workspace, ".agents");
    const memoryPath = path.join(memoryDir, "LEMBRANCA.md");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(memoryPath, "- Validar erro acionavel de recall MCP com referencia recuperavel.\n", "utf8");
    const started = await client!.callTool({
      name: "goal_start",
      arguments: {
        workspace,
        spt_path: sptPath,
        objective: "Validar erro acionavel de recall MCP",
        idempotency_key: "dex-code:mcp-recall-reference-error",
        evidence_required: true,
        required_evidence: ["vitest"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      }
    });
    const flowId = resultOf(started).flow_id as string;
    await client!.callTool({
      name: "goal_advance",
      arguments: {
        flow_id: flowId,
        provided: {
          context: "ctx",
          risks: ["referencia invalida"],
          scope_in: ["src/flow-engine.ts"],
          scope_out: ["telemetria Graphify"],
          tasks: ["validar erro de recall"],
          done_criteria: ["erro recuperavel lista referencias validas"]
        }
      }
    });

    const longUnknownReference = `bad\r\n${"x".repeat(500)}\u0000.md`;
    const unknownReferences = [
      "invented-memory.md",
      longUnknownReference,
      ...Array.from({ length: 20 }, (_, index) => `unknown-${index}-${"y".repeat(200)}.md`)
    ];
    const rejected = await client!.callTool({
      name: "goal_advance",
      arguments: {
        flow_id: flowId,
        recall_consumption: { references: unknownReferences }
      }
    });
    const error = resultOf(rejected).error as Record<string, any>;

    expect((rejected as { isError?: boolean }).isError).toBe(true);
    expect(error).toMatchObject({
      code: "RECALL_CONSUMPTION_UNKNOWN_REFERENCES",
      recoverable: true,
      details: {
        unknown_references: expect.arrayContaining(["invented-memory.md"]),
        valid_references: expect.arrayContaining([memoryPath])
      },
      next_required_action: {
        type: "retry_goal_advance_with_recalled_reference",
        tool: "goal_advance",
        args: { flow_id: flowId },
        select_from: { references: expect.arrayContaining([memoryPath]) },
        rule: expect.stringContaining("somente referencias realmente abertas e usadas")
      }
    });
    expect(error.code).not.toBe("PPIRTV_TOOL_ERROR");
    expect(error.message).toBe("RECALL_CONSUMPTION_UNKNOWN_REFERENCES: 12 unknown reference(s)");
    expect(error.message).not.toContain("invented-memory.md");
    expect(error.details.unknown_references).toHaveLength(12);
    expect(error.details.valid_references.length).toBeLessThanOrEqual(12);
    for (const reference of [...error.details.unknown_references, ...error.details.valid_references]) {
      expect(reference.length).toBeLessThanOrEqual(160);
      expect(reference).not.toMatch(/[\u0000-\u001f\u007f]/);
    }
    expect(JSON.stringify(rejected).length).toBeLessThan(12_000);

    const rejectedGraphify = await client!.callTool({
      name: "goal_advance",
      arguments: {
        flow_id: flowId,
        recall_consumption: {
          references: [memoryPath],
          graphify_references: ["invented-graph.md"]
        }
      }
    });
    const graphifyError = resultOf(rejectedGraphify).error as Record<string, any>;

    expect((rejectedGraphify as { isError?: boolean }).isError).toBe(true);
    expect(graphifyError).toMatchObject({
      code: "GRAPHIFY_CONSUMPTION_UNKNOWN_REFERENCES",
      recoverable: true,
      details: {
        unknown_graphify_references: ["invented-graph.md"],
        valid_graphify_references: [],
        valid_references: expect.arrayContaining([memoryPath])
      },
      next_required_action: {
        tool: "goal_advance",
        args: { flow_id: flowId },
        select_from: {
          references: expect.arrayContaining([memoryPath]),
          graphify_references: []
        },
        rule: expect.stringContaining("somente referencias realmente abertas e usadas")
      }
    });
  });

  it("confirms a valid Graphify reference through the public MCP contract", async () => {
    await connectClient({
      PPIRTV_GRAPHIFY_RECALL: "1",
      PPIRTV_GRAPHIFY_COMMAND: process.execPath,
      PPIRTV_GRAPHIFY_TIMEOUT_MS: "5000"
    });
    const workspace = path.join(tempRoot, "graphify-positive-mcp-workspace");
    const sptPath = await writeFakeSpt(workspace, "Confirmar consumo Graphify positivo por MCP");
    const graphDir = path.join(workspace, "graphify-out");
    const graphReference = ".agents/PLAN-TASKS/graphify-positive.md";
    await mkdir(graphDir, { recursive: true });
    await writeFile(path.join(graphDir, "graph.json"), "{}", "utf8");
    await writeFile(
      path.join(workspace, "query"),
      `process.stdout.write("NODE Graphify positive [src=${graphReference} loc=L9 community=test]\\n");\n`,
      "utf8"
    );
    const started = await client!.callTool({
      name: "goal_start",
      arguments: {
        workspace,
        spt_path: sptPath,
        objective: "Confirmar consumo Graphify positivo por MCP",
        idempotency_key: "dex-code:mcp-graphify-positive-consumption",
        evidence_required: true,
        required_evidence: ["vitest"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      }
    });
    const flowId = resultOf(started).flow_id as string;
    const recalled = resultOf(await client!.callTool({
      name: "goal_status",
      arguments: { flow_id: flowId, detail: "full" }
    }));
    expect(recalled.librarian_status).toMatchObject({
      recall_executed: true,
      consumption_confirmed: false,
      graphify: {
        status: "recalled",
        recall_executed: true,
        consumption_confirmed: false
      }
    });

    await client!.callTool({
      name: "goal_advance",
      arguments: {
        flow_id: flowId,
        provided: {
          context: "ctx",
          risks: ["recall nao confirmado"],
          scope_in: ["Graphify MCP"],
          scope_out: ["telemetria de progresso"],
          tasks: ["confirmar referencia Graphify"],
          done_criteria: ["consumo confirmado no ledger"]
        }
      }
    });
    const consumed = resultOf(await client!.callTool({
      name: "goal_advance",
      arguments: {
        flow_id: flowId,
        provided: {},
        recall_consumption: {
          references: [graphReference],
          graphify_references: [graphReference],
          note: "Referencia Graphify aberta e usada no gate atual."
        },
        detail: "full"
      }
    }));
    expect(consumed).toMatchObject({
      blocked: true,
      recall_consumption: {
        references: [graphReference],
        graphify_references: [graphReference],
        consumption_confirmed: true,
        graphify_consumption_confirmed: true
      },
      status_snapshot: {
        librarian_status: {
          consumption_confirmed: true,
          graphify: { consumption_confirmed: true }
        }
      }
    });

    const repeated = resultOf(await client!.callTool({
      name: "goal_advance",
      arguments: {
        flow_id: flowId,
        provided: {},
        recall_consumption: {
          references: [graphReference],
          graphify_references: [graphReference],
          note: "Retry da mesma referencia Graphify."
        }
      }
    }));
    expect(repeated.recall_consumption).toMatchObject({ reused: true });
    const ledger = await client!.readResource({ uri: `ppirtv://flow/${flowId}/ledger` });
    const ledgerText = ledger.contents[0]?.text ?? "";
    const ledgerEvents = JSON.parse(ledgerText) as Array<Record<string, unknown>>;
    expect(ledgerEvents.filter((event) => event.type === "memory_recall_consumed")).toHaveLength(1);
  });

  it("streams bounded Graphify progress into ledger and lean visual surfaces", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "graphify-progress-mcp-workspace");
    const sptPath = await writeFakeSpt(workspace, "Transmitir progresso Graphify por MCP");
    const started = resultOf(await client!.callTool({
      name: "goal_start",
      arguments: {
        workspace,
        spt_path: sptPath,
        objective: "Transmitir progresso Graphify por MCP",
        idempotency_key: "dex-code:mcp-graphify-progress",
        evidence_required: true,
        required_evidence: ["vitest"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      }
    }));
    const flowId = started.flow_id as string;
    const before = resultOf(await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId } }));
    const progress = async (current: number, status: "running" | "completed", eventKey = `chunk-count-${current}`) =>
      resultOf(await client!.callTool({
        name: "goal_progress_record",
        arguments: {
          flow_id: flowId,
          event_key: eventKey,
          source: "graphify",
          operation: "deep-extract",
          stage: status === "completed" ? "completed" : "chunks",
          current,
          total: 4,
          status,
          message: status === "completed" ? "Graphify deep completed" : `Graphify chunk completion ${current}/4`
        }
      }));

    const first = await progress(1, "running");
    const duplicate = await progress(1, "running");
    const second = await progress(2, "running");
    const outOfOrderResponse = await client!.callTool({
      name: "goal_progress_record",
      arguments: {
        flow_id: flowId,
        event_key: "chunk-count-regressed",
        source: "graphify",
        operation: "deep-extract",
        stage: "chunks",
        current: 1,
        total: 4,
        status: "running"
      }
    });
    const outOfOrder = resultOf(outOfOrderResponse).error as Record<string, any>;
    const sensitiveResponse = await client!.callTool({
      name: "goal_progress_record",
      arguments: {
        flow_id: flowId,
        event_key: "sensitive-progress",
        source: "graphify",
        operation: "deep-extract",
        stage: "chunks",
        current: 3,
        total: 4,
        status: "running",
        message: "Authorization: Bearer abcdefghijklmnop"
      }
    });
    const sensitive = resultOf(sensitiveResponse).error as Record<string, any>;
    const third = await progress(3, "running");
    const completed = await progress(4, "completed");

    expect(first).toMatchObject({ recorded: true, progress_event: { current: 1, percent: 25 } });
    expect(duplicate).toMatchObject({ recorded: false, reused: true, reason: "event_key_reused" });
    expect(second).toMatchObject({ recorded: true, progress_event: { current: 2, percent: 50 } });
    expect((outOfOrderResponse as { isError?: boolean }).isError).toBe(true);
    expect(outOfOrder).toMatchObject({
      code: "PROGRESS_OUT_OF_ORDER",
      recoverable: true,
      details: { latest_current: 2, received_current: 1 },
      next_required_action: { tool: "goal_progress_record", args: { flow_id: flowId } }
    });
    expect((sensitiveResponse as { isError?: boolean }).isError).toBe(true);
    expect(sensitive).toMatchObject({ code: "SENSITIVE_CONTENT_BLOCKED", recoverable: false });
    expect(third).toMatchObject({ recorded: true, progress_event: { current: 3, percent: 75 } });
    expect(completed).toMatchObject({ recorded: true, progress_event: { current: 4, percent: 100, status: "completed" } });
    expect(JSON.stringify(completed).length).toBeLessThan(5120);

    const status = resultOf(await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId } }));
    const checklist = resultOf(await client!.callTool({ name: "checklist_render", arguments: { flow_id: flowId } }));
    const checkout = resultOf(await client!.callTool({ name: "ppirtv_checkout", arguments: { flow_id: flowId } }));
    expect(status.blockers).toEqual(before.blockers);
    expect(status.work_progress).toMatchObject({
      event_count: 4,
      operations_count: 1,
      last: { source: "graphify", operation: "deep-extract", current: 4, total: 4, status: "completed" }
    });
    expect(status.display.work_progress).toEqual(status.work_progress);
    expect(checklist.work_progress).toEqual(status.work_progress);
    expect(checklist.display.work_progress).toEqual(status.work_progress);
    expect(checkout.work_progress).toEqual(status.work_progress);
    expect(status.evidence_count).toBe(before.evidence_count);

    const ledger = await client!.readResource({ uri: `ppirtv://flow/${flowId}/ledger` });
    const ledgerEvents = JSON.parse(ledger.contents[0]?.text ?? "[]") as Array<Record<string, any>>;
    const progressEvents = ledgerEvents.filter((event) => event.type === "work_progress_recorded");
    expect(progressEvents).toHaveLength(4);
    expect(progressEvents.map((event) => event.data.current)).toEqual([1, 2, 3, 4]);
    expect(ledger.contents[0]?.text).not.toContain("Authorization");
    expect(ledger.contents[0]?.text).not.toContain("abcdefghijklmnop");
    expect(ledgerEvents.some((event) => event.type === "evidence_attached" && event.data.title === "Graphify deep completed")).toBe(false);
  });

  it("exposes mm_memory_mining and writes valid candidates through MCP", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "workspace");
    const sptPath = await writeFakeSpt(workspace, "Auditar memoria por MCP");
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
    const status = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId, detail: "full" } });
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

  it("does not ask MCP clients to resolve candidate_ids after empty auto_write memory mining", async () => {
    await connectClient();
    const workspace = path.join(tempRoot, "empty-memory-workspace");
    const sptPath = await writeFakeSpt(workspace, "Validar memoria L1/L2 obrigatoria sem pepita mineravel por MCP");
    const started = await client!.callTool({
      name: "goal_start",
      arguments: {
        workspace,
        spt_path: sptPath,
        objective: "Validar memoria L1/L2 obrigatoria sem pepita mineravel por MCP",
        idempotency_key: "dex-code:mcp-empty-memory-mining-001",
        evidence_required: true,
        required_evidence: ["vitest"],
        requested_verdict_policy: "evidence_required",
        source: "dex-code"
      }
    });
    const flowId = resultOf(started).flow_id as string;

    const statusBefore = await client!.callTool({ name: "goal_status", arguments: { flow_id: flowId } });
    expect(resultOf(statusBefore).blockers as string[]).toContain("memory_required_but_empty");

    const mined = await client!.callTool({ name: "mm_memory_mining", arguments: { flow_id: flowId } });
    expect(resultOf(mined)).toMatchObject({
      write_policy: "auto_write",
      candidates: [],
      written: [],
      memory_required_but_empty: false,
      blocked_verdict: false
    });

    const checkout = await client!.callTool({ name: "ppirtv_checkout", arguments: { flow_id: flowId, detail: "full" } });
    const checkoutResult = resultOf(checkout);
    const memoryAccountability = checkoutResult.memory_accountability as Record<string, unknown>;
    const nestedCheckout = checkoutResult.ppirtv_checkout as Record<string, unknown>;
    const nestedMemoryMining = nestedCheckout.memory_mining as Record<string, unknown>;
    const checkoutJson = JSON.stringify(resultOf(checkout));

    expect((checkout as { isError?: boolean }).isError).not.toBe(true);
    expect(checkoutResult.blockers as string[]).not.toContain("memory_required_but_empty");
    expect(memoryAccountability.memory_required_but_empty).toBe(false);
    expect(nestedMemoryMining.memory_required_but_empty).toBe(false);
    expect(checkoutJson).not.toContain("memory_mining_blocked_verdict");
    expect(checkoutJson).not.toContain("mm_memory_candidate_resolve");
    expect(checkoutJson).not.toContain("<candidate_id>");
    expect(checkoutJson).toContain("nenhum candidato");
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

    const commonFlow = await client!.callTool({
      name: "flow_create",
      arguments: {
        goal: "Flow comum sem GOAL oficial",
        context: "nao deve aceitar goal_gate_check antes de goal_start",
        risks: ["comecar pelo meio"]
      }
    });
    const commonFlowId = resultOf(commonFlow).flow_id as string;
    const gateWithoutGoal = await client!.callTool({
      name: "goal_gate_check",
      arguments: { flow_id: commonFlowId }
    });
    expect((gateWithoutGoal as { isError?: boolean }).isError).toBe(true);
    expect(resultOf(gateWithoutGoal).error).toMatchObject({
      code: "GOAL_NAO_ATIVO",
      recoverable: true,
      next_required_action: {
        type: "goal_start_required",
        tool: "goal_start",
        required_tool_sequence: [
          { order: 1, tool: "spt_validate" },
          { order: 2, tool: "goal_start", args: { flow_id: commonFlowId } }
        ]
      }
    });
    const resumeWithoutGoal = await client!.callTool({
      name: "goal_resume",
      arguments: { flow_id: commonFlowId, note: "nao deve retomar flow comum" }
    });
    expect((resumeWithoutGoal as { isError?: boolean }).isError).toBe(true);
    expect(resultOf(resumeWithoutGoal).error).toMatchObject({
      code: "GOAL_NAO_ATIVO",
      recoverable: true,
      next_required_action: {
        type: "goal_start_required",
        tool: "goal_start",
        required_tool_sequence: [
          { order: 1, tool: "spt_validate" },
          { order: 2, tool: "goal_start", args: { flow_id: commonFlowId } }
        ]
      }
    });

    const workspace = path.join(tempRoot, "workspace-mcp-error-envelope");
    const sptPath = await writeFakeSpt(workspace, "Validar envelope de erro MCP");
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

    const bookToSkillEvidence = await client!.callTool({
      name: "evidence_add",
      arguments: {
        flow_id: flowId,
        kind: "note",
        title: "book-to-skill entrypoint repair",
        uri: String.raw`C:\CodexProjetos\book-to-skill\.ppirtv\evidence\batch-1-entrypoint-repair.md`,
        content: "technical-book-to-skill-memory-routes validated without secret payload",
        note: "skill_entrypoint_repair_validated_without_secret_payload",
        satisfies: ["vitest"]
      }
    });
    expect((bookToSkillEvidence as { isError?: boolean }).isError).not.toBe(true);
    expect(resultOf(bookToSkillEvidence).evidence_id).toMatch(/^evd_/);

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

    const patValue = "ghp_abcdefghijklmnop1234567890";
    const patBlocked = await client!.callTool({
      name: "evidence_add",
      arguments: {
        flow_id: flowId,
        title: "github pat evidence",
        content: patValue
      }
    });
    expect((patBlocked as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(patBlocked)).not.toContain(patValue);
    expect(resultOf(patBlocked).error).toMatchObject({
      code: "SENSITIVE_CONTENT_BLOCKED",
      recoverable: false
    });

    const fineGrainedPatValue = "github_pat_abcdefghijklmnopqrstuvwxyz1234567890_ABCD";
    const fineGrainedPatBlocked = await client!.callTool({
      name: "evidence_add",
      arguments: {
        flow_id: flowId,
        title: "github fine-grained pat evidence",
        content: fineGrainedPatValue
      }
    });
    expect((fineGrainedPatBlocked as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(fineGrainedPatBlocked)).not.toContain(fineGrainedPatValue);
    expect(resultOf(fineGrainedPatBlocked).error).toMatchObject({
      code: "SENSITIVE_CONTENT_BLOCKED",
      recoverable: false
    });

    const projectTokenValue = "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
    const projectTokenBlocked = await client!.callTool({
      name: "evidence_add",
      arguments: {
        flow_id: flowId,
        title: "openai project token evidence",
        content: projectTokenValue
      }
    });
    expect((projectTokenBlocked as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(projectTokenBlocked)).not.toContain(projectTokenValue);
    expect(resultOf(projectTokenBlocked).error).toMatchObject({
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

  it("returns visual-only checklist by default and full checklist only on explicit request", async () => {
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

    expect(result.markdown).toBeUndefined();
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.operational_principles).toBeUndefined();
    expect(result.ready_definition).toBeUndefined();
    expect(result.gate_final_output).toBeUndefined();
    expect(result.final_report_model).toBeUndefined();
    expect(Array.isArray(result.blockers)).toBe(true);
    expect(result.next_step).toBeDefined();
    expect(display.phase_emoji).toBe("🧠");
    expect(Array.isArray(display.checklist_visual)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(5120);

    const fullChecklist = resultOf(await client!.callTool({
      name: "checklist_render",
      arguments: { flow_id: flowId, detail: "full" }
    }));
    expect(fullChecklist.markdown).toContain("Checklist PPIRTV");
    expect(Array.isArray(fullChecklist.operational_principles)).toBe(true);
    expect(Array.isArray(fullChecklist.ready_definition)).toBe(true);
    expect(Array.isArray(fullChecklist.gate_final_output)).toBe(true);
    expect(Array.isArray(fullChecklist.final_report_model)).toBe(true);
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

async function connectClient(extraEnv: Record<string, string> = {}): Promise<void> {
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
      DEX_MEMORIA_HOME: path.join(tempRoot, "memories"),
      ...extraEnv
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

async function writeFakeSpt(workspace: string, objective = "Auditar ponte GOAL/SPT por MCP"): Promise<string> {
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-05-24-fake-goal-spt.md");
  await writeFile(
    sptPath,
    [
      "---",
      "dex_contract: spt",
      "version: 2",
      "status: EM_TESTE",
      "owner: Teste",
      "date: '2026-05-24'",
      `workspace: ${JSON.stringify(workspace)}`,
      "origin: teste MCP",
      "goal:",
      "  id: fake-mcp-goal-spt",
      "  title: Fake MCP GOAL SPT",
      `  objective: ${objective}`,
      "context: Teste MCP do contrato GOAL/SPT.",
      "problem: Garantir que o servidor MCP exponha e execute o contrato oficial.",
      "decision: Usar SPT v2 e tools oficiais.",
      "scope:",
      "  include:",
      "    - Validar SPT por MCP.",
      "  exclude:",
      "    - Usar tools antigas como substituto silencioso.",
      "spec: Auditar ponte GOAL/SPT por MCP.",
      "plan:",
      "  - Validar SPT.",
      "  - Criar flow.",
      "  - Registrar evidencia.",
      "tasks:",
      "  - Rodar teste MCP.",
      "expected_evidence:",
      "  - vitest.",
      "done_criteria:",
      "  - vitest.",
      "risks:",
      "  - Cliente MCP antigo nao reiniciado.",
      "uncertainties:",
      "  - O objective do envelope pode variar entre testes.",
      "gates:",
      "  - tasks, expected_evidence e done_criteria preenchidos.",
      "validation:",
      "  - vitest.",
      "execution_prompt: |",
      "  /GOAL",
      "  Execute este SPT.",
      "---",
      "# Human MCP notes",
      "",
      "The body is not part of the machine contract."
    ].join("\n"),
    "utf8"
  );
  return sptPath;
}
