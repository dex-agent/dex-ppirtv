// TRIADE-DOC-261119 (--help/schema/usage; casa GATE-DOC-ADMISSAO-HELP-SCHEMA-USAGE,
// cobranca do toolsbook --check registry 3.531.0) — intercept de documentacao
// ANTES da logica util (flag sem valor; com valor segue o fluxo normal).
// Frente G (GitHub #37): guard de entrypoint — este módulo é IMPORTADO pelo
// audit-canonical-sync e pelo post-merge; o doc abaixo só responde quando
// ESTE arquivo é o entrypoint (cada consumidor emite o próprio contrato).
{
  const _isEntry = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
  const _av = process.argv.slice(2);
  const _docFlag = (f) => _av.includes(f) && (_av.indexOf(f) === _av.length - 1 || String(_av[_av.indexOf(f) + 1]).startsWith("--"));
  if (_isEntry && (_docFlag("--help") || _docFlag("--schema") || _docFlag("--usage"))) {
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
import { pathToFileURL } from "node:url";

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
