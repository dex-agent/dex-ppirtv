import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildDexMemoriaV2OperationRequest,
  classifyDexMemoriaV2Intent,
  createDexMemoriaV2CliExecutor,
  executeDexMemoriaV2Adapter,
  type DexMemoriaV2CanonicalReceipt,
  type DexMemoriaV2ExecutionInput,
  type DexMemoriaV2OperationRequest
} from "../src/memory/dex-memoria-v2-adapter.js";

const TEST_TAGS = ["#dex-memoria/ppirtv-v2"];

describe("Dex Memoria V2 adapter", () => {
  it("rejects an invalid canonical CLI receipt instead of leaving the operation pending", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-v2-invalid-json-"));
    try {
      const entrypoint = path.join(fixtureRoot, "invalid-json-cli.mjs");
      await writeFile(
        entrypoint,
        'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("{invalid-json"));',
        "utf8"
      );
      const result = await executeDexMemoriaV2Adapter({
        operation_id: "op_invalid_json",
        slug: "invalid-json",
        workspace_root: path.join(fixtureRoot, "workspace"),
        memory_home: path.join(fixtureRoot, "memory-home"),
        classification: classifyDexMemoriaV2Intent({
          item: "Recibo sintético inválido.",
          density: "light",
          tags: TEST_TAGS,
          requested_destinations: [{ scope: "project" }]
        }),
        executor: createDexMemoriaV2CliExecutor({
          canonical_root: fixtureRoot,
          entrypoint
        })
      });

      expect(result.failure?.message).toContain("DEX_MEMORIA_V2_CANONICAL_RECEIPT_INVALID_JSON");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 2_000);

  it("redacts secret-like stderr returned by the canonical CLI", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-v2-stderr-redaction-"));
    const secret = "token=synthetic-secret-123456";
    try {
      const entrypoint = path.join(fixtureRoot, "failing-cli.mjs");
      await writeFile(
        entrypoint,
        `process.stdin.resume(); process.stdin.on("end", () => { process.stderr.write(${JSON.stringify(secret)}); process.exit(9); });`,
        "utf8"
      );
      const result = await executeDexMemoriaV2Adapter({
        operation_id: "op_stderr_redaction",
        slug: "stderr-redaction",
        workspace_root: path.join(fixtureRoot, "workspace"),
        memory_home: path.join(fixtureRoot, "memory-home"),
        classification: classifyDexMemoriaV2Intent({
          item: "Erro sintético sem conteúdo privado.",
          density: "light",
          tags: TEST_TAGS,
          requested_destinations: [{ scope: "project" }]
        }),
        executor: createDexMemoriaV2CliExecutor({
          canonical_root: fixtureRoot,
          entrypoint
        })
      });

      expect(result.failure?.message).toContain("[redacted]");
      expect(result.failure?.message).not.toContain(secret);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("maps explicit project/global dual to the canonical operation request", () => {
    const classification = classifyDexMemoriaV2Intent({
      item: "Regra recorrente confirmada.",
      density: "light",
      tags: TEST_TAGS,
      requested_destinations: [{ scope: "project" }, { scope: "global" }]
    });
    const request = buildDexMemoriaV2OperationRequest({
      operation_id: "op_dual",
      workspace_root: path.resolve("workspace"),
      memory_home: path.resolve("memory-home"),
      classification
    });

    expect(request).toMatchObject({
      contract: "dex.memory.operation.request.v2",
      implementation_version: "v2",
      scope: "dual",
      operation_id: "op_dual"
    });
  });

  it("routes only from an explicit producer decision and rejects missing or empty destinations", () => {
    expect(classifyDexMemoriaV2Intent({
      item: "Regra global cross-project para projetos Delphi.",
      density: "light",
      tags: TEST_TAGS,
      requested_destinations: [{ scope: "theme", theme: "arquitetura" }]
    }).destinations).toEqual([{ scope: "theme", theme: "arquitetura" }]);
    // @ts-expect-error public classifier contract requires explicit destinations
    expect(() => classifyDexMemoriaV2Intent({ item: "Regra global Delphi.", density: "light", tags: TEST_TAGS })).toThrow("DEX_MEMORIA_V2_DESTINATIONS_REQUIRED");
    expect(() => classifyDexMemoriaV2Intent({ item: "Regra global Delphi.", density: "light", tags: TEST_TAGS, requested_destinations: [] })).toThrow("DEX_MEMORIA_V2_DESTINATIONS_REQUIRED");
  });

  it("delivers an L3 XOR candidate and canonical request to the executor", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-adapter-l3-"));
    const executor = { execute: vi.fn() };
    executor.execute.mockImplementation(async (input: DexMemoriaV2ExecutionInput) => await materializedCommittedReceipt(input.operation_request, input.candidate));
    try {
      const result = await executeDexMemoriaV2Adapter({
        operation_id: "op_l3", slug: "conhecimento-direto", workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory-home"),
        classification: classifyDexMemoriaV2Intent({ item: "Conhecimento profundo com exemplos e anti-exemplos.", density: "deep", tags: TEST_TAGS, owner_skill: "dex-memoria", requested_destinations: [{ scope: "theme", theme: "arquitetura" }] }), executor
      });

    expect(executor.execute).toHaveBeenCalledWith({
      operation_request: expect.objectContaining({ contract: "dex.memory.operation.request.v2", scope: "theme", theme: "arquitetura" }),
      candidate: expect.objectContaining({
        contract: "dex.memory.write.candidate.v2",
        target_layer: "L3",
        slug: "conhecimento-direto",
        owner_skill: "dex-memoria"
      })
    });
    expect(executor.execute.mock.calls[0]?.[0].candidate).not.toHaveProperty("l2_bloco");
      expect(result.status).toBe("complete");
    } finally { await rm(fixtureRoot, { recursive: true, force: true }); }
  });

  it("preserves the specific V2 direct L1-to-L3 rule instead of manufacturing a legacy L2 sibling", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-adapter-direct-l3-"));
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => await materializedCommittedReceipt(input.operation_request, input.candidate)) };
    try {
      await executeDexMemoriaV2Adapter({ operation_id: "op_direct_l3", slug: "v2-direct-l3", workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory-home"), classification: classifyDexMemoriaV2Intent({ item: "Conhecimento robusto.", density: "deep", owner_skill: "dex-memoria", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] }), executor });
      expect(executor.execute.mock.calls[0]?.[0].candidate).toMatchObject({ target_layer: "L3", owner_skill: "dex-memoria", tags: TEST_TAGS });
      expect(executor.execute.mock.calls[0]?.[0].candidate).not.toHaveProperty("l2_bloco");
    } finally { await rm(fixtureRoot, { recursive: true, force: true }); }
  });

  it("projects only independently validated files into each validation receipt reference", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-adapter-validated-files-"));
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => await materializedCommittedReceipt(input.operation_request, input.candidate)) };
    try {
      const result = await executeDexMemoriaV2Adapter({
        operation_id: "op_validated_files",
        slug: "arquivos-validados",
        workspace_root: path.join(fixtureRoot, "workspace"),
        memory_home: path.join(fixtureRoot, "memory-home"),
        classification: classifyDexMemoriaV2Intent({
          item: "Regra local com arquivos confirmados pelo validador independente.",
          density: "light",
          tags: TEST_TAGS,
          requested_destinations: [{ scope: "project" }]
        }),
        executor
      });

      expect(result.validation_receipts).toEqual([
        expect.objectContaining({
          scope: "project",
          files: [
            await realpath(path.join(fixtureRoot, "workspace", ".agents", "lembranca.md")),
            await realpath(path.join(fixtureRoot, "workspace", ".agents", "memorias", "arquivos-validados.md"))
          ]
        })
      ]);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects circular validation credit when the writer receipt lacks a distinct canonical validator receipt", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-adapter-no-validator-"));
    const executor = { execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
      const receipt = await materializedCommittedReceipt(input.operation_request, input.candidate);
      delete receipt.route_receipts.project!.validation_receipt_path;
      delete receipt.route_receipts.project!.validation_receipt_hash;
      return receipt;
    }) };
    const result = await executeDexMemoriaV2Adapter({
      operation_id: "op_no_validator", slug: "sem-validador", workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory-home"),
      classification: classifyDexMemoriaV2Intent({ item: "Regra.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] }), executor
    });
    expect(result).toMatchObject({ status: "partial_pending", receipts: [{ operation_id: "op_no_validator" }], validation_receipts: [], failure: { message: "DEX_MEMORIA_V2_VALIDATION_RECEIPT_PATH_REQUIRED" } });
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("rejects cross-scope credit when canonical route identities are reused", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-adapter-cross-scope-"));
    const executor = {
      execute: vi.fn().mockImplementation(async (input: DexMemoriaV2ExecutionInput) => {
        const receipt = await materializedCommittedReceipt(input.operation_request, input.candidate);
        receipt.routes[1]!.receipt_id = receipt.routes[0]!.receipt_id;
        receipt.route_receipts.global!.receipt_id = receipt.routes[0]!.receipt_id;
        return receipt;
      })
    };
    await expect(executeDexMemoriaV2Adapter({
      operation_id: "op_cross_credit",
      slug: "regra-dual",
      workspace_root: path.join(fixtureRoot, "workspace"),
      memory_home: path.join(fixtureRoot, "memory-home"),
      classification: classifyDexMemoriaV2Intent({
        item: "Regra dual.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }, { scope: "global" }]
      }),
      executor
    })).rejects.toThrow("DEX_MEMORIA_V2_RECEIPTS_NOT_INDEPENDENT");
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("reopens the validator receipt and rejects byte tampering", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-validation-tamper-"));
    try {
      const classification = classifyDexMemoriaV2Intent({ item: "Regra validada.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] });
      const request = buildDexMemoriaV2OperationRequest({ operation_id: "op_validation_tamper", workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory"), classification });
      const receipt = await materializedCommittedReceipt(request, candidateFor("regra-validada", classification));
      await writeFile(receipt.route_receipts.project!.validation_receipt_path!, "{\"tampered\":true}\n", "utf8");

      const result = await executeDexMemoriaV2Adapter({
        operation_id: request.operation_id, slug: "regra-validada", workspace_root: request.workspace_root,
        memory_home: request.memory_home, classification, executor: { execute: vi.fn().mockResolvedValue(receipt) }
      });

      expect(result).toMatchObject({ status: "partial_pending", validation_receipts: [], failure: { message: "DEX_MEMORIA_V2_VALIDATION_RECEIPT_HASH_MISMATCH" } });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("accepts a lowercase physical L1 declared by a global V2 validation receipt", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-global-l1-lowercase-"));
    try {
      const classification = classifyDexMemoriaV2Intent({ item: "Regra global com casing fisico.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "global" }] });
      const request = buildDexMemoriaV2OperationRequest({ operation_id: "op_global_lowercase", workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory"), classification });
      const receipt = await materializedCommittedReceipt(request, candidateFor("regra-global-lowercase", classification), { global: "lembranca.md" });

      const result = await executeDexMemoriaV2Adapter({
        operation_id: request.operation_id,
        slug: "regra-global-lowercase",
        workspace_root: request.workspace_root,
        memory_home: request.memory_home,
        classification,
        executor: { execute: vi.fn().mockResolvedValue(receipt) }
      });

      expect(result).toMatchObject({ status: "complete" });
      expect(result).not.toHaveProperty("failure");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects a coherent receipt with zero L1 files", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-zero-l1-"));
    try {
      const classification = classifyDexMemoriaV2Intent({ item: "Regra sem L1.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] });
      const request = buildDexMemoriaV2OperationRequest({ operation_id: "op_zero_l1", workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory"), classification });
      const receipt = await materializedCommittedReceipt(request, candidateFor("regra-sem-l1", classification), { project: "nao-e-l1.md" });

      const result = await executeDexMemoriaV2Adapter({ operation_id: request.operation_id, slug: "regra-sem-l1", workspace_root: request.workspace_root, memory_home: request.memory_home, classification, executor: { execute: vi.fn().mockResolvedValue(receipt) } });
      expect(result).toMatchObject({ status: "partial_pending", failure: { message: "DEX_MEMORIA_V2_VALIDATION_WRITE_SET_MISMATCH" } });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects a validator receipt that declares two case-equivalent L1 entries", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-two-l1-"));
    try {
      const classification = classifyDexMemoriaV2Intent({ item: "Regra com L1 duplicado.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] });
      const request = buildDexMemoriaV2OperationRequest({ operation_id: "op_two_l1", workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory"), classification });
      const receipt = await materializedCommittedReceipt(request, candidateFor("regra-l1-duplicado", classification));
      const routeReceipt = receipt.route_receipts.project!;
      const validation = JSON.parse(await readFile(routeReceipt.validation_receipt_path!, "utf8"));
      validation.evidence.files = [validation.evidence.files[0], { ...validation.evidence.files[0], path: "LEMBRANCA.md" }];
      validation.touched_files = validation.evidence.files;
      const validationBytes = Buffer.from(`${JSON.stringify(validation, null, 2)}\n`, "utf8");
      routeReceipt.validation_receipt_hash = sha256(validationBytes);
      await writeFile(routeReceipt.validation_receipt_path!, validationBytes);
      await writeFile(routeReceipt.receipt_path!, `${JSON.stringify({ contract: "dex.memory.route.receipt.v2", ...routeReceipt }, null, 2)}\n`, "utf8");

      const result = await executeDexMemoriaV2Adapter({ operation_id: request.operation_id, slug: "regra-l1-duplicado", workspace_root: request.workspace_root, memory_home: request.memory_home, classification, executor: { execute: vi.fn().mockResolvedValue(receipt) } });
      expect(result).toMatchObject({ status: "partial_pending", failure: { message: "DEX_MEMORIA_V2_VALIDATION_WRITE_SET_MISMATCH" } });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reopens the writer receipt and rejects scope or identity tampering", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-writer-tamper-"));
    try {
      const classification = classifyDexMemoriaV2Intent({ item: "Regra com receipt.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] });
      const request = buildDexMemoriaV2OperationRequest({ operation_id: "op_writer_tamper", workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory"), classification });
      const receipt = await materializedCommittedReceipt(request, candidateFor("regra-com-receipt", classification));
      const writerPath = receipt.route_receipts.project!.receipt_path!;
      const writerReceipt = JSON.parse(await readFile(writerPath, "utf8"));
      writerReceipt.scope = "global";
      await writeFile(writerPath, `${JSON.stringify(writerReceipt, null, 2)}\n`, "utf8");

      const result = await executeDexMemoriaV2Adapter({
        operation_id: request.operation_id, slug: "regra-com-receipt", workspace_root: request.workspace_root,
        memory_home: request.memory_home, classification, executor: { execute: vi.fn().mockResolvedValue(receipt) }
      });

      expect(result).toMatchObject({ status: "partial_pending", validation_receipts: [], failure: { message: "DEX_MEMORIA_V2_WRITER_RECEIPT_MISMATCH" } });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["validation receipt", "validation"],
    ["writer receipt", "writer"],
    ["written target", "target"]
  ] as const)("rejects a %s symlink that resolves outside the authorized root", async (_label, subject) => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), `ppirtv-${subject}-link-`));
    try {
      const classification = classifyDexMemoriaV2Intent({ item: "Regra com fronteira real.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] });
      const request = buildDexMemoriaV2OperationRequest({ operation_id: `op_${subject}_link`, workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory"), classification });
      const receipt = await materializedCommittedReceipt(request, candidateFor("regra-com-fronteira-real", classification));
      const routeReceipt = receipt.route_receipts.project!;
      const linkedPath = subject === "validation"
        ? routeReceipt.validation_receipt_path!
        : subject === "writer"
          ? routeReceipt.receipt_path!
          : path.join(routeReceipt.resolved_root, "memorias", "regra-com-fronteira-real.md");
      const outsidePath = path.join(fixtureRoot, `outside-${subject}${subject === "target" ? ".md" : ".json"}`);
      const bytes = await readFile(linkedPath);
      await rm(linkedPath);
      await writeFile(outsidePath, bytes);
      await symlink(outsidePath, linkedPath, "file");

      const result = await executeDexMemoriaV2Adapter({
        operation_id: request.operation_id, slug: "regra-com-fronteira-real", workspace_root: request.workspace_root,
        memory_home: request.memory_home, classification, executor: { execute: vi.fn().mockResolvedValue(receipt) }
      });

      expect(result).toMatchObject({ status: "partial_pending", validation_receipts: [], failure: { message: expect.stringContaining("REPARSE_BOUNDARY") } });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("maps canonical PARTIAL_PENDING and resumes only through the canonical resume executor", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-adapter-resume-"));
    const requestClassification = classifyDexMemoriaV2Intent({
      item: "Regra dual.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }, { scope: "global" }]
    });
    const request = buildDexMemoriaV2OperationRequest({
      operation_id: "op_resume",
      workspace_root: path.join(fixtureRoot, "workspace"),
      memory_home: path.join(fixtureRoot, "memory-home"),
      classification: requestClassification
    });
    const partial = partialReceipt(request);
    const committed = await materializedCommittedReceipt(request, candidateFor("regra-dual", requestClassification));
    const executor = {
      execute: vi.fn(),
      resume: vi.fn().mockResolvedValue(committed)
    };
    const result = await executeDexMemoriaV2Adapter({
      operation_id: "op_resume",
      slug: "regra-dual",
      workspace_root: request.workspace_root,
      memory_home: request.memory_home,
      classification: requestClassification,
      executor,
      resume_receipts: [partial]
    });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(executor.resume).toHaveBeenCalledWith(
      partial,
      expect.objectContaining({ contract: "dex.memory.write.candidate.v2" }),
      expect.objectContaining({ contract: "dex.memory.operation.request.v2", operation_id: "op_resume" })
    );
    expect(result.status).toBe("complete");
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("returns structured partial_pending when the canonical transport throws", async () => {
    const result = await executeDexMemoriaV2Adapter({
      operation_id: "op_transport",
      slug: "regra-pendente",
      workspace_root: path.resolve("workspace"),
      memory_home: path.resolve("memory-home"),
      classification: classifyDexMemoriaV2Intent({ item: "Regra local.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] }),
      executor: { execute: vi.fn().mockRejectedValue(new Error("transport unavailable")) }
    });
    expect(result).toMatchObject({ status: "partial_pending", receipts: [], failure: { message: "transport unavailable" } });
  });

  it("maps item, density and route through an explicitly configured canonical CLI boundary", async () => {
    const canonicalRoot = await mkdtemp(path.join(os.tmpdir(), "dex-memory-canonical-stub-"));
    const entrypoint = path.join(canonicalRoot, "canonical-cli.mjs");
    const applyCapture = path.join(canonicalRoot, "apply-capture.json");
    await writeFile(entrypoint, canonicalStubSource(applyCapture), "utf8");
    try {
      const executor = createDexMemoriaV2CliExecutor({ canonical_root: canonicalRoot, entrypoint });
      const result = await executeDexMemoriaV2Adapter({
        operation_id: "op_cli",
        slug: "regra-cli",
        workspace_root: path.join(canonicalRoot, "workspace"),
        memory_home: path.join(canonicalRoot, "memory-home"),
        classification: classifyDexMemoriaV2Intent({ item: "Regra CLI.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] }),
        executor
      });
      const captured = JSON.parse(await readFile(applyCapture, "utf8"));
      expect(captured).toMatchObject({
        contract: "dex.memory.apply.request.v2",
        request: { contract: "dex.memory.operation.request.v2", operation_id: "op_cli" },
        candidate: { contract: "dex.memory.write.candidate.v2", target_layer: "L2", slug: "regra-cli" }
      });
      expect(result.status).toBe("complete");
    } finally {
      await rm(canonicalRoot, { recursive: true, force: true });
    }
  });

  it("carries the original operation request through canonical resume instead of trusting receipt-only roots", async () => {
    const canonicalRoot = await mkdtemp(path.join(os.tmpdir(), "dex-memory-resume-stub-"));
    const entrypoint = path.join(canonicalRoot, "canonical-cli.mjs");
    const resumeCapture = path.join(canonicalRoot, "resume-capture.json");
    await writeFile(entrypoint, canonicalStubSource(resumeCapture), "utf8");
    try {
      const classification = classifyDexMemoriaV2Intent({ item: "Retomar escrita dual.", density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }, { scope: "global" }] });
      const request = buildDexMemoriaV2OperationRequest({ operation_id: "op_cli_resume", workspace_root: path.join(canonicalRoot, "workspace"), memory_home: path.join(canonicalRoot, "memory-home"), classification });
      const result = await executeDexMemoriaV2Adapter({
        operation_id: request.operation_id, slug: "retomar-escrita-dual", workspace_root: request.workspace_root, memory_home: request.memory_home,
        classification, executor: createDexMemoriaV2CliExecutor({ canonical_root: canonicalRoot, entrypoint }), resume_receipts: [partialReceipt(request)]
      });
      const captured = JSON.parse(await readFile(resumeCapture, "utf8"));
      expect(captured).toMatchObject({
        contract: "dex.memory.resume.request.v2",
        request: { contract: "dex.memory.operation.request.v2", operation_id: "op_cli_resume", scope: "dual" },
        receipt: { contract: "dex.memory.operation.receipt.v2", operation_id: "op_cli_resume" }
      });
      expect(result.status).toBe("complete");
    } finally {
      await rm(canonicalRoot, { recursive: true, force: true });
    }
  });

  it.runIf(Boolean(process.env.PPIRTV_TEST_DEX_MEMORIA_CANONICAL_ROOT && process.env.PPIRTV_TEST_DEX_MEMORIA_V2_ENTRYPOINT))(
    "executes the real canonical V2 plan/apply/validation boundary against disposable roots",
    async () => {
      const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-real-dex-memory-v2-"));
      try {
        const executor = createDexMemoriaV2CliExecutor({
          canonical_root: process.env.PPIRTV_TEST_DEX_MEMORIA_CANONICAL_ROOT!,
          entrypoint: process.env.PPIRTV_TEST_DEX_MEMORIA_V2_ENTRYPOINT!
        });
        const result = await executeDexMemoriaV2Adapter({
          operation_id: "op_ppirtv_real_boundary",
          slug: "ppirtv-real-boundary",
          workspace_root: path.join(fixtureRoot, "workspace"),
          memory_home: path.join(fixtureRoot, "memory-home"),
          classification: classifyDexMemoriaV2Intent({
            item: "Regra validada pela fronteira canônica real.", density: "light", tags: TEST_TAGS,
            requested_destinations: [{ scope: "project" }, { scope: "global" }]
          }),
          executor
        });
        expect(result.status).toBe("complete");
        expect(result.validation_receipts).toHaveLength(2);
        for (const validationRef of result.validation_receipts) {
          expect(validationRef.validation_receipt_id).not.toBe(validationRef.writer_receipt_id);
          expect(validationRef.validation_receipt_hash).not.toBe(validationRef.write_set_hash);
          expect(validationRef.candidate_id).toMatch(/^[a-f0-9]{64}$/);
          expect(validationRef.content_hash).toMatch(/^[a-f0-9]{64}$/);
          expect(validationRef.route_identity).toMatch(/^[a-f0-9]{64}$/);
          const validation = JSON.parse(await readFile(validationRef.validation_receipt_path, "utf8"));
          expect(validation.touched_files[0].path).toBe(validationRef.scope === "project" ? "lembranca.md" : "LEMBRANCA.md");
        }
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    }
  );

  it.runIf(Boolean(process.env.PPIRTV_TEST_DEX_MEMORIA_CANONICAL_ROOT && process.env.PPIRTV_TEST_DEX_MEMORIA_V2_ENTRYPOINT))(
    "keeps dedupe evidence current after an intervening write changes L1",
    async () => {
      const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-real-dedupe-sequence-"));
      try {
        const executor = createDexMemoriaV2CliExecutor({
          canonical_root: process.env.PPIRTV_TEST_DEX_MEMORIA_CANONICAL_ROOT!,
          entrypoint: process.env.PPIRTV_TEST_DEX_MEMORIA_V2_ENTRYPOINT!
        });
        const execute = async (operationId: string, slug: string, item: string) => await executeDexMemoriaV2Adapter({
          operation_id: operationId, slug, workspace_root: path.join(fixtureRoot, "workspace"), memory_home: path.join(fixtureRoot, "memory-home"),
          classification: classifyDexMemoriaV2Intent({ item, density: "light", tags: TEST_TAGS, requested_destinations: [{ scope: "project" }] }),
          executor
        });

        const firstA = await execute("op_dedupe_a", "dedupe-a", "Conteúdo A.");
        const writeB = await execute("op_dedupe_b", "dedupe-b", "Conteúdo B.");
        const secondA = await execute("op_dedupe_a", "dedupe-a", "Conteúdo A.");

        expect(firstA.status).toBe("complete");
        expect(writeB.status).toBe("complete");
        expect(secondA.failure).toBeUndefined();
        expect(secondA).toMatchObject({ status: "complete", validation_receipts: [{ deduplicated: true }] });
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    }
  );
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

function committedReceipt(request: DexMemoriaV2OperationRequest): DexMemoriaV2CanonicalReceipt {
  const routes = routesFor(request);
  return {
    contract: "dex.memory.operation.receipt.v2",
    implementation_version: "v2",
    requested_scope: request.scope,
    operation_id: request.operation_id,
    status: "COMMITTED",
    recovery_mode: null,
    routes,
    route_receipts: Object.fromEntries(routes.map((route, index) => [route.scope, { ...route, status: "COMMITTED", receipt_path: `${route.resolved_root}/receipt.json`, validation_receipt_path: `${route.resolved_root}/validation.json`, validation_receipt_hash: `validation_hash_${route.scope}`, validation_contract: "dex.memory.capability.unit-receipt.v2", validation_ok: true, candidate_id: "a".repeat(64), content_hash: "b".repeat(64), route_identity: String(index + 1).repeat(64).slice(0, 64), deduplicated: false, write_set_hash: `write_set_hash_${route.scope}` }]))
  };
}

function partialReceipt(request: DexMemoriaV2OperationRequest): DexMemoriaV2CanonicalReceipt {
  const receipt = committedReceipt(request);
  receipt.status = "PARTIAL_PENDING";
  receipt.recovery_mode = "resume_pending_sibling";
  receipt.route_receipts.global!.status = "PENDING";
  delete receipt.route_receipts.global!.receipt_path;
  delete receipt.route_receipts.global!.validation_receipt_path;
  delete receipt.route_receipts.global!.validation_receipt_hash;
  delete receipt.route_receipts.global!.validation_contract;
  delete receipt.route_receipts.global!.validation_ok;
  delete receipt.route_receipts.global!.write_set_hash;
  receipt.route_receipts.global!.failure_code = "SYNTHETIC_FAILURE";
  return receipt;
}

async function materializedCommittedReceipt(
  request: DexMemoriaV2OperationRequest,
  candidate: DexMemoriaV2ExecutionInput["candidate"],
  l1Names: Partial<Record<"project" | "global" | "theme", string>> = {}
): Promise<DexMemoriaV2CanonicalReceipt> {
  const receipt = committedReceipt(request);
  const candidateId = sha256(Buffer.from(JSON.stringify(sortJsonValue(candidate)), "utf8"));
  for (const route of receipt.routes) {
    const routeReceipt = receipt.route_receipts[route.scope]!;
    routeReceipt.candidate_id = candidateId;
    const l1Name = l1Names[route.scope] ?? (route.scope === "project" ? "lembranca.md" : "LEMBRANCA.md");
    const l1Bytes = Buffer.from("# Lembranças\n", "utf8");
    const destinationBytes = Buffer.from("# Regra\n", "utf8");
    routeReceipt.content_hash = sha256(destinationBytes);
    const destinationRelative = candidate.target_layer === "L2"
      ? `memorias/${candidate.slug}.md`
      : `conhecimento/${candidate.slug}/README.md`;
    const destinationPath = path.join(route.resolved_root, ...destinationRelative.split("/"));
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await mkdir(path.dirname(routeReceipt.receipt_path!), { recursive: true });
    await writeFile(path.join(route.resolved_root, l1Name), l1Bytes);
    await writeFile(destinationPath, destinationBytes);
    const validationReceipt = {
      contract: "dex.memory.capability.unit-receipt.v2", capability: "v2-obsidian", require_obsidian: true,
      expected_require_obsidian: true, ok: true, errors: [], resolved_root: path.resolve(route.resolved_root),
      touched_files: [
        { path: l1Name, sha256: sha256(l1Bytes) },
        { path: destinationRelative, sha256: sha256(destinationBytes) }
      ],
      evidence: { files: [
        { path: l1Name, sha256: sha256(l1Bytes) },
        { path: destinationRelative, sha256: sha256(destinationBytes) }
      ] }
    };
    const validationBytes = Buffer.from(`${JSON.stringify(validationReceipt, null, 2)}\n`, "utf8");
    routeReceipt.validation_receipt_hash = sha256(validationBytes);
    routeReceipt.write_set_hash = sha256(Buffer.concat([l1Bytes, Buffer.from("\0"), destinationBytes]));
    await writeFile(routeReceipt.validation_receipt_path!, validationBytes);
    await writeFile(routeReceipt.receipt_path!, `${JSON.stringify({ contract: "dex.memory.route.receipt.v2", ...routeReceipt }, null, 2)}\n`, "utf8");
  }
  return receipt;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function candidateFor(slug: string, classification: ReturnType<typeof classifyDexMemoriaV2Intent>): DexMemoriaV2ExecutionInput["candidate"] {
  const title = classification.item.replace(/\s+/g, " ").trim().slice(0, 96);
  return {
    contract: "dex.memory.write.candidate.v2",
    target_layer: classification.route.target,
    slug,
    trigger: title,
    title,
    body: classification.item,
    tags: [...classification.tags],
    ...(classification.route.target === "L3" ? { owner_skill: classification.route.owner_skill } : {})
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonValue((value as Record<string, unknown>)[key])]));
  return value;
}

function canonicalStubSource(capturePath: string): string {
  return [
    "import { createHash } from 'node:crypto';",
    "import { mkdir, writeFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    "const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');",
    "const sortValue = (value) => Array.isArray(value) ? value.map(sortValue) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])])) : value;",
    "const hashJson = (value) => sha256(Buffer.from(JSON.stringify(sortValue(value))));",
    "let text = ''; for await (const chunk of process.stdin) text += chunk; const input = JSON.parse(text);",
    `const capture = ${JSON.stringify(capturePath)};`,
    "if (process.argv[3] === 'plan') {",
    " const scopes = input.scope === 'dual' ? ['project','global'] : [input.scope];",
    " const routes = scopes.map((scope,index) => ({ scope, ...(scope === 'theme' ? {theme: input.theme} : {}), resolved_root: scope === 'project' ? path.join(input.workspace_root,'.agents') : scope === 'global' ? path.join(input.memory_home,'global') : path.join(input.memory_home,'temas',input.theme), operation_id: input.operation_id, idempotency_key: `idem_${index}`, transaction_id: `tx_${index}`, receipt_id: `receipt_${index}` }));",
    " process.stdout.write(JSON.stringify({contract:'dex.memory.operation.plan.v2',implementation_version:'v2',requested_scope:input.scope,operation_id:input.operation_id,routes}));",
    "} else {",
    " await writeFile(capture, JSON.stringify(input)); const q=input.request; const scopes=q.scope==='dual'?['project','global']:[q.scope]; const routes=scopes.map((scope,index)=>({scope,...(scope==='theme'?{theme:q.theme}:{}),resolved_root:scope==='project'?path.join(q.workspace_root,'.agents'):scope==='global'?path.join(q.memory_home,'global'):path.join(q.memory_home,'temas',q.theme),operation_id:q.operation_id,idempotency_key:`idem_${index}`,transaction_id:`tx_${index}`,receipt_id:`receipt_${index}`})); const rr={};",
    " for (const [routeIndex,r] of routes.entries()) { const l1Name=r.scope==='project'?'lembranca.md':'LEMBRANCA.md'; const destRel=input.candidate.target_layer==='L2'?`memorias/${input.candidate.slug}.md`:`conhecimento/${input.candidate.slug}/README.md`; const destPath=path.join(r.resolved_root,...destRel.split('/')); await mkdir(path.dirname(destPath),{recursive:true}); const l1=Buffer.from('# Lembranças\\n'); const dest=Buffer.from('# Regra\\n'); await writeFile(path.join(r.resolved_root,l1Name),l1); await writeFile(destPath,dest); const files=[{path:l1Name,sha256:sha256(l1)},{path:destRel,sha256:sha256(dest)}]; const validation={contract:'dex.memory.capability.unit-receipt.v2',capability:'v2-obsidian',require_obsidian:true,expected_require_obsidian:true,ok:true,errors:[],resolved_root:path.resolve(r.resolved_root),touched_files:files,evidence:{files}}; const validationBytes=Buffer.from(JSON.stringify(validation,null,2)+'\\n'); const routeReceipt={...r,status:'COMMITTED',receipt_path:path.join(r.resolved_root,'receipt.json'),validation_receipt_path:path.join(r.resolved_root,'validation.json'),validation_receipt_hash:sha256(validationBytes),validation_contract:'dex.memory.capability.unit-receipt.v2',validation_ok:true,candidate_id:hashJson(input.candidate),content_hash:sha256(dest),route_identity:String(routeIndex+1).repeat(64).slice(0,64),deduplicated:false,write_set_hash:sha256(Buffer.concat([l1,Buffer.from('\\0'),dest]))}; await writeFile(routeReceipt.validation_receipt_path,validationBytes); await writeFile(routeReceipt.receipt_path,JSON.stringify({contract:'dex.memory.route.receipt.v2',...routeReceipt},null,2)+'\\n'); rr[r.scope]=routeReceipt; }",
    " process.stdout.write(JSON.stringify({contract:'dex.memory.operation.receipt.v2',implementation_version:'v2',requested_scope:q.scope,operation_id:q.operation_id,status:'COMMITTED',recovery_mode:null,routes,route_receipts:rr}));",
    "}"
  ].join("\n");
}
