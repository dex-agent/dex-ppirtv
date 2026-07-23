# dex-PPIRTV

FileVersion: 0.3.0

`dex-PPIRTV` is a local MCP stdio server for running PPIRTV execution flows with
explicit phases, gates, meetings, evidence, verdicts, memory mining and
multi-flow pipelines.

PPIRTV means:

```text
Pensamentos -> Planejamento -> Implementacao -> Revisao -> Teste -> Validacao
```

The server does not replace engineering judgment. It gives agents and local
clients a structured way to keep work visible, resumable and evidence based.

Long-running producers may publish bounded progress with
`goal_progress_record`. Progress is visual telemetry and never substitutes for
evidence or a passing gate.

## Status

This package currently provides:

- low-level PPIRTV flow tools;
- official `goal_*` wrappers for GOAL/SPT execution;
- `mm_memory_mining` for classified memory mining and safe writes;
- `src/memory`, the Bibliotecario layer for phase recall and local learning
  hooks;
- `mm_pipeline_run` for sequential execution of multiple PPIRTV flows;
- runtime persistence in a local store;
- tests for the engine and MCP stdio behavior.

## Public Boundary

This repository is intended to publish source code, tests, package metadata,
fallback principles, reusable templates and this README.

Local operational state, agent workspace files, implementation notes, runtime
ledgers, evidence artifacts, private setup scripts, environment files and local
backups are intentionally excluded from version control.

Development notes, internal plans and handoff files may exist in a maintainer
workspace. They are not part of the public package unless they are rewritten as
stable public documentation.

## Requirements

- Node.js 22 or newer.
- npm.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Test

```bash
npm run check
```

`npm run check` builds the TypeScript project and runs the Vitest suite.

Run the end-to-end MCP smoke:

```bash
npm run test:e2e
```

Export a redacted diagnostic bundle for an existing flow after build:

```bash
npm run build
npm run diagnostic:bundle -- --flow-id <flow_id> --ppirtv-home <path-to-.ppirtv>
```

## Run

```bash
npm start
```

For a single global installation, prefer the launcher entrypoint. It resolves
the consumer workspace before the MCP server starts, changes the process cwd to
that workspace and sets `PPIRTV_HOME` to `<workspace>/.ppirtv`. This minimal
configuration enables PPIRTV core only; it intentionally reports the memory
writer as `unconfigured`.

Minimal global PPIRTV-core launcher configuration shape:

```json
{
  "command": "node",
  "args": ["<install-root>/dist/launcher.js", "--workspace", "<workspace-name-or-path>"],
  "cwd": "<install-root>",
  "env": {
    "PPIRTV_WORKSPACE_ROOT": "<optional-root-for-workspace-names>",
    "PPIRTV_PRINCIPLES_PATH": "<optional-operational-contract-json>"
  }
}
```

### Global Launcher

The launcher accepts:

1. `--workspace <absolute-path-or-folder-name>`;
2. `PPIRTV_WORKSPACE=<absolute-path-or-folder-name>`;
3. `PPIRTV_WORKSPACE_ROOT` or `PPIRTV_WORKSPACE_ROOTS` to resolve a folder name;
4. inherited `cwd`, only when it is a real project root and not the install repo.

Example global config using only the consumer folder name:

```json
{
  "command": "node",
  "args": ["<install-root>/dist/launcher.js", "--workspace", "my-project"],
  "cwd": "<install-root>",
  "env": {
    "PPIRTV_WORKSPACE_ROOT": "C:/CodexProjetos",
    "PPIRTV_PRINCIPLES_PATH": "<optional-operational-contract-json>"
  }
}
```

With that config, `my-project` resolves to
`C:/CodexProjetos/my-project`, and runtime state is written only to:

```text
C:/CodexProjetos/my-project/.ppirtv/
```

The launcher propagates that canonical resolved path as `PPIRTV_WORKSPACE`.
This supplies only the workspace member of the V2 bundle; it does not activate
the V2 writer by itself. `PPIRTV_WORKSPACE_ROOT` remains the neutral global
lookup root and is not overwritten. If an explicit
`PPIRTV_WORKSPACE` resolves to a different project than `--workspace`, startup
fails with `PPIRTV_LAUNCHER_WORKSPACE_CONFLICT`; the launcher never silently
chooses one.

If the launcher starts from the install repository without `--workspace`,
`PPIRTV_WORKSPACE` or a reliable consumer cwd, it fails early with
`PPIRTV_LAUNCHER_WORKSPACE_REQUIRED`. This is intentional: without any
workspace signal from the host, choosing a project would be a guess and could
write runtime state to the wrong repository.

### Direct Mode

Direct mode remains supported for local or legacy configurations. In direct
mode the MCP process must start with `cwd` set to the workspace being operated
on. `PPIRTV_HOME`, when provided, must resolve exactly to
`<workspace>/.ppirtv`; otherwise the server fails early to prevent
cross-repository writes.

Direct mode PPIRTV-core configuration shape:

```json
{
  "command": "node",
  "args": ["<install-root>/dist/index.js"],
  "cwd": "<workspace-root>",
  "env": {
    "PPIRTV_HOME": "<workspace-root>/.ppirtv",
    "PPIRTV_WORKSPACE": "<workspace-root>",
    "PPIRTV_PRINCIPLES_PATH": "<optional-operational-contract-json>"
  }
}
```

Do not point `PPIRTV_HOME` at a public, versioned, install-repo or other
workspace directory.

### Repo-local Dex Memoria V2 bundle

V2 is active only when the consumer repository supplies the complete bundle.
Keep the global launcher workspace-neutral; bind `PPIRTV_WORKSPACE` or
`--workspace` in each repo-local consumer configuration:

```json
{
  "command": "node",
  "args": ["<dex-ppirtv-root>/dist/launcher.js", "--workspace", "<workspace-root>"],
  "cwd": "<dex-ppirtv-root>",
  "env": {
    "PPIRTV_MEMORY_WRITER_PROFILE": "v2",
    "PPIRTV_DEX_MEMORIA_CANONICAL_ROOT": "<dex-memoria-root>",
    "PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT": "<dex-memoria-root>/bin/dex-memoria.js",
    "DEX_MEMORIA_HOME": "<global-memory-home>"
  }
}
```

For direct mode, use the same four values and add
`PPIRTV_WORKSPACE=<workspace-root>` explicitly. A partial bundle is invalid;
`runtime_probe.memory_writer_runtime.profile=unconfigured` is not a successful
V2 installation.

The installation receipt must run:

```bash
node scripts/smoke-mcp-tools.mjs --config-toml <repo-config> --server dex_ppirtv --workspace <workspace-root> --require-memory-v2
```

Success requires `ok=true`, `memory_v2_requirement.ok=true`,
`runtime_probe.memory_writer_runtime.profile=v2` and
`memory_v2_capability.ok=true`, with a
`dex.memory.capability.receipt.v2` returned by the configured canonical
entrypoint. Effective canonical root, entrypoint, memory home and workspace
must also match the requested values. A profile echo alone proves only that the
bundle was loaded; it is not an operational writer receipt.

When validating a repo-local Codex MCP config, a direct smoke with
`--config-toml` proves only the selected server. If a parent workspace may also
expose a PPIRTV server, audit the parent config too:

```bash
npm run smoke:mcp-tools -- --config-toml "<child>/.codex/config.toml" --server dex_ppirtv --audit-config-toml "<parent>/.codex/config.toml" --flow-smoke
```

An enabled PPIRTV-like server with a different `cwd` or `PPIRTV_HOME` is
reported as `ppirtv_config_conflict`. A disabled inherited server is reported as
`disabled_ppirtv_config_visible`, which means restart or revalidate stale Codex
clients before treating the environment as clean.

### Memory-writer selector control plane

Owner: the PPIRTV memory integration boundary in
`src/memory/memory-writer-selector-cutover.ts`.

Purpose: execute a reversible `unconfigured | legacy-v1 -> v2` selector transition inside an
explicit caller-owned boundary. Callers provide `controlRoot`, `configPath` and
`journalPath`; the control plane contains no user-profile, vault or laboratory
path and performs no path discovery. `prepareMemoryWriterSelectorCutover` stores a byte-exact snapshot and a
`PENDING` journal, `resumeMemoryWriterSelectorCutover` applies or resumes the
selector change, and `rollbackMemoryWriterSelectorCutover` restores the exact
snapshot idempotently.

Changing TOML does not restart or reconnect a running MCP client. A transition
becomes `COMMITTED` only when the control plane runs its own causal probe and produces the explicit
`dex.ppirtv.memory-writer-selector.restart-receipt.v2` receipt bound to the
journal challenge, action, reason, fixed `dex_ppirtv` server identity, enabled state, config hash, workspace, complete memory
bundle and a newly observed process/session generation. Without that receipt the
result remains `PENDING_RESTART`; the same rule protects a rollback after a
committed activation.

Risk and boundary: the API and CLI are live-capable but inert until called with
explicit paths. Every config, journal and snapshot path must resolve below the
caller-provided control root. The CLI never discovers a Codex configuration,
never accepts a caller-authored receipt and never fabricates a receipt. `confirm`
starts a fresh launcher/MCP process from the bound, enabled `dex_ppirtv` section
and consumes its read-only `runtime_probe` response. A caller may use a
temporary workspace for rehearsal or deliberately pass a live workspace root;
that operational choice remains outside this module.

After `npm run build`, the executable owner supports `prepare`, `status`,
`resume`, `confirm` and `rollback`:

Choose `--before` from the TOML state that actually exists. If
`PPIRTV_MEMORY_WRITER_PROFILE` is absent, use `unconfigured`; if the key is
explicitly `legacy-v1`, use `legacy-v1`. The control plane rejects any declared
origin that disagrees with the file and accepts only `--after v2`.

```bash
node dist/memory-writer-selector-cutover-cli.js prepare --control-root "<workspace>" --config "<workspace>/.codex/config.toml" --journal "<workspace>/.agents/CUTOVER/memory-writer-selector.json" --before unconfigured --after v2 --canonical-root "<dex-memoria-root>" --entrypoint "<dex-memoria-entrypoint>" --activation-action restart --rollback-action restart
node dist/memory-writer-selector-cutover-cli.js prepare --control-root "<workspace>" --config "<workspace>/.codex/config.toml" --journal "<workspace>/.agents/CUTOVER/memory-writer-selector.json" --before legacy-v1 --after v2 --canonical-root "<dex-memoria-root>" --entrypoint "<dex-memoria-entrypoint>" --activation-action restart --rollback-action restart
node dist/memory-writer-selector-cutover-cli.js status --control-root "<workspace>" --config "<workspace>/.codex/config.toml" --journal "<workspace>/.agents/CUTOVER/memory-writer-selector.json"
node dist/memory-writer-selector-cutover-cli.js resume --control-root "<workspace>" --config "<workspace>/.codex/config.toml" --journal "<workspace>/.agents/CUTOVER/memory-writer-selector.json"
node dist/memory-writer-selector-cutover-cli.js confirm --control-root "<workspace>" --config "<workspace>/.codex/config.toml" --journal "<workspace>/.agents/CUTOVER/memory-writer-selector.json" --reason activate --action restart
node dist/memory-writer-selector-cutover-cli.js rollback --control-root "<workspace>" --config "<workspace>/.codex/config.toml" --journal "<workspace>/.agents/CUTOVER/memory-writer-selector.json"
node dist/memory-writer-selector-cutover-cli.js confirm --control-root "<workspace>" --config "<workspace>/.codex/config.toml" --journal "<workspace>/.agents/CUTOVER/memory-writer-selector.json" --reason rollback --action restart
```

`resume` and `rollback` apply or restore bytes while deliberately remaining at
`PENDING_RESTART`. The productive CLI rejects `--restart-receipt`; only `confirm`
may advance the journal. Its internally owned probe starts a new launcher/MCP process and derives the
receipt from the read-only `runtime_probe` response; it does not echo expected
values into a receipt. Disabled or differently named servers, replays and
mismatched challenge, action, reason, path, hash, bundle or runtime generation
are rejected.

For V2 activation, `confirm` also resolves the canonical root and entrypoint on
the real filesystem, rejects links, non-regular entrypoints and escapes, then
executes the canonical CLI's read-only `v2 capability` command. `COMMITTED`
requires the exact successful `dex.memory.capability.receipt.v2` contract; a
configuration that merely names plausible paths is not activation evidence.

Focused validation:

```bash
npx vitest run tests/memory-writer-selector-cutover.test.ts tests/memory-writer-selector-cutover-cli.test.ts tests/memory-writer-selector-cutover-hardening.test.ts tests/memory-writer-selector-activation-probe.test.ts
```

## Quick Start

Preferred global PPIRTV-core launcher configuration (memory writer remains
`unconfigured` until a repo-local V2 bundle is applied):

```json
{
  "command": "node",
  "args": ["<install-root>/dist/launcher.js", "--workspace", "my-project"],
  "cwd": "<install-root>",
  "env": {
    "PPIRTV_WORKSPACE_ROOT": "C:/CodexProjetos",
    "PPIRTV_PRINCIPLES_PATH": "<optional-contract-json>"
  }
}
```

Create a basic flow:

```json
{
  "tool": "flow_create",
  "arguments": {
    "goal": "Validate the PPIRTV server setup",
    "owner": "maintainer",
    "scope": {
      "in": ["server startup", "tool listing"],
      "out": ["external product changes"]
    }
  }
}
```

`flow_create` is a low-level legacy/advisory route. It does not create an
official GOAL binding and must not replace `spt_validate -> goal_start`.
Its response defaults to a lean receipt with `advisory: true` and
`official_goal: false`; use `detail: "full"` only when a compatibility client
needs the historical complete payload.

Then inspect it with:

```json
{
  "tool": "flow_status",
  "arguments": {
    "flow_id": "<flow-id-from-flow_create>"
  }
}
```

## Runtime State

By default, the store uses a local runtime directory named `.ppirtv` under
`process.cwd()`. The runtime treats `process.cwd()` as the consumer project
root. `PPIRTV_HOME`, when present, must confirm the same path:
`<projectRoot>/.ppirtv`.

Runtime state can include:

- `flows/`;
- `meetings/`;
- `evidence/`;
- `memory/`;
- `review/`;
- `verdicts/`;
- `logs/`;
- `specs/`;
- `tasks/`;
- `ledger.ndjson` at the `.ppirtv` root for compatibility.

That state is operational data, not source code.

## Principle Contract Resolution

The server resolves the operational principles contract in this order:

1. `PPIRTV_PRINCIPLES_PATH`, when explicitly configured.
2. The shared user principles contract, when present.
3. `principles/operational-contract.json` in the current workspace.
4. The versioned fallback contract shipped in this repository.

If a fallback is used, `hygiene_scan` reports it so clients do not mistake a
default for a project-specific contract.

## Configuration And Contract Registry

Runtime configuration must stay centralized. New environment variables, fiscal
limits and runtime path defaults belong in `src/config.ts`; MCP tool/prompt
catalogs belong in `src/domain.ts`; operational principle contract resolution
belongs in `src/principles.ts`. Avoid reading `process.env` directly from
feature code. A feature should call the central helper so check-in, status,
Bibliotecario/Graphify and tests tell the same story.

Contract locations:

1. Shared startup contract:
   `$env:USERPROFILE\.agents\CONTRACTS\PPIRTV_GOAL_STARTUP_CONTRACT.md`.
2. Shared human principles:
   `$env:USERPROFILE\.agents\memories\principles\PRINCIPLES.md`.
3. Shared operational principles contract:
   `$env:USERPROFILE\.agents\memories\principles\operational-contract.json`.
4. Project execution trails:
   `<WORKSPACE>\.agents\PLAN-TASKS\YYYY-MM-DD-<slug>.md`.

## Tools

Low-level tools:

- `flow_create`
- `flow_status`
- `flow_advance`
- `flow_return`
- `flow_archive`
- `gate_check`
- `meeting_open`
- `meeting_record`
- `evidence_attach`
- `checklist_render`
- `hygiene_scan`
- `verdict_record`

Low-level flows are advisory compatibility surfaces. `flow_create` returns a
lean receipt by default and accepts `detail: "full"` as the explicit opt-in for
the historical complete object. It never creates `goal_binding`; official
execution continues to start with `spt_validate` and `goal_start`.

Official GOAL/SPT tools:

- `spt_validate`
- `goal_start`
- `goal_status`
- `ppirtv_checkout`
- `goal_resume`
- `goal_gate_check`
- `goal_gate_preflight`
- `goal_advance`
- `goal_progress_record`
- `goal_meeting_open`
- `goal_meeting_add_turn`
- `goal_meeting_close`
- `goal_regress`
- `evidence_add`
- `goal_verdict`

`goal_status` and `ppirtv_checkout` expose `project_root`, `ppirtv_home` and
`runtime_layout_status` so clients can verify where the active MCP process is
writing state.

`ppirtv_checkout` is the direct closing/accountability tool. It returns the
same canonical checkout embedded in `goal_status.ppirtv_checkout`, but promotes
the important sections to top-level fields so clients and agents do not have to
remember to unpack nested status payloads. Use it at check-out before declaring
a GOAL finished.

Memory and pipeline tools:

- `mm_memory_mining`
- `mm_memory_candidate_resolve`
- `mm_pipeline_run`

## Typical GOAL/SPT Flow

SPT v2 is the only executable format. Its YAML front matter is the machine
contract; the Markdown body is free-form human documentation and is not parsed.
V1 heading-based trails must be regenerated or migrated before execution.

1. Validate an SPT v2 with `spt_validate`.
2. Start or reuse a flow with `goal_start`.
3. Inspect live state with `goal_status`, including `ppirtv_checkin`.
4. Open, discuss and close meetings with `goal_meeting_open`,
   `goal_meeting_add_turn` and `goal_meeting_close` when a real decision, risk
   or ambiguity exists.
5. Check gates with `goal_gate_check`.
6. Preview the same gate resolution without persistence with
   `goal_gate_preflight` when a read-only diagnosis is useful.
7. Advance with `goal_advance`.
8. For long work, publish bounded structured progress with
   `goal_progress_record`; progress is visual telemetry, not evidence.
9. Attach evidence with `evidence_add`.
10. Run `mm_memory_mining` when there is learning material to classify.
11. If strong candidates remain without destination, resolve them with
   `mm_memory_candidate_resolve`.
12. Close with `goal_verdict`.
13. Inspect `ppirtv_checkout` before considering the flow fully closed.

### End-to-end lean contract

`goal_start` defaults to the canonical `compact` mode when `mode` is omitted.
`lean` remains an input alias for `compact`; both use the four-phase profile
`concepcao -> implementacao -> revisao -> validacao`. The six-phase `full`
profile is opt-in through an explicit `mode: "full"`.

Execution profile and response detail are separate contracts. Tool responses
default to `detail: "lean"`, including existing `full` flows, and
`detail: "full"` is the explicit opt-in for a complete diagnostic.
`goal_status`, `goal_advance`, `evidence_add` and `ppirtv_checkout` keep only
actionable fields and counts by default. `checklist_render` defaults to
`detail: "visual-only"`; principles and complete governance arrays require
`detail: "full"`.

`goal_gate_preflight` is the read-only view of the same requirement resolver
used by `goal_gate_check`: it does not persist a gate, append ledger events,
trigger recall or mutate counters. In this first cut, structured evidence may
satisfy only `diff_reviewed`, `barata_scan`, `regression_risks` and
`test_executed`. The evidence must declare the exact requirement in
`satisfies`, carry a coherent `observed_result` and use an allowed `kind`.
`scope_classification: "target"` requires an exact `scope_reference` already in
the flow's `scope.in` or `changed_files`; a `declared_dependency` is accepted
only when its exact reference was declared in `scope.in`; `outside` never
satisfies a local gate. Review results name reviewed targets and neighboring
patterns searched, while test results carry non-negative passed/failed counts
and a zero exit code. Free text and legacy evidence do not become authority.

Mutation receipts are also opt-in in this cut. Calling `evidence_add` or
`goal_advance` with `detail: "compact"` returns a bounded receipt with the
action, satisfied requirements, cleared/remaining blockers and next step,
without nesting the complete evidence, checkout, history, meetings or memory.
Omitted detail, `detail: "lean"` and `detail: "full"` preserve their existing
response shapes for compatibility.

Omitting `mode` on an idempotent retry preserves the already persisted profile;
it does not migrate a live legacy flow. After evidence is written, the returned
status is recalculated from the effective blockers so the outer status and the
nested checkout cannot disagree.

Recall and use are separate facts. `recall_executed=true` means the
Bibliotecario/Graphify hook ran. It does not make `worked=true`.
`consumption_confirmed=true` requires `goal_advance.recall_consumption` with
references that match the latest recall for the current phase. Graphify work
is confirmed only when `graphify_references` match recalled Graphify items.
The confirmation is optional and never blocks an otherwise valid compact flow.

Positive verdicts require traceable evidence. In official GOAL/SPT flows, the
engine can operate in two modes:

- `advisory`: ordinary low-risk flow guidance, where findings are visible but do
  not automatically block a positive verdict.
- `fiscal`: material GOAL/SPT risks become blocking policy. This mode is
  triggered by material residual risk, code changes, recurring/product risk,
  hygiene blockers, required memory, missing review evidence, or failed
  Bibliotecario/Graphify visibility.

In fiscal mode, `pronto` and `pronto_com_ressalvas` must not pass just because
fields are present. The status surfaces these signals:

- `blockers`: current blocking reasons, such as `required_cooperation`,
  `memory_required_but_empty`, `hygiene_blocking`, `review_required`,
  `librarian_status`, `review_evidence_coherent` or `attempt_regress_count`.
- `required_cooperation`: mandatory COO participants for material flows,
  including `ancora-fluxo`, `chato`, `questionador`, `entrevista-me`,
  `garimpeiro`, `dex-memoria`, `estacionamento`, `reuniao`, `sprinter`,
  `duda-dev`, `mapeador-implementacao`, `revisor-codigo`, `tio-testador` and
  `validador-pronto`. Reasons are tied to the blocker when possible, such as
  `review_required`, `memory_required_but_empty` or `required_cooperation`.
- `display.direct_action`: when blockers exist, it must say
  `Bloqueado: ...`; it must not report `Gate pronto para avancar` with active
  fiscal blockers. This rule applies recursively to nested payloads such as
  `goal_status.checklist.display`, `evidence_add.status.checklist.display` and
  archived blocked flows.
- `checklist_render`: the default visual-only receipt shows only the current
  phase, its items, blockers and next step without repeating the full PPIRTV
  ruler or embedding principles. The canonical
  `Pensamentos -> Planejamento -> Implementacao -> Revisao -> Teste -> Validacao`
  workflow remains unchanged and is available with `detail: "full"`. In that
  full view, proof-dependent principles use a tri-state surface: `checked`,
  `blocked`/`unchecked` or `pending`; missing hygiene or memory proof must not
  render as green.
- `fiscal_policy.meeting_policy`: the meeting rotation and provocation
  repertoire to seek blind spots, untried exits and the correct PPIRTV return
  phase.
- `ppirtv_checkin`: beginning-of-flow visibility check. It reports PPIRTV, COO,
  Bibliotecario, Graphify and PPI as visible/configured/disabled/failed. When a
  component is not visible, the engine records the auto-repair action it can
  take or the required PPI action. When fiscal blockers are already known,
  `ppirtv_checkin.direct_action` reports a visible check-in with blockers
  instead of presenting the start as clean. It also exposes `trail_alignment`
  for the pre-flight check of MCP cwd, workspace, SPT path, goal and evidence
  contract before the flow leaves the initial station.
- `ppirtv_checkout`: closing summary with verdict, meetings, evidence, review,
  tests, garimpo, estacionamento, memory mining, librarian status and residual
  risks. When blocked, `direct_action` lists the blockers and points back to
  meeting/review/memory before any positive verdict. Archiving a blocked flow
  preserves the blockers and reports `Arquivado com bloqueios preservados`.
- `meeting_required`, `regress_required`, `back_to`, `next_required_action` and
  `can_retry_verdict`: machine-readable fiscal action contract. Material
  `required_cooperation` must lead to a traceable meeting/regress action before
  retrying a positive verdict.
- `goal_meeting_open`, `goal_meeting_add_turn` and `goal_meeting_close`: the
  executable meeting contract. A meeting is persisted with `meeting_id`,
  `flow_id`, `kind`, `opened_at`, `closed_at`, `participants_required`,
  `participants_present`, `questions`, `findings`, `decision`,
  `next_required_action`, `satisfies_blockers`, `created_by` and
  `evidence_ids`. A positive fiscal verdict that cites material
  `required_cooperation` must provide a closed `meeting_id` whose decision and
  participants satisfy the blocker.
  The first close freezes the meeting result, including concurrent close
  attempts. A retry with the same frozen decision is idempotent; a different
  decision is rejected. Meeting mutations sharing a flow use a
  flow-scoped filesystem lock: a live owner is never stolen, a valid dead-owner
  lock is recoverable, and malformed or identity-changing state fails closed.
  If persistence stops after the frozen meeting or flow was saved, an identical
  close retry reconciles the missing flow or canonical ledger event without
  changing the decision or duplicating evidence. Open meetings cannot be consumed by a verdict or regress.
  Meetings do not inherit fiscal
  blockers and currently own only `required_cooperation`; `review_required`
  remains owned by structured `evidence_add` review. `goal_status` exposes
  full `meeting_outcomes`, while lean/compact expose only
  `meeting_outcome_summary`; checkout exposes `meeting_outcome_accountability`.
  `recorded_legacy`, `closed_unconsumed`, `consumed_by_regress`,
  `consumed_by_verdict` and `unattributed_legacy` measure downstream
  traceability by `meeting_id`.
  They do not claim semantic effectiveness: attendance, turns, findings,
  credits and meeting volume are never sufficient evidence of impact.
- `goal_regress`: the executable regress contract. It persists the phase
  return, links optional meeting/evidence and increments the fiscal anti-loop
  count. A `regress_count` reported by `goal_verdict` is consumed into flow
  history so status cannot forget an external loop count.
- `regress_count`, `max_regressions` and `regress_limit_reached`: anti-loop
  guard. The default fiscal maximum is 3 regressions; after that the next
  action becomes an `open_decision_meeting` instead of another blind return.
- `display.librarian` and `librarian_status`: visual Bibliotecario/Graphify
  state. `librarian_status` is always structured, with
  `bibliotecario.status`, `graphify.status`, `graphify.configured` and
  `functional_tested`, `recall_executed` and `consumption_confirmed`.
  `functional_tested` proves that the recall path operated; only
  `consumption_confirmed` proves that the executor cited a recovered item. If
  `PPIRTV_GRAPHIFY_RECALL=1`, Graphify is reported as
  `configured=true` and `enabled=true`; before a runtime recall proves
  participation, the reason is `configured_awaiting_beforePhase_functional_test`
  and check-in can block with `librarian_or_graphify_not_functional` when
  Graphify is required by risk. This pending functional test is not a
  `graphify_config_mismatch`; mismatch is reserved for contradictory or invalid
  configuration. Graphify status is one of `disabled`, `recalled`, `empty`,
  `missing_graph`, `timeout` or `failed`.

`provided=true` alone is not evidence in fiscal review gates. Code changes need
`review_artifact_path`, `review_findings` or a review evidence artifact.
Material recurring risk needs enough attempt/regress/meeting history before a
positive verdict is accepted.

`hygiene_scan` must not read `.env`. If `.env` is present, the scanner reports
only an aggregate finding such as `.env:present_not_read` with
`sensitive_content_read=false`; key names and values must not appear in output,
ledger or evidence.

## Multi-Flow Pipelines

Use `mm_pipeline_run` only when the request contains more than one SPT/flow or
an explicit batch execution.

Each pipeline item becomes a normal PPIRTV flow. If `stop_on_failure=true`, a
failed item blocks the pipeline and later items remain pending.

`mm_pipeline_run` proves orchestration state. It does not prove that external
product code was edited, built or tested unless that evidence is attached to the
flow.

## Memory Mining

The `src/memory` module implements the Bibliotecario: phase hooks that recall
useful context before PPIRTV phases and record local learning material after
them. The v1 uses local runtime files and preserves `mm_memory_mining` as the
curated promotion path.

Graphify Recall can be enabled as an optional relational recall accelerator for
the Bibliotecario. It is not canonical memory, not a verdict mechanism and not
a promotion path. Graphify-derived hints are marked with `source: graphify`;
`graphify-out/` is derived local output and must not be committed.

When Graphify is enabled or expected, the Bibliotecario return exposes a visual
status instead of hiding failure inside the ledger. Missing graph, timeout,
empty recall and query failure remain tolerated for flow advancement, but become
visible fiscal evidence when the user or residual risk requires
Bibliotecario/Graphify participation before a positive verdict.

`mm_memory_mining` reviews flow learning material, classifies candidates and is
the only path that writes curated memory automatically. With the default
`auto_classify=true` and `write_policy=auto_write`, reusable findings,
recurring trip hazards and prevention rules that classify as writable and
unblocked are written first, then reported back through `written[].files` so the
user can edit, complement or correct them. Consumer diagnostics should use
`write_policy=classify_only`.

When candidates are not written, the response must still explain the destination
instead of returning a silent `written=[]`. `write_decisions` records the action
and reason for each candidate (`written`, `classify_only`, `ledger_only`,
`estacionamento`, `descartar`, `blocked` or `not_writable`), and `edit_queue`
lists candidates the user can improve, approve, park or discard. In
`auto_write`, a strong unwritten candidate without a canonical destination
raises `blocked_verdict=true` with `destination_warnings`.

With the V2 writer selected, callers do not need to know the internal
`v2_destinations`, density or tag fields for an ordinary light memory. Explicit
human intent such as `local deste projeto`, `global/cross-project`, or both is
classified deterministically as `project`, `global`, or dual. An intent that
does not identify a destination remains closed with
`classification_reason=destinations_required`; it never falls back to
`classifier_unavailable` or asks the caller to inspect source code. Explicit
V2 fields remain available for controlled overrides and deep/L3 operations.

For V2 results, `written_count` counts candidate records, while each
`written[].files` is the deduplicated union of files independently reopened and
validated for that candidate. Route-level evidence remains available in
`v2_validation_receipts`; a coordinator receipt alone cannot populate
`written[]`.

`mm_memory_candidate_resolve` is the explicit recovery action for strong
`ledger_only` or otherwise unwritten candidates that block `goal_verdict`. It
records a traceable destination for one or more `candidate_ids`:
`promote`, `park`, `discard` or `accept_ledger_only`. `park` requires `when`,
all actions require `rationale`, and positive `goal_verdict` remains blocked
until `strong_unwritten_count=0` or every strong candidate has a recorded
destination. The tool stores the resolution in flow history/ledger, re-runs
`mm_memory_mining`, and surfaces resolved candidates in `write_decisions` and
`candidate_resolutions`.

After `mm_memory_mining auto_write`, written memory is not treated as
consolidated merely because files changed. The mining result separates
`memory_written`, `memory_validated` and `memory_consolidated`. Post-write
validation is scoped to the files touched by that run and checks the governed
L1/L2/L3 chain expected by `consciencia-memorias`: L1 links to L2, L2 links
back to L1, and auto-written memories create a minimal L3 note plus
`conhecimento/INDEX.md` so L2 and L3 can point to each other. New automatic
memories also carry the review marker `PPIRTV-MM-AUTO-WRITE-REVIEW`
so maintainers can later locate and review them with `consciencia-memorias`.
`memory_review_status=pending_consciencia_memorias` means the capture passed
structural post-write validation and is ready for the current flow; it does not
by itself block a positive `goal_verdict`. `memory_consolidated=true` belongs to
the later owner-approved curation lifecycle.
Post-write findings are also copied to the flow parking lot with the file, line,
code and retry condition, so they do not disappear as technical warnings.
This does not rewrite or invalidate the existing vault by default; legacy
memories are only gated when they are part of the current write or an explicit
review.

`goal_verdict` can carry learning explicitly through `review_findings`,
`verdict_gold_mining` and `verdict_parking_lot`. Review findings and rationale
feed future memory mining, while residual risks and evidence references are
parked with garimpo linked by the Estacionamento/Garimpeiro contract.

`ppirtv_checkout` includes `utility_accountability`: a compact panel of memory
candidates/writes/editables, garimpo, estacionamento, blind spots, material
cooperators and Bibliotecario/Graphify status. This is the fiscal proof that the
MCP produced useful, inspectable state rather than cosmetic layers.

Graphify and the Bibliotecario do not promote canonical memory. They can surface
recall signals; promotion to L1/L2/L3 goes through `mm_memory_mining`.

The tool must not write secrets, private payloads, runtime ledgers or local
workspace state into public files.

## Diagnostics

`npm run diagnostic:bundle` exports a redacted PPIRTV runtime snapshot for one
flow. It is intended for support across machines when the raw `.ppirtv` runtime
must not be shared.

The diagnostic bundle is not proof that product code was edited, built or
tested. It is only a redacted snapshot of PPIRTV orchestration state.

When `goal_verdict` returns `PPIRTV_FISCAL_BLOCKED`, the minimal diagnostic
sequence is:

1. call `goal_status` with the same `flow_id` or `idempotency_key`;
2. inspect `blocker_diagnostics` and `next_required_action`;
3. use `ppirtv_checkout` before retrying the final verdict;
4. provide the missing evidence, meeting, `meeting_id` or cooperation required
   by the diagnostics.

## Security Notes

- Do not commit `.env` files.
- Do not commit runtime ledgers, meetings, evidence or local agent memory.
- Do not record tokens, credentials, authorization headers or sensitive payloads
  in flow content.
- Keep public examples generic and placeholder based.

## Publishing Safety

Before changing repository visibility to public, audit both the current tree and
the Git history for private operational files.

Removing a file from the current tree does not remove it from earlier commits.
Use one of these strategies before making a previously private repository
public:

- publish from a fresh repository with a clean history; or
- rewrite/filter history and verify the result before changing visibility.

## Documentation Roadmap

Current public documentation is intentionally small:

| Priority | Document | Purpose | Status |
| --- | --- | --- | --- |
| Immediate | `README.md` | Public setup, tool map and safety boundary | Current |
| Immediate | `SECURITY.md` | Public vulnerability and secret-handling policy | Current |
| Immediate | `CONTRIBUTING.md` | Public contribution and test workflow | Current |
| Later | Generated tool reference | Public schemas derived from the MCP server | Planned |
