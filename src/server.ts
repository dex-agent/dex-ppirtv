import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PROMPT_NAMES, RESOURCE_URIS, TOOL_NAMES, gatesTemplate, mcpReference, meetingsTemplate, promptText, resourceText } from "./catalogs.js";
import { MEETING_TYPES, PHASES, VERDICTS } from "./domain.js";
import { FlowEngine } from "./flow-engine.js";
import { PpirtvStore } from "./store.js";

export function createPpirtvServer(options: { storeRoot?: string } = {}): McpServer {
  const store = new PpirtvStore(options.storeRoot);
  const engine = new FlowEngine(store);
  const server = new McpServer(
    {
      name: "dex-ppirtv",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: true },
        prompts: { listChanged: false }
      }
    }
  );

  registerTools(server, engine);
  registerResources(server, engine);
  registerPrompts(server);
  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createPpirtvServer();
  await server.connect(new StdioServerTransport());
}

function registerTools(server: McpServer, engine: FlowEngine): void {
  const cooperatorSchema = z.object({
    name: z.string().min(1),
    reason: z.string().min(1),
    material: z.boolean().default(false)
  });

  server.registerTool(
    "flow_create",
    {
      description: "Create a PPIRTV flow and return an explicit flow_id.",
      inputSchema: {
        goal: z.string().min(1),
        owner: z.string().optional(),
        context: z.string().optional(),
        scope: z.object({ in: z.array(z.string()).default([]), out: z.array(z.string()).default([]) }).optional(),
        risks: z.array(z.string()).optional(),
        uncertainties: z.array(z.string()).optional()
      }
    },
    async (args) => toolResult(await engine.createFlow(args))
  );

  server.registerTool(
    "flow_status",
    {
      description: "Return the current state of a flow by flow_id.",
      inputSchema: { flow_id: z.string().min(1) }
    },
    async ({ flow_id }) => toolResult(await engine.status(flow_id))
  );

  server.registerTool(
    "flow_advance",
    {
      description: "Advance a flow only when the current phase gate passes.",
      inputSchema: {
        flow_id: z.string().min(1),
        provided: z.record(z.unknown()).optional(),
        evidence_ids: z.array(z.string()).optional(),
        actor: z.string().optional()
      }
    },
    async (args) => toolResult(await engine.advance(args))
  );

  server.registerTool(
    "flow_return",
    {
      description: "Return a flow to a previous phase with reason and optional evidence.",
      inputSchema: {
        flow_id: z.string().min(1),
        to: z.enum(PHASES),
        reason: z.string().min(1),
        evidence_ids: z.array(z.string()).optional(),
        actor: z.string().optional()
      }
    },
    async (args) => toolResult(await engine.returnTo(args))
  );

  server.registerTool(
    "gate_check",
    {
      description: "Check the PPIRTV gate for the current or requested phase.",
      inputSchema: {
        flow_id: z.string().min(1),
        phase: z.enum(PHASES).optional(),
        provided: z.record(z.unknown()).optional(),
        persist: z.boolean().optional()
      }
    },
    async (args) => toolResult(await engine.checkGate(args))
  );

  server.registerTool(
    "meeting_open",
    {
      description: "Open a divergent, convergent or transversal meeting artifact linked to a flow.",
      inputSchema: {
        flow_id: z.string().min(1),
        type: z.enum(MEETING_TYPES),
        question: z.string().min(1)
      }
    },
    async (args) => toolResult(await engine.openMeeting(args))
  );

  server.registerTool(
    "meeting_record",
    {
      description: "Record structured meeting outputs.",
      inputSchema: {
        meeting_id: z.string().min(1),
        questions: z.array(z.string()).optional(),
        hypotheses: z.array(z.string()).optional(),
        alternatives: z.array(z.string()).optional(),
        decisions: z.array(z.string()).optional(),
        risks: z.array(z.string()).optional(),
        next_steps: z.array(z.string()).optional(),
        affected_areas: z.array(z.string()).optional(),
        impacts: z.array(z.string()).optional(),
        owners: z.array(z.string()).optional(),
        gates_extra: z.array(z.string()).optional(),
        rollback_plan: z.string().optional(),
        parking_lot: z.array(z.string()).optional(),
        gold_mining: z.array(z.string()).optional(),
        cooperators: z.array(cooperatorSchema).optional(),
        active_credits: z.array(z.string()).optional()
      }
    },
    async (args) => toolResult(await engine.recordMeeting(args))
  );

  server.registerTool(
    "evidence_attach",
    {
      description: "Attach evidence to a flow without writing secrets to the ledger.",
      inputSchema: {
        flow_id: z.string().min(1),
        kind: z.string().default("note"),
        title: z.string().min(1),
        uri: z.string().optional(),
        content: z.string().optional(),
        note: z.string().optional(),
        parking_lot: z.array(z.string()).optional(),
        gold_mining: z.array(z.string()).optional(),
        cooperators: z.array(cooperatorSchema).optional(),
        active_credits: z.array(z.string()).optional()
      }
    },
    async (args) => toolResult(await engine.attachEvidence(args))
  );

  server.registerTool(
    "checklist_render",
    {
      description: "Render the visual checklist for the flow current phase.",
      inputSchema: { flow_id: z.string().min(1) }
    },
    async ({ flow_id }) => toolResult(await engine.renderChecklist(flow_id))
  );

  server.registerTool(
    "verdict_record",
    {
      description: "Record a final verdict. A pronto verdict without evidence is downgraded.",
      inputSchema: {
        flow_id: z.string().min(1),
        status: z.enum(VERDICTS),
        rationale: z.string().min(1),
        evidence_ids: z.array(z.string()).optional(),
        residual_risks: z.array(z.string()).optional(),
        parking_lot: z.array(z.string()).optional(),
        gold_mining: z.array(z.string()).optional(),
        cooperators: z.array(cooperatorSchema).optional(),
        active_credits: z.array(z.string()).optional(),
        next_step: z.string().min(1)
      }
    },
    async (args) => toolResult(await engine.recordVerdict(args))
  );

  server.registerTool(
    "hygiene_scan",
    {
      description: "Scan for clean-house findings and apply the barata nunca esta sozinha rule.",
      inputSchema: { flow_id: z.string().optional() }
    },
    async ({ flow_id }) => toolResult(await engine.hygieneScan(flow_id))
  );

  server.registerTool(
    "flow_archive",
    {
      description: "Archive a flow after verdict or with an explicit reason.",
      inputSchema: { flow_id: z.string().min(1), reason: z.string().optional() }
    },
    async (args) => toolResult(await engine.archiveFlow(args))
  );

  assertRegistered("tool", TOOL_NAMES);
}

function registerResources(server: McpServer, engine: FlowEngine): void {
  server.registerResource(
    "flows",
    "ppirtv://flows",
    { title: "PPIRTV flows", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, "ppirtv://flows"))
  );
  server.registerResource(
    "templates-gates",
    "ppirtv://templates/gates",
    { title: "PPIRTV gate templates", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, gatesTemplate())
  );
  server.registerResource(
    "templates-meetings",
    "ppirtv://templates/meetings",
    { title: "PPIRTV meeting templates", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, meetingsTemplate())
  );
  server.registerResource(
    "reference-mcp",
    "ppirtv://reference/mcp",
    { title: "MCP reference", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, mcpReference())
  );

  const listFlowResources = async () => {
    const flows = await engine.store.listFlows();
    return {
      resources: flows.flatMap((flow) => [
        resourceMeta(`ppirtv://flow/${flow.flow_id}`, `flow ${flow.flow_id}`),
        resourceMeta(`ppirtv://flow/${flow.flow_id}/checklist`, `checklist ${flow.flow_id}`),
        resourceMeta(`ppirtv://flow/${flow.flow_id}/ledger`, `ledger ${flow.flow_id}`),
        resourceMeta(`ppirtv://flow/${flow.flow_id}/meetings`, `meetings ${flow.flow_id}`)
      ])
    };
  };

  server.registerResource(
    "flow",
    new ResourceTemplate("ppirtv://flow/{flow_id}", { list: listFlowResources }),
    { title: "PPIRTV flow", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, uri.href))
  );
  server.registerResource(
    "flow-checklist",
    new ResourceTemplate("ppirtv://flow/{flow_id}/checklist", { list: listFlowResources }),
    { title: "PPIRTV flow checklist", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, uri.href))
  );
  server.registerResource(
    "flow-ledger",
    new ResourceTemplate("ppirtv://flow/{flow_id}/ledger", { list: listFlowResources }),
    { title: "PPIRTV flow ledger", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, uri.href))
  );
  server.registerResource(
    "flow-meetings",
    new ResourceTemplate("ppirtv://flow/{flow_id}/meetings", { list: listFlowResources }),
    { title: "PPIRTV flow meetings", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, uri.href))
  );

  assertRegistered("resource", RESOURCE_URIS);
}

function registerPrompts(server: McpServer): void {
  for (const name of PROMPT_NAMES) {
    server.registerPrompt(
      name,
      {
        title: name,
        description: `PPIRTV prompt: ${name}`,
        argsSchema: {
          flow_id: z.string().optional(),
          goal: z.string().optional(),
          context: z.string().optional()
        }
      },
      async (args) => ({
        description: `PPIRTV prompt: ${name}`,
        messages: [{ role: "user", content: { type: "text", text: promptText(name, args) } }]
      })
    );
  }
  assertRegistered("prompt", PROMPT_NAMES);
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value }
  };
}

function resourceResult(uri: string, value: unknown) {
  return {
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }]
  };
}

function resourceMeta(uri: string, name: string) {
  return { uri, name, mimeType: "application/json" };
}

function assertRegistered(kind: string, names: readonly string[]): void {
  if (names.length === 0) {
    throw new Error(`No ${kind}s registered`);
  }
}
