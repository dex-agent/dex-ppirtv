// Trilho R — GitHub #47 (2ª rodada do auditor; reabre #38): a ajuda publicada
// precisa casar com o parser — o parser é o contrato.
//
// record-goal-progress.mjs exige --current e --total e nem o --usage nem o
// --schema os anunciam: o exemplo publicado termina em "Missing --current"
// DEPOIS de subir o servidor MCP. judge-playbook.py e test-symbol-coverage.py
// anunciam --repo, que nenhum dos dois argparse aceita.
//
// O teste fecha a classe nos scripts Python com tríade documental: toda opção
// anunciada em --usage e --schema precisa aparecer no --help do argparse.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..");
const PROGRESS = path.join(REPO, "scripts", "record-goal-progress.mjs");
const FLAG = /--[a-z][a-z0-9-]*/g;
// Mensagens do parser do record-goal-progress: se alguma aparecer, a linha
// publicada não casou com o que o parser exige.
const RECUSA_DO_PARSER = /Missing --|Missing value for|Unexpected argument|must be an integer/;

// Scripts Python com a tríade documental, descobertos ao vivo (script novo
// com a tríade entra no teste sem editá-lo).
const COM_TRIDADE = ["tools", "scripts"]
  .flatMap((base) =>
    readdirSync(path.join(REPO, base), { recursive: true, encoding: "utf8" })
      .filter((relativo) => relativo.endsWith(".py"))
      .map((relativo) => path.join(base, relativo))
  )
  .filter((relativo) => readFileSync(path.join(REPO, relativo), "utf8").includes('"--usage"'))
  .sort();

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

const docJson = (args: string[]) =>
  JSON.parse(execFileSync("python", ["-B", ...args, "--schema"], { encoding: "utf8" })) as { inputs?: string[] };

describe("#47 — record-goal-progress.mjs: a ajuda publicada casa com o parser", () => {
  it("todo argumento obrigatório do parser aparece no --usage e no --schema", () => {
    const fonte = readFileSync(PROGRESS, "utf8");
    const obrigatorios = [...fonte.matchAll(/(?:required|integer)\(args, "([a-z-]+)"\)/g)].map((match) => match[1]);
    // Premissa: o extrator enxerga o parser (senão o teste passaria vazio).
    expect(obrigatorios.length).toBeGreaterThan(5);
    const usage = execFileSync("node", [PROGRESS, "--usage"], { encoding: "utf8" });
    const schema = JSON.parse(execFileSync("node", [PROGRESS, "--schema"], { encoding: "utf8" })) as { inputs?: string[] };
    const noUso = new Set(usage.match(FLAG) ?? []);
    const noSchema = new Set((schema.inputs ?? []).map((entrada) => entrada.split(/\s/)[0]));
    // Cada superfície publica sozinha: quem lê só o --schema (contrato legível
    // por máquina) também precisa dos obrigatórios. Juntar as duas num conjunto
    // único deixou sobreviver a mutação que apaga os campos só do schema.
    expect(obrigatorios.filter((nome) => !noUso.has(`--${nome}`))).toEqual([]);
    expect(obrigatorios.filter((nome) => !noSchema.has(`--${nome}`))).toEqual([]);
  });

  it("o comando publicado chega à chamada do servidor sem o parser pedir argumento", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-ajuda-"));
    const usage = execFileSync("node", [PROGRESS, "--usage"], { encoding: "utf8" });
    // Monta a linha de comando a partir do que a ajuda publica: <dir> vira uma
    // pasta temporária, <n> vira 1 e qualquer outro espaço reservado vira "x".
    const args: string[] = [];
    for (const [, flag, espaco] of usage.matchAll(/(--[a-z][a-z0-9-]*) <([^>]+)>/g)) {
      args.push(flag, espaco === "dir" ? tempRoot : espaco === "n" ? "1" : "x");
    }
    // Premissa: a ajuda publica uma linha de comando com espaços reservados.
    expect(args.length).toBeGreaterThan(0);

    const resultado = spawnSync("node", [PROGRESS, ...args], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, PPIRTV_PRINCIPLES_PATH: path.join(REPO, "principles", "operational-contract.json") }
    });

    expect(resultado.stderr).not.toMatch(RECUSA_DO_PARSER);
    // Chegou ao servidor: stdout é o recibo JSON da tool (flow "x" não existe).
    expect(() => JSON.parse(resultado.stdout)).not.toThrow();
  });
});

describe("#47 — scripts Python com tríade: nada anunciado que o argparse não aceite", () => {
  it("a descoberta ao vivo encontra os scripts desta rodada", () => {
    expect(COM_TRIDADE.map((relativo) => path.basename(relativo))).toEqual(
      expect.arrayContaining(["judge-playbook.py", "test-symbol-coverage.py"])
    );
  });

  it.each(COM_TRIDADE)("%s: toda opção anunciada em --usage e --schema é aceita pelo argparse", (relativo) => {
    const script = path.join(REPO, relativo);
    const usage = execFileSync("python", ["-B", script, "--usage"], { encoding: "utf8" });
    const schema = docJson([script]);
    const ajuda = execFileSync("python", ["-B", script, "--help"], { encoding: "utf8" });
    const fonte = readFileSync(script, "utf8");
    // Opções que o argparse aceita: as do bloco "options" do --help (abrem linha
    // ou vêm depois da forma curta, `  -h, --help`) mais as declaradas no
    // fonte. Script com add_help=False (check-duplicacao-delta) imprime prosa no
    // --help; e todo add_argument("--x") é aceito por construção — a união nunca
    // fica mais permissiva que o parser.
    const temBlocoDeOpcoes = /^options:$/m.test(ajuda);
    const aceitas = new Set([
      ...(temBlocoDeOpcoes ? [...ajuda.matchAll(/(?:^\s+|,\s)(--[a-z][a-z0-9-]*)/gm)].map((match) => match[1]) : []),
      ...[...fonte.matchAll(/add_argument\(\s*"(--[a-z][a-z0-9-]*)"/g)].map((match) => match[1])
    ]);
    const anunciadas = new Set([
      ...(usage.match(FLAG) ?? []),
      ...(schema.inputs ?? []).map((entrada) => entrada.split(/\s/)[0])
    ]);
    // Premissas: o extrator enxerga o parser e o script anuncia alguma opção
    // (senão o teste passaria sem conferir nada).
    expect(aceitas.size).toBeGreaterThan(0);
    expect(anunciadas.size).toBeGreaterThan(0);

    expect([...anunciadas].filter((flag) => !aceitas.has(flag))).toEqual([]);
  });
});
