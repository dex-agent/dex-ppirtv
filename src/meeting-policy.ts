import type { AnyPhase, Cooperator, Flow, Meeting, MeetingKind, MeetingType } from "./domain.js";
import type { FiscalVerdictInput } from "./memory/mining-policy.js";
import { explicitMeetingTrigger, fiscalText, MEMORY_MINING_BLOCKED_VERDICT_REASON } from "./verdict-fiscal-policy.js";
import { latestFiscalBlockEvent } from "./verdict-fiscal-policy.js";
import { stringArray, truthy, unique, uniqueCooperators } from "./lang-utils.js";

// Onda 3 da maratona (Trilho 2026-11-08-onda3-meetings-policy): a politica
// PURA de meetings/required_cooperation sai do monolito flow-engine e mora
// aqui — sinais, material, diagnostico, participantes, kind/type, ledger-data,
// apply/assert e as sequencias de unblock de meeting/loop-escalation. A
// fachada (metodos da classe) fica no motor como cola; mensagens preservadas
// byte a byte. Sequencias de OUTROS eixos (review/research/emergency/bad-loop)
// ficam no motor — corte futuro do eixo delas.


export function requiredCooperationStillActive(flow: Flow, input: FiscalVerdictInput = {}): boolean {
  if (explicitMeetingTrigger(fiscalText(flow, input))) {
    return true;
  }
  if (requiredCooperationMeetingIdMissingForPositiveVerdict(flow, input)) {
    return true;
  }
  if (hasClosedMeetingSatisfying(flow, input, "required_cooperation")) {
    return false;
  }
  return requiredCooperationMeetingSignal(flow);
}

export function requiredCooperationMeetingIdMissingForPositiveVerdict(flow: Flow, input: FiscalVerdictInput): boolean {
  if ((input.status !== "pronto" && input.status !== "pronto_com_ressalvas") || inputMeetingIds(input).length > 0) {
    return false;
  }
  return flow.history.some(
    (event, index) =>
      event.type === "meeting_closed" &&
      event.data.participants_minimum_satisfied !== false &&
      truthy(event.data.decision) &&
      stringArray(event.data.satisfies_blockers).includes("required_cooperation") &&
      !hasVerdictRecordedAfterIndex(flow, index)
  );
}

export function requiredCooperationMeetingSignal(flow: Flow): boolean {
  const latestBlock = latestFiscalBlockEvent(flow);
  const latest = latestBlock?.event.data.required_cooperation_diagnostics as Record<string, unknown> | undefined;
  if (!latestBlock) {
    return false;
  }
  if (flow.history.slice(latestBlock.index + 1).some((event) => event.type === "verdict_recorded")) {
    return false;
  }
  if (latest?.explicit_meeting_trigger === true && !explicitMeetingTriggerClearedByFactsUpdate(flow, latestBlock.index)) {
    return true;
  }
  return (
    hasOpenRequiredCooperationMeetingSignal(flow, stringArray(latest?.open_meeting_ids)) ||
    hasInsufficientRequiredCooperationMeetingSignal(flow, stringArray(latest?.insufficient_meeting_ids))
  );
}

export function explicitMeetingTriggerClearedByFactsUpdate(flow: Flow, latestBlockIndex: number): boolean {
  if (explicitMeetingTrigger(fiscalText(flow, {}))) {
    return false;
  }
  return historyAfter(flow, latestBlockIndex).some(
    (event) =>
      event.type === "flow_facts_updated" &&
      Object.keys(event.data).some((key) => ["context", "risks", "uncertainties", "tasks", "done_criteria", "expected_evidence", "decisions", "scope"].includes(key))
  );
}

export function hasOpenRequiredCooperationMeetingSignal(flow: Flow, meetingIds: string[]): boolean {
  return liveOpenMeetingIds(flow).some((meetingId) => meetingIds.includes(meetingId));
}

export function hasInsufficientRequiredCooperationMeetingSignal(flow: Flow, meetingIds: string[]): boolean {
  return flow.history.some(
    (event) =>
      event.type === "meeting_closed" &&
      meetingIds.includes(String(event.data.meeting_id ?? "")) &&
      event.data.participants_minimum_satisfied === false
  );
}

export function liveOpenMeetingIds(flow: Flow): string[] {
  const opened = flow.history
    .filter((event) => event.type === "meeting_opened")
    .map((event) => String(event.data.meeting_id ?? ""))
    .filter(Boolean);
  const closed = new Set(
    flow.history
      .filter((event) => event.type === "meeting_closed")
      .map((event) => String(event.data.meeting_id ?? ""))
      .filter(Boolean)
  );
  return opened.filter((meetingId) => !closed.has(meetingId));
}

export function historyAfter(flow: Flow, index: number): Flow["history"] {
  return flow.history.slice(index + 1);
}

export function hasMaterialMeeting(flow: Flow): boolean {
  return flow.cooperators.some((cooperator) => cooperator.material) || flow.active_credits.length > 0;
}

export function hasMaterialMeetingOrRegress(flow: Flow): boolean {
  const recordedMeeting = flow.history.some((event) => event.type === "meeting_recorded");
  const returned = flow.history.some((event) => event.type === "phase_returned");
  return returned || (recordedMeeting && hasMaterialMeeting(flow));
}

export function hasClosedMeetingSatisfying(flow: Flow, input: FiscalVerdictInput, blocker: string): boolean {
  const meetingIds = inputMeetingIds(input);
  if ((input.status === "pronto" || input.status === "pronto_com_ressalvas") && meetingIds.length === 0) {
    return false;
  }
  return flow.history.some((event) => {
    if (event.type !== "meeting_closed") {
      return false;
    }
    const eventMeetingId = String(event.data.meeting_id ?? "");
    if (meetingIds.length > 0 && !meetingIds.includes(eventMeetingId)) {
      return false;
    }
    if (event.data.participants_minimum_satisfied === false) {
      return false;
    }
    if (!truthy(event.data.decision)) {
      return false;
    }
    return stringArray(event.data.satisfies_blockers).includes(blocker);
  });
}

export function inputMeetingIds(input: FiscalVerdictInput): string[] {
  return unique([input.meeting_id, ...(input.meeting_ids ?? [])].filter(Boolean) as string[]);
}

export function requiredCooperationDiagnostics(
  flow: Flow,
  meetings: Meeting[],
  blockers: string[],
  input: FiscalVerdictInput = {}
): Record<string, unknown> {
  const suggested = uniqueCooperators(meetings.flatMap((meeting) => meeting.suggested_cooperators ?? []));
  const inputIds = inputMeetingIds(input);
  const latestBlock = latestFiscalBlockEvent(flow);
  const latestPersisted = latestBlock?.event.data.required_cooperation_diagnostics as Record<string, unknown> | undefined;
  const persistedInsufficientIds = new Set(
    latestBlock && !hasVerdictRecordedAfterIndex(flow, latestBlock.index) ? stringArray(latestPersisted?.insufficient_meeting_ids) : []
  );
  const eligible = meetings.filter(
    (meeting) =>
      meeting.status === "closed" &&
      meeting.satisfies_blockers.includes("required_cooperation") &&
      missingParticipantsFor(meeting).length === 0 &&
      truthy(meeting.decision) &&
      !meetingConsumedByLaterVerdict(flow, meeting)
  );
  const insufficient = meetings.filter(
    (meeting) =>
      meeting.status === "closed" &&
      meeting.participants_required.length > 0 &&
      missingParticipantsFor(meeting).length > 0 &&
      (persistedInsufficientIds.has(meeting.meeting_id) || requiredCooperationMeetingMaterial(flow, meeting, inputIds, latestBlock?.index ?? null))
  );
  const inputMissingMeetingId =
    (input.status === "pronto" || input.status === "pronto_com_ressalvas") && inputMeetingIds(input).length === 0 && eligible.length > 0;
  const persistedMissingForVerdict = inputMeetingIds(input).length > 0 ? [] : stringArray(latestPersisted?.missing_for_verdict);
  const missingForVerdict = unique([...(inputMissingMeetingId ? ["meeting_id"] : []), ...persistedMissingForVerdict]);
  const participantsRequired = requiredMeetingParticipants(blockers);
  const missingParticipants = unique(insufficient.flatMap((meeting) => missingParticipantsFor(meeting)));
  return {
    suggested_count: suggested.length,
    suggested,
    participants_required: participantsRequired,
    open_meeting_ids: meetings
      .filter((meeting) => meeting.status !== "closed" && requiredCooperationMeetingMaterial(flow, meeting, inputIds, latestBlock?.index ?? null))
      .map((meeting) => meeting.meeting_id),
    eligible_meeting_ids: eligible.map((meeting) => meeting.meeting_id),
    insufficient_meeting_ids: insufficient.map((meeting) => meeting.meeting_id),
    missing_participants: missingParticipants,
    missing_for_verdict: missingForVerdict,
    distinction: "suggested_cooperators nao sao active_credits nem participants_present; required_cooperation exige participants_present e meeting_id no goal_verdict positivo"
  };
}

export function missingParticipantsFor(meeting: Meeting): string[] {
  return meeting.participants_required.filter((participant) => !meeting.participants_present.includes(participant));
}

export function requiredCooperationMeetingMaterial(flow: Flow, meeting: Meeting, inputMeetingIdsForVerdict: string[], latestBlockIndex: number | null): boolean {
  if (inputMeetingIdsForVerdict.includes(meeting.meeting_id)) {
    return true;
  }
  if (meeting.satisfies_blockers.includes("required_cooperation")) {
    return true;
  }
  if (!meetingHasRequiredCooperationParticipants(meeting)) {
    return false;
  }
  return meetingLinkedToFiscalBlock(flow, meeting, latestBlockIndex);
}

export function meetingHasRequiredCooperationParticipants(meeting: Meeting): boolean {
  const requiredParticipants = requiredMeetingParticipants(["required_cooperation"]);
  return requiredParticipants.every((participant) => meeting.participants_required.includes(participant));
}

export function meetingLinkedToFiscalBlock(flow: Flow, meeting: Meeting, latestBlockIndex: number | null): boolean {
  if (latestBlockIndex === null) {
    return false;
  }
  const openedIndex = meetingOpenedIndex(flow, meeting.meeting_id);
  if (openedIndex === null) {
    return false;
  }
  if (openedIndex > latestBlockIndex) {
    return true;
  }
  const previousBlockIndex = previousFiscalBlockIndex(flow, latestBlockIndex);
  return previousBlockIndex !== null && openedIndex > previousBlockIndex;
}

export function meetingOpenedIndex(flow: Flow, meetingId: string): number | null {
  const index = flow.history.findIndex((event) => event.type === "meeting_opened" && String(event.data.meeting_id ?? "") === meetingId);
  return index >= 0 ? index : null;
}

export function meetingClosedIndex(flow: Flow, meetingId: string): number | null {
  const index = flow.history.findIndex((event) => event.type === "meeting_closed" && String(event.data.meeting_id ?? "") === meetingId);
  return index >= 0 ? index : null;
}

export function previousFiscalBlockIndex(flow: Flow, beforeIndex: number): number | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (flow.history[index]?.type === "fiscal_policy_blocked") {
      return index;
    }
  }
  return null;
}

export function meetingConsumedByLaterVerdict(flow: Flow, meeting: Meeting): boolean {
  const closedIndex = meetingClosedIndex(flow, meeting.meeting_id);
  return closedIndex !== null && flow.history.slice(closedIndex + 1).some(
    (event) => event.type === "verdict_recorded" && (
      stringArray(event.data.meeting_ids).includes(meeting.meeting_id) ||
      !Object.prototype.hasOwnProperty.call(event.data, "meeting_ids")
    )
  );
}

export function meetingOutcomeSummaries(flow: Flow): Array<Record<string, unknown>> {
  return flow.meetings.map((meetingId) => {
    const closedIndex = meetingClosedIndex(flow, meetingId);
    if (closedIndex === null) {
      const wasRecorded = flow.history.some(
        (event) => event.type === "meeting_recorded" && String(event.data.meeting_id ?? "") === meetingId
      );
      return meetingOutcomeSummary(meetingId, wasRecorded ? "recorded_legacy" : "open", null);
    }
    const laterEvents = flow.history.slice(closedIndex + 1);
    const exactConsumption = laterEvents.find(
      (event) =>
        (event.type === "goal_regressed" && String(event.data.meeting_id ?? "") === meetingId) ||
        (event.type === "verdict_recorded" && stringArray(event.data.meeting_ids).includes(meetingId))
    );
    if (exactConsumption) {
      return meetingOutcomeSummary(
        meetingId,
        exactConsumption.type === "goal_regressed" ? "consumed_by_regress" : "consumed_by_verdict",
        {
          at: exactConsumption.at,
          event_type: exactConsumption.type,
          consumer_id: exactConsumption.type === "verdict_recorded" ? String(exactConsumption.data.verdict_id ?? "") || null : null
        }
      );
    }
    const hasUnattributedLegacyVerdict = laterEvents.some(
      (event) => event.type === "verdict_recorded" && !Object.prototype.hasOwnProperty.call(event.data, "meeting_ids")
    );
    return meetingOutcomeSummary(meetingId, hasUnattributedLegacyVerdict ? "unattributed_legacy" : "closed_unconsumed", null);
  });
}

export function meetingOutcomeSummary(
  meetingId: string,
  traceabilityStatus: "open" | "recorded_legacy" | "closed_unconsumed" | "consumed_by_regress" | "consumed_by_verdict" | "unattributed_legacy",
  consumption: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    meeting_id: meetingId,
    traceability_status: traceabilityStatus,
    consumed: traceabilityStatus === "consumed_by_regress" || traceabilityStatus === "consumed_by_verdict",
    reusable: traceabilityStatus === "closed_unconsumed",
    reuse_reason: traceabilityStatus === "closed_unconsumed"
      ? "closed result has no later attributed or legacy verdict"
      : traceabilityStatus === "unattributed_legacy"
        ? "legacy verdict prevents safe reuse without inventing attribution"
        : "meeting is not an eligible unconsumed closed result",
    consumption,
    semantic_effectiveness: "not_measured",
    evidence_rule: "meeting close, presence, turns, findings and credits never prove effectiveness; attributed consumption requires a later event with the exact meeting_id"
  };
}

export function meetingOutcomeCounts(flow: Flow): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const outcome of meetingOutcomeSummaries(flow)) {
    const status = String(outcome.traceability_status);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

export function hasVerdictRecordedAfterIndex(flow: Flow, historyIndex: number): boolean {
  return flow.history.slice(historyIndex + 1).some((event) => event.type === "verdict_recorded");
}

export function requiredCooperationNeedsMeetingIdRetry(flow: Flow, meetings: Meeting[]): boolean {
  const latest = latestFiscalBlockEvent(flow);
  if (!latest) {
    return false;
  }
  const latestDiagnostics = latest.event.data.required_cooperation_diagnostics as Record<string, unknown> | undefined;
  const missingForVerdict = stringArray(latestDiagnostics?.missing_for_verdict);
  if (!missingForVerdict.includes("meeting_id")) {
    return false;
  }
  const verdictRecordedAfterBlock = flow.history.slice(latest.index + 1).some((event) => event.type === "verdict_recorded");
  if (verdictRecordedAfterBlock) {
    return false;
  }
  return stringArray(requiredCooperationDiagnostics(flow, meetings, ["required_cooperation"]).eligible_meeting_ids).length > 0;
}

export function meetingKindForType(type?: MeetingType): MeetingKind | undefined {
  if (!type) {
    return undefined;
  }
  if (type === "convergent") {
    return "convergente";
  }
  if (type === "transversal") {
    return "transversal";
  }
  if (type === "decision") {
    return "decisao";
  }
  return "divergente";
}

export function meetingTypeForKind(kind: MeetingKind): MeetingType {
  if (kind === "convergente") {
    return "convergent";
  }
  if (kind === "transversal") {
    return "transversal";
  }
  if (kind === "decisao") {
    return "decision";
  }
  return "divergent";
}

export function requiredMeetingKind(flow: Flow, blockers: string[], regressLimitReached: boolean): MeetingKind {
  if (regressLimitReached) {
    return "decisao";
  }
  if (!hasClosedMeetingKind(flow, "divergente")) {
    return "divergente";
  }
  if (!hasClosedMeetingKind(flow, "convergente")) {
    return "convergente";
  }
  if (
    blockers.some((blocker) => ["hygiene_blocking", "memory_required_but_empty", MEMORY_MINING_BLOCKED_VERDICT_REASON, "review_required", "librarian_status"].includes(blocker)) &&
    !hasClosedMeetingKind(flow, "transversal")
  ) {
    return "transversal";
  }
  return "convergente";
}

export function hasClosedMeetingKind(flow: Flow, kind: MeetingKind): boolean {
  return flow.history.some((event) => event.type === "meeting_closed" && String(event.data.kind) === kind);
}

export function requiredMeetingParticipants(blockers: string[]): string[] {
  const participants = ["chato", "questionador", "reuniao", "validador-pronto"];
  if (blockers.some((blocker) => ["memory_required_but_empty", MEMORY_MINING_BLOCKED_VERDICT_REASON].includes(blocker))) {
    participants.push("garimpeiro", "dex-memoria");
  }
  if (blockers.includes("review_required")) {
    participants.push("revisor-codigo");
  }
  if (blockers.includes("hygiene_blocking")) {
    participants.push("tio-testador");
  }
  if (blockers.includes("librarian_status") || blockers.includes("attempt_regress_count")) {
    participants.push("ancora-fluxo", "ppi");
  }
  return unique(participants);
}

export function meetingClosedLedgerData(meeting: Meeting): Record<string, unknown> {
  return {
    meeting_id: meeting.meeting_id,
    flow_id: meeting.flow_id,
    type: meeting.type,
    kind: meeting.kind,
    opened_at: meeting.opened_at,
    closed_at: meeting.closed_at,
    participants_required: meeting.participants_required,
    participants_present: meeting.participants_present,
    questions: meeting.questions,
    findings: meeting.findings,
    decision: meeting.decision,
    next_required_action: meeting.next_required_action,
    satisfies_blockers: meeting.satisfies_blockers,
    created_by: meeting.created_by,
    evidence_ids: meeting.evidence_ids
  };
}

export function applyClosedMeetingToFlow(flow: Flow, meeting: Meeting, at: string): Record<string, unknown> {
  const missingParticipants = missingParticipantsFor(meeting);
  const data = {
    ...meetingClosedLedgerData(meeting),
    missing_participants: missingParticipants,
    participants_minimum_satisfied: missingParticipants.length === 0
  };
  flow.decisions = unique([...flow.decisions, ...meeting.decisions]);
  flow.risks = unique([...flow.risks, ...meeting.risks]);
  flow.parking_lot = unique([...flow.parking_lot, ...meeting.parking_lot]);
  flow.gold_mining = unique([...flow.gold_mining, ...meeting.gold_mining]);
  flow.cooperators = uniqueCooperators([...flow.cooperators, ...meeting.cooperators]);
  flow.active_credits = unique([...flow.active_credits, ...meeting.active_credits]);
  flow.updated_at = at;
  flow.history.push({ at, type: "meeting_closed", data });
  return data;
}

export function assertMeetingClosed(meeting: Meeting): void {
  if (meeting.status !== "closed") {
    throw new Error(`MEETING_NOT_CLOSED: ${meeting.meeting_id}; status=${meeting.status}`);
  }
}

export function latestOpenMeeting(meetings: Meeting[], kind?: MeetingKind): Meeting | undefined {
  return [...meetings]
    .reverse()
    .find((meeting) => meeting.status !== "closed" && (!kind || meeting.kind === kind));
}

export function requiredCooperationSequence(
  flow: Flow,
  meetingId: string,
  meetingKind: MeetingKind,
  blockers: string[],
  backTo: AnyPhase | null,
  meetingAlreadyOpen: boolean
): Array<Record<string, unknown>> {
  const participants = requiredMeetingParticipants(blockers);
  const sequence: Array<Record<string, unknown>> = [];
  if (!meetingAlreadyOpen) {
    sequence.push({
      order: sequence.length + 1,
      tool: "goal_meeting_open",
      purpose: "abrir reuniao material uma unica vez para resolver required_cooperation",
      args: {
        flow_id: flow.flow_id,
        kind: meetingKind,
        question: "Resolver required_cooperation antes de novo veredito positivo",
        participants_required: participants
      },
      capture: "meeting_id"
    });
  }
  sequence.push(
    {
      order: sequence.length + 1,
      tool: "goal_meeting_add_turn",
      purpose: "registrar fala material do Chato/Questionador com E SE, por que, origem, destino e principios",
      args: {
        flow_id: flow.flow_id,
        meeting_id: meetingId,
        speaker: "chato",
        question: "E SE falhar? por que liberar? qual origem/destino/gatilho? estamos seguindo nossos principios?",
        finding: "required_cooperation exige decisao material antes de qualquer veredito positivo"
      }
    },
    {
      order: sequence.length + 2,
      tool: "goal_meeting_close",
      purpose: "fechar a reuniao com decisao, participantes materiais e blocker satisfeito",
      args: {
        flow_id: flow.flow_id,
        meeting_id: meetingId,
        participants_present: participants,
        findings: ["required_cooperation analisado com materialidade"],
        decision: "Reuniao material fechada; required_cooperation satisfeito ou pendencia explicitada.",
        satisfies_blockers: ["required_cooperation"]
      }
    }
  );
  if (backTo) {
    sequence.push({
      order: sequence.length + 1,
      tool: "goal_regress",
      purpose: "registrar regresso rastreavel antes de nova tentativa de veredito",
      args: {
        flow_id: flow.flow_id,
        to: backTo,
        reason: "required_cooperation resolvido por reuniao material; regressar para fase fiscal correta",
        meeting_id: meetingId
      }
    });
  }
  sequence.push({
    order: sequence.length + 1,
    tool: "goal_status",
    purpose: "confirmar ausencia de required_cooperation antes de repetir goal_verdict",
    args: { flow_id: flow.flow_id }
  });
  return sequence;
}

export function loopEscalationAction(flow: Flow, blockers: string[], backTo: AnyPhase | null, loopMonitor: LoopMonitor | null): Record<string, unknown> | null {
  if (!loopMonitor?.escalation.active) {
    return null;
  }
  const common = {
    loop_id: loopMonitor.loop_id,
    loop_count: loopMonitor.count,
    blockers,
    back_to: backTo,
    can_retry_verdict: false,
    loop_guard: "nao repetir a mesma acao enquanto loop_monitor.escalation.active=true; executar a sequencia de escalonamento e confirmar goal_status"
  };
  if (loopMonitor.count >= 9) {
    return {
      ...common,
      type: "bad_loop_review_work",
      tool: "evidence_add",
      reason: "9 ocorrencias na mesma janela sem progresso: acionar estacionamento e garimpeiro, documentar achados e finalizar como LOOP RUIM REVISAR TRABALHO",
      required_tool_sequence: badLoopReviewSequence(flow, loopMonitor)
    };
  }
  if (loopMonitor.count >= 8) {
    return {
      ...common,
      type: "emergency_meeting",
      tool: "goal_meeting_open",
      reason: "8 ocorrencias: abrir reuniao de emergencia com provocacao e especialistas extras em divergencia/convergencia/transversal",
      required_tool_sequence: emergencyLoopSequence(flow, loopMonitor)
    };
  }
  if (loopMonitor.count >= 6) {
    return {
      ...common,
      type: "research_subagent_request",
      tool: "subagent_research_request",
      reason: "6 ocorrencias: pedir pesquisa organizada antes de continuar tentando a mesma correcao",
      required_tool_sequence: researchLoopSequence(flow, loopMonitor)
    };
  }
  if (loopMonitor.count >= 5) {
    return {
      ...common,
      type: "divergence_transversal_meetings",
      tool: "goal_meeting_open",
      reason: "5 ocorrencias: abrir reunioes divergente e transversal para quebrar premissa repetida",
      required_tool_sequence: loopMeetingSequence(flow, loopMonitor, ["divergente", "transversal"])
    };
  }
  return {
    ...common,
    type: "convergence_transversal_meetings",
    tool: "goal_meeting_open",
    reason: "3 ocorrencias: abrir reunioes convergente e transversal para decidir recuperacao sem falso-verde",
    required_tool_sequence: loopMeetingSequence(flow, loopMonitor, ["convergente", "transversal"])
  };
}

export function loopMeetingSequence(flow: Flow, loopMonitor: LoopMonitor, kinds: MeetingKind[]): Array<Record<string, unknown>> {
  const participants = requiredMeetingParticipants(loopMonitor.blockers);
  const sequence: Array<Record<string, unknown>> = kinds.flatMap((kind, index) => {
    const meetingId = `<${kind}_meeting_id>`;
    return [
      {
        order: index * 3 + 1,
        tool: "goal_meeting_open",
        purpose: `abrir reuniao ${kind} para loop_id=${loopMonitor.loop_id}`,
        args: {
          flow_id: flow.flow_id,
          kind,
          question: `Loop ${loopMonitor.loop_id} repetiu ${loopMonitor.count} vezes. O que muda agora para nao repetir a mesma acao?`,
          participants_required: participants
        },
        capture: meetingId
      },
      {
        order: index * 3 + 2,
        tool: "goal_meeting_add_turn",
        purpose: "registrar provocacao material do Chato/Questionador antes do fechamento",
        args: {
          flow_id: flow.flow_id,
          meeting_id: meetingId,
          speaker: "chato",
          question: "E SE a proxima tentativa for so repeticao? qual origem, destino, responsavel e evidencia nova?",
          finding: `loop_id=${loopMonitor.loop_id}; blockers=${loopMonitor.blockers.join(", ")}`
        }
      },
      {
        order: index * 3 + 3,
        tool: "goal_meeting_close",
        purpose: `fechar reuniao ${kind} com decisao e proxima acao diferente`,
        args: {
          flow_id: flow.flow_id,
          meeting_id: meetingId,
          participants_present: participants,
          findings: [`Loop ${loopMonitor.loop_id} analisado em reuniao ${kind}.`],
          decision: "Definir acao nova, evidencia nova ou bloqueio explicito antes de repetir tentativa.",
          satisfies_blockers: []
        }
      }
    ];
  });
  return sequence.concat([{ order: kinds.length * 3 + 1, tool: "goal_status", purpose: "confirmar loop_monitor e blockers apos reunioes", args: { flow_id: flow.flow_id } }]);
}

export function cooperationCheckoutAccountability(flow: Flow): Record<string, unknown> {
  const material = flow.cooperators.filter((cooperator) => cooperator.material);
  const suggested = suggestedCooperatorsForFlow(flow);
  return {
    suggested_count: suggested.length,
    suggested,
    material_count: material.length,
    material,
    all: flow.cooperators,
    active_credits: flow.active_credits,
    merits: material.map((cooperator) => ({
      name: cooperator.name,
      reason: cooperator.reason,
      merit_source: "recorded_material_cooperator",
      credits: flow.active_credits.filter((credit) => credit.toLowerCase().includes(cooperator.name.toLowerCase()))
    })),
    summary:
      material.length > 0
        ? `cooperadores materiais: ${material.map((cooperator) => cooperator.name).join(", ")}`
        : suggested.length > 0
          ? "cooperadores sugeridos registrados; nenhum credito material automatico"
          : "nenhum cooperador material registrado"
  };
}

export function suggestedCooperatorsForFlow(flow: Flow): Cooperator[] {
  return uniqueCooperators(
    flow.history.flatMap((event) => {
      if (event.type !== "meeting_opened") {
        return [];
      }
      const suggested = event.data.suggested_cooperators;
      return Array.isArray(suggested) ? (suggested as Cooperator[]) : [];
    })
  );
}


// Emenda do desenho: a familia unblock-sequencer (sequencias irmas + monitor)
// acompanha o corte — loopMeetingSequence chama research/emergency/badLoop, e o
// monitor decide entre elas; separar seria meio-cluster.

export type LoopMonitor = {
  loop_id: string;
  signature: string;
  blockers: string[];
  count: number;
  fiscal_block_count: number;
  gate_block_count: number;
  terminal_block_count: number;
  review_regress_count: number;
  reset_policy: string;
  escalation: {
    active: boolean;
    level:
      | "monitoring"
      | "convergence_transversal"
      | "divergence_transversal"
      | "research_subagent"
      | "emergency_meeting"
      | "bad_loop_review_work";
    threshold: number | null;
    label: string;
  };
};


export function researchLoopSequence(flow: Flow, loopMonitor: LoopMonitor): Array<Record<string, unknown>> {
  const workspace = flow.goal_binding?.envelope.workspace ?? "<WORKSPACE>";
  return [
    {
      order: 1,
      tool: "subagent_research_request",
      purpose: "acionar pesquisador organizado com contexto minimo e salvar pesquisa em .agents/PESQUISA",
      args: {
        skill: "pesquisador-organizado",
        repo: workspace,
        mission: `Pesquisar causa e saidas para loop ${loopMonitor.loop_id} com blockers ${loopMonitor.blockers.join(", ")} sem ler segredos.`,
        objective: "troubleshooting",
        required_outputs: ["relatorio", "raw-notes.md", "sources.json"]
      },
      skill_resolution: researcherSkillResolution(workspace)
    },
    {
      order: 2,
      tool: "evidence_add",
      purpose: "anexar relatorio da pesquisa como evidencia antes de nova tentativa",
      args: {
        flow_id: flow.flow_id,
        kind: "research_report",
        title: `Pesquisa organizada para ${loopMonitor.loop_id}`,
        content: "Anexar caminho do relatorio .agents/PESQUISA e achados principais.",
        satisfies: ["loop_research_required"]
      }
    },
    { order: 3, tool: "goal_status", purpose: "confirmar se a pesquisa mudou a proxima acao", args: { flow_id: flow.flow_id } }
  ];
}

export function emergencyLoopSequence(flow: Flow, loopMonitor: LoopMonitor): Array<Record<string, unknown>> {
  const participants = ["chato", "questionador", "entrevista-me", "reuniao", "garimpeiro", "estacionamento", "revisor-codigo", "tio-testador", "validador-pronto", "ppi"];
  return [
    {
      order: 1,
      tool: "goal_meeting_open",
      purpose: "abrir reuniao de emergencia com especialistas extras",
      args: {
        flow_id: flow.flow_id,
        kind: "decisao",
        question: `EMERGENCIA: loop ${loopMonitor.loop_id} chegou a ${loopMonitor.count}. Que premissa falsa esta mantendo o trabalho preso?`,
        participants_required: participants
      },
      capture: "emergency_meeting_id"
    },
    {
      order: 2,
      tool: "goal_meeting_add_turn",
      purpose: "registrar provocacao adversarial de emergencia",
      args: {
        flow_id: flow.flow_id,
        meeting_id: "<emergency_meeting_id>",
        speaker: "chato",
        question: "A PERGUNTA PRINCIPAL: estamos seguindo nossos principios ou repetindo ferramenta sem aprendizado?",
        finding: `loop_id=${loopMonitor.loop_id}; decretar mudanca de estrategia antes de qualquer veredito.`
      }
    },
    {
      order: 3,
      tool: "goal_meeting_close",
      purpose: "fechar emergencia com decisao, estacionamento e acao nova",
      args: {
        flow_id: flow.flow_id,
        meeting_id: "<emergency_meeting_id>",
        participants_present: participants,
        findings: [`Loop ${loopMonitor.loop_id} exige emergencia fiscal.`],
        decision: "Nao repetir a mesma acao; escolher acao nova ou preparar encerramento LOOP RUIM.",
        satisfies_blockers: []
      }
    },
    { order: 4, tool: "goal_status", purpose: "confirmar estado apos emergencia", args: { flow_id: flow.flow_id } }
  ];
}

export function badLoopReviewSequence(flow: Flow, loopMonitor: LoopMonitor): Array<Record<string, unknown>> {
  const workspace = flow.goal_binding?.envelope.workspace ?? "<WORKSPACE>";
  return [
    {
      order: 1,
      tool: "use_skill",
      purpose: "acionar estacionamento para selecionar achados, pendencias e pontos cegos vivos",
      args: { skill: "estacionamento", flow_id: flow.flow_id, loop_id: loopMonitor.loop_id, action: "selecionar achados e pendencias do loop" },
      skill_resolution: cooperatorSkillResolution(workspace, "estacionamento", "Fila viva de achados, pendencias, pontos cegos e retomada do loop.")
    },
    {
      order: 2,
      tool: "use_skill",
      purpose: "acionar garimpeiro para separar ouro, armadilha recorrente e descarte",
      args: { skill: "garimpeiro", flow_id: flow.flow_id, loop_id: loopMonitor.loop_id, action: "curar achados reutilizaveis do loop" },
      skill_resolution: cooperatorSkillResolution(workspace, "garimpeiro", "Curador de aprendizados reutilizaveis, armadilhas recorrentes e descarte honesto.")
    },
    {
      order: 3,
      tool: "evidence_add",
      purpose: "documentar encerramento fiscal do loop ruim",
      args: {
        flow_id: flow.flow_id,
        kind: "bad_loop_report",
        title: "LOOP RUIM REVISAR TRABALHO",
        content: `loop_id=${loopMonitor.loop_id}; count=${loopMonitor.count}; blockers=${loopMonitor.blockers.join(", ")}; achados estacionados e garimpados antes de finalizar.`,
        satisfies: ["bad_loop_documented"]
      }
    },
    {
      order: 4,
      tool: "goal_verdict",
      purpose: "finalizar sem falso-verde: decretar bloqueado/nao_pronto",
      args: {
        flow_id: flow.flow_id,
        status: "bloqueado",
        rationale: "LOOP RUIM REVISAR TRABALHO: limite de repeticao atingido sem progresso suficiente.",
        evidence_ids: ["<bad_loop_report_evidence_id>"],
        residual_risks: ["trabalho precisa ser revisado antes de nova tentativa"],
        next_step: "revisar metodo, contrato e evidencias antes de reabrir"
      }
    }
  ];
}

export function reviewRequiredSequence(flow: Flow): Array<Record<string, unknown>> {
  const scopeReference = flow.changed_files[0] ?? flow.scope.in[0] ?? "<required:exact scope.in or changed_files reference>";
  const reviewedTargets = [...flow.changed_files];
  if (reviewedTargets.length === 0) {
    reviewedTargets.push(scopeReference);
  }
  return [
    {
      order: 1,
      tool: "evidence_add",
      purpose: "anexar revisao explicita com achados reais, riscos, escopo revisado e decisao",
      args: {
        flow_id: flow.flow_id,
        kind: "code_review",
        title: "Revisao adversarial do SPT / artefatos finais",
        content:
          "Escopo revisado: <required:arquivos/artefatos revisados>. Achados: <required:lista real de achados>. Riscos: <required:risco residual>. Decisao: <required:bloquear ou liberar com ressalva>.",
        satisfies: ["diff_reviewed", "barata_scan", "regression_risks"],
        observed_result: {
          diff_reviewed: true,
          reviewed_targets: reviewedTargets,
          barata_scan: true,
          searched_patterns: ["<required:padroes ou consumidores vizinhos realmente pesquisados>"],
          findings: [],
          regression_risks: []
        },
        scope_classification: "target",
        scope_reference: scopeReference,
        reviewed_implementation_fingerprint: "<required:copie de goal_status.implementation_fingerprint>",
        operator_must_replace: [
          "content",
          "observed_result.reviewed_targets",
          "observed_result.searched_patterns",
          "observed_result.findings",
          "observed_result.regression_risks"
        ]
      },
      capture: "review_evidence_id"
    },
    {
      order: 2,
      tool: "goal_status",
      purpose: "confirmar que review_required saiu dos blockers antes de qualquer veredito",
      args: { flow_id: flow.flow_id }
    },
    {
      order: 3,
      tool: "goal_verdict",
      purpose: "somente se goal_status nao listar review_required; incluir evidence_ids e review_findings reais",
      only_if: "goal_status.blockers nao contem review_required",
      args: {
        flow_id: flow.flow_id,
        status: "pronto_com_ressalvas",
        evidence_ids: ["<review_evidence_id>", "<evidence_ids_obrigatorias>"],
        review_findings: ["<achado real de review>"],
        rationale: "Veredito apos review explicita e blockers fiscais resolvidos.",
        next_step: "arquivar ou executar pendencia rastreavel"
      }
    }
  ];
}


const USER_PROFILE_POINTER = "$env:USERPROFILE";

// Resolucao de skills de cooperacao — consumida pelas sequencias de unblock
// (eixo do cluster; motor nao usa direto).


function researcherSkillResolution(workspace: string): Record<string, unknown> {
  return {
    required_skill: "pesquisador-organizado",
    lookup_paths: [
      `${USER_PROFILE_POINTER}\\.agents\\skills\\pesquisador-organizado\\SKILL.md`,
      `${USER_PROFILE_POINTER}\\.codex\\skills\\pesquisador-organizado\\SKILL.md`,
      `${workspace}\\.agents\\skills\\pesquisador-organizado\\SKILL.md`
    ],
    if_missing: {
      action: "create_local_skill",
      target: `${workspace}\\.agents\\skills\\pesquisador-organizado\\SKILL.md`,
      role: "Pesquisador Organizado local: pesquisar causas, fontes e saidas para destravar loop ruim, salvar relatorio em .agents/PESQUISA e retornar evidencias rastreaveis.",
      minimum_contract: [
        "nao ler .env, config.toml, tokens, cookies, Authorization ou payload sensivel",
        "usar fontes locais permitidas e web/oficial quando disponivel",
        "salvar relatorio, raw-notes.md e sources.json em .agents/PESQUISA",
        "registrar lacunas e nao declarar conclusao forte sem evidencia",
        "retornar caminhos dos artefatos e achados principais"
      ],
      gate: "permitido como fallback local quando a skill global nao existir; registrar evidencia da criacao"
    },
    fallback: {
      action: "execute_local_contract",
      evidence_required: true,
      merit_rule: "nao vira merito automatico; material=true somente se pesquisa executada e evidenciada"
    }
  };
}

export function cooperatorSkillResolution(workspace: string, skill: string, role: string): Record<string, unknown> {
  return {
    required_skill: skill,
    lookup_paths: [
      `${USER_PROFILE_POINTER}\\.agents\\skills\\${skill}\\SKILL.md`,
      `${USER_PROFILE_POINTER}\\.codex\\skills\\${skill}\\SKILL.md`,
      `${workspace}\\.agents\\skills\\${skill}\\SKILL.md`
    ],
    if_missing: {
      action: "execute_inline_fallback_or_create_local_skill_proposal",
      target: `${workspace}\\.agents\\skills\\${skill}\\SKILL.md`,
      role,
      gate: "criar skill local somente se a ausencia bloquear o fluxo ou virar erro recorrente; caso contrario executar fallback resumido"
    },
    fallback: {
      action: "execute_local_summary_contract",
      evidence_required: true,
      merit_rule: "nao vira merito automatico; material=true somente se houve contribuicao registrada e evidenciada"
    }
  };
}
