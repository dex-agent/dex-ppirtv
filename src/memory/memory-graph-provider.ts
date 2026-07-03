import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { Phase, AnyPhase } from "../domain.js";
import { assertNoSecretLikeText, redactSecretLikeText } from "./mining-policy.js";

export type MemoryGraphSource = "graphify";

export type MemoryGraphQuery = {
  flow_id: string;
  phase: AnyPhase;
  question: string;
  workspace: string;
};

export type MemoryGraphHit = {
  source: MemoryGraphSource;
  question: string;
  title: string;
  path?: string;
  observation: string;
  destination: "recall_hint";
  score: number;
};

export type MemoryGraphResult = {
  flow_id: string;
  phase: AnyPhase;
  queried_at: string;
  items: MemoryGraphHit[];
  warnings: string[];
};

export type MemoryGraphProvider = {
  recall(input: MemoryGraphQuery): Promise<MemoryGraphResult>;
};

export type GraphifyCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

export type GraphifyCommandRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number }
) => Promise<GraphifyCommandResult>;

export type GraphifyRecallProviderOptions = {
  enabled?: boolean;
  command?: string;
  graphPath?: string;
  timeoutMs?: number;
  budget?: number;
  runner?: GraphifyCommandRunner;
};

export class NullMemoryGraphProvider implements MemoryGraphProvider {
  async recall(input: MemoryGraphQuery): Promise<MemoryGraphResult> {
    return emptyGraphResult(input, []);
  }
}

export class GraphifyRecallProvider implements MemoryGraphProvider {
  private readonly enabled: boolean;
  private readonly command: string;
  private readonly graphPath: string;
  private readonly timeoutMs: number;
  private readonly budget: number;
  private readonly runner: GraphifyCommandRunner;

  constructor(options: GraphifyRecallProviderOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.command = options.command ?? "graphify";
    this.graphPath = options.graphPath ?? path.join("graphify-out", "graph.json");
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.budget = options.budget ?? 1000;
    this.runner = options.runner ?? runGraphifyCommand;
  }

  async recall(input: MemoryGraphQuery): Promise<MemoryGraphResult> {
    if (!this.enabled) {
      return emptyGraphResult(input, []);
    }

    const workspace = path.resolve(input.workspace);
    const graphPath = path.resolve(workspace, this.graphPath);
    const rawQuestion = input.question.slice(0, 320);
    const warnings: string[] = [];

    try {
      assertNoSecretLikeText(rawQuestion, "graphify_question");
    } catch (error) {
      return emptyGraphResult(input, [`graphify_question_blocked: ${errorMessage(error)}`]);
    }
    const question = redactSecretLikeText(rawQuestion);

    try {
      await access(graphPath);
    } catch {
      return emptyGraphResult(input, [`graphify_graph_missing: ${safePath(graphPath, workspace)}`]);
    }

    const args = ["query", question, "--graph", graphPath, "--budget", String(this.budget)];
    const result = await runSafely(() => this.runner(this.command, args, { cwd: workspace, timeoutMs: this.timeoutMs }), warnings);

    if (!result) {
      return emptyGraphResult(input, warnings);
    }
    if (result.timedOut) {
      warnings.push(`graphify_timeout: ${this.timeoutMs}ms`);
      return emptyGraphResult(input, warnings);
    }
    if (result.exitCode !== 0) {
      warnings.push(`graphify_query_failed: ${redactSecretLikeText(firstLine(result.stderr) || `exit_${result.exitCode}`)}`);
      return emptyGraphResult(input, warnings);
    }

    const items = parseGraphifyNodes(result.stdout, question, workspace);
    if (items.length === 0) {
      warnings.push("graphify_recall_empty");
    }

    return {
      flow_id: input.flow_id,
      phase: input.phase,
      queried_at: new Date().toISOString(),
      items,
      warnings
    };
  }
}

export function parseGraphifyNodes(stdout: string, question: string, workspace: string): MemoryGraphHit[] {
  const hits: MemoryGraphHit[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^NODE\s+(.+?)\s+\[src=([^\]]*?)\s+loc=([^\]]*?)(?:\s+community=.*)?\]$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const title = redactSecretLikeText(match[1]?.trim() ?? "").slice(0, 120);
    const src = match[2]?.trim();
    const loc = match[3]?.trim();
    if (!title || !src) {
      continue;
    }
    hits.push({
      source: "graphify",
      question,
      title,
      path: safePath(src, workspace),
      observation: redactSecretLikeText(loc ? `Graphify node at ${loc}` : "Graphify node").slice(0, 160),
      destination: "recall_hint",
      score: Math.max(1, 12 - hits.length)
    });
    if (hits.length >= 8) {
      break;
    }
  }
  return hits;
}

async function runGraphifyCommand(command: string, args: readonly string[], options: { cwd: string; timeoutMs: number }): Promise<GraphifyCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk).slice(0, 24_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk).slice(0, 4_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

async function runSafely<T>(fn: () => Promise<T>, warnings: string[]): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    warnings.push(`graphify_query_failed: ${redactSecretLikeText(errorMessage(error))}`);
    return null;
  }
}

function emptyGraphResult(input: MemoryGraphQuery, warnings: string[]): MemoryGraphResult {
  return {
    flow_id: input.flow_id,
    phase: input.phase,
    queried_at: new Date().toISOString(),
    items: [],
    warnings
  };
}

function safePath(value: string, workspace: string): string {
  const normalized = path.normalize(value);
  const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(workspace, normalized);
  const relative = path.relative(workspace, absolute);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, "/");
  }
  return path.basename(normalized);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim().slice(0, 160) ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
