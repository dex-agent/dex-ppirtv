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

// ---- Gate de sequencia (fase 2A): sequencia ENSINADA x schema VIVO ----
// Duas testemunhas independentes: os steps saem das funcoes reais de
// dist/error-envelope.js; os schemas saem do tools/list do servidor real.
async function sequenceGate() {
  const { pathToFileURL } = await import("node:url");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport, getDefaultEnvironment } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const envelopeModule = await import(pathToFileURL(path.join(repoRoot, "dist", "error-envelope.js")).href);
  const client = new Client({ name: "audit-sequence-gate", version: "1.0.0" });
  const userProfile = process.env.USERPROFILE ?? process.env.HOME;
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "dist", "index.js")],
    cwd: repoRoot,
    env: {
      ...getDefaultEnvironment(),
      PPIRTV_HOME: path.join(repoRoot, ".ppirtv"),
      PPIRTV_WORKSPACE: repoRoot,
      PPIRTV_PRINCIPLES_PATH: path.join(userProfile, ".agents", "memories", "principles", "operational-contract.json")
    }
  }));
  const listed = await client.listTools();
  const schemasByTool = {};
  let stepsValidated = 0;
  const sequenceErrors = [];
  const branches = [
    "PPIRTV_FISCAL_BLOCKED: attempt_regress_count, attempts_insufficient_before_positive_verdict; attempt_count=0, regress_count=0, max=3, meetings=0; required_cooperation=",
    "PPIRTV_FISCAL_BLOCKED: attempt_regress_count, attempt_regress_limit_reached; attempt_count=0, regress_count=4, max=3, meetings=2; required_cooperation=",
    "PPIRTV_FISCAL_BLOCKED: required_cooperation, review_required; attempt_count=0, regress_count=0, max=3, meetings=1; required_cooperation=chato|questionador"
  ];
  try {
    for (const tool of listed.tools ?? []) {
      schemasByTool[tool.name] = {
        required: tool.inputSchema?.required ?? [],
        properties: tool.inputSchema?.properties ?? {}
      };
    }
    for (const branch of branches) {
      const action = envelopeModule.fiscalBlockedAction(branch, "flow_audit_sequence_probe");
      for (const step of action.required_tool_sequence ?? []) {
        if (!step.args) continue;
        stepsValidated += 1;
        const errors = envelopeModule.validateSequenceSteps([step], schemasByTool);
        for (const error of errors) sequenceErrors.push({ branch: branch.slice(0, 60), ...error });
      }
    }
  } finally {
    await client.close();
  }
  return { stepsValidated, sequenceErrors };
}

const sequence = await sequenceGate();

const report = {
  schema: "ppirtv.error-envelope.audit.v1",
  contract: "docs/contracts/MCP_TOOL_ERROR_ENVELOPE_CONTRACT.md",
  required_families: requiredFamilies.length,
  codigos_sem_next_required_action: missing.length,
  missing,
  steps_validados_contra_schema_vivo: sequence.stepsValidated,
  sequencias_invalidas: sequence.sequenceErrors.length,
  sequence_errors: sequence.sequenceErrors,
  read_only: true,
  gate: strict ? "strict" : "report"
};

console.log(JSON.stringify(report, null, 2));
if (strict && (missing.length > 0 || sequence.sequenceErrors.length > 0)) process.exit(1);
