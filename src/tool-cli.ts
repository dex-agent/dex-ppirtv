import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

type ToolSchema = {
  type?: string;
  properties?: Record<string, ToolSchema>;
  required?: string[];
  oneOf?: ToolSchema[];
  anyOf?: ToolSchema[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
};

type ToolLike = {
  name: string;
  description?: string;
  inputSchema?: ToolSchema;
  annotations?: Record<string, unknown>;
};

function printHelp(): void {
  console.log([
    "dex-PPIRTV read-only tool help",
    "",
    "Usage:",
    "  node dist/index.js --describe <tool> [--workspace <dir>]",
    "  node dist/index.js --schema <tool> [--workspace <dir>]",
    "  node dist/index.js --usage <tool> [--workspace <dir>]",
    "  node dist/index.js --list [--workspace <dir>]",
    "  node dist/index.js --help",
    "",
    "--describe prints name, description, input schema, annotations and an example.",
    "--schema prints only the raw JSON Schema.",
    "--usage prints the human description, required arguments and an example.",
    "--list prints the tool names.",
    "All modes read tools/list and never invoke the selected tool.",
    "The normal MCP stdio server starts only when no help flag is supplied."
  ].join("\n"));
}

function typeLabel(schema: ToolSchema | undefined): string {
  if (!schema || typeof schema !== "object") return "value";
  if (schema.type) return String(schema.type);
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(typeLabel).join(" | ");
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(typeLabel).join(" | ");
  if (Array.isArray(schema.enum)) return "enum";
  return "value";
}

function exampleForSchema(schema: ToolSchema | undefined): unknown {
  if (!schema || typeof schema !== "object") return "<value>";
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return exampleForSchema(schema.oneOf[0]);
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return exampleForSchema(schema.anyOf[0]);
  if (schema.type === "object" || schema.properties) {
    const result: Record<string, unknown> = {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) result[key] = exampleForSchema(schema.properties?.[key]);
    return result;
  }
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return true;
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "null") return null;
  return "<value>";
}

function renderUsage(tool: ToolLike): string {
  const schema = tool.inputSchema ?? {};
  const properties = schema.properties ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const lines = [
    tool.name,
    "",
    tool.description ?? "(no description)",
    "",
    "Required arguments:"
  ];
  if (required.length === 0) {
    lines.push("- (none declared)");
  } else {
    for (const key of required) {
      const property = properties[key] ?? {};
      lines.push("- " + key + " (" + typeLabel(property) + ")" + (property.description ? ": " + property.description : ""));
    }
  }
  lines.push("", "Example:", JSON.stringify(exampleForSchema(schema), null, 2), "", "Use --describe for the full contract and --schema for raw JSON Schema.");
  return lines.join("\n");
}

function parseArgs(argv: string[]) {
  const parsed: {
    workspace?: string;
    mode?: "describe" | "schema" | "usage" | "list";
    tool?: string;
    help?: boolean;
  } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--workspace") parsed.workspace = argv[++index];
    else if (arg === "--list") parsed.mode = "list";
    else if (arg === "--describe" || arg === "--schema" || arg === "--usage") {
      parsed.mode = arg.slice(2) as "describe" | "schema" | "usage";
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) parsed.tool = argv[++index];
    } else {
      throw new Error("Unknown argument: " + arg);
    }
  }
  return parsed;
}

async function openServer(workspace: string) {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "index.js";
  const userProfile = process.env.USERPROFILE ?? process.env.HOME;
  const principlesPath = userProfile
    ? path.join(userProfile, ".agents", "memories", "principles", "operational-contract.json")
    : undefined;
  const server = {
    command: process.execPath,
    args: [entry],
    cwd: workspace,
    env: {
      ...getDefaultEnvironment(),
      PPIRTV_HOME: path.join(workspace, ".ppirtv"),
      PPIRTV_WORKSPACE: workspace,
      ...(principlesPath ? { PPIRTV_PRINCIPLES_PATH: principlesPath } : {})
    }
  };
  const client = new Client({ name: "dex-ppirtv-tool-cli", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    env: server.env,
    stderr: "pipe"
  });
  await client.connect(transport);
  return { client, transport };
}

export async function runToolCli(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    return 1;
  }
  if (parsed.help) {
    printHelp();
    return 0;
  }
  if (!parsed.mode) {
    printHelp();
    return 1;
  }
  if (parsed.mode !== "list" && !parsed.tool) {
    console.error("--" + parsed.mode + " requires a tool name");
    printHelp();
    return 1;
  }
  const workspace = path.resolve(parsed.workspace ?? process.cwd());
  let opened: Awaited<ReturnType<typeof openServer>> | undefined;
  try {
    opened = await openServer(workspace);
    const listed = await opened.client.listTools();
    const tools = listed.tools as ToolLike[];
    const names = tools.map((tool) => tool.name).sort();
    if (parsed.mode === "list") {
      console.log(JSON.stringify({ ok: true, tool_count: names.length, tools: names }, null, 2));
      return 0;
    }
    const tool = tools.find((candidate) => candidate.name === parsed.tool);
    if (!tool) {
      console.log(JSON.stringify({ ok: false, error: "TOOL_NOT_FOUND", tool: parsed.tool, available_tools: names }, null, 2));
      return 1;
    }
    if (parsed.mode === "schema") {
      console.log(JSON.stringify(tool.inputSchema ?? {}, null, 2));
      return 0;
    }
    if (parsed.mode === "usage") {
      console.log(renderUsage(tool));
      return 0;
    }
    console.log(JSON.stringify({
      ok: true,
      tool: tool.name,
      description: tool.description ?? null,
      input_schema: tool.inputSchema ?? null,
      annotations: tool.annotations ?? null,
      example: exampleForSchema(tool.inputSchema)
    }, null, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await opened?.client.close().catch(() => undefined);
  }
}
