#!/usr/bin/env node
// Generic dex-PPIRTV MCP stdio harness.
// Starts the MCP server directly over stdio with the consumer workspace as
// cwd, then lists tools and/or calls one tool with JSON arguments.
//
// Usage:
//   node scripts/call-mcp-tool.mjs --workspace <dir> --list
//   node scripts/call-mcp-tool.mjs --workspace <dir> --probe
//   node scripts/call-mcp-tool.mjs --workspace <dir> --tool spt_validate --args '{"workspace":"<dir>","spt_path":"<file>"}'
//   node scripts/call-mcp-tool.mjs --workspace <dir> --tool goal_status --args '{"flow_id":"<id>"}'
//   node scripts/call-mcp-tool.mjs --workspace <dir> --tool <name> --args-file <path.json>
//
// Exit 0 when the tool call succeeds without isError; exit 1 otherwise.
import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") parsed.workspace = argv[++index];
    else if (arg === "--tool") parsed.tool = argv[++index];
    else if (arg === "--args") parsed.argsJson = argv[++index];
    else if (arg === "--args-file") parsed.argsFile = argv[++index];
    else if (arg === "--list") parsed.list = true;
    else if (arg === "--probe") parsed.probe = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!parsed.workspace) {
    throw new Error("--workspace is required");
  }
  if (parsed.argsJson && parsed.argsFile) {
    throw new Error("Use apenas um de --args ou --args-file");
  }
  return parsed;
}

function printHelp() {
  console.log(`Generic dex-PPIRTV MCP stdio harness.

Usage:
  node scripts/call-mcp-tool.mjs --workspace <dir> --list
  node scripts/call-mcp-tool.mjs --workspace <dir> --probe
  node scripts/call-mcp-tool.mjs --workspace <dir> --tool <name> [--args <json> | --args-file <path.json>]

Without --tool, the harness lists tools and runs runtime_probe. With --tool,
it lists tools, runs runtime_probe and calls the requested tool.`);
}

async function loadArgs(args) {
  if (args.argsFile) {
    const text = await readFile(path.resolve(args.argsFile), "utf8");
    return JSON.parse(text);
  }
  if (args.argsJson) {
    return JSON.parse(args.argsJson);
  }
  return {};
}

function directServer(workspace) {
  const userProfile = process.env.USERPROFILE ?? process.env.HOME;
  const principlesPath = userProfile
    ? path.join(userProfile, ".agents", "memories", "principles", "operational-contract.json")
    : undefined;
  return {
    command: process.execPath,
    args: [path.join(repoRoot, "dist", "index.js")],
    cwd: workspace,
    env: {
      ...getDefaultEnvironment(),
      PPIRTV_HOME: path.join(workspace, ".ppirtv"),
      PPIRTV_WORKSPACE: workspace,
      ...(principlesPath ? { PPIRTV_PRINCIPLES_PATH: principlesPath } : {})
    }
  };
}

function resultOf(response) {
  return response?.structuredContent?.result ?? {
    content: response?.content ?? null,
    isError: response?.isError ?? false
  };
}

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace);
const server = directServer(workspace);
const client = new Client({ name: "dex-ppirtv-call-mcp-tool", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: server.command,
  args: server.args,
  cwd: server.cwd,
  env: server.env,
  stderr: "pipe"
});

let exitCode = 1;
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  const runtimeProbe = resultOf(await client.callTool({ name: "runtime_probe", arguments: {} }));

  if (args.list && !args.tool) {
    console.log(JSON.stringify({
      ok: true,
      mcp: "dex_ppirtv stdio direct",
      workspace,
      tool_count: names.length,
      tools: names,
      runtime_probe: runtimeProbe
    }, null, 2));
    exitCode = 0;
  } else if (args.tool) {
    const toolArgs = await loadArgs(args);
    const response = await client.callTool({ name: args.tool, arguments: toolArgs });
    const result = resultOf(response);
    const isError = response?.isError === true || result?.isError === true;
    console.log(JSON.stringify({
      ok: !isError,
      mcp: "dex_ppirtv stdio direct",
      workspace,
      tool: args.tool,
      is_error: isError,
      tool_count: names.length,
      runtime_probe: runtimeProbe,
      result
    }, null, 2));
    exitCode = isError ? 1 : 0;
  } else {
    console.log(JSON.stringify({
      ok: true,
      mcp: "dex_ppirtv stdio direct",
      workspace,
      tool_count: names.length,
      tools: names,
      runtime_probe: runtimeProbe
    }, null, 2));
    exitCode = args.probe ? 0 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  exitCode = 1;
} finally {
  await client.close();
  process.exitCode = exitCode;
}
