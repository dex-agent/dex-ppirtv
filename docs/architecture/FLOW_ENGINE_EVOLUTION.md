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
| `FE-2026-10-18-GATE-INTEGRITY-F4F5F6` | `EXCEPTION` | secret-like rejection at the three entrypoints, stale-gate snapshot invalidation and snapshot-checked reuse | `src/gate-resolution.ts` | bounded integrity guard (laudo F4/F5) with causal RED; expires next diff that touches `src/flow-engine.ts` |
| `FE-2026-10-18-MEMORY-GATE-LOOP-SHRINK` | `SHRINK` | memory-mining policy predicates and loop-window math (append-only history, reconciliation-id guard) | `src/memory/mining-policy.ts` | 12 symbols leave the facade (-142 nonblank); pays no debt (`FE-DEBT-002` already paid by TYPED-PHASES); SPT memory-gate-loop-solubility, decisao A |
| `FE-2026-10-18-GATE-INTEGRITY-HARDENING-2` | `EXCEPTION` | fail-closed guards for the revalidation laudo (R1-R10: return direction, typed proof, review currency, secret choke points, declarative proof, inverted documental allowlist, preflight diagnostics) | `src/gate-resolution.ts` + `src/security/secret-redaction.ts` | causal RED (10/2) in `.agents/AUDITORIAS/EVIDENCIAS/2026-10-18-hardening2-red.log`; +12 nonblank, 2 symbols out (secret asserts to SSOT); SPT gate-integrity-hardening-2 |
| `FE-2026-10-18-GIT-CORROBORATION-COMMITS-SHRINK` | `SHRINK` | current-implementation fingerprint over the corroborated changed_files set; freeze `git_head_base` at first `goal_start`, corroborate commits via `git diff base..HEAD` at verdict, fail closed on orphan base, and exclude `.git/`/`.ppirtv/`/`.agents/` runtime noise from corroboration | `src/review-snapshot.ts` | symbol `flowWithCurrentImplementationFingerprint` leaves the facade; pays `FE-DEBT-003`; RED-first `tests/git-corroboration-commits.test.ts` 4/4 (commit-then-verdict burla NOVO-1 + falso positivo NOVO-2); SPT gate-integrity-hardening-3 |
| `FE-2026-10-18-GATE-INTEGRITY-HARDENING-3` | `EXCEPTION` | strict changed_files/deleted_files paths, current structured review on stale same-path review gates, and Git-diff corroboration at verdict | `src/gate-resolution.ts` + `src/review-snapshot.ts` | bounded integrity guard; RED probes A/A2/B/G; SPT gate-integrity-hardening-3; expires next diff that touches `src/flow-engine.ts` |
| `FE-2026-10-18-INPUT-NEVER-BLOCKING-F2-SHRINK` | `SHRINK` | input never-blocking front 2/3: deep `{"value": X}` unwrap at the single boundary, read-only tools never reject on form, persisted `provided` replay sanitized before merge, legacy-tolerant path normalization; spt_path classification substrate (`resolveSptPath`/`isDirectory`/`isFile`/`isInsideOrEqual`/`isSensitivePath`) leaves the facade | `src/input-unwrap.ts` + `src/spt-path-diagnostics.ts` | pays `FE-DEBT-001`; acceptance = consumer transcript replay `tests/consumer-replay-jumper.test.ts` 4/4 (goal_status full responds on dirty persisted gate; evidence_add wrapped arrays arrive flat); SPT input-nunca-bloqueante-frentes-2 |
| `FE-2026-10-26-VERDICT-FISCAL-POLICY-SHRINK` | `SHRINK` | verdict fiscal policy CCP tree (P1): fiscal nucleus (`evaluateFiscalPolicy`, `fiscalResult`/`requiredCoo`/`cooReason`, `fiscalMateriality`, `fiscalText`, `materialRiskText`, meeting triggers, `codeReviewRequired`, `hasReviewEvidence`, `recurringRisk`, `hasEnoughAttempts`, `regressLimitReached`) leaves the facade with explicit `FiscalPolicyDeps` bridges to neighbor axes until their own future cuts; facade keeps thin wrappers and call glue | `src/verdict-fiscal-policy.ts` | behavior preserved by suite 716|4 with zero test edits + probe A-F v2 6/6 on rebuilt dist; SPT verdict-fiscal-policy-tree |

`FE-2026-10-18-MEMORY-GATE-LOOP-SHRINK` removes the last in-facade mining
policy cluster: twelve predicates and helpers (`noMemoryWasPromoted`,
`memoryRequiredByFlow`, `memoryMiningCompletedWithNoCandidates`,
`memoryMiningStructurallyPromoted`, `memoryPostWriteValidationBlocks`,
`numericMemoryField`, `memoryIntentText`, `hasVerdictAfterLatestMemoryMining`,
`blockerSignature`, `loopWindowEvents`, `isLoopResetEvent`, type
`FiscalVerdictInput`) now live in `src/memory/mining-policy.ts`, the SSOT
already opened by `FE-2026-10-13-GOVERNED-TAG-CONTRACT`. The same visit lands
the decisao A fix for the insoluble memory-gate loop (SPT
memory-gate-loop-solubility): flow history is fully append-only — every
mining attempt appends its own `memory_mined` event — while idempotency lives
only in the V2 ledger keyed by reconciliation id, and `loopWindowEvents`
resets the escalation window only when the reconciliation id differs from the
previous mining (a duplicate re-mining after a positive verdict is not
progress; legacy events without an id still reset). Causal RED:
`.agents/AUDITORIAS/EVIDENCIAS/2026-10-18-memory-gate-loop-red.log`
(1 failed | 3 passed at base `695b439`); post-fix battery
`tests/memory-gate-loop.test.ts` (4 tests) plus the adapted recovery contract
in `tests/flow-engine-dex-memoria-v2.test.ts`; full suite 653 passed |
4 skipped. Pays no debt — `FE-DEBT-002` was already paid by
`FE-2026-10-18-GATE-INTEGRITY-TYPED-PHASES`.

`FE-2026-10-18-GATE-INTEGRITY-F4F5F6` is a bounded integrity exception (laudo
F4/F5, SPT gate-integrity-f4f5f6): the facade only gained pure-call guards —
`assertNoSecretLikePayload` at `createFlow`/`updateFlowFactsUnlocked`/
`startGoalUnlocked` (secret-like payload is rejected BEFORE persisting; the
`pipeline_evidence` attach now declares `satisfies: item.expected_evidence`),
plus `changed_files_snapshot` stamping, `invalidateStaleDownstreamGates` and
snapshot-checked `shouldReuseSavedGate`. All policy lives in
`src/gate-resolution.ts` (`gateSnapshotMatches`,
`invalidateStaleDownstreamGates`, `genericEvidenceSatisfied`). Causal RED:
F5 scenario D (`gate revisao passed + novo arquivo em changed_files
bloqueia o avanço sem nova revisao`) plus F4/F6 REDs in
`.agents/AUDITORIAS/EVIDENCIAS/2026-10-18-gate-integrity-f4f5f6-red.log`.
Pays no debt — `FE-DEBT-002` was later paid by `FE-2026-10-18-GATE-INTEGRITY-TYPED-PHASES`(stale claim fixed by hardening-2 on 2026-10-18).

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
Pays no debt — `FE-DEBT-002` was later paid by `FE-2026-10-18-GATE-INTEGRITY-TYPED-PHASES`(stale claim fixed by hardening-2 on 2026-10-18).

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

`FE-2026-10-18-GATE-INTEGRITY-HARDENING-2` (EXCEPTION, integrity) adds the
fail-closed guards demanded by the revalidation laudo of 2026-10-18:
`assertPhaseTransitionDirection` blocks forward `flow_return`/`goal_regress`
(`src/phase-profile.ts` SSOT), gate requirements carry `kind` and unknown or
mistyped proof fails closed, `GateRecord` stamps and rechecks
`implementation_fingerprint` for review-currency phases
(`reviewCurrencyAppliesToPhase`), contract-SPT risks pass the central secret
guard at the `validateSpt` choke point, approved `criterion_proof` satisfies
the generic evidence requirement, the documental allowlist is inverted
(extensionless build files are code), and `goal_gate_preflight` exposes the
promised `field`/`received`/`expected` diagnostic. All policy lives in
`src/gate-resolution.ts`, `src/phase-profile.ts` and
`src/security/secret-redaction.ts`; the facade keeps only guard calls
(+12 nonblank; the two local secret asserts moved to the redaction SSOT).
Causal RED: 10 failed / 2 passed at `598ae5d`
(`.agents/AUDITORIAS/EVIDENCIAS/2026-10-18-hardening2-red.log`), battery
`tests/gate-integrity-revalidation.test.ts` (13 tests), full suite 666
passed / 4 skipped. Expires: next diff that touches `src/flow-engine.ts`.


### Hardening-3 (2026-10-18)

FE-2026-10-18-GATE-INTEGRITY-HARDENING-3 is a bounded CONTAIN with
FE-DEBT-003 open. Policy moved to the SSOTs: strictPathArray /
mergePathFacts / reviewCurrencyMissing in src/gate-resolution.ts and
gitChangedFiles / withGitCorroboratedChangedFiles in
src/review-snapshot.ts. The facade keeps only call/result glue. RED probes
A/A2/B/G at .agents/AUDITORIAS/EVIDENCIAS/2026-10-18-hardening3-red.log;
battery tests/gate-integrity-hardening-3.test.ts covers R2/R3/R6. R5 remains
a documented decision: generic evidence still accepts a passed
criterion_proof; the review gate content binding is enforced by R3, not by
a phase-specific proof filter. A future contract can add that filter. R7 has
a documented post-commit seal exception: 598ae5d per-commit replay fails
because its record commit was added in 76e9c94; the cumulative replay and
76e9c94/947fdb4 replays PASS.

### Mining deposit visibility (2026-10-27)

FE-2026-10-27-MINING-DEPOSIT-VISIBILITY-CONTAIN is a glue-only CONTAIN with
FE-DEBT-004 open. The mining deposit visibility policy (when the summary
must expose the empty funnel via `nuggets_collected` +
`deposit_guidance`) lives in the SSOT `src/memory/mining-policy.ts`
(`EMPTY_MINING_DEPOSIT_GUIDANCE` + pure projection
`emptyMiningDepositGuidance`); the facade only projects the call into the
legacy summary/return and the `mineMemoryV2` summary/return — 8 nonblank
glue lines, zero new decision points, guards, symbols or exports in the
monolith. Causal RED: 9 failed / 0 passed preserved at
`.agents/AUDITORIAS/EVIDENCIAS/2026-10-27-mining-deposit-red.log`; suite
`tests/mining-deposit-visibility.test.ts` (9 tests, both writer paths +
unblock route + delphi build vocabulary). Debt FE-DEBT-004 (payable by any
verified shrink): move the mining summary/return projection fill out of the
facade into the mining SSOT when a safe seam exists. FE-DEBT-001/002/003
are already paid (`FE-2026-10-13-GOVERNED-TAG-CONTRACT`,
`FE-2026-10-18-GATE-INTEGRITY-TYPED-PHASES`,
`FE-2026-10-18-GIT-CORROBORATION-COMMITS-SHRINK`).

## Safe seam sequence

`FE-DEBT-001` was paid by `FE-2026-10-13-GOVERNED-TAG-CONTRACT`; `FE-DEBT-002` by
`FE-2026-10-18-GATE-INTEGRITY-TYPED-PHASES`. `FE-DEBT-003` is open (CONTAIN
`FE-2026-10-18-GATE-INTEGRITY-HARDENING-3`): extract the remaining path/review/Git
guard glue from the facade when a safe seam exists. The sequence below is a candidate map for future extractions,
selected one seam at a time by the active SPT, after fresh mapping and causal baseline:

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
