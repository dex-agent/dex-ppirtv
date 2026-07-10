import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(required(args, "workspace"));
const repoRoot = path.resolve(import.meta.dirname, "..");
const userProfile = process.env.USERPROFILE || process.env.HOME || workspace;
const client = new Client({ name: "dex-ppirtv-progress-bridge", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repoRoot, "dist", "index.js")],
  cwd: workspace,
  env: {
    ...getDefaultEnvironment(),
    PPIRTV_HOME: path.join(workspace, ".ppirtv"),
    PPIRTV_PRINCIPLES_PATH: process.env.PPIRTV_PRINCIPLES_PATH || path.join(userProfile, ".agents", "memories", "principles", "operational-contract.json")
  },
  stderr: "pipe"
});

await client.connect(transport);
try {
  const response = await client.callTool({
    name: "goal_progress_record",
    arguments: {
      flow_id: required(args, "flow-id"),
      event_key: required(args, "event-key"),
      source: required(args, "source"),
      operation: required(args, "operation"),
      stage: required(args, "stage"),
      current: integer(args, "current"),
      total: integer(args, "total"),
      status: required(args, "status"),
      ...(args.message ? { message: args.message } : {})
    }
  });
  const result = response?.structuredContent?.result ?? {};
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (response.isError === true) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      throw new Error(`Unexpected argument: ${item}`);
    }
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function required(values, key) {
  const value = values[key]?.trim();
  if (!value) {
    throw new Error(`Missing --${key}`);
  }
  return value;
}

function integer(values, key) {
  const value = Number(required(values, key));
  if (!Number.isInteger(value)) {
    throw new Error(`--${key} must be an integer`);
  }
  return value;
}
