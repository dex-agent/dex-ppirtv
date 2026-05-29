import path from "node:path";
import type { Flow, Meeting, MemoryCandidate } from "../domain.js";
import type { MemoryNugget } from "./memory-types.js";

export const SECRET_LIKE_PATTERN =
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}\b|\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/i;

const THEME_RULES: Array<{ theme: string; pattern: RegExp }> = [
  { theme: "pythia-deepseek", pattern: /pythia-deepseek/i },
  { theme: "delphi", pattern: /delphi|dunitx|pascal|firebird|acbr/i },
  { theme: "ppirtv", pattern: /ppirtv|goal|spt|trilho|ledger|flow/i },
  { theme: "mcp", pattern: /mcp/i },
  { theme: "deepseek", pattern: /deepseek/i },
  { theme: "codex", pattern: /codex|codewhale/i },
  { theme: "php", pattern: /php|laravel|composer/i }
];

const PARKING_ONLY_PATTERN = /avaliar|depois|futuro|talvez|pendente|backlog|proximo ciclo/i;
const DISCARD_PATTERN = /descartar|ruido|sem promocao/i;
const LEDGER_ONLY_PATTERN = /ledger[-_ ]only|somente ledger/i;
const GLOBAL_SCOPE_PATTERN = /global|cross-project|reutilizavel em qualquer projeto|qualquer repo/i;
const RECURRING_SIGNAL_PATTERN = /sempre|nunca|padrao|regra|recorrent|quando|contrato|gate|validar|verificar/i;
const FORGETTING_COST_PATTERN = /falh|bug|regress|bloque|quebra|falso|secret|token|evidencia|veredito/i;

export function resolveDexMemoriaHome(): string {
  return path.resolve(process.env.DEX_MEMORIA_HOME || path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".agents", "memories"));
}

export function collectMemoryNuggets(flow: Flow, meetings: Meeting[]): MemoryNugget[] {
  const nuggets: MemoryNugget[] = [];
  const add = (items: string[], source: "gold_mining" | "parking_lot") => {
    for (const item of items) {
      if (!item.trim() || /^evidence_required:/i.test(item.trim())) {
        continue;
      }
      nuggets.push({ item, source, evidenceScore: source === "gold_mining" ? 1 : 0 });
    }
  };
  add(flow.gold_mining, "gold_mining");
  add(flow.parking_lot, "parking_lot");
  for (const link of flow.goal_learning_links ?? []) {
    if (link.garimpo_vinculado.pepita) {
      add([link.garimpo_vinculado.pepita], "gold_mining");
    } else {
      add([link.parking_item], "parking_lot");
    }
  }
  for (const meeting of meetings) {
    add(meeting.gold_mining, "gold_mining");
    add(meeting.parking_lot, "parking_lot");
  }
  for (const evidence of flow.evidence) {
    add(evidence.gold_mining, "gold_mining");
    add(evidence.parking_lot, "parking_lot");
  }
  for (const verdict of flow.verdicts) {
    add(verdict.gold_mining, "gold_mining");
    add(verdict.parking_lot, "parking_lot");
  }
  const seen = new Set<string>();
  return nuggets.filter((nugget) => {
    const key = `${nugget.source}:${normalizeTextKey(nugget.item)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function classifyMemoryCandidate(input: {
  id: string;
  item: string;
  source: "gold_mining" | "parking_lot";
  evidenceScore: number;
  workspace: string;
  dexMemoriaHome: string;
}): MemoryCandidate {
  const secretLike = SECRET_LIKE_PATTERN.test(input.item);
  const theme = detectTheme(input.item);
  const scope = chooseMemoryScope(input.item, input.source, theme, input.evidenceScore);
  const title = secretLike ? "secret-like item redacted" : memoryTitle(input.item);
  const score = scoreMemoryCandidate(input.item, input.source, scope, input.evidenceScore);
  const layer: MemoryCandidate["layer"] = "L2";
  const targetFiles = memoryTargetFiles(scope, theme, input.workspace, input.dexMemoriaHome);
  const blockedReason = candidateBlockedReason({
    secretLike,
    scope,
    theme,
    targetFiles,
    workspace: input.workspace
  });
  const l1 = `[${memorySlug(title)}] ${title}.`;
  const l2 = [
    `## ${title}`,
    "",
    `Problema: ${secretLike ? "[redacted]" : input.item}`,
    "Mecanismo: aprendizado classificado automaticamente a partir do flow PPIRTV.",
    `Verificacao: origem=${input.source}; score=${score.total}.`,
    "Prevencao: manter L1 antes da memoria detalhada e revisar destino antes do veredito."
  ].join("\n");
  return {
    id: input.id,
    title,
    source: input.source,
    scope,
    theme,
    layer,
    has_l1: !blockedReason,
    score,
    confidence: score.total >= 7 ? "alta" : score.total >= 6 ? "media" : "baixa",
    l1_gatilho: l1,
    l2_bloco: l2,
    target_files: targetFiles,
    blocked: Boolean(blockedReason),
    blocked_reason: blockedReason
  };
}

export function isWritableCandidate(candidate: MemoryCandidate): boolean {
  return !candidate.blocked && candidate.score.evidencia >= 1 && candidate.score.total >= 6 && ["global", "tema", "projeto"].includes(candidate.scope);
}

export function memoryCandidateLedgerData(candidate: MemoryCandidate): Record<string, unknown> {
  return {
    id: candidate.id,
    title: candidate.title,
    source: candidate.source,
    scope: candidate.scope,
    theme: candidate.theme,
    layer: candidate.layer,
    score: candidate.score,
    confidence: candidate.confidence,
    target_files: candidate.target_files,
    blocked: candidate.blocked,
    blocked_reason: candidate.blocked_reason
  };
}

export function assertNoSecretLikeText(value: string | undefined, field: string): void {
  if (!value) {
    return;
  }
  if (SECRET_LIKE_PATTERN.test(value)) {
    throw new Error(`${field} appears to contain a secret-like value and cannot be recorded`);
  }
}

export function redactSecretLikeText(value: string): string {
  return SECRET_LIKE_PATTERN.test(value) ? "[redacted]" : value;
}

export function normalizeTextKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function detectTheme(item: string): string | undefined {
  return THEME_RULES.find((rule) => rule.pattern.test(item))?.theme;
}

function chooseMemoryScope(item: string, source: "gold_mining" | "parking_lot", theme: string | undefined, evidenceScore: number): MemoryCandidate["scope"] {
  if (source === "parking_lot" && PARKING_ONLY_PATTERN.test(item)) {
    return "estacionamento";
  }
  if (DISCARD_PATTERN.test(item)) {
    return "descartar";
  }
  if (LEDGER_ONLY_PATTERN.test(item) || (source === "parking_lot" && evidenceScore < 1)) {
    return "ledger_only";
  }
  if (theme) {
    return "tema";
  }
  if (GLOBAL_SCOPE_PATTERN.test(item)) {
    return "global";
  }
  return source === "gold_mining" ? "projeto" : "ledger_only";
}

function scoreMemoryCandidate(item: string, source: "gold_mining" | "parking_lot", scope: MemoryCandidate["scope"], evidenceScore: number): MemoryCandidate["score"] {
  const recurring = RECURRING_SIGNAL_PATTERN.test(item);
  const reaproveitamento = scope === "global" || scope === "tema" ? 2 : recurring ? 1 : 0;
  const evidencia = source === "gold_mining" ? Math.max(1, evidenceScore) : evidenceScore;
  const custo_esquecimento = FORGETTING_COST_PATTERN.test(item) ? 2 : 1;
  const transferibilidade = recurring || scope === "tema" || scope === "global" ? 2 : 1;
  return {
    reaproveitamento,
    evidencia,
    custo_esquecimento,
    transferibilidade,
    total: reaproveitamento + evidencia + custo_esquecimento + transferibilidade
  };
}

function memoryTargetFiles(scope: MemoryCandidate["scope"], theme: string | undefined, workspace: string, dexMemoriaHome: string): string[] {
  if (scope === "global") {
    return [path.join(dexMemoriaHome, "global", "LEMBRANCA.md"), path.join(dexMemoriaHome, "global", "MEMORIA.md")];
  }
  if (scope === "tema" && theme) {
    return [path.join(dexMemoriaHome, "temas", theme, "LEMBRANCA.md"), path.join(dexMemoriaHome, "temas", theme, "MEMORIA.md")];
  }
  if (scope === "projeto") {
    return [path.join(workspace, ".agents", "LEMBRANCA.md"), path.join(workspace, ".agents", "MEMORIA.md")];
  }
  return [];
}

function candidateBlockedReason(input: {
  secretLike: boolean;
  scope: MemoryCandidate["scope"];
  theme: string | undefined;
  targetFiles: string[];
  workspace: string;
}): string | null {
  if (input.secretLike) {
    return "secret_like_value_detected";
  }
  if (input.theme && /-/.test(input.theme)) {
    return `theme_looks_like_project: use ${input.theme.split("-").at(-1)}`;
  }
  if ((input.scope === "global" || input.scope === "tema") && input.targetFiles.some((file) => isInsideOrEqual(input.workspace, file))) {
    return "global_or_theme_memory_target_inside_workspace";
  }
  return null;
}

function memoryTitle(item: string): string {
  return item
    .replace(/^(Dica de ouro observada|Ponto cego observado|Armadilha observada|Heuristica pratica):\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

function memorySlug(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()
    .slice(0, 32);
  return slug || "MEMORY-CANDIDATE";
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
