#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TARGET_PATH = "src/flow-engine.ts";
const DEFAULT_MANIFEST = "docs/architecture/flow-engine-evolution.json";
const ARCHITECTURE_PATH = "docs/architecture/FLOW_ENGINE_EVOLUTION.md";
const EXPECTED_OWNER = "$refactoring-fowler-rich";
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
  if (declaration?.owner !== EXPECTED_OWNER) reasons.push("DECLARATION_OWNER_INVALID");
  if (!/^\.agents\/PLAN-TASKS\/[A-Za-z0-9._-]+\.md$/.test(declaration?.spt_path ?? "")) {
    reasons.push("DECLARATION_SPT_PATH_INVALID");
  }
  if (!nonEmptyStrings(declaration?.consumers)) reasons.push("DECLARATION_FIELD_REQUIRED:consumers");
  if (!nonEmptyStrings(declaration?.evidence)) reasons.push("DECLARATION_FIELD_REQUIRED:evidence");
  if (!ALLOWED_MODES.has(declaration?.mode)) reasons.push("DECLARATION_MODE_INVALID");
  return reasons;
}

function latestMaterialHistory(history) {
  return [...(history ?? [])].reverse().find((entry) => entry && entry.mode !== "NOT_APPLICABLE");
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
    owner: "$refactoring-fowler-rich",
    action: "Move policy/validation/projection outside FlowEngine, pay the open debt with SHRINK, or document a bounded EXCEPTION with causal RED. Update the architecture ledger and CHANGELOG, then rerun npm run check:flow-engine.",
    when: "before review or commit of the diff that touches src/flow-engine.ts"
  };
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
      || declaration.debt.owner !== EXPECTED_OWNER
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
    if (latestMaterialHistory(history)?.mode === "EXCEPTION") reasons.push("CONSECUTIVE_EXCEPTION_FORBIDDEN");
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
    owner: declaration?.owner ?? "$refactoring-fowler-rich",
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

function validateBootstrapRecords({ cwd, records, manifest, headBlob }) {
  const reasons = [];
  const architecture = readFileSync(path.join(cwd, ARCHITECTURE_PATH), "utf8");
  const changelog = unreleasedSection(readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8"));
  const add = (record, reason) => reasons.push(`BOOTSTRAP_RECORD_INVALID:${record?.id ?? "unknown"}:${reason}`);
  if (manifest.contract !== "dex.flow-engine.evolution-ledger.v1" || manifest.target !== TARGET_PATH || manifest.owner !== EXPECTED_OWNER) {
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
      const selectedParent = parents.length === 1 ? parents[0] : record.parent_commit;
      if (!selectedParent || !parents.includes(selectedParent)) {
        add(record, "COMMIT_PARENT_REQUIRED");
      } else if (git(["rev-parse", `${selectedParent}:${TARGET_PATH}`], cwd) !== record.base_blob) {
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

    if (!safeProjectPath(record.destination_module, "src") || record.destination_module === TARGET_PATH) {
      add(record, "DESTINATION_MODULE_INVALID");
    } else {
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
        if (!imports.includes(importSpecifier(consumer, TARGET_PATH)) && !imports.includes(importSpecifier(consumer, record.destination_module))) {
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
        return evidence.includes(evidenceFile)
          && nonEmptyString(selector)
          && declaredTestTitles(readFileSync(path.join(cwd, evidenceFile), "utf8")).includes(selector);
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
  const declaration = records.find((entry) => entry.base_blob === baseBlob && entry.head_blob === headBlob);
  const history = declaration ? records.slice(0, records.indexOf(declaration)) : records;
  const flowEngineChanged = comparison.source === "ledger-worktree" ? false : baseBlob !== headBlob;
  const receipt = evaluateFlowEngineChange({ baseSource, headSource, declaration, history, flowEngineChanged });
  Object.assign(receipt, {
    comparison,
    base_blob: baseBlob,
    head_blob: headBlob,
    target: TARGET_PATH,
    declaration_id: declaration?.id ?? null
  });

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
      receipt.reasons.push("LEDGER_CHANGE_REQUIRES_TARGET_CHANGE");
    }
  }

  if (receipt.flow_engine_changed && !declaration) receipt.reasons.push("MATCHING_DECLARATION_REQUIRED");
  if (receipt.flow_engine_changed && declaration) {
    if (manifest.contract !== "dex.flow-engine.evolution-ledger.v1" || manifest.target !== TARGET_PATH || manifest.owner !== EXPECTED_OWNER) {
      receipt.reasons.push("LEDGER_CONTRACT_INVALID");
    }
    const duplicateIds = records.filter((entry) => entry.id === declaration.id).length;
    if (duplicateIds !== 1) receipt.reasons.push("LEDGER_RECORD_ID_NOT_UNIQUE");

    const baseManifestText = readOptionalAt(cwd, comparison.base, args.manifest);
    if (baseManifestText) {
      try {
        const baseRecords = JSON.parse(baseManifestText).records ?? [];
        const preservedPrefix = JSON.stringify(records.slice(0, baseRecords.length)) === JSON.stringify(baseRecords);
        if (!preservedPrefix) receipt.reasons.push("LEDGER_HISTORY_MUTATED");
        if (records.length !== baseRecords.length + 1 || records.at(-1) !== declaration) {
          receipt.reasons.push("LEDGER_REQUIRES_SINGLE_APPENDED_RECORD");
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
        if (declaredTestTitles(readFileSync(path.join(cwd, evidence), "utf8")).includes(selector)) validSelectors.push(evidence);
        else receipt.reasons.push(`EVIDENCE_SELECTOR_NOT_FOUND:${evidence}::${selector}`);
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
          if (!declaredTestTitles(readFileSync(path.join(cwd, redPath), "utf8")).includes(redSelector)) {
            receipt.reasons.push(`RED_SELECTOR_NOT_FOUND:${redPath}::${redSelector}`);
          }
        } catch {
          receipt.reasons.push(`EVIDENCE_NOT_FOUND:${redPath}`);
        }
      }
      if (declaration.mode === "EXCEPTION") {
        if (declaration.red_base_blob !== baseBlob) receipt.reasons.push("EXCEPTION_RED_BASE_BLOB_MISMATCH");
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
