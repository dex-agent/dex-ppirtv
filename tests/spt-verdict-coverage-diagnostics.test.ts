import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { addDeclarativeEvidence, declarativeDefaults } from "../src/spt-declarative-proof.js";
import { PpirtvStore } from "../src/store.js";

// SPT issue10-verdict-diagnostico (GO 2026-11-07): o verdict cego pago pela
// frota (issue #10) — 5 criterion_proofs anexados e o erro só dizia
// missing=C-01..C-04. Estes testes exigem o erro que ENSINA: por que cada
// critério está descoberto (prova passed=false com a evaluation literal,
// evidência sem criterion_proof) e o diagnóstico de binding visível no
// goal_status. RED primeiro: no baseline 25275b0 todos falham.
let tempRoot: string;
let workspace: string;
let engine: FlowEngine;
let flowId: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-coverage-diag-"));
  workspace = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "example.ts"), "export const result = true;\n", "utf8");
  await mkdir(path.join(workspace, ".agents", "PLAN-TASKS"), { recursive: true });
  await writeFile(
    path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
    v3Document(workspace),
    "utf8"
  );
  engine = new FlowEngine(new PpirtvStore(path.join(workspace, ".ppirtv")));
  const started = await engine.startGoal({
    workspace,
    spt_path: path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
    objective: "Provar diagnostico de cobertura",
    idempotency_key: "coverage-diag-fixture",
    evidence_required: true,
    required_evidence: [],
    requested_verdict_policy: "evidence_required",
    source: "test"
  });
  flowId = started.flow_id as string;
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("goal_verdict SPT v3 coverage: o erro ensina por que cada criterio esta descoberto (issue #10)", () => {
  it("prova citada com passed=false: erro traz criterion_id, marca proof_not_passed e a evaluation literal", async () => {
    const receipt = await addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "declarativa reprovada",
      kind: "goal_evidence",
      declarative_proof: {
        task_id: "A-01",
        evidence_requirement_id: "ER-01",
        observed_value: false,
        paths: ["src/example.ts"],
        command: "vitest fixture (falhou de proposito)"
      }
    }, declarativeDefaults());
    expect(receipt.all_passed).toBe(false);

    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "cobertura reprovada de proposito",
      evidence_ids: receipt.evidence_ids,
      next_step: "diagnostico visivel"
    })).rejects.toThrow(/C-01[^;]*proof_not_passed[^;]*boolean false equals true/);
  });

  it("evidencia citada sem criterion_proof: erro traz marca no_criterion_proof para o criterio descoberto", async () => {
    const note = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "nota sem prova de criterio",
      kind: "note",
      note: "evidencia narrativa que nao prova C-01 nem C-02"
    }) as Record<string, unknown>;
    const noteId = typeof note.evidence_id === "string" ? note.evidence_id : "";

    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "cobertura ausente",
      evidence_ids: [noteId],
      next_step: "diagnostico visivel"
    })).rejects.toThrow(/C-01.*no_criterion_proof.*via ER-01 na task A-01/s);
  });

  it("goal_status full expoe spt_contract_version e spt_traceability_present do binding", async () => {
    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" }) as Record<string, unknown>;
    expect(status.spt_contract_version).toBe(3);
    expect(status.spt_traceability_present).toBe(true);
  });

  it("flow orfao de spt_traceability reata a traceability no re-bind com o mesmo spt validado", async () => {
    const orphan = path.join(workspace, ".ppirtv", "flows", `${flowId}.json`);
    const { readFile, writeFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(orphan, "utf8"));
    delete raw.spt_traceability;
    await writeFile(orphan, JSON.stringify(raw), "utf8");

    const rebound = await engine.startGoal({
      flow_id: flowId,
      workspace,
      spt_path: path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
      objective: "Provar diagnostico de cobertura",
      idempotency_key: "coverage-diag-fixture",
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "test"
    });
    expect(rebound.flow_id).toBe(flowId);
    const after = JSON.parse(await readFile(orphan, "utf8"));
    expect(after.spt_traceability?.tasks?.length).toBeGreaterThan(0);
    expect(after.spt_traceability?.requirements?.length).toBeGreaterThan(0);

    // review adversarial (glm53 P2): a jornada COMPLETA da cura — depois do
    // re-bind, prova passed citada no verdict passa. A promessa central da
    // issue #10 (re-bind reata E o verdict segue) deixa de ser prosa.
    const cured = await addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "prova aprovada pos re-bind",
      kind: "goal_evidence",
      declarative_proof: { task_id: "A-01", evidence_requirement_id: "ER-01", observed_value: true, paths: ["src/example.ts"] }
    }, declarativeDefaults());
    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "cura completa do orfao",
      evidence_ids: cured.evidence_ids,
      next_step: "re-bind reatou o mapa e o verdict passou"
    });
    expect((verdict.verdict as Record<string, unknown>).status).toBe("pronto_com_ressalvas");
  });

  // Onda 2b (FE-DEBT-006): o re-bind que reata a traceability deixa trilha de
  // auditoria — evento spt_traceability_reattached no history E no ledger com
  // flow_id e fingerprint do contrato. RED primeiro: no baseline 217c389 o
  // re-attach muta o flow em silencio (nenhum evento gravado).
  it("re-bind de flow orfao grava evento de auditoria spt_traceability_reattached no history e no ledger", async () => {
    const orphan = path.join(workspace, ".ppirtv", "flows", `${flowId}.json`);
    const { readFile, writeFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(orphan, "utf8"));
    const fingerprintBefore = typeof raw.goal_binding?.spt_contract_fingerprint === "string"
      ? raw.goal_binding.spt_contract_fingerprint
      : "";
    delete raw.spt_traceability;
    await writeFile(orphan, JSON.stringify(raw), "utf8");

    await engine.startGoal({
      flow_id: flowId,
      workspace,
      spt_path: path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
      objective: "Provar diagnostico de cobertura",
      idempotency_key: "coverage-diag-fixture",
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "test"
    });

    const after = JSON.parse(await readFile(orphan, "utf8"));
    const events = (after.history as Array<{ type: string; data: Record<string, unknown> }>)
      .filter((event) => event.type === "spt_traceability_reattached");
    expect(events).toHaveLength(1);
    expect(events[0].data.flow_id).toBe(flowId);
    expect(events[0].data.recovered_by).toBe("goal_start_rebind");
    const fingerprint = String(events[0].data.spt_contract_fingerprint ?? "");
    // Corte de cura (gap adversarial 2b): igualdade incondicional — o binding
    // desta fixture SEMPRE carrega fingerprint (goal_start o computa).
    expect(fingerprintBefore.length).toBeGreaterThan(0);
    expect(fingerprint).toBe(fingerprintBefore);
    const ledgerPath = path.join(workspace, ".ppirtv", "ledger.ndjson");
    const ledgerRaw = await readFile(ledgerPath, "utf8");
    const ledgerEvents = ledgerRaw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { type?: string; data?: Record<string, unknown> });
    // Corte de cura (gap adversarial 2b): contagem escopada ao flow dono.
    const reattachLedger = ledgerEvents.filter(
      (event) => event.type === "spt_traceability_reattached" && event.data?.flow_id === flowId
    );
    expect(reattachLedger).toHaveLength(1);
    expect(reattachLedger[0].data?.flow_id).toBe(flowId);
  });

  // Corte de cura (P1 adversarial Onda 2b): o ledger e append-only e sem
  // compensacao — o evento do re-attach so pode entrar DEPOIS de saveFlow
  // persistir o flow. RED primeiro: no baseline 9df1304 o evento grava antes
  // do save e sobrevive a falha (trilha falsa).
  it("saveFlow falhando apos o re-bind deixa o ledger SEM spt_traceability_reattached e o retry grava 1x", async () => {
    const orphan = path.join(workspace, ".ppirtv", "flows", `${flowId}.json`);
    const { readFile, writeFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(orphan, "utf8"));
    delete raw.spt_traceability;
    await writeFile(orphan, JSON.stringify(raw), "utf8");

    const engineInternals = engine as unknown as { store: { saveFlow: () => Promise<void> } };
    const originalSave = engineInternals.store.saveFlow;
    engineInternals.store.saveFlow = async () => {
      throw new Error("simulated IO failure");
    };
    try {
      await expect(engine.startGoal({
        flow_id: flowId,
        workspace,
        spt_path: path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
        objective: "Provar diagnostico de cobertura",
        idempotency_key: "coverage-diag-fixture",
        evidence_required: true,
        required_evidence: [],
        requested_verdict_policy: "evidence_required",
        source: "test"
      })).rejects.toThrow(/simulated IO failure/);
    } finally {
      engineInternals.store.saveFlow = originalSave;
    }

    const ledgerAfterFailure = await readFile(path.join(workspace, ".ppirtv", "ledger.ndjson"), "utf8");
    expect(ledgerAfterFailure.includes("spt_traceability_reattached")).toBe(false);

    // disco segue orfao: o retry bem-sucedido grava o evento exatamente 1x
    // (sem fantasma do tentativa-falha, sem duplicacao).
    await engine.startGoal({
      flow_id: flowId,
      workspace,
      spt_path: path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
      objective: "Provar diagnostico de cobertura",
      idempotency_key: "coverage-diag-fixture",
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "test"
    });
    const ledgerLines = (await readFile(path.join(workspace, ".ppirtv", "ledger.ndjson"), "utf8"))
      .split("\n")
      .filter((line) => line.includes("spt_traceability_reattached"));
    expect(ledgerLines).toHaveLength(1);
  });

  // Cura-2 (P2/P2 adversarial da cura): appendLedger falhando DEPOIS do save
  // bem-sucedido deixava o ledger permanentemente sem o evento (trilha
  // AUSENTE — history persistiu, ledger não, e o retry não regrava porque o
  // flow já tem spt_traceability). RED primeiro: no baseline 665bb5f o retry
  // não completa a trilha.
  it("appendLedger falhando pós-save: o retry completa a trilha com evento recuperado (backfill)", async () => {
    const orphan = path.join(workspace, ".ppirtv", "flows", `${flowId}.json`);
    const { readFile, writeFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(orphan, "utf8"));
    delete raw.spt_traceability;
    await writeFile(orphan, JSON.stringify(raw), "utf8");

    const engineInternals = engine as unknown as {
      store: { appendLedger: (event: { type: string }) => Promise<unknown> };
    };
    const originalAppend = engineInternals.store.appendLedger;
    let armed = true;
    engineInternals.store.appendLedger = async (event: { type: string }) => {
      if (armed && event.type === "spt_traceability_reattached") {
        armed = false;
        throw new Error("simulated ledger IO failure");
      }
      return originalAppend.call(engineInternals.store, event);
    };
    const startArgs = {
      flow_id: flowId,
      workspace,
      spt_path: path.join(workspace, ".agents", "PLAN-TASKS", "fixture-v3.md"),
      objective: "Provar diagnostico de cobertura",
      idempotency_key: "coverage-diag-fixture",
      evidence_required: true,
      required_evidence: [] as string[],
      requested_verdict_policy: "evidence_required" as const,
      source: "test"
    };
    try {
      await expect(engine.startGoal(startArgs)).rejects.toThrow(/simulated ledger IO failure/);
    } finally {
      engineInternals.store.appendLedger = originalAppend;
    }
    // o flow persistiu com spt_traceability: o retry de reuso NÃO re-dispara o
    // re-bind — o backfill nasce da conferencia history x ledger.
    await engine.startGoal(startArgs);
    const ledgerRaw = await readFile(path.join(workspace, ".ppirtv", "ledger.ndjson"), "utf8");
    const reattachEvents = ledgerRaw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { type?: string; data?: Record<string, unknown> })
      .filter((event) => (event.type === "spt_traceability_reattached" || event.type === "spt_traceability_reattached_recovered"));
    expect(reattachEvents.length).toBeGreaterThanOrEqual(1);
  });

  // review-fixes: lean e o default da CAMADA MCP (server aplica detail ?? "lean");
  // revisao adversarial (P2 consenso 3 lentes): o teste anterior chamava sem
  // detail e exercia o branch full do engine — spread lean sem guarda.
  it("goal_status lean (default do MCP) expoe spt_contract_version e spt_traceability_present", async () => {
    const status = await engine.goalStatus({ flow_id: flowId, detail: "lean" }) as Record<string, unknown>;
    expect(status.spt_contract_version).toBe(3);
    expect(status.spt_traceability_present).toBe(true);
  });

  // review-fixes: o ramo TRACEABILITY_MISSING-at-verdict sem cura previa —
  // o erro ensina a ROTA que cura (goal_start re-bind) e o status enxerga o orfao.
  it("orfao sem cura: verdict grita TRACEABILITY_MISSING com rota goal_start e status ve presente=false", async () => {
    const orphan = path.join(workspace, ".ppirtv", "flows", `${flowId}.json`);
    const { readFile, writeFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(orphan, "utf8"));
    delete raw.spt_traceability;
    await writeFile(orphan, JSON.stringify(raw), "utf8");
    const status = await engine.goalStatus({ flow_id: flowId }) as Record<string, unknown>;
    expect(status.spt_traceability_present).toBe(false);
    const nota = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "nota do orfao",
      kind: "note",
      note: "citar para passar do gate de evidence_ids vazio"
    }) as Record<string, unknown>;
    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "orfao de proposito",
      evidence_ids: [typeof nota.evidence_id === "string" ? nota.evidence_id : ""],
      next_step: "rota que cura"
    })).rejects.toThrow(/SPT_V3_TRACEABILITY_MISSING.*goal_start/s);
  });

  // review-fixes: misto — prova aprovada existe no flow mas NAO foi citada,
  // prova reprovada foi citada; a reason nomeia a aprovada (acao-primeiro:
  // "cite a prova ja aprovada") e a ER/task dona. Revisao adversarial
  // (minimax+agnes): regex ancorada no evidence_id REAL da aprovada — a
  // regex anterior com .* /s podia atravessar a fronteira entre criterios.
  it("reason de 1 rodada: misto ensina a citar a prova aprovada pelo id real", async () => {
    const approved = await addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "aprovada (nao sera citada)",
      kind: "goal_evidence",
      declarative_proof: { task_id: "A-01", evidence_requirement_id: "ER-01", observed_value: true, paths: ["src/example.ts"] }
    }, declarativeDefaults());
    const failed = await addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "reprovada (citada)",
      kind: "goal_evidence",
      declarative_proof: { task_id: "A-01", evidence_requirement_id: "ER-01", observed_value: false, paths: ["src/example.ts"] }
    }, declarativeDefaults());
    const approvedId = String(approved.evidence_ids[0]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "misto de proposito",
      evidence_ids: failed.evidence_ids,
      next_step: "reason que fecha em 1 rodada"
    })).rejects.toThrow(
      new RegExp(`C-01: proof_not_passed: [^;]*boolean false equals true[^;]*; cite a prova ja aprovada ${approvedId}`, "s")
    );
  });

  // review-fixes: ancora de formato compativel — prefixo + missing= antes de
  // details= na MESMA linha (consumers de regex/substring continuam casando).
  it("ancora de formato: prefixo com missing= antes de details= na mesma linha", async () => {
    const failed = await addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "ancora",
      kind: "goal_evidence",
      declarative_proof: { task_id: "A-01", evidence_requirement_id: "ER-01", observed_value: false, paths: ["src/example.ts"] }
    }, declarativeDefaults());
    const verdictPromise = engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "ancora",
      evidence_ids: failed.evidence_ids,
      next_step: "formato"
    });
    await expect(verdictPromise).rejects.toThrow(/^SPT_V3_CRITERION_COVERAGE_REQUIRED: [^;]+; missing=C-01,C-02; details=\[/);
  });

  // review-fixes: caminho verde do multi-criterio-por-prova — prova unica
  // passed cobrindo C-01 e C-02 aprova o verdict (semantica central do ER com proves multiplos).
  it("verde multi-criterio: prova unica passed cobrindo C-01 e C-02 aprova o verdict", async () => {
    const passed = await addDeclarativeEvidence(engine, engine, {
      flow_id: flowId,
      title: "verde multi",
      kind: "goal_evidence",
      declarative_proof: { task_id: "A-01", evidence_requirement_id: "ER-01", observed_value: true, paths: ["src/example.ts"] }
    }, declarativeDefaults());
    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "multi-criterio verde",
      evidence_ids: passed.evidence_ids,
      next_step: "cobertura por prova unica"
    });
    expect((verdict.verdict as Record<string, unknown>).status).toBe("pronto_com_ressalvas");
  });
});

function v3Document(ws: string): string {
  return [
    "---",
    "dex_contract: spt",
    "version: 3",
    "status: AUTORIZADO",
    "owner: sprinter",
    "date: '2026-11-07'",
    `workspace: ${JSON.stringify(ws)}`,
    "origin: fixture diagnostico cobertura",
    "goal:",
    "  id: provar-diagnostico-cobertura",
    "  title: Provar diagnostico de cobertura",
    "  objective: Provar diagnostico de cobertura",
    "context: Fixture sintetica sem payload privado.",
    "problem: Verdict cego esconde o campo reprovado.",
    "decision: Diagnostico por criterio no erro.",
    "scope:",
    "  include: [Validar fixture.]",
    "  exclude: [Alterar produto.]",
    "requirements:",
    "  - id: REQ-01",
    "    statement: O resultado deve ser observavel.",
    "    criteria:",
    "      - id: C-01",
    "        statement: Criterio um.",
    "      - id: C-02",
    "        statement: Criterio dois.",
    "plan: [Executar a task.]",
    "tasks:",
    "  - id: A-01",
    "    action: Executar assercao.",
    "    covers: [REQ-01]",
    "    done_when: [C-01, C-02]",
    "    depends_on: []",
    "    evidence_requirements:",
    "      - id: ER-01",
    "        proves: [C-01, C-02]",
    "        method: test",
    "        procedure: Executar assercao e registrar o booleano.",
    "        expectation:",
    "          kind: boolean_assertion",
    "          expected: true",
    "closure_gates: [Review e teste possuem receipts independentes.]",
    "risks: [Falso verde.]",
    "uncertainties: [Nenhuma na fixture.]",
    "gates: [A prova deve citar ER-01.]",
    "validation: [vitest run tests/spt-verdict-coverage-diagnostics.test.ts]",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute esta fixture.",
    "---",
    "# Fixture SPT v3 diagnostico de cobertura"
  ].join("\n");
}

describe("Onda 2: sentinela de admissao v3 mora no SSOT (assertCriterionProofAdmission)", () => {
  it("RED->GREEN Onda 2: os 3 casos de admissao como politica pura do spt-traceability", async () => {
    const { assertCriterionProofAdmission } = await import("../src/spt-traceability.js");
    const proofInput = {
      task_id: "A-01",
      requirement_id: "REQ-01",
      criterion_id: "C-01",
      evidence_requirement_id: "ER-01",
      observed_value: true,
      environment: "node v24 test",
      producer: "teste unitario Onda 2",
      limits: ["teste unitario"],
      timestamp: "2026-11-08T13:20:00.000Z",
      revision_set: [{ workspace: "C:\workspace-teste", paths: [{ path: "src/a.ts", sha256: "a".repeat(64) }] }]
    };
    const flowV2 = { spt_contract_version: 2, spt_traceability: null } as never;
    expect(() => assertCriterionProofAdmission(flowV2, { criterion_proof: proofInput }))
      .toThrow(/SPT_V3_EVIDENCE_INVALID: criterion_proof requires a flow bound to SPT v3/);
    const flowV3SemMapa = { spt_contract_version: 3, spt_traceability: null } as never;
    expect(() => assertCriterionProofAdmission(flowV3SemMapa, { criterion_proof: proofInput }))
      .toThrow(/SPT_V3_TRACEABILITY_MISSING: criterion_proof requires the bound canonical traceability map/);
    const flowV3ComMapa = { spt_contract_version: 3, spt_traceability: {
      tasks: [{ id: "A-01", covers: ["REQ-01"], done_when: ["C-01"], evidence_requirements: [{ id: "ER-01", proves: ["C-01"], method: "test", procedure: "p", expectation: { kind: "boolean_assertion", expected: true } }] }],
      requirements: [{ id: "REQ-01", criteria: [{ id: "C-01" }] }]
    } } as never;
    const admitted = assertCriterionProofAdmission(flowV3ComMapa, { criterion_proof: proofInput });
    // Corte de cura (gap adversarial 2b): conteudo da admissao, nao apenas presenca.
    expect(admitted).toMatchObject({ criterion_id: "C-01", passed: true });
    expect(String(admitted?.evaluation ?? "")).toContain("true");
    expect(() => assertCriterionProofAdmission(flowV3ComMapa, { criterion_proof: undefined })).not.toThrow();
  });
});
