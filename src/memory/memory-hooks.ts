import path from "node:path";
import type { MemoryHookInput, MemoryHookRunner, MemoryHookSummary, MemoryRecallInput, MemoryRecallSummary } from "./memory-types.js";
import { MemoryRuntimeStore, runtimeRecordId } from "./memory-store.js";
import { beforePhase } from "./memory-recall.js";
import { classifyMemoryCandidate, collectMemoryNuggets, resolveDexMemoriaHome } from "./mining-policy.js";

export class MemoryLibrarian implements MemoryHookRunner {
  readonly runtime: MemoryRuntimeStore;

  constructor(runtimeRoot: string) {
    this.runtime = new MemoryRuntimeStore(runtimeRoot);
  }

  async beforePhase(input: MemoryRecallInput): Promise<MemoryRecallSummary> {
    return beforePhase({ ...input, runtime: this.runtime });
  }

  async afterPhase(input: MemoryHookInput): Promise<MemoryHookSummary> {
    const recordedAt = new Date().toISOString();
    const workspace = path.resolve(input.flow.goal_binding?.envelope.workspace ?? process.cwd());
    const dexMemoriaHome = resolveDexMemoriaHome();
    const nuggets = collectMemoryNuggets(input.flow, input.meetings ?? []);
    const candidates = nuggets.map((nugget, index) =>
      classifyMemoryCandidate({
        id: `hook_${index + 1}`,
        item: nugget.item,
        source: nugget.source,
        evidenceScore: nugget.evidenceScore,
        workspace,
        dexMemoriaHome
      })
    );
    const parking = candidates.filter((candidate) => candidate.scope === "estacionamento" || candidate.scope === "ledger_only");

    for (const candidate of candidates) {
      await this.runtime.append("candidates", {
        id: runtimeRecordId("candidate", input.flow.flow_id, `${recordedAt}_${candidate.id}`),
        flow_id: input.flow.flow_id,
        phase: input.phase,
        type: "candidate",
        created_at: recordedAt,
        data: {
          candidate_id: candidate.id,
          title: candidate.title,
          source: candidate.source,
          scope: candidate.scope,
          confidence: candidate.confidence,
          blocked: candidate.blocked,
          blocked_reason: candidate.blocked_reason
        }
      });
    }

    for (const item of input.flow.parking_lot) {
      await this.runtime.append("parking-lot", {
        id: runtimeRecordId("parking", input.flow.flow_id, `${recordedAt}_${item}`),
        flow_id: input.flow.flow_id,
        phase: input.phase,
        type: "parking",
        created_at: recordedAt,
        data: {
          item,
          prepared_for_mining: true
        }
      });
    }

    const summary: MemoryHookSummary = {
      flow_id: input.flow.flow_id,
      phase: input.phase,
      recorded_at: recordedAt,
      candidates_count: candidates.length,
      parking_count: parking.length,
      warnings: []
    };
    await this.runtime.append("hooks", {
      id: runtimeRecordId("hook", input.flow.flow_id, recordedAt),
      flow_id: input.flow.flow_id,
      phase: input.phase,
      type: "hook",
      created_at: recordedAt,
      data: {
        candidates_count: summary.candidates_count,
        parking_count: summary.parking_count,
        prepared_for_mining: true,
        promoted_curated_memory: false
      }
    });
    return summary;
  }
}
