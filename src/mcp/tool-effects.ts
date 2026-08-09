import type {
  McpServer,
  RegisteredTool,
  ToolCallback
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AnySchema,
  ZodRawShapeCompat
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { REQUIRED_TOOLS } from "../domain.js";

export type PpirtvToolName = (typeof REQUIRED_TOOLS)[number];

export type ToolEffectKind = "read_only" | "additive" | "state_changing";

export type ToolEffectDeclaration = {
  effect: ToolEffectKind;
  rationale: string;
  annotations: Required<Pick<
    ToolAnnotations,
    "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint"
  >>;
};

function declareToolEffect(
  effect: ToolEffectKind,
  idempotentHint: boolean,
  rationale: string
): ToolEffectDeclaration {
  return {
    effect,
    rationale,
    annotations: {
      readOnlyHint: effect === "read_only",
      destructiveHint: effect === "state_changing",
      idempotentHint,
      openWorldHint: false
    }
  };
}

export const TOOL_EFFECTS = {
  runtime_probe: declareToolEffect(
    "read_only",
    true,
    "Reads runtime identity and memory-writer configuration without persisting flow, ledger, memory or workspace state."
  ),
  ppirtv_trace: declareToolEffect(
    "read_only",
    true,
    "Reads provenance selectors and diagnostics without creating an index or rewriting history."
  ),
  flow_create: declareToolEffect(
    "additive",
    false,
    "Creates a new advisory flow; repeating the same arguments can create another flow."
  ),
  flow_status: declareToolEffect(
    "additive",
    true,
    "Reads one advisory flow, but the current store contract can create missing runtime directories and an empty ledger before the read; repeating the same call adds no further effect."
  ),
  flow_advance: declareToolEffect(
    "state_changing",
    false,
    "Changes the current phase and persisted flow state when its gate passes."
  ),
  flow_return: declareToolEffect(
    "state_changing",
    false,
    "Moves a flow back to an earlier phase and persists the transition."
  ),
  gate_check: declareToolEffect(
    "state_changing",
    false,
    "Persists a gate result by default; persist=false is only a narrower call mode."
  ),
  meeting_open: declareToolEffect(
    "additive",
    false,
    "Creates a new meeting artifact and links it to a flow."
  ),
  meeting_record: declareToolEffect(
    "state_changing",
    false,
    "Updates the structured content of an existing meeting."
  ),
  evidence_attach: declareToolEffect(
    "state_changing",
    false,
    "Creates evidence and can replace the flow implementation fingerprint used by review-coherence gates."
  ),
  checklist_render: declareToolEffect(
    "additive",
    true,
    "Renders persisted state, but the current store contract can create missing runtime directories and an empty ledger before the read; repeating the same call adds no further effect."
  ),
  verdict_record: declareToolEffect(
    "state_changing",
    false,
    "Records a legacy verdict and can change the advisory flow status."
  ),
  hygiene_scan: declareToolEffect(
    "additive",
    false,
    "Scans the workspace and, when flow_id is supplied, appends a scan receipt to that flow."
  ),
  flow_archive: declareToolEffect(
    "state_changing",
    true,
    "Changes a flow to archived state and records the transition; an identical retry reuses the frozen archive without another save or ledger event."
  ),
  spt_validate: declareToolEffect(
    "read_only",
    true,
    "Validates an explicit SPT path and returns diagnostics without editing the SPT."
  ),
  goal_start: declareToolEffect(
    "state_changing",
    false,
    "Creates or binds an official GOAL; a retry can replace last_seen_at and append goal_reused state, so the tool does not promise idempotence."
  ),
  goal_status: declareToolEffect(
    "additive",
    true,
    "Lean reads current GOAL state, while compact/full can append one guarded before-phase recall receipt; an identical retry reuses that persisted status."
  ),
  ppirtv_checkout: declareToolEffect(
    "additive",
    true,
    "Lean reads closing accountability, while compact/full can append one guarded before-phase recall receipt through goal_status; an identical retry reuses it."
  ),
  goal_resume: declareToolEffect(
    "state_changing",
    false,
    "Replaces the binding last_seen_at and flow updated_at values, then appends resume history and ledger state."
  ),
  goal_gate_check: declareToolEffect(
    "state_changing",
    false,
    "Persists an official GOAL gate result unless the caller explicitly disables persistence."
  ),
  goal_gate_preflight: declareToolEffect(
    "additive",
    true,
    "Previews gate requirements without domain events, counters or recall, but the current store contract can initialize missing runtime directories and an empty ledger once."
  ),
  goal_advance: declareToolEffect(
    "state_changing",
    false,
    "Persists a gate and changes the official GOAL phase or terminal state."
  ),
  goal_progress_record: declareToolEffect(
    "additive",
    true,
    "Appends progress once per event_key and reuses an already recorded event."
  ),
  goal_meeting_open: declareToolEffect(
    "additive",
    false,
    "Creates and links a new GOAL meeting; the flow idempotency key does not deduplicate meeting creation."
  ),
  goal_meeting_add_turn: declareToolEffect(
    "additive",
    false,
    "Appends an auditable turn to a live meeting."
  ),
  goal_meeting_close: declareToolEffect(
    "state_changing",
    true,
    "Freezes a live meeting and persists its decision and fiscal claims; the same frozen decision is an idempotent retry."
  ),
  mm_memory_mining: declareToolEffect(
    "state_changing",
    false,
    "Can write governed memory through the configured local writer and update GOAL memory state."
  ),
  mm_memory_candidate_resolve: declareToolEffect(
    "state_changing",
    false,
    "Promotes, parks, discards or accepts candidates and persists their resolution."
  ),
  mm_pipeline_run: declareToolEffect(
    "state_changing",
    false,
    "Creates and advances multiple flows and may invoke governed memory mining."
  ),
  evidence_add: declareToolEffect(
    "state_changing",
    false,
    "Creates traceable GOAL evidence and can replace the implementation fingerprint used by review-coherence gates."
  ),
  goal_verdict: declareToolEffect(
    "state_changing",
    false,
    "Records a fiscal verdict and can change blockers and GOAL status."
  ),
  goal_regress: declareToolEffect(
    "state_changing",
    false,
    "Moves an official GOAL back to an earlier phase and records the regression."
  )
} satisfies Record<PpirtvToolName, ToolEffectDeclaration>;

export function assertToolEffectCatalog(
  catalog: Record<string, ToolEffectDeclaration>,
  registeredNames: readonly string[] = REQUIRED_TOOLS
): void {
  const expected = new Set(registeredNames);
  const actual = new Set(Object.keys(catalog));
  const missing = registeredNames.filter((name) => !actual.has(name));
  const unknown = [...actual].filter((name) => !expected.has(name));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `PPIRTV_TOOL_EFFECTS_CATALOG_MISMATCH: missing=${missing.join("|") || "none"}; unknown=${unknown.join("|") || "none"}`
    );
  }

  for (const [name, declaration] of Object.entries(catalog)) {
    const { annotations, effect, rationale } = declaration;
    if (!rationale.trim()) {
      throw new Error(`PPIRTV_TOOL_EFFECT_RATIONALE_REQUIRED: tool=${name}`);
    }
    const hintValues = [
      annotations.readOnlyHint,
      annotations.destructiveHint,
      annotations.idempotentHint,
      annotations.openWorldHint
    ];
    if (hintValues.some((value) => typeof value !== "boolean")) {
      throw new Error(`PPIRTV_TOOL_EFFECT_HINTS_INCOMPLETE: tool=${name}`);
    }
    if (annotations.openWorldHint) {
      throw new Error(`PPIRTV_TOOL_EFFECT_OPEN_WORLD_UNSUPPORTED: tool=${name}`);
    }
    if (effect === "read_only" && (!annotations.readOnlyHint || annotations.destructiveHint)) {
      throw new Error(`PPIRTV_TOOL_EFFECT_READ_ONLY_CONTRADICTION: tool=${name}`);
    }
    if (effect !== "read_only" && annotations.readOnlyHint) {
      throw new Error(`PPIRTV_TOOL_EFFECT_MUTATION_MARKED_READ_ONLY: tool=${name}`);
    }
    if (effect === "additive" && annotations.destructiveHint) {
      throw new Error(`PPIRTV_TOOL_EFFECT_ADDITIVE_MARKED_DESTRUCTIVE: tool=${name}`);
    }
    if (effect === "state_changing" && !annotations.destructiveHint) {
      throw new Error(`PPIRTV_TOOL_EFFECT_STATE_CHANGE_MARKED_ADDITIVE: tool=${name}`);
    }
  }
}

assertToolEffectCatalog(TOOL_EFFECTS);

export function toolAnnotationsFor(name: PpirtvToolName): ToolAnnotations {
  const declaration = TOOL_EFFECTS[name];
  if (!declaration) {
    throw new Error(`PPIRTV_TOOL_EFFECT_UNKNOWN_TOOL: tool=${String(name)}`);
  }
  return { ...declaration.annotations };
}

type ToolRegistrationConfig<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema
> = {
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  _meta?: Record<string, unknown>;
};

export function registerPpirtvTool<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined
>(
  server: McpServer,
  name: PpirtvToolName,
  config: ToolRegistrationConfig<OutputArgs, InputArgs>,
  callback: ToolCallback<InputArgs>
): RegisteredTool {
  return server.registerTool(
    name,
    { ...config, annotations: toolAnnotationsFor(name) },
    callback
  );
}
