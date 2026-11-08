import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TARGET_PATH = "src/flow-engine.ts";
const DEFAULT_MANIFEST = "docs/architecture/flow-engine-evolution.json";
const ARCHITECTURE_PATH = "docs/architecture/FLOW_ENGINE_EVOLUTION.md";
// Camping ownership transition (2026-10-14, owner decision): the current
// evolution owner is $oraculo-refatoracao; the legacy $refactoring-fowler-rich
// stays valid so the immutable ledger history and its replay keep passing.
const EXPECTED_OWNER = "$oraculo-refatoracao";
const CAMPING_OWNERS = new Set(["$refactoring-fowler-rich", "$oraculo-refatoracao"]);
const ALLOWED_MODES = new Set(["SHRINK", "CONTAIN", "EXCEPTION"]);
const EXCEPTION_REASONS = new Set(["integrity", "security", "public_compatibility", "urgent_hotfix"]);

export function analyzeFlowEngineSource(source) {
  const sourceFile = ts.createSourceFile(TARGET_PATH, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const symbols = [];
  const imports = [];
  let decisionPoints = 0;
  let guardExpressions = 0;
  let exportedSymbols = 0;
  const decisionSignatures = [];
  const guardSignatures = [];
  const guardAdaptationSignatures = [];
  const symbolPath = [];

  function normalized(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function decisionExpression(node) {
    if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) return node.expression;
    if (ts.isForStatement(node)) return node.condition;
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) return node.expression;
    if (ts.isCaseClause(node)) return node.expression;
    return null;
  }

  function visit(node) {
    if (
      ts.isIfStatement(node)
      || ts.isConditionalExpression(node)
      || ts.isForStatement(node)
      || ts.isForInStatement(node)
      || ts.isForOfStatement(node)
      || ts.isWhileStatement(node)
      || ts.isDoStatement(node)
      || ts.isCatchClause(node)
      || ts.isCaseClause(node)
    ) {
      decisionPoints += 1;
      const expression = decisionExpression(node);
      decisionSignatures.push(`${symbolPath.join(".") || "<module>"}:${ts.SyntaxKind[node.kind]}:${expression ? normalized(expression.getText(sourceFile)) : "<implicit>"}`);
    }
    if (ts.isBinaryExpression(node) && [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken
    ].includes(node.operatorToken.kind)) {
      guardExpressions += 1;
      const signature = `${symbolPath.join(".") || "<module>"}:${ts.SyntaxKind[node.operatorToken.kind]}:${normalized(node.getText(sourceFile))}`;
      guardSignatures.push(signature);
      if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && ts.isCallExpression(node.right)) {
        guardAdaptationSignatures.push(signature);
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    const namedSymbol = (
      ts.isFunctionDeclaration(node)
      || ts.isMethodDeclaration(node)
      || ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isEnumDeclaration(node)
    );
    if (namedSymbol) {
      const name = node.name?.getText(sourceFile);
      if (name) symbols.push(name);
    }
    if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      exportedSymbols += 1;
    }
    const pathName = namedSymbol ? node.name?.getText(sourceFile) : null;
    if (pathName) symbolPath.push(pathName);
    ts.forEachChild(node, visit);
    if (pathName) symbolPath.pop();
  }

  visit(sourceFile);
  return {
    nonblank_lines: source.split(/\r?\n/).filter((line) => line.trim().length > 0).length,
    decision_points: decisionPoints,
    guard_expressions: guardExpressions,
    decision_signatures: decisionSignatures.sort(),
    guard_signatures: guardSignatures.sort(),
    guard_adaptation_signatures: guardAdaptationSignatures.sort(),
    symbols: [...new Set(symbols)].sort(),
    imports: [...new Set(imports)].sort(),
    exported_symbols: exportedSymbols
  };
}

function usedRuntimeImports(source) {
  const sourceFile = ts.createSourceFile("consumer.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edges = [];
  function identifierUsedAtRuntime(name) {
    let used = false;
    function visit(node) {
      if (used) return;
      if (ts.isIdentifier(node) && node.text === name) {
        let current = node.parent;
        let typeOnly = false;
        while (current && current !== sourceFile) {
          if (ts.isImportDeclaration(current)) return;
          if (ts.isTypeNode(current)) {
            typeOnly = true;
            break;
          }
          current = current.parent;
        }
        if (!typeOnly) used = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return used;
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    const names = [];
    if (clause?.name) names.push(clause.name.text);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) names.push(element.name.text);
      }
    }
    const used = names.length === 0 || names.some(identifierUsedAtRuntime);
    if (used) edges.push(statement.moduleSpecifier.text);
  }
  return edges;
}

function declaredTestTitles(source) {
  const sourceFile = ts.createSourceFile("evidence.test.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const titles = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && (expression.text === "it" || expression.text === "test")) {
        titles.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return titles;
}

function addedValues(before, after) {
  const remaining = [...before];
  return after.filter((value) => {
    const index = remaining.indexOf(value);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

function metric(before, after) {
  return { before, after, delta: after - before };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function requiredDeclarationReasons(declaration) {
  const reasons = [];
  for (const field of ["id", "spt_path", "responsibility", "owner", "changelog_marker", "architecture_marker"]) {
    if (!nonEmptyString(declaration?.[field])) reasons.push(`DECLARATION_FIELD_REQUIRED:${field}`);
  }
  if (!CAMPING_OWNERS.has(declaration?.owner ?? "")) reasons.push("DECLARATION_OWNER_INVALID");
  if (!/^\.agents\/PLAN-TASKS\/[A-Za-z0-9._-]+\.md$/.test(declaration?.spt_path ?? "")) {
    reasons.push("DECLARATION_SPT_PATH_INVALID");
  }
  if (!nonEmptyStrings(declaration?.consumers)) reasons.push("DECLARATION_FIELD_REQUIRED:consumers");
  if (!nonEmptyStrings(declaration?.evidence)) reasons.push("DECLARATION_FIELD_REQUIRED:evidence");
  if (!ALLOWED_MODES.has(declaration?.mode)) reasons.push("DECLARATION_MODE_INVALID");
  return reasons;
}

function latestMaterialHistory(history, declaration) {
  return [...(history ?? [])].reverse().find((entry) => entry
    && entry.mode !== "NOT_APPLICABLE"
    && entry.sealed_retroactive !== true
    && entry.id !== declaration?.supersedes_record);
}

function openDebt(history) {
  const debts = new Map();
  for (const entry of history ?? []) {
    if (entry?.debt?.id && entry.debt.status === "open") {
      debts.set(entry.debt.id, { ...entry.debt, responsibility: entry.debt.responsibility ?? entry.responsibility });
    }
    if (entry?.mode === "SHRINK" && entry?.pays_debt_id) debts.delete(entry.pays_debt_id);
  }
  return [...debts.values()][0] ?? null;
}

function failureAction() {
  return {
    owner: EXPECTED_OWNER,
    action: "Move policy/validation/projection outside FlowEngine, pay the open debt with SHRINK, or document a bounded EXCEPTION with causal RED. Update the architecture ledger and CHANGELOG, then rerun npm run check:flow-engine.",
    when: "before review or commit of the diff that touches src/flow-engine.ts"
  };
}

// Corte de cura (P1 adversarial Onda 2): o selo parent_commit era ignorado em
// commit de pai unico (parents[0] vencia) — fato git falso passava em silencio.
// Cura-2: predicado de casamento de pai vive AQUI (fonte unica) — selo vivo,
// replay de bootstrap e helper compartilham a mesma verdade.
export function parentMatchesCommit(parents, candidate) {
  return parents.some(
    (parent) => parent === candidate || (candidate.length >= 7 && parent.startsWith(candidate))
  );
}

// Puro e testavel: devolve COMMIT_PARENT_MISMATCH quando o pai armazenado nao
// casa NENHUM pai real; prefixo nao-ambiguo (>= 7 hex) aceito por compat com
// selos legados de sha curto.
export function sealedParentReasons(record, parents) {
  const reasons = [];
  const stored = nonEmptyString(record?.parent_commit) ? record.parent_commit : null;
  if (!stored) return reasons;
  if (!parentMatchesCommit(parents, stored)) reasons.push("COMMIT_PARENT_MISMATCH");
  return reasons;
}

// Cura-3 (P1 adversarial cura-2): vitest -t trata o seletor como REGEX — um
// seletor que é substring exata do título mas contém metacaracteres (o caso
// canônico: parênteses literais) casa 0 testes com exit 0 (falso verde de
// replay). O gate passa a exigir que o seletor, COMO REGEX, case algum título
// declarado no arquivo de evidência.
export function selectorRunsAsRegex(selector, titles) {
  try {
    return titles.some((title) => new RegExp(selector).test(title));
  } catch {
    return false;
  }
}

// Cura-4 (P2 adversarial cura-3): self-match fecha o irmão colidente — uma
// regex pode casar um título IRMÃO sem casar o próprio seletor (a+b casa aab,
// não a+b); o replay do vitest -t tem que rodar o teste PRETENDIDO.
export function selectorIsReplayable(selector, titles) {
  try {
    return new RegExp(selector).test(selector) && selectorRunsAsRegex(selector, titles);
  } catch {
    return false;
  }
}

// Cura-4 (grandfathering declarado): seletores selados ANTES do gate de regex
// (2026-11-08, cura-3) são isentos na revalidação de replay — a emenda
// documental vive no MD e o gate vigia os FUTUROS. ISENÇÃO É EXCEÇÃO
// DECLARADA, nunca silêncio.
const LEGACY_SELECTOR_EXEMPT = new Set([
  "FE-2026-10-17-REVIEW-LOOP-FISCAL-SANE",
  "FE-2026-10-18-GATE-INTEGRITY-F4F5F6",
  "FE-2026-10-18-GATE-INTEGRITY-HARDENING-2",
  "FE-2026-10-18-GATE-INTEGRITY-TYPED-PHASES",
  "FE-2026-10-18-GIT-CORROBORATION-COMMITS-SHRINK",
  "FE-2026-10-18-INPUT-NEVER-BLOCKING-F2-SHRINK",
  "FE-2026-10-26-VERDICT-FISCAL-POLICY-SHRINK",
  "FE-2026-10-29-ENV-SNAPSHOT-REDACTION-CONTAIN",
  "FE-2026-11-07-CONVERGENCIA-PR12",
  "FE-2026-11-07-ONDA1-GOAL-START-SSOT",
  "FE-2026-11-07-PATH-ATTRIBUTION-REGRESSAO-C01",
  "FE-2026-11-08-CURA2-VALIDADOR-SELO-VIVO",
]);
// (ids legados cujos seletores selados ANTES do gate de self-match contêm
// metacaracteres de regex — +, ->, {}, [] — medido por probe: 24 seletores
// em 12 records; a emenda documental vive no MD; o gate vigia os FUTUROS.)

// Cura-4 (P1-1 adversarial cura-3): helper ÚNICO de linhagem de selagem —
// consumido pelo LEDGER_PREFIX (record que entra ou muda no diff), pelo path
// de declaração (record novo) e pelo seal-diff. Sem janela de diff escapa.
export function sealLineageReasons(after, before, parents) {
  const reasons = [];
  if (!nonEmptyString(after.parent_commit)) {
    reasons.push(
      nonEmptyString(before?.parent_commit)
        ? `COMMIT_SEAL_PARENT_REMOVED:${after.id}`
        : `COMMIT_SEAL_PARENT_MISSING:${after.id}`
    );
    return reasons;
  }
  if (!parentMatchesCommit(parents, after.parent_commit)) {
    reasons.push(`COMMIT_SEAL_PARENT_MISMATCH:${after.id}`);
  }
  return reasons;
}

function validExceptionExpiry(value) {
  if (!nonEmptyString(value)) return false;
  if (value === "next diff that touches src/flow-engine.ts") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const expiry = Date.parse(`${value}T23:59:59Z`);
  const maximum = Date.now() + (30 * 24 * 60 * 60 * 1000);
  return Number.isFinite(expiry) && expiry >= Date.now() && expiry <= maximum;
}

export function evaluateFlowEngineChange({ baseSource, headSource, declaration, history = [], flowEngineChanged }) {
  const before = analyzeFlowEngineSource(baseSource);
  const after = analyzeFlowEngineSource(headSource);
  const metrics = {
    nonblank_lines: metric(before.nonblank_lines, after.nonblank_lines),
    decision_points: metric(before.decision_points, after.decision_points),
    guard_expressions: metric(before.guard_expressions, after.guard_expressions),
    symbol_count: metric(before.symbols.length, after.symbols.length),
    exported_symbols: metric(before.exported_symbols, after.exported_symbols),
    imports: {
      added: after.imports.filter((item) => !before.imports.includes(item)),
      removed: before.imports.filter((item) => !after.imports.includes(item))
    },
    symbols: {
      added: after.symbols.filter((item) => !before.symbols.includes(item)),
      removed: before.symbols.filter((item) => !after.symbols.includes(item))
    },
    decision_sites: {
      added: addedValues(before.decision_signatures, after.decision_signatures),
      removed: addedValues(after.decision_signatures, before.decision_signatures)
    },
    guard_sites: {
      added: addedValues(before.guard_signatures, after.guard_signatures),
      removed: addedValues(after.guard_signatures, before.guard_signatures)
    }
  };

  const targetChanged = typeof flowEngineChanged === "boolean" ? flowEngineChanged : baseSource !== headSource;
  if (!targetChanged) {
    return {
      contract: "dex.flow-engine.boundary.receipt.v1",
      status: "NOT_APPLICABLE",
      mode: "NOT_APPLICABLE",
      flow_engine_changed: false,
      metrics,
      reasons: [],
      next_required_action: null,
      recoverable: true
    };
  }

  const reasons = requiredDeclarationReasons(declaration);
  const mode = declaration?.mode ?? "FAIL";
  const debt = openDebt(history);

  if (mode === "SHRINK") {
    const removedSymbols = Array.isArray(declaration?.removed_symbols) ? declaration.removed_symbols : [];
    const actuallyRemoved = removedSymbols.filter((name) => before.symbols.includes(name) && !after.symbols.includes(name));
    const symbolMappings = declaration?.symbol_mappings && typeof declaration.symbol_mappings === "object"
      ? declaration.symbol_mappings
      : {};
    if (removedSymbols.length === 0 || actuallyRemoved.length !== removedSymbols.length) {
      reasons.push("SHRINK_REQUIRES_REMOVED_SYMBOL");
    }
    if (removedSymbols.some((name) => !nonEmptyString(symbolMappings[name]))) {
      reasons.push("SHRINK_REQUIRES_SYMBOL_MAPPING");
    }
    if (declaration?.same_responsibility !== true) reasons.push("SHRINK_REQUIRES_SAME_RESPONSIBILITY");
    if (!nonEmptyStrings(declaration?.behavior_preserved_by)) reasons.push("SHRINK_REQUIRES_BEHAVIOR_PROOF");
    if (metrics.decision_points.delta > 0) reasons.push("SHRINK_ADDED_DECISION_POINT");
    if (metrics.decision_sites.added.length > 0) reasons.push("SHRINK_ADDED_OR_RELOCATED_DECISION");
    if (metrics.exported_symbols.delta > 0) reasons.push("SHRINK_EXPANDED_PUBLIC_SURFACE");
    if (metrics.nonblank_lines.delta >= 0) reasons.push("SHRINK_REQUIRES_NEGATIVE_NONBLANK_BALANCE");
    if (debt && declaration?.pays_debt_id !== debt.id) reasons.push(`OPEN_DEBT_MUST_BE_PAID:${debt.id}`);
  }

  if (mode === "CONTAIN") {
    if (declaration?.glue_only !== true) reasons.push("CONTAIN_REQUIRES_GLUE_ONLY_ATTESTATION");
    if (!nonEmptyString(declaration?.destination_module)) reasons.push("CONTAIN_REQUIRES_DESTINATION_MODULE");
    if (metrics.decision_points.delta > 0) reasons.push("CONTAIN_ADDED_DECISION_POINT");
    if (metrics.decision_sites.added.length > 0) reasons.push("CONTAIN_ADDED_OR_RELOCATED_DECISION");
    if (metrics.symbol_count.delta > 0) reasons.push("CONTAIN_ADDED_SYMBOL");
    if (metrics.exported_symbols.delta > 0) reasons.push("CONTAIN_EXPANDED_PUBLIC_SURFACE");
    if (metrics.nonblank_lines.delta > 20) reasons.push("CONTAIN_EXCEEDS_GLUE_BUDGET");
    if (metrics.guard_expressions.delta > 1) reasons.push("CONTAIN_EXCEEDS_GUARD_ADAPTATION_BUDGET");
    if (metrics.guard_sites.added.some((site) => !after.guard_adaptation_signatures.includes(site))) {
      reasons.push("CONTAIN_ADDED_POLICY_GUARD");
    }
    if (metrics.guard_sites.added.length > 0 && !nonEmptyString(declaration?.guard_adaptation)) {
      reasons.push("CONTAIN_REQUIRES_GUARD_ADAPTATION");
    }
    if (
      !declaration?.debt
      || !nonEmptyString(declaration.debt.id)
      || declaration.debt.status !== "open"
      || !CAMPING_OWNERS.has(declaration.debt.owner ?? "")
      || !nonEmptyString(declaration.debt.when)
      || declaration.debt.responsibility !== declaration.responsibility
      || declaration.debt.payment_scope !== "any_verified_shrink"
    ) reasons.push("CONTAIN_REQUIRES_PAYABLE_DEBT");
    if (debt) reasons.push(`OPEN_DEBT_MUST_BE_PAID:${debt.id}`);
  }

  if (mode === "EXCEPTION") {
    if (!EXCEPTION_REASONS.has(declaration?.exception_reason)) reasons.push("EXCEPTION_REASON_INVALID");
    if (!nonEmptyString(declaration?.rollback) || !/(revert|restore|remove|rollback)/i.test(declaration.rollback)) reasons.push("EXCEPTION_REQUIRES_ACTIONABLE_ROLLBACK");
    if (!validExceptionExpiry(declaration?.expires)) reasons.push("EXCEPTION_REQUIRES_BOUNDED_EXPIRY");
    if (!nonEmptyString(declaration?.red_evidence)) reasons.push("EXCEPTION_REQUIRES_RED_EVIDENCE");
    if (!/^tests\/[A-Za-z0-9._/-]+\.test\.[cm]?[jt]sx?::.+/.test(declaration?.red_evidence ?? "")) {
      reasons.push("EXCEPTION_REQUIRES_CAUSAL_RED_SELECTOR");
    }
    if (!/^[a-f0-9]{40}$/.test(declaration?.red_base_blob ?? "")) reasons.push("EXCEPTION_REQUIRES_RED_BASE_BLOB");
    if (!nonEmptyString(declaration?.red_observed_failure)) reasons.push("EXCEPTION_REQUIRES_OBSERVED_RED_FAILURE");
    if (!nonEmptyString(declaration?.red_command)) reasons.push("EXCEPTION_REQUIRES_RED_COMMAND");
    if (metrics.nonblank_lines.delta > 30) reasons.push("EXCEPTION_EXCEEDS_LINE_LIMIT");
    if (metrics.decision_points.delta > 2) reasons.push("EXCEPTION_EXCEEDS_DECISION_LIMIT");
    if (latestMaterialHistory(history, declaration)?.mode === "EXCEPTION") reasons.push("CONSECUTIVE_EXCEPTION_FORBIDDEN");
  }

  if (mode !== "SHRINK" && nonEmptyString(declaration?.pays_debt_id)) {
    reasons.push("DEBT_PAYMENT_REQUIRES_SHRINK");
  }

  const status = reasons.length === 0 ? "PASS" : "FAIL";
  return {
    contract: "dex.flow-engine.boundary.receipt.v1",
    status,
    mode: status === "PASS" ? mode : "FAIL",
    requested_mode: mode,
    flow_engine_changed: true,
    responsibility: declaration?.responsibility ?? null,
    owner: declaration?.owner ?? EXPECTED_OWNER,
    destination_module: declaration?.destination_module ?? null,
    consumers: declaration?.consumers ?? [],
    evidence: declaration?.evidence ?? [],
    debt: declaration?.debt ?? null,
    pays_debt_id: declaration?.pays_debt_id ?? null,
    metrics,
    reasons,
    next_required_action: status === "PASS" ? null : failureAction(),
    recoverable: true
  };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function readOptionalAt(cwd, ref, filePath) {
  try {
    return ref === "WORKTREE"
      ? readFileSync(path.join(cwd, filePath), "utf8")
      : execFileSync("git", ["show", `${ref}:${filePath}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

function safeProjectPath(filePath, prefix) {
  if (!nonEmptyString(filePath) || path.isAbsolute(filePath)) return false;
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith(`${prefix}/`) && !normalized.split("/").includes("..");
}

function importSpecifier(fromFile, toFile) {
  const from = fromFile.replace(/\\/g, "/");
  const to = toFile.replace(/\\/g, "/").replace(/\.(?:ts|tsx)$/, ".js");
  const relative = path.posix.relative(path.posix.dirname(from), to);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function evidencePath(entry) {
  if (!nonEmptyString(entry)) return null;
  const candidate = entry.split("::", 1)[0].replace(/\\/g, "/");
  return /\.(?:ts|tsx|js|mjs|cjs|md|json)$/.test(candidate) ? candidate : null;
}

function unreleasedSection(content) {
  const start = content.indexOf("## [Unreleased]");
  if (start < 0) return "";
  const next = content.indexOf("\n## [", start + 1);
  return content.slice(start, next < 0 ? content.length : next);
}

// SPT gate-integrity-hardening-2 (R7): diff de manifest limitado a selagem de
// commit. Records precisam ser os mesmos (mesma ordem, mesmos ids, resto
// identico); cada commit selado precisa apontar para o head_blob do record.
function evaluateCommitSealDiff({ cwd, baseManifest, headManifest }) {
  const reasons = [];
  let baseRecords = null;
  let headRecords = null;
  try {
    baseRecords = JSON.parse(baseManifest).records ?? null;
    headRecords = JSON.parse(headManifest).records ?? null;
  } catch {
    return { ok: false, reasons: ["COMMIT_SEAL_MANIFEST_UNREADABLE"] };
  }
  if (!Array.isArray(baseRecords) || !Array.isArray(headRecords) || baseRecords.length !== headRecords.length) {
    return { ok: false, reasons: ["COMMIT_SEAL_SHAPE_CHANGED"] };
  }
  const sealedIds = [];
  for (let index = 0; index < headRecords.length; index += 1) {
    const before = baseRecords[index];
    const after = headRecords[index];
    if (!before || !after || before.id !== after.id) {
      return { ok: false, reasons: ["COMMIT_SEAL_SHAPE_CHANGED"] };
    }
    const beforeCopy = { ...before };
    const afterCopy = { ...after };
    delete beforeCopy.commit;
    delete beforeCopy.parent_commit;
    delete afterCopy.commit;
    delete afterCopy.parent_commit;
    if (JSON.stringify(beforeCopy) !== JSON.stringify(afterCopy)) {
      reasons.push(`COMMIT_SEAL_RECORD_CHANGED:${after.id}`);
      continue;
    }
    if (before.commit === after.commit && before.parent_commit === after.parent_commit) {
      continue;
    }
    if (!nonEmptyString(after.commit)) {
      reasons.push(`COMMIT_SEAL_COMMIT_MISSING:${after.id}`);
      continue;
    }
    // Cura-4: parent ausente NÃO pula a conferência de blob — a mentira mais
    // grave (commit que não contém o blob declarado) não pode ficar mascarada.
    const blobReasons = [];
    try {
      const sealedBlob = git(["rev-parse", `${after.commit}:${TARGET_PATH}`], cwd);
      if (sealedBlob !== after.head_blob) blobReasons.push(`COMMIT_SEAL_BLOB_MISMATCH:${after.id}`);
    } catch {
      blobReasons.push(`COMMIT_SEAL_COMMIT_NOT_FOUND:${after.id}`);
    }
    reasons.push(...blobReasons);
    // Cura-4: linhagem pelo helper ÚNICO (P1 da cura-2 + selo vivo da cura-2
    // agora são a mesma fonte).
    reasons.push(...sealLineageReasons(after, before, git(["rev-list", "--parents", "-n", "1", after.commit], cwd).split(/\s+/).slice(1)));
    if (blobReasons.length > 0 || !nonEmptyString(after.parent_commit)) {
      continue;
    }
    sealedIds.push(after.id);
  }
  if (sealedIds.length === 0) reasons.push("COMMIT_SEAL_NOTHING_SEALED");
  return { ok: reasons.length === 0, reasons, sealedIds };
}

function validateBootstrapRecords({ cwd, records, manifest, headBlob }) {
  const reasons = [];
  const architecture = readFileSync(path.join(cwd, ARCHITECTURE_PATH), "utf8");
  const changelog = unreleasedSection(readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8"));
  const add = (record, reason) => reasons.push(`BOOTSTRAP_RECORD_INVALID:${record?.id ?? "unknown"}:${reason}`);
  if (manifest.contract !== "dex.flow-engine.evolution-ledger.v1" || manifest.target !== TARGET_PATH || !CAMPING_OWNERS.has(manifest.owner ?? "")) {
    reasons.push("LEDGER_BOOTSTRAP_CONTRACT_INVALID");
  }
  if (records.length === 0 || records.at(-1)?.head_blob !== headBlob) reasons.push("LEDGER_BOOTSTRAP_HEAD_MISMATCH");
  const ids = records.map((entry) => entry?.id);
  if (new Set(ids).size !== ids.length) reasons.push("LEDGER_BOOTSTRAP_DUPLICATE_ID");

  records.forEach((record, index) => {
    for (const reason of requiredDeclarationReasons(record)) add(record, reason);
    if (!/^[a-f0-9]{40}$/.test(record?.base_blob ?? "") || !/^[a-f0-9]{40}$/.test(record?.head_blob ?? "")) {
      add(record, "BLOB_REQUIRED");
      return;
    }
    let baseSource;
    let recordHeadSource;
    try {
      baseSource = git(["cat-file", "-p", record.base_blob], cwd);
      recordHeadSource = git(["cat-file", "-p", record.head_blob], cwd);
      if (!nonEmptyString(record.commit) || git(["rev-parse", `${record.commit}:${TARGET_PATH}`], cwd) !== record.head_blob) {
        add(record, "COMMIT_HEAD_BLOB_MISMATCH");
      }
      const commitLine = git(["rev-list", "--parents", "-n", "1", record.commit], cwd).split(/\s+/);
      const parents = commitLine.slice(1);
      for (const reason of sealedParentReasons(record, parents)) add(record, reason);
      const storedParent = nonEmptyString(record.parent_commit) ? record.parent_commit : null;
      // Cura-2: selectedParent e SEMPRE um sha FULL do array de pais (o prefixo
      // armazenado nunca vai cru ao rev-parse); merge com pai armazenado
      // mentiroso ja recebeu MISMATCH — REQUIRED fica reservado a ausencia.
      const selectedFull = storedParent
        ? parents.find((parent) => parentMatchesCommit([parent], storedParent)) ?? null
        : null;
      const selectedParent = parents.length === 1 ? parents[0] : selectedFull;
      if (!selectedParent && !storedParent) {
        add(record, "COMMIT_PARENT_REQUIRED");
      } else if (selectedParent && git(["rev-parse", `${selectedParent}:${TARGET_PATH}`], cwd) !== record.base_blob) {
        add(record, "COMMIT_PARENT_BASE_BLOB_MISMATCH");
      }
    } catch {
      add(record, "BLOB_OR_COMMIT_NOT_FOUND");
      return;
    }
    const replay = evaluateFlowEngineChange({
      baseSource,
      headSource: recordHeadSource,
      declaration: record,
      history: records.slice(0, index),
      flowEngineChanged: true
    });
    for (const reason of replay.reasons) add(record, `REPLAY:${reason}`);
    if (!existsSync(path.join(cwd, record.spt_path))) add(record, "SPT_NOT_FOUND");
    if (!changelog.includes(record.changelog_marker)) add(record, "CHANGELOG_MARKER_NOT_FOUND");
    if (!architecture.includes(record.architecture_marker)) add(record, "ARCHITECTURE_MARKER_NOT_FOUND");

    // Cura-2: mesma isencao do path de declaracao corrente — EXCEPTION sem
    // destination_module nao exige destino (l.900+); a assimetria reprovaria o
    // proprio record CURA se o bootstrap rodasse.
    if ((record.mode !== "EXCEPTION" || nonEmptyString(record.destination_module))
      && (!safeProjectPath(record.destination_module, "src") || record.destination_module === TARGET_PATH)) {
      add(record, "DESTINATION_MODULE_INVALID");
    } else if (nonEmptyString(record.destination_module)) {
      try {
        const destination = readFileSync(path.join(cwd, record.destination_module), "utf8");
        const expectedEdge = importSpecifier(TARGET_PATH, record.destination_module);
        if (!usedRuntimeImports(recordHeadSource).includes(expectedEdge)) add(record, "DESTINATION_EDGE_NOT_FOUND");
        if (/(?:from\s+|import\s*\(|require\s*\()["'][^"']*flow-engine(?:\.js)?["']/.test(destination)) add(record, "DESTINATION_REVERSE_IMPORT");
        for (const mappedSymbol of Object.values(record.symbol_mappings ?? {})) {
          if (nonEmptyString(mappedSymbol) && !new RegExp(`\\b${String(mappedSymbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(destination)) {
            add(record, `DESTINATION_SYMBOL_NOT_FOUND:${mappedSymbol}`);
          }
        }
      } catch {
        add(record, "DESTINATION_MODULE_NOT_FOUND");
      }
    }

    for (const consumer of record.consumers ?? []) {
      try {
        const imports = usedRuntimeImports(readFileSync(path.join(cwd, consumer), "utf8"));
        // Cura-4: EXCEPTION sem destination_module confere só o import do TARGET —
        // importSpecifier(consumer, undefined) lançava no catch e virava falso
        // PRODUCT_CONSUMER_NOT_FOUND (assimetria com a isenção de edges da cura-2).
        const specifiers = [importSpecifier(consumer, TARGET_PATH)];
        if (nonEmptyString(record.destination_module)) specifiers.push(importSpecifier(consumer, record.destination_module));
        if (!specifiers.some((specifier) => imports.includes(specifier))) {
          add(record, `PRODUCT_CONSUMER_EDGE_NOT_FOUND:${consumer}`);
        }
      } catch {
        add(record, `PRODUCT_CONSUMER_NOT_FOUND:${consumer}`);
      }
    }

    const evidence = (record.evidence ?? []).map(evidencePath).filter(Boolean);
    for (const evidenceFile of evidence) {
      if (!existsSync(path.join(cwd, evidenceFile))) add(record, `EVIDENCE_NOT_FOUND:${evidenceFile}`);
    }
    const selectors = record.evidence_selectors && typeof record.evidence_selectors === "object" ? record.evidence_selectors : {};
    const selectorValid = Object.entries(selectors).some(([evidenceFile, selector]) => {
      try {
        const titles = declaredTestTitles(readFileSync(path.join(cwd, evidenceFile), "utf8"));
        if (!evidence.includes(evidenceFile) || !nonEmptyString(selector)) return false;
        if (!titles.includes(selector)) return false;
        // Cura-3: vitest -t interpreta o seletor como regex. Cura-4: self-match
        // fecha o irmão colidente — a regex tem que casar o PRÓPRIO seletor, não
        // só um título irmão. Records legados pré-gate são isentos por
        // grandfathering DECLARADO (LEGACY_SELECTOR_EXEMPT), nunca silêncio.
        if (!LEGACY_SELECTOR_EXEMPT.has(record.id) && !selectorIsReplayable(selector, titles)) {
          add(record, `EVIDENCE_SELECTOR_REGEX_INVALID:${evidenceFile}`);
          return false;
        }
        return true;
      } catch {
        return false;
      }
    });
    if (!selectorValid) add(record, "CAUSAL_TEST_SELECTOR_REQUIRED");
  });
  return reasons;
}

function resolveComparison(cwd, args) {
  const dirty = git(["status", "--porcelain", "--", TARGET_PATH], cwd);
  const ledgerDirty = git(["status", "--porcelain", "--", args.manifest], cwd);
  if (args.base) {
    const head = args.head ?? "HEAD";
    if (dirty && head !== "WORKTREE") {
      return { base: args.base, head, source: "explicit", error: "EXPLICIT_COMPARISON_IGNORES_DIRTY_TARGET" };
    }
    return { base: args.base, head, source: "explicit" };
  }
  if (dirty) return { base: "HEAD", head: "WORKTREE", source: "worktree" };
  if (ledgerDirty) return { base: "HEAD", head: "WORKTREE", source: "ledger-worktree" };
  const envBase = process.env.FLOW_ENGINE_BASE_REF || process.env.GITHUB_BASE_SHA;
  if (envBase) return { base: envBase, head: args.head ?? "HEAD", source: "environment" };
  try {
    const head = git(["rev-parse", "HEAD"], cwd);
    const origin = git(["rev-parse", "origin/main"], cwd);
    if (head !== origin) return { base: git(["merge-base", "origin/main", "HEAD"], cwd), head: "HEAD", source: "origin-main" };
  } catch {
    // A local-only checkout is valid; without a comparison signal the gate is not applicable.
  }
  return { base: "HEAD", head: "HEAD", source: "no-change-signal" };
}

function sourceAt(cwd, ref) {
  return ref === "WORKTREE"
    ? readFileSync(path.join(cwd, TARGET_PATH), "utf8")
    : git(["show", `${ref}:${TARGET_PATH}`], cwd);
}

function blobAt(cwd, ref) {
  return ref === "WORKTREE"
    ? git(["hash-object", TARGET_PATH], cwd)
    : git(["rev-parse", `${ref}:${TARGET_PATH}`], cwd);
}

function parseArgs(argv) {
  const result = { help: false, base: null, head: null, manifest: DEFAULT_MANIFEST };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--base") result.base = argv[++index];
    else if (arg === "--head") result.head = argv[++index];
    else if (arg === "--manifest") result.manifest = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function helpText() {
  return `Validate the flow-engine camping rule.

Usage:
  node scripts/validate-flow-engine-boundary.mjs
  node scripts/validate-flow-engine-boundary.mjs --base <git-ref> [--head <git-ref|WORKTREE>]
  node scripts/validate-flow-engine-boundary.mjs --manifest <path>

Modes:
  NOT_APPLICABLE  src/flow-engine.ts is absent from the comparison diff.
  SHRINK          A named pre-existing responsibility/symbol left the facade.
  CONTAIN         New behavior lives outside; the facade gained glue only and opens payable debt.
  EXCEPTION       Bounded integrity/security/compatibility hotfix with RED, rollback and expiry.
  FAIL            The declaration or structural proof is insufficient.

Default comparison order: dirty target/ledger worktree -> FLOW_ENGINE_BASE_REF/GITHUB_BASE_SHA -> origin/main merge-base -> NOT_APPLICABLE.
Explicit refs cannot ignore a dirty target. The matching declaration lives in ${DEFAULT_MANIFEST}.
A passing changed diff appends one immutable record, proves real consumer/evidence edges and adds new architecture/changelog markers.`;
}

export function runBoundaryCli({ cwd = process.cwd(), argv = process.argv.slice(2) } = {}) {
  const args = parseArgs(argv);
  if (args.help) return { exitCode: 0, output: helpText(), json: false };
  const comparison = resolveComparison(cwd, args);
  if (comparison.error) {
    return {
      exitCode: 1,
      json: true,
      output: JSON.stringify({
        contract: "dex.flow-engine.boundary.receipt.v1",
        status: "FAIL",
        mode: "FAIL",
        flow_engine_changed: true,
        owner: EXPECTED_OWNER,
        target: TARGET_PATH,
        comparison,
        reasons: [comparison.error],
        next_required_action: failureAction(),
        recoverable: true
      }, null, 2)
    };
  }
  if (comparison.head === "WORKTREE" && !existsSync(path.join(cwd, TARGET_PATH))) {
    return {
      exitCode: 1,
      json: true,
      output: JSON.stringify({
        contract: "dex.flow-engine.boundary.receipt.v1",
        status: "FAIL",
        mode: "FAIL",
        flow_engine_changed: true,
        owner: "$refactoring-fowler-rich",
        target: TARGET_PATH,
        reasons: ["TARGET_FILE_MISSING"],
        next_required_action: failureAction(),
        recoverable: true
      }, null, 2)
    };
  }
  const baseSource = sourceAt(cwd, comparison.base);
  const headSource = sourceAt(cwd, comparison.head);
  const baseBlob = blobAt(cwd, comparison.base);
  const headBlob = blobAt(cwd, comparison.head);

  let manifest = { records: [] };
  try {
    manifest = JSON.parse(readFileSync(path.resolve(cwd, args.manifest), "utf8"));
  } catch (error) {
    if (baseSource !== headSource) {
      const receipt = evaluateFlowEngineChange({ baseSource, headSource });
      receipt.reasons.push(`MANIFEST_UNREADABLE:${error instanceof Error ? error.message : String(error)}`);
      return { exitCode: 1, output: JSON.stringify(receipt, null, 2), json: true };
    }
  }

  const records = Array.isArray(manifest.records) ? manifest.records : [];
  let declaration = records.find((entry) => entry.base_blob === baseBlob && entry.head_blob === headBlob);
  // Diff acumulado (ex.: origin-main..HEAD com varios commits locais ainda nao
  // pushed): nenhum par unico cobre a janela, mas um sufixo contiguo do ledger
  // pode conectar baseBlob ate headBlob elo a elo. Sem isso, toda janela local
  // commit->push fica vermelha sem causa no codigo.
  let chainRecords = null;
  if (!declaration && baseBlob !== headBlob) {
    const chainStart = records.findIndex((entry, index) => {
      if (entry?.base_blob !== baseBlob) return false;
      for (let link = index; link < records.length - 1; link += 1) {
        if (records[link]?.head_blob !== records[link + 1]?.base_blob) return false;
      }
      return records.at(-1)?.head_blob === headBlob;
    });
    if (chainStart >= 0) {
      chainRecords = records.slice(chainStart);
      declaration = chainRecords.at(-1);
    }
  }
  const history = declaration ? records.slice(0, records.indexOf(declaration)) : records;
  // Classe selagem retroativa (issue #11 convergencia, 2026-11-07): record com
  // commit selado ancestral do base do diff atual e HISTORIA (selou corte
  // passado), nao corte novo — nao conta para CONSECUTIVE_EXCEPTION.
  if (history.length > 0 && comparison?.base && typeof git === "function") {
    for (let index = 0; index < history.length; index += 1) {
      const entry = history[index];
      if (!entry?.commit || entry.sealed_retroactive === true) continue;
      try {
        git(["merge-base", "--is-ancestor", String(entry.commit), String(comparison.base)]);
        history[index] = { ...entry, sealed_retroactive: true };
      } catch {
        // nao ancestral: corte novo, segue material
      }
    }
  }
  const flowEngineChanged = comparison.source === "ledger-worktree" ? false : baseBlob !== headBlob;
  // Na cadeia coberta, cada janela carrega suas proprias metricas: o evaluate
  // principal aplica a declaracao do ULTIMO record sobre a janela DELE (blobs do
  // ledger), nunca sobre o diff acumulado inteiro.
  const chainHeadSource = chainRecords
    ? git(["cat-file", "-p", chainRecords.at(-1).head_blob], cwd)
    : headSource;
  const chainBaseSource = chainRecords
    ? git(["cat-file", "-p", chainRecords.at(-1).base_blob], cwd)
    : baseSource;
  const receipt = evaluateFlowEngineChange({
    baseSource: chainBaseSource,
    headSource: chainHeadSource,
    declaration,
    history,
    flowEngineChanged
  });
  Object.assign(receipt, {
    comparison,
    base_blob: baseBlob,
    head_blob: headBlob,
    target: TARGET_PATH,
    declaration_id: declaration?.id ?? null
  });
  if (chainRecords) {
    receipt.ledger_chain = {
      status: "PENDING",
      records: chainRecords.map((entry) => entry?.id ?? "unknown"),
      coverage: "diff_replay+markers+last_record_full"
    };
  }

  if (!receipt.flow_engine_changed) {
    const baseManifest = readOptionalAt(cwd, comparison.base, args.manifest);
    const headManifest = readOptionalAt(cwd, comparison.head, args.manifest);
    if (baseManifest === null && headManifest !== null) {
      const bootstrapReasons = validateBootstrapRecords({ cwd, records, manifest, headBlob });
      receipt.reasons.push(...bootstrapReasons);
      receipt.ledger_bootstrap = {
        status: bootstrapReasons.length === 0 ? "PASS" : "FAIL",
        records_replayed: records.length,
        sealed_after_commit: true
      };
    } else if (baseManifest !== headManifest) {
      // SPT gate-integrity-hardening-2 (R7): selar `commit` so e possivel
      // DEPOIS do commit existir (sha nao existe antes). Um diff de ledger que
      // APENAS adiciona/atualiza `commit`/`parent_commit` em records existentes
      // — com blob do commit conferindo contra o head_blob do proprio record —
      // e selagem pos-commit legitima, nao mutacao silenciosa do ledger.
      const seal = evaluateCommitSealDiff({ cwd, baseManifest, headManifest });
      if (seal.ok) {
        receipt.ledger_commit_seal = {
          status: "PASS",
          sealed_records: seal.sealedIds,
          sealed_after_commit: true
        };
      } else {
        receipt.reasons.push("LEDGER_CHANGE_REQUIRES_TARGET_CHANGE", ...seal.reasons);
      }
    }
  }

  // Cura-4 (B2): record NOVO que nasce com commit no diff tem a linhagem
  // conferida na hora, COM ou SEM base manifest — não existe "selo de
  // nascimento" sem conferência (o LEDGER_PREFIX só cobre records pré-existentes).
  if (declaration?.commit) {
    try {
      receipt.reasons.push(...sealLineageReasons(declaration, null,
        git(["rev-list", "--parents", "-n", "1", declaration.commit], cwd).split(/\s+/).slice(1)));
    } catch {
      receipt.reasons.push(`LEDGER_PREFIX_COMMIT_SEAL_MISMATCH:${declaration.id}`);
    }
  }

  if (receipt.flow_engine_changed && !declaration) receipt.reasons.push("MATCHING_DECLARATION_REQUIRED");
  if (receipt.flow_engine_changed && declaration) {
    if (manifest.contract !== "dex.flow-engine.evolution-ledger.v1" || manifest.target !== TARGET_PATH || !CAMPING_OWNERS.has(manifest.owner ?? "")) {
      receipt.reasons.push("LEDGER_CONTRACT_INVALID");
    }
    const duplicateIds = records.filter((entry) => entry.id === declaration.id).length;
    if (duplicateIds !== 1) receipt.reasons.push("LEDGER_RECORD_ID_NOT_UNIQUE");

    const baseManifestText = readOptionalAt(cwd, comparison.base, args.manifest);
    if (baseManifestText) {
      try {
        const baseRecords = JSON.parse(baseManifestText).records ?? [];
        // SPT gate-integrity-hardening-2 (R7): o prefixo e imutavel EXCETO pela
        // selagem pos-commit de `commit`/`parent_commit` (o sha so existe
        // depois do commit). Selagem mentirosa (blob do commit != head_blob do
        // record) continua reprovando.
        const stripSeal = (record) => {
          const copy = { ...record };
          delete copy.commit;
          delete copy.parent_commit;
          return copy;
        };
        const preservedPrefix = baseRecords.every((before, index) => {
          const after = records[index];
          return Boolean(after) && after.id === before.id
            && JSON.stringify(stripSeal(after)) === JSON.stringify(stripSeal(before));
        });
        if (!preservedPrefix) receipt.reasons.push("LEDGER_HISTORY_MUTATED");
        // Cura-4 (P1-1 adversarial cura-3, motor-laundering): a conferência de
        // selo dispara quando o record ENTRA ou MUDA no diff — não só quando o
        // commit muda. Record selado inalterado no diff é a selagem legada
        // aceita no seu tempo (grandfathering por imutabilidade); qualquer
        // mutação (inclusive remover parent com commit inalterado) é conferida
        // contra o git real pelo helper ÚNICO.
        for (let index = 0; index < baseRecords.length; index += 1) {
          const after = records[index];
          const before = baseRecords[index];
          const recordChanged = JSON.stringify(after) !== JSON.stringify(before);
          if (after.commit && recordChanged) {
            try {
              if (git(["rev-parse", `${after.commit}:${TARGET_PATH}`], cwd) !== after.head_blob) {
                receipt.reasons.push(`LEDGER_PREFIX_COMMIT_SEAL_MISMATCH:${after.id}`);
              }
              receipt.reasons.push(...sealLineageReasons(after, before,
                git(["rev-list", "--parents", "-n", "1", after.commit], cwd).split(/\s+/).slice(1)));
            } catch {
              receipt.reasons.push(`LEDGER_PREFIX_COMMIT_SEAL_MISMATCH:${after.id}`);
            }
          }
        }
        const appendedCount = chainRecords?.length ?? 1;
        if (records.length !== baseRecords.length + appendedCount || records.at(-1) !== declaration) {
          receipt.reasons.push("LEDGER_REQUIRES_APPENDED_RECORDS_COVERING_DIFF");
        }
        const previousHeadBlob = baseRecords.at(-1)?.head_blob;
        if (previousHeadBlob && previousHeadBlob !== baseBlob) receipt.reasons.push("LEDGER_TARGET_CHAIN_BROKEN");
      } catch {
        receipt.reasons.push("BASE_LEDGER_UNREADABLE");
      }
    }

    const governedAppend = Boolean(baseManifestText);
    const baseChangelog = readOptionalAt(cwd, comparison.base, "CHANGELOG.md") ?? "";
    const headChangelog = governedAppend
      ? (readOptionalAt(cwd, comparison.head, "CHANGELOG.md") ?? "")
      : readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
    const unreleased = unreleasedSection(headChangelog);
    if (!unreleased.includes(declaration.changelog_marker)) receipt.reasons.push("CHANGELOG_MARKER_REQUIRED_IN_UNRELEASED");
    if (governedAppend && baseChangelog.includes(declaration.changelog_marker)) receipt.reasons.push("CHANGELOG_MARKER_MUST_BE_NEW");

    const baseArchitecture = readOptionalAt(cwd, comparison.base, ARCHITECTURE_PATH) ?? "";
    const headArchitecture = governedAppend
      ? (readOptionalAt(cwd, comparison.head, ARCHITECTURE_PATH) ?? "")
      : readFileSync(path.join(cwd, ARCHITECTURE_PATH), "utf8");
    if (!headArchitecture.includes(declaration.architecture_marker)) receipt.reasons.push("ARCHITECTURE_MARKER_REQUIRED");
    if (governedAppend && baseArchitecture.includes(declaration.architecture_marker)) receipt.reasons.push("ARCHITECTURE_MARKER_MUST_BE_NEW");

    if (chainRecords && chainRecords.length > 1) {
      for (const record of chainRecords) {
        const replay = evaluateFlowEngineChange({
          baseSource: git(["cat-file", "-p", record.base_blob], cwd),
          headSource: git(["cat-file", "-p", record.head_blob], cwd),
          declaration: record,
          history: records.slice(0, records.indexOf(record)),
          flowEngineChanged: true
        });
        for (const reason of replay.reasons) receipt.reasons.push(`CHAIN_REPLAY:${record.id}:${reason}`);
        if (!unreleased.includes(record.changelog_marker)) {
          receipt.reasons.push(`CHAIN_CHANGELOG_MARKER_REQUIRED:${record.changelog_marker}`);
        }
        if (!headArchitecture.includes(record.architecture_marker)) {
          receipt.reasons.push(`CHAIN_ARCHITECTURE_MARKER_REQUIRED:${record.architecture_marker}`);
        }
      }
      receipt.ledger_chain.status = receipt.reasons.length === 0 ? "PASS" : "FAIL";
    } else if (receipt.ledger_chain) {
      receipt.ledger_chain.status = receipt.reasons.length === 0 ? "PASS" : "FAIL";
    }

    if (
      (declaration.mode !== "EXCEPTION" || nonEmptyString(declaration.destination_module))
      && (!safeProjectPath(declaration.destination_module, "src") || declaration.destination_module === TARGET_PATH)
    ) {
      receipt.reasons.push("DESTINATION_MODULE_INVALID");
    }
    if (nonEmptyString(declaration.destination_module)) {
      const targetImport = importSpecifier(TARGET_PATH, declaration.destination_module);
      if (!usedRuntimeImports(headSource).includes(targetImport)) {
        receipt.reasons.push(`DESTINATION_EDGE_NOT_FOUND:${TARGET_PATH}->${targetImport}`);
      }
      try {
        const destination = readFileSync(path.join(cwd, declaration.destination_module), "utf8");
        if (/(?:from\s+|import\s*\(|require\s*\()["'][^"']*flow-engine(?:\.js)?["']/.test(destination)) receipt.reasons.push("DESTINATION_REVERSE_IMPORTS_FLOW_ENGINE");
        for (const targetSymbol of Object.values(declaration.symbol_mappings ?? {})) {
          if (nonEmptyString(targetSymbol) && !new RegExp(`\\b${String(targetSymbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(destination)) {
            receipt.reasons.push(`DESTINATION_SYMBOL_NOT_FOUND:${targetSymbol}`);
          }
        }
      } catch {
        receipt.reasons.push("DESTINATION_MODULE_NOT_FOUND");
      }
    }

    const evidenceEntries = [
      ...(declaration.evidence ?? []),
      ...(declaration.behavior_preserved_by ?? []),
      ...(nonEmptyString(declaration.red_evidence) ? [declaration.red_evidence] : [])
    ];
    const evidencePaths = evidenceEntries.map(evidencePath).filter(Boolean);
    if (!evidencePaths.some((entry) => entry.startsWith("tests/"))) receipt.reasons.push("CAUSAL_TEST_EVIDENCE_REQUIRED");
    for (const evidence of evidencePaths) {
      if (!safeProjectPath(evidence, evidence.startsWith("tests/") ? "tests" : evidence.split("/", 1)[0]) || !existsSync(path.join(cwd, evidence))) {
        receipt.reasons.push(`EVIDENCE_NOT_FOUND:${evidence}`);
      }
    }
    const evidenceSelectors = declaration.evidence_selectors && typeof declaration.evidence_selectors === "object"
      ? declaration.evidence_selectors
      : {};
    const validSelectors = [];
    for (const [evidence, selector] of Object.entries(evidenceSelectors)) {
      if (!evidencePaths.includes(evidence) || !nonEmptyString(selector)) continue;
      try {
        const titles = declaredTestTitles(readFileSync(path.join(cwd, evidence), "utf8"));
        if (!titles.includes(selector)) {
          receipt.reasons.push(`EVIDENCE_SELECTOR_NOT_FOUND:${evidence}::${selector}`);
        } else if (!selectorIsReplayable(selector, titles)) {
          // Cura-3/4: mesma classe do gate de record + self-match (irmão
          // colidente não prova o teste pretendido).
          receipt.reasons.push(`EVIDENCE_SELECTOR_REGEX_INVALID:${evidence}::${selector}`);
        } else {
          validSelectors.push(evidence);
        }
      } catch {
        receipt.reasons.push(`EVIDENCE_NOT_FOUND:${evidence}`);
      }
    }
    if (!validSelectors.some((entry) => entry.startsWith("tests/") && /\.test\.[cm]?[jt]sx?$/.test(entry))) {
      receipt.reasons.push("CAUSAL_TEST_SELECTOR_REQUIRED");
    }
    if (nonEmptyString(declaration.red_evidence)) {
      const [redPath, redSelector] = declaration.red_evidence.split("::", 2);
      if (nonEmptyString(redPath) && nonEmptyString(redSelector)) {
        try {
          const redTitles = declaredTestTitles(readFileSync(path.join(cwd, redPath), "utf8"));
          if (!redTitles.includes(redSelector)) {
            receipt.reasons.push(`RED_SELECTOR_NOT_FOUND:${redPath}::${redSelector}`);
          } else if (!selectorIsReplayable(redSelector, redTitles)) {
            // Cura-3/4: mesma classe do gate de record + self-match aplicada ao
            // RED — o red_command referencia este seletor no replay.
            receipt.reasons.push(`RED_SELECTOR_REGEX_INVALID:${redPath}::${redSelector}`);
          }
        } catch {
          receipt.reasons.push(`EVIDENCE_NOT_FOUND:${redPath}`);
        }
      }
      if (declaration.mode === "EXCEPTION") {
        // SPT gate-integrity-hardening-2 (R7): o RED e conferido contra a base
        // do PROPRIO registro — em cadeia cumulativa o ultimo registro nao
        // comeca na base da janela, e exigir isso reprovava EXCEPTION valido.
        if (declaration.red_base_blob !== declaration.base_blob) receipt.reasons.push("EXCEPTION_RED_BASE_BLOB_MISMATCH");
        if (!declaration.red_command?.includes(redPath) || !declaration.red_command?.includes(redSelector)) {
          receipt.reasons.push("EXCEPTION_RED_COMMAND_MISMATCH");
        }
      }
    }
    for (const consumer of declaration.consumers ?? []) {
      if (!safeProjectPath(consumer, "src") || consumer === declaration.destination_module) {
        receipt.reasons.push(`PRODUCT_CONSUMER_INVALID:${consumer}`);
        continue;
      }
      try {
        const consumerSource = readFileSync(path.join(cwd, consumer), "utf8");
        const consumerImports = usedRuntimeImports(consumerSource);
        const destinationImport = importSpecifier(consumer, declaration.destination_module ?? TARGET_PATH);
        const facadeImport = importSpecifier(consumer, TARGET_PATH);
        if (!consumerImports.includes(destinationImport) && !consumerImports.includes(facadeImport)) {
          receipt.reasons.push(`PRODUCT_CONSUMER_EDGE_NOT_FOUND:${consumer}->${facadeImport}|${destinationImport}`);
        }
      } catch {
        receipt.reasons.push(`PRODUCT_CONSUMER_NOT_FOUND:${consumer}`);
      }
    }
  }
  if (receipt.reasons.length > 0) {
    receipt.status = "FAIL";
    receipt.mode = "FAIL";
    receipt.next_required_action ??= failureAction();
  }
  return { exitCode: receipt.status === "FAIL" ? 1 : 0, output: JSON.stringify(receipt, null, 2), json: true };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = runBoundaryCli();
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
