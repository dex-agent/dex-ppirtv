import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { PROMPT_NAMES, RESOURCE_URIS, TOOL_NAMES, gatesTemplate, mcpReference, meetingsTemplate, promptText, resourceText } from "./catalogs.js";
import {
  COMPACT_PHASES,
  GOAL_FLOW_ROLES,
  GOAL_VERDICT_POLICIES,
  MEETING_KINDS,
  MEETING_TYPES,
  MEMORY_CANDIDATE_PROMOTE_SCOPES,
  MEMORY_CANDIDATE_RESOLUTION_ACTIONS,
  MEMORY_WRITE_POLICIES,
  PHASES,
  VERDICTS
} from "./domain.js";
import {
  boundedRecallErrorReferences,
  FlowEngine,
  RecallConsumptionReferenceError,
  WorkProgressContractError
} from "./flow-engine.js";
import { GoalIdempotencyDuplicateBindingsError } from "./goal-ledger-recovery.js";
import { scrubSecretLikeText } from "./security/secret-redaction.js";
import { PpirtvStore } from "./store.js";
import { resolveMemoryWriterConfigFromEnv } from "./config.js";
import { PPIRTV_TRACE_SELECTOR_KEYS, tracePpirtvArtifact } from "./provenance-trace.js";

const ANY_PHASES = [...PHASES, ...COMPACT_PHASES] as const;

export function createPpirtvServer(options: { storeRoot?: string; env?: NodeJS.ProcessEnv } = {}): McpServer {
  const runtimeEnv = options.env ?? process.env;
  const store = new PpirtvStore(options.storeRoot);
  const memoryWriter = resolveMemoryWriterConfigFromEnv(runtimeEnv);
  const engine = new FlowEngine(store, undefined, {
    memory_writer: memoryWriter
  });
  const server = new McpServer(
    {
      name: "dex-ppirtv",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: true },
        prompts: { listChanged: false }
      }
    }
  );

  registerTools(server, engine, store, memoryWriter, runtimeEnv);
  registerResources(server, engine);
  registerPrompts(server);
  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createPpirtvServer();
  await server.connect(new StdioServerTransport());
}

function registerTools(
  server: McpServer,
  engine: FlowEngine,
  store: PpirtvStore,
  memoryWriter: ReturnType<typeof resolveMemoryWriterConfigFromEnv>,
  runtimeEnv: NodeJS.ProcessEnv
): void {
  const cooperatorSchema = z.object({
    name: z.string().min(1),
    reason: z.string().min(1),
    material: z.boolean().default(false)
  });
  const goalEnvelopeSchema = {
    workspace: z.string().min(1),
    spt_path: z.string().min(1),
    objective: z.string().min(1),
    flow_id: z.string().optional(),
    idempotency_key: z.string().min(1),
    evidence_required: z.boolean(),
    required_evidence: z.array(z.string()).default([]),
    requested_verdict_policy: z.enum(GOAL_VERDICT_POLICIES).default("evidence_required"),
    source: z.string().min(1),
    risk_level: z.enum(["high", "medium", "low", "mechanical"]).optional(),
    mode: z.enum(["full", "compact", "lean"]).optional(),
    flow_role: z.enum(GOAL_FLOW_ROLES).optional()
  };
  const criterionProofSchema = z
    .object({
      task_id: z.string().min(1),
      requirement_id: z.string().min(1),
      criterion_id: z.string().min(1),
      evidence_requirement_id: z.string().min(1),
      observed_value: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(z.unknown()),
        z.array(z.unknown()),
        z.null()
      ]),
      revision_set: z
        .array(
          z
            .object({
              workspace: z.string().min(1),
              head: z.string().min(1).optional(),
              paths: z
                .array(
                  z
                    .object({
                      path: z.string().min(1),
                      sha256: z.string().regex(/^[a-f0-9]{64}$/)
                    })
                    .strict()
                )
                .min(1)
                .max(4096)
            })
            .strict()
        )
        .min(1)
        .max(32),
      environment: z.string().min(1),
      producer: z.string().min(1),
      timestamp: z.string().datetime({ offset: true }),
      limits: z.array(z.string().min(1)).min(1)
    })
    .strict();

  server.registerTool(
    "runtime_probe",
    {
      description: "Return a read-only runtime identity receipt for launcher, workspace and memory-writer activation checks.",
      inputSchema: {}
    },
    async () => toolResponse(async () => {
      const layout = await store.runtimeLayoutStatus();
      return {
        project_root: layout.project_root,
        ppirtv_home: layout.ppirtv_home,
        memory_writer_runtime: memoryWriter.profile === "v2"
          ? {
              profile: "v2",
              workspace_root: memoryWriter.workspace_root,
              memory_home: memoryWriter.memory_home,
              canonical_root: memoryWriter.canonical_root,
              entrypoint: memoryWriter.entrypoint
            }
          : {
              profile: memoryWriter.profile,
              workspace_root: layout.project_root,
              memory_home: runtimeEnv.DEX_MEMORIA_HOME ? path.resolve(runtimeEnv.DEX_MEMORIA_HOME) : null,
              canonical_root: null,
              entrypoint: null
            },
        configured_memory_bundle: {
          profile: runtimeEnv.PPIRTV_MEMORY_WRITER_PROFILE?.trim() || "unconfigured",
          canonical_root: runtimeEnv.PPIRTV_DEX_MEMORIA_CANONICAL_ROOT ? path.resolve(runtimeEnv.PPIRTV_DEX_MEMORIA_CANONICAL_ROOT) : null,
          entrypoint: runtimeEnv.PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT ? path.resolve(runtimeEnv.PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT) : null,
          memory_home: runtimeEnv.DEX_MEMORIA_HOME ? path.resolve(runtimeEnv.DEX_MEMORIA_HOME) : null
        },
        process_generation: runtimeEnv.PPIRTV_PROCESS_GENERATION ?? `pid:${process.pid}`,
        session_generation: runtimeEnv.PPIRTV_SESSION_GENERATION ?? `session:${process.pid}`,
        process_id: process.pid
      };
    })
  );
  server.registerTool(
    "ppirtv_trace",
    {
      description:
        "Locate origin, history, evolution, provenance, decisions, evidence, or reconstruction clues from exactly one exact PPIRTV selector; this is read-only and works without creating an index or returning artifact payloads.",
      inputSchema: Object.fromEntries(
        PPIRTV_TRACE_SELECTOR_KEYS.map((key) => [key, z.string().min(1).optional()])
      )
    },
    async (args) => toolResponse(() => tracePpirtvArtifact(store, args))
  );
  const pipelineItemSchema = z.object({
    goal: z.string().min(1),
    context: z.string().optional(),
    scope_in: z.array(z.string()).default([]),
    scope_out: z.array(z.string()).default([]),
    tasks: z.array(z.string()).default([]),
    done_criteria: z.array(z.string()).default([]),
    expected_evidence: z.array(z.string()).default([]),
    risks: z.array(z.string()).optional(),
    uncertainties: z.array(z.string()).optional(),
    changed_files: z.array(z.string()).optional(),
    evidence: z.array(z.string()).optional(),
    residual_risks: z.array(z.string()).optional(),
    verdict_parking_lot: z.array(z.string()).optional(),
    verdict_gold_mining: z.array(z.string()).optional()
  });

  server.registerTool(
    "flow_create",
    {
      description:
        "Create a legacy/advisory PPIRTV flow without an official GOAL binding. Default response is a lean receipt; use detail:'full' for the historical payload. For official /GOAL execution, use spt_validate then goal_start.",
      inputSchema: {
        goal: z.string().min(1),
        owner: z.string().optional(),
        context: z.string().optional(),
        scope: z.object({ in: z.array(z.string()).default([]), out: z.array(z.string()).default([]) }).optional(),
        risks: z.array(z.string()).optional(),
        uncertainties: z.array(z.string()).optional(),
        detail: z.enum(["lean", "full"]).optional()
      }
    },
    async ({ detail, ...args }) =>
      toolResponse(async () => {
        const flow = await engine.createFlow(args);
        return detail === "full" ? flow : leanFlowCreateReceipt(flow);
      })
  );

  server.registerTool(
    "flow_status",
    {
      description: "Return the current state of a flow by flow_id.",
      inputSchema: { flow_id: z.string().min(1) }
    },
    async ({ flow_id }) => toolResponse(() => engine.status(flow_id))
  );

  server.registerTool(
    "flow_advance",
    {
      description: "Advance a flow only when the current phase gate passes.",
      inputSchema: {
        flow_id: z.string().min(1),
        provided: z.record(z.unknown()).optional(),
        evidence_ids: z.array(z.string()).optional(),
        actor: z.string().optional()
      }
    },
    async (args) => toolResponse(() => engine.advance(args))
  );

  server.registerTool(
    "flow_return",
    {
      description: "Return a flow to a previous phase with reason and optional evidence.",
      inputSchema: {
        flow_id: z.string().min(1),
        to: z.enum(PHASES),
        reason: z.string().min(1),
        evidence_ids: z.array(z.string()).optional(),
        actor: z.string().optional()
      }
    },
    async (args) => toolResponse(() => engine.returnTo(args))
  );

  server.registerTool(
    "gate_check",
    {
      description: "Check the PPIRTV gate for the current or requested phase.",
      inputSchema: {
        flow_id: z.string().min(1),
        phase: z.enum(ANY_PHASES).optional(),
        provided: z.record(z.unknown()).optional(),
        persist: z.boolean().optional()
      }
    },
    async (args) => toolResponse(() => engine.checkGate(args))
  );

  server.registerTool(
    "meeting_open",
    {
      description: "Open a divergent, convergent or transversal meeting artifact linked to a flow.",
      inputSchema: {
        flow_id: z.string().min(1),
        type: z.enum(MEETING_TYPES).optional(),
        kind: z.enum(MEETING_KINDS).optional(),
        question: z.string().min(1),
        participants_required: z.array(z.string()).optional(),
        created_by: z.string().optional(),
        evidence_ids: z.array(z.string()).optional()
      }
    },
    async (args) => toolResponse(() => engine.openMeeting(args))
  );

  server.registerTool(
    "meeting_record",
    {
      description: "Record structured meeting outputs.",
      inputSchema: {
        meeting_id: z.string().min(1),
        questions: z.array(z.string()).optional(),
        hypotheses: z.array(z.string()).optional(),
        alternatives: z.array(z.string()).optional(),
        decisions: z.array(z.string()).optional(),
        risks: z.array(z.string()).optional(),
        next_steps: z.array(z.string()).optional(),
        affected_areas: z.array(z.string()).optional(),
        impacts: z.array(z.string()).optional(),
        owners: z.array(z.string()).optional(),
        gates_extra: z.array(z.string()).optional(),
        rollback_plan: z.string().optional(),
        parking_lot: z.array(z.string()).optional(),
        gold_mining: z.array(z.string()).optional(),
        cooperators: z.array(cooperatorSchema).optional(),
        active_credits: z.array(z.string()).optional()
      }
    },
    async (args) => toolResponse(() => engine.recordMeeting(args))
  );

  server.registerTool(
    "evidence_attach",
    {
      description: "Attach evidence to a flow without writing secrets to the ledger.",
      inputSchema: {
        flow_id: z.string().min(1),
        kind: z.string().default("note"),
        title: z.string().min(1),
        uri: z.string().optional(),
        content: z.string().optional(),
        note: z.string().optional(),
        parking_lot: z.array(z.string()).optional(),
        gold_mining: z.array(z.string()).optional(),
        cooperators: z.array(cooperatorSchema).optional(),
        active_credits: z.array(z.string()).optional()
      }
    },
    async (args) => toolResponse(() => engine.attachEvidence(args))
  );

  server.registerTool(
    "checklist_render",
    {
      description: "Render only the current phase by default. The visual-only receipt returns that phase's items, blockers and next step; use detail:'full' only for principles, the canonical workflow and complete governance arrays.",
      inputSchema: {
        flow_id: z.string().min(1),
        detail: z.enum(["visual-only", "lean", "compact", "full"]).optional()
      }
    },
    async ({ flow_id, detail }) => toolResponse(() => engine.renderChecklist(flow_id, detail ?? "visual-only"))
  );

  server.registerTool(
    "verdict_record",
    {
      description: "Record a legacy/advisory flow verdict. Official GOAL/SPT flows reject this route and require goal_verdict so fiscal evidence and review attribution cannot be bypassed.",
      inputSchema: {
        flow_id: z.string().min(1),
        status: z.enum(VERDICTS),
        rationale: z.string().min(1),
        evidence_ids: z.array(z.string()).optional(),
        residual_risks: z.array(z.string()).optional(),
        parking_lot: z.array(z.string()).optional(),
        gold_mining: z.array(z.string()).optional(),
        cooperators: z.array(cooperatorSchema).optional(),
        active_credits: z.array(z.string()).optional(),
        meeting_ids: z.array(z.string().min(1)).optional(),
        next_step: z.string().min(1)
      }
    },
    async (args) => toolResponse(() => engine.recordVerdict(args), { flow_id: typeof args.flow_id === "string" ? args.flow_id : undefined })
  );

  server.registerTool(
    "hygiene_scan",
    {
      description: "Scan for clean-house findings and apply the barata nunca esta sozinha rule.",
      inputSchema: { flow_id: z.string().optional() }
    },
    async ({ flow_id }) => toolResponse(() => engine.hygieneScan(flow_id))
  );

  server.registerTool(
    "flow_archive",
    {
      description: "Archive a flow after verdict or with an explicit reason.",
      inputSchema: { flow_id: z.string().min(1), reason: z.string().optional() }
    },
    async (args) => toolResponse(() => engine.archiveFlow(args))
  );

  server.registerTool(
    "spt_validate",
    {
      description: "Validate an explicit SPT v2 or v3 contract without echoing sensitive contents. V2 stays readable for history/recovery; new execution requires v3.",
      inputSchema: {
        workspace: z.string().min(1),
        spt_path: z.string().min(1),
        objective: z.string().optional()
      }
    },
    async (args) => toolResponse(() => engine.validateSpt(args))
  );

  server.registerTool(
    "goal_start",
    {
      description: "Start or reuse an official GOAL/SPT flow. Omitted flow_role means execution; new execution requires SPT v3, while exact v2 retry and explicit recovery/reconciliation remain supported. Default mode is canonical 'compact'; 'lean' is its input alias and 'full' must be requested explicitly.",
      inputSchema: goalEnvelopeSchema
    },
    async (args) => toolResponse(() => engine.startGoal(args))
  );

  server.registerTool(
    "goal_status",
    {
      description: "Return GOAL execution status. Default detail is 'lean' for the actionable core under 5KB; use detail:'full' only for the complete diagnostic.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        detail: z.enum(["lean", "compact", "full"]).optional()
      }
    },
    async (args) => toolResponse(() => engine.goalStatus({ ...args, detail: args.detail ?? "lean" }), args)
  );

  server.registerTool(
    "ppirtv_checkout",
    {
      description: "Return PPIRTV closing accountability. Default detail is 'lean'; use detail:'full' only for complete accountability arrays.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        detail: z.enum(["lean", "compact", "full"]).optional()
      }
    },
    async (args) => toolResponse(() => engine.goalCheckout({ ...args, detail: args.detail ?? "lean" }), args)
  );

  server.registerTool(
    "goal_resume",
    {
      description: "Resume an existing GOAL/SPT flow by flow_id or idempotency_key without creating a duplicate.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        note: z.string().optional()
      }
    },
    async (args) => toolResponse(() => engine.resumeGoal(args), args)
  );

  server.registerTool(
    "goal_gate_check",
    {
      description: "Run and persist an official GOAL phase gate by flow_id or idempotency_key. Status receipt defaults to lean; use detail:'full' only for diagnostics.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        phase: z.enum(ANY_PHASES).optional(),
        provided: z.record(z.unknown()).optional(),
        persist: z.boolean().optional(),
        detail: z.enum(["lean", "compact", "full"]).optional()
      }
    },
    async (args) => toolResponse(() => engine.goalGateCheck(args), args)
  );

  server.registerTool(
    "goal_gate_preflight",
    {
      description: "Preview the exact GOAL gate requirements without persisting state, writing ledger events, incrementing counters or triggering recall.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        phase: z.enum(ANY_PHASES).optional(),
        provided: z.record(z.unknown()).optional(),
        detail: z.enum(["lean", "compact"]).optional()
      }
    },
    async (args) => toolResponse(() => engine.goalGatePreflight(args), args)
  );

  server.registerTool(
    "goal_advance",
    {
      description: "Advance an official GOAL flow only after a real persisted gate passes. During implementation, declare intentional removals in both provided.changed_files and provided.deleted_files; an absent changed file without deleted_files fails closed. Status receipt defaults to lean; recall_consumption can explicitly confirm cited recall references.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        provided: z.record(z.unknown()).optional(),
        evidence_ids: z.array(z.string()).optional(),
        recall_consumption: z.object({
          references: z.array(z.string().min(1)).min(1),
          graphify_references: z.array(z.string().min(1)).default([]),
          note: z.string().min(1).optional()
        }).optional(),
        detail: z.enum(["lean", "compact", "full"]).optional()
      }
    },
    async (args) => toolResponse(() => engine.goalAdvance(args), args)
  );

  server.registerTool(
    "goal_progress_record",
    {
      description: "Record sanitized, idempotent work progress for an official GOAL without turning progress into evidence or a fiscal blocker.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        event_key: z.string().min(1).max(120),
        source: z.string().min(1).max(80),
        operation: z.string().min(1).max(120),
        stage: z.string().min(1).max(120),
        current: z.number().int().nonnegative(),
        total: z.number().int().positive(),
        status: z.enum(["queued", "running", "completed", "failed"]),
        message: z.string().max(240).optional()
      }
    },
    async (args) => toolResponse(() => engine.recordGoalProgress(args), args)
  );

  server.registerTool(
    "goal_meeting_open",
    {
      description: "Open a live GOAL meeting linked to a flow without granting material credit yet.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        type: z.enum(MEETING_TYPES).optional(),
        kind: z.enum(MEETING_KINDS).optional(),
        question: z.string().min(1),
        participants_required: z.array(z.string()).optional(),
        created_by: z.string().optional(),
        evidence_ids: z.array(z.string()).optional(),
        suggested_cooperators: z.array(cooperatorSchema).optional()
      }
    },
    async (args) => toolResponse(() => engine.goalMeetingOpen(args))
  );

  server.registerTool(
    "goal_meeting_add_turn",
    {
      description: "Add an auditable turn to a live GOAL meeting before it is closed.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        meeting_id: z.string().min(1),
        speaker: z.string().optional(),
        question: z.string().optional(),
        finding: z.string().optional(),
        note: z.string().optional(),
        evidence_ids: z.array(z.string()).optional()
      }
    },
    async (args) => toolResponse(() => engine.goalMeetingAddTurn(args), { flow_id: args.flow_id, tool: "goal_meeting_add_turn" })
  );

  server.registerTool(
    "goal_meeting_close",
    {
      description: "Close and freeze a GOAL meeting result. Only meeting-owned blockers are accepted; downstream impact requires an exact later meeting_id reference.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        meeting_id: z.string().min(1),
        participants_present: z.array(z.string()).optional(),
        findings: z.array(z.string()).optional(),
        questions: z.array(z.string()).optional(),
        hypotheses: z.array(z.string()).optional(),
        alternatives: z.array(z.string()).optional(),
        decisions: z.array(z.string()).optional(),
        decision: z.string().min(1),
        next_required_action: z.record(z.unknown()).nullable().optional(),
        satisfies_blockers: z.array(z.string()).optional(),
        evidence_ids: z.array(z.string()).optional(),
        risks: z.array(z.string()).optional(),
        next_steps: z.array(z.string()).optional(),
        affected_areas: z.array(z.string()).optional(),
        impacts: z.array(z.string()).optional(),
        owners: z.array(z.string()).optional(),
        gates_extra: z.array(z.string()).optional(),
        rollback_plan: z.string().optional(),
        parking_lot: z.array(z.string()).optional(),
        gold_mining: z.array(z.string()).optional(),
        cooperators: z.array(cooperatorSchema).optional(),
        active_credits: z.array(z.string()).optional()
      }
    },
    async (args) => toolResponse(() => engine.goalMeetingClose(args), { flow_id: args.flow_id, tool: "goal_meeting_close" })
  );

  server.registerTool(
    "mm_memory_mining",
    {
      description: "Classify and automatically write valid GOAL memory candidates, reporting every action. The ordinary call needs only flow_id when the human learning text states project/local, global/cross-project, both, or a recognizable theme; v2_* fields are advanced overrides.",
      inputSchema: {
        flow_id: z.string().min(1),
        auto_classify: z.boolean().default(true),
        write_policy: z.enum(MEMORY_WRITE_POLICIES).default("auto_write"),
        v2_destinations: z.array(z.union([
          z.object({ scope: z.literal("project") }),
          z.object({ scope: z.literal("global") }),
          z.object({ scope: z.literal("theme"), theme: z.string().trim().min(1) })
        ])).min(1).max(2).optional(),
        v2_density: z.enum(["light", "deep"]).optional(),
        v2_owner_skill: z.string().trim().min(1).optional(),
        v2_tags: z.array(z.string().regex(/^#[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/)).min(1).optional()
      }
    },
    async (args) => toolResponse(() => engine.mineMemory(args))
  );

  server.registerTool(
    "mm_memory_candidate_resolve",
    {
      description: "Resolve strong GOAL memory candidates with a traceable destination before retrying goal_verdict. target_scope selects only the memory destination inside the runtime-bound workspace; it never selects or changes the workspace. Promoting an unresolved V2 candidate requires explicit target_scope, density and tags; deep also requires owner_skill. A classified V2 candidate reuses its complete destination and metadata, and conflicting overrides fail before mutation.",
      inputSchema: {
        flow_id: z.string().min(1),
        candidate_ids: z.array(z.string().min(1)).min(1),
        action: z.enum(MEMORY_CANDIDATE_RESOLUTION_ACTIONS),
        rationale: z.string().min(1),
        when: z.string().optional(),
        target_scope: z.enum(MEMORY_CANDIDATE_PROMOTE_SCOPES).optional(),
        theme: z.string().optional(),
        density: z.enum(["light", "deep"]).optional(),
        owner_skill: z.string().trim().min(1).optional(),
        tags: z.array(z.string().regex(/^#[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/)).min(1).optional()
      }
    },
    async (args) => toolResponse(() => engine.resolveMemoryCandidates(args))
  );

  server.registerTool(
    "mm_pipeline_run",
    {
      description: "Create and run multiple PPIRTV flows sequentially with gates, verdicts and optional memory mining.",
      inputSchema: {
        pipeline: z.array(pipelineItemSchema).min(1),
        stop_on_failure: z.boolean().default(true),
        auto_memory_mining: z.boolean().default(true)
      }
    },
    async (args) => toolResponse(() => engine.runPipeline(args))
  );

  server.registerTool(
    "evidence_add",
    {
      description: "Add traceable evidence without recording secret-like payloads. For SPT v3, criterion_proof binds the observed value to one task, requirement, criterion and evidence requirement; expected/operator are derived from the bound SPT and cannot be supplied by the caller. A structured code_review attestation must cite the exact implementation_fingerprint observed by the reviewer; the server rejects stale snapshots and verdict text alone never satisfies review_required. Status receipt defaults to lean; use detail:'full' only for a complete diagnostic.",
      inputSchema: {
        flow_id: z.string().min(1),
        kind: z.string().default("goal_evidence"),
        title: z.string().min(1),
        uri: z.string().optional(),
        content: z.string().optional(),
        note: z.string().optional(),
        satisfies: z.array(z.string()).optional(),
        observed_result: z.record(z.unknown()).optional(),
        criterion_proof: criterionProofSchema.optional(),
        scope_classification: z.enum(["target", "declared_dependency", "outside"]).optional(),
        scope_reference: z.string().optional(),
        reviewed_implementation_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
        detail: z.enum(["lean", "compact", "full"]).optional()
      }
    },
    async (args) => toolResponse(() => engine.addGoalEvidence(args))
  );

  server.registerTool(
    "goal_verdict",
    {
      description: "Record a GOAL/SPT verdict. Positive conclusions require traceable evidence_ids. review_artifact_path and review_findings are metadata only; review_required needs structured code_review evidence bound to the current implementation fingerprint. A positive verdict does not complete an official GOAL: inspect phase_advance_allowed and closure_blockers, then call goal_advance for the guarded terminal transition.",
      inputSchema: {
        flow_id: z.string().min(1),
        status: z.enum(VERDICTS),
        rationale: z.string().min(1),
        evidence_ids: z.array(z.string()).optional(),
        residual_risks: z.array(z.string()).optional(),
        review_artifact_path: z.string().optional(),
        review_findings: z.array(z.string()).optional(),
        verdict_parking_lot: z.array(z.string()).optional(),
        verdict_gold_mining: z.array(z.string()).optional(),
        attempt_count: z.number().int().nonnegative().optional(),
        regress_count: z.number().int().nonnegative().optional(),
        meeting_id: z.string().optional(),
        meeting_ids: z.array(z.string()).optional(),
        next_step: z.string().min(1)
      }
    },
    async (args) => toolResponse(() => engine.goalVerdict(args), args)
  );

  server.registerTool(
    "goal_regress",
    {
      description: "Persist an official GOAL fiscal regress tied to a meeting or blocker.",
      inputSchema: {
        flow_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        to: z.enum(PHASES).optional(),
        reason: z.string().min(1),
        meeting_id: z.string().optional(),
        evidence_ids: z.array(z.string()).optional(),
        actor: z.string().optional()
      }
    },
    async (args) => toolResponse(() => engine.goalRegress(args))
  );

  assertRegistered("tool", TOOL_NAMES);
}

function registerResources(server: McpServer, engine: FlowEngine): void {
  server.registerResource(
    "flows",
    "ppirtv://flows",
    { title: "PPIRTV flows", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, "ppirtv://flows"))
  );
  server.registerResource(
    "templates-gates",
    "ppirtv://templates/gates",
    { title: "PPIRTV gate templates", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, gatesTemplate())
  );
  server.registerResource(
    "templates-meetings",
    "ppirtv://templates/meetings",
    { title: "PPIRTV meeting templates", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, meetingsTemplate())
  );
  server.registerResource(
    "reference-mcp",
    "ppirtv://reference/mcp",
    { title: "MCP reference", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, mcpReference())
  );

  const listFlowResources = async () => {
    const flows = await engine.store.listFlows();
    return {
      resources: flows.flatMap((flow) => [
        resourceMeta(`ppirtv://flow/${flow.flow_id}`, `flow ${flow.flow_id}`),
        resourceMeta(`ppirtv://flow/${flow.flow_id}/checklist`, `checklist ${flow.flow_id}`),
        resourceMeta(`ppirtv://flow/${flow.flow_id}/ledger`, `ledger ${flow.flow_id}`),
        resourceMeta(`ppirtv://flow/${flow.flow_id}/meetings`, `meetings ${flow.flow_id}`)
      ])
    };
  };

  server.registerResource(
    "flow",
    new ResourceTemplate("ppirtv://flow/{flow_id}", { list: listFlowResources }),
    { title: "PPIRTV flow", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, uri.href))
  );
  server.registerResource(
    "flow-checklist",
    new ResourceTemplate("ppirtv://flow/{flow_id}/checklist", { list: listFlowResources }),
    { title: "PPIRTV flow checklist", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, uri.href))
  );
  server.registerResource(
    "flow-ledger",
    new ResourceTemplate("ppirtv://flow/{flow_id}/ledger", { list: listFlowResources }),
    { title: "PPIRTV flow ledger", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, uri.href))
  );
  server.registerResource(
    "flow-meetings",
    new ResourceTemplate("ppirtv://flow/{flow_id}/meetings", { list: listFlowResources }),
    { title: "PPIRTV flow meetings", mimeType: "application/json" },
    async (uri) => resourceResult(uri.href, await resourceText(engine, uri.href))
  );

  assertRegistered("resource", RESOURCE_URIS);
}

function registerPrompts(server: McpServer): void {
  for (const name of PROMPT_NAMES) {
    server.registerPrompt(
      name,
      {
        title: name,
        description: `PPIRTV prompt: ${name}`,
        argsSchema: {
          flow_id: z.string().optional(),
          goal: z.string().optional(),
          context: z.string().optional()
        }
      },
      async (args) => ({
        description: `PPIRTV prompt: ${name}`,
        messages: [{ role: "user", content: { type: "text", text: promptText(name, args) } }]
      })
    );
  }
  assertRegistered("prompt", PROMPT_NAMES);
}

type ToolErrorContext = {
  flow_id?: unknown;
  tool?: string;
};

async function toolResponse(operation: () => Promise<unknown>, errorContext?: ToolErrorContext) {
  try {
    return toolResult(await operation());
  } catch (error) {
    return toolErrorResult(error, errorContext);
  }
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value }
  };
}

function leanFlowCreateReceipt(flow: Awaited<ReturnType<FlowEngine["createFlow"]>>) {
  return {
    flow_id: flow.flow_id,
    phase: flow.phase,
    status: flow.status,
    detail: "lean",
    advisory: true,
    official_goal: false,
    goal_binding: null,
    official_goal_route: {
      when: "only when the client requests an official /GOAL",
      required_tool_sequence: ["spt_validate", "goal_start"],
      reason: "flow_create is legacy/advisory and does not create an official GOAL binding"
    }
  };
}

function toolErrorResult(error: unknown, errorContext?: ToolErrorContext) {
  const envelope = classifyToolError(error, errorContext);
  const value = { error: envelope };
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${envelope.code}: ${envelope.message}\n${JSON.stringify(value, null, 2)}` }],
    structuredContent: { result: value }
  };
}

function classifyToolError(error: unknown, errorContext?: ToolErrorContext) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = scrubSecretLikeText(rawMessage);
  const base = {
    message,
    details: { original_error: message },
    contract_source: "docs/contracts/GOAL_SPT_CANONICAL_CONTRACT.md"
  };
  if (error instanceof RecallConsumptionReferenceError) {
    const unknownReferences = safeRecallReferences(error.unknownReferences);
    const validReferences = safeRecallReferences(error.validReferences);
    const validGraphifyReferences = safeRecallReferences(error.validGraphifyReferences);
    const graphify = error.code === "GRAPHIFY_CONSUMPTION_UNKNOWN_REFERENCES";
    return {
      ...base,
      code: error.code,
      recoverable: true,
      details: {
        ...base.details,
        ...(graphify
          ? {
              unknown_graphify_references: unknownReferences,
              valid_graphify_references: validGraphifyReferences,
              valid_references: validReferences
            }
          : { unknown_references: unknownReferences, valid_references: validReferences })
      },
      next_required_action: {
        type: "retry_goal_advance_with_recalled_reference",
        tool: "goal_advance",
        args: {
          ...(typeof errorContext?.flow_id === "string" ? { flow_id: errorContext.flow_id } : {})
        },
        select_from: graphify
          ? { references: validReferences, graphify_references: validGraphifyReferences }
          : { references: validReferences },
        rule: "selecione somente referencias realmente abertas e usadas; nao confirme consumo de todos os candidatos automaticamente"
      }
    };
  }
  if (error instanceof WorkProgressContractError) {
    return {
      ...base,
      code: error.code,
      recoverable: error.code !== "PROGRESS_AFTER_TERMINAL",
      details: { ...base.details, ...error.details },
      next_required_action: error.code === "PROGRESS_AFTER_TERMINAL"
        ? null
        : {
            type: "retry_goal_progress_with_current_state",
            tool: "goal_progress_record",
            args: {
              ...(typeof errorContext?.flow_id === "string" ? { flow_id: errorContext.flow_id } : {})
            },
            rule: "preserve total and send current greater than or equal to the latest persisted progress"
          }
    };
  }
  if (error instanceof GoalIdempotencyDuplicateBindingsError) {
    return {
      ...base,
      code: error.code,
      recoverable: false,
      details: {
        ...base.details,
        conflicting_flow_ids: error.conflicting_flow_ids
      },
      conflicting_flow_ids: error.conflicting_flow_ids,
      next_required_action: error.next_required_action
    };
  }
  if (/^Invalid SPT for goal_start:/i.test(message)) {
    return {
      ...base,
      code: "SPT_INVALIDO",
      recoverable: true,
      next_required_action: { type: "corrigir_spt", tool: "spt_validate" }
    };
  }
  if (/^GOAL_BINDING_MISMATCH:/i.test(message)) {
    return {
      ...base,
      code: "GOAL_BINDING_MISMATCH",
      recoverable: true,
      next_required_action: {
        type: "restore_original_binding_or_start_new_goal",
        tool: "goal_start"
      }
    };
  }
  if (/flow_id or idempotency_key is required|No flow found for idempotency_key|not bound to an official GOAL|Call goal_start first/i.test(message)) {
    return {
      ...base,
      code: "GOAL_NAO_ATIVO",
      recoverable: true,
      next_required_action: goalStartRequiredAction(errorContext)
    };
  }
  if (/SPT_V2_EXECUTION_MIGRATION_REQUIRED/i.test(message)) {
    return {
      ...base,
      code: "SPT_V2_EXECUTION_MIGRATION_REQUIRED",
      recoverable: true,
      next_required_action: {
        type: "migrate_spt_contract",
        tool: "spt_validate",
        required_version: 3
      }
    };
  }
  if (/SPT_V3_EVIDENCE_INVALID|SPT_V3_EVIDENCE_STALE|SPT_V3_CRITERION_COVERAGE_REQUIRED|SPT_V3_TRACEABILITY_MISSING/i.test(message)) {
    const flowId = typeof errorContext?.flow_id === "string" && errorContext.flow_id.length > 0 ? errorContext.flow_id : undefined;
    const code =
      /TRACEABILITY_MISSING/i.test(message)
        ? "SPT_V3_TRACEABILITY_MISSING"
        : /EVIDENCE_STALE/i.test(message)
          ? "SPT_V3_EVIDENCE_STALE"
        : /COVERAGE_REQUIRED/i.test(message)
          ? "SPT_V3_CRITERION_COVERAGE_REQUIRED"
          : "SPT_V3_EVIDENCE_INVALID";
    return {
      ...base,
      code,
      recoverable: code !== "SPT_V3_TRACEABILITY_MISSING",
      next_required_action: {
        type: code === "SPT_V3_TRACEABILITY_MISSING" ? "recover_bound_spt_traceability" : "attach_bound_criterion_evidence",
        tool: code === "SPT_V3_TRACEABILITY_MISSING" ? "goal_resume" : "evidence_add",
        ...(flowId ? { args: { flow_id: flowId } } : {})
      }
    };
  }
  if (/goal_verdict requires traceable evidence_ids|Unknown evidence_ids/i.test(message)) {
    // BUG 4: quando o errorContext traz flow_id, repassar nos args para o
    // consumidor saber exatamente qual flow_id alimentar em evidence_add,
    // em vez de adivinhar. Estrutura aditiva: type/tool continuam presentes.
    const flowId = typeof errorContext?.flow_id === "string" && errorContext.flow_id.length > 0 ? errorContext.flow_id : undefined;
    return {
      ...base,
      code: "EVIDENCIA_AUSENTE",
      recoverable: true,
      next_required_action: {
        type: "attach_traceable_evidence",
        tool: "evidence_add",
        ...(flowId ? { args: { flow_id: flowId, required: "evidence_ids com satisfies apontando para required_evidence do flow" } } : {})
      }
    };
  }
  if (/AUTO_CLASSIFY_DISABLED_AUTO_WRITE/i.test(message)) {
    return {
      ...base,
      code: "MEMORY_MINING_INPUT_INVALID",
      recoverable: true,
      next_required_action: { type: "adjust_memory_mining_policy", tool: "mm_memory_mining" }
    };
  }
  if (/MEMORY_MINING_BLOCKED_VERDICT/i.test(message)) {
    return {
      ...base,
      code: "MEMORY_MINING_BLOCKED_VERDICT",
      recoverable: true,
      next_required_action: { type: "resolve_memory_candidates", tool: "mm_memory_candidate_resolve" }
    };
  }
  if (/PPIRTV_FISCAL_BLOCKED/i.test(message)) {
    if (/memory_required_but_empty/i.test(message)) {
      const flowId = typeof errorContext?.flow_id === "string" && errorContext.flow_id.length > 0 ? errorContext.flow_id : "<flow_id>";
      return {
        ...base,
        code: "PPIRTV_FISCAL_BLOCKED",
        recoverable: true,
        next_required_action: memoryRequiredErrorAction(flowId)
      };
    }
    if (/missing_for_verdict=.*meeting_id/i.test(message)) {
      return {
        ...base,
        code: "PPIRTV_FISCAL_BLOCKED",
        recoverable: true,
        next_required_action: {
          type: "provide_meeting_id_for_verdict",
          tool: "goal_verdict",
          eligible_meeting_ids: parsePipeListFromError(message, "eligible_meeting_ids"),
          required_satisfies_blockers: ["required_cooperation"]
        }
      };
    }
    return {
      ...base,
      code: "PPIRTV_FISCAL_BLOCKED",
      recoverable: true,
      next_required_action: { type: "resolve_fiscal_blockers", tool: "goal_status" }
    };
  }
  if (/MEETING_NOT_CLOSED/i.test(message)) {
    return {
      ...base,
      code: "MEETING_NOT_CLOSED",
      recoverable: true,
      next_required_action: { type: "close_meeting_before_consumption", tool: "goal_meeting_close" }
    };
  }
  if (/MEETING_BLOCKER_NOT_OWNED/i.test(message)) {
    return {
      ...base,
      code: "MEETING_BLOCKER_NOT_OWNED",
      recoverable: true,
      next_required_action: { type: "route_blocker_to_contract_owner", tool: /evidence_add/i.test(message) ? "evidence_add" : "goal_status" }
    };
  }
  if (/MEETING_ALREADY_CLOSED/i.test(message)) {
    return {
      ...base,
      code: "MEETING_ALREADY_CLOSED",
      recoverable: true,
      next_required_action: { type: "use_frozen_meeting_result", tool: "goal_status", detail: "full" }
    };
  }
  if (/MEETING_(?:LOCKED|LOCK_TIMEOUT|LOCK_INVALID|LOCK_IDENTITY_CHANGED|STALE_LOCK_IDENTITY_CHANGED)/i.test(message)) {
    return {
      ...base,
      code: "MEETING_CONCURRENT_MUTATION",
      recoverable: !/LOCK_INVALID|IDENTITY_CHANGED/i.test(message),
      next_required_action: /LOCK_INVALID|IDENTITY_CHANGED/i.test(message)
        ? { type: "inspect_meeting_lock_integrity", tool: "goal_status", detail: "full" }
        : { type: "retry_meeting_mutation", tool: errorContext?.tool ?? "goal_status" }
    };
  }
  if (/secret-like|Authorization|Bearer|token|api[_-]?key|password|secret/i.test(rawMessage)) {
    return {
      ...base,
      code: "SENSITIVE_CONTENT_BLOCKED",
      recoverable: false,
      next_required_action: null
    };
  }
  return {
    ...base,
    code: "PPIRTV_TOOL_ERROR",
    recoverable: false,
    next_required_action: null
  };
}

function safeRecallReferences(references: string[]): string[] {
  return boundedRecallErrorReferences(references.map((reference) => scrubSecretLikeText(reference)));
}

function parsePipeListFromError(message: string, key: string): string[] {
  const match = new RegExp(`${key}=([^;\\n\\r]+)`, "i").exec(message);
  if (!match) {
    return [];
  }
  return match[1].split("|").map((item) => item.trim()).filter(Boolean);
}

function memoryRequiredErrorAction(flowId: string) {
  return {
    type: "run_memory_mining",
    tool: "mm_memory_mining",
    reason: "memory_required_but_empty exige mm_memory_mining canonico no flow antes de novo goal_verdict positivo",
    required_tool_sequence: [
      {
        order: 1,
        tool: "mm_memory_mining",
        args: { flow_id: flowId, auto_classify: true, write_policy: "auto_write" }
      },
      { order: 2, tool: "goal_status", args: { flow_id: flowId } },
      { order: 3, tool: "goal_verdict", only_if: "goal_status.blockers nao contem memory_required_but_empty" }
    ]
  };
}

function goalStartRequiredAction(errorContext?: ToolErrorContext) {
  const flowId = typeof errorContext?.flow_id === "string" && errorContext.flow_id.length > 0 ? errorContext.flow_id : "<flow_id>";
  const goalStartArgs = {
    workspace: "<workspace>",
    spt_path: "<spt_path>",
    objective: "<objective>",
    idempotency_key: "<idempotency_key>",
    source: "<source>",
    flow_id: flowId
  };
  return {
    type: "goal_start_required",
    tool: "goal_start",
    reason: "wrappers goal_* exigem GOAL oficial iniciado por goal_start; flow_create sozinho nao cria goal_binding",
    required_tool_sequence: [
      {
        order: 1,
        tool: "spt_validate",
        args: {
          workspace: goalStartArgs.workspace,
          spt_path: goalStartArgs.spt_path,
          objective: goalStartArgs.objective
        }
      },
      {
        order: 2,
        tool: "goal_start",
        args: goalStartArgs
      }
    ]
  };
}

function resourceResult(uri: string, value: unknown) {
  return {
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }]
  };
}

function resourceMeta(uri: string, name: string) {
  return { uri, name, mimeType: "application/json" };
}

function assertRegistered(kind: string, names: readonly string[]): void {
  if (names.length === 0) {
    throw new Error(`No ${kind}s registered`);
  }
}
