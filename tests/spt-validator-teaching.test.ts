import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Evidence, Flow } from "../src/domain.js";
import { presentGate } from "../src/presentation.js";
import { validationSptPathDiagnostic } from "../src/spt-path-diagnostics.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALL_CHECKS_TRUE: Record<string, boolean> = {
  workspace_absolute: true,
  workspace_exists: true,
  workspace_is_directory: true,
  spt_path_not_sensitive: true,
  spt_inside_workspace: true,
  spt_under_plan_tasks: true,
  spt_exists: true,
  spt_is_file: true,
  spt_workspace_matches: true,
  spt_objective_matches: true,
  spt_frontmatter_present: true,
  spt_frontmatter_closed: true,
  spt_yaml_valid: true,
  spt_schema_valid: true,
  spt_semantics_valid: true
};

describe("validator teaches the root cause (Trilho B)", () => {
  it("semantica invalida reporta SPT_CONTRACT_INVALID, nunca o workspace mismatch falso da cascata", () => {
    const diagnostic = validationSptPathDiagnostic({
      checks: { ...ALL_CHECKS_TRUE, spt_semantics_valid: false, spt_workspace_matches: false },
      contractErrors: ["spt_v3.tasks.0.covers: campo obrigatorio ausente"]
    });

    // Antes do Trilho B: SPT_CONTRACT_WORKSPACE_MISMATCH (sintoma falso,
    // porque contract=null cascateava workspace_matches para false).
    expect(diagnostic?.code).toBe("SPT_CONTRACT_INVALID");
  });

  it("path inexistente fora de PLAN-TASKS e NOT_FOUND, nunca 'exists outside'", () => {
    const diagnostic = validationSptPathDiagnostic({
      checks: { ...ALL_CHECKS_TRUE, spt_exists: false, spt_under_plan_tasks: false },
      contractErrors: []
    });

    // Antes do Trilho B: SPT_PATH_OUTSIDE_PLAN_TASKS com a afirmacao falsa
    // "The SPT exists outside" para um arquivo que nao existe.
    expect(diagnostic?.code).toBe("SPT_PATH_NOT_FOUND");
  });

  it("arquivo EXISTENTE fora de PLAN-TASKS continua recebendo OUTSIDE_PLAN_TASKS (verdade mantida)", () => {
    const diagnostic = validationSptPathDiagnostic({
      checks: { ...ALL_CHECKS_TRUE, spt_under_plan_tasks: false },
      contractErrors: []
    });

    expect(diagnostic?.code).toBe("SPT_PATH_OUTSIDE_PLAN_TASKS");
  });

  it("workspace mismatch real (contrato valido) continua sendo reportado", () => {
    const diagnostic = validationSptPathDiagnostic({
      checks: { ...ALL_CHECKS_TRUE, spt_workspace_matches: false },
      contractErrors: []
    });

    expect(diagnostic?.code).toBe("SPT_CONTRACT_WORKSPACE_MISMATCH");
  });
});

describe("presentGate explains WHY the review stopped satisfying (Trilho B)", () => {
  const reviewEvidence: Evidence = {
    evidence_id: "evd_review_fixture",
    flow_id: "flow_fixture",
    kind: "code_review",
    title: "Review anexada antes dos changed_files",
    satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
    scope_classification: "target",
    scope_reference: "src/old-target.ts",
    observed_result: {
      diff_reviewed: true,
      reviewed_targets: ["src/old-target.ts"],
      barata_scan: true,
      searched_patterns: ["padrao"],
      findings: [],
      regression_risks: []
    },
    created_at: "2026-10-15T00:00:00.000Z"
  } as unknown as Evidence;

  const flowWithMovedScope = {
    flow_id: "flow_fixture",
    phase: "revisao",
    mode: "full",
    changed_files: ["src/server.ts"],
    scope: { in: ["src/old-target.ts"], out: [] },
    evidence: [reviewEvidence],
    parking_lot: [],
    gold_mining: [],
    cooperators: [],
    active_credits: []
  } as unknown as Flow;

  it("gate de revisao bloqueado anexa review_evidence_diagnostics com scope_reference_not_authorized", () => {
    const presented = presentGate(
      { phase: "revisao", missing: ["diff_reviewed"], next: "complete_gate_revisao" },
      flowWithMovedScope
    ) as Record<string, unknown>;

    const diagnostics = presented.review_evidence_diagnostics as { reasons: string[] } | undefined;
    expect(diagnostics).toBeDefined();
    // changed_files declarado DEPOIS da review moveu o escopo autorizado:
    // src/old-target.ts saiu do alvo e o diagnostico precisa dizer isso.
    expect(diagnostics?.reasons).toContain("scope_reference_not_authorized");
  });

  it("gate sem bloqueio de revisao nao carrega diagnostico", () => {
    const presented = presentGate(
      { phase: "implementacao", missing: [], next: "advance_to_revisao" },
      flowWithMovedScope
    ) as Record<string, unknown>;

    expect(presented.review_evidence_diagnostics).toBeUndefined();
  });
});

describe("MCP boundary teaches FLOW_NOT_FOUND (Trilho B)", () => {
  let client: Client;
  let tempWorkspace: string;

  beforeAll(async () => {
    const serverEntry = path.join(repoRoot, "dist", "index.js");
    if (!existsSync(serverEntry)) {
      throw new Error(`dist/index.js ausente em ${serverEntry} — rode npm run build antes do vitest`);
    }
    tempWorkspace = mkdtempSync(path.join(tmpdir(), "ppirtv-flow-not-found-"));
    client = new Client({ name: "flow-not-found-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      cwd: tempWorkspace,
      env: {
        ...getDefaultEnvironment(),
        PPIRTV_HOME: path.join(tempWorkspace, ".ppirtv"),
        PPIRTV_WORKSPACE: tempWorkspace
      }
    }));
  }, 60_000);

  afterAll(async () => {
    await client.close();
    rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it("evidence_add em flow inexistente recebe FLOW_NOT_FOUND com rota, nao ENOENT cru", async () => {
    const response = await client.callTool({
      name: "evidence_add",
      arguments: {
        flow_id: "flow_nao_existe_neste_runtime",
        kind: "goal_evidence",
        title: "Probe de flow inexistente"
      }
    }) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text ?? "";
    // Antes do Trilho B: ENOENT nativo sob PPIRTV_TOOL_ERROR com
    // next_required_action null.
    expect(text).toContain("FLOW_NOT_FOUND");
    expect(text).toContain("flow_nao_existe_neste_runtime");
    expect(text).toContain("goal_status");
    // A mensagem principal ensina; o ENOENT cru fica apenas como
    // rastreabilidade em details.original_error, nunca na primeira linha.
    expect(text.split("\n")[0]).not.toMatch(/ENOENT: no such file/);
  }, 60_000);
});
