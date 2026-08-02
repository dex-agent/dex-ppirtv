# Documentation Index

Public documentation for `dex-PPIRTV`. Runtime schemas exposed by MCP
`tools/list` are authoritative for tool invocation; documents explain the
workflow, invariants and failure recovery without replacing those schemas.

## Leitor alvo

Agents, MCP consumers and maintainers looking for the shortest authoritative
route into the public documentation.

## Objetivo

Make every public guide and contract discoverable without relying on chat
history, a private workspace or remembered paths.

## Fonte viva

- MCP `tools/list` for live tool schemas.
- `src/server.ts` and tests for current behavior.
- `docs/contracts/GOAL_SPT_CANONICAL_CONTRACT.md` for GOAL/SPT invariants.

## Escopo

This index covers versioned public documentation under `docs/`. Maintainer
state under `.agents/` is outside the public documentation boundary.

## Confirmado, inferido e lacunas

- Confirmed: every document listed below exists in this repository revision.
- Inferred: none; descriptions are routing summaries, not behavior claims.
- Gap: generated per-tool reference remains planned; use `tools/list` now.

## Start here

- [MCP quickstart for agents](guides/MCP_AGENT_QUICKSTART.md) — minimal GOAL
  flow, `tools/list` as help, evidence examples, FAQ and troubleshooting.
- [Cross-repository problem report contract](contracts/CROSS_REPO_PROBLEM_REPORT_CONTRACT.md)
  — reproducible and sanitized handoff format for consumer repositories.
- [FlowEngine evolutionary architecture](architecture/FLOW_ENGINE_EVOLUTION.md)
  — mandatory edit gate, living extraction map, machine ledger and safe seam
  sequence for the monolithic facade.

## Architecture

- [Architecture index](architecture/INDEX.md).
- [FlowEngine evolution ledger](architecture/flow-engine-evolution.json) —
  Git-blob-bound declarations consumed by the read-only fiscal.

## Contracts

- [Canonical GOAL/SPT contract](contracts/GOAL_SPT_CANONICAL_CONTRACT.md) —
  current SPT v3 execution contract and readable legacy rules.
- [GOAL execution bridge](contracts/GOAL_EXECUTION_BRIDGE.md) — integration
  bridge between the public workflow and runtime tools.
- [Principles synchronization contract](contracts/PRINCIPLES_SYNC_CONTRACT.md)
  — relationship between canonical principles and the repository copy.
- [ADR 0007: shared principles memory](adr/0007-shared-principles-memory.md).

## Publication rule

A new public guide or operational document is not considered published until:

1. `README.md` links it directly;
2. this index lists it;
3. Git includes the document rather than excluding it through `.gitignore`;
4. local link validation and an `rg` discoverability check pass; and
5. maintainer workspaces also link it from local `AGENTS.md` and `INDEX.md`
   when those ignored operational surfaces exist.

`LOCALIZER: PPIRTV-PUBLIC-DOCS-INDEX`

## Validação

Validate local links, then search each published path in `README.md`,
`AGENTS.md`, this file and the root `INDEX.md`.

## Não validado

This index does not execute documented MCP calls or prove their behavior.

## Manutenção

- Owner: `documentacao-tecnica / Dora Docs`.
- Trigger: a public document is created, moved, renamed or retired.
- When: in the same governed change, before its final verdict.
