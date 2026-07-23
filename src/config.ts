import { realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDexMemoriaV2CliExecutor, type DexMemoriaV2FlowWriterConfig } from "./memory/dex-memoria-v2-adapter.js";

export const RUNTIME_ENV = {
  dexMemoriaHome: "DEX_MEMORIA_HOME",
  dexMemoriaV2CanonicalRoot: "PPIRTV_DEX_MEMORIA_CANONICAL_ROOT",
  dexMemoriaV2Entrypoint: "PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT",
  graphifyBudget: "PPIRTV_GRAPHIFY_BUDGET",
  graphifyCommand: "PPIRTV_GRAPHIFY_COMMAND",
  graphifyGraphPath: "PPIRTV_GRAPHIFY_GRAPH_PATH",
  graphifyRecall: "PPIRTV_GRAPHIFY_RECALL",
  graphifyTimeoutMs: "PPIRTV_GRAPHIFY_TIMEOUT_MS",
  home: "HOME",
  ppirtvHome: "PPIRTV_HOME",
  principlesPath: "PPIRTV_PRINCIPLES_PATH",
  memoryWriterProfile: "PPIRTV_MEMORY_WRITER_PROFILE",
  userProfile: "USERPROFILE",
  workspace: "PPIRTV_WORKSPACE",
  workspaceRoot: "PPIRTV_WORKSPACE_ROOT",
  workspaceRoots: "PPIRTV_WORKSPACE_ROOTS"
} as const;

export type MemoryWriterRuntimeConfig = { profile: "unconfigured" | "legacy-v1" } | DexMemoriaV2FlowWriterConfig;

export function resolveMemoryWriterConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MemoryWriterRuntimeConfig {
  const profile = env[RUNTIME_ENV.memoryWriterProfile]?.trim();
  if (!profile) return { profile: "unconfigured" };
  if (profile === "legacy-v1") return { profile: "legacy-v1" };
  if (profile !== "v2") throw new Error(`PPIRTV_MEMORY_WRITER_PROFILE_INVALID: ${profile}`);
  const canonicalRoot = env[RUNTIME_ENV.dexMemoriaV2CanonicalRoot]?.trim();
  const entrypoint = env[RUNTIME_ENV.dexMemoriaV2Entrypoint]?.trim();
  if (!canonicalRoot || !entrypoint) {
    throw new Error("PPIRTV_DEX_MEMORIA_V2_CONFIG_REQUIRED: set canonical root and V2 entrypoint explicitly");
  }
  const memoryHome = env[RUNTIME_ENV.dexMemoriaHome]?.trim();
  if (!memoryHome) throw new Error("PPIRTV_DEX_MEMORIA_HOME_REQUIRED");
  if (!path.isAbsolute(memoryHome)) throw new Error("PPIRTV_DEX_MEMORIA_HOME_MUST_BE_ABSOLUTE");
  const workspaceRoot = env[RUNTIME_ENV.workspace]?.trim();
  if (!workspaceRoot) throw new Error("PPIRTV_DEX_MEMORIA_V2_WORKSPACE_REQUIRED");
  if (!path.isAbsolute(workspaceRoot)) throw new Error("PPIRTV_DEX_MEMORIA_V2_WORKSPACE_MUST_BE_ABSOLUTE");
  return {
    profile: "v2",
    canonical_root: path.resolve(canonicalRoot),
    entrypoint: path.resolve(entrypoint),
    memory_home: path.resolve(memoryHome),
    workspace_root: path.resolve(workspaceRoot),
    executor: createDexMemoriaV2CliExecutor({ canonical_root: canonicalRoot, entrypoint })
  };
}

export const FISCAL_CONFIG = {
  maxRegressions: 3
} as const;

export const PPIRTV_RUNTIME_DIRS = ["flows", "meetings", "evidence", "memory", "review", "verdicts", "logs", "specs", "tasks"] as const;

export type PpirtvRuntimeDir = typeof PPIRTV_RUNTIME_DIRS[number];

export type PpirtvRuntimePaths = {
  projectRoot: string;
  ppirtvHome: string;
  dirs: Record<PpirtvRuntimeDir, string>;
  ledgerPath: string;
};

export type GraphifyRuntimeConfig = {
  enabled: boolean;
  command?: string;
  graphPath?: string;
  timeoutMs?: number;
  budget?: number;
};

export type LauncherWorkspaceResolution = {
  workspace: string;
  ppirtvHome: string;
  source: "argv" | "env" | "cwd";
  hint?: string;
};

export function resolveProjectRoot(cwd = process.cwd()): string {
  return realPathIfExists(path.resolve(cwd));
}

export function resolveRuntimePaths(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): PpirtvRuntimePaths {
  const projectRoot = resolveProjectRoot(cwd);
  const expectedHome = path.join(projectRoot, ".ppirtv");
  const configuredHome = env[RUNTIME_ENV.ppirtvHome]?.trim();
  const ppirtvHome = configuredHome ? path.resolve(projectRoot, configuredHome) : expectedHome;
  if (configuredHome && !sameRuntimePath(ppirtvHome, expectedHome)) {
    throw new Error(
      [
        "Invalid PPIRTV_HOME for dex-PPIRTV runtime isolation.",
        `projectRoot: ${projectRoot}`,
        `expected PPIRTV_HOME: ${expectedHome}`,
        `received PPIRTV_HOME: ${ppirtvHome}`,
        "Start the MCP with cwd=<projectRoot> and PPIRTV_HOME=<projectRoot>/.ppirtv, or unset PPIRTV_HOME."
      ].join(" ")
    );
  }
  return runtimePathsFromHome(projectRoot, expectedHome);
}

export function resolveLauncherWorkspace(input: {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  installRoot?: string;
} = {}): LauncherWorkspaceResolution {
  const argv = input.argv ?? [];
  const cwd = resolveProjectRoot(input.cwd ?? process.cwd());
  const env = input.env ?? process.env;
  const installRoot = input.installRoot ? resolveProjectRoot(input.installRoot) : undefined;
  const cliWorkspace = launcherArgValue(argv, "--workspace");
  const envWorkspace = env[RUNTIME_ENV.workspace]?.trim();
  const hint = cliWorkspace || envWorkspace;

  if (hint) {
    const workspace = resolveWorkspaceHint(hint, cwd, env);
    validateLauncherWorkspace(workspace, installRoot, hint);
    return {
      workspace,
      ppirtvHome: path.join(workspace, ".ppirtv"),
      source: cliWorkspace ? "argv" : "env",
      hint
    };
  }

  if (installRoot && sameRuntimePath(cwd, installRoot)) {
    throw new Error(
      [
        "PPIRTV_LAUNCHER_WORKSPACE_REQUIRED:",
        "global launcher started from the install repository without a workspace signal.",
        "Pass --workspace <path-or-folder>, set PPIRTV_WORKSPACE, or start the MCP with cwd=<consumer-project>."
      ].join(" ")
    );
  }

  validateLauncherWorkspace(cwd, installRoot);
  return {
    workspace: cwd,
    ppirtvHome: path.join(cwd, ".ppirtv"),
    source: "cwd"
  };
}

export function runtimePathsFromHome(projectRoot: string, ppirtvHome: string): PpirtvRuntimePaths {
  const resolvedProjectRoot = resolveProjectRoot(projectRoot);
  const resolvedHome = path.resolve(ppirtvHome);
  const dirs = Object.fromEntries(PPIRTV_RUNTIME_DIRS.map((dir) => [dir, path.join(resolvedHome, dir)])) as Record<PpirtvRuntimeDir, string>;
  return {
    projectRoot: resolvedProjectRoot,
    ppirtvHome: resolvedHome,
    dirs,
    ledgerPath: path.join(resolvedHome, "ledger.ndjson")
  };
}

export function resolvePpirtvHome(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  return resolveRuntimePaths(cwd, env).ppirtvHome;
}

export function resolveDexMemoriaHome(cwd = process.cwd()): string {
  return path.resolve(
    process.env[RUNTIME_ENV.dexMemoriaHome] ??
      path.join(process.env[RUNTIME_ENV.userProfile] || process.env[RUNTIME_ENV.home] || cwd, ".agents", "memories")
  );
}

export function resolveConfiguredPrinciplesPath(): string | undefined {
  return process.env[RUNTIME_ENV.principlesPath]?.trim() || undefined;
}

export function resolveUserHome(): string {
  return process.env[RUNTIME_ENV.userProfile] || os.homedir();
}

export function graphifyRecallConfigured(): boolean {
  return booleanFlag(process.env[RUNTIME_ENV.graphifyRecall]);
}

export function graphifyRuntimeConfigFromEnv(): GraphifyRuntimeConfig {
  return {
    enabled: graphifyRecallConfigured(),
    command: process.env[RUNTIME_ENV.graphifyCommand],
    graphPath: process.env[RUNTIME_ENV.graphifyGraphPath],
    timeoutMs: positiveInteger(process.env[RUNTIME_ENV.graphifyTimeoutMs]),
    budget: positiveInteger(process.env[RUNTIME_ENV.graphifyBudget])
  };
}

function booleanFlag(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(value ?? "");
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function sameRuntimePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function launcherArgValue(argv: string[], name: string): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === name) {
      return argv[index + 1]?.trim();
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1).trim();
    }
  }
  return undefined;
}

function resolveWorkspaceHint(hint: string, cwd: string, env: NodeJS.ProcessEnv): string {
  const candidates = workspaceCandidates(hint, cwd, env);
  for (const candidate of candidates) {
    if (isDirectory(candidate)) {
      return resolveProjectRoot(candidate);
    }
  }
  throw new Error(
    [
      "PPIRTV_LAUNCHER_WORKSPACE_NOT_FOUND:",
      `workspace hint '${hint}' did not resolve to an existing directory.`,
      "Use an absolute path, a path relative to cwd, or configure PPIRTV_WORKSPACE_ROOT(S)."
    ].join(" ")
  );
}

function workspaceCandidates(hint: string, cwd: string, env: NodeJS.ProcessEnv): string[] {
  const roots = launcherWorkspaceRoots(cwd, env);
  if (path.isAbsolute(hint)) {
    return [path.resolve(hint)];
  }
  const hasPathSeparator = /[\\/]/.test(hint) || hint === "." || hint === ".." || hint.startsWith(`.${path.sep}`) || hint.startsWith(`..${path.sep}`);
  const relativeCandidates = hasPathSeparator ? [path.resolve(cwd, hint)] : [];
  return [...relativeCandidates, ...roots.map((root) => path.resolve(root, hint))];
}

function launcherWorkspaceRoots(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const roots = [
    ...(env[RUNTIME_ENV.workspaceRoots]?.split(path.delimiter) ?? []),
    env[RUNTIME_ENV.workspaceRoot],
    cwd
  ]
    .filter((root): root is string => Boolean(root?.trim()))
    .map((root) => path.resolve(cwd, root.trim()));
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = comparablePath(root);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function validateLauncherWorkspace(workspace: string, installRoot?: string, hint?: string): void {
  if (!isDirectory(workspace)) {
    throw new Error(`PPIRTV_LAUNCHER_WORKSPACE_NOT_FOUND: workspace is not a directory: ${workspace}`);
  }
  if (installRoot && sameRuntimePath(workspace, installRoot)) {
    throw new Error(
      [
        "PPIRTV_LAUNCHER_INSTALL_ROOT_SELECTED:",
        `workspace resolves to the dex-PPIRTV install repository: ${workspace}.`,
        hint ? `hint: ${hint}.` : "",
        "Select a consumer project instead."
      ].filter(Boolean).join(" ")
    );
  }
  if (!looksLikeProjectRoot(workspace)) {
    throw new Error(
      [
        "PPIRTV_LAUNCHER_WORKSPACE_INVALID:",
        `workspace does not look like a project root: ${workspace}.`,
        "Expected one of .git, AGENTS.md, package.json, .agents or .codex."
      ].join(" ")
    );
  }
}

function looksLikeProjectRoot(workspace: string): boolean {
  return [".git", "AGENTS.md", "package.json", ".agents", ".codex"].some((marker) => isPathPresent(path.join(workspace, marker)));
}

function isDirectory(value: string): boolean {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function isPathPresent(value: string): boolean {
  try {
    statSync(value);
    return true;
  } catch {
    return false;
  }
}

function comparablePath(value: string): string {
  const normalized = canonicalComparablePath(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function canonicalComparablePath(value: string): string {
  const resolved = path.resolve(value);
  const direct = realPathIfExists(resolved);
  if (direct !== resolved) {
    return direct;
  }
  const parent = path.dirname(resolved);
  if (parent === resolved) {
    return resolved;
  }
  return path.join(realPathIfExists(parent), path.basename(resolved));
}

function realPathIfExists(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}
