// Frente G — GitHub #36 + #37 + #38 (auditoria 377f94a): tríade honesta.
//
// #36: o passo --local-only do audit só media tamanho — contrato JSON com
// sintaxe inválida ({not-json) devolvia exit 0 "Canonical sync audit
// passed." O caminho completo já tinha assertJsonParses; o passo local do
// CI precisa do mesmo crivo (nomeando o arquivo).
// #37: o bloco TRIADE-DOC de canonical-pairs.mjs avaliava process.argv no
// IMPORT e fazia process.exit(0) — audit e post-merge nunca chegavam ao
// próprio doc: --schema devolvia tool "canonical-pairs" para os dois.
// Cura: guard de entrypoint (pathToFileURL) — o doc do módulo só responde
// quando ELE é o entrypoint.
// #38: helps/usages ensinavam formas que os próprios parsers rejeitam
// (posicional no validate-spt, <args.json> no record, --flow/--out <dir> no
// export, --cwd no validador). O parser real é a verdade; o help aprende.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..");
let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

const runNode = (args: string[], cwd: string) => execFileSync("node", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function fixtureLocalPairs(jsonContent: string) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-g36-"));
  await mkdir(path.join(tempRoot, "docs", "contracts"), { recursive: true });
  await mkdir(path.join(tempRoot, "principles"), { recursive: true });
  await writeFile(path.join(tempRoot, "docs", "contracts", "GOAL_SPT_CANONICAL_CONTRACT.md"), "# contrato\n", "utf8");
  // O assertLocalAuthorityPointers confere os trechos de autoridade no
  // bridge quando ele existe — a fixture carrega os mesmos trechos do real.
  await writeFile(path.join(tempRoot, "docs", "contracts", "GOAL_EXECUTION_BRIDGE.md"), "# ponte\n\n- autoridade global: $env:USERPROFILE\\.agents\\contracts\\GOAL_SPT_CANONICAL_CONTRACT.md (docs/contracts e copia local versionada)\n", "utf8");
  await writeFile(path.join(tempRoot, "principles", "PRINCIPLES.md"), "# principios\n", "utf8");
  await writeFile(path.join(tempRoot, "principles", "operational-contract.json"), jsonContent, "utf8");
  return tempRoot;
}

describe("frente G (#36) — JSON ilegível reprova o passo local", () => {
  it("operational-contract.json = '{not-json' faz --local-only reprovar nomeando o arquivo", async () => {
    const dir = await fixtureLocalPairs("{not-json");
    // Reprovação = exit 1 com a mensagem em stderr; execFileSync lança,
    // então capturamos status/stdout/stderr do erro.
    let code = 0;
    let stdout = "";
    let stderr = "";
    try {
      stdout = execFileSync("node", [path.join(REPO, "scripts", "audit-canonical-sync.mjs"), "--local-only"], {
        cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? 1;
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? "";
    }
    expect(code).not.toBe(0);
    expect(stderr).toContain("operational-contract.json");
    expect(stdout).not.toContain("passed");
  });

  it("controle: JSON válido no mesmo passo local passa", async () => {
    const dir = await fixtureLocalPairs(JSON.stringify({ schema_version: 1 }));
    const result = execFileSync("node", [path.join(REPO, "scripts", "audit-canonical-sync.mjs"), "--local-only"], {
      cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    });
    expect(result).toContain("passed");
  });
});

describe("frente G (#37) — cada entrypoint emite o próprio contrato", () => {
  it("audit --schema devolve tool audit-canonical-sync (não o do módulo importado)", () => {
    const out = runNode([path.join(REPO, "scripts", "audit-canonical-sync.mjs"), "--schema"], REPO);
    expect(JSON.parse(out).tool).toBe("audit-canonical-sync");
  });

  it("post-merge.impl --schema devolve tool post-merge-paridade", () => {
    const out = runNode([path.join(REPO, "tools", "playbook", "hooks", "post-merge.impl.mjs"), "--schema"], REPO);
    expect(JSON.parse(out).tool).toBe("post-merge-paridade");
  });

  it("controle: canonical-pairs.mjs --schema direto continua devolvendo o próprio doc", () => {
    const out = runNode([path.join(REPO, "scripts", "canonical-pairs.mjs"), "--schema"], REPO);
    expect(JSON.parse(out).tool).toBe("canonical-pairs");
  });

  it("#55: canonical-pairs mantém o schema ao usar um alias de diretório", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-0055-"));
    const alias = path.join(tempRoot, "scripts");
    await symlink(path.join(REPO, "scripts"), alias, process.platform === "win32" ? "junction" : "dir");
    const out = runNode([path.join(alias, "canonical-pairs.mjs"), "--schema"], REPO);
    expect(JSON.parse(out).tool).toBe("canonical-pairs");
  });
});

describe("frente G (#38) — helps ensinam o que o parser aceita", () => {
  it("validate-spt: usage com --workspace/--spt-path, sem posicional mentiroso", () => {
    const help = runNode([path.join(REPO, "scripts", "validate-spt.mjs"), "--help"], REPO);
    expect(help).toContain("--workspace");
    expect(help).toContain("--spt-path");
    expect(help).not.toContain("<trilho.md>");
  });

  it("record-goal-progress: help com --flow-id, sem <args.json> posicional", () => {
    const help = runNode([path.join(REPO, "scripts", "record-goal-progress.mjs"), "--help"], REPO);
    expect(help).toContain("--flow-id");
    expect(help).not.toContain("<args.json>");
  });

  it("export-diagnostic-bundle: help com --flow-id, sem '--flow <' nem '--out <dir>'", () => {
    const help = runNode([path.join(REPO, "scripts", "export-diagnostic-bundle.mjs"), "--help"], REPO);
    expect(help).toContain("--flow-id");
    expect(help).not.toContain("--flow <");
    expect(help).not.toContain("--out <dir>");
  });

  it("validador de boundary: help sem --cwd (o parser rejeita; cwd é da API JS)", () => {
    const help = runNode([path.join(REPO, "scripts", "validate-flow-engine-boundary.mjs"), "--help"], REPO);
    expect(help).not.toContain("--cwd");
    const schema = runNode([path.join(REPO, "scripts", "validate-flow-engine-boundary.mjs"), "--schema"], REPO);
    expect(JSON.parse(schema).inputs.join(" ")).not.toContain("--cwd");
  });
});
