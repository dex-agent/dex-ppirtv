import path from "node:path";
import { resolveDexMemoriaHome as resolveConfiguredDexMemoriaHome } from "../config.js";
import type { Flow, Meeting, MemoryCandidate } from "../domain.js";
import type { MemoryNugget } from "./memory-types.js";

// #5 (security SSOT): reexportar SECRET_LIKE_PATTERN do modulo centralizado
// em vez de manter regex local. Consumidores existentes continuam funcionando.
export { SECRET_LIKE_PATTERN } from "../security/secret-redaction.js";
import { SECRET_LIKE_PATTERN } from "../security/secret-redaction.js";

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
export const AUTO_WRITE_REVIEW_MARKER = "PPIRTV-MM-AUTO-WRITE-REVIEW";
export const AUTO_WRITE_REVIEW_TAGS = ["#ppirtv/mm-auto-write", "#ppirtv/consciencia-memorias", "#ppirtv/revisar-memoria"] as const;

export function resolveDexMemoriaHome(): string {
  return path.resolve(resolveConfiguredDexMemoriaHome());
}

export function collectMemoryNuggets(flow: Flow, meetings: Meeting[]): MemoryNugget[] {
  const nuggets: MemoryNugget[] = [];
  const add = (items: string[], source: "gold_mining" | "parking_lot", evidenceScore?: number) => {
    for (const item of items) {
      if (!item.trim() || /^evidence_required:/i.test(item.trim())) {
        continue;
      }
      nuggets.push({ item, source, evidenceScore: evidenceScore ?? (source === "gold_mining" ? 1 : 0) });
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
    add(meeting.decisions.map((item) => `Decisao de reuniao: ${item}`), "parking_lot", 1);
    add(meeting.findings.map((item) => `Achado de reuniao: ${item}`), "parking_lot", 1);
    add(
      meeting.turns
        .flatMap((turn) => [turn.finding, turn.note])
        .filter((item): item is string => Boolean(item?.trim()))
        .map((item) => `Turno de reuniao: ${item}`),
      "parking_lot",
      1
    );
  }
  for (const evidence of flow.evidence) {
    add(evidence.gold_mining, "gold_mining");
    add(evidence.parking_lot, "parking_lot");
  }
  for (const verdict of flow.verdicts) {
    add(verdict.gold_mining, "gold_mining");
    add(verdict.parking_lot, "parking_lot");
    add((verdict.review_findings ?? []).map((item) => `Achado de review: ${item}`), "gold_mining", 2);
    add(verdict.rationale ? [`Racional de veredito: ${verdict.rationale}`] : [], "parking_lot", 1);
    add(verdict.residual_risks.map((item) => `Risco residual: ${item}`), "parking_lot", 1);
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
  const slug = memorySlug(title);
  const anchor = memoryAnchor(title);
  const l1 = `[${slug}] ${title}.`;
  const l2 = [
    `## ${title}`,
    "",
    `Problema: ${secretLike ? "[redacted]" : input.item}`,
    "Mecanismo: aprendizado classificado automaticamente a partir do flow PPIRTV.",
    `Verificacao: origem=${input.source}; score=${score.total}.`,
    "Prevencao: manter L1 antes da memoria detalhada e revisar destino antes do veredito."
  ].join("\n");
  // R5: se o candidato nasceu com scope writavel (global/tema/projeto) mas nao
  // e' writable (reaproveitamento=0 ou total<6), rebaixar para ledger_only
  // em vez de deixar sem destino. Isso fecha a lacuna onde auto_write
  // rejeitava o candidato pelo gate mas ele nao aparecia em ledger_only nem
  // estacionamento, gerando falso silencio.
  const effectiveScope: MemoryCandidate["scope"] = !blockedReason
    && ["global", "tema", "projeto"].includes(scope)
    && !(score.evidencia >= 1 && score.reaproveitamento >= 1 && score.total >= 6)
    ? "ledger_only"
    : scope;
  return {
    id: input.id,
    title,
    source: input.source,
    scope: effectiveScope,
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

export function governAutoWriteCandidate(candidate: MemoryCandidate, flowId: string): MemoryCandidate {
  if (candidate.target_files.length < 2) {
    return candidate;
  }
  const [l1Path, l2Path] = candidate.target_files;
  const anchor = memoryAnchor(candidate.title);
  const localizador = memorySlug(candidate.title);
  const l1Base = path.basename(l1Path ?? "LEMBRANCA.md", ".md");
  const l2Base = path.basename(l2Path ?? "MEMORIA.md");
  const l2Note = path.basename(l2Base, ".md");
  const l3FileName = `${anchor}.md`;
  const l3Note = path.basename(l3FileName, ".md");
  const l3Dir = path.join(path.dirname(l2Path ?? l1Path ?? "."), "conhecimento");
  const l3IndexPath = path.join(l3Dir, "INDEX.md");
  const l3Path = path.join(l3Dir, l3FileName);
  const tags = AUTO_WRITE_REVIEW_TAGS.join(" ");
  const l1 = [
    `- [${localizador}] ${candidate.title}. ${tags} -> revisar com consciencia-memorias (${AUTO_WRITE_REVIEW_MARKER}) -> [memoria](${l2Base}#${anchor}) / [[${l2Note}#^${anchor}|memoria]] ^${anchor}`
  ].join("\n");
  const l2 = [
    `## ${candidate.title} {#${anchor}}`,
    `^${anchor}`,
    `Localizador: \`${localizador}\``,
    `Tags: ${tags}`,
    `Aliases: ${candidate.title}, ${AUTO_WRITE_REVIEW_MARKER}, mm_memory_mining auto_write`,
    `Obsidian: L1 [[${l1Base}#^${anchor}|${localizador}]]`,
    `L3 relacionada: [conhecimento/${l3FileName}](conhecimento/${l3FileName})`,
    `Obsidian: L3 [[${l3Note}#^${anchor}|conhecimento]]`,
    "",
    `OrigemAuto: mm_memory_mining`,
    `Flow: \`${flowId}\``,
    `Candidate: \`${candidate.id}\``,
    `ReviewStatus: pending_consciencia_memorias`,
    `ReviewMarker: \`${AUTO_WRITE_REVIEW_MARKER}\``,
    "",
    `Problema: ${candidate.l2_bloco.match(/Problema: (.+)/)?.[1] ?? candidate.title}`,
    "Mecanismo: aprendizado classificado automaticamente a partir do flow PPIRTV e escrito em formato governado; a validacao estrutural pos-write fica registrada no flow, enquanto revisao e consolidacao posteriores pertencem a consciencia-memorias.",
    `Verificacao: origem=${candidate.source}; score=${candidate.score.total}; post_write=validate-memory-tags + validate-memory-links -RequireObsidian + Finder/rg.`,
    "Prevencao: nao tratar written_count > 0 como memoria consolidada; captura estrutural valida permanece pending_consciencia_memorias ate aprovacao posterior do owner.",
    "",
    "Ligacoes:",
    `- L1: [[${l1Base}#^${anchor}|${localizador}]]`,
    `- L3: [conhecimento/${l3FileName}](conhecimento/${l3FileName}) / [[${l3Note}#^${anchor}|conhecimento]]`,
    `- Revisao futura: \`${AUTO_WRITE_REVIEW_MARKER}\``
  ].join("\n");
  const l3 = [
    `# ${candidate.title}`,
    `^${anchor}`,
    "",
    `Localizador: \`${localizador}\``,
    `Tags: ${tags}`,
    `L2 relacionada: ../${l2Base}#${anchor}`,
    `Obsidian: L2 [[${l2Note}#^${anchor}|${candidate.title}]]`,
    "",
    `OrigemAuto: mm_memory_mining`,
    `Flow: \`${flowId}\``,
    `Candidate: \`${candidate.id}\``,
    `ReviewStatus: pending_consciencia_memorias`,
    `ReviewMarker: \`${AUTO_WRITE_REVIEW_MARKER}\``,
    "",
    "Nota: L3 minimo criado para manter cadeia L1<->L2<->L3 validavel; aprofundar manualmente somente se houver material reutilizavel suficiente."
  ].join("\n");
  const l3IndexEntry = `- [${candidate.title}](${l3FileName}) / [[${l3Note}#^${anchor}|${candidate.title}]]`;
  return {
    ...candidate,
    l1_gatilho: l1,
    l2_bloco: l2,
    l3_bloco: l3,
    l3_index_entry: l3IndexEntry,
    target_files: uniqueStrings([...candidate.target_files, l3IndexPath, l3Path])
  };
}

export function isWritableCandidate(candidate: MemoryCandidate): boolean {
  return !candidate.blocked && candidate.score.evidencia >= 1 && candidate.score.reaproveitamento >= 1 && candidate.score.total >= 6 && ["global", "tema", "projeto"].includes(candidate.scope);
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

export function memoryAnchor(title: string): string {
  const anchor = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 64);
  return anchor || "memory-candidate";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
