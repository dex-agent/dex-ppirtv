import { realpathSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { REQUIRED_TOOLS } from "../dist/domain.js";

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
const workspacePlaceholder = workspacePlaceholderResolution(server, args.workspace ? workspace : null);
const runtimeServer = workspacePlaceholder.runtimeServer;
const configAudit = args.auditConfigTomls.length > 0
  ? await auditCodexConfigConflicts({
    serverUnderTest: server,
    source: serverSource,
    name: serverName,
    auditConfigTomls: args.auditConfigTomls.map((item) => path.resolve(item))
  })
  : null;
const runtimeConfigCheck = runtimeConfigCheckFor(runtimeServer);

if (args.auditOnly) {
  const result = {
    ok: runtimeConfigCheck.ok && (!args.failOnConfigConflict || !configAudit?.conflicts.length),
    server: serverSummary(server, serverSource, serverName),
    runtime_server: workspacePlaceholder.applied ? serverSummary(runtimeServer, "effective", serverName) : undefined,
    workspace_placeholder: workspacePlaceholder.summary,
    runtime_config_check: runtimeConfigCheck,
    config_audit: configAudit
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
  process.exit();
}

if (!runtimeConfigCheck.ok) {
  const result = {
    ok: false,
    server: serverSummary(server, serverSource, serverName),
    runtime_server: workspacePlaceholder.applied ? serverSummary(runtimeServer, "effective", serverName) : undefined,
    workspace_placeholder: workspacePlaceholder.summary,
    runtime_config_check: runtimeConfigCheck,
    config_audit: configAudit
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
  process.exit();
}

const client = new Client({ name: "dex-ppirtv-smoke-mcp-tools", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: runtimeServer.command,
  args: runtimeServer.args ?? [],
  cwd: runtimeServer.cwd,
  env: { ...getDefaultEnvironment(), ...(runtimeServer.env ?? {}) },
  stderr: "pipe"
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  const missing = REQUIRED_TOOLS.filter((tool) => !names.includes(tool));
  const runtimeProbe = names.includes("runtime_probe")
    ? resultOf(await client.callTool({ name: "runtime_probe", arguments: {} }))
    : null;
  const memoryV2Profile = runtimeProbe?.memory_writer_runtime?.profile ?? "unconfigured";
  const memoryV2Requirement = {
    required: Boolean(args.requireMemoryV2),
    ok: memoryV2Profile === "v2",
    profile: memoryV2Profile
  };
  const memoryV2Capability = args.requireMemoryV2 && memoryV2Requirement.ok
    ? await runMemoryV2Capability(runtimeProbe)
    : null;
  const flowWorkspace = runtimeConfigCheck.launcher_workspace ?? runtimeServer.cwd ?? workspace;
  const flowSmoke = args.flowSmoke && missing.length === 0 ? await runFlowSmoke(client, flowWorkspace) : null;
  const result = {
    ok: missing.length === 0
      && (!args.flowSmoke || Boolean(flowSmoke?.archived))
      && (!args.failOnConfigConflict || !configAudit?.conflicts.length)
      && (!args.requireMemoryV2 || (memoryV2Requirement.ok && memoryV2Capability?.ok === true)),
    count: names.length,
    missing,
    required: REQUIRED_TOOLS,
    server: serverSummary(server, serverSource, serverName),
    runtime_server: workspacePlaceholder.applied ? serverSummary(runtimeServer, "effective", serverName) : undefined,
    workspace_placeholder: workspacePlaceholder.summary,
    runtime_config_check: runtimeConfigCheck,
    config_audit: configAudit,
    flow_smoke: flowSmoke,
    memory_v2_requirement: memoryV2Requirement,
    memory_v2_capability: memoryV2Capability,
    runtime_probe: runtimeProbe,
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
    else if (arg === "--require-memory-v2") parsed.requireMemoryV2 = true;
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

async function runMemoryV2Capability(runtimeProbe) {
  const runtime = runtimeProbe?.memory_writer_runtime ?? {};
  const canonicalRoot = runtime.canonical_root;
  const entrypoint = runtime.entrypoint;
  if (!canonicalRoot || !entrypoint) {
    return { ok: false, proof_level: "writer_capability", code: "memory_v2_runtime_paths_missing" };
  }
  const request = {
    capability: "v2-obsidian",
    require_obsidian: true,
    block_ids: ["ppi-install-probe"],
    markdown_links: ["memorias/ppi-install-probe.md"],
    wikilinks: ["[[memorias/ppi-install-probe|PPI install probe]]"],
    backlinks: ["L1->L2", "L2->L1"],
    unresolved_markdown_links: [],
    unresolved_wikilinks: []
  };
  try {
    const receipt = await runJsonCli(process.execPath, [entrypoint, "v2", "capability"], canonicalRoot, request);
    const expectedKeys = ["capability", "contract", "errors", "expected_require_obsidian", "ok", "require_obsidian"];
    const actualKeys = receipt && typeof receipt === "object" && !Array.isArray(receipt)
      ? Object.keys(receipt).sort()
      : [];
    const ok = JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
      && receipt?.contract === "dex.memory.capability.receipt.v2"
      && receipt?.capability === "v2-obsidian"
      && receipt?.require_obsidian === true
      && receipt?.expected_require_obsidian === true
      && receipt?.ok === true
      && Array.isArray(receipt?.errors)
      && receipt.errors.length === 0;
    return {
      ok,
      proof_level: "writer_capability",
      contract: receipt?.contract ?? null,
      capability: receipt?.capability ?? null,
      code: ok ? "memory_v2_capability_verified" : "memory_v2_capability_invalid"
    };
  } catch (error) {
    return {
      ok: false,
      proof_level: "writer_capability",
      code: error instanceof Error ? error.message : "memory_v2_capability_failed"
    };
  }
}

async function runJsonCli(command, commandArgs, cwd, payload) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("memory_v2_capability_timeout")));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(0, 1024 * 1024); });
    child.on("error", () => finish(() => reject(new Error("memory_v2_capability_spawn_failed"))));
    child.on("close", (exitCode) => finish(() => {
      if (exitCode !== 0) {
        reject(new Error(`memory_v2_capability_exit_${exitCode ?? "unknown"}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("memory_v2_capability_invalid_json"));
      }
    }));
    child.stdin.end(JSON.stringify(payload));
  });
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

async function runFlowSmoke(client, workspaceRoot) {
  const sptPath = await writeSmokeSpt(workspaceRoot);
  const idempotencyKey = `dex-ppirtv-smoke:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const envelope = {
    workspace: workspaceRoot,
    spt_path: sptPath,
    objective: "Validate PPIRTV MCP runtime isolation smoke",
    idempotency_key: idempotencyKey,
    evidence_required: true,
    required_evidence: ["runtime status", "checkout status"],
    requested_verdict_policy: "evidence_required",
    source: "dex-ppirtv-smoke"
  };
  await client.callTool({ name: "spt_validate", arguments: envelope });
  const created = resultOf(await client.callTool({ name: "goal_start", arguments: envelope }));
  const flowId = created.flow_id;
  if (!flowId) {
    return { archived: false, error: "goal_start did not return flow_id" };
  }
  const statusBeforePreflight = resultOf(await client.callTool({ name: "goal_status", arguments: { flow_id: flowId } }));
  const preflight = resultOf(
    await client.callTool({ name: "goal_gate_preflight", arguments: { flow_id: flowId } })
  );
  if (preflight.read_only !== true || preflight.persisted !== false) {
    throw new Error("goal_gate_preflight violated its read-only receipt contract");
  }
  const status = resultOf(await client.callTool({ name: "goal_status", arguments: { flow_id: flowId } }));
  if (JSON.stringify(status) !== JSON.stringify(statusBeforePreflight)) {
    throw new Error("goal_gate_preflight mutated the observable GOAL status");
  }
  const checkout = resultOf(await client.callTool({ name: "ppirtv_checkout", arguments: { flow_id: flowId } }));
  await client.callTool({
    name: "flow_archive",
    arguments: { flow_id: flowId, reason: "smoke complete" }
  });
  return {
    archived: true,
    flow_id: flowId,
    preflight_runtime: {
      read_only: preflight.read_only,
      persisted: preflight.persisted,
      missing: preflight.missing
    },
    status_runtime: runtimeSummary(status),
    checkout_runtime: runtimeSummary(checkout)
  };
}

async function writeSmokeSpt(workspaceRoot) {
  const dir = path.join(workspaceRoot, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "ppirtv-smoke-runtime-isolation.md");
  await writeFile(
    sptPath,
    [
      "---",
      "dex_contract: spt",
      "version: 2",
      "status: EM_TESTE",
      "owner: smoke-mcp-tools",
      "date: '2026-06-30'",
      `workspace: ${JSON.stringify(workspaceRoot)}`,
      "origin: scripts/smoke-mcp-tools.mjs",
      "goal:",
      "  id: ppirtv-smoke-runtime-isolation",
      "  title: PPIRTV Smoke Runtime Isolation",
      "  objective: Validate PPIRTV MCP runtime isolation smoke",
      "context: Validate the MCP runtime layout selected for the active consumer workspace.",
      "problem: A tool-list smoke can pass while runtime state is written to the wrong project.",
      "decision: Use official GOAL/SPT tools and inspect runtime diagnostics.",
      "scope:",
      "  include:",
      "    - Start a minimal official GOAL.",
      "    - Inspect runtime diagnostics.",
      "  exclude:",
      "    - Fiscal closure.",
      "    - Long SPT execution.",
      "spec: Runtime diagnostics must point to the caller workspace.",
      "plan:",
      "  - Validate this SPT.",
      "  - Start a GOAL.",
      "  - Read status and checkout.",
      "  - Archive the smoke flow.",
      "tasks:",
      "  - Validate tool surface.",
      "  - Validate runtime layout.",
      "expected_evidence:",
      "  - runtime status",
      "  - checkout status",
      "done_criteria:",
      "  - runtime diagnostics point to the active workspace.",
      "risks:",
      "  - False green if only list_tools is checked.",
      "uncertainties:",
      "  - Consumer runtime configuration may select a different workspace.",
      "gates:",
      "  - Gate do Quando runs this smoke before long SPT execution.",
      "validation:",
      "  - npm run smoke:mcp-tools -- --workspace <workspace> --flow-smoke",
      "execution_prompt: Run this smoke only for runtime isolation validation.",
      "---",
      "# Human smoke notes",
      "",
      "This body is intentionally not parsed."
    ].join("\n"),
    "utf8"
  );
  return sptPath;
}

function runtimeSummary(result) {
  return {
    project_root: result.project_root,
    ppirtv_home: result.ppirtv_home,
    runtime_layout_status: result.runtime_layout_status,
    memory_writer_runtime: result.memory_writer_runtime
  };
}

function resultOf(response) {
  return response?.structuredContent?.result ?? {};
}

function serverSummary(server, source, name) {
  return {
    source,
    name,
    enabled: server.enabled !== false,
    command: server.command,
    args: server.args ?? [],
    cwd: server.cwd,
    env_keys: Object.keys(server.env ?? {}).sort()
  };
}

function runtimeConfigCheckFor(server) {
  if (server.enabled === false) {
    return {
      ok: false,
      code: "mcp_server_disabled",
      message: "Selected MCP server is disabled and cannot prove the runtime used by the consumer."
    };
  }
  const launcherCheck = launcherRuntimeConfigCheckFor(server);
  if (launcherCheck) {
    return launcherCheck;
  }
  const cwd = server.cwd ? path.resolve(server.cwd) : null;
  const expected = cwd ? path.join(cwd, ".ppirtv") : null;
  const ppirtvHome = server.env?.PPIRTV_HOME ? path.resolve(cwd ?? process.cwd(), server.env.PPIRTV_HOME) : null;
  const ok = Boolean(cwd && (!ppirtvHome || samePath(ppirtvHome, expected)));
  return {
    ok,
    code: ok ? (ppirtvHome ? "ppirtv_home_matches_cwd" : "ppirtv_home_defaults_to_cwd") : "ppirtv_home_mismatch",
    cwd,
    ppirtv_home: ppirtvHome,
    expected_ppirtv_home: expected,
    message: ok
      ? ppirtvHome
        ? "PPIRTV_HOME confirms <cwd>/.ppirtv"
        : "PPIRTV_HOME is unset; runtime will use <cwd>/.ppirtv"
      : "PPIRTV_HOME must resolve exactly to <cwd>/.ppirtv for runtime isolation"
  };
}

function launcherRuntimeConfigCheckFor(server) {
  if (!isLauncherServer(server)) {
    return null;
  }
  const cwd = server.cwd ? path.resolve(server.cwd) : null;
  if (!cwd) {
    return {
      ok: false,
      code: "ppirtv_launcher_cwd_missing",
      cwd,
      message: "Global launcher configs must declare cwd so workspace hints can be resolved safely."
    };
  }
  const hint = launcherWorkspaceHint(server);
  if (!hint) {
    const cwdIsInstallRepo = samePath(cwd, repoRoot);
    return {
      ok: !cwdIsInstallRepo,
      code: cwdIsInstallRepo ? "ppirtv_launcher_workspace_required" : "ppirtv_launcher_cwd_workspace",
      cwd,
      launcher_workspace: cwdIsInstallRepo ? null : canonicalExistingPath(cwd),
      expected_ppirtv_home: cwdIsInstallRepo ? null : path.join(canonicalExistingPath(cwd), ".ppirtv"),
      message: cwdIsInstallRepo
        ? "Global launcher started from the install repository without --workspace or PPIRTV_WORKSPACE."
        : "Launcher will use cwd as the consumer workspace."
    };
  }
  const resolved = resolveLauncherHint(hint.value, cwd, server.env ?? {});
  if (!resolved) {
    return {
      ok: false,
      code: "ppirtv_launcher_workspace_not_found",
      cwd,
      launcher_hint: hint,
      message: "Launcher workspace hint did not resolve to an existing project directory."
    };
  }
  if (samePath(resolved, repoRoot) && hint.source !== "argv") {
    return {
      ok: false,
      code: "ppirtv_launcher_install_root_selected",
      cwd,
      launcher_hint: hint,
      launcher_workspace: resolved,
      message: "Launcher workspace resolves to the dex-PPIRTV install repository, not a consumer project."
    };
  }
  return {
    ok: true,
    code: "ppirtv_launcher_workspace_resolved",
    cwd,
    launcher_hint: hint,
    launcher_workspace: resolved,
    expected_ppirtv_home: path.join(resolved, ".ppirtv"),
    message: samePath(resolved, repoRoot)
      ? "Launcher argv explicitly selects the dex-PPIRTV owner workspace; PPIRTV_HOME will be set by the launcher."
      : "Launcher workspace hint resolves to a consumer project; PPIRTV_HOME will be set by the launcher."
  };
}

function isLauncherServer(server) {
  return [server.command, ...(server.args ?? [])]
    .filter(Boolean)
    .some((item) => /dex-ppirtv-launcher/i.test(item) || /(?:^|[\\/])launcher\.(?:js|mjs|cjs)$/i.test(item));
}

function launcherWorkspaceHint(server) {
  const args = server.args ?? [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace") {
      return args[index + 1] ? { source: "argv", value: args[index + 1] } : null;
    }
    if (arg.startsWith("--workspace=")) {
      return { source: "argv", value: arg.slice("--workspace=".length) };
    }
  }
  const envWorkspace = server.env?.PPIRTV_WORKSPACE;
  return envWorkspace ? { source: "env", value: envWorkspace } : null;
}

function resolveLauncherHint(hint, cwd, env) {
  const candidates = launcherCandidates(hint, cwd, env);
  for (const candidate of candidates) {
    if (isProjectDirectory(candidate)) {
      return canonicalExistingPath(candidate);
    }
  }
  return null;
}

function launcherCandidates(hint, cwd, env) {
  if (path.isAbsolute(hint)) {
    return [path.resolve(hint)];
  }
  const roots = launcherWorkspaceRoots(cwd, env);
  const hasSeparator = /[\\/]/.test(hint) || hint === "." || hint === ".." || hint.startsWith("./") || hint.startsWith("../");
  const relativeCandidates = hasSeparator ? [path.resolve(cwd, hint)] : [];
  return [...relativeCandidates, ...roots.map((root) => path.resolve(root, hint))];
}

function launcherWorkspaceRoots(cwd, env) {
  const roots = [
    ...(env.PPIRTV_WORKSPACE_ROOTS?.split(path.delimiter) ?? []),
    env.PPIRTV_WORKSPACE_ROOT,
    cwd
  ].filter(Boolean).map((root) => path.resolve(cwd, String(root)));
  const seen = new Set();
  return roots.filter((root) => {
    const key = normalizePath(root);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isProjectDirectory(value) {
  if (!isDirectory(value)) {
    return false;
  }
  return [".git", "AGENTS.md", "package.json", ".agents", ".codex"].some((marker) => pathExistsSync(path.join(value, marker)));
}

function isDirectory(value) {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function pathExistsSync(value) {
  try {
    statSync(value);
    return true;
  } catch {
    return false;
  }
}

function canonicalExistingPath(value) {
  try {
    return realpathSync.native(path.resolve(value));
  } catch {
    return path.resolve(value);
  }
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

function samePath(left, right) {
  return normalizePath(left) === normalizePath(right);
}

function directServer(repoRoot, workspace) {
  const principlesPath = sharedOperationalContractPath();
  return {
    command: process.execPath,
    args: [path.join(repoRoot, "dist", "index.js")],
    cwd: workspace,
    env: {
      PPIRTV_HOME: path.join(workspace, ".ppirtv"),
      PPIRTV_WORKSPACE: workspace,
      ...(principlesPath ? { PPIRTV_PRINCIPLES_PATH: principlesPath } : {})
    }
  };
}

function workspacePlaceholderResolution(server, workspaceOverride) {
  const blank = blankLauncherWorkspacePlaceholder(server);
  const missing = missingLauncherWorkspaceSignal(server);
  if (!blank && !missing) {
    return {
      applied: false,
      runtimeServer: server,
      summary: null
    };
  }
  if (!workspaceOverride) {
    return {
      applied: false,
      runtimeServer: server,
      summary: {
        detected: true,
        applied: false,
        kind: blank ? "blank_workspace_placeholder" : "missing_workspace_argument",
        reason: "global launcher validation requires --workspace <consumer-workspace> on the smoke command"
      }
    };
  }
  const args = [...(server.args ?? [])];
  if (blank?.kind === "separate") {
    args[blank.index + 1] = workspaceOverride;
  } else if (blank?.kind === "equals") {
    args[blank.index] = `--workspace=${workspaceOverride}`;
  } else {
    args.push("--workspace", workspaceOverride);
  }
  return {
    applied: true,
    runtimeServer: { ...server, args },
    summary: {
      detected: true,
      applied: true,
      kind: blank ? "blank_workspace_placeholder" : "missing_workspace_argument",
      source: "smoke_cli_workspace",
      workspace: workspaceOverride,
      note: "global config remains neutral; the smoke injects the consumer workspace only for this validation run"
    }
  };
}

function blankLauncherWorkspacePlaceholder(server) {
  if (!isLauncherServer(server)) {
    return null;
  }
  const args = server.args ?? [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace" && typeof args[index + 1] === "string" && args[index + 1].trim() === "") {
      return { kind: "separate", index };
    }
    if (arg === "--workspace=") {
      return { kind: "equals", index };
    }
  }
  return null;
}

function missingLauncherWorkspaceSignal(server) {
  if (!isLauncherServer(server)) {
    return false;
  }
  if (launcherWorkspaceHint(server)) {
    return false;
  }
  return samePath(server.cwd, repoRoot);
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
  node scripts/smoke-mcp-tools.mjs --config-toml <path> --server <name> --workspace <consumer> --require-memory-v2
  node scripts/smoke-mcp-tools.mjs --config-toml <path> --server <name> --workspace <consumer> --flow-smoke
  node scripts/smoke-mcp-tools.mjs --config-toml <child> --server <name> --audit-config-toml <parent> --audit-only

Validates that the real MCP server exposes the fiscal PPIRTV tools required by
required_cooperation, meeting, regress and verdict flows. Optional
--audit-config-toml compares other visible Codex configs for PPIRTV-like
servers with divergent cwd or PPIRTV_HOME; --fail-on-config-conflict makes an
enabled divergent server fail the command. When a Codex launcher config is
global/neutral, either with a blank --workspace placeholder or without
--workspace, --workspace <consumer> is used only for the smoke runtime and does
not imply writing that consumer path to global config. --require-memory-v2
fails unless runtime_probe reports memory_writer_runtime.profile=v2 and the
configured canonical entrypoint returns a valid v2-obsidian capability receipt.`);
}
