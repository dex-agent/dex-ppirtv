// ISSUE-LOCAL-0031 (UAT-1 A3, 2026-11-22): defeitos de projeção do parser do
// gerador do Playbook. Reproduzidos no PLAYBOOK real do repo em 2026-11-23.
//
//   localizador  = 1º token CAPS-hífen ≥12 do corpo → citação interna virava
//                  nome da regra (Bootstrap→TRACKER-LOCAL, Leitura→
//                  PENDENTES-LEDGER, Dex Agent→PPIRTV-GIT-CONSOLIDACAO-…)
//   gatilho      = 1ª linha que contém "gatilho" → casava GATILHOS-VIVOS e
//                  repetia o rótulo ("- Gatilho: - Gatilho: …")
//   extrato      = 1ª linha não vazia → cerca de código (```powershell) ou a
//                  bala do token
//   duplicata    = mesma regra em duas fontes saía duas vezes
//   grafia       = "ndeclarado"
// Cura: token só nomeia a regra por DECLARAÇÃO (título, linha `Localizador:`,
// bala sozinha no topo do corpo); gatilho só de linha `Gatilho:`; extrato só
// de prosa; primeira ocorrência ganha; "não declarado".
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

type Indice = {
  rules: { locator: string; title: string; gatilho: string; extrato: string; fonte: string }[];
  nao_decodificadas: { titulo: string; ancora: string; motivo?: string }[];
};

// Caminho do consumidor real: gerar a projeção na fixture e ler o que foi publicado.
async function projetar(fontes: Record<string, string>): Promise<{ indice: Indice; md: string }> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-0031-parser-"));
  for (const [rel, texto] of Object.entries(fontes)) {
    const alvo = path.join(tempRoot, rel);
    await mkdir(path.dirname(alvo), { recursive: true });
    await writeFile(alvo, texto, "utf8");
  }
  const saida = execFileSync("python", ["-B", GERADOR, "--repo", tempRoot, "--write", "--sources", Object.keys(fontes).join(",")], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!saida.includes("PLAYBOOK written")) throw new Error(saida);
  return {
    indice: JSON.parse(await readFile(path.join(tempRoot, "PLAYBOOK.index.json"), "utf8")) as Indice,
    md: await readFile(path.join(tempRoot, "PLAYBOOK.md"), "utf8"),
  };
}

describe("ISSUE-LOCAL-0031 — parser do gerador do Playbook", () => {
  it("token que so aparece em citacao interna do corpo nao nomeia a regra — a secao entra em nao decodificadas", async () => {
    const { indice } = await projetar({
      "AGENTS.md": "# Regras\n\n## Bootstrap\n\nLeia o indice local `TRACKER-LOCAL-QUALQUER-COISA` antes de comecar.\n\n1. Passo um.\n",
    });
    expect(indice.rules).toHaveLength(0);
    expect(indice.nao_decodificadas.map((u) => u.titulo)).toEqual(["Bootstrap"]);
  });

  it("localizador em bala sozinha no topo do corpo nomeia a regra", async () => {
    const { indice } = await projetar({
      "RULES.md": "# Regras\n\n## Painel de Ferramentas\n- `PAINEL-DE-FERRAMENTAS-TESTE`\n- Gatilho: antes de implementar.\n1. Rota um.\n",
    });
    expect(indice.rules.map((r) => r.locator)).toEqual(["PAINEL-DE-FERRAMENTAS-TESTE"]);
    expect(indice.nao_decodificadas).toHaveLength(0);
  });

  it("linha Localizador: nomeia a regra", async () => {
    const { indice } = await projetar({
      "AGENTS.md": "# Regras\n\n## Plaquinha de teste\n\nLocalizador: `FOO-BAR-BAZ-QUX-TESTE`\n\nCorpo da plaquinha.\n",
    });
    expect(indice.rules.map((r) => r.locator)).toEqual(["FOO-BAR-BAZ-QUX-TESTE"]);
  });

  it("token no titulo da secao nomeia a regra", async () => {
    const { indice } = await projetar({
      "AGENTS.md": "# Regras\n\n## Regra `TITULO-COM-TOKEN-TESTE`\n\nCorpo da regra.\n",
    });
    expect(indice.rules.map((r) => r.locator)).toEqual(["TITULO-COM-TOKEN-TESTE"]);
  });

  it("gatilho projetado e o valor da linha Gatilho: da fonte, sem rotulo repetido", async () => {
    const { indice, md } = await projetar({
      "RULES.md": "# Regras\n\n## Regra de exemplo\n- `UAT-REGRA-EXEMPLO-001`\n- Gatilho: ao executar o teste, rode o ciclo completo.\n1. Rota um.\n",
    });
    expect(indice.rules[0].gatilho).toBe("ao executar o teste, rode o ciclo completo.");
    expect(md).toContain("- Gatilho: ao executar o teste, rode o ciclo completo.");
    expect(md).not.toContain("- Gatilho: - Gatilho");
  });

  it("linha que so menciona GATILHOS-VIVOS nao vira gatilho da regra", async () => {
    const { indice } = await projetar({
      "AGENTS.md": "# Regras\n\n## Painel\n\n- `PAINEL-DE-TESTE-AAAA`\n\n### 4. Memorias quentes — completo em `.agents/GATILHOS-VIVOS.md`\n\nConsulte o painel.\n",
    });
    expect(indice.rules[0].gatilho).toBe("não declarado");
  });

  it("extrato projetado e prosa da fonte — nunca cerca de codigo nem a bala do localizador", async () => {
    const { indice } = await projetar({
      "AGENTS.md": [
        "# Regras",
        "",
        "## Validacao minima",
        "- `VALIDACAO-MINIMA-TESTE-AAAA`",
        "- Gatilho: antes de declarar pronto.",
        "",
        "Rode a validacao minima antes de declarar pronto.",
        "",
        "```powershell",
        "npm run check",
        "```",
        "",
      ].join("\n"),
    });
    expect(indice.rules[0].extrato).toBe("Rode a validacao minima antes de declarar pronto.");
    expect(indice.rules[0].extrato).not.toContain("```");
    expect(indice.rules[0].extrato).not.toBe("- `VALIDACAO-MINIMA-TESTE-AAAA`");
  });

  it("regra sem prosa na fonte projeta a linha do extrato omitida", async () => {
    const { indice, md } = await projetar({
      "RULES.md": "# Regras\n\n## Painel de Ferramentas\n- `PAINEL-DE-FERRAMENTAS-TESTE`\n- Gatilho: antes de implementar.\n1. Abra o indice.\n",
    });
    expect(indice.rules[0].extrato).toBe("");
    expect(md).not.toContain("- Extrato:");
  });

  it("localizador repetido em duas fontes projeta uma unica regra — a primeira fonte ganha e a repetida entra em nao decodificadas", async () => {
    const secao = "## Painel de Ferramentas\n- `PAINEL-DE-FERRAMENTAS-TESTE`\n- Gatilho: antes de implementar.\n";
    const { indice } = await projetar({ "A.md": "# Regras\n\n" + secao, "B.md": "# Regras\n\n" + secao });
    expect(indice.rules).toHaveLength(1);
    expect(indice.rules[0].fonte.startsWith("A.md")).toBe(true);
    expect(indice.nao_decodificadas).toHaveLength(1);
    expect(indice.nao_decodificadas[0].motivo).toContain("PAINEL-DE-FERRAMENTAS-TESTE");
  });

  it("grafia legivel: regra sem gatilho declarado projeta 'não declarado', nunca 'ndeclarado'", async () => {
    const { indice, md } = await projetar({
      "RULES.md": "# Regras\n\n## Regra sem gatilho\n- `REGRA-SEM-GATILHO-TESTE`\n\nTexto da regra.\n",
    });
    expect(indice.rules[0].gatilho).toBe("não declarado");
    expect(md).not.toContain("ndeclarado");
  });
});
