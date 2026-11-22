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

// Repo root relativo ao arquivo do teste — portavel para clone limpo de CI
// (cwd hardcodado de maquina mata o spawnSync do validador com ENOENT).
const WS = path.resolve(__dirname, "..");
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
  it("cura replay 94a9b0c..HEAD (janela viva, elos ate o record mais recente) passa com historia selada", async () => {
    // A janela viva termina no record mais recente do ledger (chainRecords
    // exige at(-1).head_blob == headBlob). O head e HEAD (dinamico): hash de
    // commit auto-referencia e nao existiria no propio commit — com HEAD o
    // teste resolve o blob do motor no checkout vigente (CI/clone sempre
    // casam; dev com corte do motor em andamento ve o falso vermelho conhecido
    // do ledger a frente do HEAD — mesma classe do tree sujo). Os 4 records
    // com selo pago DENTRO da janela ficam historia selada; o B-prime
    // (excecao vencida pela frente B) e o declaration material legitimo e o
    // CONTAIN mais recente.
    const result = await runBoundaryCli({ cwd: WS, argv: ["--base", "94a9b0c", "--head", "HEAD"] }) as { exitCode: number; output: string };
    const receipt = JSON.parse(result.output) as { status: string; reasons?: string[]; comparison?: unknown };
    // Diagnostico-que-ensina: no CI (clone limpo) qualquer reason extra fica
    // visivel no log do run — nunca um FAIL mudo de ambiente.
    if (receipt.status !== "PASS") {
      console.log("REPLAY_RECEIPT", JSON.stringify({ status: receipt.status, reasons: receipt.reasons, comparison: receipt.comparison }));
    }
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

describe("evidence nao-versionada (.agents/) — gate EVIDENCE_NOT_VERSIONED (classe do run 44505736533)", () => {
  it("declaration citando .agents/ reprova EVIDENCE_NOT_VERSIONED mesmo com o arquivo existindo no disco", async () => {
    // Causa-raiz medida no CI run 4 (44505736533): o record citava
    // .agents/AUDITORIAS/... como evidence — .agents/ e gitignored por design
    // (viaja via PLAYBOOK), existsSync passa na maquina local (falso verde do
    // pre-commit) e morre no clone limpo do runner. O gate impossibilita a
    // classe: evidencia de declaration tem que ser reabrivel no clone.
    const git = (args: string[]) => execFileSync("git", ["-C", tempRoot, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-ev-"));
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "docs", "architecture"), { recursive: true });
    await mkdir(path.join(tempRoot, ".agents", "AUDITORIAS"), { recursive: true });
    git(["init", "-q"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]); git(["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(tempRoot, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf8");
    await writeFile(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n- marker-ev\n", "utf8");
    await writeFile(path.join(tempRoot, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# FlowEngine evolutionary architecture\n", "utf8");
    await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), "export const a = 1;\n", "utf8");
    git(["add", "."]); git(["commit", "-qm", "v1"]);
    const blobA = execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), "export const a = 2;\n", "utf8");
    git(["add", "."]); git(["commit", "-qm", "v2"]);
    const blobB = execFileSync("git", ["-C", tempRoot, "hash-object", "src/flow-engine.ts"]).toString().trim();
    // O path .agents/ EXISTE no disco da fixture (untracked) — provando que
    // existsSync sozinho nao salva: o gate reprova pela nao-versionabilidade.
    await writeFile(path.join(tempRoot, ".agents", "AUDITORIAS", "cure-proof.json"), "{}", "utf8");
    const ledger = {
      records: [
        exceptionRecord("FE-EV-NAO-VERSIONADA", {
          base_blob: blobA,
          head_blob: blobB,
          evidence: [".agents/AUDITORIAS/cure-proof.json"],
          red_evidence: ""
        })
      ]
    };
    await writeFile(
      path.join(tempRoot, "docs", "architecture", "flow-engine-evolution.json"),
      JSON.stringify(ledger), "utf8"
    );
    git(["add", "."]); git(["commit", "-qm", "ledger"]);
    const result = await runBoundaryCli({ cwd: tempRoot, argv: ["--base", "HEAD~2", "--head", "HEAD~1"] }) as { exitCode: number; output: string };
    const receipt = JSON.parse(result.output) as { status: string; reasons?: string[] };
    expect(receipt.reasons ?? []).toContain("EVIDENCE_NOT_VERSIONED:.agents/AUDITORIAS/cure-proof.json");
    expect(receipt.reasons ?? []).not.toContain("EVIDENCE_NOT_FOUND:.agents/AUDITORIAS/cure-proof.json");
    expect(receipt.status).toBe("FAIL");
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

// Trilho 2026-11-21-redirect-evidence-legada-ledger — records legados selados
// citam evidence .agents/ (gitignored; classe #19 claim-sem-receipt) e sao
// IMUTAVEIS por selo (LEDGER_HISTORY_MUTATED). A cura e o redirect versionado
// no manifest (evidence_redirects): records byte-identicos, destino versionado
// + sha256 conferidos. A porta vale SO no record-check (bootstrap) — o
// declaration gate (anexos novos) permanece fechado (it acima intocado).
describe("evidence_redirects — record-check bootstrap resolve evidence legada .agents/ via destino versionado", () => {
  type RedirectMap = Record<string, { target: string; sha256?: string }>;

  async function bootstrapFixture(redirects: RedirectMap) {
    const git = (args: string[]) => execFileSync("git", ["-C", tempRoot, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-redirect-"));
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "docs", "architecture", "ledger-evidence"), { recursive: true });
    await mkdir(path.join(tempRoot, ".agents", "PLAN-TASKS"), { recursive: true });
    await mkdir(path.join(tempRoot, ".agents", "AUDITORIAS"), { recursive: true });
    git(["init", "-q"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]); git(["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(tempRoot, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf8");
    await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), "export const a = 1;\n", "utf8");
    git(["add", "."]); git(["commit", "-qm", "c0"]);
    const c0 = git(["rev-parse", "HEAD"]).trim();
    await writeFile(path.join(tempRoot, "src", "flow-engine.ts"), "export const a = 2;\n", "utf8");
    await writeFile(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n- marker-redirect\n", "utf8");
    await writeFile(path.join(tempRoot, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# FlowEngine evolutionary architecture\n\nmarker-arch-redirect\n", "utf8");
    await writeFile(path.join(tempRoot, "src", "server.ts"), "import { a } from \"./flow-engine.js\";\nexport const useA = a;\n", "utf8");
    await mkdir(path.join(tempRoot, "tests"), { recursive: true });
    await writeFile(path.join(tempRoot, "tests", "FE-FIXTURE-REDIRECT.test.ts"), "import { it } from \"vitest\";\nit(\"titulo do it sem metacaracteres\", () => {});\n", "utf8");
    await writeFile(path.join(tempRoot, ".agents", "PLAN-TASKS", "trilho-fixture-redirect.md"), "# trilho fixture\n", "utf8");
    await writeFile(path.join(tempRoot, ".agents", "AUDITORIAS", "cure-proof.json"), JSON.stringify({ red: true, mutacoes: 1 }), "utf8");
    git(["add", "."]); git(["commit", "-qm", "c1"]);
    const c1 = git(["rev-parse", "HEAD"]).trim();
    const blobA = git(["rev-parse", `${c0}:src/flow-engine.ts`]).trim();
    const blobB = git(["rev-parse", `${c1}:src/flow-engine.ts`]).trim();
    // copia versionada byte-a-byte do artefato .agents (a prova re-abrivel)
    await writeFile(path.join(tempRoot, "docs", "architecture", "ledger-evidence", "cure-proof.json"), JSON.stringify({ red: true, mutacoes: 1 }), "utf8");
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(JSON.stringify({ red: true, mutacoes: 1 })).digest("hex");
    const ledger = {
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$oraculo-refatoracao",
      records: [
        exceptionRecord("FE-FIXTURE-REDIRECT", {
          date: "2026-11-21",
          base_blob: blobA,
          head_blob: blobB,
          commit: c1,
          parent_commit: c0,
          spt_path: ".agents/PLAN-TASKS/trilho-fixture-redirect.md",
          responsibility: "fixture redirect",
          owner: "$oraculo-refatoracao",
          changelog_marker: "marker-redirect",
          architecture_marker: "marker-arch-redirect",
          consumers: ["src/server.ts"],
          evidence: [".agents/AUDITORIAS/cure-proof.json", "tests/FE-FIXTURE-REDIRECT.test.ts"],
          red_evidence: "tests/FE-FIXTURE-REDIRECT.test.ts::titulo do it sem metacaracteres",
          evidence_selectors: { "tests/FE-FIXTURE-REDIRECT.test.ts": "titulo do it sem metacaracteres" }
        })
      ],
      evidence_redirects: redirects
    };
    await writeFile(
      path.join(tempRoot, "docs", "architecture", "flow-engine-evolution.json"),
      JSON.stringify(ledger), "utf8"
    );
    git(["add", "."]); git(["commit", "-qm", "c2-ledger"]);
    const c2 = git(["rev-parse", "HEAD"]).trim();
    // janela bootstrap: motor igual entre c1 e c2, ledger so existe em c2
    const result = await runBoundaryCli({ cwd: tempRoot, argv: ["--base", c1, "--head", c2] }) as { exitCode: number; output: string };
    return { receipt: JSON.parse(result.output) as { status: string; reasons?: string[]; ledger_bootstrap?: { status: string } }, sha };
  }

  it("record legado com redirect sancionado (destino versionado + sha confere) NAO reprova EVIDENCE_NOT_VERSIONED no bootstrap", async () => {
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(JSON.stringify({ red: true, mutacoes: 1 })).digest("hex");
    const { receipt } = await bootstrapFixture({
      ".agents/AUDITORIAS/cure-proof.json": { target: "docs/architecture/ledger-evidence/cure-proof.json", sha256: sha }
    });
    expect(receipt.ledger_bootstrap?.status).toBe("PASS");
    expect(receipt.reasons ?? []).not.toContain("EVIDENCE_NOT_VERSIONED:.agents/AUDITORIAS/cure-proof.json");
    // janela bootstrap nao toca o motor: o status global da visita e
    // NOT_APPLICABLE (o verde aqui e o ledger_bootstrap PASS sem reasons).
    expect(receipt.status).toBe("NOT_APPLICABLE");
  });

  it("redirect apontando destino .agents/ reprova EVIDENCE_REDIRECT_INVALID (porta nao vira afrouxamento)", async () => {
    const { receipt } = await bootstrapFixture({
      ".agents/AUDITORIAS/cure-proof.json": { target: ".agents/AUDITORIAS/cure-proof.json" }
    });
    expect(receipt.ledger_bootstrap?.status).toBe("FAIL");
    // reasons do record-check chegam prefixados (BOOTSTRAP_RECORD_INVALID:<id>:...)
    expect(JSON.stringify(receipt.reasons ?? [])).toContain("EVIDENCE_REDIRECT_INVALID:.agents/AUDITORIAS/cure-proof.json");
  });

  it("redirect com destino versionado inexistente reprova EVIDENCE_REDIRECT_INVALID", async () => {
    const { receipt } = await bootstrapFixture({
      ".agents/AUDITORIAS/cure-proof.json": { target: "docs/architecture/ledger-evidence/sumiu.json" }
    });
    expect(JSON.stringify(receipt.reasons ?? [])).toContain("EVIDENCE_REDIRECT_INVALID:.agents/AUDITORIAS/cure-proof.json");
  });

  it("redirect com sha256 divergente do destino reprova EVIDENCE_REDIRECT_SHA_MISMATCH", async () => {
    const { receipt } = await bootstrapFixture({
      ".agents/AUDITORIAS/cure-proof.json": { target: "docs/architecture/ledger-evidence/cure-proof.json", sha256: "deadbeef".repeat(8) }
    });
    expect(JSON.stringify(receipt.reasons ?? [])).toContain("EVIDENCE_REDIRECT_SHA_MISMATCH:.agents/AUDITORIAS/cure-proof.json");
  });
});
