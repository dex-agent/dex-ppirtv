import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { REQUIRED_PROMPTS, REQUIRED_TOOLS } from "../src/domain.js";

let tempRoot: string;
let client: Client | undefined;
let transport: StdioClientTransport | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-mcp-"));
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  transport = undefined;
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
    expect(resultOf(checkout).ppirtv_checkout).toMatchObject({
      prestacao_de_contas: expect.any(Object),
      utility_accountability: expect.any(Object),
      contract_accountability: expect.any(Object),
      final_report_model: expect.any(Array)
    });
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
      expect.arrayContaining([expect.objectContaining({ meeting_id: meetingId, status: "closed", kind: "divergente" })])
    );
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
  client = new Client({ name: "ppirtv-test-client", version: "0.1.0" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      PPIRTV_HOME: tempRoot,
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
