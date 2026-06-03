import os from "node:os";
import path from "node:path";

export const RUNTIME_ENV = {
  dexMemoriaHome: "DEX_MEMORIA_HOME",
  graphifyBudget: "PPIRTV_GRAPHIFY_BUDGET",
  graphifyCommand: "PPIRTV_GRAPHIFY_COMMAND",
  graphifyGraphPath: "PPIRTV_GRAPHIFY_GRAPH_PATH",
  graphifyRecall: "PPIRTV_GRAPHIFY_RECALL",
  graphifyTimeoutMs: "PPIRTV_GRAPHIFY_TIMEOUT_MS",
  home: "HOME",
  ppirtvHome: "PPIRTV_HOME",
  principlesPath: "PPIRTV_PRINCIPLES_PATH",
  userProfile: "USERPROFILE"
} as const;

export const FISCAL_CONFIG = {
  maxRegressions: 3
} as const;

export type GraphifyRuntimeConfig = {
  enabled: boolean;
  command?: string;
  graphPath?: string;
  timeoutMs?: number;
  budget?: number;
};

export function resolvePpirtvHome(cwd = process.cwd()): string {
  return process.env[RUNTIME_ENV.ppirtvHome] ?? path.join(cwd, ".ppirtv");
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
