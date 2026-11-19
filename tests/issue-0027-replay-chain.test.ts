// Corte C′ — REPLAY DO CHAIN_REPLAY (issue #27 + P2-4 da issue #21).
// Causa-raiz (l.860-892 × l.1130-1141): a selagem virtual (merge-base
// --is-ancestor vs BASE da janela) só roda no caminho do declaration real e
// só reconhece selo ANCESTRAL DO BASE — selos pagos DENTRO da janela
// (prática da casa: selo = commit seguinte) nunca liberam o
// CONSECUTIVE_EXCEPTION no CHAIN_REPLAY, que recebe history CRU.
// Cura: a mesma selagem virtual aplicada por record no replay com
// referência no HEAD da janela; blob ausente vira reason dedicado
// (CHAIN_REPLAY_BLOB_UNAVAILABLE) em vez de crash — NUNCA podar.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateFlowEngineChange, runBoundaryCli } from "../scripts/validate-flow-engine-boundary.mjs";

const WS = "C:/CodexProjetos/dex-PPIRTV";
const HEX40 = (char: string) => char.repeat(40);

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

function exceptionRecord(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, date: "2026-11-18", mode: "EXCEPTION",
    exception_reason: "integrity",
    rollback: "Reverta a cura para restaurar o comportamento anterior.",
    expires: "next diff that touches src/flow-engine.ts",
    red_evidence: `tests/${id}.test.ts::titulo do it sem metacaracteres`,
    red_base_blob: HEX40("a"),
    red_observed_failure: "RED observado no base",
    red_command: `npx vitest run tests/${id}.test.ts -t "titulo do it sem metacaracteres"`,
    ...extra
  };
}

describe("issue 27 — replay da janela reconhece selo pago DENTRO da janela", () => {
  it("cura replay 94a9b0c..ae8b86f (janela viva, 5 elos ate o corte B-prime) passa com historia selada", async () => {
    // A janela viva termina no record mais recente do ledger (chainRecords
    // exige at(-1).head_blob == headBlob) — os 4 records com selo pago
    // DENTRO da janela ficam historia selada; o B-prime (sem selo, vencido
    // no proximo commit do motor) e o declaration material legitimo.
    const result = await runBoundaryCli({ cwd: WS, argv: ["--base", "94a9b0c", "--head", "ae8b86f"] }) as { exitCode: number; output: string };
    const receipt = JSON.parse(result.output) as { status: string; reasons?: string[] };
    expect(receipt.reasons?.filter((reason) => reason.includes("CONSECUTIVE_EXCEPTION")) ?? []).toEqual([]);
    expect(receipt.status).toBe("PASS");
  });
});

describe("caracterizacoes do CONSECUTIVE_EXCEPTION — nunca podar", () => {
  it("excecoes consecutivas NAO autorizadas (sem selo) continuam reprovando", () => {
    const a = exceptionRecord("FE-A");
    const b = exceptionRecord("FE-B");
    const replay = evaluateFlowEngineChange({
      baseSource: "export const a = 1;\n",
      headSource: "export const a = 2;\n",
      declaration: b,
      history: [a],
      flowEngineChanged: true
    });
    expect(replay.reasons).toContain("CONSECUTIVE_EXCEPTION_FORBIDDEN");
  });

  it("historia selada (sealed_retroactive) libera a excecao seguinte", () => {
    const a = exceptionRecord("FE-A", { sealed_retroactive: true });
    const b = exceptionRecord("FE-B");
    const replay = evaluateFlowEngineChange({
      baseSource: "export const a = 1;\n",
      headSource: "export const a = 2;\n",
      declaration: b,
      history: [a],
      flowEngineChanged: true
    });
    expect(replay.reasons).not.toContain("CONSECUTIVE_EXCEPTION_FORBIDDEN");
  });
});

describe("issue 21 P2-4 — blob ausente no replay vira reason dedicado sem crash", () => {
  it("cura record cujo blob nao existe no Git produz CHAIN_REPLAY_BLOB_UNAVAILABLE", async () => {
    const git = (args: string[]) => execFileSync("git", ["-C", tempRoot, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-cp-"));
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "docs", "architecture"), { recursive: true });
    git(["init", "-q"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]); git(["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(tempRoot, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf8");
    await writeFile(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n", "utf8");
    await writeFile(path.join(tempRoot, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# FlowEngine evolutionary architecture\n", "utf8");
    await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), "export const a = 1;\n", "utf8");
    git(["add", "."]); git(["commit", "-qm", "v1"]);
    const blobA = execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), "export const a = 2;\n", "utf8");
    git(["add", "."]); git(["commit", "-qm", "v2"]);
    const blobB = execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), "export const a = 3;\n", "utf8");
    git(["add", "."]); git(["commit", "-qm", "v3"]);
    const blobC = execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    // Cadeia de 3 elos cujo elo do MEIO vive num blob que NUNCA chegou ao
    // Git (o blob solto 7901ecac da PIPELINE-SHRINK, classe P2-4 da #21):
    // os blobs do ULTIMO record são legíveis (passa do guard da cadeia) e o
    // fantasma explode só no cat-file do CHAIN_REPLAY — o crash original.
    const fantasma = HEX40("f");
    const ledger = {
      records: [
        exceptionRecord("FE-FANTASMA-A", { base_blob: blobA, head_blob: fantasma }),
        exceptionRecord("FE-FANTASMA-B", { base_blob: fantasma, head_blob: blobB }),
        exceptionRecord("FE-FANTASMA-C", { base_blob: blobB, head_blob: blobC })
      ]
    };
    await writeFile(
      path.join(tempRoot, "docs", "architecture", "flow-engine-evolution.json"),
      JSON.stringify(ledger), "utf8"
    );
    git(["add", "."]); git(["commit", "-qm", "ledger"]);
    const result = await runBoundaryCli({ cwd: tempRoot, argv: ["--base", "HEAD~3", "--head", "HEAD~1"] }) as { exitCode: number; output: string };
    const receipt = JSON.parse(result.output) as { status: string; reasons?: string[] };
    expect(receipt.reasons ?? []).toContain(`CHAIN_REPLAY_BLOB_UNAVAILABLE:FE-FANTASMA-A`);
    expect(receipt.reasons ?? []).toContain(`CHAIN_REPLAY_BLOB_UNAVAILABLE:FE-FANTASMA-B`);
    expect(receipt.status).toBe("FAIL");
  });
});
