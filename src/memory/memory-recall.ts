import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Flow, Phase, AnyPhase } from "../domain.js";
import type { MemoryRecallItem, MemoryRecallSummary } from "./memory-types.js";
import type { MemoryGraphProvider } from "./memory-graph-provider.js";
import { MemoryRuntimeStore } from "./memory-store.js";
import { normalizeTextKey, redactSecretLikeText } from "./mining-policy.js";

const MIN_RECALL_TOKEN_LENGTH = 3;
const MAX_RECALL_QUERY_TOKENS = 40;

export async function beforePhase(input: { flow: Flow; phase: AnyPhase; runtime: MemoryRuntimeStore; graphProvider?: MemoryGraphProvider }): Promise<MemoryRecallSummary> {
  const recalledAt = new Date().toISOString();
  const warnings: string[] = [];
  const query = buildQuery(input.flow, input.phase);
  const runtimeItems = await runtimeRecall(input.runtime, input.flow.flow_id, query, warnings);
  const curatedItems = await curatedRecall(input.flow, query, warnings);
  const graphItems = await graphRecall(input.graphProvider, input.flow, input.phase, warnings);
  const items = [...runtimeItems, ...curatedItems, ...graphItems].sort((a, b) => b.score - a.score).slice(0, 10);
  const graphifyStatus = graphifyStatusFrom(warnings, graphItems.length);
  const summary: MemoryRecallSummary = {
    flow_id: input.flow.flow_id,
    phase: input.phase,
    recalled_at: recalledAt,
    items,
    warnings,
    visual_status: {
      librarian: librarianStatusFrom(warnings, items.length, graphifyStatus),
      graphify: graphifyStatus
    }
  };
  await input.runtime.recordRecall(summary);
  return summary;
}

function graphifyStatusFrom(warnings: string[], graphItemsCount: number): MemoryRecallSummary["visual_status"]["graphify"] {
  if (warnings.some((warning) => warning.startsWith("graphify_recalled:")) || graphItemsCount > 0) {
    return "recalled";
  }
  if (warnings.some((warning) => warning.startsWith("graphify_timeout:"))) {
    return "timeout";
  }
  if (warnings.some((warning) => warning.startsWith("graphify_graph_missing:"))) {
    return "missing_graph";
  }
  if (warnings.some((warning) => warning.startsWith("graphify_query_failed:") || warning.startsWith("graphify_recall_failed:"))) {
    return "failed";
  }
  if (warnings.some((warning) => warning.startsWith("graphify_recall_empty"))) {
    return "empty";
  }
  return "disabled";
}

function librarianStatusFrom(
  warnings: string[],
  itemCount: number,
  graphifyStatus: MemoryRecallSummary["visual_status"]["graphify"]
): MemoryRecallSummary["visual_status"]["librarian"] {
  if (itemCount > 0) {
    return "recalled";
  }
  if (warnings.some((warning) => warning.includes("_failed") || warning.includes("failed:"))) {
    return "failed";
  }
  if (graphifyStatus === "missing_graph" || graphifyStatus === "timeout" || graphifyStatus === "failed") {
    return graphifyStatus;
  }
  return warnings.length > 0 ? "empty" : "disabled";
}

async function graphRecall(provider: MemoryGraphProvider | undefined, flow: Flow, phase: AnyPhase, warnings: string[]): Promise<MemoryRecallItem[]> {
  if (!provider) {
    return [];
  }
  const workspace = path.resolve(flow.goal_binding?.envelope.workspace ?? process.cwd());
  try {
    const result = await provider.recall({
      flow_id: flow.flow_id,
      phase,
      question: buildGraphQuestion(flow, phase),
      workspace
    });
    warnings.push(...result.warnings.map(redactSecretLikeText));
    const items = result.items.slice(0, 3).map((item) => ({
      source: item.source,
      title: redactSecretLikeText(item.title).slice(0, 120),
      snippet: redactSecretLikeText(item.observation).slice(0, 180),
      path: item.path ? redactSecretLikeText(item.path).slice(0, 220) : undefined,
      score: item.score,
      question: redactSecretLikeText(item.question).slice(0, 320),
      destination: item.destination,
      observation: redactSecretLikeText(item.observation).slice(0, 180)
    }));
    if (items.length > 0) {
      warnings.push(`graphify_recalled: ${items.length}`);
    } else if (!warnings.some((warning) => /^graphify_(recalled|timeout|graph_missing|query_failed|recall_failed|recall_empty)/.test(warning))) {
      warnings.push("graphify_recall_empty");
    }
    return items;
  } catch (error) {
    warnings.push(`graphify_recall_failed: ${redactSecretLikeText(errorMessage(error))}`);
    return [];
  }
}

async function runtimeRecall(runtime: MemoryRuntimeStore, flowId: string, query: string[], warnings: string[]): Promise<MemoryRecallItem[]> {
  try {
    const streams = await Promise.all([runtime.read("hooks", 20), runtime.read("candidates", 20), runtime.read("parking-lot", 20)]);
    return streams
      .flat()
      .filter((record) => record.flow_id === flowId)
      .map((record) => {
        const snippet = JSON.stringify(record.data).slice(0, 280);
        return {
          source: "runtime" as const,
          title: `${record.type} ${record.phase}`,
          snippet,
          score: scoreText(snippet, query) + 1
        };
      })
      .filter((item) => item.score > 1)
      .slice(-10);
  } catch (error) {
    warnings.push(`runtime_recall_failed: ${errorMessage(error)}`);
    return [];
  }
}

async function curatedRecall(flow: Flow, query: string[], warnings: string[]): Promise<MemoryRecallItem[]> {
  const workspace = path.resolve(flow.goal_binding?.envelope.workspace ?? process.cwd());
  const candidates = [
    { source: "curated_l1" as const, path: path.join(workspace, ".agents", "LEMBRANCA.md") },
    { source: "curated_l2" as const, path: path.join(workspace, ".agents", "MEMORIA.md") }
  ];
  const items: MemoryRecallItem[] = [];
  for (const candidate of candidates) {
    let text = "";
    try {
      text = await readFile(candidate.path, "utf8");
    } catch {
      continue;
    }
    const chunks = candidate.source === "curated_l1" ? l1Chunks(text) : l2Chunks(text);
    for (const chunk of chunks) {
      const score = scoreText(chunk, query);
      if (score > 0) {
        items.push({
          source: candidate.source,
          title: firstLine(chunk),
          snippet: chunk.slice(0, 320),
          path: candidate.path,
          score
        });
      }
    }
  }
  if (items.length === 0 && query.length > 0) {
    warnings.push("curated_recall_empty");
  }
  return items;
}

function buildQuery(flow: Flow, phase: AnyPhase): string[] {
  return tokenize([phase, flow.goal, flow.context, ...flow.risks, ...flow.uncertainties, ...flow.tasks, ...flow.decisions].filter(Boolean).join(" "));
}

function buildGraphQuestion(flow: Flow, phase: AnyPhase): string {
  return [phase, flow.goal, flow.context, ...flow.risks, ...flow.uncertainties, ...flow.tasks, ...flow.decisions]
    .filter(Boolean)
    .join(" ")
    .slice(0, 320);
}

function tokenize(value: string): string[] {
  const stop = new Set(["para", "com", "sem", "uma", "por", "the", "and", "que", "de", "do", "da"]);
  return normalizeTextKey(value)
    .split(/[^a-z0-9_-]+/i)
    .filter((token) => token.length >= MIN_RECALL_TOKEN_LENGTH && !stop.has(token))
    .slice(0, MAX_RECALL_QUERY_TOKENS);
}

function scoreText(value: string, query: string[]): number {
  const normalized = normalizeTextKey(value);
  return query.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0);
}

function l1Chunks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || line.startsWith("* ") || /^\[[^\]]+\]/.test(line));
}

function l2Chunks(text: string): string[] {
  return text
    .split(/\n(?=##\s+)/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.replace(/^[-*]\s*/, "").replace(/^##\s*/, "").trim().slice(0, 96) || "memory";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
