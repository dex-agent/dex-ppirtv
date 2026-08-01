import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { fingerprintSptContract, parseSptDocument } from "../src/spt-contract.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-spt-v3-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("SPT v3 traceability contract", () => {
  it("accepts one canonical graph and rejects disconnected or cyclic graphs", () => {
    const valid = parseSptDocument(v3Document("C:\\workspace"));
    expect(valid.checks.schema_valid).toBe(true);
    expect(valid.checks.semantics_valid).toBe(true);
    expect(valid.errors).toEqual([]);

    const disconnected = parseSptDocument(
      v3Document("C:\\workspace").replace("proves: [C-01]", "proves: [C-404]")
    );
    expect(disconnected.contract).toBeNull();
    expect(disconnected.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown_evidence_criterion"),
        expect.stringContaining("unproved_task_criterion")
      ])
    );

    const cyclic = parseSptDocument(
      v3Document("C:\\workspace").replace("depends_on: []", "depends_on: [A-01]")
    );
    expect(cyclic.contract).toBeNull();
    expect(cyclic.errors).toEqual(expect.arrayContaining([expect.stringContaining("dependency_cycle")]));

    const invalidRegex = parseSptDocument(
      v3Document("C:\\workspace").replace(
        "kind: boolean_assertion\n          expected: true",
        "kind: text\n          operator: matches\n          expected: '['"
      )
    );
    expect(invalidRegex.contract).toBeNull();
    expect(invalidRegex.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("invalid_expected_regex")])
    );
  });

  it("preserves the historical v2 fingerprint property order", () => {
    const parsed = parseSptDocument(v2Document("C:\\workspace"));
    expect(parsed.contract?.version).toBe(2);
    expect(fingerprintSptContract(parsed.contract!)).toBe(
      "8979a72335ac647d88f09fdef7f6c7e6b6dce12964923dc8aba291206c0a442f"
    );
  });

  it("keeps diagnostics on the declared v3 contract when its schema is invalid", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const engine = new FlowEngine(new PpirtvStore(path.join(workspace, ".ppirtv")));
    const invalid = v3Document(workspace).replace("requirements:", "unknown_requirements:");
    const sptPath = await writeSpt(workspace, "invalid-v3.md", invalid);

    const validation = await engine.validateSpt({
      workspace,
      spt_path: sptPath,
      objective: "Provar rastreabilidade SPT v3"
    });

    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain("spt_v3.schema");
    expect(validation.missing).not.toContain("spt_v2.schema");
    expect(validation.contract_errors).toEqual(expect.arrayContaining([expect.stringContaining("spt_v3.")]));
  });

  it("treats omitted flow_role as execution, rejects new v2, and preserves explicit recovery retries", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const engine = new FlowEngine(new PpirtvStore(path.join(workspace, ".ppirtv")));
    const v2Path = await writeSpt(workspace, "v2.md", v2Document(workspace));
    const base = {
      workspace,
      spt_path: v2Path,
      objective: "Provar transicao SPT",
      idempotency_key: "spt-v2-transition",
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required" as const,
      source: "test"
    };

    await expect(engine.startGoal(base)).rejects.toThrow(/SPT_V2_EXECUTION_MIGRATION_REQUIRED/);

    const recovery = await engine.startGoal({ ...base, flow_role: "recovery" });
    const retry = await engine.startGoal({ ...base, flow_role: "recovery" });
    expect(recovery.started).toBe(true);
    expect(retry.reused).toBe(true);
    expect(retry.flow_id).toBe(recovery.flow_id);
  });

  it("derives the expectation from the bound SPT and blocks positive verdicts without passed criterion coverage", async () => {
    const workspace = path.join(tempRoot, "workspace");
    const engine = new FlowEngine(new PpirtvStore(path.join(workspace, ".ppirtv")));
    const sptPath = await writeSpt(workspace, "v3.md", v3Document(workspace));
    const implementationPath = path.join(workspace, "src", "example.ts");
    await mkdir(path.dirname(implementationPath), { recursive: true });
    await writeFile(implementationPath, "export const result = true;\n", "utf8");
    const started = await engine.startGoal({
      workspace,
      spt_path: sptPath,
      objective: "Provar rastreabilidade SPT v3",
      idempotency_key: "spt-v3-proof",
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "test"
    });
    const flowId = started.flow_id as string;
    const revisionSet = [
      {
        workspace,
        head: "fixture",
        paths: [{ path: "src/example.ts", sha256: await sha256File(implementationPath) }]
      }
    ];
    const foreignWorkspace = path.join(tempRoot, "foreign-workspace");
    const foreignPath = path.join(foreignWorkspace, "src", "foreign.ts");
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "export const foreign = true;\n", "utf8");
    await expect(engine.addGoalEvidence({
      flow_id: flowId,
      title: "workspace nao autorizado",
      criterion_proof: {
        task_id: "A-01",
        requirement_id: "REQ-01",
        criterion_id: "C-01",
        evidence_requirement_id: "ER-01",
        observed_value: true,
        revision_set: [{
          workspace: foreignWorkspace,
          paths: [{ path: "src/foreign.ts", sha256: await sha256File(foreignPath) }]
        }],
        environment: "vitest",
        producer: "spt-contract-v3.test",
        timestamp: new Date().toISOString(),
        limits: ["fixture local"]
      }
    })).rejects.toThrow(/SPT_V3_EVIDENCE_INVALID: revision_workspace_not_authorized/);
    const sensitivePath = path.join(workspace, ".env");
    await writeFile(sensitivePath, "SYNTHETIC_PROBE_ONLY=true\n", "utf8");
    await expect(engine.addGoalEvidence({
      flow_id: flowId,
      title: "path sensivel nao autorizado",
      criterion_proof: {
        task_id: "A-01",
        requirement_id: "REQ-01",
        criterion_id: "C-01",
        evidence_requirement_id: "ER-01",
        observed_value: true,
        revision_set: [{
          workspace,
          paths: [{ path: ".env", sha256: await sha256File(sensitivePath) }]
        }],
        environment: "vitest",
        producer: "spt-contract-v3.test",
        timestamp: new Date().toISOString(),
        limits: ["fixture sintetica sem segredo"]
      }
    })).rejects.toThrow(/SPT_V3_EVIDENCE_INVALID: revision_path_sensitive/);
    const failed = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "resultado negativo",
      criterion_proof: {
        task_id: "A-01",
        requirement_id: "REQ-01",
        criterion_id: "C-01",
        evidence_requirement_id: "ER-01",
        observed_value: false,
        revision_set: revisionSet,
        environment: "vitest",
        producer: "spt-contract-v3.test",
        timestamp: new Date().toISOString(),
        limits: ["fixture local"]
      }
    });
    expect((failed.evidence as Record<string, any>).criterion_proof).toMatchObject({
      expectation: { kind: "boolean_assertion", expected: true },
      passed: false
    });
    const failedEvidence = failed.evidence as Record<string, any>;
    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "uma prova falha nao satisfaz minimo",
        evidence_ids: [failed.evidence_id as string],
        next_step: "corrigir a prova"
      })
    ).rejects.toThrow(/SPT_V3_CRITERION_COVERAGE_REQUIRED.*C-01/);

    const passed = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "resultado positivo",
      criterion_proof: {
        task_id: "A-01",
        requirement_id: "REQ-01",
        criterion_id: "C-01",
        evidence_requirement_id: "ER-01",
        observed_value: true,
        revision_set: revisionSet,
        environment: "vitest",
        producer: "spt-contract-v3.test",
        timestamp: new Date().toISOString(),
        limits: ["fixture local"]
      }
    });
    expect((passed.evidence as Record<string, any>).criterion_proof).toMatchObject({
      expectation: { kind: "boolean_assertion", expected: true },
      passed: true
    });
    await writeFile(implementationPath, "export const result = false;\n", "utf8");
    await expect(
      engine.goalVerdict({
        flow_id: flowId,
        status: "pronto_com_ressalvas",
        rationale: "prova stale nao satisfaz minimo",
        evidence_ids: [passed.evidence_id as string],
        next_step: "renovar a prova"
      })
    ).rejects.toThrow(/SPT_V3_EVIDENCE_STALE.*src\/example\.ts/);

    const refreshed = await engine.addGoalEvidence({
      flow_id: flowId,
      title: "resultado positivo renovado",
      criterion_proof: {
        task_id: "A-01",
        requirement_id: "REQ-01",
        criterion_id: "C-01",
        evidence_requirement_id: "ER-01",
        observed_value: true,
        revision_set: [{
          workspace,
          head: "fixture",
          paths: [{ path: "src/example.ts", sha256: await sha256File(implementationPath) }]
        }],
        environment: "vitest",
        producer: "spt-contract-v3.test",
        timestamp: new Date().toISOString(),
        limits: ["fixture local"]
      }
    });
    const verdict = await engine.goalVerdict({
      flow_id: flowId,
      status: "pronto_com_ressalvas",
      rationale: "cobertura minima presente; fiscais continuam independentes",
      evidence_ids: [refreshed.evidence_id as string],
      next_step: "executar fiscais pendentes"
    });
    expect((verdict.verdict as Record<string, unknown>).status).toBe("pronto_com_ressalvas");
  });
});

async function writeSpt(workspace: string, name: string, content: string): Promise<string> {
  const directory = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, name);
  await writeFile(target, content, "utf8");
  return target;
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function v3Document(workspace: string): string {
  return [
    "---",
    "dex_contract: spt",
    "version: 3",
    "status: AUTORIZADO",
    "owner: sprinter",
    "date: '2026-07-30'",
    `workspace: ${JSON.stringify(workspace)}`,
    "origin: teste causal",
    "goal:",
    "  id: provar-spt-v3",
    "  title: Provar SPT v3",
    "  objective: Provar rastreabilidade SPT v3",
    "context: Fixture sintetica sem payload privado.",
    "problem: Listas desconectadas produzem falso verde.",
    "decision: Usar grafo v3 explicito.",
    "scope:",
    "  include: [Validar fixture.]",
    "  exclude: [Alterar produto.]",
    "requirements:",
    "  - id: REQ-01",
    "    statement: O resultado deve ser observavel.",
    "    criteria:",
    "      - id: C-01",
    "        statement: A assercao deve ser verdadeira.",
    "plan: [Executar a task.]",
    "tasks:",
    "  - id: A-01",
    "    action: Executar assercao.",
    "    covers: [REQ-01]",
    "    done_when: [C-01]",
    "    depends_on: []",
    "    evidence_requirements:",
    "      - id: ER-01",
    "        proves: [C-01]",
    "        method: test",
    "        procedure: Executar a assercao e registrar o booleano.",
    "        expectation:",
    "          kind: boolean_assertion",
    "          expected: true",
    "closure_gates: [Review e teste possuem receipts independentes.]",
    "risks: [Falso verde.]",
    "uncertainties: [Nenhuma na fixture.]",
    "gates: [A prova deve citar ER-01.]",
    "validation: [vitest run tests/spt-contract-v3.test.ts]",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute esta fixture.",
    "---",
    "# Fixture SPT v3"
  ].join("\n");
}

function v2Document(workspace: string): string {
  return [
    "---",
    "dex_contract: spt",
    "version: 2",
    "status: HISTORICO",
    "owner: sprinter",
    "date: '2026-07-30'",
    `workspace: ${JSON.stringify(workspace)}`,
    "origin: teste causal",
    "goal:",
    "  id: provar-transicao-v2",
    "  title: Provar transicao v2",
    "  objective: Provar transicao SPT",
    "context: Fixture v2.",
    "problem: Nova execucao v2 e ambigua.",
    "decision: Permitir somente recuperacao explicita.",
    "scope:",
    "  include: [Validar fixture.]",
    "  exclude: [Alterar produto.]",
    "spec: Provar politica.",
    "plan: [Executar teste.]",
    "tasks: [Executar teste.]",
    "expected_evidence: [Receipt.]",
    "done_criteria: [Politica observada.]",
    "risks: [Fallback.]",
    "uncertainties: [Nenhuma.]",
    "gates: [Sem fallback.]",
    "validation: [vitest.]",
    "execution_prompt: |",
    "  /GOAL",
    "  Execute recovery.",
    "---",
    "# Fixture SPT v2"
  ].join("\n");
}
