import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { classifyMemoryCandidate } from "../src/memory/mining-policy.js";
import type { DexMemoriaV2CanonicalReceipt, DexMemoriaV2ExecutionInput, DexMemoriaV2Executor, DexMemoriaV2FlowWriterConfig, DexMemoriaV2MiningClassification, DexMemoriaV2OperationRequest } from "../src/memory/dex-memoria-v2-adapter.js";
import { PpirtvStore } from "../src/store.js";

const TEST_TAGS: [string, ...string[]] = ["#dex-memoria/ppirtv-v2"];

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

describe("FlowEngine Dex Memoria V2 producer-consumer seam", () => {
  it("deduplicates the same meeting learning across findings and turns while preserving provenance", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-meeting-semantic-dedupe-"));
    const engine = new FlowEngine(configuredStore(), undefined, {
      memory_writer: configuredWriter({ execute: vi.fn() })
    });
    const flow = await engine.createFlow({ goal: "Deduplicar aprendizado material da reunião" });
    const meeting = await engine.openMeeting({
      flow_id: flow.flow_id,
      type: "divergent",
      question: "Qual aprendizado precisa sobreviver?"
    });
    await engine.addMeetingTurn({
      meeting_id: meeting.meeting_id,
      speaker: "revisor-codigo",
      finding: "Fixtures sintéticas e receipts somente não provam a jornada real."
    });

    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    }) as any;

    expect(mined.candidates).toHaveLength(1);
    expect(mined.candidates[0]).toMatchObject({
      item: "Achado de reuniao: Fixtures sintéticas e receipts somente não provam a jornada real.",
      provenance: expect.arrayContaining([
        expect.objectContaining({ kind: "meeting.finding", meeting_id: meeting.meeting_id }),
        expect.objectContaining({ kind: "meeting.turn.finding", meeting_id: meeting.meeting_id })
      ])
    });
  });

  it("keeps materially different meeting learnings separate", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-meeting-no-over-dedupe-"));
    const engine = new FlowEngine(configuredStore(), undefined, {
      memory_writer: configuredWriter({ execute: vi.fn() })
    });
    const flow = await engine.createFlow({ goal: "Preservar diferenças materiais entre aprendizados" });
    const meeting = await engine.openMeeting({
      flow_id: flow.flow_id,
      type: "divergent",
      question: "Qual diferença muda a decisão?"
    });
    await engine.addMeetingTurn({
      meeting_id: meeting.meeting_id,
      speaker: "revisor-codigo",
      finding: "Fixtures sintéticas não provam a jornada real."
    });
    await engine.addMeetingTurn({
      meeting_id: meeting.meeting_id,
      speaker: "questionador",
      finding: "Fixtures sintéticas provam a jornada real."
    });

    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    }) as any;

    expect(mined.candidates).toHaveLength(2);
    expect(mined.candidates.map((candidate: any) => candidate.item)).toEqual(expect.arrayContaining([
      "Achado de reuniao: Fixtures sintéticas não provam a jornada real.",
      "Achado de reuniao: Fixtures sintéticas provam a jornada real."
    ]));
  });

  it("promotes ordinary unresolved candidates through the public contract without hiding L3 metadata", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-public-promote-"));
    const executedOperationIds = new Set<string>();
    const executor = {
      execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
        const deduplicated = executedOperationIds.has(input.operation_request.operation_id);
        executedOperationIds.add(input.operation_request.operation_id);
        return committedReceipt(input.operation_request, input.candidate, deduplicated);
      })
    };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Promover candidato cotidiano sem metadado oculto" });
    flow.gold_mining = [
      "Memória local deste projeto: validar receipts antes de declarar pronto.",
      "Conhecimento operacional que ainda precisa de destino humano."
    ];
    await store.saveFlow(flow);

    const initial = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" }) as any;
    const unresolved = initial.candidates.find((candidate: any) => candidate.classification_reason === "destinations_required");

    expect(initial).toMatchObject({
      written_count: 1,
      memory_written: true,
      memory_validated: false,
      blocked_verdict: true,
      unclassified: 1,
      strong_unwritten_count: 1,
      blocked_count: 1
    });

    const beforeInvalidPromotion = await store.loadFlow(flow.flow_id);
    await expect(engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [unresolved.candidate_id],
      action: "promote",
      density: "light",
      tags: TEST_TAGS,
      rationale: "Destino ausente não pode ser adivinhado."
    } as any)).rejects.toThrow("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED");
    await expect(engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [unresolved.candidate_id],
      action: "promote",
      target_scope: "projeto",
      rationale: "Aprendizado operacional aprovado para a memória local."
    })).rejects.toThrow("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED");
    expect((await store.loadFlow(flow.flow_id)).memory_candidate_resolutions)
      .toEqual(beforeInvalidPromotion.memory_candidate_resolutions);

    const lightResolutionInput = {
      flow_id: flow.flow_id,
      candidate_ids: [unresolved.candidate_id],
      action: "promote",
      target_scope: "projeto",
      density: "light",
      tags: TEST_TAGS,
      rationale: "Aprendizado operacional aprovado para a memória local."
    } as const;
    const promoted = await engine.resolveMemoryCandidates(lightResolutionInput as any) as any;

    expect(promoted).toMatchObject({
      application_status: "applied",
      memory_mining: {
        written_count: 2,
        memory_written: true,
        memory_validated: true,
        strong_unwritten_count: 0,
        blocked_verdict: false
      }
    });
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({
        target_layer: "L2",
        tags: TEST_TAGS
      })
    }));
    const reloadedEngine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const replayed = await reloadedEngine.resolveMemoryCandidates(lightResolutionInput as any) as any;
    const afterReplay = await store.loadFlow(flow.flow_id);
    expect(replayed.memory_mining.v2_receipts).toHaveLength(2);
    expect(replayed.memory_mining.v2_failures).toEqual([]);
    expect(replayed.memory_mining.v2_validation_receipts).toHaveLength(2);
    expect(replayed.memory_mining.written).toHaveLength(2);
    expect(replayed.memory_mining).toMatchObject({
      written_count: 2,
      memory_validated: true,
      blocked_verdict: false
    });
    expect(afterReplay.memory_candidate_resolutions).toHaveLength(1);
    expect(replayed.memory_mining.v2_receipts).toEqual([
      expect.objectContaining({ route_receipts: { project: expect.objectContaining({ deduplicated: true }) } }),
      expect.objectContaining({ route_receipts: { project: expect.objectContaining({ deduplicated: true }) } })
    ]);

    const deepFlow = await engine.createFlow({ goal: "Promover conhecimento profundo com owner explícito" });
    deepFlow.gold_mining = ["Conhecimento profundo que precisa de owner e rota governada."];
    await store.saveFlow(deepFlow);
    const deepInitial = await engine.mineMemory({ flow_id: deepFlow.flow_id, write_policy: "auto_write" }) as any;
    const deepCandidateId = deepInitial.candidates[0].candidate_id as string;

    const deepBefore = await store.loadFlow(deepFlow.flow_id);
    await expect(engine.resolveMemoryCandidates({
      flow_id: deepFlow.flow_id,
      candidate_ids: [deepCandidateId],
      action: "promote",
      target_scope: "projeto",
      density: "deep",
      tags: TEST_TAGS,
      rationale: "Conhecimento profundo aprovado sem owner."
    } as any)).rejects.toThrow("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED");
    expect((await store.loadFlow(deepFlow.flow_id)).memory_candidate_resolutions)
      .toEqual(deepBefore.memory_candidate_resolutions);

    const explicitDeepFlow = await engine.createFlow({ goal: "Promover L3 por contrato público explícito" });
    explicitDeepFlow.gold_mining = ["Conhecimento profundo explícito que precisa de owner e rota governada."];
    await store.saveFlow(explicitDeepFlow);
    const explicitDeepInitial = await engine.mineMemory({ flow_id: explicitDeepFlow.flow_id, write_policy: "auto_write" }) as any;
    const explicitDeepCandidateId = explicitDeepInitial.candidates[0].candidate_id as string;

    const explicitDeep = await engine.resolveMemoryCandidates({
      flow_id: explicitDeepFlow.flow_id,
      candidate_ids: [explicitDeepCandidateId],
      action: "promote",
      target_scope: "projeto",
      density: "deep",
      owner_skill: "dex-memoria",
      tags: TEST_TAGS,
      rationale: "Conhecimento profundo com owner e tags explícitos."
    } as any) as any;

    expect(explicitDeep).toMatchObject({
      application_status: "applied",
      memory_mining: {
        candidate_resolutions: [expect.objectContaining({
          candidate_density: "deep",
          candidate_owner_skill: "dex-memoria",
          candidate_tags: TEST_TAGS
        })]
      }
    });
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({
        target_layer: "L3",
        owner_skill: "dex-memoria",
        tags: TEST_TAGS
      })
    }));
  });

  it("rejects explicit metadata that conflicts with an already classified V2 candidate before mutation", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-classified-metadata-conflict-"));
    const executor = {
      execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) =>
        committedReceipt(input.operation_request, input.candidate)
      )
    };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, {
      memory_writer: configuredWriter(executor, {
        default_classification: {
          status: "resolved",
          density: "deep",
          owner_skill: "dex-memoria",
          tags: TEST_TAGS,
          requested_destinations: [{ scope: "project" }]
        }
      })
    });
    const flow = await engine.createFlow({ goal: "Impedir reclassificação silenciosa de candidato V2" });
    flow.gold_mining = ["Conhecimento profundo já classificado e governado."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" }) as any;
    const before = await store.loadFlow(flow.flow_id);

    await expect(engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [mined.candidates[0].candidate_id],
      action: "promote",
      target_scope: "projeto",
      density: "light",
      tags: ["#dex-memoria/outro-destino"],
      rationale: "Tentativa conflitante não pode substituir a classificação."
    } as any)).rejects.toThrow("MEMORY_CANDIDATE_PROMOTION_METADATA_CONFLICT");

    expect(await store.loadFlow(flow.flow_id)).toEqual(before);
    await expect(engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [mined.candidates[0].candidate_id],
      action: "promote",
      target_scope: "global",
      rationale: "Destino conflitante também não pode substituir a classificação."
    })).rejects.toThrow("MEMORY_CANDIDATE_PROMOTION_DESTINATION_CONFLICT");
    expect(await store.loadFlow(flow.flow_id)).toEqual(before);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("reuses the complete classified V2 destination set when promotion omits overrides", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-classified-destinations-"));
    const executor = {
      execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) =>
        committedReceipt(input.operation_request, input.candidate)
      )
    };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, {
      memory_writer: configuredWriter(executor, {
        default_classification: {
          status: "resolved",
          density: "deep",
          owner_skill: "dex-memoria",
          tags: TEST_TAGS,
          requested_destinations: [{ scope: "project" }, { scope: "global" }]
        }
      })
    });
    const flow = await engine.createFlow({ goal: "Preservar classificação dual já decidida" });
    flow.gold_mining = ["Conhecimento profundo já classificado para projeto e global."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;

    await engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale: "A promoção deve respeitar a classificação dual persistida."
    });
    const replayed = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" }) as any;

    expect(replayed).toMatchObject({
      blocked_verdict: false,
      candidate_resolutions: [expect.objectContaining({
        candidate_id: candidateId,
        candidate_destinations: [{ scope: "project" }, { scope: "global" }]
      })]
    });
    expect(executor.execute).toHaveBeenCalledWith({
      operation_request: expect.objectContaining({ scope: "dual" }),
      candidate: expect.objectContaining({
        target_layer: "L3",
        owner_skill: "dex-memoria",
        tags: TEST_TAGS
      })
    });
    const resolutionHistory = (await store.loadFlow(flow.flow_id)).history
      .filter((event) => event.type === "memory_candidates_resolved");
    expect(resolutionHistory).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          target_scope: null,
          candidate_destinations: [{
            candidate_id: candidateId,
            destinations: [{ scope: "project" }, { scope: "global" }]
          }]
        })
      })
    ]);
  });

  it("treats an equal explicit classified destination and its omitted override as one logical resolution", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-classified-destination-idempotency-"));
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, {
      memory_writer: configuredWriter({ execute: vi.fn() }, {
        default_classification: {
          status: "resolved",
          density: "light",
          tags: TEST_TAGS,
          requested_destinations: [{ scope: "project" }]
        }
      })
    });
    const flow = await engine.createFlow({ goal: "Normalizar destino classificado semanticamente igual" });
    flow.gold_mining = ["Regra de projeto classificada antes da resolução."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;
    const rationale = "A mesma decisão efetiva não pode duplicar resolução.";

    await engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      target_scope: "projeto",
      rationale
    });
    await engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale
    });

    const persisted = await store.loadFlow(flow.flow_id);
    expect(persisted.memory_candidate_resolutions).toHaveLength(1);
    expect(persisted.history.filter((event) => event.type === "memory_candidates_resolved")).toHaveLength(1);
    expect((await store.readLedger(flow.flow_id)).filter((event) => event.type === "memory_candidates_resolved")).toHaveLength(1);
  });

  it("fails closed after reload when a persisted V2 promotion has no effective destination", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-missing-persisted-destination-"));
    const executor = { execute: vi.fn() };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, {
      memory_writer: configuredWriter(executor, {
        default_classification: {
          status: "resolved",
          density: "light",
          tags: TEST_TAGS,
          requested_destinations: [{ scope: "project" }]
        }
      })
    });
    const flow = await engine.createFlow({ goal: "Falhar fechado sem destino V2 persistido" });
    flow.gold_mining = ["Regra classificada cujo destino persistido será corrompido na fixture."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" }) as any;
    await engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [mined.candidates[0].candidate_id],
      action: "promote",
      rationale: "Persistir a decisão antes da corrupção sintética."
    });
    const corrupted = await store.loadFlow(flow.flow_id);
    delete (corrupted.memory_candidate_resolutions![0] as any).candidate_destinations;
    delete (corrupted.memory_candidate_resolutions![0] as any).target_scope;
    await store.saveFlow(corrupted);

    await expect(new FlowEngine(store, undefined, {
      memory_writer: configuredWriter(executor)
    }).mineMemory({
      flow_id: flow.flow_id,
      write_policy: "auto_write"
    })).rejects.toThrow("persisted V2 promotion destinations are incomplete");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("preserves the legacy V1 global classification while V2 uses contextual scope intent", () => {
    const candidate = classifyMemoryCandidate({
      id: "legacy-global-no-shrink",
      item: "Regra global: sempre validar contratos antes da publicação.",
      source: "gold_mining",
      evidenceScore: 2,
      workspace: path.resolve("synthetic-workspace"),
      dexMemoriaHome: path.resolve("synthetic-memory-home")
    });

    expect(candidate.scope).toBe("global");
  });
  it("makes resolved producer classifications complete by construction", () => {
    const unresolved: DexMemoriaV2MiningClassification = { status: "unresolved", reason: "classifier_unavailable" };
    const resolved: DexMemoriaV2MiningClassification = {
      status: "resolved", density: "light", requested_destinations: [{ scope: "project" }], tags: TEST_TAGS
    };
    // @ts-expect-error resolved classification requires non-empty destinations
    const missingDestinations: DexMemoriaV2MiningClassification = { status: "resolved", density: "light", tags: TEST_TAGS };
    // @ts-expect-error resolved classification requires non-empty tags
    const missingTags: DexMemoriaV2MiningClassification = { status: "resolved", density: "light", requested_destinations: [{ scope: "project" }] };
    // @ts-expect-error deep resolved classification requires owner_skill
    const missingOwner: DexMemoriaV2MiningClassification = { status: "resolved", density: "deep", requested_destinations: [{ scope: "project" }], tags: TEST_TAGS };

    expect(unresolved.status).toBe("unresolved");
    expect(resolved.status).toBe("resolved");
    void missingDestinations; void missingTags; void missingOwner;
  });
  it("classifies an explicit everyday project-memory intent without hidden V2 directives", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-everyday-project-"));
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => committedReceipt(input.operation_request, input.candidate)) };
    const engine = new FlowEngine(configuredStore(), undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Gravar aprendizado local deste projeto" });
    flow.gold_mining = ["Memória local do projeto: sempre validar o workspace antes de gravar."];
    await engine.store.saveFlow(flow);

    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" });

    expect(executor.execute).toHaveBeenCalledOnce();
    expect(mined).toMatchObject({
      memory_profile: "v2",
      v2_status: "complete",
      blocked_verdict: false,
      memory_written: true,
      unclassified: 0,
      candidates: [{ destinations: [{ scope: "project" }], route: { trigger: "L1", target: "L2" } }]
    });
    const checkout = await engine.goalCheckout({ flow_id: flow.flow_id, detail: "full" }) as any;
    expect(checkout.memory_accountability).toMatchObject({
      written_count: 1,
      memory_validated: true,
      l1_files: expect.arrayContaining([expect.stringMatching(/lembranca\.md$/i)]),
      l2_files: expect.arrayContaining([expect.stringMatching(/[\\/]memorias[\\/][^\\/]+\.md$/i)]),
      layers: { other: [] }
    });
    expect(checkout.memory_accountability.summary).toContain("gravada e validada");
    expect(checkout.memory_accountability.summary).not.toContain("aguardando/pendente de validacao");
  });

  it("returns an unresolved classify_only candidate without writing", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-unresolved-classify-"));
    const executor = { execute: vi.fn() };
    const engine = new FlowEngine(configuredStore(), undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Classificar sem inventar escopo" });
    flow.gold_mining = ["Conhecimento que ainda precisa de roteamento humano."];
    await engine.store.saveFlow(flow);

    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(mined).toMatchObject({
      v2_status: "classify_only",
      memory_written: false,
      blocked_verdict: true,
      unclassified: 1,
      candidates: [{ classification_status: "unresolved", classification_reason: "destinations_required", destinations: [] }]
    });
  });

  it.each([
    ["Memória global reutilizável em qualquer projeto.", [{ scope: "global" }]],
    ["Memória local deste projeto e também global cross-project.", [{ scope: "project" }, { scope: "global" }]],
    ["Memória global: nunca nomear uma variável local HOME.", [{ scope: "global" }]],
    ["Estado global neste projeto deve ser reinicializado com segurança.", [{ scope: "project" }]]
  ])("distinguishes everyday project/global destinations from intent: %s", async (item, destinations) => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-everyday-scope-"));
    const executor = { execute: vi.fn() };
    const engine = new FlowEngine(configuredStore(), undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Classificar destino cotidiano V2" });
    flow.gold_mining = [item];
    await engine.store.saveFlow(flow);

    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(mined).toMatchObject({ unclassified: 0, candidates: [{ destinations }] });
  });

  it("keeps long everyday slugs unique with a deterministic candidate suffix", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-long-slug-"));
    const engine = new FlowEngine(configuredStore(), undefined, { memory_writer: configuredWriter({ execute: vi.fn() }) });
    const prefix = `Memória local deste projeto ${"a".repeat(90)}`;
    const slugs: string[] = [];
    for (const suffix of ["primeira", "segunda"]) {
      const flow = await engine.createFlow({ goal: `Classificar slug ${suffix}` });
      flow.gold_mining = [`${prefix} ${suffix}`];
      await engine.store.saveFlow(flow);
      const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only" }) as any;
      slugs.push(mined.candidates[0].slug);
    }

    expect(new Set(slugs)).toHaveLength(2);
    expect(slugs.every((slug) => slug.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))).toBe(true);
  });

  it("derives stable candidate and operation identities from content, not flow or array position", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-content-id-"));
    const engine = new FlowEngine(configuredStore(), undefined, { memory_writer: configuredWriter({ execute: vi.fn() }) });
    const firstFlow = await engine.createFlow({ goal: "Primeira ordem" });
    firstFlow.gold_mining = ["Item vizinho.", "Regra de identidade estavel."];
    await engine.store.saveFlow(firstFlow);
    const secondFlow = await engine.createFlow({ goal: "Segunda ordem" });
    secondFlow.gold_mining = ["Regra de identidade estavel.", "Item vizinho."];
    await engine.store.saveFlow(secondFlow);

    const first = await engine.mineMemory({ flow_id: firstFlow.flow_id, write_policy: "classify_only" }) as any;
    const second = await engine.mineMemory({ flow_id: secondFlow.flow_id, write_policy: "classify_only" }) as any;
    const firstCandidate = first.candidates.find((candidate: any) => candidate.item === "Regra de identidade estavel.");
    const secondCandidate = second.candidates.find((candidate: any) => candidate.item === "Regra de identidade estavel.");

    expect(firstCandidate.candidate_id).toMatch(/^mc_[a-f0-9]{24}$/);
    expect(firstCandidate.candidate_id).toBe(secondCandidate.candidate_id);
    expect(firstCandidate.operation_id).toBe(secondCandidate.operation_id);
    expect(firstCandidate.flow_id).toBe(firstFlow.flow_id);
    expect(secondCandidate.flow_id).toBe(secondFlow.flow_id);
  });

  it("keeps item trace identity stable but separates operation identity by material route, tags and destination", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-material-id-"));
    const engine = new FlowEngine(configuredStore(), undefined, { memory_writer: configuredWriter({ execute: vi.fn() }) });
    const variants = [
      { v2_density: "light" as const, v2_tags: ["#dex-memoria/rota-a"], v2_destinations: [{ scope: "project" as const }] },
      { v2_density: "deep" as const, v2_owner_skill: "dex-memoria", v2_tags: ["#dex-memoria/rota-a"], v2_destinations: [{ scope: "project" as const }] },
      { v2_density: "light" as const, v2_tags: ["#dex-memoria/rota-b"], v2_destinations: [{ scope: "project" as const }] },
      { v2_density: "light" as const, v2_tags: ["#dex-memoria/rota-a"], v2_destinations: [{ scope: "global" as const }] }
    ];
    const candidates = [] as any[];
    for (const [index, variant] of variants.entries()) {
      const flow = await engine.createFlow({ goal: `Variante material ${index}` });
      flow.gold_mining = ["Mesmo conteúdo, unidade material diferente."];
      await engine.store.saveFlow(flow);
      const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "classify_only", ...variant }) as any;
      candidates.push(mined.candidates[0]);
    }

    expect(new Set(candidates.map((candidate) => candidate.candidate_id))).toHaveLength(1);
    expect(new Set(candidates.map((candidate) => candidate.operation_id))).toHaveLength(variants.length);
    expect(candidates.every((candidate) => !candidate.operation_id.includes(candidate.flow_id))).toBe(true);
  });

  it("selects the injected canonical executor and never calls the legacy append writer", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-"));
    const legacyCandidateWriter = vi.fn().mockRejectedValue(new Error("legacy writer must not run"));
    const executor = {
      execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => committedReceipt(input.operation_request, input.candidate))
    };
    const engine = new FlowEngine(configuredStore(), undefined, {
      memory_writer: configuredWriter(executor, {
        classify: () => ({ status: "resolved", density: "deep", owner_skill: "dex-memoria", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }, { scope: "global" }] })
      }),
      legacy_candidate_writer: legacyCandidateWriter
    });
    const flow = await engine.createFlow({ goal: "Produzir memoria V2 por adapter" });
    flow.gold_mining = ["Regra profunda confirmada com exemplos e anti-exemplos."];
    await engine.store.saveFlow(flow);

    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" });

    expect(executor.execute).toHaveBeenCalledOnce();
    expect(legacyCandidateWriter).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledWith({
      operation_request: expect.objectContaining({ contract: "dex.memory.operation.request.v2", scope: "dual" }),
      candidate: expect.objectContaining({ contract: "dex.memory.write.candidate.v2", target_layer: "L3", owner_skill: "dex-memoria" })
    });
    expect(mined).toMatchObject({
      memory_profile: "v2",
      v2_status: "complete",
      memory_validated: true,
      written_count: 1,
      written: [{
        candidate_id: expect.stringMatching(/^mc_[a-f0-9]{24}$/),
        files: expect.arrayContaining([
          await realpath(path.join(tempRoot, "workspace", ".agents", "lembranca.md")),
          await realpath(path.join(tempRoot, "memory-home", "global", "LEMBRANCA.md"))
        ])
      }],
      v2_receipts: [{
        contract: "dex.memory.operation.receipt.v2",
        status: "COMMITTED",
        route_receipts: { project: { status: "COMMITTED" }, global: { status: "COMMITTED" } }
      }]
    });
    const checkout = await engine.goalCheckout({ flow_id: flow.flow_id, detail: "full" }) as any;
    expect(checkout.memory_accountability).toMatchObject({
      written_count: 1,
      memory_validated: true,
      l1_files: expect.arrayContaining([expect.stringMatching(/lembranca\.md$/i)]),
      l3_files: expect.arrayContaining([expect.stringMatching(/[\\/]conhecimento[\\/][^\\/]+[\\/]README\.md$/i)]),
      layers: { other: [] }
    });
    expect(checkout.memory_accountability.summary).toContain("gravada e validada");
    expect(checkout.memory_accountability.summary).not.toContain("aguardando/pendente de validacao");
    await expect(access(path.join(tempRoot, "workspace", ".ppirtv", ".agents", "LEMBRANCA.md"))).rejects.toThrow();
  });

  it("persists PARTIAL_PENDING and consumes it through canonical resume", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-resume-"));
    let request: DexMemoriaV2OperationRequest | undefined;
    const executor = {
      execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
        request = input.operation_request;
        return partialReceipt(input.operation_request, input.candidate);
      }),
      resume: vi.fn().mockImplementation(async (_receipt, candidate) => committedReceipt(request!, candidate))
    };
    const engine = new FlowEngine(configuredStore(), undefined, {
      memory_writer: configuredWriter(executor, {
        classify: () => ({ status: "resolved", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }, { scope: "global" }] })
      })
    });
    const flow = await engine.createFlow({ goal: "Retomar sibling de memoria V2" });
    flow.gold_mining = ["Regra recorrente confirmada para dois destinos."];
    await engine.store.saveFlow(flow);

    const first = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" });
    const resumed = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" });

    expect(first).toMatchObject({ v2_status: "resume_pending_sibling", blocked_verdict: true, v2_pending_destinations: [{ scope: "global" }] });
    expect(resumed).toMatchObject({ v2_status: "complete", blocked_verdict: false, memory_validated: true });
    expect(executor.execute).toHaveBeenCalledOnce();
    expect(executor.resume).toHaveBeenCalledOnce();
  });

  it("keeps classify_only non-writing when the V2 selector is injected", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-classify-"));
    const executor = { execute: vi.fn() };
    const engine = new FlowEngine(configuredStore(), undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Classificar memoria V2 sem escrever" });
    flow.gold_mining = ["Regra global cross-project para projetos Delphi."];
    await engine.store.saveFlow(flow);

    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }, { scope: "global" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(mined).toMatchObject({
      memory_profile: "v2",
      v2_status: "classify_only",
      memory_written: false,
      candidates: [{ destinations: [{ scope: "project" }, { scope: "global" }], route: { trigger: "L1", target: "L2" } }]
    });
  });

  it.each([
    ["accept_ledger_only", "ledger_only", "ledger_only_count"],
    ["park", "estacionamento", "estacionamento_count"],
    ["discard", "discarded", "discarded_count"]
  ] as const)("applies %s semantically after reload", async (action, resultField, countField) => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-candidate-resolve-"));
    const executor = { execute: vi.fn() };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: `Resolver candidato V2 com ${action}` });
    flow.gold_mining = [`Regra local para acao ${action}.`];
    await engine.store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;
    const resolutionInput = {
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action,
      rationale: `Decisao rastreavel para ${action}.`,
      ...(action === "park" ? { when: "Quando o owner revisar este aprendizado." } : {})
    };

    const first = await engine.resolveMemoryCandidates(resolutionInput) as any;
    const repeated = await engine.resolveMemoryCandidates(resolutionInput) as any;
    const reloaded = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const replayed = await reloaded.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" }) as any;
    const persisted = await store.loadFlow(flow.flow_id);
    const resolutionLedgerEvents = (await store.readLedger(flow.flow_id))
      .filter((event) => event.type === "memory_candidates_resolved");

    expect(first.resolved).toEqual([expect.objectContaining({ candidate_id: candidateId, action, traceable: true })]);
    expect(repeated.resolved).toEqual(first.resolved);
    expect(persisted.memory_candidate_resolutions).toHaveLength(1);
    expect(resolutionLedgerEvents).toHaveLength(1);
    expect(resolutionLedgerEvents[0].data.resolutions).toEqual([
      expect.objectContaining({ candidate_id: candidateId, action })
    ]);
    expect(replayed).toMatchObject({
      resolved_candidate_ids: [candidateId],
      candidate_resolutions: [expect.objectContaining({ candidate_id: candidateId, action })],
      [resultField]: [candidateId],
      [countField]: 1,
      blocked_verdict: false
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["projeto", undefined, "project"],
    ["global", undefined, "global"],
    ["tema", "engenharia", "theme"]
  ] as const)("promotes %s through the explicit V2 destination translation", async (targetScope, theme, expectedScope) => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-promote-"));
    let executionCount = 0;
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      executionCount += 1;
      return committedReceipt(input.operation_request, input.candidate, executionCount > 1);
    }) };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: `Promover candidato V2 para ${targetScope}` });
    flow.gold_mining = [`Conhecimento profundo seguro para ${targetScope}.`];
    await engine.store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only"
    }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;

    const resolutionInput = {
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      target_scope: targetScope,
      ...(theme ? { theme } : {}),
      density: "deep",
      owner_skill: "dex-memoria",
      tags: TEST_TAGS,
      rationale: `Promocao segura para ${targetScope}.`
    } as const;
    const registered = await engine.resolveMemoryCandidates(resolutionInput) as any;
    expect(registered).toMatchObject({
      application_status: "pending",
      applied_resolutions: [],
      pending_resolutions: [expect.objectContaining({ candidate_id: candidateId })],
      memory_mining: {
        written_count: 0,
        memory_validated: false,
        strong_unwritten_count: 1,
        blocked_verdict: true
      }
    });
    const reloaded = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const replayed = await reloaded.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" }) as any;
    const removedDestination = replayed.written[0].files.at(-1) as string;
    await rm(removedDestination);
    const repeated = await reloaded.resolveMemoryCandidates(resolutionInput) as any;
    const persisted = await store.loadFlow(flow.flow_id);

    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(executor.execute).toHaveBeenCalledWith({
      operation_request: expect.objectContaining({
        scope: expectedScope,
        ...(theme ? { theme } : {})
      }),
      candidate: expect.objectContaining({
        target_layer: "L3",
        owner_skill: "dex-memoria",
        tags: TEST_TAGS
      })
    });
    expect(replayed).toMatchObject({
      resolved_candidate_ids: [candidateId],
      candidate_resolutions: [expect.objectContaining({
        candidate_id: candidateId,
        action: "promote",
        target_scope: targetScope,
        candidate_tags: TEST_TAGS,
        candidate_density: "deep",
        candidate_owner_skill: "dex-memoria"
      })],
      written_count: 1,
      blocked_verdict: false
    });
    expect(repeated).toMatchObject({
      application_status: "applied",
      applied_resolutions: [expect.objectContaining({ candidate_id: candidateId })],
      pending_resolutions: [],
      memory_mining: {
        written_count: 1,
        memory_validated: true,
        blocked_verdict: false,
        v2_receipts: [{
          route_receipts: {
            [expectedScope]: expect.objectContaining({ deduplicated: true })
          }
        }]
      }
    });
    await expect(access(removedDestination)).resolves.toBeUndefined();
    expect(persisted.memory_candidate_resolutions).toHaveLength(1);
  });

  it("validates every effective identity before mutation and accepts a coherent hybrid", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-candidate-identity-"));
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter({ execute: vi.fn() }) });
    const flow = await engine.createFlow({ goal: "Validar coleção de identidades antes de resolver" });
    flow.gold_mining = ["Regra local para identidade invalida."];
    await engine.store.saveFlow(flow);
    await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    });
    const persisted = await engine.store.loadFlow(flow.flow_id);
    persisted.memory_mining!.candidates = [{ id: "mc_hybrid", candidate_id: "mc_hybrid" }];
    await engine.store.saveFlow(persisted);

    await expect(engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: ["mc_hybrid"],
      action: "discard",
      rationale: "Identidade hibrida coerente continua valida."
    })).resolves.toMatchObject({ resolved: [{ candidate_id: "mc_hybrid" }] });

    const invalidCollections = [
      [{ candidate_id: "" }, { candidate_id: "mc_valid" }],
      [{ id: "mc_legacy", candidate_id: "mc_v2" }, { candidate_id: "mc_valid" }],
      [{ id: "mc_same", candidate_id: " mc_same " }, { candidate_id: "mc_valid" }],
      [{ id: "mc_duplicate" }, { candidate_id: "mc_duplicate" }]
    ];
    const expectedErrors = [
      "MEMORY_CANDIDATE_IDENTITY_REQUIRED",
      "MEMORY_CANDIDATE_IDENTITY_CONFLICT",
      "MEMORY_CANDIDATE_IDENTITY_CONFLICT",
      "MEMORY_CANDIDATE_IDENTITY_DUPLICATE"
    ];
    for (const [index, candidates] of invalidCollections.entries()) {
      const before = await store.loadFlow(flow.flow_id);
      const priorResolutionCount = before.memory_candidate_resolutions?.length ?? 0;
      before.memory_mining!.candidates = candidates;
      await store.saveFlow(before);
      await expect(engine.resolveMemoryCandidates({
        flow_id: flow.flow_id,
        candidate_ids: ["mc_valid"],
        action: "discard",
        rationale: "Colecao invalida deve falhar fechada."
      })).rejects.toThrow(expectedErrors[index]);
      const after = await store.loadFlow(flow.flow_id);
      expect(after.memory_candidate_resolutions).toHaveLength(priorResolutionCount);
    }

    const validAgain = await store.loadFlow(flow.flow_id);
    validAgain.memory_mining!.candidates = [{ candidate_id: "mc_valid" }];
    await store.saveFlow(validAgain);
    await expect(engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: ["mc_unknown"],
      action: "discard",
      rationale: "ID desconhecido deve continuar rejeitado."
    })).rejects.toThrow("Unknown memory candidate ids: mc_unknown");
  });

  it("rejects an unsafe V2 promotion before persisting and reports integrated writer failure without false success", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-promote-failure-"));
    const executor = {
      execute: vi.fn()
        .mockImplementationOnce(async (input: DexMemoriaV2ExecutionInput) => committedReceipt(input.operation_request, input.candidate))
        .mockRejectedValue(new Error("synthetic writer failure"))
    };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Falhar promoção V2 de forma segura" });
    flow.gold_mining = ["Conhecimento profundo que exige metadados completos."];
    await engine.store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }],
      v2_density: "deep",
      v2_owner_skill: "dex-memoria",
      v2_tags: TEST_TAGS
    }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;
    const unsafe = await store.loadFlow(flow.flow_id);
    delete (unsafe.memory_mining!.candidates[0] as any).tags;
    await store.saveFlow(unsafe);

    await expect(engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      target_scope: "global",
      rationale: "Sem tags a promoção deve falhar antes de persistir."
    })).rejects.toThrow("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED");
    expect((await store.loadFlow(flow.flow_id)).memory_candidate_resolutions ?? []).toHaveLength(0);

    await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "auto_write",
      v2_destinations: [{ scope: "project" }],
      v2_density: "deep",
      v2_owner_skill: "dex-memoria",
      v2_tags: TEST_TAGS
    });
    const failed = await engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale: "Promoção válida cuja execução seguinte falhará."
    }) as any;
    expect(failed).toMatchObject({
      application_status: "pending",
      applied_resolutions: [],
      pending_resolutions: [expect.objectContaining({ candidate_id: candidateId })],
      memory_mining: {
        written_count: 0,
        memory_written: false,
        memory_validated: false,
        blocked_verdict: true,
        v2_status: "partial_pending",
        v2_failures: [expect.objectContaining({ message: "synthetic writer failure" })]
      }
    });
  });

  it("restores the flow without an orphan resolution ledger event when remine throws", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-resolution-rollback-"));
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter({ execute: vi.fn() }) });
    const flow = await engine.createFlow({ goal: "Restaurar resolução quando remine falhar" });
    flow.gold_mining = ["Regra local cuja resolução precisa ser atômica."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    }) as any;
    const before = await store.loadFlow(flow.flow_id);
    const ledgerBefore = await store.readLedger(flow.flow_id);
    vi.spyOn(engine as any, "mineMemoryUnlocked").mockRejectedValueOnce(new Error("synthetic remine failure"));

    await expect(engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [mined.candidates[0].candidate_id],
      action: "discard",
      rationale: "Falha de persistência deve restaurar o snapshot."
    })).rejects.toThrow("synthetic remine failure");

    const after = await store.loadFlow(flow.flow_id);
    const ledgerAfter = await store.readLedger(flow.flow_id);
    expect(after.memory_candidate_resolutions).toEqual(before.memory_candidate_resolutions);
    expect(after.history).toEqual(before.history);
    expect(after.memory_mining).toEqual(before.memory_mining);
    expect(ledgerAfter).toEqual(ledgerBefore);
  });

  it("reconciles an append-then-throw resolution ledger boundary without duplicating the event", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-resolution-ledger-recovery-"));
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter({ execute: vi.fn() }) });
    const flow = await engine.createFlow({ goal: "Recuperar fronteira ambigua do ledger" });
    flow.gold_mining = ["Regra local cuja decisão precisa de ledger exato uma vez."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    }) as any;
    const originalAppendLedger = store.appendLedger.bind(store);
    let injected = false;
    store.appendLedger = async (event) => {
      await originalAppendLedger(event);
      if (!injected && event.type === "memory_candidates_resolved") {
        injected = true;
        throw new Error("synthetic append-then-throw");
      }
    };

    await expect(engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [mined.candidates[0].candidate_id],
      action: "accept_ledger_only",
      rationale: "A reconciliação deve reconhecer o append concluído."
    })).resolves.toMatchObject({ application_status: "applied" });

    const events = (await store.readLedger(flow.flow_id)).filter((event) => event.type === "memory_candidates_resolved");
    expect(events).toHaveLength(1);
  });

  it("preserves a COMMITTED writer result when memory_mined fails before append and completes exactly once after reload", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-mined-ledger-retry-"));
    let executionCount = 0;
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      executionCount += 1;
      if (executionCount === 1) throw new Error("synthetic pre-commit writer failure");
      return committedReceipt(input.operation_request, input.candidate, executionCount > 2);
    }) };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Recuperar commit do writer antes do ledger" });
    flow.gold_mining = ["Conhecimento profundo cuja promoção precisa sobreviver à falha do ledger."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "auto_write",
      v2_destinations: [{ scope: "project" }],
      v2_density: "deep",
      v2_owner_skill: "dex-memoria",
      v2_tags: TEST_TAGS
    }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;
    const resolutionInput = {
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale: "A decisão e o receipt COMMITTED devem permanecer recuperáveis."
    } as const;
    const originalAppendLedger = store.appendLedger.bind(store);
    const originalSaveFlow = store.saveFlow.bind(store);
    let injected = false;
    let pendingSaveInjected = false;
    store.appendLedger = async (event) => {
      if (!injected && event.type === "memory_mined") {
        injected = true;
        throw new Error("synthetic memory_mined pre-append failure");
      }
      await originalAppendLedger(event);
    };
    store.saveFlow = async (candidateFlow) => {
      const mining = candidateFlow.memory_mining as any;
      if (!pendingSaveInjected && mining?.v2_status === "partial_pending" && mining?.v2_ledger_status === "pending") {
        pendingSaveInjected = true;
        throw new Error("synthetic pending recovery save failure");
      }
      await originalSaveFlow(candidateFlow);
    };

    const pending = await engine.resolveMemoryCandidates(resolutionInput) as any;
    const persistedPending = await store.loadFlow(flow.flow_id);

    expect(pending).toMatchObject({
      application_status: "pending",
      applied_resolutions: [],
      pending_resolutions: [expect.objectContaining({ candidate_id: candidateId })],
      memory_mining: {
        v2_ledger_status: "pending",
        blocked_verdict: true,
        v2_receipts: [expect.objectContaining({ status: "COMMITTED" })]
      }
    });
    expect(persistedPending.memory_candidate_resolutions).toHaveLength(1);
    expect(persistedPending.memory_mining).toMatchObject({
      v2_ledger_status: "pending",
      blocked_verdict: true,
      v2_receipts: [expect.objectContaining({ status: "COMMITTED" })]
    });
    const reconciliationId = pending.memory_mining.v2_reconciliation_id as string;

    store.appendLedger = originalAppendLedger;
    store.saveFlow = originalSaveFlow;
    const reloaded = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const retried = await reloaded.resolveMemoryCandidates(resolutionInput) as any;
    const persistedRetried = await store.loadFlow(flow.flow_id);
    const minedResolutionEvents = (await store.readLedger(flow.flow_id)).filter((event) =>
      event.type === "memory_mined"
      && Array.isArray(event.data.candidate_resolutions)
      && event.data.candidate_resolutions.length > 0
    );

    expect(retried).toMatchObject({
      application_status: "applied",
      pending_resolutions: [],
      memory_mining: {
        v2_ledger_status: "confirmed",
        v2_reconciliation_id: reconciliationId,
        blocked_verdict: false,
        v2_receipts: [{
          route_receipts: {
            project: expect.objectContaining({ deduplicated: true })
          }
        }]
      }
    });
    expect(executor.execute).toHaveBeenCalledTimes(3);
    expect(minedResolutionEvents).toHaveLength(1);
    expect(persistedRetried.memory_candidate_resolutions).toHaveLength(1);
    expect(persistedRetried.history.filter((event) =>
      event.type === "memory_mined" && event.data.v2_reconciliation_id === reconciliationId
    )).toHaveLength(1);
  });

  it("recognizes memory_mined append-then-throw by reconciliation identity without duplicating the logical event", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-mined-ledger-ambiguous-"));
    let executionCount = 0;
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      executionCount += 1;
      if (executionCount === 1) throw new Error("synthetic pre-commit writer failure");
      return committedReceipt(input.operation_request, input.candidate);
    }) };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Reconciliar append ambíguo de memory_mined" });
    flow.gold_mining = ["Conhecimento profundo com ledger de mineração exato uma vez."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "auto_write",
      v2_destinations: [{ scope: "project" }],
      v2_density: "deep",
      v2_owner_skill: "dex-memoria",
      v2_tags: TEST_TAGS
    }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;
    const originalAppendLedger = store.appendLedger.bind(store);
    let injected = false;
    store.appendLedger = async (event) => {
      await originalAppendLedger(event);
      if (!injected && event.type === "memory_mined" && Array.isArray(event.data.candidate_resolutions) && event.data.candidate_resolutions.length > 0) {
        injected = true;
        throw new Error("synthetic memory_mined append-then-throw");
      }
    };

    const resolved = await engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale: "O evento gravado deve vencer o erro ambíguo."
    }) as any;
    const minedResolutionEvents = (await store.readLedger(flow.flow_id)).filter((event) =>
      event.type === "memory_mined"
      && Array.isArray(event.data.candidate_resolutions)
      && event.data.candidate_resolutions.length > 0
    );

    expect(resolved).toMatchObject({
      application_status: "applied",
      memory_mining: {
        v2_ledger_status: "confirmed",
        blocked_verdict: false
      }
    });
    expect(minedResolutionEvents).toHaveLength(1);
    expect(minedResolutionEvents[0].data.v2_reconciliation_id).toEqual(expect.any(String));
  });

  it("keeps COMMITTED receipts recoverable when the pre-append ledger read fails", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-mined-ledger-read-failure-"));
    let executionCount = 0;
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      executionCount += 1;
      if (executionCount === 1) throw new Error("synthetic pre-commit writer failure");
      return committedReceipt(input.operation_request, input.candidate, executionCount > 2);
    }) };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Preservar commit quando leitura do ledger falhar" });
    flow.gold_mining = ["Conhecimento profundo que não pode ser apagado por falha de leitura do ledger."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "auto_write",
      v2_destinations: [{ scope: "project" }],
      v2_density: "deep",
      v2_owner_skill: "dex-memoria",
      v2_tags: TEST_TAGS
    }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;
    const resolutionInput = {
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale: "Falha de leitura não autoriza rollback pós-COMMITTED."
    } as const;
    const originalReadLedger = store.readLedger.bind(store);
    let injected = false;
    store.readLedger = async (flowId) => {
      if (!injected) {
        injected = true;
        throw new Error("synthetic memory_mined ledger read failure");
      }
      return originalReadLedger(flowId);
    };

    const pending = await engine.resolveMemoryCandidates(resolutionInput) as any;
    const persisted = await store.loadFlow(flow.flow_id);

    expect(pending).toMatchObject({
      application_status: "pending",
      applied_resolutions: [],
      memory_mining: {
        v2_ledger_status: "pending",
        blocked_verdict: true,
        v2_receipts: [expect.objectContaining({ status: "COMMITTED" })],
        v2_failures: [expect.objectContaining({ message: "synthetic memory_mined ledger read failure" })]
      }
    });
    expect(persisted.memory_candidate_resolutions).toHaveLength(1);
    expect(persisted.memory_mining).toMatchObject({
      v2_ledger_status: "pending",
      blocked_verdict: true,
      v2_receipts: [expect.objectContaining({ status: "COMMITTED" })]
    });

    store.readLedger = originalReadLedger;
    const reloaded = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    await expect(reloaded.resolveMemoryCandidates(resolutionInput)).resolves.toMatchObject({
      application_status: "applied",
      memory_mining: { v2_ledger_status: "confirmed", blocked_verdict: false }
    });
  });

  it("persists a blocked COMMITTED recovery state when saveFlow fails after the writer returns", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-mined-flow-save-failure-"));
    let executionCount = 0;
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      executionCount += 1;
      if (executionCount === 1) throw new Error("synthetic pre-commit writer failure");
      return committedReceipt(input.operation_request, input.candidate, executionCount > 2);
    }) };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Preservar commit quando saveFlow falhar" });
    flow.gold_mining = ["Conhecimento profundo cujo receipt precisa sobreviver a uma falha de saveFlow."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "auto_write",
      v2_destinations: [{ scope: "project" }],
      v2_density: "deep",
      v2_owner_skill: "dex-memoria",
      v2_tags: TEST_TAGS
    }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;
    const resolutionInput = {
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale: "Falha pós-COMMITTED deve produzir recuperação bloqueada."
    } as const;
    const originalSaveFlow = store.saveFlow.bind(store);
    let injected = false;
    store.saveFlow = async (candidateFlow) => {
      const v2Receipts = (candidateFlow.memory_mining as any)?.v2_receipts;
      if (!injected && Array.isArray(v2Receipts) && v2Receipts.some((receipt) => receipt.status === "COMMITTED")) {
        injected = true;
        throw new Error("synthetic post-COMMITTED saveFlow failure");
      }
      await originalSaveFlow(candidateFlow);
    };

    const pending = await engine.resolveMemoryCandidates(resolutionInput) as any;
    const persisted = await store.loadFlow(flow.flow_id);

    expect(pending).toMatchObject({
      application_status: "pending",
      applied_resolutions: [],
      memory_mining: {
        v2_ledger_status: "pending",
        blocked_verdict: true,
        v2_receipts: [expect.objectContaining({ status: "COMMITTED" })],
        v2_failures: [expect.objectContaining({ message: "synthetic post-COMMITTED saveFlow failure" })]
      }
    });
    expect(persisted.memory_candidate_resolutions).toHaveLength(1);
    expect(persisted.memory_mining).toMatchObject({
      v2_ledger_status: "pending",
      blocked_verdict: true,
      v2_receipts: [expect.objectContaining({ status: "COMMITTED" })]
    });
    expect((await store.readLedger(flow.flow_id)).filter((event) =>
      event.type === "memory_mined"
      && Array.isArray(event.data.candidate_resolutions)
      && event.data.candidate_resolutions.length > 0
    )).toHaveLength(0);

    store.saveFlow = originalSaveFlow;
    const reloaded = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    await expect(reloaded.resolveMemoryCandidates(resolutionInput)).resolves.toMatchObject({
      application_status: "applied",
      memory_mining: { v2_ledger_status: "confirmed", blocked_verdict: false }
    });
  });

  it("marks persistent post-COMMITTED save failure and never rolls the resolution back or returns applied", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-persistent-flow-save-failure-"));
    let executionCount = 0;
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      executionCount += 1;
      if (executionCount === 1) throw new Error("synthetic pre-commit writer failure");
      return committedReceipt(input.operation_request, input.candidate, executionCount > 2);
    }) };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Impedir rollback após falha persistente de saveFlow" });
    flow.gold_mining = ["Conhecimento profundo cujo commit externo não pode ser desfeito localmente."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "auto_write",
      v2_destinations: [{ scope: "project" }],
      v2_density: "deep",
      v2_owner_skill: "dex-memoria",
      v2_tags: TEST_TAGS
    }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;
    const resolutionInput = {
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale: "Persistência indisponível deve falhar explicitamente sem rollback."
    } as const;
    const originalSaveFlow = store.saveFlow.bind(store);
    store.saveFlow = async (candidateFlow) => {
      const receipts = (candidateFlow.memory_mining as any)?.v2_receipts;
      if (Array.isArray(receipts) && receipts.some((receipt) => receipt.status === "COMMITTED")) {
        throw new Error("synthetic persistent post-COMMITTED save failure");
      }
      await originalSaveFlow(candidateFlow);
    };

    await expect(engine.resolveMemoryCandidates(resolutionInput))
      .rejects.toThrow("PPIRTV_V2_COMMITTED_STATE_PERSISTENCE_FAILED");

    const persisted = await store.loadFlow(flow.flow_id);
    expect(persisted.memory_candidate_resolutions).toEqual([
      expect.objectContaining({ candidate_id: candidateId, action: "promote" })
    ]);
    expect(persisted.history.filter((event) => event.type === "memory_candidates_resolved")).toHaveLength(1);
    expect((await store.readLedger(flow.flow_id)).filter((event) =>
      event.type === "memory_mined"
      && Array.isArray(event.data.candidate_resolutions)
      && event.data.candidate_resolutions.length > 0
    )).toHaveLength(0);

    store.saveFlow = originalSaveFlow;
    const reloaded = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    await expect(reloaded.resolveMemoryCandidates(resolutionInput)).resolves.toMatchObject({
      application_status: "applied",
      memory_mining: { v2_ledger_status: "confirmed", blocked_verdict: false }
    });
  });

  it("keeps the persisted pending state when confirmed flow persistence fails after ledger append", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-confirmed-flow-save-failure-"));
    let executionCount = 0;
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      executionCount += 1;
      if (executionCount === 1) throw new Error("synthetic pre-commit writer failure");
      return committedReceipt(input.operation_request, input.candidate, executionCount > 2);
    }) };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Manter pending quando confirmação do flow falhar" });
    flow.gold_mining = ["Conhecimento profundo confirmado no ledger, mas ainda pendente no flow."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "auto_write",
      v2_destinations: [{ scope: "project" }],
      v2_density: "deep",
      v2_owner_skill: "dex-memoria",
      v2_tags: TEST_TAGS
    }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;
    const resolutionInput = {
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale: "Confirmação incompleta do flow não pode receber applied."
    } as const;
    const originalSaveFlow = store.saveFlow.bind(store);
    store.saveFlow = async (candidateFlow) => {
      if ((candidateFlow.memory_mining as any)?.v2_ledger_status === "confirmed"
        && ((candidateFlow.memory_mining as any)?.v2_receipts ?? []).some((receipt: any) => receipt.status === "COMMITTED")) {
        throw new Error("synthetic confirmed flow persistence failure");
      }
      await originalSaveFlow(candidateFlow);
    };

    const pending = await engine.resolveMemoryCandidates(resolutionInput) as any;
    const persistedPending = await store.loadFlow(flow.flow_id);
    const reconciliationId = pending.memory_mining.v2_reconciliation_id as string;

    expect(pending).toMatchObject({
      application_status: "pending",
      applied_resolutions: [],
      memory_mining: {
        v2_status: "partial_pending",
        v2_ledger_status: "pending",
        blocked_verdict: true,
        v2_failures: [expect.objectContaining({ message: "synthetic confirmed flow persistence failure" })]
      }
    });
    expect(persistedPending.memory_candidate_resolutions).toHaveLength(1);
    expect(persistedPending.memory_mining).toMatchObject({
      v2_ledger_status: "pending",
      blocked_verdict: true,
      v2_receipts: [expect.objectContaining({ status: "COMMITTED" })]
    });
    expect((await store.readLedger(flow.flow_id)).filter((event) =>
      event.type === "memory_mined" && event.data.v2_reconciliation_id === reconciliationId
    )).toHaveLength(1);

    store.saveFlow = originalSaveFlow;
    const reloaded = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    await expect(reloaded.resolveMemoryCandidates(resolutionInput)).resolves.toMatchObject({
      application_status: "applied",
      memory_mining: {
        v2_reconciliation_id: reconciliationId,
        v2_ledger_status: "confirmed",
        blocked_verdict: false
      }
    });
    expect((await store.readLedger(flow.flow_id)).filter((event) =>
      event.type === "memory_mined" && event.data.v2_reconciliation_id === reconciliationId
    )).toHaveLength(1);
  });

  it("waits through a 30 second same-process flow lock and times out explicitly after 35 seconds", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-flow-lock-budget-"));
    const store = configuredStore();
    const flow = await new FlowEngine(store).createFlow({ goal: "Validar orçamento do flow lock" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-28T12:00:00.000Z"));
    try {
      let firstEntered!: () => void;
      let releaseFirst!: () => void;
      const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
      const first = store.withFlowLock(flow.flow_id, async () => {
        firstEntered();
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return "first";
      });
      await entered;
      const second = store.withFlowLock(flow.flow_id, async () => "second");
      await new Promise((resolve) => setTimeout(resolve, 20));
      vi.setSystemTime(new Date("2026-07-28T12:00:30.000Z"));
      releaseFirst();
      await expect(first).resolves.toBe("first");
      await expect(second).resolves.toBe("second");

      let blockerEntered!: () => void;
      let releaseBlocker!: () => void;
      const blockerReady = new Promise<void>((resolve) => { blockerEntered = resolve; });
      const blocker = store.withFlowLock(flow.flow_id, async () => {
        blockerEntered();
        await new Promise<void>((resolve) => { releaseBlocker = resolve; });
      });
      await blockerReady;
      const timedOut = store.withFlowLock(flow.flow_id, async () => "unsafe");
      const timeoutAssertion = expect(timedOut).rejects.toThrow(`MEETING_LOCK_TIMEOUT: ${flow.flow_id}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      vi.setSystemTime(new Date("2026-07-28T12:01:05.001Z"));
      await timeoutAssertion;
      releaseBlocker();
      await blocker;
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds repeated EEXIST-to-ENOENT lock churn by the same 35 second deadline", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-flow-lock-enoent-churn-"));
    const storeRoot = path.join(tempRoot, "workspace", ".ppirtv");
    const holderStore = new PpirtvStore(storeRoot);
    const flow = await new FlowEngine(holderStore).createFlow({ goal: "Limitar churn transitório do flow lock" });
    let releaseHolder!: () => void;
    let holderEntered!: () => void;
    const entered = new Promise<void>((resolve) => { holderEntered = resolve; });
    const holder = holderStore.withFlowLock(flow.flow_id, async () => {
      holderEntered();
      await new Promise<void>((resolve) => { releaseHolder = resolve; });
    });
    await entered;

    class EnoentChurnStore extends PpirtvStore {
      attempts = 0;

      protected override async readFlowLock(lockPath: string, flowId: string) {
        this.attempts += 1;
        vi.setSystemTime(new Date(Date.now() + 10_000));
        if (this.attempts === 4) {
          releaseHolder();
          await holder;
        }
        if (this.attempts <= 4) {
          throw Object.assign(new Error(`synthetic ENOENT churn: ${lockPath}; ${flowId}`), { code: "ENOENT" });
        }
        return super.readFlowLock(lockPath, flowId);
      }
    }

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-28T12:00:00.000Z"));
    try {
      const contender = new EnoentChurnStore(storeRoot);
      await expect(contender.withFlowLock(flow.flow_id, async () => "unsafe"))
        .rejects.toThrow(`MEETING_LOCK_TIMEOUT: ${flow.flow_id}`);
      expect(contender.attempts).toBe(4);
    } finally {
      releaseHolder();
      await holder;
      vi.useRealTimers();
    }
  });

  it.each([
    [
      "candidate identity",
      "DEX_MEMORIA_V2_CORE_CANDIDATE_ID_MISMATCH",
      (receipt: DexMemoriaV2CanonicalReceipt, input: DexMemoriaV2ExecutionInput) => {
        receipt.route_receipts[input.operation_request.scope === "global" ? "global" : "project"]!.candidate_id = "c".repeat(64);
      }
    ],
    [
      "receipt contract",
      "DEX_MEMORIA_V2_RECEIPT_CONTRACT_INVALID",
      (receipt: DexMemoriaV2CanonicalReceipt) => {
        (receipt as any).contract = "dex.memory.operation.receipt.invalid";
      }
    ],
    [
      "operation identity",
      "DEX_MEMORIA_V2_RECEIPT_OPERATION_MISMATCH",
      (receipt: DexMemoriaV2CanonicalReceipt) => {
        receipt.operation_id = `${receipt.operation_id}_mismatch`;
      }
    ],
    [
      "missing routes",
      null,
      (receipt: DexMemoriaV2CanonicalReceipt) => {
        delete (receipt as any).routes;
      }
    ],
    [
      "missing route receipts",
      null,
      (receipt: DexMemoriaV2CanonicalReceipt) => {
        delete (receipt as any).route_receipts;
      }
    ]
  ] as const)("keeps a post-write %s failure pending and traceable instead of rolling back the decision", async (_case, expectedError, corruptReceipt) => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-structural-receipt-"));
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      const receipt = await committedReceipt(input.operation_request, input.candidate);
      corruptReceipt(receipt, input);
      return receipt;
    }) };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, {
      memory_writer: configuredWriter(executor, {
        default_classification: {
          status: "resolved",
          density: "light",
          tags: TEST_TAGS,
          requested_destinations: [{ scope: "project" }]
        }
      })
    });
    const flow = await engine.createFlow({ goal: "Preservar decisão após receipt estrutural inválido" });
    flow.gold_mining = ["Regra local gravada antes da validação estrutural falhar."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" }) as any;
    const candidateId = mined.candidates[0].candidate_id as string;

    const resolved = await engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "promote",
      rationale: "O efeito externo inválido precisa continuar recuperável."
    }) as any;

    expect(resolved).toMatchObject({
      application_status: "pending",
      pending_resolutions: [expect.objectContaining({ candidate_id: candidateId })],
      memory_mining: {
        blocked_verdict: true,
        v2_status: "partial_pending",
        v2_receipts: [expect.objectContaining({ status: "COMMITTED" })],
        v2_failures: [expect.objectContaining({ message: expectedError ?? expect.any(String) })]
      }
    });
    expect((await store.loadFlow(flow.flow_id)).memory_candidate_resolutions).toHaveLength(1);
    expect((await store.readLedger(flow.flow_id)).filter((event) => event.type === "memory_candidates_resolved")).toHaveLength(1);
  });

  it("gives materially different same-millisecond promotions distinct ids without overriding the classified destination", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T15:00:00.000Z"));
    try {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-resolution-id-"));
      const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => committedReceipt(input.operation_request, input.candidate)) };
      const store = configuredStore();
      const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
      const flow = await engine.createFlow({ goal: "Distinguir promoções no mesmo milissegundo" });
      flow.gold_mining = ["Conhecimento profundo com duas decisões materiais sucessivas."];
      await store.saveFlow(flow);
      const mined = await engine.mineMemory({
        flow_id: flow.flow_id,
        write_policy: "classify_only",
        v2_destinations: [{ scope: "project" }],
        v2_density: "deep",
        v2_owner_skill: "dex-memoria",
        v2_tags: TEST_TAGS
      }) as any;
      const candidateId = mined.candidates[0].candidate_id as string;
      await engine.resolveMemoryCandidates({
        flow_id: flow.flow_id,
        candidate_ids: [candidateId],
        action: "promote",
        target_scope: "projeto",
        rationale: "Primeira decisão material."
      });
      const second = await engine.resolveMemoryCandidates({
        flow_id: flow.flow_id,
        candidate_ids: [candidateId],
        action: "promote",
        rationale: "Segunda decisão material."
      }) as any;
      const persisted = await store.loadFlow(flow.flow_id);
      const replayed = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" }) as any;

      expect(new Set(persisted.memory_candidate_resolutions!.map((item) => item.resolution_id))).toHaveLength(2);
      expect(second.resolved).toEqual([expect.objectContaining({
        candidate_destinations: [{ scope: "project" }],
        rationale: "Segunda decisão material."
      })]);
      expect(replayed.candidate_resolutions).toEqual([expect.objectContaining({
        candidate_destinations: [{ scope: "project" }],
        rationale: "Segunda decisão material."
      })]);
      expect(executor.execute).toHaveBeenCalledWith({
        operation_request: expect.objectContaining({ scope: "project" }),
        candidate: expect.any(Object)
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes concurrent resolutions without losing either decision", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-resolution-lock-"));
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter({ execute: vi.fn() }) });
    const flow = await engine.createFlow({ goal: "Preservar resoluções concorrentes" });
    flow.gold_mining = ["Primeira regra local concorrente.", "Segunda regra local concorrente."];
    await store.saveFlow(flow);
    const mined = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    }) as any;
    const [firstId, secondId] = mined.candidates.map((candidate: any) => candidate.candidate_id);

    await Promise.all([
      engine.resolveMemoryCandidates({
        flow_id: flow.flow_id,
        candidate_ids: [firstId],
        action: "discard",
        rationale: "Primeira decisão concorrente."
      }),
      engine.resolveMemoryCandidates({
        flow_id: flow.flow_id,
        candidate_ids: [secondId],
        action: "accept_ledger_only",
        rationale: "Segunda decisão concorrente."
      })
    ]);

    const persisted = await store.loadFlow(flow.flow_id);
    expect(persisted.memory_candidate_resolutions).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidate_id: firstId, action: "discard" }),
      expect.objectContaining({ candidate_id: secondId, action: "accept_ledger_only" })
    ]));
    expect(persisted.memory_candidate_resolutions).toHaveLength(2);
  });

  it("serializes public mining with resolution so a stale mining snapshot cannot erase the decision", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-mine-resolution-lock-"));
    let releaseWriter!: () => void;
    const writerStarted = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let confirmWriterStarted!: () => void;
    const writerEntered = new Promise<void>((resolve) => {
      confirmWriterStarted = resolve;
    });
    const executor = {
      execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
        confirmWriterStarted();
        await writerStarted;
        return committedReceipt(input.operation_request, input.candidate);
      })
    };
    const store = configuredStore();
    const engine = new FlowEngine(store, undefined, { memory_writer: configuredWriter(executor) });
    const flow = await engine.createFlow({ goal: "Preservar decisão contra mineração concorrente" });
    flow.gold_mining = ["Regra local disputada por mineração e resolução."];
    await store.saveFlow(flow);
    const classified = await engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "classify_only",
      v2_destinations: [{ scope: "project" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    }) as any;
    const candidateId = classified.candidates[0].candidate_id as string;

    const mining = engine.mineMemory({
      flow_id: flow.flow_id,
      write_policy: "auto_write",
      v2_destinations: [{ scope: "project" }],
      v2_density: "light",
      v2_tags: TEST_TAGS
    });
    await writerEntered;
    const resolution = engine.resolveMemoryCandidates({
      flow_id: flow.flow_id,
      candidate_ids: [candidateId],
      action: "discard",
      rationale: "A decisão deve sobreviver ao snapshot concorrente."
    });
    releaseWriter();
    await Promise.all([mining, resolution]);

    const persisted = await store.loadFlow(flow.flow_id);
    expect(persisted.memory_candidate_resolutions).toEqual([
      expect.objectContaining({ candidate_id: candidateId, action: "discard" })
    ]);
    expect(persisted.memory_mining).toMatchObject({
      resolved_candidate_ids: [candidateId],
      discarded: [candidateId],
      discarded_count: 1,
      blocked_verdict: false
    });
  });

  it("blocks completion when the canonical writer cannot supply independent validation evidence", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-validation-"));
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      const receipt = await committedReceipt(input.operation_request, input.candidate);
      delete receipt.route_receipts.project!.validation_receipt_path;
      delete receipt.route_receipts.project!.validation_receipt_hash;
      return receipt;
    }) };
    const engine = new FlowEngine(configuredStore(), undefined, {
      memory_writer: configuredWriter(executor, { default_classification: { status: "resolved", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] } })
    });
    const flow = await engine.createFlow({ goal: "Bloquear credito circular de validacao" });
    flow.gold_mining = ["Regra forte sem validacao independente."];
    await engine.store.saveFlow(flow);

    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" });
    const retried = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" });
    expect(mined).toMatchObject({ v2_status: "partial_pending", blocked_verdict: true, memory_written: false, written_count: 0, memory_validated: false });
    expect(retried).toMatchObject({ v2_status: "partial_pending", blocked_verdict: true, memory_written: false, written_count: 0, memory_validated: false });
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it("does not credit a fully failed coordinator receipt as written memory", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-failed-credit-"));
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => failedReceipt(input.operation_request, input.candidate)) };
    const engine = new FlowEngine(configuredStore(), undefined, {
      memory_writer: configuredWriter(executor, { default_classification: { status: "resolved", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] } })
    });
    const flow = await engine.createFlow({ goal: "Nao creditar receipt FAILED" });
    flow.gold_mining = ["Regra cuja escrita falhou."];
    await engine.store.saveFlow(flow);

    const mined = await engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" });
    expect(mined).toMatchObject({ v2_status: "partial_pending", memory_written: false, written_count: 0, memory_validated: false });
  });

  it("rejects a V2 writer workspace that differs from the store project root before the executor", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-store-writer-mismatch-"));
    const storeWorkspace = path.join(tempRoot, "store-workspace");
    const executor = { execute: vi.fn() };
    const engine = new FlowEngine(new PpirtvStore(path.join(storeWorkspace, ".ppirtv")), undefined, {
      memory_writer: configuredWriter(executor, {
        workspace_root: path.join(tempRoot, "different-writer-workspace"),
        default_classification: { status: "resolved", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] }
      })
    });
    const flow = await engine.createFlow({ goal: "Impedir writer fora do workspace do store" });
    flow.gold_mining = ["Regra que nunca pode escapar para outro workspace."];
    await engine.store.saveFlow(flow);

    await expect(engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" }))
      .rejects.toThrow("PPIRTV_DEX_MEMORIA_V2_WORKSPACE_MISMATCH");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("rejects a GOAL envelope workspace that differs from the store and writer before the executor", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-v2-envelope-mismatch-"));
    const workspace = path.join(tempRoot, "workspace");
    const executor = { execute: vi.fn() };
    const engine = new FlowEngine(new PpirtvStore(path.join(workspace, ".ppirtv")), undefined, {
      memory_writer: configuredWriter(executor, {
        workspace_root: workspace,
        default_classification: { status: "resolved", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] }
      })
    });
    const flow = await engine.createFlow({ goal: "Impedir envelope fora do workspace confinado" });
    flow.goal_binding = {
      envelope: {
        workspace: path.join(tempRoot, "different-envelope-workspace"),
        spt_path: path.join(workspace, "trail.md"),
        objective: flow.goal,
        idempotency_key: "v2-envelope-workspace-mismatch",
        evidence_required: true,
        required_evidence: [],
        requested_verdict_policy: "evidence_required",
        source: "test"
      },
      started_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
    flow.gold_mining = ["Regra que nunca pode seguir o workspace divergente do envelope."];
    await engine.store.saveFlow(flow);

    await expect(engine.mineMemory({ flow_id: flow.flow_id, write_policy: "auto_write" }))
      .rejects.toThrow("PPIRTV_DEX_MEMORIA_V2_WORKSPACE_MISMATCH");
    expect(executor.execute).not.toHaveBeenCalled();
  });
});

function routesFor(request: DexMemoriaV2OperationRequest) {
  const scopes = request.scope === "dual" ? ["project", "global"] as const : [request.scope] as const;
  return scopes.map((scope, index) => ({
    scope,
    ...(scope === "theme" ? { theme: request.theme } : {}),
    resolved_root: scope === "project" ? path.join(request.workspace_root, ".agents") : scope === "global" ? path.join(request.memory_home, "global") : path.join(request.memory_home, "temas", request.theme!),
    operation_id: request.operation_id,
    idempotency_key: `idem_${index}`,
    transaction_id: `tx_${index}`,
    receipt_id: `receipt_${index}`
  }));
}

async function committedReceipt(
  request: DexMemoriaV2OperationRequest,
  candidate: DexMemoriaV2ExecutionInput["candidate"],
  deduplicated = false
): Promise<DexMemoriaV2CanonicalReceipt> {
  const routes = routesFor(request);
  const candidateId = sha256(Buffer.from(JSON.stringify(sortJsonValue(candidate)), "utf8"));
  const receipt: DexMemoriaV2CanonicalReceipt = {
    contract: "dex.memory.operation.receipt.v2", implementation_version: "v2", requested_scope: request.scope,
    operation_id: request.operation_id, status: "COMMITTED", recovery_mode: null, routes,
    route_receipts: Object.fromEntries(routes.map((route, index) => [route.scope, { ...route, status: "COMMITTED", receipt_path: `${route.resolved_root}/receipt-${request.operation_id}.json`, validation_receipt_path: `${route.resolved_root}/validation-${request.operation_id}.json`, validation_receipt_hash: `validation_hash_${route.scope}`, validation_contract: "dex.memory.capability.unit-receipt.v2", validation_ok: true, candidate_id: "a".repeat(64), content_hash: "b".repeat(64), route_identity: String(index + 1).repeat(64).slice(0, 64), deduplicated, write_set_hash: `write_set_hash_${route.scope}` }]))
  };
  for (const route of routes) {
    const routeReceipt = receipt.route_receipts[route.scope]!;
    routeReceipt.candidate_id = candidateId;
    const l1Name = route.scope === "project" ? "lembranca.md" : "LEMBRANCA.md";
    const l1Bytes = Buffer.from("# Lembranças\n", "utf8");
    const destinationBytes = Buffer.from("# Regra\n", "utf8");
    routeReceipt.content_hash = sha256(destinationBytes);
    const destinationRelative = candidate.target_layer === "L2"
      ? `memorias/${candidate.slug}.md`
      : `conhecimento/${candidate.slug}/README.md`;
    const destinationPath = path.join(route.resolved_root, ...destinationRelative.split("/"));
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(path.join(route.resolved_root, l1Name), l1Bytes);
    await writeFile(destinationPath, destinationBytes);
    const files = [
      { path: l1Name, sha256: sha256(l1Bytes) },
      { path: destinationRelative, sha256: sha256(destinationBytes) }
    ];
    const validationReceipt = {
      contract: "dex.memory.capability.unit-receipt.v2", capability: "v2-obsidian", require_obsidian: true,
      expected_require_obsidian: true, ok: true, errors: [], resolved_root: path.resolve(route.resolved_root),
      touched_files: files, evidence: { files }
    };
    const validationBytes = Buffer.from(`${JSON.stringify(validationReceipt, null, 2)}\n`, "utf8");
    routeReceipt.validation_receipt_hash = sha256(validationBytes);
    routeReceipt.write_set_hash = sha256(Buffer.concat([l1Bytes, Buffer.from("\0"), destinationBytes]));
    await writeFile(routeReceipt.validation_receipt_path!, validationBytes);
    await writeFile(routeReceipt.receipt_path!, `${JSON.stringify({ contract: "dex.memory.route.receipt.v2", ...routeReceipt }, null, 2)}\n`, "utf8");
  }
  return receipt;
}

async function partialReceipt(request: DexMemoriaV2OperationRequest, candidate: DexMemoriaV2ExecutionInput["candidate"]): Promise<DexMemoriaV2CanonicalReceipt> {
  const receipt = await committedReceipt(request, candidate);
  receipt.status = "PARTIAL_PENDING";
  receipt.recovery_mode = "resume_pending_sibling";
  receipt.route_receipts.global!.status = "PENDING";
  delete receipt.route_receipts.global!.receipt_path;
  delete receipt.route_receipts.global!.validation_receipt_path;
  delete receipt.route_receipts.global!.validation_receipt_hash;
  delete receipt.route_receipts.global!.validation_contract;
  delete receipt.route_receipts.global!.validation_ok;
  delete receipt.route_receipts.global!.write_set_hash;
  receipt.route_receipts.global!.failure_code = "SYNTHETIC_GLOBAL_FAILURE";
  return receipt;
}

async function failedReceipt(request: DexMemoriaV2OperationRequest, candidate: DexMemoriaV2ExecutionInput["candidate"]): Promise<DexMemoriaV2CanonicalReceipt> {
  const receipt = await committedReceipt(request, candidate);
  receipt.status = "FAILED";
  for (const route of receipt.routes) {
    receipt.route_receipts[route.scope] = { ...route, status: "PENDING", failure_code: "SYNTHETIC_FAILURE" };
  }
  return receipt;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonValue((value as Record<string, unknown>)[key])]));
  return value;
}

function configuredWriter(executor: DexMemoriaV2Executor, extra: Partial<DexMemoriaV2FlowWriterConfig> = {}): DexMemoriaV2FlowWriterConfig {
  return {
    profile: "v2",
    executor,
    memory_home: path.join(tempRoot, "memory-home"),
    workspace_root: path.join(tempRoot, "workspace"),
    ...extra
  };
}

function configuredStore(): PpirtvStore {
  return new PpirtvStore(path.join(tempRoot, "workspace", ".ppirtv"));
}
