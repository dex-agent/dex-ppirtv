import type { Evidence, Flow, LedgerEvent, Meeting } from "./domain.js";
import { PpirtvStore } from "./store.js";

export type RedactedDiagnosticBundle = {
  generated_at: string;
  source: {
    ppirtv_home: string;
    flow_id: string;
    includes_evidence_content: boolean;
    redaction_policy: string;
  };
  flow: Record<string, unknown>;
  ledger: Array<Record<string, unknown>>;
  meetings: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  redactions_applied: string[];
  limitations: string[];
};

export async function exportRedactedDiagnosticBundle(
  store: PpirtvStore,
  input: { flow_id: string; include_evidence_content?: boolean; ledger_limit?: number }
): Promise<RedactedDiagnosticBundle> {
  const flow = await store.loadFlow(input.flow_id);
  const ledger = await store.readLedger(flow.flow_id);
  const meetings = await store.listMeetings(flow.flow_id);
  const redactions = new Set<string>();
  const includeEvidenceContent = input.include_evidence_content === true;
  const ledgerLimit = Math.max(1, input.ledger_limit ?? 80);
  return {
    generated_at: new Date().toISOString(),
    source: {
      ppirtv_home: store.root,
      flow_id: flow.flow_id,
      includes_evidence_content: includeEvidenceContent,
      redaction_policy: "keys and secret-like values are redacted; .env is never read by this exporter"
    },
    flow: redactedFlow(flow, redactions),
    ledger: ledger.slice(-ledgerLimit).map((event) => redactObject(event, redactions) as Record<string, unknown>),
    meetings: meetings.map((meeting) => redactedMeeting(meeting, redactions)),
    evidence: flow.evidence.map((evidence) => redactedEvidence(evidence, includeEvidenceContent, redactions)),
    redactions_applied: [...redactions].sort(),
    limitations: [
      "diagnostic bundle is a redacted snapshot, not a proof of product-code execution",
      "runtime files absent from this PPIRTV_HOME cannot be reconstructed",
      "evidence content is omitted unless include_evidence_content=true"
    ]
  };
}

function redactedFlow(flow: Flow, redactions: Set<string>): Record<string, unknown> {
  return redactObject(
    {
      flow_id: flow.flow_id,
      goal: flow.goal,
      phase: flow.phase,
      status: flow.status,
      goal_binding: flow.goal_binding,
      blockers: latestFiscalBlockers(flow),
      evidence_ids: flow.evidence.map((evidence) => evidence.evidence_id),
      meeting_ids: flow.meetings,
      verdicts: flow.verdicts,
      updated_at: flow.updated_at
    },
    redactions
  ) as Record<string, unknown>;
}

function redactedMeeting(meeting: Meeting, redactions: Set<string>): Record<string, unknown> {
  return redactObject(
    {
      meeting_id: meeting.meeting_id,
      flow_id: meeting.flow_id,
      kind: meeting.kind,
      status: meeting.status,
      participants_required: meeting.participants_required,
      participants_present: meeting.participants_present,
      decision: meeting.decision,
      satisfies_blockers: meeting.satisfies_blockers,
      evidence_ids: meeting.evidence_ids,
      opened_at: meeting.opened_at,
      closed_at: meeting.closed_at
    },
    redactions
  ) as Record<string, unknown>;
}

function redactedEvidence(evidence: Evidence, includeContent: boolean, redactions: Set<string>): Record<string, unknown> {
  return redactObject(
    {
      evidence_id: evidence.evidence_id,
      flow_id: evidence.flow_id,
      kind: evidence.kind,
      title: evidence.title,
      uri: evidence.uri,
      content: includeContent ? evidence.content : undefined,
      note: includeContent ? evidence.note : undefined,
      content_omitted: !includeContent && Boolean(evidence.content || evidence.note),
      created_at: evidence.created_at
    },
    redactions
  ) as Record<string, unknown>;
}

function latestFiscalBlockers(flow: Flow): unknown {
  const event = [...flow.history].reverse().find((item) => item.type === "fiscal_policy_blocked");
  return event?.data.blocking_reasons ?? [];
}

function redactObject(value: unknown, redactions: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, redactions));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/secret|token|password|api[_-]?key|authorization/i.test(key)) {
        redactions.add(key);
        result[key] = "[redacted]";
      } else {
        result[key] = redactObject(nested, redactions);
      }
    }
    return result;
  }
  return typeof value === "string" ? redactSecretLikeText(value, redactions) : value;
}

function redactSecretLikeText(value: string, redactions: Set<string>): string {
  let output = value.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, () => {
    redactions.add("Authorization");
    return "Authorization: Bearer [redacted]";
  });
  output = output.replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^,\s;]+/gi, (match, key: string) => {
    redactions.add(key);
    return `${key}=[redacted]`;
  });
  return output;
}
