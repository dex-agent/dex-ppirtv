import path from "node:path";
import { resolveDexMemoriaHome as resolveConfiguredDexMemoriaHome } from "../config.js";
import type { Flow, Meeting, MemoryCandidate, MemoryMiningSummary, MemoryPostWriteValidation, VerdictStatus } from "../domain.js";
import type { DexMemoriaV2Destination, DexMemoriaV2MiningClassification, DexMemoriaV2MiningClassifierInput } from "./dex-memoria-v2-adapter.js";
import type { MemoryNugget } from "./memory-types.js";

// #5 (security SSOT): reexportar SECRET_LIKE_PATTERN do modulo centralizado
// em vez de manter regex local. Consumidores existentes continuam funcionando.
export { SECRET_LIKE_PATTERN } from "../security/secret-redaction.js";
import { SECRET_LIKE_PATTERN } from "../security/secret-redaction.js";
import { assertGovernedTag } from "./governed-tag.js";

const THEME_RULES: Array<{ theme: string; pattern: RegExp }> = [
  { theme: "pythia-deepseek", pattern: /pythia-deepseek/i },
  { theme: "delphi", pattern: /delphi|dcc32|dpr|dproj|dunitx|pascal|firebird|acbr/i },
  { theme: "ppirtv", pattern: /ppirtv|goal|spt|trilho|ledger|flow/i },
  { theme: "mcp", pattern: /mcp/i },
  { theme: "deepseek", pattern: /deepseek/i },
  { theme: "codex", pattern: /codex|codewhale/i },
  { theme: "php", pattern: /php|laravel|composer/i }
];

const PARKING_ONLY_PATTERN = /avaliar|depois|futuro|talvez|pendente|backlog|proximo ciclo/i;
const DISCARD_PATTERN = /descartar|ruido|sem promocao/i;
const LEDGER_ONLY_PATTERN = /ledger[-_ ]only|somente ledger/i;

// Bookkeeping do proprio flow NUNCA vira candidato de memoria: sao registros
// operacionais (rationale do veredito, risco residual, linha de evidencia e o
// proprio achado derivado do veredito), nao aprendizado reutilizavel.
// Origem: ACH-01/P1 do flow_20260914103135338_2081_0063 (15 unidades-boilerplate
// gravadas em um unico dia, somadas a 37 antigas).
const BOOKKEEPING_NUGGET_PREFIXES: readonly string[] = [
  "racional de veredito:",
  "risco residual:",
  "risco residual estacionado:",
  "evidencia usada no veredito:",
  "achado garimpado do veredito:"
];
// "Achado de review:" NAO entra nesta lista de proposito: por contrato de
// produto (tests/engine.test.ts T33) achados de review continuam elegiveis a
// candidato editavel. Filtrar review aqui trocaria um defeito por uma regressao.

// O deposito de parking-lot promove itens para gold_mining embrulhando-os com
// um prefixo de observacao (ver src/memory/parking-lot.ts), e flow-engine.ts
// promove o parking ANTES de collectMemoryNuggets. Filtrar por prefixo exige,
// portanto, olhar a forma FINAL do item: estes wrappers sao removidos antes do
// teste de bookkeeping. RED de origem: evd_20260914114519433_2448_0038.
const PROMOTION_WRAPPER_PREFIXES: readonly string[] = [
  "armadilha observada:",
  "ponto cego observado:",
  "dica de ouro observada:",
  "heuristica pratica:"
];
const MAX_PROMOTION_UNWRAP_DEPTH = 4;
// Por que 4: a promocao real produz UM nivel de embrulho
// (parking-lot.ts:67 -> `${prefix}: ${item}`); 4 da folga para o embrulho duplo
// observado em producao e o limite tem teste proprio (P-KIMI-02), em vez de ser
// numero magico sem ancora.

function unwrapPromotionPrefixes(value: string): string {
  let current = value;
  for (let depth = 0; depth < MAX_PROMOTION_UNWRAP_DEPTH; depth += 1) {
    const wrapper = PROMOTION_WRAPPER_PREFIXES.find((prefix) => current.startsWith(prefix));
    if (!wrapper) break;
    current = current.slice(wrapper.length).trimStart();
  }
  return current;
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function isBookkeepingNugget(item: string): boolean {
  const normalized = stripDiacritics(item.trim().toLowerCase());
  if (!normalized) return false;
  const finalForm = unwrapPromotionPrefixes(normalized);
  if (!finalForm) return false;
  return BOOKKEEPING_NUGGET_PREFIXES.some((prefix) => finalForm.startsWith(stripDiacritics(prefix)));
}
const GLOBAL_SCOPE_PATTERN = /global|cross-project|reutilizavel em qualquer projeto|qualquer repo/i;
const V2_GLOBAL_SCOPE_INTENT_PATTERN = /\bmem[oó]ria\s+global\b|\bescopo\s+global\b|cross-project|reutilizavel em qualquer projeto|qualquer repo/i;
const V2_PROJECT_SCOPE_INTENT_PATTERN = /\bmem[oó]ria\s+local\b|\baprendizado\s+local\b|\blocal\s+(?:deste|desse|neste|nesse|do)\s+(?:projeto|repositorio|repositório|repo)\b|\b(?:deste|desse|neste|nesse)\s+(?:projeto|repositorio|repositório|repo)\b|\b(?:projeto|repositorio|repositório|repo)\s+atual\b/i;
const RECURRING_SIGNAL_PATTERN = /sempre|nunca|padrao|regra|recorrent|quando|contrato|gate|validar|verificar/i;
const FORGETTING_COST_PATTERN = /falh|bug|regress|bloque|quebra|falso|secret|token|evidencia|veredito/i;
export const AUTO_WRITE_REVIEW_MARKER = "PPIRTV-MM-AUTO-WRITE-REVIEW";
export const AUTO_WRITE_REVIEW_TAGS = ["#ppirtv/mm-auto-write", "#ppirtv/consciencia-memorias", "#ppirtv/revisar-memoria"] as const;

export function resolveDexMemoriaHome(): string {
  return path.resolve(resolveConfiguredDexMemoriaHome());
}

// SPT 2026-10-27-mining-deposit-visibility (F1): a boca do funil precisa ser
// GRITANTE quando vazia — "0 candidatos" sozinho anestesia o garimpo da sessão
// (episódio master_maximus: ouro real existia e nada ensinava a depositá-lo).
// Texto de egress puro consumido pelos DOIS caminhos de writer (legacy e v2)
// quando nenhum nugget sobreviveu à coleta: nada depositado OU tudo filtrado
// como bookkeeping.
export const EMPTY_MINING_DEPOSIT_GUIDANCE =
  "Entrada de mining vazia (nuggets_collected=0): o minerador classifica SOMENTE texto depositado nos slots gold_mining/parking_lot (evidence_attach.gold_mining, gold_mining de meeting e de verdict) - nada foi depositado ou tudo foi filtrado como bookkeeping. Para alimentar o funil: evidence_attach com gold_mining [\"Regra <tema>: <aprendizado reutilizavel do bloco>\"] ANTES de rodar mm_memory_mining novamente.";

// A decisao de QUANDO o guidance aparece mora aqui (SSOT de politica de
// mining), nao na fachada: o FlowEngine so cola a projecao nos summaries e
// retornos, sem decisao nova dentro do monolito (visita CONTAIN do camping).
export function emptyMiningDepositGuidance(nuggetsCollected: number): string | undefined {
  return nuggetsCollected === 0 ? EMPTY_MINING_DEPOSIT_GUIDANCE : undefined;
}

// SPT mining-deposit-visibility (F1b): passo de deposito compartilhado pelas
// DUAS rotas de unblock (memoryRequiredErrorAction em server.ts e
// memoryMiningRequiredSequence no flow-engine) — uma unica verdade do
// "deposite o aprendizado ANTES de minerar" (o minerador classifica somente
// texto depositado; minerar com a boca vazia so devolve 0 candidatos).
export function miningDepositStep(flowId: string, order = 1): Record<string, unknown> {
  return {
    order,
    tool: "evidence_attach",
    only_if: "aprendizado do bloco ainda nao depositado em gold_mining/parking_lot",
    purpose: "depositar o aprendizado do bloco: o minerador classifica somente texto depositado",
    args: {
      flow_id: flowId,
      title: "Deposito de aprendizado do bloco",
      gold_mining: ["Regra <tema>: <aprendizado reutilizavel do bloco>"]
    }
  };
}

// SPT mining-egress-shrink (2026-10-28, paga FE-DEBT-004): a montagem da
// sequência de unblock de memória é política de mining pura (consome só
// flow_id e os builders daqui) — Mover Função da fachada para o SSOT.
export function memoryMiningRequiredSequence(flow: Flow): Array<Record<string, unknown>> {
  return [
    miningDepositStep(flow.flow_id),
    {
      order: 2,
      tool: "mm_memory_mining",
      purpose: "executar garimpo/classificacao canonica de memoria no flow antes de novo veredito positivo",
      args: { flow_id: flow.flow_id, auto_classify: true, write_policy: "auto_write" },
      capture: "memory_mining_summary"
    },
    {
      order: 3,
      tool: "goal_status",
      purpose: "confirmar que memory_required_but_empty saiu dos blockers antes de repetir goal_verdict",
      args: { flow_id: flow.flow_id }
    },
    {
      order: 4,
      tool: "goal_verdict",
      purpose: "somente se goal_status nao listar memory_required_but_empty e os demais blockers estiverem resolvidos",
      only_if: "goal_status.blockers nao contem memory_required_but_empty",
      args: {
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        evidence_ids: ["<evidence_ids_obrigatorias>"],
        meeting_id: "<meeting_id_se_required_cooperation_estava_ativo>",
        rationale: "Veredito apos mm_memory_mining canonico e blockers fiscais resolvidos.",
        residual_risks: ["<risco residual ou nenhum>"],
        next_step: "<proximo passo com quando>"
      }
    }
  ];
}

// O par de egress de visibilidade é UM conceito (contagem da entrada + ensino
// do depósito quando vazio): o helper devolve os dois campos e os 4 pontos da
// fachada (summary/return legacy e v2) só espalham.
export function miningVisibilityEgress(nuggetsCollected: number): { nuggets_collected: number; deposit_guidance?: string } {
  return {
    nuggets_collected: nuggetsCollected,
    deposit_guidance: emptyMiningDepositGuidance(nuggetsCollected)
  };
}

export function collectMemoryNuggets(flow: Flow, meetings: Meeting[]): MemoryNugget[] {
  type CollectedNugget = MemoryNugget & { dedupeKey: string };
  const nuggets: CollectedNugget[] = [];
  const add = (
    items: Array<{
      item: string;
      dedupeKey?: string;
      provenance?: NonNullable<MemoryNugget["provenance"]>;
    }>,
    source: "gold_mining" | "parking_lot",
    evidenceScore?: number
  ) => {
    for (const entry of items) {
      const item = entry.item;
      if (!item.trim() || /^evidence_required:/i.test(item.trim()) || isBookkeepingNugget(item)) {
        continue;
      }
      nuggets.push({
        item,
        source,
        evidenceScore: evidenceScore ?? (source === "gold_mining" ? 1 : 0),
        ...(entry.provenance?.length ? { provenance: entry.provenance } : {}),
        dedupeKey: entry.dedupeKey ?? `${source}:${normalizeTextKey(item)}`
      });
    }
  };
  const plain = (items: string[]) => items.map((item) => ({ item }));
  add(plain(flow.gold_mining), "gold_mining");
  add(plain(flow.parking_lot), "parking_lot");
  for (const link of flow.goal_learning_links ?? []) {
    if (link.garimpo_vinculado.pepita) {
      add([{ item: link.garimpo_vinculado.pepita }], "gold_mining");
    } else {
      add([{ item: link.parking_item }], "parking_lot");
    }
  }
  for (const meeting of meetings) {
    add(plain(meeting.gold_mining), "gold_mining");
    add(plain(meeting.parking_lot), "parking_lot");
    add(meeting.decisions.map((item) => ({
      item: `Decisao de reuniao: ${item}`,
      dedupeKey: `meeting-decision:${normalizeTextKey(item)}`,
      provenance: [{ kind: "meeting.decision" as const, meeting_id: meeting.meeting_id }]
    })), "parking_lot", 1);
    add(meeting.findings.map((item) => ({
      item: `Achado de reuniao: ${item}`,
      dedupeKey: `meeting-learning:${normalizeTextKey(item)}`,
      provenance: [{ kind: "meeting.finding" as const, meeting_id: meeting.meeting_id }]
    })), "parking_lot", 1);
    add(
      meeting.turns
        .flatMap((turn, turnIndex) => [
          ...(turn.finding?.trim() ? [{
            item: `Turno de reuniao: ${turn.finding}`,
            dedupeKey: `meeting-learning:${normalizeTextKey(turn.finding)}`,
            provenance: [{ kind: "meeting.turn.finding" as const, meeting_id: meeting.meeting_id, turn_index: turnIndex }]
          }] : []),
          ...(turn.note?.trim() ? [{
            item: `Turno de reuniao: ${turn.note}`,
            dedupeKey: `meeting-learning:${normalizeTextKey(turn.note)}`,
            provenance: [{ kind: "meeting.turn.note" as const, meeting_id: meeting.meeting_id, turn_index: turnIndex }]
          }] : [])
        ]),
      "parking_lot",
      1
    );
  }
  for (const evidence of flow.evidence) {
    add(plain(evidence.gold_mining), "gold_mining");
    add(plain(evidence.parking_lot), "parking_lot");
  }
  for (const verdict of flow.verdicts) {
    add(plain(verdict.gold_mining), "gold_mining");
    add(plain(verdict.parking_lot), "parking_lot");
    add((verdict.review_findings ?? []).map((item) => ({ item: `Achado de review: ${item}` })), "gold_mining", 2);
    add(verdict.rationale ? [{ item: `Racional de veredito: ${verdict.rationale}` }] : [], "parking_lot", 1);
    add(verdict.residual_risks.map((item) => ({ item: `Risco residual: ${item}` })), "parking_lot", 1);
  }
  const deduped = new Map<string, CollectedNugget>();
  for (const nugget of nuggets) {
    const existing = deduped.get(nugget.dedupeKey);
    if (existing) {
      existing.provenance = uniqueMemoryProvenance([
        ...(existing.provenance ?? []),
        ...(nugget.provenance ?? [])
      ]);
      existing.evidenceScore = Math.max(existing.evidenceScore, nugget.evidenceScore);
      continue;
    }
    deduped.set(nugget.dedupeKey, nugget);
  }
  return Array.from(deduped.values(), ({ dedupeKey: _dedupeKey, ...nugget }) => nugget);
}

function uniqueMemoryProvenance(
  provenance: NonNullable<MemoryNugget["provenance"]>
): NonNullable<MemoryNugget["provenance"]> {
  const seen = new Set<string>();
  return provenance.filter((item) => {
    const key = `${item.kind}:${item.meeting_id}:${item.turn_index ?? ""}`;
    if (seen.has(key)) return false;
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

export function classifyDexMemoriaV2MiningCandidate(input: DexMemoriaV2MiningClassifierInput): DexMemoriaV2MiningClassification {
  if (input.evidence_score < 1) return { status: "unresolved", reason: "destinations_required" };
  const projectRequested = V2_PROJECT_SCOPE_INTENT_PATTERN.test(input.item);
  const globalRequested = V2_GLOBAL_SCOPE_INTENT_PATTERN.test(input.item);
  const theme = detectTheme(input.item);
  let requestedDestinations: [DexMemoriaV2Destination, ...DexMemoriaV2Destination[]] | undefined;
  if (projectRequested && globalRequested) requestedDestinations = [{ scope: "project" }, { scope: "global" }];
  else if (globalRequested) requestedDestinations = [{ scope: "global" }];
  else if (projectRequested) requestedDestinations = [{ scope: "project" }];
  else if (theme) requestedDestinations = [{ scope: "theme", theme }];
  if (!requestedDestinations) return { status: "unresolved", reason: "destinations_required" };
  const tagOwner = theme ?? "ppirtv";
  return {
    status: "resolved",
    density: "light",
    requested_destinations: requestedDestinations,
    tags: [`#${tagOwner}/memory-v2`]
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

// SPT gate-integrity-hardening-2 (R4): o assert migrou para o SSOT
// security/secret-redaction.ts; reexport mantem consumidores estaveis.
export { assertNoSecretLikeText } from "../security/secret-redaction.js";

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

// Moved verbatim from FlowEngine (FE-2026-10-13-GOVERNED-TAG-CONTRACT): pure
// V2 promotion metadata policy for memory candidates. The only adaptations
// are the export keyword and uniqueStrings in place of the facade's unique
// (both call sites pre-filter with map(trim).filter(Boolean), so Set order
// semantics are identical).
export function requireV2PromotionMetadata(
  candidate: Record<string, unknown>,
  explicit: {
    tags?: string[];
    density?: "light" | "deep";
    owner_skill?: string;
  } = {}
): {
  tags: string[];
  density: "light" | "deep";
  theme?: string;
  owner_skill?: string;
} {
  const hasExplicitMetadata = explicit.tags !== undefined
    || explicit.density !== undefined
    || explicit.owner_skill !== undefined;
  const persistedTags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  const route = candidate.route && typeof candidate.route === "object"
    ? candidate.route as Record<string, unknown>
    : undefined;
  const persistedDensity = candidate.density === "deep" || route?.target === "L3" ? "deep"
    : candidate.density === "light" || route?.target === "L2" ? "light"
      : undefined;
  const persistedOwnerSkill = typeof candidate.owner_skill === "string" && candidate.owner_skill.trim()
    ? candidate.owner_skill.trim()
    : typeof route?.owner_skill === "string" && route.owner_skill.trim()
      ? route.owner_skill.trim()
      : undefined;
  const destinations = Array.isArray(candidate.destinations) ? candidate.destinations : [];
  const themeDestination = destinations.find((destination) =>
    destination && typeof destination === "object" && (destination as Record<string, unknown>).scope === "theme"
  ) as Record<string, unknown> | undefined;
  const persistedTheme = typeof themeDestination?.theme === "string" && themeDestination.theme.trim()
    ? themeDestination.theme.trim()
    : undefined;
  const persistedComplete = persistedTags.length > 0
    && persistedDensity !== undefined
    && (persistedDensity !== "deep" || Boolean(persistedOwnerSkill));

  if (hasExplicitMetadata && candidate.classification_status !== "unresolved") {
    if (!persistedComplete) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: classified V2 candidate metadata is incomplete");
    }
    const explicitTags = explicit.tags === undefined
      ? undefined
      : uniqueStrings(explicit.tags.map((tag) => tag.trim()).filter(Boolean));
    const tagsConflict = explicitTags !== undefined
      && JSON.stringify([...explicitTags].sort()) !== JSON.stringify([...persistedTags].sort());
    const densityConflict = explicit.density !== undefined && explicit.density !== persistedDensity;
    const ownerConflict = explicit.owner_skill !== undefined
      && explicit.owner_skill.trim() !== (persistedOwnerSkill ?? "");
    if (tagsConflict || densityConflict || ownerConflict) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_CONFLICT: explicit metadata differs from the classified V2 candidate");
    }
    return {
      tags: persistedTags,
      density: persistedDensity!,
      ...(persistedTheme ? { theme: persistedTheme } : {}),
      ...(persistedOwnerSkill ? { owner_skill: persistedOwnerSkill } : {})
    };
  }
  if (hasExplicitMetadata) {
    const tags = uniqueStrings((explicit.tags ?? []).map((tag) => tag.trim()).filter(Boolean));
    const ownerSkill = explicit.owner_skill?.trim();
    if (tags.length === 0 || !explicit.density || (explicit.density === "deep" && !ownerSkill)) {
      throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: unresolved V2 promotion requires explicit tags, density and owner_skill for L3");
    }
    for (const tag of tags) {
      assertGovernedTag(tag, "MEMORY_CANDIDATE_PROMOTION_TAG_INVALID: promotion tags must use governed nested kebab-case");
    }
    return {
      tags,
      density: explicit.density,
      ...(ownerSkill ? { owner_skill: ownerSkill } : {})
    };
  }
  if (!persistedComplete) {
    throw new Error("MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED: V2 promotion requires tags, density and owner_skill for L3");
  }
  return {
    tags: persistedTags,
    density: persistedDensity!,
    ...(persistedTheme ? { theme: persistedTheme } : {}),
    ...(persistedOwnerSkill ? { owner_skill: persistedOwnerSkill } : {})
  };
}

// SPT memory-gate-loop-solubility (T-5 SHRINK, laudo do oráculo 2026-10-17):
// pacote puro de decisão de mining/gate extraído do FlowEngine — uma única
// noção de ordem (append-only) e loop monitor que só trata id distinto como
// progresso. Sem dependência do monolito (zero ciclo).

export type FiscalVerdictInput = {
  status?: VerdictStatus;
  rationale?: string;
  evidence_ids?: string[];
  residual_risks?: string[];
  next_step?: string;
  review_artifact_path?: string;
  review_findings?: string[];
  verdict_parking_lot?: string[];
  verdict_gold_mining?: string[];
  attempt_count?: number;
  regress_count?: number;
  meeting_id?: string;
  meeting_ids?: string[];
  memory_mining?: Record<string, unknown> | null;
};

function memoryPolicyStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function memoryIntentText(flow: Flow, input: FiscalVerdictInput): string {
  const envelope = flow.goal_binding?.envelope;
  const generatedProvenanceContext = envelope
    ? `GOAL/SPT via dex-code. Workspace: ${envelope.workspace}. SPT: ${envelope.spt_path}.`
    : null;
  const semanticContext = flow.context === generatedProvenanceContext ? "" : flow.context;

  return [
    flow.goal,
    semanticContext,
    ...flow.risks,
    ...flow.uncertainties,
    ...flow.tasks,
    ...flow.expected_evidence,
    ...flow.done_criteria,
    input.rationale,
    input.next_step,
    ...(input.residual_risks ?? []),
    ...(input.review_findings ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}

export function memoryRequiredByFlow(flow: Flow, input: FiscalVerdictInput = {}): boolean {
  return (
    flow.history.some(
      (event) =>
        event.type === "fiscal_policy_blocked" &&
        (event.data.memory_required === true || memoryPolicyStringArray(event.data.blocking_reasons).includes("memory_required_but_empty"))
    ) ||
    /(memoria|memória|\bL[123]\b|lembranca|lembrança|aprendizado reutilizavel|aprendizado reutilizável|garimpo|pepita)/i.test(memoryIntentText(flow, input))
  );
}

export function noMemoryWasPromoted(flow: Flow, memoryMining?: Record<string, unknown> | null): boolean {
  const status = memoryMining ?? flow.memory_mining;
  const writtenCount = typeof status?.written_count === "number" ? status.written_count : 0;
  if (writtenCount > 0) {
    return !memoryMiningStructurallyPromoted(status);
  }
  const candidatesCount = typeof status?.candidates_count === "number" ? status.candidates_count : 0;
  const candidates = Array.isArray(status?.candidates) ? status.candidates : [];
  const editQueue = Array.isArray(status?.edit_queue) ? status.edit_queue : [];
  const effectiveCandidatesCount = Math.max(candidatesCount, candidates.length, editQueue.length);
  if (effectiveCandidatesCount > 0) {
    return candidates.length === 0;
  }
  // Se a mineracao ja foi executada e terminou vazia, nao ha candidato para
  // escrever nem candidate_id para resolver. O blocker de "memoria vazia" so
  // faz sentido antes da mineracao ou quando existe residuo real.
  if (memoryMiningCompletedWithNoCandidates(status)) {
    return false;
  }
  // Compatibilidade com estados antigos de classify_only sem todos os campos.
  // O blocker de "memoria vazia" so faz sentido quando a mineracao ainda
  // nao rodou ou quando existe strong_unwritten aguardando decisao.
  const miningRan = typeof status?.last_run_at === "string" && status.last_run_at.length > 0;
  const writePolicy = typeof status?.write_policy === "string" ? status.write_policy : "";
  const strongUnwrittenCount = typeof status?.strong_unwritten_count === "number" ? status.strong_unwritten_count : 0;
  if (miningRan && writePolicy === "classify_only" && strongUnwrittenCount === 0) {
    return false;
  }
  return true;
}

export function memoryMiningCompletedWithNoCandidates(memoryMining: Record<string, unknown> | MemoryMiningSummary | undefined | null): boolean {
  if (!memoryMining) {
    return false;
  }
  const miningRan = typeof memoryMining.last_run_at === "string" && memoryMining.last_run_at.length > 0;
  const candidates = Array.isArray(memoryMining.candidates) ? memoryMining.candidates : [];
  const editQueue = Array.isArray(memoryMining.edit_queue) ? memoryMining.edit_queue : [];
  return (
    miningRan &&
    numericMemoryField(memoryMining, "candidates_count") === 0 &&
    candidates.length === 0 &&
    numericMemoryField(memoryMining, "written_count") === 0 &&
    numericMemoryField(memoryMining, "strong_unwritten_count") === 0 &&
    numericMemoryField(memoryMining, "blocked_count") === 0 &&
    numericMemoryField(memoryMining, "write_failures_count") === 0 &&
    editQueue.length === 0 &&
    !memoryPostWriteValidationBlocks(memoryMining.memory_post_write_validation as MemoryPostWriteValidation | undefined | null)
  );
}

function memoryMiningStructurallyPromoted(memoryMining: Record<string, unknown> | MemoryMiningSummary | undefined | null): boolean {
  if (!memoryMining) {
    return false;
  }
  return memoryMining.memory_written === true
    && memoryMining.memory_validated === true
    && !memoryPostWriteValidationBlocks(memoryMining.memory_post_write_validation as MemoryPostWriteValidation | undefined | null);
}

export function memoryPostWriteValidationBlocks(validation: MemoryPostWriteValidation | undefined | null): boolean {
  return validation?.required === true && validation.status !== "passed";
}

export function numericMemoryField(memory: Record<string, unknown> | MemoryMiningSummary | undefined | null, field: string): number {
  const value = memory?.[field as keyof typeof memory];
  return typeof value === "number" ? value : 0;
}

export function hasVerdictAfterLatestMemoryMining(flow: Flow): boolean {
  const eventTypes = flow.history.map((event) => event.type);
  const latestMining = eventTypes.lastIndexOf("memory_mined");
  return latestMining >= 0 && eventTypes.lastIndexOf("verdict_recorded") > latestMining;
}

export function blockerSignature(blockers: string[]): string {
  return [...new Set(blockers)].sort().join("|");
}

export function loopWindowEvents(flow: Flow, signature: string, resetOnPassedGate = true): Flow["history"] {
  const history = flow.history;
  const duplicateMinings = duplicateMiningEventIndexes(history);
  let start = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (isLoopResetEvent(history[index], signature, resetOnPassedGate, duplicateMinings.has(index))) {
      start = index + 1;
      break;
    }
  }
  return history.slice(start);
}

// SPT memory-gate-loop-solubility (T-4, decisão A): re-mining com
// reconciliation id idêntico ao mining imediatamente anterior NÃO é progresso
// — não reseta a janela do loop monitor. Eventos legacy sem id contam como
// progresso próprio (retrocompatível).
function duplicateMiningEventIndexes(history: Flow["history"]): Set<number> {
  const duplicates = new Set<number>();
  let lastId: string | undefined;
  for (let index = 0; index < history.length; index += 1) {
    const event = history[index];
    if (event.type !== "memory_mined") {
      continue;
    }
    const id = event.data?.v2_reconciliation_id;
    if (typeof id === "string" && id.length > 0) {
      if (id === lastId) {
        duplicates.add(index);
      }
      lastId = id;
    } else {
      lastId = undefined;
    }
  }
  return duplicates;
}

export function isLoopResetEvent(
  event: Flow["history"][number],
  signature: string,
  resetOnPassedGate: boolean,
  isDuplicateMining = false
): boolean {
  if (event.type === "fiscal_policy_blocked" || event.type === "goal_terminal_blocked") {
    const eventSignature = String(event.data.loop_signature ?? blockerSignature(memoryPolicyStringArray(event.data.blocking_reasons)));
    return eventSignature !== signature;
  }
  if (resetOnPassedGate && event.type === "gate_checked" && event.data.status === "passed") {
    return true;
  }
  if (event.type === "evidence_attached") {
    // SPT review-gate-loop-proof (T-3): evidencia de review INVALIDA nao e
    // progresso — nao reseta a janela (o ciclico do incidente 2026-10-17
    // anestesiava o fiscal com ~60 resets). Eventos antigos sem o campo e
    // kinds nao-review (campo ausente) continuam resetando (retrocompativel).
    return event.data.review_valid !== false;
  }
  if (event.type === "memory_mined") {
    return !isDuplicateMining;
  }
  return ["meeting_closed", "phase_advanced", "verdict_recorded", "flow_completed", "flow_archived"].includes(event.type);
}
