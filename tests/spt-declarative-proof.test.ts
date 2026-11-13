import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertCriterionProofRevisionCurrent,
  buildEvidenceRevision,
  criterionProjection,
  evidenceRequirementProjection,
  qualifyCriterionProof,
  requiresGoalEvidence,
  taskProjection,
  type CriterionProofInput
} from "../src/spt-traceability.js";
import {
  buildProofSkeletons,
  expandDeclarativeProof,
  type DeclarativeProofDefaults
} from "../src/spt-declarative-proof.js";
import type { SptV3Traceability } from "../src/domain.js";

let tempRoot: string;
let workspace: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-declarative-"));
  workspace = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "example.ts"), "export const result = true;\n", "utf8");
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

const defaults: DeclarativeProofDefaults = {
  environment: "vitest fixture",
  producer: "spt-declarative-proof.test",
  limits: ["fixture local"]
};

describe("expandDeclarativeProof", () => {
  it("expands one declaration into one full criterion proof per criterion with server-side revision", async () => {
    const proofs = await expandDeclarativeProof(
      traceability(),
      workspace,
      {
        task_id: "A-01",
        evidence_requirement_id: "ER-01",
        observed_value: 0,
        paths: ["src/example.ts"],
        command: "npm run check"
      },
      defaults,
      () => "2026-10-14T00:00:00.000Z"
    );

    expect(proofs).toHaveLength(2);
    expect(proofs.map((proof) => proof.criterion_id)).toEqual(["C-01", "C-02"]);
    for (const proof of proofs) {
      expect(proof.task_id).toBe("A-01");
      expect(proof.requirement_id).toBe("REQ-01");
      expect(proof.evidence_requirement_id).toBe("ER-01");
      expect(proof.observed_value).toBe(0);
      expect(proof.environment).toBe("vitest fixture");
      expect(proof.producer).toBe("spt-declarative-proof.test");
      expect(proof.timestamp).toBe("2026-10-14T00:00:00.000Z");
      expect(proof.limits).toEqual(["fixture local", "command: npm run check"]);
      expect(proof.revision_set).toHaveLength(1);
      expect(proof.revision_set[0].workspace).toBe(workspace);
      expect(proof.revision_set[0].paths[0].path).toBe("src/example.ts");
      expect(proof.revision_set[0].paths[0].sha256).toBe(await sha256File(path.join(workspace, "src", "example.ts")));
    }
  });

  it("fails loud with SPT_V3_DECLARATIVE_OBSERVED_TYPE teaching the crude type per expectation kind", async () => {
    await expect(expandDeclarativeProof(
      traceability(),
      workspace,
      { task_id: "A-01", evidence_requirement_id: "ER-01", observed_value: { exit_code: 0 }, paths: ["src/example.ts"] },
      defaults
    )).rejects.toThrow(/SPT_V3_DECLARATIVE_OBSERVED_TYPE: ER-01 \(kind command_exit\): send observed_value as the integer exit code/);

    await expect(expandDeclarativeProof(
      traceability(),
      workspace,
      { task_id: "A-02", evidence_requirement_id: "ER-02", observed_value: 1, paths: ["src/example.ts"] },
      defaults
    )).rejects.toThrow(/SPT_V3_DECLARATIVE_OBSERVED_TYPE: ER-02 \(kind boolean_assertion\): send observed_value as boolean true/);

    await expect(expandDeclarativeProof(
      traceability(),
      workspace,
      { task_id: "A-03", evidence_requirement_id: "ER-03", observed_value: true, paths: ["src/example.ts"] },
      defaults
    )).rejects.toThrow(/SPT_V3_DECLARATIVE_OBSERVED_TYPE: ER-03 \(kind measurement\): send observed_value as a finite number/);

    await expect(expandDeclarativeProof(
      traceability(),
      workspace,
      { task_id: "A-04", evidence_requirement_id: "ER-04", observed_value: 0, paths: ["src/example.ts"] },
      defaults
    )).rejects.toThrow(/SPT_V3_DECLARATIVE_OBSERVED_TYPE: ER-04 \(kind text\): send observed_value as the observed text string/);

    await expect(expandDeclarativeProof(
      traceability(),
      workspace,
      { task_id: "A-05", evidence_requirement_id: "ER-05", observed_value: { left: "abc" }, paths: ["src/example.ts"] },
      defaults
    )).rejects.toThrow(/SPT_V3_DECLARATIVE_OBSERVED_TYPE: ER-05 \(kind hash_equality\): send observed_value as \{"left_sha256"/);
  });

  it("rejects unknown task or evidence requirement not owned by the task", async () => {
    await expect(expandDeclarativeProof(
      traceability(),
      workspace,
      { task_id: "A-404", evidence_requirement_id: "ER-01", observed_value: 0, paths: ["src/example.ts"] },
      defaults
    )).rejects.toThrow(/SPT_V3_DECLARATIVE_INVALID: unknown_task: A-404/);

    await expect(expandDeclarativeProof(
      traceability(),
      workspace,
      { task_id: "A-01", evidence_requirement_id: "ER-404", observed_value: 0, paths: ["src/example.ts"] },
      defaults
    )).rejects.toThrow(/SPT_V3_DECLARATIVE_INVALID: evidence_requirement_not_owned_by_task: ER-404\/A-01/);
  });
});

describe("buildEvidenceRevision (server-side hashing)", () => {
  it("computes the sha256 of live workspace files with the same path safety rules", async () => {
    const revision = await buildEvidenceRevision(workspace, ["src/example.ts"]);
    expect(revision.workspace).toBe(workspace);
    expect(revision.paths).toEqual([
      { path: "src/example.ts", sha256: await sha256File(path.join(workspace, "src", "example.ts")) }
    ]);
  });

  it("rejects absolute paths with the existing security codes", async () => {
    await expect(buildEvidenceRevision(workspace, [path.join(workspace, "src", "example.ts")]))
      .rejects.toThrow(/SPT_V3_EVIDENCE_INVALID: revision_path_must_be_relative/);
  });

  it("rejects sensitive paths with the existing security codes", async () => {
    await writeFile(path.join(workspace, ".env"), "SYNTHETIC_PROBE_ONLY=true\n", "utf8");
    await expect(buildEvidenceRevision(workspace, [".env"]))
      .rejects.toThrow(/SPT_V3_EVIDENCE_INVALID: revision_path_sensitive/);
  });

  it("rejects paths outside the workspace with the existing security codes", async () => {
    await expect(buildEvidenceRevision(workspace, ["../escape.ts"]))
      .rejects.toThrow(/SPT_V3_EVIDENCE_INVALID: revision_path_outside_workspace/);
  });

  it("fails loud on missing paths instead of hashing silence", async () => {
    await expect(buildEvidenceRevision(workspace, ["src/missing.ts"]))
      .rejects.toThrow(/SPT_V3_EVIDENCE_INVALID: revision_path_missing: src\/missing\.ts/);
  });
});

describe("buildProofSkeletons", () => {
  it("documents the crude observed type and a ready declarative payload per evidence requirement", () => {
    const skeletons = buildProofSkeletons(traceability(), "flow-fixture");
    const first = skeletons.find((skeleton) => skeleton.evidence_requirement_id === "ER-01");
    expect(first).toMatchObject({
      task_id: "A-01",
      evidence_requirement_id: "ER-01",
      proves: ["C-01", "C-02"],
      method: "command",
      observed_value_type: "integer exit code (number)",
      declarative_payload: {
        flow_id: "flow-fixture",
        declarative_proof: {
          task_id: "A-01",
          evidence_requirement_id: "ER-01",
          observed_value: "0",
          paths: []
        }
      }
    });
  });
});

function traceability(): SptV3Traceability {
  return {
    requirements: [
      {
        id: "REQ-01",
        statement: "Comando de bateria",
        criteria: [
          { id: "C-01", statement: "criterio um" },
          { id: "C-02", statement: "criterio dois" }
        ]
      }
    ],
    tasks: [
      {
        id: "A-01",
        action: "Rodar bateria",
        covers: ["REQ-01"],
        done_when: ["C-01", "C-02"],
        depends_on: [],
        evidence_requirements: [
          {
            id: "ER-01",
            proves: ["C-01", "C-02"],
            method: "command",
            procedure: "Rodar npm run check",
            expectation: { kind: "command_exit", expected_exit_code: 0 }
          }
        ]
      },
      {
        id: "A-02",
        action: "Checar booleano",
        covers: ["REQ-01"],
        done_when: ["C-01"],
        depends_on: [],
        evidence_requirements: [
          {
            id: "ER-02",
            proves: ["C-01"],
            method: "test",
            procedure: "Assercao booleana",
            expectation: { kind: "boolean_assertion", expected: true }
          }
        ]
      },
      {
        id: "A-03",
        action: "Medir",
        covers: ["REQ-01"],
        done_when: ["C-01"],
        depends_on: [],
        evidence_requirements: [
          {
            id: "ER-03",
            proves: ["C-01"],
            method: "inspection",
            procedure: "Medicao",
            expectation: { kind: "measurement", operator: "lte", expected: 5, unit: "min" }
          }
        ]
      },
      {
        id: "A-04",
        action: "Conferir texto",
        covers: ["REQ-01"],
        done_when: ["C-01"],
        depends_on: [],
        evidence_requirements: [
          {
            id: "ER-04",
            proves: ["C-01"],
            method: "inspection",
            procedure: "Texto",
            expectation: { kind: "text", operator: "contains", expected: "pronto" }
          }
        ]
      },
      {
        id: "A-05",
        action: "Comparar hash",
        covers: ["REQ-01"],
        done_when: ["C-01"],
        depends_on: [],
        evidence_requirements: [
          {
            id: "ER-05",
            proves: ["C-01"],
            method: "receipt",
            procedure: "Hash",
            expectation: { kind: "hash_equality" }
          }
        ]
      }
    ]
  };
}

async function sha256File(filePath: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

describe("rede D-47: caracterizacao do qualifyCriterionProof por mutacao de amostra", () => {
  // Lacunas pagas com teste (M1b/M2b/M5b/M6b/M8b sobreviveram 914/914 no repo;
  // congeladas em .agents/AUDITORIAS/2026-11-13-rede-spt-traceability/MUTACOES/).

  function validInput(overrides: Partial<CriterionProofInput> = {}): CriterionProofInput {
    return {
      task_id: "A-01",
      requirement_id: "REQ-01",
      criterion_id: "C-01",
      evidence_requirement_id: "ER-01",
      observed_value: 0,
      environment: "vitest fixture",
      producer: "spt-declarative-proof.test",
      limits: ["fixture local"],
      timestamp: "2026-10-14T00:00:00.000Z",
      revision_set: [],
      ...overrides
    };
  }

  function richTraceability(): SptV3Traceability {
    return {
      requirements: [
        { id: "REQ-01", statement: "Eixo um", criteria: [{ id: "C-01", statement: "c1" }, { id: "C-02", statement: "c2" }] },
        { id: "REQ-02", statement: "Eixo dois", criteria: [{ id: "C-09", statement: "c9" }] }
      ],
      tasks: [
        {
          id: "A-01", action: "Eixo um", covers: ["REQ-01"], done_when: ["C-01", "C-02"], depends_on: [],
          evidence_requirements: [{ id: "ER-01", proves: ["C-01", "C-02"], method: "command", procedure: "run", expectation: { kind: "command_exit", expected_exit_code: 0 } }]
        },
        {
          id: "A-02", action: "Eixo um parcial", covers: ["REQ-01"], done_when: ["C-01"], depends_on: [],
          evidence_requirements: [{ id: "ER-02", proves: ["C-01"], method: "test", procedure: "run", expectation: { kind: "boolean_assertion", expected: true } }]
        },
        {
          id: "A-03", action: "Eixo um completo", covers: ["REQ-01"], done_when: ["C-01", "C-02"], depends_on: [],
          evidence_requirements: [{ id: "ER-03", proves: ["C-01"], method: "test", procedure: "run", expectation: { kind: "boolean_assertion", expected: true } }]
        }
      ]
    };
  }

  it.each([
    ["unknown_task", (i: CriterionProofInput) => i.task_id, { task_id: "A-99" }],
    ["unknown_requirement", (i: CriterionProofInput) => i.requirement_id, { requirement_id: "REQ-99" }],
    ["criterion_not_owned_by_requirement", (i: CriterionProofInput) => `${i.criterion_id}/${i.requirement_id}`, { criterion_id: "C-99" }],
    ["task_does_not_cover_requirement", (i: CriterionProofInput) => `${i.task_id}/${i.requirement_id}`, { task_id: "A-01", requirement_id: "REQ-02", criterion_id: "C-09", evidence_requirement_id: "ER-01" }],
    ["criterion_not_in_task_done_when", (i: CriterionProofInput) => `${i.task_id}/${i.criterion_id}`, { task_id: "A-02", criterion_id: "C-02" }],
    ["evidence_requirement_not_owned_by_task", (i: CriterionProofInput) => `${i.evidence_requirement_id}/${i.task_id}`, { evidence_requirement_id: "ER-02" }],
    ["evidence_requirement_does_not_prove_criterion", (i: CriterionProofInput) => `${i.evidence_requirement_id}/${i.criterion_id}`, { task_id: "A-03", evidence_requirement_id: "ER-03", criterion_id: "C-02" }]
  ] as Array<[string, (i: CriterionProofInput) => string, Partial<CriterionProofInput>]>)(
    "ownership do contrato rejeita input invalido: %s (M1b)",
    (code, detail, overrides) => {
      const trace = richTraceability();
      const input = validInput(overrides);
      expect(() => qualifyCriterionProof(trace, input)).toThrow(`SPT_V3_EVIDENCE_INVALID: ${code}: ${typeof detail === "function" ? detail(input) : detail}`);
    }
  );

  it.each([
    ["environment_required", { environment: " " }],
    ["producer_required", { producer: " " }],
    ["limits_required", { limits: [] }],
    ["timestamp_invalid", { timestamp: "not-a-date" }],
    ["revision_set_required", { revision_set: [] }],
    ["revision_workspace_required", { revision_set: [{ workspace: " ", paths: [{ path: "src/example.ts", sha256: "a".repeat(64) }] }] }],
    ["revision_paths_required", { revision_set: [{ workspace: "ws", paths: [] }] }],
    ["revision_path_required", { revision_set: [{ workspace: "ws", paths: [{ path: " ", sha256: "a".repeat(64) }] }] }],
    ["revision_sha256_invalid", { revision_set: [{ workspace: "ws", paths: [{ path: "src/example.ts", sha256: "zz" }] }] }]
  ] as Array<[string, Partial<CriterionProofInput>]>)(
    "validateProofProvenance rejeita provenance de input invalida: %s (M2b)",
    (code, overrides) => {
      const trace = traceability();
      expect(() => qualifyCriterionProof(trace, validInput(overrides))).toThrow(`SPT_V3_EVIDENCE_INVALID: ${code}`);
    }
  );

  it("assertCriterionProofRevisionCurrent rejeita prova stale com mensagem propria (R1-P1)", async () => {
    const revision = await buildEvidenceRevision(workspace, ["src/example.ts"]);
    const proof = qualifyCriterionProof(traceability(), validInput({ revision_set: [revision] }));
    await writeFile(path.join(workspace, "src", "example.ts"), "export const result = false;\n", "utf8");
    await expect(assertCriterionProofRevisionCurrent(proof, workspace))
      .rejects.toThrow("SPT_V3_EVIDENCE_STALE: criterion proof revision differs from current files; paths=src/example.ts");
  });

  it("evaluateExpectation measurement: gte passa no limite, lte passa e gte falhando reprova (M6b)", async () => {
    const revision = await buildEvidenceRevision(workspace, ["src/example.ts"]);
    const trace: SptV3Traceability = {
      requirements: [{ id: "REQ-M", statement: "Medidas", criteria: [{ id: "C-M", statement: "m" }] }],
      tasks: [{
        id: "A-M", action: "Medir", covers: ["REQ-M"], done_when: ["C-M"], depends_on: [],
        evidence_requirements: [
          { id: "ER-GTE", proves: ["C-M"], method: "measurement", procedure: "run", expectation: { kind: "measurement", operator: "gte", expected: 2, unit: "its" } },
          { id: "ER-LTE", proves: ["C-M"], method: "measurement", procedure: "run", expectation: { kind: "measurement", operator: "lte", expected: 5 } }
        ]
      }]
    };
    const base = { task_id: "A-M", requirement_id: "REQ-M", criterion_id: "C-M", revision_set: [revision] };
    const atGteLimit = qualifyCriterionProof(trace, validInput({ ...base, evidence_requirement_id: "ER-GTE", observed_value: 2 }));
    expect(atGteLimit.passed).toBe(true);
    expect(atGteLimit.evaluation).toContain("measurement 2 gte 2 its");
    const belowGte = qualifyCriterionProof(trace, validInput({ ...base, evidence_requirement_id: "ER-GTE", observed_value: 1 }));
    expect(belowGte.passed).toBe(false);
    const atLteLimit = qualifyCriterionProof(trace, validInput({ ...base, evidence_requirement_id: "ER-LTE", observed_value: 5 }));
    expect(atLteLimit.passed).toBe(true);
  });

  it("projections publicam os formatos id-first (M5b/M9/M10)", () => {
    const trace = traceability();
    const contract = trace as unknown as Parameters<typeof taskProjection>[0];
    expect(taskProjection(contract))
      .toEqual(["A-01: Rodar bateria", "A-02: Checar booleano", "A-03: Medir", "A-04: Conferir texto", "A-05: Comparar hash"]);
    expect(criterionProjection(contract as Parameters<typeof criterionProjection>[0]).slice(0, 2))
      .toEqual(["C-01 REQ-01: criterio um", "C-02 REQ-01: criterio dois"]);
    expect(evidenceRequirementProjection(contract as Parameters<typeof evidenceRequirementProjection>[0]).slice(0, 2))
      .toEqual(["ER-01 A-01: command — Rodar npm run check", "ER-02 A-02: test — Assercao booleana"]);
  });

  it("requiresGoalEvidence aceita evidence_required explicito sem policy (M8b)", () => {
    expect(requiresGoalEvidence({ goal_binding: { envelope: { evidence_required: true } } } as never)).toBe(true);
    expect(requiresGoalEvidence({ goal_binding: { envelope: { requested_verdict_policy: "evidence_required" } } } as never)).toBe(true);
    expect(requiresGoalEvidence({ goal_binding: { envelope: {} } } as never)).toBe(false);
    expect(requiresGoalEvidence({} as never)).toBe(false);
  });
});
