# FlowEngine evolutionary architecture

`LOCALIZER: PPIRTV-FLOW-ENGINE-RESPONSIBILITY-BALANCE`

This is the living public map for editing `src/flow-engine.ts`. It explains
where responsibilities belong, how earlier extractions were performed and what
proof every future editor must provide.

## Exact trigger

> Any diff that changes one line of `src/flow-engine.ts` enters the camping
> gate. Read-only consultation, diagnosis, review, CRG and trace return
> `NOT_APPLICABLE`.

Run:

```powershell
npm run check:flow-engine
node scripts/validate-flow-engine-boundary.mjs --help
```

The fiscal is read-only. It compares Git blobs and the declaration in
`flow-engine-evolution.json`; it never edits or manufactures an abstraction.
An explicit comparison cannot ignore a dirty target worktree.

## Target architecture

```mermaid
flowchart TD
    MCP["server.ts / MCP adapter"] --> FE["FlowEngine facade"]
    FE --> UC["cohesive use cases and coordinators"]
    FE --> POL["pure policies, validation and projection"]
    UC --> STORE["store boundary / adapters"]
```

Dependency direction is downward. A collaborator must not import
`FlowEngine`. The facade preserves public API, error identity, ledger, store,
idempotency and compatibility while policy and new domain decisions live
outside it.

## Invariants

1. New policy, validation, projection, normalization, helper, branch and domain
   type are born outside `flow-engine.ts`.
2. The facade may retain orchestration glue while its seam is unsafe.
3. A new export requires a real product consumer or an external contract;
   an isolated unit test is not a product consumer.
4. One diff moves one cohesive responsibility. No broad rewrite, speculative
   DI, factory, interface or container.
5. A collaborator never reverse-imports `flow-engine.ts`.
6. Public behavior is compared before/after and the collaborator receives a
   direct causal test.
7. LOC is telemetry. Named responsibilities, symbols, decisions, dependency
   direction and product consumers decide the gate.
8. Every material delivery updates this document, the machine ledger and
   `CHANGELOG.md` in the same change.
9. The declared product consumer must use a runtime import of the facade or
   destination; the facade must use a runtime import of the destination.
   Type-only/unused imports and merely naming existing files are not evidence.

## Gate modes

| Mode | Passes when | Fails when |
| --- | --- | --- |
| `NOT_APPLICABLE` | target is absent from the diff | it is used to hide a real target change |
| `SHRINK` | named pre-existing symbols leave the facade, decisions do not grow, behavior is preserved and any open debt is paid | only comments/formatting/other responsibility were removed |
| `CONTAIN` | behavior lives in a collaborator and the facade gains only import/call/result or error adaptation | a hard decision is added/relocated, a helper, symbol, public surface or more than 20 nonblank glue lines enter |
| `EXCEPTION` | integrity, security, public compatibility or urgent hotfix; causal RED, rollback, expiry, at most 30 nonblank lines and two decisions | it follows another exception or lacks bounded proof |
| `FAIL` | — | declaration, structure, owner, consumer, evidence, changelog or debt payment is missing |

`CONTAIN` opens payable debt. A later `CONTAIN` cannot pass while that debt is
open. A bounded `EXCEPTION` may protect an urgent incident, but it does not pay
the debt and cannot be repeated consecutively.

Hard decisions are `if`, ternary, loops, `case` and `catch`; the fiscal tracks
their containing symbol and expression so deleting an unrelated branch cannot
compensate a new one. `&&`, `||` and `??` are separate guard telemetry:
`CONTAIN` permits at most one only as a named `value ?? fallbackCall()`
call/result adaptation; boolean guards are policy and fail.

## Machine declaration

Each real target diff adds one record to
`docs/architecture/flow-engine-evolution.json`. The fiscal matches
`base_blob` and `head_blob`; unrelated deletion cannot pay the record.
After this gate's introduction, the existing ledger is an immutable prefix:
one target diff appends exactly one record, chains from the preceding target
blob and cannot erase or reorder open debt. Only a validated `SHRINK` may set
`pays_debt_id`.

The one-time bootstrap is not a trust shortcut: the fiscal replays every
historical record from its Git blobs/commit, binds `base_blob` to the real
commit parent and rechecks SPT, destination,
runtime consumer edge, causal test selector, architecture and changelog. The
receipt reports `ledger_bootstrap.status`, record count and sealing.
For a merge commit, the record must name `parent_commit`, and it must be one of
the commit's actual parents.

Minimal `SHRINK` example:

```json
{
  "id": "FE-YYYY-MM-DD-SHORT-NAME",
  "mode": "SHRINK",
  "base_blob": "<git blob before>",
  "head_blob": "<git blob after>",
  "spt_path": ".agents/PLAN-TASKS/<trilho>.md",
  "responsibility": "One responsibility that moved",
  "owner": "$oraculo-refatoracao",
  "destination_module": "src/<cohesive-module>.ts",
  "consumers": ["src/server.ts"],
  "evidence": ["tests/<causal-test>.test.ts"],
  "evidence_selectors": {
    "tests/<causal-test>.test.ts": "exact test title or causal selector"
  },
  "changelog_marker": "unique delivered-change phrase",
  "architecture_marker": "FE-YYYY-MM-DD-SHORT-NAME",
  "removed_symbols": ["symbolThatLeftTheFacade"],
  "symbol_mappings": { "symbolThatLeftTheFacade": "symbolInDestination" },
  "same_responsibility": true,
  "behavior_preserved_by": ["tests/<before-after>.test.ts"],
  "pays_debt_id": "FE-DEBT-NNN"
}
```

Evidence paths must exist and include a causal test whose declared selector is
present in the file; `npm run check` executes that test suite. `CHANGELOG.md`
must add a new marker under `Unreleased`, and this document must add the new
`architecture_marker`. Debt records the responsibility that opened it, while
`payment_scope: any_verified_shrink` means any cohesive seam may pay the global
monolith balance — but only through every structural and causal `SHRINK` proof.
An `EXCEPTION` accepts only an ISO
date within 30 days or `next diff that touches src/flow-engine.ts` as expiry,
plus an actionable rollback and an existing `test-path::exact test title` RED
bound to the base blob, observed failure and reproduction command.

Useful blob commands:

```powershell
git rev-parse HEAD:src/flow-engine.ts
git hash-object src/flow-engine.ts
```

## Small-agent decision procedure

1. Is `src/flow-engine.ts` absent from the diff? Return `NOT_APPLICABLE`.
2. Is a named existing responsibility leaving it? Prepare `SHRINK`.
3. Is all new behavior already outside and only glue enters? Prepare
   `CONTAIN`, but first check for open debt.
4. Is this an urgent allowed incident? Prepare bounded `EXCEPTION`.
5. Otherwise stop with `FAIL`; do not guess, compress code or delete unrelated
   lines.
6. Run the fiscal and follow `reasons` plus `next_required_action`.

## Evolution already performed

| Record | Mode | Responsibility | Destination | Result |
| --- | --- | --- | --- | --- |
| `FE-2026-08-01-RECALL-CONSUMPTION` | `SHRINK` | recall reference normalization/validation | `src/memory/recall-consumption-contract.ts` | responsibility removed from facade |
| `FE-2026-08-02-SPT-PATH-DIAGNOSTICS` | `CONTAIN` | actionable `spt_path` diagnostics | `src/spt-path-diagnostics.ts` | new behavior contained; `FE-DEBT-001` later paid by `FE-2026-10-13-GOVERNED-TAG-CONTRACT` |
| `FE-2026-08-11-POST-VERDICT-MINING-GATE` | `EXCEPTION` | prevent terminal completion before post-verdict mining | `FlowEngine` terminal glue | bounded integrity guard with causal MCP RED |
| `FE-2026-10-13-GOVERNED-TAG-CONTRACT` | `SHRINK` | V2 promotion metadata policy (incl. governed tag assertion) | `src/memory/mining-policy.ts` | responsibility removed from facade; pays `FE-DEBT-001` |
| `FE-2026-10-15-FISCAL-BLOCK-TEACHING-MESSAGE` | `CONTAIN` | actionable fiscal-block teaching messages (split codes, state numbers, unblock route) | `src/error-envelope.ts` | glue-only message enrichment (delta 0); `FE-DEBT-002` open |
| `FE-2026-10-17-REVIEW-LOOP-FISCAL-SANE` | `EXCEPTION` | stamp review validity on `evidence_attached`, gate loop-monitor reset on it, truthful review snippet | `src/gate-resolution.ts` | bounded integrity hotfix with causal RED (incident 2026-10-17, ~60 invalid retries); expires next diff that touches `src/flow-engine.ts` |
| `FE-2026-10-18-GATE-INTEGRITY-TYPED-PHASES` | `SHRINK` | phase-transition policy (`phaseAdvanceAllowed`) extracted to the profile SSOT; mechanical fast-track and cross-profile return fail closed | `src/phase-profile.ts` | pays `FE-DEBT-002`; laudo 2026-10-17 F1/F2/F3 closed with causal RED |

`FE-2026-10-18-GATE-INTEGRITY-TYPED-PHASES` pays `FE-DEBT-002` through a
verified cohesive seam: phase-transition policy
(`phaseAdvanceAllowed`, plus `nextPhaseOrThrow` and `assertPhaseInProfile`)
now lives in `src/phase-profile.ts`, the declared SSOT for phase policy.
The mechanical fast-tracks in the facade consult the centralized
`changedFilesContainCode` catalog (`src/gate-resolution.ts`), so a
self-declared `mechanical` risk with code files keeps the full fiscal cycle
(laudo F3); cross-profile returns throw
`PPIRTV_INVALID_PHASE_FOR_PROFILE` before any mutation, unknown transitions
throw `PPIRTV_UNKNOWN_PHASE_TRANSITION`, and unknown phases never count as
terminal (laudo F2). Typed proof requirements (`PROVIDED_REQUIREMENT_KINDS`)
close laudo F1 in `src/gate-resolution.ts`. RED log and bateria live in
`tests/gate-integrity-hardening.test.ts` and
`.agents/AUDITORIAS/EVIDENCIAS/2026-10-17-gate-integrity-red.log`.

`FE-2026-10-17-REVIEW-LOOP-FISCAL-SANE` is a bounded integrity hotfix: the
incident of 2026-10-17 proved that an invalid review evidence resets the
loop-monitor window as false progress (count stayed 0 across ~60 identical
retries, escalation 6/8/9 unreachable). The validity computation lives in
`src/gate-resolution.ts` (`reviewEvidenceValidity`); the facade only stamps
the value on the event (`review_valid`, absent for non-review kinds —
retrocompatible: legacy events without the field keep resetting) and gates
`isLoopResetEvent` on `review_valid !== false`. The review snippet now lists
all `changed_files`. Pays no debt; `FE-DEBT-002` remains open.

`FE-2026-10-15-FISCAL-BLOCK-TEACHING-MESSAGE` pays no debt: the visit only
enriched the fiscal-block throw string with state numbers and split blocker
codes (metrics delta 0) while the projection responsibility lives in
`src/error-envelope.ts` (`PPIRTV-ERRO-QUE-ENSINA-ENVELOPE`). `FE-DEBT-002`
opens for the next fiscal-policy projection seam.

`FE-2026-10-13-GOVERNED-TAG-CONTRACT` pays `FE-DEBT-001` through a verified
cohesive seam (the fiscal accepts `payment_scope: any_verified_shrink`). The
2026-10-13 visit did not touch the post-verdict mining guard: that integrity
seam remains parked for its own causal Trilho (owner
`$oraculo-refatoracao`, `.agents/ESTACIONAMENTO.md`).

## Safe seam sequence

The next target edit must prefer paying `FE-DEBT-001` with one of these small
seams, after fresh mapping and causal baseline:

1. work-progress contract;
2. pipeline-input contract;
3. one family of goal-fiscal policy;
4. blocker guidance or evidence-quality policy;
5. status/checkout projection;
6. meeting coordinator;
7. pipeline runner;
8. goal lifecycle;
9. memory-mining V2 last, because it is more coupled.

The sequence is a candidate map, not permission to extract automatically. The
active SPT selects exactly one seam.

## Ownership and maintenance

- Architecture/extraction owner: `$oraculo-refatoracao` with `$clean-code`
  (since 2026-10-14 by owner decision; the fiscal also accepts the legacy
  `$refactoring-fowler-rich` so the immutable ledger history keeps replaying).
- Changelog owner: `$projeto-manter-changelog`.
- Fiscal script: `scripts/validate-flow-engine-boundary.mjs`; product/CI
  maintainer surface, input Git refs/worktree, output
  `dex.flow-engine.boundary.receipt.v1` JSON.
- Update trigger: the same diff that touches `src/flow-engine.ts`.
- Removal condition: only after another deterministic project gate produces
  all exclusive evidence above and all documented consumers migrate.
