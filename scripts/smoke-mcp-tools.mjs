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
  "mm_memory_candidate_resolve",
  "goal_regress",
  "goal_verdict",
  "flow_archive"
];

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(import.meta.dirname, "..");
const workspace = path.resolve(args.workspace ?? process.cwd());
const serverSource = args.mcpJson ? path.resolve(args.mcpJson) : args.configToml ? path.resolve(args.configToml) : "direct";
const serverName = args.server ?? null;
const server = args.mcpJson
  ? await readServerFromMcpJson(path.resolve(args.mcpJson), args.server)
  : args.configToml
    ? await readServerFromCodexConfig(path.resolve(args.configToml), args.server)
  : directServer(repoRoot, workspace);
const configAudit = args.auditConfigTomls.length > 0
  ? await auditCodexConfigConflicts({
    serverUnderTest: server,
    source: serverSource,
    name: serverName,
    auditConfigTomls: args.auditConfigTomls.map((item) => path.resolve(item))
  })
  : null;

if (args.auditOnly) {
  const result = {
    ok: !args.failOnConfigConflict || !configAudit?.conflicts.length,
    server: serverSummary(server, serverSource, serverName),
    config_audit: configAudit
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
  process.exit();
}

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
    ok: missing.length === 0 && (!args.flowSmoke || Boolean(flowSmoke?.archived)) && (!args.failOnConfigConflict || !configAudit?.conflicts.length),
    count: names.length,
    missing,
    required: REQUIRED_TOOLS,
    server: serverSummary(server, serverSource, serverName),
    config_audit: configAudit,
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
  const parsed = { auditConfigTomls: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace") parsed.workspace = argv[++i];
    else if (arg === "--mcp-json") parsed.mcpJson = argv[++i];
    else if (arg === "--config-toml") parsed.configToml = argv[++i];
    else if (arg === "--audit-config-toml") parsed.auditConfigTomls.push(argv[++i]);
    else if (arg === "--server") parsed.server = argv[++i];
    else if (arg === "--flow-smoke") parsed.flowSmoke = true;
    else if (arg === "--audit-only") parsed.auditOnly = true;
    else if (arg === "--fail-on-config-conflict") parsed.failOnConfigConflict = true;
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

async function readAllServersFromCodexConfig(configPath) {
  return parseCodexMcpServers(await readFile(configPath, "utf8"));
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
    } else if (key === "enabled") {
      servers[currentServer].enabled = parseTomlBoolean(rawValue);
    }
  }

  return servers;
}

function parseTomlBoolean(rawValue) {
  return rawValue.trim().toLowerCase() !== "false";
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

function serverSummary(server, source, name) {
  return {
    source,
    name,
    command: server.command,
    args: server.args ?? [],
    cwd: server.cwd,
    env_keys: Object.keys(server.env ?? {}).sort()
  };
}

async function auditCodexConfigConflicts({ serverUnderTest, source, name, auditConfigTomls }) {
  const underTest = {
    source,
    name,
    normalized_name: normalizeServerName(name),
    cwd: normalizePath(serverUnderTest.cwd),
    ppirtv_home: normalizePath(serverUnderTest.env?.PPIRTV_HOME),
    enabled: serverUnderTest.enabled !== false
  };
  const visible = [];
  for (const configPath of auditConfigTomls) {
    const servers = await readAllServersFromCodexConfig(configPath);
    for (const [serverName, server] of Object.entries(servers)) {
      if (!isPpirtvServer(serverName, server)) {
        continue;
      }
      visible.push({
        source: configPath,
        name: serverName,
        normalized_name: normalizeServerName(serverName),
        enabled: server.enabled !== false,
        cwd: normalizePath(server.cwd),
        ppirtv_home: normalizePath(server.env?.PPIRTV_HOME),
        same_as_under_test: sameServer(configPath, serverName, source, name)
      });
    }
  }
  const others = visible.filter((item) => !item.same_as_under_test);
  const conflicts = others
    .filter((item) => item.enabled && divergesFromUnderTest(item, underTest))
    .map((item) => ({
      code: "ppirtv_config_conflict",
      severity: "error",
      server: item.name,
      source: item.source,
      reason: "other enabled PPIRTV-like server has divergent cwd or PPIRTV_HOME",
      cwd: item.cwd,
      ppirtv_home: item.ppirtv_home
    }));
  const warnings = others
    .filter((item) => !item.enabled && divergesFromUnderTest(item, underTest))
    .map((item) => ({
      code: "disabled_ppirtv_config_visible",
      severity: "warning",
      server: item.name,
      source: item.source,
      reason: "disabled PPIRTV-like server is still visible in an audited config; stale clients may need restart",
      cwd: item.cwd,
      ppirtv_home: item.ppirtv_home
    }));
  return {
    server_under_test: underTest,
    visible_ppirtv_servers: visible,
    conflicts,
    warnings,
    interpretation:
      conflicts.length > 0
        ? "smoke validated the selected server, but another enabled PPIRTV-like config may write runtime artifacts to a different PPIRTV_HOME"
        : warnings.length > 0
          ? "selected server has no enabled PPIRTV config conflict; disabled inherited configs remain a stale-client risk"
          : "no PPIRTV config conflict detected in audited configs"
  };
}

function isPpirtvServer(name, server) {
  const text = [name, server.command, ...(server.args ?? []), server.cwd, server.env?.PPIRTV_HOME].filter(Boolean).join("\n");
  return /ppirtv/i.test(text);
}

function sameServer(configPath, serverName, source, name) {
  return path.resolve(configPath).toLowerCase() === String(source).toLowerCase() && (!name || serverName === name);
}

function divergesFromUnderTest(candidate, underTest) {
  return Boolean(
    (candidate.cwd && underTest.cwd && candidate.cwd !== underTest.cwd) ||
      (candidate.ppirtv_home && underTest.ppirtv_home && candidate.ppirtv_home !== underTest.ppirtv_home) ||
      (candidate.normalized_name && underTest.normalized_name && candidate.normalized_name !== underTest.normalized_name)
  );
}

function normalizeServerName(name) {
  return name ? String(name).toLowerCase().replace(/[-_]/g, "") : null;
}

function normalizePath(value) {
  return value ? path.resolve(String(value)).toLowerCase() : null;
}

function directServer(repoRoot, workspace) {
  const principlesPath = sharedOperationalContractPath();
  return {
    command: process.execPath,
    args: [path.join(repoRoot, "dist", "index.js")],
    cwd: workspace,
    env: {
      PPIRTV_HOME: path.join(workspace, ".ppirtv"),
      ...(principlesPath ? { PPIRTV_PRINCIPLES_PATH: principlesPath } : {})
    }
  };
}

function sharedOperationalContractPath() {
  const userProfile = process.env.USERPROFILE ?? process.env.HOME;
  return userProfile
    ? path.join(userProfile, ".agents", "memories", "principles", "operational-contract.json")
    : undefined;
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
  node scripts/smoke-mcp-tools.mjs --config-toml <child> --server <name> --audit-config-toml <parent> --audit-only

Validates that the real MCP server exposes the fiscal PPIRTV tools required by
required_cooperation, meeting, regress and verdict flows. Optional
--audit-config-toml compares other visible Codex configs for PPIRTV-like
servers with divergent cwd or PPIRTV_HOME; --fail-on-config-conflict makes an
enabled divergent server fail the command.`);
}
