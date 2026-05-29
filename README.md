# dex-PPIRTV

FileVersion: 0.2.0

`dex-PPIRTV` is a local MCP stdio server for running PPIRTV execution flows with
explicit phases, gates, meetings, evidence, verdicts, memory mining and
multi-flow pipelines.

PPIRTV means:

```text
Pensamentos -> Planejamento -> Implementacao -> Revisao -> Teste -> Validacao
```

The server does not replace engineering judgment. It gives agents and local
clients a structured way to keep work visible, resumable and evidence based.

## Status

This package currently provides:

- low-level PPIRTV flow tools;
- official `goal_*` wrappers for GOAL/SPT execution;
- `mm_memory_mining` for classified memory mining and safe writes;
- `mm_pipeline_run` for sequential execution of multiple PPIRTV flows;
- runtime persistence in a local store;
- tests for the engine and MCP stdio behavior.

## Public Boundary

This repository is intended to publish source code, tests, package metadata,
fallback principles, templates and this README.

The following paths are intentionally local-only and ignored:

- `.agents/`
- `.codex/`
- `.ppirtv/`
- `artifacts/`
- `docs/`
- `examples/`
- `skills/`
- `AGENTS.md`
- `INDEX.md`
- `CONTEXT.md`
- `DOCS.md`
- `PLAN.md`
- `REFERENCE.md`
- `SPEC.md`
- `SPRINTS.md`
- `TASKS.md`
- `setup-ppirtv-repo.ps1`
- `.env`
- local backup files matching `*--backup.*`

Those files may exist in a maintainer workspace for planning, agent context,
handoff or implementation history. They are not part of the public package.

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

## Run

```bash
npm start
```

The MCP process should be started with `cwd` set to the workspace being operated
on. Runtime flow state is written under that workspace unless `PPIRTV_HOME` is
configured.

Minimal MCP server configuration shape:

```json
{
  "command": "node",
  "args": ["dist/index.js"],
  "cwd": "<workspace-or-repo-root>",
  "env": {
    "PPIRTV_HOME": "<local-runtime-state-dir>",
    "PPIRTV_PRINCIPLES_PATH": "<optional-operational-contract-json>"
  }
}
```

Do not point `PPIRTV_HOME` at a public or versioned directory.

## Runtime State

By default, the store uses a local runtime directory named `.ppirtv` under the
current workspace. You can override it with `PPIRTV_HOME`.

Runtime state can include:

- flows;
- meetings;
- evidence;
- ledger events.

That state is operational data, not source code.

## Principle Contract Resolution

The server resolves the operational principles contract in this order:

1. `PPIRTV_PRINCIPLES_PATH`, when explicitly configured.
2. The shared user principles contract, when present.
3. `principles/operational-contract.json` in the current workspace.
4. The versioned fallback contract shipped in this repository.

If a fallback is used, `hygiene_scan` reports it so clients do not mistake a
default for a project-specific contract.

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

Official GOAL/SPT tools:

- `spt_validate`
- `goal_start`
- `goal_status`
- `goal_resume`
- `goal_gate_check`
- `goal_advance`
- `goal_meeting_open`
- `goal_meeting_record`
- `evidence_add`
- `goal_verdict`

Memory and pipeline tools:

- `mm_memory_mining`
- `mm_pipeline_run`

## Typical GOAL/SPT Flow

1. Validate an SPT with `spt_validate`.
2. Start or reuse a flow with `goal_start`.
3. Inspect live state with `goal_status`.
4. Open and record meetings with `goal_meeting_open` and
   `goal_meeting_record` when a real decision, risk or ambiguity exists.
5. Check gates with `goal_gate_check`.
6. Advance with `goal_advance`.
7. Attach evidence with `evidence_add`.
8. Close with `goal_verdict`.

Positive verdicts require traceable evidence.

## Multi-Flow Pipelines

Use `mm_pipeline_run` only when the request contains more than one SPT/flow or
an explicit batch execution.

Each pipeline item becomes a normal PPIRTV flow. If `stop_on_failure=true`, a
failed item blocks the pipeline and later items remain pending.

`mm_pipeline_run` proves orchestration state. It does not prove that external
product code was edited, built or tested unless that evidence is attached to the
flow.

## Memory Mining

`mm_memory_mining` reviews flow learning material, classifies candidates and can
write valid memory entries according to the active memory contract.

The tool must not write secrets, private payloads, runtime ledgers or local
workspace state into public files.

## Security Notes

- Do not commit `.env` files.
- Do not commit runtime ledgers, meetings, evidence or local agent memory.
- Do not record tokens, credentials, authorization headers or sensitive payloads
  in flow content.
- Keep public examples generic and placeholder based.
- Before publishing a repository publicly, audit both the current tree and the
  Git history for private operational files.

## Documentation Roadmap

Current public documentation is intentionally small:

| Priority | Document | Purpose | Status |
| --- | --- | --- | --- |
| Immediate | `README.md` | Public setup, tool map and safety boundary | Current |
| Short term | `CONTRIBUTING.md` | Public contribution and test workflow | Planned |
| Short term | `SECURITY.md` | Public vulnerability and secret-handling policy | Planned |
| Later | Generated tool reference | Public schemas derived from the MCP server | Planned |

Development notes, internal plans and agent handoff files should stay outside
the public package unless they are rewritten as stable public documentation.
