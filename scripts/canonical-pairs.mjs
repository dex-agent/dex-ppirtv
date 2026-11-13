// Reuso: nenhum externo (módulo de dados dos 4 pares canônicos)
// Perigo: read-only (fonte única consumida pelo audit/post-merge)

// Os 4 pares globais do repo (fonte unica; consumido pelo audit-canonical-sync
// e pelo hook tools/playbook/hooks/post-merge). Bump aqui quando um par nascer.
import path from "node:path";

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
