# Cross-Repository Problem Report Contract

Use this contract when a repository consuming `dex-PPIRTV` finds a defect,
contradiction, missing schema, unclear error or runtime mismatch that the
`dex-PPIRTV` owner must investigate.

`LOCALIZER: PPIRTV-CROSS-REPO-PROBLEM-REPORT`

The report is evidence to confirm, not authority over architecture and not
permission to implement. The receiving owner must reproduce or use another
independent oracle before deciding a correction.

## Leitor alvo

Agents and maintainers in a consumer repository that need to transfer a
technical finding to the `dex-PPIRTV` owner.

## Objetivo

Produce a self-contained, reproducible and sanitized report that lets the
receiver confirm facts independently before making an architectural decision.

## Fonte viva

- The consumer's live MCP `tools/list`, runtime identity and observed receipt.
- Versioned source, tests and contracts cited by the report.
- The canonical handoff method in `dex-handoff-laudo-tecnico-reproduzivel`.

## Escopo

Included: diagnostic transfer across repository/ownership boundaries.
Excluded: implementation authorization, SPT execution, historical rewriting
and unsanitized private payloads.

## Confirmado, inferido e lacunas

- Confirmed: the required shape below preserves identity, reproduction,
  evidence, knowledge classification, provenance and owner reception.
- Inferred: none; individual report conclusions remain evidence to confirm.
- Gap: a report may still depend on unavailable external access; it must then
  declare partial or blocked reproduction.

## Destination and publication

Save the source report as:

```text
<CONSUMER-REPOSITORY>/.agents/REPORTS/YYYY-MM-DD-handoff-<slug>.md
```

The consumer must index it in `.agents/REPORTS/INDEX.md` and publish a short
bridge in `.agents/HANDOFF.md` with owner, state, next step and `when`. If an
explicit write restriction prevents those links, write
`HANDOFF.md não atualizado por restrição explícita`, keep discovery
pending, name the owner and state when the bridge must be added.

## Machine-readable front matter

```yaml
---
type: cross-repo-reproducible-handoff
version: 1
status: '<reproducible | partially_reproducible | blocked>'
origin_repository: '<portable-repository-identity>'
owner_repository: dex-PPIRTV
owner: '<receiving-owner>'
created_at: '<ISO-8601>'
source_branch: '<branch-or-not-applicable>'
source_head: '<commit-or-not-applicable>'
affected_tool: '<MCP-tool-contract-or-component>'
severity: '<P0 | P1 | P2 | P3>'
sanitized: '<true-only-after-check | false>'
next_step: '<one-verifiable-action>'
when: '<date-event-dependency-or-trigger>'
---
```

Do not invent an unavailable value. Use `not confirmed` or `not applicable`
and explain the resulting limit.

## Required report body

```markdown
# HANDOFF TO dex-PPIRTV

## Executive summary

## Identity and environment
- Origin repository:
- Branch and HEAD:
- Runtime/tool version:
- Build present on disk:
- Connected process/session generation:
- Restart or reconnect performed:

## Observed behavior
- Input:
- Operation:
- Sanitized output:
- Observed impact:

## Expected result under evaluation
Do not present this section as an approved contract.

## Minimal reproduction
### Preconditions
### Synthetic fixture
### Exact ordered steps
### Complete command or MCP payload
### Sanitized response
### Cleanup or rollback

## Schema visible to the consumer
- Relevant `tools/list` description:
- Required fields:
- Difference from the attempted payload:

## Traceable evidence
| Evidence | Versioned location | Observed value | Current value | Limit |
|---|---|---|---|---|

## Relevant source
| File | Symbol, heading or search pattern | Lines as temporal aid | Role |
|---|---|---:|---|

## Attempts
| Attempt | Payload or action | Result | Difference from previous attempt |
|---|---|---|---|

## Confirmed facts
## Inferences
## Unexplained gaps
## Risks

## Contract separation
- Current behavior confirmed:
- Current contract proven:
- Expected contract proposed:
- Architectural intent: confirmed | not confirmed

## Provenance
- Artifact type: original | retrospective | reconciliation | archaeology | unknown
- Creation time:
- Event it explains:
- Proof of original execution:
- Limits:

## Actions explicitly not performed

## Suggested acceptance criteria

## Receiver confirmation checklist
- [ ] Reproduced independently or used another independent oracle.
- [ ] Classified each finding as confirmed, refuted, superseded or still uncertain.
- [ ] Confirmed repository, runtime and process identity.
- [ ] Separated factual confirmation from architectural decision.
- [ ] Checked compatibility and neighboring occurrences.
- [ ] Created a separate Trilho/SPT before implementation, when implementation is required.

## Reproduction state
Choose exactly one: REPRODUCIBLE | PARTIALLY REPRODUCIBLE | BLOCKED BY MISSING EVIDENCE

## Investigation verdict
Choose exactly one: READY | READY WITH CAVEATS | BLOCKED
```

## Evidence rules

- Record the exact payload or command in execution order.
- Include the relevant sanitized response or a stable artifact locator.
- Distinguish build on disk from the process actually connected to the client.
- Combine path and commit/hash with a symbol, heading, field, test or search
  pattern. Line numbers alone are not stable locators.
- Separate confirmed facts, inferences, gaps and risks.
- Separate current behavior, proven contract and proposed expectation.
- State every attempted variation; do not report only the final attempt.
- Use a synthetic fixture whenever live data is unnecessary.
- Never include secrets, cookies, authorization headers, `.env`, passwords,
  private payloads or personal data. Declare categories removed without
  reproducing their values.

## Receiver protocol

The `dex-PPIRTV` owner must:

1. confirm or refute each finding using live sources;
2. reproduce independently or record why an independent oracle is absent;
3. keep the source report immutable as historical evidence;
4. create a separate SPT that points back to the report if implementation is
   accepted;
5. link `finding -> confirmation -> decision -> test -> implementation -> verdict`;
6. return divergences to the source repository instead of silently rewriting
   the report.

## Validação

- Validate required headings and local links.
- Confirm the report can be understood without the originating conversation.
- Re-run the minimal reproduction or another independent oracle.
- Verify sanitization and the continuity bridge before accepting the handoff.

## Não validado

Structural compliance does not prove that a report's diagnosis or proposed
contract is correct. The receiving owner still decides factual confirmation,
architecture and implementation.

## Manutenção

- Owner: `dex-handoff-laudo-tecnico-reproduzivel` with the `dex-PPIRTV`
  contract owner.
- Update trigger: the MCP runtime identity, evidence schema, sanitization rules
  or owner-reception protocol changes.
- When: in the same governed change that modifies one of those contracts.
