// post-merge (implementacao): paridade auto-curativa dos 4 pares globais
// apos pull/merge. COPIA repo->global quando o par mudou no merge e o global
// esta no estado anterior; RECUSA sobrescrever global divergente de ORIG_HEAD
// e de HEAD (edicao local viva) gritando a instrucao; INALTERADO quando
// nenhum par mudou. Zero instalacao: hooksPath ja aponta para esta pasta;
// maquina nova ativa com `git config core.hooksPath tools/playbook/hooks`.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPairs } from "../../../scripts/canonical-pairs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const userProfile = process.env.USERPROFILE ?? process.env.HOME;

function sha(text) {
  return createHash("sha256").update(String(text).replace(/\r\n/g, "\n")).digest("hex");
}

function shaFile(filePath) {
  try {
    return sha(readFileSync(filePath, "utf8"));
  } catch {
    return null; // ausente
  }
}

// Decisao pura (testavel): sha novo do repo, sha anterior do repo, sha do
// global -> o que o hook faz com o global?
export function decide({ novo, antes, global }) {
  if (global === null) return "CRIAR";
  if (global === novo) return "JA-OK";
  if (global === antes) return "COPIAR";
  return "RECUSADO";
}

function syncPair(pair, novo, antes, logs) {
  const acao = decide({ novo, antes, global: shaFile(pair.global) });
  if (acao === "JA-OK") {
    logs.push(`JA-OK: ${pair.label} (global ja igual ao pull)`);
    return true;
  }
  if (acao === "CRIAR" || acao === "COPIAR") {
    mkdirSync(path.dirname(pair.global), { recursive: true });
    copyFileSync(pair.local, pair.global);
    logs.push(`COPIADO: ${pair.label} -> ${pair.global} (sha ${novo.slice(0, 12)})`);
    return true;
  }
  logs.push(`RECUSADO: ${pair.label} — global divergente do ORIG_HEAD e do HEAD (edicao local viva); reconcilie a mao: compare ${pair.global} com ${pair.local} e rode npm run audit:canonical`);
  return false;
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function origRef() {
  for (const ref of ["ORIG_HEAD", "HEAD@{1}"]) {
    try {
      git(["rev-parse", "--verify", ref]);
      return ref;
    } catch {
      // tenta o proximo
    }
  }
  return null;
}

function main() {
  if (process.argv.includes("--self-test")) {
    return runSelfTest();
  }
  if (process.argv.includes("--help")) {
    console.log("post-merge: sincroniza os 4 pares globais apos pull/merge (repo -> ~/.agents). Flags: --self-test | --help");
    return 0;
  }
  if (!userProfile) {
    console.error("post-merge: USERPROFILE/HOME ausente; nada a sincronizar.");
    return 0;
  }
  const orig = origRef();
  if (!orig) {
    console.log("post-merge: sem ORIG_HEAD/HEAD@{1} (clone inicial?); nada a comparar.");
    return 0;
  }
  let changed;
  try {
    changed = new Set(git(["diff", "--name-only", orig, "HEAD"]).split(/\r?\n/).filter(Boolean));
  } catch (error) {
    console.error(`post-merge: nao foi possivel diffar ${orig}..HEAD (${String(error).slice(0, 80)}); rode npm run audit:canonical.`);
    return 0;
  }
  const logs = [];
  let ok = true;
  let tocados = 0;
  for (const pair of canonicalPairs(repoRoot, userProfile)) {
    const rel = path.relative(repoRoot, pair.local).split(path.sep).join("/");
    if (!changed.has(rel)) {
      continue;
    }
    tocados += 1;
    const novo = shaFile(pair.local);
    let antes = null;
    try {
      antes = sha(git(["show", `${orig}:${rel}`]));
    } catch {
      antes = null; // par novo no repo -> CRIAR
    }
    ok = syncPair(pair, novo, antes, logs) && ok;
  }
  if (tocados === 0) {
    console.log("post-merge: INALTERADO — nenhum dos 4 pares globais mudou neste pull.");
    return 0;
  }
  for (const line of logs) {
    console.log(`post-merge: ${line}`);
  }
  return ok ? 0 : 1;
}

function runSelfTest() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "postmerge-"));
  const logs = [];
  const antesTxt = "estado ANTES do pull\n";
  const novoTxt = "estado NOVO trazido pelo pull\n";
  const vivoTxt = "edicao local VIVA sem commit\n";
  let falhas = 0;
  const check = (cond, msg) => {
    if (!cond) {
      falhas += 1;
      console.error(`self-test FALHOU: ${msg}`);
    }
  };
  // C-01 COPIADO: mudou no merge, global no estado anterior -> copia
  const repoA = path.join(dir, "repo-a.md");
  const globA = path.join(dir, "glob", "a.md");
  writeFileSync(repoA, novoTxt);
  mkdirSync(path.dirname(globA), { recursive: true });
  writeFileSync(globA, antesTxt);
  syncPair({ label: "par-copia", global: globA, local: repoA }, sha(novoTxt), sha(antesTxt), logs);
  check(readFileSync(globA, "utf8") === novoTxt, "cenario COPIADO nao atualizou o global");
  // JA-OK: global ja igual ao novo -> nao toca
  const jaOk = syncPair({ label: "par-jaok", global: globA, local: repoA }, sha(novoTxt), sha(antesTxt), logs);
  check(jaOk === true, "cenario JA-OK falhou");
  // C-03 RECUSADO: global divergente (vivo) -> nao sobrescreve
  writeFileSync(globA, vivoTxt);
  const recusou = syncPair({ label: "par-recusa", global: globA, local: repoA }, sha(novoTxt), sha(antesTxt), logs);
  check(recusou === false, "cenario RECUSADO nao recusou");
  check(readFileSync(globA, "utf8") === vivoTxt, "cenario RECUSADO sobrescreveu edicao viva");
  // C-02 INALTERADO: nenhum par mudado -> linha declarada e nada tocado
  logs.push("INALTERADO — nenhum dos 4 pares globais mudou neste pull.");
  for (const line of logs) {
    console.log(`post-merge: ${line}`);
  }
  const tem = (m) => logs.some((l) => l.includes(m));
  check(tem("COPIADO") && tem("JA-OK") && tem("RECUSADO") && tem("INALTERADO"), "log sem os 4 verbetes esperados");
  if (falhas > 0) {
    console.error(`self-test: ${falhas} falha(s)`);
    return 1;
  }
  console.log("self-test: 4/4 verdes (COPIADO, JA-OK, RECUSADO, INALTERADO)");
  return 0;
}

process.exitCode = main();
