#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") parsed.workspace = argv[++index];
    else if (arg === "--spt-path") parsed.sptPath = argv[++index];
    else if (arg === "--objective") parsed.objective = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!parsed.workspace || !parsed.sptPath) {
    throw new Error("--workspace and --spt-path are required");
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/validate-spt.mjs --workspace <dir> --spt-path <file> [--objective <text>]

Starts the dex-PPIRTV MCP server directly over stdio with the consumer
workspace as cwd, then calls tools/list, runtime_probe and spt_validate.
Exits 0 only when valid=true, contract_version=3, execution_eligible=true,
missing=[] and contract_errors=[].`);
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
  return response?.structuredContent?.result ?? {};
}

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace);
const sptPath = path.resolve(args.sptPath);
const server = directServer(workspace);
const client = new Client({ name: "dex-ppirtv-validate-spt", version: "0.1.0" });
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
  const validation = resultOf(
    await client.callTool({
      name: "spt_validate",
      arguments: {
        workspace,
        spt_path: sptPath,
        ...(args.objective ? { objective: args.objective } : {})
      }
    })
  );
  const proofSkeletons = Array.isArray(validation.proof_skeletons)
    ? validation.proof_skeletons.map((skeleton) => ({
        task_id: skeleton.task_id,
        evidence_requirement_id: skeleton.evidence_requirement_id,
        proves: skeleton.proves,
        method: skeleton.method,
        expectation: skeleton.expectation,
        observed_value_type: skeleton.observed_value_type,
        declarative_payload: skeleton.declarative_payload
      }))
    : [];
  const report = {
    mcp: "dex_ppirtv stdio direct",
    server: {
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env_keys: Object.keys(server.env).sort()
    },
    tool_count: names.length,
    tools: names,
    runtime_probe: {
      project_root: runtimeProbe.project_root,
      ppirtv_home: runtimeProbe.ppirtv_home,
      runtime_layout_status: runtimeProbe.runtime_layout_status,
      memory_writer_profile: runtimeProbe.memory_writer_runtime?.profile
    },
    proof_skeletons: proofSkeletons,
    spt_validate: validation
  };
  console.log(JSON.stringify(report, null, 2));
  exitCode = validation.valid === true
    && validation.contract_version === 3
    && validation.execution_eligible === true
    && Array.isArray(validation.missing)
    && validation.missing.length === 0
    && Array.isArray(validation.contract_errors)
    && validation.contract_errors.length === 0
    ? 0
    : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  exitCode = 1;
} finally {
  await client.close();
  process.exitCode = exitCode;
}
