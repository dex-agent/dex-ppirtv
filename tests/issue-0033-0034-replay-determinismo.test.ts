// Frente F — GitHub #33 + #34 (auditoria 377f94a): determinismo do replay.
//
// #33: a selagem retroativa (marcaSealedAncestors) chamava git
// --is-ancestor SEM cwd — o spawn rodava no diretório do PROCESSO. Chamado
// de fora do repositório-alvo (ou por qualquer processo cujo cwd não é o
// repo), os commits da janela não existem → catch → "não ancestral" →
// exceções legítimas viram CONSECUTIVE_EXCEPTION (evidência da issue:
// 0/PASS no repo vs 1/FAIL com 5 motivos de fora). O vitest local reproduz
// a MESMA classe: o processo roda no workspace, não no repo da fixture.
//
// #34: a janela histórica fixa as refs, mas o manifest era lido do DISCO
// na ponta — corte posterior contíguo no ledger mudava o recibo de uma
// janela Git imutável (PASS → MATCHING_DECLARATION_REQUIRED na revisão
// 377f94a). A fixture decide o comportamento do código atual.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBoundaryCli } from "../scripts/validate-flow-engine-boundary.mjs";

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

const HEX40 = (char: string) => char.repeat(40);

function exceptionRecord(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, date: "2026-11-22", mode: "EXCEPTION",
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

describe("frente F (#33) — ancestralidade da selagem roda no cwd do repositório-alvo", () => {
  it("exceções com selo ancestral não viram CONSECUTIVE_EXCEPTION quando o processo roda fora do repo", async () => {
    const git = (args: string[]) => execFileSync("git", ["-C", tempRoot, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-ff33-"));
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "docs", "architecture"), { recursive: true });
    git(["init", "-q"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]); git(["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(tempRoot, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf8");
    await writeFile(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n- marker-ff\n", "utf8");
    await writeFile(path.join(tempRoot, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# FlowEngine evolutionary architecture\n", "utf8");

    const commitMotor = async (value: string, message: string) => {
      await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), `export const a = ${value};\n`, "utf8");
      git(["add", "."]); git(["commit", "-qm", message]);
    };
    await commitMotor("1", "v1");
    const blobA = execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    await commitMotor("2", "v2");
    const blobB = execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    const v2 = git(["rev-parse", "HEAD"]).trim();
    await commitMotor("3", "v3-selo");

    // História com 2 EXCEPTION CONSECUTIVOS cujo selo (commit= v2, ancestral
    // do head da janela) foi pago DENTRO da janela — sem o cwd no spawn, o
    // is-ancestor roda no workspace do vitest (commits inexistentes) e as
    // exceções legítimas explodem como CONSECUTIVE_EXCEPTION.
    const ledger = {
      records: [
        exceptionRecord("FE-FF-E1", { base_blob: HEX40("1"), head_blob: HEX40("2"), commit: v2 }),
        exceptionRecord("FE-FF-E2", { base_blob: HEX40("2"), head_blob: blobA, commit: v2 }),
        exceptionRecord("FE-FF-D", { base_blob: blobA, head_blob: blobB, commit: v2 })
      ]
    };
    await writeFile(path.join(tempRoot, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify(ledger), "utf8");
    git(["add", "."]); git(["commit", "-qm", "ledger"]);

    // Janela histórica v1→v2: HEAD=ledger, HEAD~1=v3-selo, HEAD~2=v2,
    // HEAD~3=v1 — a selagem (commit=v2) é ancestral do head da janela.
    const result = await runBoundaryCli({ cwd: tempRoot, argv: ["--base", "HEAD~3", "--head", "HEAD~2"] }) as { exitCode: number; output: string };
    const receipt = JSON.parse(result.output) as { status: string; reasons?: string[] };
    expect(receipt.reasons?.filter((reason) => reason.includes("CONSECUTIVE_EXCEPTION")) ?? []).toEqual([]);
  });
});

describe("frente F (#34) — janela histórica preserva o recibo com corte posterior no ledger", () => {
  it("append de record contíguo posterior no manifest do disco não muda o recibo da janela fixa", async () => {
    const git = (args: string[]) => execFileSync("git", ["-C", tempRoot, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-ff34-"));
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "docs", "architecture"), { recursive: true });
    git(["init", "-q"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]); git(["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(tempRoot, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf8");
    await writeFile(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n- marker-ff\n", "utf8");
    await writeFile(path.join(tempRoot, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# FlowEngine evolutionary architecture\n", "utf8");

    const commitMotor = async (value: string, message: string) => {
      await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), `export const a = ${value};\n`, "utf8");
      git(["add", "."]); git(["commit", "-qm", message]);
    };
    await commitMotor("1", "v1");
    const blobA = execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    await commitMotor("2", "v2");
    const blobB = execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    const v2 = git(["rev-parse", "HEAD"]).trim();

    const manifestPath = path.join(tempRoot, "docs", "architecture", "flow-engine-evolution.json");
    const baseLedger = {
      records: [exceptionRecord("FE-FF34-D", { base_blob: blobA, head_blob: blobB, commit: v2 })]
    };
    await writeFile(manifestPath, JSON.stringify(baseLedger), "utf8");
    git(["add", "."]); git(["commit", "-qm", "ledger"]);

    const run = async () => {
      const result = await runBoundaryCli({ cwd: tempRoot, argv: ["--base", "HEAD~2", "--head", "HEAD~1"] }) as { exitCode: number; output: string };
      return { exitCode: result.exitCode, receipt: JSON.parse(result.output) as { status: string; reasons?: string[] } };
    };
    const before = await run();

    // Corte posterior legítimo: record contíguo NOVO (blobB -> blob futuro),
    // escrito no manifest do DISCO sem tocar as refs da janela histórica.
    const appended = {
      records: [
        ...baseLedger.records,
        exceptionRecord("FE-FF34-POSTERIOR", { base_blob: blobB, head_blob: HEX40("f"), commit: v2 })
      ]
    };
    await writeFile(manifestPath, JSON.stringify(appended), "utf8");

    const after = await run();
    expect(after.exitCode).toBe(before.exitCode);
    expect(after.receipt.status).toBe(before.receipt.status);
    expect(after.receipt.reasons).toEqual(before.receipt.reasons);
  });
});
