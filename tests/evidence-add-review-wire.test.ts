import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(repoRoot, "dist", "index.js");

// Wire do evidence_add (SPT review-gate-loop-proof, T-1): payload de review
// com observed_result aninhado (a forma exata do incidente 2026-10-17 —
// ~60 retries porque o wire aceitava qualquer shape) deve morrer na
// VALIDACAO DE ENTRADA, antes de gravar evidencia ou emitir evento.
type CallResult = { isError?: boolean; content?: Array<{ type: string; text?: string }> };

async function callEvidenceAdd(client: Client, args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: "evidence_add", arguments: args }) as CallResult;
}

describe("evidence_add review wire rejeita shape aninhado no input (T-1)", () => {
  let client: Client;
  let tempWorkspace: string;

  beforeAll(async () => {
    if (!existsSync(serverEntry)) {
      throw new Error(`dist/index.js ausente em ${serverEntry} — rode npm run build antes do vitest`);
    }
    tempWorkspace = mkdtempSync(path.join(tmpdir(), "ppirtv-wire-ws-"));
    client = new Client({ name: "wire-input-test", version: "1.0.0" });
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

  it("rejeita na entrada o observed_result aninhado (forma do incidente) ensinando campo, recebido e esperado", async () => {
    const response = await callEvidenceAdd(client, {
      flow_id: "flow_wire_probe_inexistente",
      kind: "code_review",
      title: "Revisao estruturada",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: { true: true, reviewed_targets: ["a.php"] },
        barata_scan: { true: true, searched_patterns: ["x"] },
        findings: { F1: "achado" },
        regression_risks: { R1: "risco" }
      },
      scope_classification: "target",
      scope_reference: "a.php"
    });
    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text ?? "";
    expect(text).toContain("PPIRTV_INPUT_INVALID");
    expect(text).toContain("diff_reviewed");
    expect(text.toLowerCase()).toContain("boolean");
    expect(text.toLowerCase()).toContain("object");
    expect(text.toLowerCase()).toContain("flat");
  }, 60_000);

  it("aceita na entrada o observed_result flat correto (segue ao handler; sem PPIRTV_INPUT_INVALID)", async () => {
    const response = await callEvidenceAdd(client, {
      flow_id: "flow_wire_probe_inexistente",
      kind: "code_review",
      title: "Revisao estruturada",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      observed_result: {
        diff_reviewed: true,
        barata_scan: true,
        reviewed_targets: ["a.php", "tests/a.test.php"],
        searched_patterns: ["padrao"],
        findings: ["F1: achado"],
        regression_risks: ["R1: risco"]
      },
      scope_classification: "target",
      scope_reference: "a.php"
    });
    const text = response.content?.[0]?.text ?? "";
    expect(text).not.toContain("PPIRTV_INPUT_INVALID");
  }, 60_000);

  it("nao-regressao: kind nao-review com observed_result arbitrario continua aceito na entrada", async () => {
    const response = await callEvidenceAdd(client, {
      flow_id: "flow_wire_probe_inexistente",
      kind: "goal_evidence",
      title: "Evidencia comum",
      satisfies: ["comando_executado"],
      observed_result: { qualquer: { coisa: ["aninhada"] }, aceita: "hoje" },
      scope_classification: "target",
      scope_reference: "a.php"
    });
    const text = response.content?.[0]?.text ?? "";
    expect(text).not.toContain("PPIRTV_INPUT_INVALID");
  }, 60_000);
});
