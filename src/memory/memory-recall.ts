import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Flow, Phase } from "../domain.js";
import type { MemoryRecallItem, MemoryRecallSummary } from "./memory-types.js";
import { MemoryRuntimeStore } from "./memory-store.js";
import { normalizeTextKey } from "./mining-policy.js";

export async function beforePhase(input: { flow: Flow; phase: Phase; runtime: MemoryRuntimeStore }): Promise<MemoryRecallSummary> {
  const recalledAt = new Date().toISOString();
  const warnings: string[] = [];
  const query = buildQuery(input.flow, input.phase);
  const runtimeItems = await runtimeRecall(input.runtime, input.flow.flow_id, query, warnings);
  const curatedItems = await curatedRecall(input.flow, query, warnings);
  const items = [...runtimeItems, ...curatedItems].sort((a, b) => b.score - a.score).slice(0, 10);
  const summary: MemoryRecallSummary = {
    flow_id: input.flow.flow_id,
    phase: input.phase,
    recalled_at: recalledAt,
    items,
    warnings
  };
  await input.runtime.recordRecall(summary);
  return summary;
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

function buildQuery(flow: Flow, phase: Phase): string[] {
  return tokenize([phase, flow.goal, flow.context, ...flow.risks, ...flow.uncertainties, ...flow.tasks, ...flow.decisions].filter(Boolean).join(" "));
}

function tokenize(value: string): string[] {
  const stop = new Set(["para", "com", "sem", "uma", "por", "the", "and", "que", "de", "do", "da"]);
  return normalizeTextKey(value)
    .split(/[^a-z0-9_-]+/i)
    .filter((token) => token.length >= 3 && !stop.has(token))
    .slice(0, 40);
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
