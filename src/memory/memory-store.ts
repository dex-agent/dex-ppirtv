import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryRecallSummary, MemoryRuntimeRecord } from "./memory-types.js";
import { redactSecretLikeText } from "./mining-policy.js";

type RuntimeStream = "recalls" | "hooks" | "candidates" | "parking-lot";

export class MemoryRuntimeStore {
  readonly memoryDir: string;

  constructor(readonly runtimeRoot: string) {
    this.memoryDir = path.join(runtimeRoot, "memory");
  }

  async init(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
  }

  async append(stream: RuntimeStream, record: MemoryRuntimeRecord): Promise<void> {
    await this.init();
    await appendFile(this.streamPath(stream), `${JSON.stringify(scrubRuntimeValue(record))}\n`, "utf8");
  }

  async read(stream: RuntimeStream, limit = 25): Promise<MemoryRuntimeRecord[]> {
    await this.init();
    let text = "";
    try {
      text = await readFile(this.streamPath(stream), "utf8");
    } catch {
      return [];
    }
    const records = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MemoryRuntimeRecord)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return records.slice(Math.max(0, records.length - limit));
  }

  async recordRecall(summary: MemoryRecallSummary): Promise<void> {
    await this.append("recalls", {
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
