// TRIADE-DOC-261119 (--help/schema/usage; casa GATE-DOC-ADMISSAO-HELP-SCHEMA-USAGE,
// cobranca do toolsbook --check registry 3.531.0) — intercept de documentacao
// ANTES da logica util (flag sem valor; com valor segue o fluxo normal).
// Frente G (GitHub #37): guard de entrypoint — este módulo é IMPORTADO pelo
// audit-canonical-sync e pelo post-merge; o doc abaixo só responde quando
// ESTE arquivo é o entrypoint (cada consumidor emite o próprio contrato).
{
  const _av = process.argv.slice(2);
  const _docFlag = (f) => _av.includes(f) && (_av.indexOf(f) === _av.length - 1 || String(_av[_av.indexOf(f) + 1]).startsWith("--"));
  if ((_docFlag("--help") || _docFlag("--schema") || _docFlag("--usage")) && isEntrypoint()) {
    const _doc = {"tool": "canonical-pairs", "purpose": "pareamento contrato canonico global x copia local versionada", "contract": "dex.triade.v1", "inputs": ["(sem args) lista pares"], "outputs": ["stdout pares + status"]};
    if (_docFlag("--schema")) console.log(JSON.stringify(_doc, null, 2));
    else console.log('usage: node scripts/canonical-pairs.mjs — lista/parea os contratos canonicos globais x copias locais do repo.');
    process.exit(0);
  }
}
// Reuso: nenhum externo (módulo de dados dos 4 pares canônicos)
// Perigo: read-only (fonte única consumida pelo audit/post-merge)

// Os 4 pares globais do repo (fonte unica; consumido pelo audit-canonical-sync
// e pelo hook tools/playbook/hooks/post-merge). Bump aqui quando um par nascer.
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    // Node resolves directory aliases when loading ESM, but argv keeps the alias.
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export function canonicalPairs(repoRoot, userProfile) {
  return [
    {
      label: "GOAL/SPT canonical contract",
      global: path.join(userProfile, ".agents", "contracts", "GOAL_SPT_CANONICAL_CONTRACT.md"),
      local: path.join(repoRoot, "docs", "contracts", "GOAL_SPT_CANONICAL_CONTRACT.md")
    },
    {
      label: "GOAL execution bridge",
      global: path.join(userProfile, ".agents", "contracts", "GOAL_EXECUTION_BRIDGE.md"),
      local: path.join(repoRoot, "docs", "contracts", "GOAL_EXECUTION_BRIDGE.md")
    },
    {
      label: "PRINCIPLES.md",
      global: path.join(userProfile, ".agents", "memories", "principles", "PRINCIPLES.md"),
      local: path.join(repoRoot, "principles", "PRINCIPLES.md")
    },
    {
      label: "operational-contract.json",
      global: path.join(userProfile, ".agents", "memories", "principles", "operational-contract.json"),
      local: path.join(repoRoot, "principles", "operational-contract.json"),
      json: true
    }
  ];
}
