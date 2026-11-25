// TRACKER 0030 — modo consumidor do PLAYBOOK no clone do destinatário
// (P1, UAT-1 A3 2026-11-22; GO do dono no quiz da fila pós-R19).
//
// Causa raiz: resolve_sources FILTRA fontes declaradas ausentes
// silenciosamente — o clone regenera só com docs/PLAYBOOK-RULES.md, acusa
// DRIFT falso do PLAYBOOK completo recebido (exit 2 trava todo commit do
// destinatário) e --write degrada 9→2 regras. Cura: MODO CONSUMIDOR por
// detecção de fonte declarada ausente — check=aviso exit 0;
// write=RECUSA exit 2 preservando a projeção recebida; fonte com todas as
// fontes segue idêntico (drift real continua valendo).
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..");
const GERADOR = path.join(REPO, "tools", "playbook", "generate-playbook.py");

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

type Saida = { code: number; stdout: string };

// CLI com exit capturado (vacina da casa: exit != 0 lança — stdout vem no erro).
function rodar(cwd: string, flags: string[]): Saida {
  try {
    const stdout = execFileSync("python", ["-B", GERADOR, "--repo", cwd, ...flags], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; status?: number };
    return { code: e.status ?? 1, stdout: (e.stdout ?? "").toString() };
  }
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// Clone limpo do destinatário: SÓ o que viaja no git (evidência 06-clean-clone
// do UAT-A3: PLAYBOOK.md/index + tools/ + docs/PLAYBOOK-RULES.md presentes;
// AGENTS.md, .agents/napkin.md e .agents/PLAN-TASKS/ACTIVE.md AUSENTES).
async function cloneLimpo(): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-0030-clone-"));
  const alvos = [
    ["PLAYBOOK.md"], ["PLAYBOOK.index.json"],
    ["tools/playbook/generate-playbook.py"], ["tools/playbook/playbook-sources.txt"],
    ["docs/PLAYBOOK-RULES.md"],
  ] as const;
  for (const [rel] of alvos) {
    const dest = path.join(tempRoot, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(path.join(REPO, rel), dest);
  }
  return tempRoot;
}

// Projeto fonte sintético: 1 fonte presente (drift real testável).
async function fonteSintetica(): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-0030-fonte-"));
  await mkdir(path.join(tempRoot, "docs"), { recursive: true });
  await writeFile(path.join(tempRoot, "docs", "REGRAS.md"), "# Regras\n\n## R1: responder com selo\n\nCorpo da regra com rota viva.\n", "utf8");
  const gerado = rodar(tempRoot, ["--write", "--sources", "docs/REGRAS.md"]);
  if (gerado.code !== 0) throw new Error(`fixture fonte: --write falhou: ${gerado.stdout}`);
  return tempRoot;
}

describe("TRACKER 0030 — modo consumidor do PLAYBOOK no clone do destinatário", () => {
  it("clone limpo: --check devolve exit 0 com aviso MODO CONSUMIDOR nomeando as fontes ausentes (hoje: exit 2 DRIFT falso)", async () => {
    const clone = await cloneLimpo();
    const r = rodar(clone, ["--check"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("MODO CONSUMIDOR");
    expect(r.stdout).toContain("AGENTS.md");
    expect(r.stdout).toContain(".agents/napkin.md");
    expect(r.stdout).not.toContain("DRIFT DETECTADO");
  });

  it("clone limpo: --write RECUSA com exit 2 nomeando as ausentes e PRESERVA o PLAYBOOK.md recebido byte-a-byte (hoje: degrada 9 para 2)", async () => {
    const clone = await cloneLimpo();
    const antes = await readFile(path.join(clone, "PLAYBOOK.md"));
    const r = rodar(clone, ["--write"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("MODO CONSUMIDOR");
    expect(r.stdout).toContain("AGENTS.md");
    const depois = await readFile(path.join(clone, "PLAYBOOK.md"));
    expect(sha(depois)).toBe(sha(antes));
  });

  it("clone limpo: --check-sent segue coerente (exit 0 — conferência das fontes enviadas)", async () => {
    const clone = await cloneLimpo();
    const r = rodar(clone, ["--check-sent"]);
    expect(r.code).toBe(0);
  });

  it.each([
    ["--check"],
    ["--check-sent"]
  ])("#57: %s acusa drift de fonte distribuída mesmo com o par recebido", async (flag) => {
    const clone = await cloneLimpo();
    const source = path.join(clone, "docs", "PLAYBOOK-RULES.md");
    const projectionPaths = ["PLAYBOOK.md", "PLAYBOOK.index.json"].map((file) => path.join(clone, file));
    const before = await Promise.all(projectionPaths.map((file) => readFile(file)));
    expect(rodar(clone, [flag]).code).toBe(0);

    await writeFile(source, "# Regra distribuída atualizada\n", "utf8");
    const r = rodar(clone, [flag]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("sha256 divergente: docs/PLAYBOOK-RULES.md");
    expect(await Promise.all(projectionPaths.map((file) => readFile(file)))).toEqual(before);
  });

  it("projeto fonte: drift REAL continua exit 2 e fresco continua exit 0 (sem regressao do gate do fonte)", async () => {
    const fonte = await fonteSintetica();
    const fresco = rodar(fonte, ["--check", "--sources", "docs/REGRAS.md"]);
    expect(fresco.code).toBe(0);
    expect(fresco.stdout).toContain("FRESCO");

    await writeFile(path.join(fonte, "docs", "REGRAS.md"), "# Regras\n\n## R1: regra MUTADA pelo drift real\n\nCorpo mutado.\n", "utf8");
    const drift = rodar(fonte, ["--check", "--sources", "docs/REGRAS.md"]);
    expect(drift.code).toBe(2);
    expect(drift.stdout).toContain("DRIFT DETECTADO");
  });
});
