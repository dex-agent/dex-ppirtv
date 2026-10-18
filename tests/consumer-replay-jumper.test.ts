import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import type { Flow } from "../src/domain.js";

// SPT input-nunca-bloqueante-frentes-2 (GO do dono 2026-10-18): teste de
// ACEITACAO = replay do transcript real do consumidor (maquina jumper, laudo
// 2026-10-18-laudo-evidence-add-flat-shape.md). O flow velho dele tem
// gates[implementacao].provided.changed_files persistido com elementos
// {"value": X} (gravados antes do fix de nivel 1) e o goal_status full/compact
// rejoga esse provided em checkGate -> strictPathArray lanca dentro da tool de
// LEITURA: diagnostico morto, loop eterno. Aqui se reproduz o estado persistido
// sujo e se exige que a leitura RESPONDA.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(repoRoot, "dist", "index.js");

type CallResult = { isError?: boolean; content?: Array<{ type: string; text?: string }> };

function fakeSpt(workspace: string, objective: string): string {
  return [
    "---", "dex_contract: spt", "version: 3", "status: EM_TESTE", "owner: Teste",
    "date: '2026-10-18'", "workspace: " + JSON.stringify(workspace), "origin: replay jumper",
    "goal:", "  id: fake-goal-replay", "  title: Replay consumidor jumper",
    "  objective: " + JSON.stringify(objective),
    "context: Fixture do replay do consumidor.", "problem: Loop eterno de leitura.",
    "decision: RED primeiro.", "scope:", "  include:", "    - Validar leitura.", "  exclude:",
    "    - Externo.", "requirements:", "  - id: REQ-01", "    statement: goal_status responde.",
    "    criteria:", "      - id: C-01", "        statement: goal_status full responde.",
    "plan: [Replay.]", "tasks:", "  - id: A-01", "    action: Chamar goal_status.",
    "    covers: [REQ-01]", "    done_when: [C-01]", "    depends_on: []",
    "    evidence_requirements:", "      - id: ER-01", "        proves: [C-01]", "        method: inspection",
    "        procedure: Observar resposta.", "        expectation:", "          kind: boolean_assertion",
    "          expected: true", "closure_gates: [Nenhum.]", "risks:", "  - Risco de fixture.",
    "uncertainties:", "  - nenhuma.", "gates:", "  - preenchidos.", "validation:", "  - vitest local.",
    "execution_prompt: |", "  /GOAL", "---", "# t", ""
  ].join("\n");
}

let tempRoot = "";
let workspace = "";
let flowId = "";
let client: Client;

// Injeta o estado persistido sujo do flow velho do consumidor: gate de
// implementacao com provided.changed_files embrulhado em {"value": X}.
async function dirtyPersistedGate(store: PpirtvStore): Promise<void> {
  const flow = await store.loadFlow(flowId) as Flow;
  flow.phase = "implementacao";
  flow.gates.implementacao = {
    phase: "implementacao",
    status: "blocked",
    checked_at: new Date().toISOString(),
    provided: {
      changed_files: [{ value: "src/a.ts" } as unknown as string, "docs/note.md"],
      implementation_done: { value: true }
    },
    missing: [],
    next: "revisao",
    back_to: null
  };
  await store.saveFlow(flow);
}

// Variante do laudo: changed_files do PROPRIO flow persistido embrulhado
// (causa do REVIEW_SNAPSHOT_FILE_REQUIRED: [object object] via
// normalizeReviewPath sobre objeto).
async function dirtyChangedFiles(store: PpirtvStore): Promise<void> {
  const flow = await store.loadFlow(flowId) as Flow;
  flow.phase = "implementacao";
  (flow as { changed_files: string[] }).changed_files = [{ value: "src/a.ts" } as unknown as string];
  await store.saveFlow(flow);
}

beforeAll(async () => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "ppirtv-replay-jumper-"));
  workspace = path.join(tempRoot, "workspace");
  const store = new PpirtvStore(path.join(workspace, ".ppirtv"));
  const engine = new FlowEngine(store, undefined, { memory_writer: undefined });
  const dir = path.join(workspace, ".agents", "PLAN-TASKS");
  await mkdir(dir, { recursive: true });
  const sptPath = path.join(dir, "2026-10-18-fake-goal-replay.md");
  await writeFile(sptPath, fakeSpt(workspace, "Replay do transcript do consumidor"), "utf8");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, "docs"), { recursive: true });
  await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  await writeFile(path.join(workspace, "docs", "note.md"), "# note\n", "utf8");
  const started = (await engine.startGoal({
    workspace, spt_path: sptPath, objective: "Replay do transcript do consumidor",
    idempotency_key: "replay-" + Math.random().toString(36).slice(2, 8),
    evidence_required: true, required_evidence: ["vitest"],
    risk_level: "medium", requested_verdict_policy: "evidence_required", source: "dex-code"
  } as never)) as Record<string, unknown>;
  flowId = String(started.flow_id);
  await dirtyPersistedGate(store);

  if (!existsSync(serverEntry)) {
    throw new Error(`dist/index.js ausente em ${serverEntry} — rode npm run build antes do vitest`);
  }
  client = new Client({ name: "replay-jumper-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: workspace,
    env: {
      ...getDefaultEnvironment(),
      PPIRTV_HOME: path.join(workspace, ".ppirtv"),
      PPIRTV_WORKSPACE: workspace
    }
  }));
}, 60_000);

afterAll(async () => {
  await client.close();
  rmSync(tempRoot, { recursive: true, force: true });
});

async function call(tool: string, args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: tool, arguments: args }) as CallResult;
}

function resultText(result: CallResult): string {
  return (result.content ?? []).map((part) => part.text ?? "").join("\n");
}

describe("replay do transcript do consumidor (wire MCP, flow velho sujo)", () => {
  it("goal_status detail full RESPONDE no flow com provided persistido embrulhado (o loop eterno do laudo)", async () => {
    const result = await call("goal_status", { flow_id: flowId, detail: "full" });
    expect(result.isError, resultText(result)).not.toBe(true);
    expect(resultText(result)).not.toContain("PPIRTV_INPUT_INVALID");
  });

  it("goal_status com detail fora do enum NAO rejeita por forma (leitura nunca bloqueante; degrada para full)", async () => {
    const result = await call("goal_status", { flow_id: flowId, detail: "FULL" });
    expect(resultText(result)).not.toContain("PPIRTV_INPUT_INVALID");
  });

  it("evidence_add com arrays embrulhados chega flat no dominio: aceito SEM ressalva de shape", async () => {
    // Rota ensinada pelo proprio envelope (contrato de substancia R3): o
    // fingerprint vivo vem do goal_status full — que agora RESPONDE no flow
    // sujo; e exatamente a sequencia que o agente consumidor consegue seguir.
    const status = await call("goal_status", { flow_id: flowId, detail: "full" });
    expect(status.isError, resultText(status)).not.toBe(true);
    const fingerprint = deepFind(JSON.parse(resultText(status)), "implementation_fingerprint");
    expect(typeof fingerprint, "goal_status full deve expor implementation_fingerprint").toBe("string");

    const result = await call("evidence_add", {
      flow_id: flowId,
      kind: "code_review",
      title: "Revisao estruturada do replay",
      scope_reference: "src/a.ts",
      scope_classification: "target",
      satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
      reviewed_implementation_fingerprint: fingerprint,
      observed_result: {
        diff_reviewed: { value: true },
        barata_scan: { value: true },
        reviewed_targets: [{ value: "src/a.ts" }],
        searched_patterns: [{ value: "rg foo" }],
        findings: [],
        regression_risks: [{ value: "R1 regressao de input" }]
      }
    });
    expect(result.isError, resultText(result)).not.toBe(true);
    const text = resultText(result);
    // Prova de que o artefato embrulhado chegou FLAT no dominio: o receipt
    // ecoa observed_result com arrays de strings (nao de objetos) e nao
    // carrega ressalva de shape.
    expect(text).not.toContain("review_input_ressalvas");
    const receipt = JSON.parse(text) as {
      evidence?: { observed_result?: Record<string, unknown> };
    };
    expect(receipt.evidence?.observed_result?.reviewed_targets).toEqual(["src/a.ts"]);
    expect(receipt.evidence?.observed_result?.searched_patterns).toEqual(["rg foo"]);
    expect(receipt.evidence?.observed_result?.diff_reviewed).toBe(true);
  });
});

function deepFind(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFind(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === key && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) return v;
      const found = deepFind(v, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

describe("replay engine-level: leitura tolerante a dado persistido sujo", () => {
  it("goalStatus full responde quando changed_files do flow esta embrulhado (sem TypeError/[object object])", async () => {
    const store = new PpirtvStore(path.join(workspace, ".ppirtv"));
    await dirtyChangedFiles(store);
    const engine = new FlowEngine(store, undefined, { memory_writer: undefined });
    const status = await engine.goalStatus({ flow_id: flowId, detail: "full" });
    expect(status).toBeTruthy();
    await dirtyPersistedGate(store);
  });
});
