import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { changedFilesContainCode, providedRequirementSatisfied } from "../src/gate-resolution.js";
import { addDeclarativeEvidence, declarativeDefaults } from "../src/spt-declarative-proof.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DexMemoriaV2Executor, DexMemoriaV2FlowWriterConfig } from "../src/memory/dex-memoria-v2-adapter.js";

// SPT gate-integrity-hardening-2 (T-1): bateria RED dos probes R1-R6 do laudo
// de revalidacao .agents/REVIEWS/2026-10-18-laudo-gate-integrity-fix-revalidation.md.
// Cada teste reproduz um probe do laudo no nivel engine (as tools legadas
// gate_check/flow_advance/flow_return/goal_regress roteiam para os mesmos
// metodos publicos usados aqui).

const SYNTHETIC_TOKEN = `ghp_${"a".repeat(36)}`;

let tempRoot = "";

function fakeSpt(workspace: string, objective: string, risks: string[]): string {
  return [
    "---", "dex_contract: spt", "version: 3", "status: EM_TESTE", "owner: Teste",
    "date: '2026-10-18'", `workspace: ${JSON.stringify(workspace)}`, "origin: teste h2",
    "goal:", "  id: fake-goal-h2", "  title: Fake GOAL H2",
    `  objective: ${JSON.stringify(objective)}`,
    "context: Fixture sintetica da revalidacao de gate integrity.",
    "problem: Probes A-F do laudo.", "decision: RED primeiro.",
    "scope:", "  include:", "    - Validar gates.", "  exclude:", "    - Externo.",
    "requirements:",
    "  - id: REQ-01", "    statement: O flow deve iniciar para o probe.",
    "    criteria:",
    "      - id: C-01", "        statement: goal_start retorna flow_id.",
    "plan: [Probe.]", "tasks:",
    "  - id: A-01", "    action: Chamar goal_start e validar gates.", "    covers: [REQ-01]",
    "    done_when: [C-01]", "    depends_on: []",
    "    evidence_requirements:",
    "      - id: ER-01", "        proves: [C-01]", "        method: test",
    "        procedure: Observar flow_id.",
    "        expectation:", "          kind: boolean_assertion", "          expected: true",
    "closure_gates: [Nenhum para o probe.]",
    "risks:", ...risks.map((risk) => `  - ${JSON.stringify(risk)}`),
    "uncertainties:", "  - nenhuma.", "gates:", "  - preenchidos.",
    "validation:", "  - vitest local.", "execution_prompt: |", "  /GOAL", "---", "# t", ""
  ].join("\n");
}

function configuredWriter(): DexMemoriaV2FlowWriterConfig {
  return {
    profile: "v2",
    executor: vi.fn() as unknown as DexMemoriaV2Executor,
    memory_home: path.join(tempRoot, "memory-home"),
    workspace_root: path.join(tempRoot, "workspace"),
  };
}

async function fixtureGoal(objective: string, risks: string[] = ["Risco de fixture."], riskLevel = "medium") {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "h2-reval-"));
  const engine = new FlowEngine(
    new PpirtvStore(path.join(tempRoot, "workspace", ".ppirtv")),
    undefined,
    { memory_writer: configuredWriter() }
  );
  const workspace = path.join(tempRoot, "workspace");
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-10-18-fake-goal-h2.md");
  await writeFile(sptPath, fakeSpt(workspace, objective, risks), "utf8");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  const started = (await engine.startGoal({
    workspace, spt_path: sptPath, objective,
    idempotency_key: `h2-${Math.random().toString(36).slice(2, 8)}`,
    evidence_required: true, required_evidence: ["npm run check"],
    risk_level: riskLevel,
    requested_verdict_policy: "evidence_required", source: "dex-code"
  } as never)) as Record<string, unknown>;
  return { engine, tempRoot, workspace, flowId: String(started.flow_id) };
}

type Fixture = Awaited<ReturnType<typeof fixtureGoal>>;

async function flowJsonText(f: Fixture): Promise<string> {
  const flow = await f.engine.store.loadFlow(f.flowId);
  return JSON.stringify(flow);
}

async function attachTestReceipt(f: Fixture) {
  return (await f.engine.attachEvidence({
    flow_id: f.flowId,
    kind: "test",
    title: "Suite de fixture (2 passed | 0 failed | exit 0)",
    content: "Probe interno da bateria de revalidacao.",
    observed_result: { passed: 2, failed: 0, exit_code: 0 }
  } as never)) as Record<string, unknown>;
}

// Escada compacta ate revisao com gate PASSED: o advance de concepcao grava o
// provided na fase de ORIGEM, portanto o gate de implementacao precisa de um
// check proprio (que tambem mergeia changed_files no flow) antes do advance.
async function attachStructuredReview(f: Fixture, changedFile: string) {
  const status = (await f.engine.goalStatus({ flow_id: f.flowId, detail: "full" } as never)) as Record<string, unknown>;
  const fingerprint = String(status.implementation_fingerprint ?? "");
  return (await f.engine.attachEvidence({
    flow_id: f.flowId,
    kind: "code_review",
    title: `Review estruturada do fixture (${changedFile})`,
    content: `Escopo: ${changedFile}. Achados: nenhum bloqueante. Decisao: liberar.`,
    satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
    observed_result: {
      diff_reviewed: true,
      reviewed_targets: [changedFile],
      barata_scan: true,
      searched_patterns: ["consumidores vizinhos no fixture"],
      findings: [],
      regression_risks: ["nenhuma no fixture"]
    },
    scope_classification: "target",
    scope_reference: changedFile,
    reviewed_implementation_fingerprint: fingerprint
  } as never)) as Record<string, unknown>;
}

async function climbToRevisao(f: Fixture, changedFile = "src/a.ts") {
  await f.engine.goalAdvance({
    flow_id: f.flowId,
    provided: { implementation_done: true, changed_files: [changedFile] }
  } as never);
  const implGate = (await f.engine.goalGateCheck({
    flow_id: f.flowId,
    provided: { implementation_done: true, changed_files: [changedFile] }
  } as never)) as Record<string, unknown>;
  expect(implGate.status).toBe("passed");
  await f.engine.goalAdvance({ flow_id: f.flowId } as never);
  await attachTestReceipt(f);
  await attachStructuredReview(f, changedFile);
  return (await f.engine.goalGateCheck({
    flow_id: f.flowId,
    provided: { diff_reviewed: true, barata_scan: true, test_executed: true }
  } as never)) as Record<string, unknown>;
}

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("gate-integrity-revalidation (laudo 2026-10-18, R1-R6)", () => {
  it("R1/C-1: flow_return forward (concepcao -> validacao compacto) rejeita com erro tipado e preserva a fase", async () => {
    const f = await fixtureGoal("Probe R1 forward jump.");
    await expect(
      f.engine.returnTo({ flow_id: f.flowId, to: "validacao", reason: "probe forward" })
    ).rejects.toThrow(/PPIRTV_PHASE_RETURN_MUST_GO_BACK/);
    const flow = await f.engine.store.loadFlow(f.flowId);
    expect(flow.phase).toBe("concepcao");
  });

  it("R1/C-1 (nao-regressao): retorno para fase anterior estrito continua valido e invalida gates a partir do destino", async () => {
    const f = await fixtureGoal("Probe R1 regressao legitima.");
    const gate = await climbToRevisao(f);
    expect(gate.status).toBe("passed");
    const returned = (await f.engine.returnTo({
      flow_id: f.flowId, to: "implementacao", reason: "retorno legitimo"
    })) as Record<string, unknown>;
    expect((returned as { phase?: string }).phase).toBe("implementacao");
    const flow = await f.engine.store.loadFlow(f.flowId);
    expect(flow.gates.revisao).toBeUndefined();
  });

  it("R2/C-2: requisitos source=flow rejeitam [], 'false', 0 e {} como prova (sem fallback truthy)", async () => {
    const f = await fixtureGoal("Probe R2 source=flow junk.");
    await f.engine.updateFlowFacts(f.flowId, { tasks: [], done_criteria: [] });
    for (const junk of [[], "false", 0, {}]) {
      const gate = (await f.engine.checkGate({
        flow_id: f.flowId,
        provided: { tasks: junk, done_criteria: junk }
      } as never)) as Record<string, unknown>;
      expect(gate.status).toBe("blocked");
      expect(gate.missing).toContain("tasks");
      expect(gate.missing).toContain("done_criteria");
    }
  });

  it("R10/C-2: chave provided desconhecida falha fechada (nao cai em truthy)", () => {
    expect(providedRequirementSatisfied("chave_que_nao_existe", "qualquer texto")).toBe(false);
    expect(providedRequirementSatisfied("outra_chave", ["lista"])).toBe(false);
  });

  it("R8: preflight do gate bloqueado expoe diagnostico field/received/expected do valor recusado", async () => {
    const f = await fixtureGoal("Probe R8 diagnostico no preflight.");
    const preflight = (await f.engine.goalGatePreflight({
      flow_id: f.flowId,
      phase: "revisao",
      provided: { diff_reviewed: "false" }
    } as never)) as { required: Array<{ key: string; diagnostic?: { field: string; received: string; expected: string } }> };
    const item = preflight.required.find((entry) => entry.key === "diff_reviewed");
    expect(item?.diagnostic).toMatchObject({
      field: "diff_reviewed",
      received: 'string "false"',
      expected: "boolean true"
    });
  });

  it("R3/C-3: mudanca de conteudo same-path (fingerprint muda, paths iguais) bloqueia o reuse e o avanco", async () => {
    const f = await fixtureGoal("Probe R3 fingerprint no reuse.");
    const gate = await climbToRevisao(f);
    expect(gate.status).toBe("passed");
    await writeFile(path.join(f.workspace, "src", "a.ts"), "export const a = 2;\n", "utf8");
    const advance = (await f.engine.goalAdvance({ flow_id: f.flowId } as never)) as Record<string, unknown>;
    expect(advance.advanced).toBe(false);
    const flow = await f.engine.store.loadFlow(f.flowId);
    expect(flow.phase).toBe("revisao");
    expect(flow.gates.revisao?.status ?? "recheck").not.toBe("passed");
  });

  it("R3/C-3 (nao-regressao): snapshot identico (conteudo igual) continua reutilizavel", async () => {
    const f = await fixtureGoal("Probe R3 reuse legitimo.");
    const gate = await climbToRevisao(f);
    expect(gate.status).toBe("passed");
    const advance = (await f.engine.goalAdvance({ flow_id: f.flowId } as never)) as Record<string, unknown>;
    expect(advance.advanced).toBe(true);
    const flow = await f.engine.store.loadFlow(f.flowId);
    expect(flow.phase).toBe("validacao");
  });

  it("R4/C-4: gate_check (engine.checkGate) rejeita provided com segredo antes de persistir; flow JSON limpo", async () => {
    const f = await fixtureGoal("Probe R4 segredo no gate_check.");
    await expect(
      f.engine.checkGate({
        flow_id: f.flowId,
        provided: { context: `token ${SYNTHETIC_TOKEN}` }
      } as never)
    ).rejects.toThrow(/secret/i);
    expect(await flowJsonText(f)).not.toContain(SYNTHETIC_TOKEN);
  });

  it("R4/C-4: flow_advance (engine.advance) rejeita provided com segredo antes de persistir; flow JSON limpo", async () => {
    const f = await fixtureGoal("Probe R4 segredo no flow_advance.");
    await expect(
      f.engine.advance({
        flow_id: f.flowId,
        provided: { next_step: `Bearer ${SYNTHETIC_TOKEN}` }
      } as never)
    ).rejects.toThrow(/secret/i);
    expect(await flowJsonText(f)).not.toContain(SYNTHETIC_TOKEN);
  });

  it("R4/C-4: goal_start rejeita SPT com segredo em risks antes de criar o flow", async () => {
    await expect(
      fixtureGoal("Probe R4 SPT risks.", [`Risco com token ${SYNTHETIC_TOKEN} dentro.`])
    ).rejects.toThrow(/secret/i);
  });

  it("R5/C-5: prova declarativa SPT v3 com criterion_proof aprovado satisfaz o requisito generico de evidence", async () => {
    const f = await fixtureGoal("Probe R5 v3 declarativo.");
    // Sem receipt de teste: o gate de revisao so pode passar pela rota
    // declarativa (criterion_proof) — isola o probe R5 do atalho isTestReceipt.
    await f.engine.goalAdvance({
      flow_id: f.flowId,
      provided: { implementation_done: true, changed_files: ["src/a.ts"] }
    } as never);
    const implGate = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { implementation_done: true, changed_files: ["src/a.ts"] }
    } as never)) as Record<string, unknown>;
    expect(implGate.status).toBe("passed");
    await f.engine.goalAdvance({ flow_id: f.flowId } as never);
    await attachStructuredReview(f, "src/a.ts");
    await addDeclarativeEvidence(
      f.engine as never,
      f.engine as never,
      {
        flow_id: f.flowId,
        title: "ER-01 probe declarativo",
        declarative_proof: {
          task_id: "A-01",
          evidence_requirement_id: "ER-01",
          observed_value: true,
          paths: ["src/a.ts"]
        }
      },
      declarativeDefaults()
    );
    const gate = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { diff_reviewed: true, barata_scan: true, test_executed: true }
    } as never)) as Record<string, unknown>;
    expect(gate.status).toBe("passed");
    expect(gate.missing).toEqual([]);
  });

  it("R6/C-6: arquivo sem extensao (scripts/deploy, Makefile, Dockerfile) e .vue/.mts contam como codigo; doc-only mantem fast-track", () => {
    expect(changedFilesContainCode(["scripts/deploy"])).toBe(true);
    expect(changedFilesContainCode(["Makefile"])).toBe(true);
    expect(changedFilesContainCode(["Dockerfile"])).toBe(true);
    expect(changedFilesContainCode(["src/Component.vue"])).toBe(true);
    expect(changedFilesContainCode(["src/index.mts"])).toBe(true);
    expect(changedFilesContainCode(["docs/note.md"])).toBe(false);
    expect(changedFilesContainCode(["README.txt"])).toBe(false);
  });

  it("R6/C-6 (integracao): envelope mechanical com scripts/deploy exige review no veredito (nao completa pronto)", async () => {
    const f = await fixtureGoal("Probe R6 extensionless mechanical.", ["Risco de fixture."], "mechanical");
    await mkdir(path.join(f.workspace, "scripts"), { recursive: true });
    await writeFile(path.join(f.workspace, "scripts", "deploy"), "#!/bin/sh" + String.fromCharCode(10) + "echo deploy" + String.fromCharCode(10), "utf8");
    // Escada SEM review estruturada: o gate de revisao aceita claims
    // provided (formato F4-legacy que o laudo quer ver pego pelo fiscal),
    // mas scripts/deploy e codigo — o veredito tem que exigir review real.
    await f.engine.goalAdvance({
      flow_id: f.flowId,
      provided: { implementation_done: true, changed_files: ["scripts/deploy"] }
    } as never);
    const implGate = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: { implementation_done: true, changed_files: ["scripts/deploy"] }
    } as never)) as Record<string, unknown>;
    expect(implGate.status).toBe("passed");
    await f.engine.goalAdvance({ flow_id: f.flowId } as never);
    await attachTestReceipt(f);
    const revisaoGate = (await f.engine.goalGateCheck({
      flow_id: f.flowId,
      provided: {
        diff_reviewed: true,
        barata_scan: true,
        test_executed: true,
        regression_risks: ["nenhuma declarada pelo agente (probe)"],
        review_findings: ["probe sem review real de proposito"]
      }
    } as never)) as Record<string, unknown>;
    expect(revisaoGate.status).toBe("passed");
    await f.engine.goalAdvance({ flow_id: f.flowId } as never);
    await addDeclarativeEvidence(
      f.engine as never,
      f.engine as never,
      {
        flow_id: f.flowId,
        title: "ER-01 probe declarativo R6",
        declarative_proof: {
          task_id: "A-01",
          evidence_requirement_id: "ER-01",
          observed_value: true,
          paths: ["scripts/deploy"]
        }
      },
      declarativeDefaults()
    );
    const flowForEvidence = await f.engine.store.loadFlow(f.flowId);
    const declarativeIds = flowForEvidence.evidence
      .filter((evidence) => evidence.criterion_proof)
      .map((evidence) => evidence.evidence_id);
    expect(declarativeIds.length).toBeGreaterThan(0);
    await expect(
      f.engine.goalVerdict({
        flow_id: f.flowId,
        status: "pronto",
        rationale: "Probe mechanical extensionless.",
        evidence_ids: declarativeIds,
        review_findings: ["probe sem review real de proposito"]
      } as never)
    ).rejects.toThrow(/review_required/);
  });
});

// Sobe ate revisao com gate passed (sem a parte do review evidence, pois o
// probe R6 opera sem review valida de proposito).
async function climbToRevisaoGateOnly(f: Fixture, changedFile = "src/a.ts") {
  await f.engine.goalAdvance({
    flow_id: f.flowId,
    provided: { implementation_done: true, changed_files: [changedFile] }
  } as never);
  const implGate = (await f.engine.goalGateCheck({
    flow_id: f.flowId,
    provided: { implementation_done: true, changed_files: [changedFile] }
  } as never)) as Record<string, unknown>;
  expect(implGate.status).toBe("passed");
  await f.engine.goalAdvance({ flow_id: f.flowId } as never);
  await attachTestReceipt(f);
  await attachStructuredReview(f, changedFile);
  return (await f.engine.goalGateCheck({
    flow_id: f.flowId,
    provided: { diff_reviewed: true, barata_scan: true, test_executed: true }
  } as never)) as Record<string, unknown>;
}

async function climbToValidacaoWithGate(f: Fixture) {
  await climbToRevisaoGateOnly(f, "scripts/deploy");
  await f.engine.goalAdvance({ flow_id: f.flowId } as never);
}
