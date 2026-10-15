#!/usr/bin/env node
// Auditoria do contrato de envelope de erro (PPIRTV-ERRO-QUE-ENSINA-ENVELOPE).
// Report-first: imprime codigos_sem_next_required_action=N. Virar gate de CI
// e decisao do dono (anti-autossabotagem P10) — use --strict apenas para
// evidencia pontal (exit 1 quando N>0).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const contractPath = path.join(repoRoot, "docs", "contracts", "MCP_TOOL_ERROR_ENVELOPE_CONTRACT.md");
const envelopePath = path.join(repoRoot, "src", "error-envelope.ts");
const serverPath = path.join(repoRoot, "src", "server.ts");

const strict = process.argv.includes("--strict");

function fail(message) {
  console.error(`audit-error-envelope: ${message}`);
  process.exit(2);
}

if (!existsSync(contractPath)) fail("contrato MCP_TOOL_ERROR_ENVELOPE_CONTRACT.md ausente");
if (!existsSync(envelopePath)) fail("src/error-envelope.ts ausente");

const contract = readFileSync(contractPath, "utf8");
const envelope = readFileSync(envelopePath, "utf8");
const server = readFileSync(serverPath, "utf8");

// Familias da secao B do contrato: DEVEM ter rota no envelope (tabela
// UNBLOCK_RULES) ou branch dedicada no classifyToolError do server.
const requiredFamilies = [
  "MEETING_LOCKED", "MEETING_LOCK_INVALID", "MEETING_LOCK_IDENTITY_CHANGED",
  "MEETING_LOCK_TIMEOUT", "MEETING_STALE_LOCK_IDENTITY_CHANGED",
  "MEMORY_CANDIDATES_NOT_MINED", "MEMORY_CANDIDATE_IDENTITY_CONFLICT",
  "MEMORY_CANDIDATE_IDENTITY_DUPLICATE", "MEMORY_CANDIDATE_IDENTITY_REQUIRED",
  "MEMORY_CANDIDATE_PROMOTION_DESTINATION_CONFLICT",
  "MEMORY_CANDIDATE_PROMOTION_FIELDS_NOT_ALLOWED",
  "MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED",
  "MEMORY_CANDIDATE_PROMOTION_OWNER_NOT_ALLOWED",
  "MEMORY_CANDIDATE_PROMOTION_TAG_INVALID",
  "MEMORY_CANDIDATE_PROMOTION_THEME_NOT_ALLOWED",
  "GOAL_IDEMPOTENCY_DUPLICATE_BINDINGS", "GOAL_LEGACY_FLOW_OBJECTIVE_MISMATCH",
  "GOAL_LEGACY_FLOW_VERDICTS_PRESENT",
  "GOAL_TERMINAL_FLOW_UNBOUND", "GOAL_WORKSPACE_STORE_MISMATCH",
  "OFFICIAL_GOAL_REQUIRES_GOAL_VERDICT",
  "PROGRESS_COMPLETED_INCOMPLETE", "PROGRESS_CURRENT_INVALID", "PROGRESS_TOTAL_INVALID",
  "REVIEW_SNAPSHOT_FILE_REQUIRED", "REVIEW_SNAPSHOT_FINGERPRINT_REQUIRED",
  "REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH",
  "REVIEW_SNAPSHOT_OUTSIDE_WORKSPACE", "REVIEW_SNAPSHOT_SENSITIVE_PATH",
  "REVIEW_SNAPSHOT_DECLARED_DELETION_STILL_EXISTS",
  "RECALL_CONSUMPTION_WITHOUT_RECALL",
  "FLOW_IMMUTABLE_AFTER_COMPLETION", "DELETED_FILES_NOT_CHANGED"
];

// Branches dedicadas do classifyToolError (fontes literais dos regexes).
const serverBranchPatterns = [
  "MEETING_(?:LOCKED|LOCK_TIMEOUT|LOCK_INVALID|LOCK_IDENTITY_CHANGED|STALE_LOCK_IDENTITY_CHANGED)",
  "MEETING_NOT_CLOSED",
  "MEETING_ALREADY_CLOSED",
  "MEETING_BLOCKER_NOT_OWNED",
  "MEMORY_MINING_BLOCKED_VERDICT",
  "MEMORY_MINING_INPUT_INVALID",
  "SPT_V3_TRACEABILITY_MISSING",
  "SPT_V3_CRITERION_COVERAGE_REQUIRED",
  "SPT_V3_EVIDENCE_INVALID",
  "SPT_V3_EVIDENCE_STALE",
  "SPT_V2_EXECUTION_MIGRATION_REQUIRED",
  "REVIEW_ATTESTATION_CLAIMS_REQUIRED",
  "PROGRESS_AFTER_TERMINAL",
  "GOAL_BINDING_MISMATCH",
  "PPIRTV_FISCAL_BLOCKED"
];

const patternSources = [
  ...[...envelope.matchAll(/pattern: \/([^\n]+?)\/[a-z]*/g)].map((match) => match[1]),
  ...serverBranchPatterns
];

function expandPattern(source) {
  const grouped = /^([A-Z_]+)\(\?:([A-Z_|]+)\)$/.exec(source);
  if (grouped) {
    return grouped[2].split("|").map((alternative) => `${grouped[1]}${alternative}`);
  }
  return source.split("|");
}

const routedCodes = new Set(patternSources.flatMap(expandPattern));
const missing = requiredFamilies.filter((family) => !routedCodes.has(family));

const report = {
  schema: "ppirtv.error-envelope.audit.v1",
  contract: "docs/contracts/MCP_TOOL_ERROR_ENVELOPE_CONTRACT.md",
  required_families: requiredFamilies.length,
  codigos_sem_next_required_action: missing.length,
  missing,
  read_only: true,
  gate: strict ? "strict" : "report"
};

console.log(JSON.stringify(report, null, 2));
if (strict && missing.length > 0) process.exit(1);
