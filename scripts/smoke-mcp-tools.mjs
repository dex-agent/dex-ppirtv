import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const REQUIRED_TOOLS = [
  "spt_validate",
  "goal_start",
  "goal_status",
  "ppirtv_checkout",
  "goal_gate_check",
  "goal_meeting_open",
  "goal_meeting_add_turn",
  "goal_meeting_close",
  "evidence_add",
  "mm_memory_mining",
  "goal_regress",
  "goal_verdict",
  "flow_archive"
];

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(import.meta.dirname, "..");
const workspace = path.resolve(args.workspace ?? process.cwd());
const server = args.mcpJson
  ? await readServerFromMcpJson(path.resolve(args.mcpJson), args.server)
  : args.configToml
    ? await readServerFromCodexConfig(path.resolve(args.configToml), args.server)
  : directServer(repoRoot, workspace);

const client = new Client({ name: "dex-ppirtv-smoke-mcp-tools", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: server.command,
  args: server.args ?? [],
  cwd: server.cwd,
  env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
  stderr: "pipe"
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  const missing = REQUIRED_TOOLS.filter((tool) => !names.includes(tool));
  const flowSmoke = args.flowSmoke && missing.length === 0 ? await runFlowSmoke(client) : null;
  const result = {
    ok: missing.length === 0 && (!args.flowSmoke || Boolean(flowSmoke?.archived)),
    count: names.length,
    missing,
    required: REQUIRED_TOOLS,
    server: {
      source: args.mcpJson ? path.resolve(args.mcpJson) : args.configToml ? path.resolve(args.configToml) : "direct",
      name: args.server ?? null,
      command: server.command,
      args: server.args ?? [],
      cwd: server.cwd,
      env_keys: Object.keys(server.env ?? {}).sort()
    },
    flow_smoke: flowSmoke,
    names
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace") parsed.workspace = argv[++i];
    else if (arg === "--mcp-json") parsed.mcpJson = argv[++i];
    else if (arg === "--config-toml") parsed.configToml = argv[++i];
    else if (arg === "--server") parsed.server = argv[++i];
    else if (arg === "--flow-smoke") parsed.flowSmoke = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function readServerFromCodexConfig(configPath, serverName) {
  const parsed = parseCodexMcpServers(await readFile(configPath, "utf8"));
  const selectedName = serverName ?? Object.keys(parsed)[0];
  const selected = parsed[selectedName];
  if (!selected) {
    throw new Error(`Server not found in ${configPath}: ${selectedName}`);
  }
  return selected;
}

function parseCodexMcpServers(text) {
  const servers = {};
  let currentServer = null;
  let inEnv = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const serverMatch = line.match(/^\[mcp_servers\.([^\].]+)\]$/);
    if (serverMatch) {
      currentServer = serverMatch[1];
      inEnv = false;
      servers[currentServer] = servers[currentServer] ?? {};
      continue;
    }

    const envMatch = line.match(/^\[mcp_servers\.([^\].]+)\.env\]$/);
    if (envMatch) {
      currentServer = envMatch[1];
      inEnv = true;
      servers[currentServer] = servers[currentServer] ?? {};
      servers[currentServer].env = servers[currentServer].env ?? {};
      continue;
    }

    if (!currentServer) continue;
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;

    const [, key, rawValue] = assignment;
    if (inEnv) {
      servers[currentServer].env[key] = parseTomlString(rawValue);
    } else if (key === "args") {
      servers[currentServer].args = parseTomlStringArray(rawValue);
    } else if (key === "command" || key === "cwd") {
      servers[currentServer][key] = parseTomlString(rawValue);
    }
  }

  return servers;
}

function parseTomlString(rawValue) {
  const value = rawValue.trim();
  const match = value.match(/^"(.*)"$/);
  if (!match) return value;
  return match[1]
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, "\"");
}

function parseTomlStringArray(rawValue) {
  const value = rawValue.trim();
  if (!value.startsWith("[") || !value.endsWith("]")) {
    return [];
  }
  const matches = [...value.matchAll(/"((?:\\.|[^"\\])*)"/g)];
  return matches.map((match) => match[1].replace(/\\\\/g, "\\").replace(/\\"/g, "\""));
}

async function runFlowSmoke(client) {
  const created = resultOf(await client.callTool({
    name: "flow_create",
    arguments: {
      goal: "PPIRTV MCP tools smoke",
      context: "Validate list_tools and flow lifecycle before executing a long SPT",
      risks: ["runtime loaded with incomplete tool surface"],
      uncertainties: ["consumer session may need restart"]
    }
  }));
  const flowId = created.flow_id;
  if (!flowId) {
    return { archived: false, error: "flow_create did not return flow_id" };
  }
  await client.callTool({
    name: "flow_archive",
    arguments: { flow_id: flowId, reason: "smoke complete" }
  });
  return { archived: true, flow_id: flowId };
}

function resultOf(response) {
  return response?.structuredContent?.result ?? {};
}

function directServer(repoRoot, workspace) {
  return {
    command: process.execPath,
    args: [path.join(repoRoot, "dist", "index.js")],
    cwd: workspace,
    env: {
      PPIRTV_HOME: path.join(workspace, ".ppirtv"),
      PPIRTV_PRINCIPLES_PATH: "C:\\Users\\Administrator\\.agents\\memories\\principles\\operational-contract.json"
    }
  };
}

async function readServerFromMcpJson(mcpJsonPath, serverName) {
  const cfg = JSON.parse(await readFile(mcpJsonPath, "utf8"));
  const servers = cfg.mcpServers ?? cfg.servers;
  if (!servers || typeof servers !== "object") {
    throw new Error(`No mcpServers/servers object in ${mcpJsonPath}`);
  }
  const selectedName = serverName ?? Object.keys(servers)[0];
  const selected = servers[selectedName];
  if (!selected) {
    throw new Error(`Server not found in ${mcpJsonPath}: ${selectedName}`);
  }
  return {
    command: selected.command,
    args: selected.args ?? [],
    cwd: selected.cwd,
    env: selected.env ?? {}
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/smoke-mcp-tools.mjs [--workspace <path>]
  node scripts/smoke-mcp-tools.mjs --mcp-json <path> [--server <name>]
  node scripts/smoke-mcp-tools.mjs --config-toml <path> [--server <name>]
  node scripts/smoke-mcp-tools.mjs --mcp-json <path> --server <name> --flow-smoke
  node scripts/smoke-mcp-tools.mjs --config-toml <path> --server <name> --flow-smoke

Validates that the real MCP server exposes the fiscal PPIRTV tools required by
required_cooperation, meeting, regress and verdict flows.`);
}
