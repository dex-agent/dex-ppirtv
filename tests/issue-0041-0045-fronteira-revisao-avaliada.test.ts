// GitHub #41, #44 e #45 — auditoria externa de 2026-11-23 (itens locais
// ISSUE-LOCAL-0033, 0036 e 0037). Reaberturas das frentes D, E e F.
//
//   #44: `isGitTracked` perguntava ao ÍNDICE ATUAL (git ls-files). Em janela
//        explícita (--base/--head) o gate da declaração aceitava laudo
//        commitado DEPOIS da revisão que fecha a janela.
//   #45: os ramos de `evidence_redirects` conferiam existsSync + sha256 no
//        DISCO — destino gitignored presente no disco passava.
//   #41: a cadeia de elos só era aceita se terminasse no ÚLTIMO record do
//        ledger; janela histórica que termina no meio não achava declaração.
//
// Ordem pedida pelo conselheiro $oraculo-refatoracao: caracterização ANTES
// (o ledger real, l.136), depois o vermelho dos casos novos.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBoundaryCli } from "../scripts/validate-flow-engine-boundary.mjs";

const WS = path.resolve(import.meta.dirname, "..");
const LEDGER = "docs/architecture/flow-engine-evolution.json";
const HEX40 = (char: string) => char.repeat(40);
const TESTE_FIXTURE = 'import { it } from "vitest";\nit("titulo do it sem metacaracteres", () => {});\n';
const SELETOR = "titulo do it sem metacaracteres";

type Receipt = { status: string; reasons?: string[]; ledger_bootstrap?: { status: string }; ledger_chain?: { records: string[] } };

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

type Repo = {
  dir: string;
  git: (args: string[]) => string;
  escrever: (rel: string, texto: string) => Promise<void>;
  commitMotor: (valor: number, mensagem: string, extras?: Record<string, string>) => Promise<string>;
  blobDoMotor: (ref: string) => string;
};

// Repo de camping mínimo: um commit do motor (a = 0) e os arquivos de apoio.
async function criarRepo(prefixo: string, extrasIniciais: Record<string, string> = {}): Promise<Repo> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), prefixo));
  const dir = tempRoot;
  const git = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  const escrever = async (rel: string, texto: string) => {
    const alvo = path.join(dir, rel);
    await mkdir(path.dirname(alvo), { recursive: true });
    await writeFile(alvo, texto, "utf8");
  };
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  git(["config", "commit.gpgsign", "false"]);
  await escrever("package.json", JSON.stringify({ name: "fixture", version: "0.0.0" }));
  await escrever("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n");
  await escrever("docs/architecture/FLOW_ENGINE_EVOLUTION.md", "# FlowEngine evolutionary architecture\n");
  await escrever("src/flow-engine.ts", "export const a = 0;\n");
  await escrever("src/server.ts", 'import { a } from "./flow-engine.js";\nexport const useA = a;\n');
  for (const [rel, texto] of Object.entries(extrasIniciais)) await escrever(rel, texto);
  const commitMotor = async (valor: number, mensagem: string, extras: Record<string, string> = {}) => {
    await escrever("src/flow-engine.ts", `export const a = ${valor};\n`);
    for (const [rel, texto] of Object.entries(extras)) await escrever(rel, texto);
    git(["add", "."]);
    git(["commit", "-qm", mensagem]);
    return git(["rev-parse", "HEAD"]);
  };
  await commitMotor(0, "c0");
  return { dir, git, escrever, commitMotor, blobDoMotor: (ref) => git(["rev-parse", `${ref}:src/flow-engine.ts`]) };
}

const rodar = async (repo: Repo, base: string, head: string): Promise<Receipt> =>
  JSON.parse((await runBoundaryCli({ cwd: repo.dir, argv: ["--base", base, "--head", head] })).output as string) as Receipt;

function record(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, date: "2026-11-23", mode: "EXCEPTION",
    owner: "$oraculo-refatoracao",
    exception_reason: "integrity",
    rollback: "Reverta a cura para restaurar o comportamento anterior.",
    expires: "next diff that touches src/flow-engine.ts",
    red_evidence: `tests/${id}.test.ts::${SELETOR}`,
    red_base_blob: HEX40("a"),
    red_observed_failure: "RED observado no base",
    red_command: `npx vitest run tests/${id}.test.ts -t "${SELETOR}"`,
    ...extra
  };
}

const cabeca = { contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$oraculo-refatoracao" };

describe("caracterização ANTES — o ledger real e a árvore dos commits (conselheiro: rede antes de mexer)", () => {
  it("toda evidência ordinária de record selado que existe no disco está na árvore do commit que selou", async () => {
    // Congela o fato que torna a regra "#44 por revisão" segura para o repo.
    // Independente do validador: só git.
    const ledger = JSON.parse(await readFile(path.join(WS, LEDGER), "utf8")) as { records: { id: string; commit?: string; evidence?: string[] }[] };
    const existeNaArvore = (ref: string, caminho: string) => {
      try { execFileSync("git", ["cat-file", "-e", `${ref}:${caminho}`], { cwd: WS, stdio: ["ignore", "pipe", "pipe"] }); return true; } catch { return false; }
    };
    let naArvore = 0;
    const fora: string[] = [];
    for (const r of ledger.records) {
      for (const evidencia of r.evidence ?? []) {
        if (!r.commit || evidencia.startsWith(".agents/") || !existsSync(path.join(WS, evidencia))) continue;
        if (existeNaArvore(r.commit, evidencia)) naArvore += 1;
        else fora.push(`${r.id}:${evidencia}`);
      }
    }
    expect(fora).toEqual([]);
    expect(naArvore).toBeGreaterThanOrEqual(80);
  });
});

describe("GitHub #44 — evidência é conferida na árvore da revisão que fecha a janela", () => {
  async function repoComLaudoTardio(prefixo: string): Promise<{ repo: Repo; c0: string; c1: string; c3: string }> {
    const repo = await criarRepo(prefixo);
    const c0 = repo.git(["rev-parse", "HEAD"]);
    const c1 = await repo.commitMotor(1, "v1", { "docs/laudo-cedo.json": "{}" });
    await repo.commitMotor(2, "v2");
    // O laudo tardio só entra no commit SEGUINTE à janela que o cita — no
    // clone de quem abre a janela ele não existe.
    const c3 = await repo.commitMotor(3, "v3", { "docs/laudo-tarde.json": "{}" });
    return { repo, c0, c1, c3 };
  }

  it("laudo commitado depois da revisão que fecha a janela reprova como não versionado", async () => {
    const { repo, c0, c1, c3 } = await repoComLaudoTardio("ppirtv-0044-tarde-");
    await repo.escrever(LEDGER, JSON.stringify({ ...cabeca, records: [
      record("FE-0044-TARDE", { base_blob: repo.blobDoMotor(c0), head_blob: repo.blobDoMotor(c1), commit: c1, parent_commit: c0, evidence: ["docs/laudo-cedo.json", "docs/laudo-tarde.json"] })
    ] }));
    repo.git(["add", "."]); repo.git(["commit", "-qm", "ledger"]);
    const r = await rodar(repo, c0, c1);
    expect(r.reasons ?? []).toContain("EVIDENCE_NOT_VERSIONED:docs/laudo-tarde.json");
    expect(r.reasons ?? []).not.toContain("EVIDENCE_NOT_VERSIONED:docs/laudo-cedo.json");
    void c3;
  });

  it("controle — laudo presente na árvore da revisão que fecha a janela segue aceito", async () => {
    const { repo, c0, c3 } = await repoComLaudoTardio("ppirtv-0044-cedo-");
    await repo.escrever(LEDGER, JSON.stringify({ ...cabeca, records: [
      record("FE-0044-CEDO", { base_blob: repo.blobDoMotor(c0), head_blob: repo.blobDoMotor(c3), commit: c3, parent_commit: c0, evidence: ["docs/laudo-cedo.json", "docs/laudo-tarde.json"] })
    ] }));
    repo.git(["add", "."]); repo.git(["commit", "-qm", "ledger"]);
    const r = await rodar(repo, c0, c3);
    expect(r.reasons ?? []).not.toContain("EVIDENCE_NOT_VERSIONED:docs/laudo-cedo.json");
    expect(r.reasons ?? []).not.toContain("EVIDENCE_NOT_VERSIONED:docs/laudo-tarde.json");
  });

  it("controle — arquivo no índice e ainda sem commit continua aceito na validação de stage", async () => {
    const repo = await criarRepo("ppirtv-0044-stage-");
    const c0 = repo.git(["rev-parse", "HEAD"]);
    await repo.escrever("src/flow-engine.ts", "export const a = 9;\n");
    await repo.escrever("tests/FE-0044-STAGE.test.ts", TESTE_FIXTURE);
    repo.git(["add", "."]);
    await repo.escrever(LEDGER, JSON.stringify({ ...cabeca, records: [
      record("FE-0044-STAGE", { base_blob: repo.blobDoMotor(c0), head_blob: repo.git(["hash-object", "src/flow-engine.ts"]), evidence: ["tests/FE-0044-STAGE.test.ts"] })
    ] }));
    const r = await rodar(repo, "HEAD", "WORKTREE");
    expect(r.reasons ?? []).not.toContain("EVIDENCE_NOT_VERSIONED:tests/FE-0044-STAGE.test.ts");
  });
});

describe("GitHub #45 — destino de redirecionamento precisa ser versionado, não só existir no disco", () => {
  const ORIGEM = ".agents/AUDITORIAS/cure-proof.json";
  const CONTEUDO = JSON.stringify({ red: true });
  const sha = () => createHash("sha256").update(CONTEUDO).digest("hex");

  async function repoComRedirect(prefixo: string, destino: string, destinoIgnorado: boolean) {
    const repo = await criarRepo(prefixo, destinoIgnorado ? { ".gitignore": "artifacts/\n" } : {});
    const c0 = repo.git(["rev-parse", "HEAD"]);
    const c1 = await repo.commitMotor(1, "c1", {
      "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n- marker-0045\n",
      "docs/architecture/FLOW_ENGINE_EVOLUTION.md": "# FlowEngine evolutionary architecture\n\nmarker-arch-0045\n",
      "tests/FE-0045-REDIRECT.test.ts": TESTE_FIXTURE,
      ".agents/PLAN-TASKS/trilho-0045.md": "# trilho fixture\n"
    });
    await repo.escrever(destino, CONTEUDO);
    await repo.escrever(LEDGER, JSON.stringify({
      ...cabeca,
      records: [record("FE-0045-REDIRECT", {
        base_blob: repo.blobDoMotor(c0), head_blob: repo.blobDoMotor(c1), commit: c1, parent_commit: c0,
        spt_path: ".agents/PLAN-TASKS/trilho-0045.md", responsibility: "fixture redirect",
        changelog_marker: "marker-0045", architecture_marker: "marker-arch-0045", consumers: ["src/server.ts"],
        evidence: [ORIGEM, "tests/FE-0045-REDIRECT.test.ts"],
        red_evidence: `tests/FE-0045-REDIRECT.test.ts::${SELETOR}`,
        evidence_selectors: { "tests/FE-0045-REDIRECT.test.ts": SELETOR }
      })],
      evidence_redirects: { [ORIGEM]: { target: destino, sha256: sha() } }
    }));
    repo.git(["add", "."]);
    repo.git(["commit", "-qm", "c2-ledger"]);
    return { repo, c1, c2: repo.git(["rev-parse", "HEAD"]), versionadoNoGit: repo.git(["ls-files", "--", destino]).length > 0 };
  }

  it("no record-check, destino presente só no disco reprovava como redirecionamento inválido", async () => {
    const { repo, c1, c2, versionadoNoGit } = await repoComRedirect("ppirtv-0045-bootstrap-", "artifacts/destino.json", true);
    expect(versionadoNoGit).toBe(false);
    const r = await rodar(repo, c1, c2);
    if (!(r.reasons ?? []).some((reason) => reason.includes(`EVIDENCE_REDIRECT_INVALID:${ORIGEM}`))) {
      console.log("REDIRECT_RECEIPT", JSON.stringify({ status: r.status, bootstrap: r.ledger_bootstrap, reasons: r.reasons }));
    }
    // No record-check os reasons vêm prefixados com BOOTSTRAP_RECORD_INVALID:<id>:
    // a asserção é por substring, válida nos dois formatos.
    expect((r.reasons ?? []).some((reason) => reason.includes(`EVIDENCE_REDIRECT_INVALID:${ORIGEM}`))).toBe(true);
    expect(r.ledger_bootstrap?.status).toBe("FAIL");
  });

  it("controle — destino versionado segue aceito", async () => {
    const { repo, c1, c2, versionadoNoGit } = await repoComRedirect("ppirtv-0045-ok-", "docs/architecture/ledger-evidence/destino.json", false);
    expect(versionadoNoGit).toBe(true);
    const r = await rodar(repo, c1, c2);
    expect(r.reasons ?? []).not.toContain(`EVIDENCE_REDIRECT_INVALID:${ORIGEM}`);
  });

  it("redirecionamento NOVO apontando destino só do disco reprova no diff do ledger", async () => {
    const { repo, c2 } = await repoComRedirect("ppirtv-0045-diff-", "docs/architecture/ledger-evidence/destino.json", false);
    const manifest = JSON.parse(await readFile(path.join(repo.dir, LEDGER), "utf8")) as { evidence_redirects: Record<string, unknown> };
    // Records byte-idênticos: o diff do ledger só ACRESCENTA o redirect.
    // O destino fica FORA do commit (gitignored) — presente no disco, ausente do clone.
    await repo.escrever(".gitignore", "artifacts/\n");
    await repo.escrever("artifacts/destino.json", CONTEUDO);
    manifest.evidence_redirects[".agents/AUDITORIAS/outro.json"] = { target: "artifacts/destino.json", sha256: sha() };
    await repo.escrever(LEDGER, JSON.stringify(manifest));
    repo.git(["add", "."]);
    repo.git(["commit", "-qm", "c3-redirect-novo"]);
    expect(repo.git(["ls-files", "--", "artifacts/destino.json"])).toBe("");
    const r = await rodar(repo, c2, repo.git(["rev-parse", "HEAD"]));
    if (!(r.reasons ?? []).includes("EVIDENCE_REDIRECT_INVALID:.agents/AUDITORIAS/outro.json")) {
      console.log("REDIRECT_DIFF_RECEIPT", JSON.stringify({ status: r.status, reasons: r.reasons }));
    }
    expect(r.reasons ?? []).toContain("EVIDENCE_REDIRECT_INVALID:.agents/AUDITORIAS/outro.json");
  });
});

describe("GitHub #41 — cadeia de elos pode terminar antes do último record", () => {
  async function repoComTresElos(prefixo: string, eloDoMeioQuebrado = false) {
    const repo = await criarRepo(prefixo);
    const c0 = repo.git(["rev-parse", "HEAD"]);
    const c1 = await repo.commitMotor(1, "v1", {
      "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n- marker-um\n",
      "docs/architecture/FLOW_ENGINE_EVOLUTION.md": "# FlowEngine evolutionary architecture\n\nmarker-arch-um\n",
      "tests/FE-41-UM.test.ts": TESTE_FIXTURE,
      ".agents/PLAN-TASKS/trilho-um.md": "# trilho um\n"
    });
    const c2 = await repo.commitMotor(2, "v2", {
      "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n- marker-um\n- marker-dois\n",
      "docs/architecture/FLOW_ENGINE_EVOLUTION.md": "# FlowEngine evolutionary architecture\n\nmarker-arch-um\nmarker-arch-dois\n",
      "tests/FE-41-DOIS.test.ts": TESTE_FIXTURE,
      ".agents/PLAN-TASKS/trilho-dois.md": "# trilho dois\n"
    });
    const elo = (id: string, base: string, head: string, tag: string, selo?: { commit: string; parent: string }) => record(id, {
      base_blob: repo.blobDoMotor(base), head_blob: repo.blobDoMotor(head),
      ...(selo ?? {}),
      spt_path: `.agents/PLAN-TASKS/trilho-${tag}.md`, responsibility: `fixture ${tag}`,
      changelog_marker: `marker-${tag}`, architecture_marker: `marker-arch-${tag}`, consumers: ["src/server.ts"],
      evidence: [`tests/${id}.test.ts`], red_evidence: `tests/${id}.test.ts::${SELETOR}`,
      evidence_selectors: { [`tests/${id}.test.ts`]: SELETOR }
    });
    // Elo 3 fica DEPOIS da janela (corte posterior válido) — ele é o que hoje
    // faz a busca exigir que a cadeia termine no último record.
    const terceiro = elo("FE-41-TRES", c2, c2, "tres");
    terceiro.head_blob = HEX40(eloDoMeioQuebrado ? "f" : "e");
    await repo.escrever(LEDGER, JSON.stringify({ ...cabeca, records: [
      elo("FE-41-UM", c0, c1, "um", { commit: c1, parent_commit: c0 }),
      eloDoMeioQuebrado ? { ...elo("FE-41-DOIS", c1, c2, "dois"), base_blob: HEX40("f") } : elo("FE-41-DOIS", c1, c2, "dois"),
      terceiro
    ] }));
    repo.git(["add", "."]);
    repo.git(["commit", "-qm", "ledger"]);
    return { repo, c0, c2 };
  }

  it("janela cuja cadeia termina antes do último record acha a cadeia e não pede declaração", async () => {
    const { repo, c0, c2 } = await repoComTresElos("ppirtv-0041-meio-");
    const r = await rodar(repo, c0, c2);
    expect(r.reasons ?? []).not.toContain("MATCHING_DECLARATION_REQUIRED");
    expect(r.ledger_chain?.records).toEqual(["FE-41-UM", "FE-41-DOIS"]);
  });

  it("controle — elo quebrado entre a base e o fim da janela continua pedindo declaração", async () => {
    const { repo, c0, c2 } = await repoComTresElos("ppirtv-0041-quebrado-", true);
    const r = await rodar(repo, c0, c2);
    expect(r.reasons ?? []).toContain("MATCHING_DECLARATION_REQUIRED");
  });

  it("a janela histórica real 94a9b0c..ae8b86f do repo deixa de pedir declaração", async () => {
    const saida = await runBoundaryCli({ cwd: WS, argv: ["--base", "94a9b0c", "--head", "ae8b86f"] });
    const r = JSON.parse(saida.output as string) as Receipt;
    if (r.reasons?.includes("MATCHING_DECLARATION_REQUIRED")) console.log("JANELA_94a9b0c_AE8b86f", JSON.stringify({ status: r.status, reasons: r.reasons }));
    expect(r.reasons ?? []).not.toContain("MATCHING_DECLARATION_REQUIRED");
  }, 60_000);
});
