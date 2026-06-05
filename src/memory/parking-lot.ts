import type { Flow, GoalLearningLink } from "../domain.js";
import { normalizeTextKey } from "./mining-policy.js";

const GARIMPO_RULES: Array<{
  classification: GoalLearningLink["garimpo_vinculado"]["classificacao"];
  symbol: GoalLearningLink["garimpo_vinculado"]["simbolo"];
  pattern: RegExp;
  promote: boolean;
  prefix: string;
}> = [
  { classification: "armadilha", symbol: "⚠️", pattern: /token|api[_-]?key|authorization|password|secret|senha|\.env/i, promote: false, prefix: "" },
  { classification: "armadilha", symbol: "⚠️", pattern: /risco|quebra|regress|falh|bug|bloque|falso|invisivel|duplic/i, promote: true, prefix: "Armadilha observada" },
  { classification: "ponto_cego", symbol: "🕳️", pattern: /ponto cego|ocult|ambig|incert|premissa|desacopl|depend/i, promote: true, prefix: "Ponto cego observado" },
  { classification: "dica_de_ouro", symbol: "💎", pattern: /dica de ouro|pepita|aprendizado reutiliz[aá]vel|reaproveit|reutiliz|boa decis[aã]o|alto valor|vale lembrar|economiza retrabalho|evita retrabalho|melhor pr[aá]tica/i, promote: true, prefix: "Dica de ouro observada" },
  { classification: "heuristica", symbol: "🔧", pattern: /heuristic|padrao|regra|sempre|nunca|prefer|quando|contrato|validar|verificar/i, promote: true, prefix: "Heuristica pratica" },
  { classification: "nao_promover", symbol: "·", pattern: /avaliar|depois|futuro|talvez|pendente|backlog|proximo ciclo/i, promote: false, prefix: "" }
];

export function linkParkingToGold(
  flow: Flow,
  parkingItems: string[],
  source: GoalLearningLink["source"],
  sourceId: string,
  createdAt: string
): string[] {
  if (!flow.goal_binding || parkingItems.length === 0) {
    return [];
  }
  flow.goal_learning_links ??= [];
  const promoted: string[] = [];
  for (const item of unique(parkingItems)) {
    const normalizedItem = normalizeTextKey(item);
    const existing = flow.goal_learning_links.find((link) => normalizeTextKey(link.parking_item) === normalizedItem);
    if (existing) {
      if (existing.garimpo_vinculado.promovido_para_gold_mining && existing.garimpo_vinculado.pepita) {
        promoted.push(existing.garimpo_vinculado.pepita);
      }
      continue;
    }

    const garimpo = garimparParkingItem(item);
    const goldId = garimpo.promovido_para_gold_mining ? `gm_${flow.gold_mining.length + promoted.length + 1}` : undefined;
    flow.goal_learning_links.push({
      id: `gl_${flow.goal_learning_links.length + 1}`,
      source,
      source_id: sourceId,
      parking_item: item,
      garimpo_vinculado: {
        ...garimpo,
        gold_id: goldId
      },
      created_at: createdAt
    });
    if (garimpo.promovido_para_gold_mining && garimpo.pepita) {
      promoted.push(garimpo.pepita);
    }
  }
  return unique(promoted);
}

function garimparParkingItem(item: string): GoalLearningLink["garimpo_vinculado"] {
  for (const rule of GARIMPO_RULES) {
    if (rule.pattern.test(item)) {
      return {
        classificacao: rule.classification,
        simbolo: rule.symbol,
        pepita: rule.promote ? `${rule.prefix}: ${item}` : null,
        promovido_para_gold_mining: rule.promote
      };
    }
  }
  return {
    classificacao: "nao_promover",
    simbolo: "·",
    pepita: null,
    promovido_para_gold_mining: false
  };
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
