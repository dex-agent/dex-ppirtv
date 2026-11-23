// GitHub #48 a #53 (auditoria externa de 2026-11-23; itens ISSUE-LOCAL-0040 a 0045).
//
// A classe: o preflight (spt-kit/preflight.mjs) e o motor (src/spt-contract.ts)
// validam a mesma forma do SPT v3 com políticas diferentes. O S10 cobria só as
// chaves do topo e o S12 só os 3 campos de `abertura`; o zod do motor é
// `.strict()` em todos os subobjetos. Resultado (#51): o preflight dava
// `achados=0` para um documento que o motor rejeita.
//
// Invariante testada aqui: O PREFLIGHT ACUSA SE E SOMENTE SE O MOTOR REJEITA.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSptDocument } from "../src/spt-contract.js";

const REPO = path.resolve(import.meta.dirname, "..");
const PRE = path.join(REPO, "spt-kit", "preflight.mjs");
const FIXTURE = path.join(REPO, "spt-kit", "fixtures", "trilho-valido-v3.md");
const VALIDO = readFileSync(FIXTURE, "utf8");

const temporarios: string[] = [];
afterEach(async () => {
  for (const dir of temporarios.splice(0)) await rm(dir, { recursive: true, force: true });
});

// exit != 0 = acusou; stdout vem no erro (vacina da casa).
function preflight(script: string, arquivo: string): { acusa: boolean; out: string } {
  try {
    return { acusa: false, out: execFileSync(process.execPath, [script, arquivo], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (erro) {
    const e = erro as { stdout?: string | Buffer };
    return { acusa: true, out: (e.stdout ?? "").toString() };
  }
}

async function trilho(doc: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ppirtv-0048-"));
  temporarios.push(dir);
  const arquivo = path.join(dir, "trilho.md");
  await writeFile(arquivo, doc, "utf8");
  return arquivo;
}

// Mutação que NÃO casa é erro do teste, nunca falso verde.
function mutar(doc: string, alvo: RegExp | string, novo: string): string {
  if (typeof alvo === "string") {
    if (!doc.includes(alvo)) throw new Error(`alvo da mutação não existe no documento: ${alvo}`);
    return doc.replace(alvo, () => novo);
  }
  if (!alvo.test(doc)) throw new Error(`alvo da mutação não existe no documento: ${alvo.source}`);
  return doc.replace(alvo, novo);
}

const ER01 = "procedure: 'npx vitest run tests/issue-0042-0043-playbook-consumidor.test.ts'";

const MUTACOES: [string, string][] = [
  ["#51 subcampo extra em abertura", mutar(VALIDO, /^  mentor: .*$/m, "$&\n  fontes: 'docs/rules.md'")],
  ["#51 chave abertura duplicada no mesmo nível", mutar(VALIDO, /^goal:/m, "abertura:\n  contexto: 'x'\nabertura:\n  contexto: 'y'\n  ferramentas: 'y'\n  mentor: 'y'\ngoal:")],
  ["campo extra em goal", mutar(VALIDO, /^  title: .*$/m, "$&\n  extra: 'x'")],
  ["done_when vazio", mutar(VALIDO, "done_when: [C-01]\n    depends_on: []", "done_when: []\n    depends_on: []")],
  ["critério que done_when cita e não existe", mutar(VALIDO, "- id: C-01\n", "- id: C-09\n")],
];

// Kit instalado por CÓPIA (rota documentada no spt-kit/GUIA.md), dentro do repo
// para o Node resolver `yaml` no node_modules — e sem `dist/` ao lado.
async function kitCopiado(): Promise<string> {
  const raiz = path.join(REPO, ".agents", "TMP", "kit-paridade-" + randomUUID().slice(0, 8));
  temporarios.push(raiz);
  await mkdir(path.join(raiz, "spt-kit"), { recursive: true });
  await cp(PRE, path.join(raiz, "spt-kit", "preflight.mjs"));
  return path.join(raiz, "spt-kit", "preflight.mjs");
}

describe("GitHub #51 — o preflight acusa se e somente se o motor rejeita", () => {
  for (const [nome, doc] of MUTACOES) {
    it(`mutação — ${nome} — preflight e motor concordam em rejeitar`, async () => {
      const motorRejeita = parseSptDocument(doc).errors.length > 0;
      expect(motorRejeita, "a mutação tem de ser rejeitada pelo motor").toBe(true);
      const r = preflight(PRE, await trilho(doc));
      expect(r.acusa, `preflight: ${r.out.trim().split("\n")[0]}`).toBe(true);
    });
  }

  it("subcampo extra em abertura recebe a rota de correção de campo, nunca a de atualização do motor", async () => {
    // Vacina (2026-11-23): a primeira versão casava qualquer "abertura:
    // Unrecognized key" e mandava o autor atualizar um motor sem defeito.
    const [, doc] = MUTACOES[0];
    const r = preflight(PRE, await trilho(doc));
    expect(r.acusa, r.out).toBe(true);
    expect(r.out).toContain("corrija o campo citado");
    expect(r.out).not.toContain("atualize o motor");
  });

  it("documento aceito pelo motor passa no preflight com achados igual a zero", async () => {
    expect(parseSptDocument(VALIDO).errors).toEqual([]);
    const r = preflight(PRE, FIXTURE);
    expect(r.acusa, r.out).toBe(false);
    expect(r.out).toContain("achados=0");
  });

  it("kit instalado sem o build do motor avisa que a paridade esta desligada", async () => {
    const r = preflight(await kitCopiado(), FIXTURE);
    expect(r.acusa, r.out).toBe(false);
    expect(r.out).toContain("paridade");
    expect(r.out).toContain("desligada");
    expect(r.out).toContain("achados=0");
  });

  it("motor instalado anterior ao bloco abertura recebe a rota de atualizacao do motor", async () => {
    const script = await kitCopiado();
    const dist = path.join(path.dirname(path.dirname(script)), "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(
      path.join(dist, "spt-contract.js"),
      "export function parseSptDocument() { return { contract: null, checks: {}, errors: [\"spt_v3.abertura: Unrecognized key(s) in object: 'abertura'\"] }; }\n",
      "utf8"
    );
    const r = preflight(script, FIXTURE);
    expect(r.acusa, r.out).toBe(true);
    expect(r.out).toContain("atualize o motor");
  });
});

describe("GitHub #50 — S11 e os limites de token do shell", () => {
  it("separador ponto e vírgula colado em check:types não dispara S11", async () => {
    const r = preflight(PRE, await trilho(mutar(VALIDO, ER01, "procedure: 'npx tsc -p tsconfig.json && npm run check:types; npm test'")));
    expect(r.out).not.toContain("S11");
  });

  it("controle — check:capacity no lugar da prova de tipos continua disparando S11", async () => {
    const r = preflight(PRE, await trilho(mutar(VALIDO, ER01, "procedure: 'npx tsc -p tsconfig.json && npm run check:capacity; npm test'")));
    expect(r.out).toContain("S11");
  });
});

describe("GitHub #48 — toda entrada oficial de autoria carrega o bloco abertura", () => {
  it("o template indicado pelo contrato canônico passa no preflight sem S12", () => {
    const r = preflight(PRE, path.join(REPO, "templates", "SPEC-PLAN-TASKS.template.md"));
    expect(r.out).not.toContain("S12");
  });

  it("o QUICKSTART publicado traz o bloco abertura no trecho de front matter", () => {
    const guia = readFileSync(path.join(REPO, "docs", "guides", "MCP_AGENT_QUICKSTART.md"), "utf8");
    const trecho = /```yaml\r?\n([\s\S]*?)```/.exec(guia)?.[1] ?? "";
    expect(trecho).toContain("abertura:");
    expect(trecho).toContain("ferramentas:");
    expect(trecho).toContain("mentor:");
  });
});

describe("GitHub #53 — guia de arquitetura e ledger contam a mesma história", () => {
  it("todo cabeçalho de record no guia traz o mesmo modo do ledger", () => {
    const guia = readFileSync(path.join(REPO, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "utf8");
    type Ledger = { records: { id: string; mode: string }[] };
    const ledger = JSON.parse(readFileSync(path.join(REPO, "docs", "architecture", "flow-engine-evolution.json"), "utf8")) as Ledger;
    const modoPorId = new Map(ledger.records.map((r) => [r.id, r.mode]));
    const cabecalhos = [...guia.matchAll(/^### (FE-\S+) — ([A-Z]+)/gm)];
    expect(cabecalhos.length).toBeGreaterThan(10);
    const divergentes = cabecalhos
      .map((m) => ({ id: m[1], guia: m[2], ledger: modoPorId.get(m[1]) }))
      .filter((c) => c.ledger && c.ledger !== c.guia)
      .map((c) => `${c.id}: guia ${c.guia} x ledger ${c.ledger}`);
    expect(divergentes).toEqual([]);
  });
});
