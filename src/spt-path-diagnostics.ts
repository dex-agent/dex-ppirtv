import type { SptPathDiagnostic, SptPathOwner } from "./domain.js";

type ValidationDiagnosticInput = {
  checks: Record<string, boolean>;
  contractErrors: string[];
};

export class SptPathContractError extends Error {
  readonly diagnostic: SptPathDiagnostic;

  constructor(diagnostic: SptPathDiagnostic, message?: string) {
    super(message ?? `${diagnostic.code}: ${diagnostic.reason}`);
    this.name = "SptPathContractError";
    this.diagnostic = diagnostic;
  }
}

export function validationSptPathDiagnostic(input: ValidationDiagnosticInput): SptPathDiagnostic | null {
  const { checks } = input;
  if (!checks.workspace_absolute) {
    return diagnostic(
      "SPT_WORKSPACE_NOT_ABSOLUTE",
      "executor_orchestrator",
      "workspace",
      "The request workspace must be an absolute path.",
      "runtime_probe",
      "Confirm the active runtime project_root and resend an absolute workspace."
    );
  }
  if (!checks.workspace_exists || !checks.workspace_is_directory) {
    return diagnostic(
      "SPT_WORKSPACE_NOT_FOUND",
      "executor_orchestrator",
      "workspace",
      "The request workspace does not exist or is not a directory.",
      "runtime_probe",
      "Connect to the intended project runtime and resend its project_root."
    );
  }
  if (!checks.spt_path_not_sensitive) {
    return diagnostic(
      "SPT_PATH_SENSITIVE",
      "executor_orchestrator",
      "spt_path",
      "The supplied path is in a sensitive location and cannot be read.",
      "spt_validate",
      "Move or select the public canonical SPT without exposing sensitive data."
    );
  }
  if (!checks.spt_inside_workspace) {
    return diagnostic(
      "SPT_PATH_OUTSIDE_WORKSPACE",
      "executor_orchestrator",
      "spt_path",
      "The supplied SPT path is outside the request workspace.",
      "spt_validate",
      "Resend the path from the same workspace reported by runtime_probe."
    );
  }
  if (!checks.spt_under_plan_tasks) {
    return diagnostic(
      "SPT_PATH_OUTSIDE_PLAN_TASKS",
      "sprinter",
      "spt_path",
      "The SPT exists outside the canonical .agents/PLAN-TASKS directory.",
      "spt_validate",
      "The sprinter/document owner must create or move the SPT into .agents/PLAN-TASKS; then the executor must validate it again."
    );
  }
  if (!checks.spt_exists) {
    return diagnostic(
      "SPT_PATH_NOT_FOUND",
      "executor_orchestrator",
      "spt_path",
      "No file exists at the supplied canonical SPT path.",
      "spt_validate",
      "Confirm the path produced by sprinter and resend it; if the artifact is absent, route creation to sprinter."
    );
  }
  if (!checks.spt_is_file) {
    return diagnostic(
      "SPT_PATH_NOT_FILE",
      "executor_orchestrator",
      "spt_path",
      "The supplied SPT path does not identify a regular file.",
      "spt_validate",
      "Resend the exact SPT file path produced by sprinter."
    );
  }
  if (!checks.spt_workspace_matches) {
    return diagnostic(
      "SPT_CONTRACT_WORKSPACE_MISMATCH",
      "sprinter",
      "workspace",
      "The SPT contract workspace differs from the request workspace.",
      "spt_validate",
      "The sprinter/document owner must correct the SPT workspace; then the executor must validate it again."
    );
  }
  if (!checks.spt_objective_matches) {
    return diagnostic(
      "SPT_CONTRACT_OBJECTIVE_MISMATCH",
      "sprinter",
      "spt_path",
      "The SPT objective differs from the goal_start request.",
      "spt_validate",
      "The sprinter/document owner must reconcile the literal objective; then the executor must validate it again."
    );
  }
  if (
    !checks.spt_frontmatter_present
    || !checks.spt_frontmatter_closed
    || !checks.spt_yaml_valid
    || !checks.spt_schema_valid
    || !checks.spt_semantics_valid
    || input.contractErrors.length > 0
  ) {
    return diagnostic(
      "SPT_CONTRACT_INVALID",
      "sprinter",
      "spt_path",
      "The SPT document does not satisfy the canonical contract.",
      "spt_validate",
      "The sprinter/document owner must correct the reported contract fields; then the executor must validate it again."
    );
  }
  return null;
}

export function runtimeWorkspaceMismatchDiagnostic(): SptPathDiagnostic {
  return diagnostic(
    "GOAL_WORKSPACE_STORE_MISMATCH",
    "executor_orchestrator",
    "workspace",
    "The goal_start workspace differs from the connected runtime project_root.",
    "runtime_probe",
    "Reconnect to the intended project runtime or resend the request with that runtime project_root before goal_start."
  );
}

export function missingValidationDiagnostic(): SptPathDiagnostic {
  return diagnostic(
    "SPT_VALIDATION_DIAGNOSTIC_MISSING",
    "dex_ppirtv",
    "spt_path",
    "The validator rejected the SPT without classifying the failed field.",
    "spt_validate",
    "Treat this as an internal validator defect, preserve the failed receipt, and repair the classification before retrying.",
    false
  );
}

export function traceSptPathDiagnostic(code: string): SptPathDiagnostic | null {
  if (code.startsWith("unreadable_flow_files:")) {
    code = "unreadable_flow_files";
  }
  switch (code) {
    case "goal_binding_absent":
      return diagnostic("GOAL_BINDING_ABSENT", "executor_orchestrator", "goal_binding.envelope.spt_path", "The selected flow is legacy/advisory and has no official GOAL binding.", "goal_start", "If official execution is intended, validate the SPT and call goal_start; otherwise keep the advisory flow unbound.");
    case "workspace_drift":
      return diagnostic("GOAL_BINDING_WORKSPACE_DRIFT", "executor_orchestrator", "workspace", "The persisted binding workspace differs from the active runtime project_root.", "runtime_probe", "Confirm the intended runtime; if it is correct, route the persisted binding defect to dex_ppirtv without rewriting history.");
    case "unreadable_flow_files":
      return diagnostic("PPIRTV_TRACE_FLOW_UNREADABLE", "dex_ppirtv", "goal_binding.envelope.spt_path", "One or more flow files are unreadable, so historical discovery is incomplete.", "ppirtv_trace", "Repair the internal flow readability defect and repeat the trace; do not infer that history is absent.", false);
    case "selector_path_outside_workspace":
      return diagnostic("SPT_PATH_OUTSIDE_WORKSPACE", "executor_orchestrator", "spt_path", "The trace selector is outside the active runtime workspace.", "runtime_probe", "Confirm the intended runtime and resend an SPT path from that project.");
    case "spt_path_outside_plan_tasks":
      return diagnostic("SPT_PATH_OUTSIDE_PLAN_TASKS", "sprinter", "spt_path", "The trace selector is outside .agents/PLAN-TASKS.", "spt_validate", "Route the document to sprinter for canonical placement, then validate and retry the trace.");
    case "spt_path_missing":
      return diagnostic("SPT_PATH_NOT_FOUND", "executor_orchestrator", "spt_path", "The selected SPT file does not exist.", "spt_validate", "Confirm the path produced by sprinter and validate it before retrying the trace.");
    case "spt_valid_without_goal_binding":
      return diagnostic("SPT_VALID_WITHOUT_GOAL_BINDING", "executor_orchestrator", "spt_path", "The SPT is valid but no official goal binding was found.", "goal_start", "Call goal_start with the same validated canonical spt_path; do not rewrite historical flows.");
    case "spt_workspace_mismatch_without_goal_binding":
      return diagnostic("SPT_CONTRACT_WORKSPACE_MISMATCH", "sprinter", "workspace", "The unbound SPT declares a different workspace.", "spt_validate", "Route the SPT to sprinter for correction, validate it, and only then call goal_start.");
    case "spt_binding_indeterminate_due_to_unreadable_flows":
      return diagnostic("SPT_BINDING_DISCOVERY_INCOMPLETE", "dex_ppirtv", "goal_binding.envelope.spt_path", "Unreadable flow files make binding discovery incomplete.", "ppirtv_trace", "Repair the internal flow readability defect and repeat the read-only trace; do not infer missing history.", false);
    case "goal_binding_spt_path_missing":
      return diagnostic("GOAL_BINDING_SPT_PATH_MISSING", "dex_ppirtv", "goal_binding.envelope.spt_path", "A persisted goal binding is missing its required spt_path.", "ppirtv_trace", "Treat this as an internal persistence defect; preserve the historical flow and investigate its original ledger/source without rewriting it.", false);
    default:
      return null;
  }
}

function diagnostic(
  code: string,
  owner: SptPathOwner,
  field: SptPathDiagnostic["field"],
  reason: string,
  tool: SptPathDiagnostic["next_required_action"]["tool"],
  rule: string,
  recoverable = true
): SptPathDiagnostic {
  return {
    code,
    owner,
    field,
    reason,
    next_required_action: { type: code.toLowerCase(), tool, rule },
    recoverable
  };
}
