import type { Flow, Meeting, Phase, AnyPhase } from "../domain.js";

export type MemorySource = "runtime" | "curated_l1" | "curated_l2" | "curated_l3" | "graphify";

export type MemoryRecallItem = {
  source: MemorySource;
  title: string;
  snippet: string;
  path?: string;
  score: number;
  question?: string;
  destination?: "recall_hint";
  observation?: string;
};

export type MemoryRecallSummary = {
  flow_id: string;
  phase: AnyPhase;
  recalled_at: string;
  items: MemoryRecallItem[];
  warnings: string[];
  deduped?: boolean;
  visual_status: {
    librarian: "disabled" | "recalled" | "empty" | "missing_graph" | "timeout" | "failed";
    graphify: "disabled" | "recalled" | "empty" | "missing_graph" | "timeout" | "failed";
  };
};

export type MemoryRuntimeRecord = {
  id: string;
  flow_id: string;
  phase: AnyPhase;
  type: "recall" | "hook" | "candidate" | "parking";
  created_at: string;
  data: Record<string, unknown>;
};

export type MemoryHookSummary = {
  flow_id: string;
  phase: AnyPhase;
  recorded_at: string;
  candidates_count: number;
  parking_count: number;
  warnings: string[];
};

export type MemoryHookInput = {
  flow: Flow;
  phase: AnyPhase;
  meetings?: Meeting[];
};

export type MemoryRecallInput = {
  flow: Flow;
  phase: AnyPhase;
};

export type MemoryHookRunner = {
  beforePhase(input: MemoryRecallInput): Promise<MemoryRecallSummary>;
  afterPhase(input: MemoryHookInput): Promise<MemoryHookSummary>;
};

export type MemoryNugget = {
  item: string;
  source: "gold_mining" | "parking_lot";
  evidenceScore: number;
};
