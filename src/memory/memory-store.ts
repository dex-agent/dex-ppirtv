import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryRecallSummary, MemoryRuntimeRecord } from "./memory-types.js";
import { redactSecretLikeText } from "./mining-policy.js";

type RuntimeStream = "recalls" | "hooks" | "candidates" | "parking-lot";

export class MemoryRuntimeStore {
  readonly memoryDir: string;
  private readonly signatureCache = new Map<RuntimeStream, Set<string>>();

  constructor(readonly runtimeRoot: string) {
    this.memoryDir = path.join(runtimeRoot, "memory");
  }

  async init(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
  }

  async append(stream: RuntimeStream, record: MemoryRuntimeRecord): Promise<void> {
    await this.init();
    const prepared = scrubRuntimeValue(record) as MemoryRuntimeRecord;
    await appendFile(this.streamPath(stream), `${JSON.stringify(prepared)}\n`, "utf8");
    this.signatureCache.get(stream)?.add(runtimeRecordSignature(prepared));
  }

  async appendUnique(stream: RuntimeStream, record: MemoryRuntimeRecord): Promise<boolean> {
    await this.init();
    const prepared = scrubRuntimeValue(record) as MemoryRuntimeRecord;
    const signature = runtimeRecordSignature(prepared);
    const signatures = await this.signatures(stream);
    if (signatures.has(signature)) {
      return false;
    }
    await appendFile(this.streamPath(stream), `${JSON.stringify(prepared)}\n`, "utf8");
    signatures.add(signature);
    return true;
  }

  async read(stream: RuntimeStream, limit = 25): Promise<MemoryRuntimeRecord[]> {
    const records = (await this.readAll(stream)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    return records.slice(Math.max(0, records.length - limit));
  }

  async recordRecall(summary: MemoryRecallSummary): Promise<boolean> {
    return this.appendUnique("recalls", {
      id: runtimeRecordId("recall", summary.flow_id, summary.recalled_at),
      flow_id: summary.flow_id,
      phase: summary.phase,
      type: "recall",
      created_at: summary.recalled_at,
      data: {
        recalled_count: summary.items.length,
        items: summary.items,
        warnings: summary.warnings
      }
    });
  }

  private async readAll(stream: RuntimeStream): Promise<MemoryRuntimeRecord[]> {
    await this.init();
    let text = "";
    try {
      text = await readFile(this.streamPath(stream), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MemoryRuntimeRecord);
  }

  private async signatures(stream: RuntimeStream): Promise<Set<string>> {
    const cached = this.signatureCache.get(stream);
    if (cached) {
      return cached;
    }
    const signatures = new Set((await this.readAll(stream)).map(runtimeRecordSignature));
    this.signatureCache.set(stream, signatures);
    return signatures;
  }

  streamPath(stream: RuntimeStream): string {
    return path.join(this.memoryDir, `${stream}.jsonl`);
  }
}

export function runtimeRecordId(prefix: string, flowId: string, seed: string): string {
  const compactSeed = seed
    .replace(/[-:.TZ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${prefix}_${compactSeed}_${flowId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48)}`;
}

function runtimeRecordSignature(record: MemoryRuntimeRecord): string {
  const data = record.data;
  if (record.type === "recall") {
    return stableSignature({
      type: record.type,
      flow_id: record.flow_id,
      items: normalizeRecallItems(data.items),
      warnings: normalizeStringArray(data.warnings)
    });
  }
  if (record.type === "candidate") {
    return stableSignature({
      type: record.type,
      flow_id: record.flow_id,
      title: data.title,
      source: data.source,
      scope: data.scope,
      blocked: data.blocked,
      blocked_reason: data.blocked_reason
    });
  }
  if (record.type === "parking") {
    return stableSignature({
      type: record.type,
      flow_id: record.flow_id,
      item: data.item
    });
  }
  return stableSignature({
    type: record.type,
    flow_id: record.flow_id,
    phase: record.phase,
    data
  });
}

function normalizeRecallItems(items: unknown): unknown {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const value = item as Record<string, unknown>;
    return {
      source: value.source,
      title: value.title,
      snippet: value.snippet,
      path: value.path,
      score: value.score,
      destination: value.destination,
      observation: value.observation
    };
  });
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).sort() : [];
}

function stableSignature(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSignature).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSignature(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function scrubRuntimeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecretLikeText(value);
  }
  if (Array.isArray(value)) {
    return value.map(scrubRuntimeValue);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/secret|token|password|api[_-]?key|authorization/i.test(key)) {
        result[key] = "[redacted]";
      } else {
        result[key] = scrubRuntimeValue(nested);
      }
    }
    return result;
  }
  return value;
}
