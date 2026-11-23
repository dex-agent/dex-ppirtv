// GitHub #42 + #43 (auditoria externa 2026-11-23; itens ISSUE-LOCAL-0034 e 0035).
//
// O modo consumidor nasceu no ISSUE-LOCAL-0030 (commit 6b3ea97) com dois furos:
//   #43 — qualquer fonte AUSENTE era lida como "clone consumidor", inclusive
//         candidato da autodetecção: um produtor mínimo (só AGENTS.md, sem
//         manifesto) recebia RECUSA no --write.
//   #42 — no modo consumidor, --check devolvia exit 0 antes de conferir se
//         PLAYBOOK.md e PLAYBOOK.index.json existiam: clone incompleto passava.
// Cura: só fonte DECLARADA (manifesto ou --sources) ausente faz consumidor; as
// conferências do consumidor exigem o par recebido.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

// CLI com exit capturado (com achados o exit != 0 lança — stdout vem no erro).
const rodar = (cwd: string, flags: string[]): Saida => {
  try {
    return { code: 0, stdout: execFileSync("python", ["-B", GERADOR, "--repo", cwd, ...flags], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; status?: number };
    return { code: e.status ?? 1, stdout: (e.stdout ?? "").toString() };
  }
};

// Regra no formato da fonte que viaja (docs/PLAYBOOK-RULES.md).
const REGRA = [
  "# Regras",
  "",
  "## Painel de Ferramentas",
  "- `PAINEL-DE-FERRAMENTAS-TESTE`",
  "- Gatilho: antes de implementar, consulte as ferramentas disponiveis.",
  "1. Abra o indice.",
  "",
].join("\n");

// Clone do destinatário com manifesto: fonte pública presente, fontes
// privadas ausentes (por design não viajam) — o cenário do ISSUE-LOCAL-0030.
async function cloneConsumidor(sem: "md" | "index" | "nenhum"): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-0042-clone-"));
  const copias = [
    "PLAYBOOK.md", "PLAYBOOK.index.json",
    "tools/playbook/generate-playbook.py", "tools/playbook/playbook-sources.txt",
    "docs/PLAYBOOK-RULES.md",
  ].filter((rel) => !(sem === "md" && rel === "PLAYBOOK.md") && !(sem === "index" && rel === "PLAYBOOK.index.json"));
  for (const rel of copias) {
    const dest = path.join(tempRoot, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(path.join(REPO, rel), dest);
  }
  return tempRoot;
}

describe("GitHub #42 + #43 — modo consumidor do gerador do Playbook", () => {
  it("produtor minimo sem manifesto gera o primeiro par com exit 0", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-0043-produtor-"));
    await writeFile(path.join(tempRoot, "AGENTS.md"), REGRA, "utf8");
    const r = rodar(tempRoot, ["--write"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("MODO CONSUMIDOR");
    expect(JSON.parse(await readFile(path.join(tempRoot, "PLAYBOOK.index.json"), "utf8")).rules[0].locator).toBe("PAINEL-DE-FERRAMENTAS-TESTE");
  });

  it("clone consumidor sem PLAYBOOK.md reprova --check com exit 2 nomeando o arquivo", async () => {
    const clone = await cloneConsumidor("md");
    const r = rodar(clone, ["--check"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("PLAYBOOK.md");
  });

  it("clone consumidor sem PLAYBOOK.index.json reprova --check com exit 2 nomeando o arquivo", async () => {
    const clone = await cloneConsumidor("index");
    const r = rodar(clone, ["--check"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("PLAYBOOK.index.json");
  });

  it("clone consumidor sem PLAYBOOK.md reprova --check-sent com exit 2", async () => {
    const clone = await cloneConsumidor("md");
    const r = rodar(clone, ["--check-sent"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("PLAYBOOK.md");
  });
});
