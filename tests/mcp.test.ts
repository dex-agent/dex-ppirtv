import { mkdtemp, rm } from "node:fs/promises";
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
    expect(Array.isArray(result.items)).toBe(true);
    expect(Array.isArray(result.operational_principles)).toBe(true);
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
    expect(text).toContain("L1");
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
      PPIRTV_HOME: tempRoot
    },
    stderr: "pipe"
  });
  await client.connect(transport);
}

function resultOf(response: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  return (response as { structuredContent?: { result?: Record<string, unknown> } }).structuredContent?.result ?? {};
}
