// Trilho 2026-11-05-verdict-learning-filtro-findings (SHRINK do camping
// flow-engine): a seleção de aprendizado do veredito saiu da fachada como
// módulo coeso e puro. issue #5.2 — a promoção de review_findings era cega
// (2 candidatos de confiança baixa gerados ao vivo pelo flow 2950); agora os
// findings seguem a MESMA regra do rationale: só texto forte vira candidato
// de mineração; finding fraco fica evidência do verdict (review_findings
// persistido) e a porta explícita do operador continua verdict_gold_mining.
import type { Evidence } from "./domain.js";
import type { FiscalVerdictInput } from "./memory/mining-policy.js";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isStrongLearningText(value: string | undefined): boolean {
  return Boolean(value && /(falso verde|contrato|princip|harness|canonical|case|CPU|RTX|CUDA|Graphify|MCP|PPIRTV|loop|bloque|regress|falh)/i.test(value));
}

export function deriveVerdictLearning(
  input: FiscalVerdictInput,
  evidences: Evidence[]
): { gold_mining: string[]; parking_lot: string[]; review_findings: string[] } {
  const reviewFindings = input.review_findings ?? [];
  const explicitGold = input.verdict_gold_mining ?? [];
  const explicitParking = input.verdict_parking_lot ?? [];
  const gold = [
    ...explicitGold,
    ...reviewFindings.filter(isStrongLearningText).map((finding) => `Achado de review: ${finding}`),
    ...(isStrongLearningText(input.rationale) ? [`Achado garimpado do veredito: ${input.rationale}`] : [])
  ];
  const parking = [
    ...explicitParking,
    ...(input.residual_risks ?? []).map((risk) => `Risco residual estacionado: ${risk}`),
    ...(input.review_artifact_path ? [`Artefato de review para consulta: ${input.review_artifact_path}`] : []),
    ...evidences.map((evidence) => `Evidencia usada no veredito: ${evidence.title}${evidence.uri ? ` -> ${evidence.uri}` : ""}`)
  ];
  return {
    gold_mining: unique(gold),
    parking_lot: unique(parking),
    review_findings: unique(reviewFindings)
  };
}
