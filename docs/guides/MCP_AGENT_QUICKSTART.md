# MCP Quickstart for Agents

Use this guide when an agent needs to operate `dex-PPIRTV` without prior
repository context. It is intentionally short enough for smaller models.

`LOCALIZER: PPIRTV-MCP-AGENT-QUICKSTART`

## Leitor alvo

MCP-capable agents, including smaller models, that know how to call tools but
do not know the local PPIRTV conventions.

## Objetivo

Let the reader discover the live schema, start one valid SPT v3 flow, attach
coherent evidence, recover from common errors and close without hidden context.

## Fonte viva

- MCP `tools/list`, `runtime_probe` and `goal_status` from the connected process.
- [`GOAL_SPT_CANONICAL_CONTRACT.md`](../contracts/GOAL_SPT_CANONICAL_CONTRACT.md).
- `src/server.ts`, `src/flow-engine.ts` and related tests in the same revision.

## Escopo

Included: new SPT v3 execution, minimum tool order, criterion evidence, review,
FAQ and recovery. Excluded: installation, every optional tool field, internal
ledger layout and consumer-specific deployment.

## Confirmado, inferido e lacunas

- Confirmed: the sequence and error names are backed by the live schema,
  canonical contract and current tests.
- Inferred: a smaller model benefits from the short route; this is tested as a
  bounded reader task, not as a universal model guarantee.
- Gap: there is no static generated reference for every tool; use `tools/list`.

## Authority order

1. Call MCP `tools/list` and use the live `inputSchema` plus tool description
   as the equivalent of `--help` for each tool.
2. Use the [canonical GOAL/SPT contract](../contracts/GOAL_SPT_CANONICAL_CONTRACT.md)
   for workflow invariants, evidence semantics and complete examples.
3. Use this quickstart for the minimum safe sequence and common recovery.

If a copied example disagrees with `tools/list`, stop and use the live schema.
A persistent MCP client can retain an old schema after a build; restart or
reconnect it, call `tools/list` again and record the new process/session when
the difference matters.

## New execution requires SPT v3

The following preconditions and contract checks apply before creating a new
official execution flow.

## Pré-condições

- An MCP connection to the intended `dex-PPIRTV` workspace.
- An absolute workspace and SPT path.
- A version 3 SPT with a literal objective and explicit execution authority.
- No secrets or private payloads in the planned evidence.

For a new official execution, the Trilho must use YAML front matter with:

```yaml
dex_contract: spt
version: 3
status: AUTORIZADO
```

SPT v2 remains readable for history, exact retry and explicit
`recovery`/`reconciliation`; it does not authorize a new execution. Heading-
only SPT v1 is not executable.

Before `goal_start`, call `spt_validate` and require all of these:

```text
valid=true
contract_version=3
execution_eligible=true
missing=[]
contract_errors=[]
```

The `objective` passed to `goal_start` must match `goal.objective` literally.

## Passos

Minimum GOAL sequence:

1. `runtime_probe` — confirm the active `project_root`, runtime and memory
   writer before creating state.
2. `spt_validate` — validate the absolute SPT path and literal objective.
3. `goal_start` — start or reuse the official flow with one stable
   `idempotency_key`.
4. `goal_status` — read phase blockers and the exact next action.
5. `goal_advance` — advance only after the current phase gate passes.
6. `evidence_add` — attach real evidence bound to the final revision and, for
   SPT v3 criteria, include `criterion_proof`.
7. Add an independent structured review when `review_required` is present.
8. Run memory mining when the flow requires it and resolve strong unwritten
   candidates before the verdict.
9. `goal_verdict` — record a positive or negative verdict with evidence IDs.
10. Inspect `goal_status`, call the guarded terminal `goal_advance`, then use
    `ppirtv_checkout`. A positive verdict alone is not terminal completion.

Do not guess missing fields. The current `goal_status.next_required_action`
and live tool schema are the recovery interface.

## Resultado esperado

The flow reaches terminal `status=complete` only after criteria, review,
verdict and closure blockers are satisfied. The final receipt identifies the
flow, revision evidence, residual risks and next step with a verifiable `when`.

## `criterion_proof` shape

The runtime derives the expected value and operator from the bound SPT. The
caller supplies the observed value and revision identity.

```json
{
  "criterion_proof": {
    "task_id": "A-03",
    "requirement_id": "REQ-02",
    "criterion_id": "C-02",
    "evidence_requirement_id": "ER-03",
    "observed_value": true,
    "revision_set": [
      {
        "workspace": "C:\\workspace",
        "head": "0123456789abcdef0123456789abcdef01234567",
        "paths": [
          {
            "path": "src/example.ts",
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
          }
        ]
      }
    ],
    "environment": "Windows; Node.js 22; focused test",
    "producer": "test-runner",
    "timestamp": "2026-08-02T17:00:00.000Z",
    "limits": ["Local proof; another operating system was not exercised"]
  }
}
```

Important nesting rules:

- `environment` is a sibling of `revision_set` inside `criterion_proof`.
- A strict `revision_set` item accepts only `workspace`, optional `head`, and
  `paths`.
- A strict path item accepts only `path` and `sha256`.

## Structured review evidence

When `reviewed_implementation_fingerprint` is supplied:

- `kind` must be `code_review` or `review`;
- `satisfies` must include at least one of `diff_reviewed`, `barata_scan` or
  `regression_risks`; and
- the fingerprint must identify the current implementation revision.

Otherwise `evidence_add` fails with
`REVIEW_ATTESTATION_CLAIMS_REQUIRED`. The server does not create a successful
evidence receipt and silently discard the fingerprint.

## Falhas comuns

FAQ and troubleshooting:

### Is there an `evidence_add --help` command?

No. MCP tools are not CLI subcommands. Call `tools/list`; its live schema and
description are the machine-readable help.

### Why did the schema reject `environment` inside `revision_set`?

Because `environment` belongs directly to `criterion_proof`. Move it beside
`revision_set`; do not add it to an individual revision item.

### Why is `review_required` still blocked after `evidence_add`?

Inspect the evidence receipt and `goal_status`. The review must be structured,
cover the current implementation fingerprint, use a review-like `kind`, name
reviewed targets and declare material review claims. Free text or a verdict
does not satisfy the review gate.

### Why does a correct file on disk not change what my client sees?

The MCP process may be persistent. Rebuild if necessary, restart/reconnect the
consumer, then call `runtime_probe` and `tools/list` from the new process.

### Why did a positive verdict not complete the flow?

Verdict recording and terminal transition are separate. Read
`phase_advance_allowed`, `closure_blockers` and `next_required_action`, resolve
the remaining gates, then call `goal_advance` for the terminal transition.

### How should another repository report a defect?

Use the [cross-repository problem report contract](../contracts/CROSS_REPO_PROBLEM_REPORT_CONTRACT.md).
The report is evidence for the owner to confirm independently; it is never an
SPT or implementation authorization.

## Safety

Never place tokens, cookies, authorization headers, passwords, `.env` values
or private payloads in evidence, reports, examples or logs. Prefer a synthetic
fixture and declare which categories were sanitized.

## Validação

- Run the repository documentation regression test.
- Validate local Markdown links.
- Compare every tool/field claim with a fresh `tools/list`.
- Perform a reader forward-test without supplying the hidden answer or paths.

## Não validado

This guide does not prove a specific commercial model version will always
follow instructions. The live process and consumer integration still require
their own runtime smoke.

## Manutenção

- Owner: `documentacao-tecnica / Dora Docs` with the MCP contract owner.
- Update trigger: a tool schema, SPT version, gate sequence, public error or
  evidence contract changes.
- When: in the same Trilho that changes the public behavior, before its final
  verdict.
