// Frente D — GitHub #35 (auditoria 377f94a): o fiscal de evidências aceita
// referência local que falta no clone. O ramo .agents/ do record-check exige
// redirect versionado, mas o else só faz existsSync — arquivo IGNORADO pelo
// git (artifacts/) ou UNTRACKED no disco passa na máquina produtora e morre
// no clone limpo de quem revisa (falso verde local, claim-sem-receipt na
// frota). Cura: versionabilidade REAL (ls-files --error-unmatch) nos dois
// sítios da classe (record-check + declaration gate gêmeo).
//
// GitHub #44 (2026-11-23, reabre a #35): a checagem pelo ÍNDICE aceitava
// laudo commitado DEPOIS da revisão que fecha a janela — e o controle
// positivo deste teste consagrava o defeito (criava o laudo após v4 e esperava
// passar na janela que termina em v4). Agora a evidência de janela explícita é
// conferida na ÁRVORE da revisão que fecha a janela: o laudo de controle
// entra ANTES da janela, e nasce o caso 4 (laudo tardio → reprova).
//
// Coreografia: o gate casa UM record por par base_blob×head_blob da janela —
// cada caso precisa da PRÓPRIA janela do motor (v1→v2 ignorado, v2→v3
// untracked, v3→v4 versionado, v4→v5 laudo tardio) e o CLI roda uma vez por
// janela. Janelas por SHA: HEAD~k muda quando a fixture ganha um commit.
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

describe("frente D (#35) — versionabilidade REAL, conferida na revisão que fecha a janela (#44)", () => {
  it("laudo ignorado, untracked e commitado depois da janela reprovam; laudo versionado antes da janela passa", async () => {
    const git = (args: string[]) => execFileSync("git", ["-C", tempRoot, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-fd-"));
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "docs", "architecture"), { recursive: true });
    await mkdir(path.join(tempRoot, "artifacts"), { recursive: true });
    git(["init", "-q"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]); git(["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(tempRoot, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf8");
    await writeFile(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n- marker-fd\n", "utf8");
    await writeFile(path.join(tempRoot, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# FlowEngine evolutionary architecture\n", "utf8");
    // O ignore da fixture espelha o do repo real: artifacts/ é gitignored
    // (confirmado por git check-ignore na auditoria 377f94a).
    await writeFile(path.join(tempRoot, ".gitignore"), "artifacts/\n", "utf8");

    const motorBlob = () => execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    const sha = (ref: string) => git(["rev-parse", ref]).trim();
    const commitMotor = async (value: string, message: string) => {
      await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), `export const a = ${value};\n`, "utf8");
      git(["add", "."]); git(["commit", "-qm", message]);
      return sha("HEAD");
    };

    const v1 = await commitMotor("1", "v1"); const blobV1 = motorBlob();
    const v2 = await commitMotor("2", "v2"); const blobV2 = motorBlob();
    const v3 = await commitMotor("3", "v3"); const blobV3 = motorBlob();
    // Controle positivo HONESTO (#44): o laudo entra ANTES da janela que o
    // cita — quem abre a revisão v4 o encontra na árvore.
    await writeFile(path.join(tempRoot, "docs", "laudo-ok.json"), "{}", "utf8");
    const v4 = await commitMotor("4", "v4"); const blobV4 = motorBlob();
    const v5 = await commitMotor("5", "v5"); const blobV5 = motorBlob();
    // Caso 4: laudo TARDE — commitado só no commit do ledger, depois da
    // janela v4→v5 que o cita. Existe no índice de hoje; não existe em v5.
    await writeFile(path.join(tempRoot, "docs", "laudo-tarde.json"), "{}", "utf8");
    // Caso 1: laudo ignorado — existe no disco, artifacts/ no .gitignore.
    await writeFile(path.join(tempRoot, "artifacts", "diagnostico.json"), "{}", "utf8");

    const ledger = {
      records: [
        exceptionRecord("FE-FD-IGNORADO", {
          base_blob: blobV1, head_blob: blobV2,
          evidence: ["artifacts/diagnostico.json"], red_evidence: ""
        }),
        exceptionRecord("FE-FD-UNTRACKED", {
          base_blob: blobV2, head_blob: blobV3,
          evidence: ["docs/laudo-novo.json"], red_evidence: ""
        }),
        exceptionRecord("FE-FD-VERSIONADO", {
          base_blob: blobV3, head_blob: blobV4,
          evidence: ["docs/laudo-ok.json"], red_evidence: ""
        }),
        exceptionRecord("FE-FD-TARDE", {
          base_blob: blobV4, head_blob: blobV5,
          evidence: ["docs/laudo-tarde.json"], red_evidence: ""
        })
      ]
    };
    await writeFile(
      path.join(tempRoot, "docs", "architecture", "flow-engine-evolution.json"),
      JSON.stringify(ledger), "utf8"
    );
    git(["add", "."]); git(["commit", "-qm", "ledger"]);
    // Caso 2: laudo untracked — escrito DEPOIS do commit (git add . do ledger
    // staged qualquer coisa escrita antes; untracked de verdade nunca viu o
    // índice — mesma coreografia da fixture 0027 com .agents/).
    await writeFile(path.join(tempRoot, "docs", "laudo-novo.json"), "{}", "utf8");

    // Uma janela por caso (o gate casa UM record por par de blobs).
    const run = async (base: string, head: string) => {
      const result = await runBoundaryCli({ cwd: tempRoot, argv: ["--base", base, "--head", head] }) as { exitCode: number; output: string };
      return JSON.parse(result.output) as { status: string; reasons?: string[] };
    };
    const receitaIgnorado = await run(v1, v2);
    const receitaUntracked = await run(v2, v3);
    const receitaVersionado = await run(v3, v4);
    const receitaTarde = await run(v4, v5);

    // Caso 1: ignorado no disco local é aceito pelo existsSync — precisa
    // reprovar por NÃO-versionado (o clone limpo não abre).
    expect(receitaIgnorado.reasons ?? []).toContain("EVIDENCE_NOT_VERSIONED:artifacts/diagnostico.json");
    // Caso 2: untracked (sem ignore, sem stage) reprova igual.
    expect(receitaUntracked.reasons ?? []).toContain("EVIDENCE_NOT_VERSIONED:docs/laudo-novo.json");
    // Controle positivo: o versionado ANTES da janela não gera reason de
    // versionabilidade (nem NOT_FOUND — existe e está na árvore da revisão).
    expect(receitaVersionado.reasons ?? []).not.toContain("EVIDENCE_NOT_VERSIONED:docs/laudo-ok.json");
    expect(receitaVersionado.reasons ?? []).not.toContain("EVIDENCE_NOT_FOUND:docs/laudo-ok.json");
    // Caso 4 (#44): commitado DEPOIS da revisão que fecha a janela — está no
    // índice de hoje, mas não na árvore de v5.
    expect(receitaTarde.reasons ?? []).toContain("EVIDENCE_NOT_VERSIONED:docs/laudo-tarde.json");
  });
});
