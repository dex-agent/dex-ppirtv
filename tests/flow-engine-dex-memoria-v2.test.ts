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
    expect(mined).toMatchObject({ v2_status: "partial_pending", blocked_verdict: true, memory_written: false, written_count: 0, memory_validated: false });
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

async function committedReceipt(request: DexMemoriaV2OperationRequest, candidate: DexMemoriaV2ExecutionInput["candidate"]): Promise<DexMemoriaV2CanonicalReceipt> {
  const routes = routesFor(request);
  const candidateId = sha256(Buffer.from(JSON.stringify(sortJsonValue(candidate)), "utf8"));
  const receipt: DexMemoriaV2CanonicalReceipt = {
    contract: "dex.memory.operation.receipt.v2", implementation_version: "v2", requested_scope: request.scope,
    operation_id: request.operation_id, status: "COMMITTED", recovery_mode: null, routes,
    route_receipts: Object.fromEntries(routes.map((route, index) => [route.scope, { ...route, status: "COMMITTED", receipt_path: `${route.resolved_root}/receipt.json`, validation_receipt_path: `${route.resolved_root}/validation.json`, validation_receipt_hash: `validation_hash_${route.scope}`, validation_contract: "dex.memory.capability.unit-receipt.v2", validation_ok: true, candidate_id: "a".repeat(64), content_hash: "b".repeat(64), route_identity: String(index + 1).repeat(64).slice(0, 64), deduplicated: false, write_set_hash: `write_set_hash_${route.scope}` }]))
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
