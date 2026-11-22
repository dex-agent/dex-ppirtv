#!/usr/bin/env node
// TRIADE-DOC-261119 (--help/schema/usage; casa GATE-DOC-ADMISSAO-HELP-SCHEMA-USAGE,
// cobranca do toolsbook --check registry 3.531.0) — intercept de documentacao
// ANTES da logica util (flag sem valor; com valor segue o fluxo normal).
{
  const _av = process.argv.slice(2);
  const _docFlag = (f) => _av.includes(f) && (_av.indexOf(f) === _av.length - 1 || String(_av[_av.indexOf(f) + 1]).startsWith("--"));
  if (_docFlag("--help") || _docFlag("--schema") || _docFlag("--usage")) {
    const _doc = {"tool": "audit-canonical-sync", "purpose": "auditoria de sincronia dos contratos canonicos (npm run audit:canonical)", "contract": "dex.triade.v1", "inputs": ["(sem args) audita todos os pares"], "outputs": ["stdout relatorio; exit 1 em drift"]};
    if (_docFlag("--schema")) console.log(JSON.stringify(_doc, null, 2));
    else console.log('usage: node scripts/audit-canonical-sync.mjs — audita sincronia global x local dos contratos canonicos (exit != 0 em drift).');
    process.exit(0);
  }
}
// Reuso: canonical-pairs.mjs (os 4 pares global<->local)
// Perigo: read-only (audita por hash; canonicaliza CRLF antes do SHA)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { canonicalPairs } from "./canonical-pairs.mjs";

const repoRoot = process.cwd();
const userProfile = process.env.USERPROFILE ?? process.env.HOME;

const failures = [];

function main() {
  // Janela de fechamento #21 (CI lapidado): --local-only valida a ESTRUTURA
  // local (pares declarados, copias existentes e nao-vazias) sem depender das
  // fontes globais — o runner do CI nao tem ~/.agents. Sincronia plena
  // global x local continua no npm run audit:canonical da frota.
  const localOnly = process.argv.includes("--local-only");

  if (!userProfile && !localOnly) {
    fail("USERPROFILE/HOME ausente; nao foi possivel localizar fontes globais.");
    finish();
    return;
  }

  if (process.argv.includes("--self-test-negative")) {
    runNegativeSelfTest();
    finish();
    return;
  }

  if (localOnly) {
    assertLocalCopiesPresent(canonicalPairs(repoRoot, userProfile ?? ""));
    assertLocalAuthorityPointers();
    assertNoLocalContractCopyClaimedAsCanonical();
    finish();
    return;
  }

  assertFilePairsInSync(canonicalPairs(repoRoot, userProfile));

  assertLocalAuthorityPointers();
  assertNoLocalContractCopyClaimedAsCanonical();
  finish();
}

function assertLocalCopiesPresent(pairs) {
  for (const pair of pairs) {
    assertFileExists(pair.local, `${pair.label} local (--local-only)`);
    if (!existsSync(pair.local)) continue;
    const size = readFileSync(pair.local, "utf8").trim().length;
    if (size === 0) fail(`${pair.label} local vazio: ${pair.local}`);
    // Frente G (GitHub #36): o passo local não pode aprovar contrato JSON
    // ilegível — mesmo crivo do caminho completo (nomeia o arquivo no fail).
    if (pair.json) assertJsonParses(pair.local, `${pair.label} local (--local-only)`);
  }
}

function assertFilePairsInSync(pairs) {
  for (const pair of pairs) {
    assertFileExists(pair.global, `${pair.label} global`);
    assertFileExists(pair.local, `${pair.label} local`);
    if (!existsSync(pair.global) || !existsSync(pair.local)) {
      continue;
    }

    const globalHash = sha256(canonicalText(pair.global));
    const localHash = sha256(canonicalText(pair.local));
    if (globalHash !== localHash) {
      fail(`${pair.label} divergiu: global=${pair.global} local=${pair.local}`);
    }

    if (pair.json) {
      assertJsonParses(pair.global, `${pair.label} global`);
      assertJsonParses(pair.local, `${pair.label} local`);
    }
  }
}

function assertLocalAuthorityPointers() {
  const agentsPath = path.join(repoRoot, "AGENTS.md");
  const napkinPath = path.join(repoRoot, ".codex", "napkin.md");
  const bridgePath = path.join(repoRoot, "docs", "contracts", "GOAL_EXECUTION_BRIDGE.md");

  if (existsSync(agentsPath)) {
    const agentsText = readUtf8(agentsPath);
    assertIncludes(agentsText, "$env:USERPROFILE\\.agents\\contracts\\...", "AGENTS.md deve apontar autoridade global de contratos");
    assertIncludes(agentsText, "npm run audit:canonical", "AGENTS.md deve exigir audit canonico");
  }

  if (existsSync(napkinPath)) {
    const napkinText = readUtf8(napkinPath);
    assertIncludes(napkinText, "npm run audit:canonical", "napkin deve conter gotcha acionavel do audit canonico");
    assertIncludes(napkinText, "docs/contracts/...", "napkin deve alertar contra editar copia local como canonica");
  }

  if (existsSync(bridgePath)) {
    const bridgeText = readUtf8(bridgePath);
    assertIncludes(bridgeText, "$env:USERPROFILE\\.agents\\contracts\\GOAL_SPT_CANONICAL_CONTRACT.md", "bridge deve apontar contrato global");
    assertIncludes(bridgeText, "copia local versionada", "bridge deve rotular docs/contracts como copia local");
  }
}

function assertNoLocalContractCopyClaimedAsCanonical() {
  const files = [
    path.join(repoRoot, "AGENTS.md"),
    path.join(repoRoot, "README.md"),
    path.join(repoRoot, "INDEX.md"),
    path.join(repoRoot, ".codex", "napkin.md"),
    ...listMarkdownFiles(path.join(repoRoot, "docs"))
  ].filter((filePath) => existsSync(filePath));

  for (const filePath of files) {
    const relativePath = path.relative(repoRoot, filePath);
    const lines = readUtf8(filePath).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isBadLocalCanonicalPointerLine(line)) {
        fail(`${relativePath}:${index + 1} chama copia local docs/contracts como canonica sem rotulo de copia.`);
      }
    });
  }
}

function isBadLocalCanonicalPointerLine(line) {
  const normalized = line.replace(/\\/g, "/");
  if (!/docs\/contracts\/GOAL_SPT_CANONICAL_CONTRACT\.md/i.test(normalized)) {
    return false;
  }
  const claimsAuthority = /(fonte\s+canonica|fonte\s+can[oô]nica|contrato\s+canonico|contrato\s+can[oô]nico|canonical\s+(source|contract)|source\s+of\s+truth)/i.test(line);
  const marksCopy = /(c[oó]pia|copy|versionad[ao]|repo|local)/i.test(line);
  return claimsAuthority && !marksCopy;
}

function runNegativeSelfTest() {
  const badLine = "Para criar GOAL, use o contrato canonico em docs/contracts/GOAL_SPT_CANONICAL_CONTRACT.md.";
  const goodLine = "A copia local versionada fica em docs/contracts/GOAL_SPT_CANONICAL_CONTRACT.md.";
  if (!isBadLocalCanonicalPointerLine(badLine)) {
    fail("self-test negativo nao detectou ponteiro local canonico ruim.");
  }
  if (isBadLocalCanonicalPointerLine(goodLine)) {
    fail("self-test negativo marcou copia local versionada como erro.");
  }
}

function listMarkdownFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
    } else if (entry.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function assertFileExists(filePath, label) {
  if (!existsSync(filePath)) {
    fail(`${label} nao encontrado: ${filePath}`);
  }
}

function assertJsonParses(filePath, label) {
  try {
    JSON.parse(readUtf8(filePath));
  } catch (error) {
    fail(`${label} nao parseia como JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertIncludes(text, expected, message) {
  if (!text.includes(expected)) {
    fail(`${message}; esperado trecho: ${expected}`);
  }
}

function readUtf8(filePath) {
  return readFileSync(filePath, "utf8");
}

function canonicalText(filePath) {
  return readUtf8(filePath).replace(/\r\n/g, "\n");
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function fail(message) {
  failures.push(message);
}

function finish() {
  if (failures.length > 0) {
    console.error("Canonical sync audit failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log("Canonical sync audit passed.");
}

main();
