import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Flow, Phase, AnyPhase } from "../domain.js";
import type { MemoryRecallItem, MemoryRecallSummary } from "./memory-types.js";
import type { MemoryGraphProvider } from "./memory-graph-provider.js";
import { MemoryRuntimeStore } from "./memory-store.js";
import { normalizeTextKey, redactSecretLikeText } from "./mining-policy.js";
import { inspectCanonicalV2Routes, parseV2UnitMetadata, resolvePhysicalCaseEquivalent, selectExactPortableName, type CanonicalV2Route } from "./memory-v2-layout.js";

const MIN_RECALL_TOKEN_LENGTH = 3;
const MAX_RECALL_QUERY_TOKENS = 40;
const MAX_CURATED_FILE_BYTES = 1024 * 1024;
const MAX_LINKED_V2_TARGETS = 8;

export async function beforePhase(input: { flow: Flow; phase: AnyPhase; runtime: MemoryRuntimeStore; graphProvider?: MemoryGraphProvider }): Promise<MemoryRecallSummary> {
  const recalledAt = new Date().toISOString();
  const warnings: string[] = [];
  const query = buildQuery(input.flow, input.phase);
  const runtimeItems = await runtimeRecall(input.runtime, input.flow.flow_id, query, warnings);
  const curatedItems = await curatedRecall(input.flow, query, warnings);
  const graphItems = await graphRecall(input.graphProvider, input.flow, input.phase, warnings);
  const items = [...runtimeItems, ...curatedItems, ...graphItems]
    .sort((a, b) => b.score - a.score || recallItemPriority(b) - recallItemPriority(a))
    .slice(0, 10);
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
    },
    deduped: false
  };
  summary.deduped = !(await input.runtime.recordRecall(summary));
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
  const memoryRoot = path.join(workspace, ".agents");
  const items: MemoryRecallItem[] = [];
  const linkedRoutes: Array<{ route: CanonicalV2Route; triggerScore: number }> = [];

  const l1Name = await physicalMemoryName(memoryRoot, "lembranca.md", warnings);
  if (l1Name) {
    const l1Path = path.join(memoryRoot, l1Name);
    const text = await readCuratedFile(memoryRoot, l1Path, warnings);
    for (const chunk of l1Chunks(text ?? "")) {
      const score = scoreText(chunk, query);
      if (score <= 0) continue;
      items.push({ source: "curated_l1", title: firstLine(chunk), snippet: chunk.slice(0, 320), path: l1Path, score });
      const inspected = inspectCanonicalV2Routes(chunk);
      if (inspected.rejectedHrefs.length > 0) warnings.push("curated_v2_route_rejected");
      if (inspected.routes.length > 1) {
        warnings.push("curated_v2_route_ambiguous");
        continue;
      }
      if (inspected.routes[0]) linkedRoutes.push({ route: inspected.routes[0], triggerScore: score });
    }
  }

  const legacyL2Name = await physicalMemoryName(memoryRoot, "memoria.md", warnings);
  if (legacyL2Name) {
    const legacyPath = path.join(memoryRoot, legacyL2Name);
    const text = await readCuratedFile(memoryRoot, legacyPath, warnings);
    for (const chunk of l2Chunks(text ?? "")) {
      const score = scoreText(chunk, query);
      if (score > 0) items.push({ source: "curated_l2", title: firstLine(chunk), snippet: chunk.slice(0, 320), path: legacyPath, score });
    }
  }

  const dedupedRoutes = new Map<string, { route: CanonicalV2Route; triggerScore: number }>();
  for (const linked of linkedRoutes) {
    const key = `${linked.route.layer}:${linked.route.relativePath}`;
    const previous = dedupedRoutes.get(key);
    if (!previous || linked.triggerScore > previous.triggerScore) dedupedRoutes.set(key, linked);
  }
  const prioritizedRoutes = [...dedupedRoutes.values()]
    .sort((left, right) => right.triggerScore - left.triggerScore || left.route.relativePath.localeCompare(right.route.relativePath))
    .slice(0, MAX_LINKED_V2_TARGETS);
  if (dedupedRoutes.size > MAX_LINKED_V2_TARGETS) warnings.push("curated_v2_targets_truncated");
  for (const linked of prioritizedRoutes) {
    const resolved = await resolveCanonicalTarget(memoryRoot, linked.route.relativePath);
    if (resolved.status !== "ok") {
      warnings.push(resolved.status === "noncanonical_casing" ? "curated_v2_target_noncanonical_casing" : "curated_v2_target_missing");
      continue;
    }
    const targetPath = resolved.path;
    const text = await readCuratedFile(memoryRoot, targetPath, warnings, "curated_v2_target_unreadable");
    if (text === null) continue;
    const metadata = parseV2UnitMetadata(text);
    if (!metadata || metadata.layer !== linked.route.layer || metadata.slug !== linked.route.slug) {
      warnings.push("curated_v2_target_metadata_mismatch");
      continue;
    }
    if (linked.route.layer === "L3" && !metadata.ownerSkill) {
      warnings.push("curated_v2_target_owner_missing");
      continue;
    }
    const content = text.replace(/^---[\s\S]*?---\s*/m, "");
    const score = Math.max(scoreText(text, query), linked.triggerScore);
    items.push({
      source: linked.route.layer === "L3" ? "curated_l3" : "curated_l2",
      title: firstLine(content),
      snippet: content.slice(0, 320),
      path: targetPath,
      score
    });
  }
  if (items.length === 0 && query.length > 0) {
    warnings.push("curated_recall_empty");
  }
  return items;
}

async function physicalMemoryName(memoryRoot: string, expectedName: string, warnings: string[]): Promise<string | null> {
  try {
    return await resolvePhysicalCaseEquivalent(memoryRoot, expectedName);
  } catch (error) {
    warnings.push(errorMessage(error));
    return null;
  }
}

async function readCuratedFile(memoryRoot: string, targetPath: string, warnings: string[], failureWarning?: string): Promise<string | null> {
  try {
    const [physicalRoot, physicalTarget, targetStat] = await Promise.all([realpath(memoryRoot), realpath(targetPath), stat(targetPath)]);
    const relative = path.relative(physicalRoot, physicalTarget);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !targetStat.isFile()) {
      warnings.push("curated_recall_boundary_rejected");
      return null;
    }
    if (targetStat.size > MAX_CURATED_FILE_BYTES) {
      warnings.push("curated_recall_file_too_large");
      return null;
    }
    return await readFile(physicalTarget, "utf8");
  } catch {
    if (failureWarning) warnings.push(failureWarning);
    return null;
  }
}

async function resolveCanonicalTarget(memoryRoot: string, relativePath: string): Promise<{ status: "ok"; path: string } | { status: "missing" | "noncanonical_casing" }> {
  let current = memoryRoot;
  for (const segment of relativePath.split("/")) {
    const entries = await readdirNames(current);
    try {
      const selected = selectExactPortableName(entries, segment);
      if (!selected) return { status: "missing" };
      current = path.join(current, selected);
    } catch {
      return { status: "noncanonical_casing" };
    }
  }
  return { status: "ok", path: current };
}

function recallItemPriority(item: MemoryRecallItem): number {
  if (item.source === "curated_l3") return 3;
  if (item.source === "curated_l2") return item.path && path.basename(item.path).toLowerCase() === "memoria.md" ? 1 : 3;
  return item.source === "curated_l1" ? 2 : 0;
}

async function readdirNames(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true })).map((entry) => entry.name);
  } catch {
    return [];
  }
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
