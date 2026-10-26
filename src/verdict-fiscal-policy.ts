// Eixo fiscal do verdict — árvore CCP da maratona (P1 verdict-fiscal-policy-tree).
// Migrou de src/flow-engine.ts em 2026-10-26 (Trilho
// .agents/PLAN-TASKS/2026-10-26-verdict-fiscal-policy-tree.md) com comportamento
// preservado. Dependências de eixos vizinhos (memória/hygiene/librarian/meetings/
// review-currency/regress-count) entram via FiscalPolicyDeps até os cortes futuros
// desses eixos; imports diretos só do que já é módulo (mining-policy, gate-resolution).
import type { Cooperator, Evidence, Flow, Verdict } from "./domain.js";
import {
  memoryRequiredByFlow,
  noMemoryWasPromoted,
  type FiscalVerdictInput
} from "./memory/mining-policy.js";
import { changedFilesContainCode, isStructuredReviewEvidence } from "./gate-resolution.js";

export type FiscalPolicyResult = {
  material: boolean;
  blocking_reasons: string[];
  required_cooperation: Cooperator[];
  meeting_policy: {
    required: boolean;
    rotation: string[];
    repertoire: string[];
    objective: string;
  };
  direct_action: string;
};

export interface FiscalPolicyDeps {
  memoryMiningBlockedReason: string;
  maxRegressions: number;
  hasHygieneBlocking(flow: Flow): boolean;
  librarianRequired(flow: Flow, input: FiscalVerdictInput): boolean;
  latestLibrarianStatus(flow: Flow): { status?: string } | null | undefined;
  inputMeetingIds(input: FiscalVerdictInput): string[];
  hasVerdictRecordedAfterIndex(flow: Flow, index: number): boolean;
  latestFiscalBlockEvent(flow: Flow): { event: Flow["history"][number]; index: number } | null | undefined;
  hasClosedMeetingSatisfying(flow: Flow, input: FiscalVerdictInput, blocker: string): boolean;
  requiredCooperationStillActive(flow: Flow, input: FiscalVerdictInput): boolean;
  countRegressions(flow: Flow): number;
  countHistory(flow: Flow, type: string): number;
  truthy(value: unknown): boolean;
  stringArray(value: unknown): string[];
  unique(items: string[]): string[];
  changedFilesMatchReview(changedFiles: string[], reviewedChangedFiles: string[] | undefined): boolean;
  reviewedChangedFilesForVerdict(flow: Flow, verdict: Verdict): string[] | undefined;
  reviewRemainsCurrent(flow: Flow, verdict: Verdict): boolean;
}

export function evaluateFiscalPolicyWithDeps(
  flow: Flow,
  input: FiscalVerdictInput,
  deps: FiscalPolicyDeps
): FiscalPolicyResult {
  const material = fiscalMateriality(flow, input, deps);
  const blockingReasons: string[] = [];
  if (!material) {
    return fiscalResultWithDeps(false, [], deps);
  }

  if (memoryRequiredByFlow(flow, input) && noMemoryWasPromoted(flow, input.memory_mining)) {
    blockingReasons.push("memory_required_but_empty");
  }
  if (deps.hasHygieneBlocking(flow)) {
    blockingReasons.push("hygiene_blocking");
  }
  if (codeReviewRequired(flow, input) && !hasReviewEvidenceWithDeps(flow, input, deps)) {
    blockingReasons.push("review_required");
  }
  if (deps.librarianRequired(flow, input) && deps.latestLibrarianStatus(flow)?.status !== "recalled") {
    blockingReasons.push("librarian_status");
  }
  if (recurringRisk(input) && regressLimitReached(flow, input, deps)) {
    blockingReasons.push("attempt_regress_count", "attempt_regress_limit_reached");
  } else if (recurringRisk(input) && !hasEnoughAttempts(flow, input, deps)) {
    blockingReasons.push("attempt_regress_count", "attempts_insufficient_before_positive_verdict");
  }
  if (deps.requiredCooperationStillActive(flow, input)) {
    blockingReasons.unshift("required_cooperation");
  }

  return fiscalResultWithDeps(true, deps.unique(blockingReasons), deps);
}

export function fiscalResultWithDeps(material: boolean, blockingReasons: string[], deps: FiscalPolicyDeps): FiscalPolicyResult {
  const meetingRequired = blockingReasons.includes("required_cooperation");
  return {
    material,
    blocking_reasons: blockingReasons,
    required_cooperation: blockingReasons.includes("required_cooperation") ? requiredCooWithDeps(blockingReasons, deps) : [],
    meeting_policy: {
      required: meetingRequired,
      rotation: [
        "ancora-fluxo",
        "chato",
        "questionador",
        "entrevista-me",
        "reuniao",
        "garimpeiro",
        "dex-memoria",
        "estacionamento",
        "sprinter",
        "mapeador-implementacao",
        "duda-dev",
        "revisor-codigo",
        "tio-testador",
        "validador-pronto"
      ],
      repertoire: [
        "E SE falhar?",
        "pra que?",
        "por que?",
        "onde nasce?",
        "qual origem?",
        "qual destino?",
        "qual gatilho?",
        "precisa lembrar disso?",
        "qual saida ainda nao foi tentada?",
        "qual ponto cego esta sendo protegido pelo plano atual?",
        "estamos seguindo nossos principios?"
      ],
      objective: "rotacionar integrantes, provocar desvios uteis, procurar pontos cegos e recomendar regresso/fase correta antes de veredito positivo"
    },
    direct_action:
      blockingReasons.length > 0
        ? `resolver_blockers_fiscais: ${blockingReasons.join(", ")}`
        : "fiscal_policy_clear"
  };
}

export function requiredCooWithDeps(reasonInput: string | string[], deps: FiscalPolicyDeps): Cooperator[] {
  const blockingReasons = Array.isArray(reasonInput) ? reasonInput : [];
  const fallbackReason = Array.isArray(reasonInput) ? "modo fiscal PPIRTV exige mesa COO material por fase" : reasonInput;
  return [
    "ancora-fluxo",
    "chato",
    "questionador",
    "entrevista-me",
    "garimpeiro",
    "dex-memoria",
    "estacionamento",
    "reuniao",
    "sprinter",
    "duda-dev",
    "mapeador-implementacao",
    "revisor-codigo",
    "tio-testador",
    "validador-pronto"
  ].map((name) => ({ name, reason: cooReason(name, blockingReasons, fallbackReason, deps), material: true }));
}

function cooReason(name: string, blockers: string[], fallbackReason: string, deps: FiscalPolicyDeps): string {
  if (name === "revisor-codigo" && blockers.includes("review_required")) {
    return "obrigatorio por review_required: mudanca/risco de codigo exige artefato ou achados de revisao";
  }
  if ((name === "garimpeiro" || name === "dex-memoria") && blockers.some((blocker) => ["memory_required_but_empty", deps.memoryMiningBlockedReason].includes(blocker))) {
    return "obrigatorio por memory_required_but_empty/memory_mining_blocked_verdict: garimpar pepitas, classificar memoria L1/L2 e dar destino a candidatos fortes antes de veredito positivo";
  }
  if ((name === "reuniao" || name === "sprinter") && blockers.includes("required_cooperation")) {
    return "obrigatorio por required_cooperation: ressalva material exige reuniao material e trilho/regresso definido";
  }
  if (name === "tio-testador" && blockers.some((blocker) => ["hygiene_blocking", "review_required", "attempt_regress_count"].includes(blocker))) {
    return "obrigatorio por risco de teste/evidencia: provar comportamento antes de qualquer positivo";
  }
  if (name === "validador-pronto") {
    return "obrigatorio antes de qualquer veredito positivo: conferir blockers fiscais e evidencias coerentes";
  }
  if (name === "ancora-fluxo") {
    return "obrigatorio para regresso correto: apontar fase, retorno e proxima acao quando houver bloqueio";
  }
  if (name === "chato" || name === "questionador" || name === "entrevista-me") {
    return "obrigatorio para perguntas de pressao: E SE, pra que, por que, onde, quando, quanto e estamos seguindo os principios?";
  }
  if (name === "estacionamento") {
    return "obrigatorio para registrar saidas nao tentadas, pendencias e pontos cegos sem sumir com contexto";
  }
  if (name === "duda-dev" || name === "mapeador-implementacao") {
    return "obrigatorio para ligar o bloqueio ao contrato, classe/grupo/secao e impacto implementavel";
  }
  return fallbackReason;
}

function fiscalMateriality(flow: Flow, input: FiscalVerdictInput, deps: FiscalPolicyDeps): boolean {
  if (!flow.goal_binding) {
    return false;
  }
  // NOVO-1 fail-closed: commits divergentes ininspecionaveis (base Git orfa)
  // sao materia fiscal por si — o fast-track mechanical nao pode afirmar
  // doc-only sem conseguir inspecionar o diff.
  const unresolvedGitDivergence = flow.git_unresolved_commits === true;
  const material = () =>
    input.status === "pronto_com_ressalvas" ||
    materialRiskText(fiscalText(flow, input)) ||
    memoryRequiredByFlow(flow, input) ||
    codeReviewRequired(flow, input) ||
    deps.hasHygieneBlocking(flow) ||
    recurringRisk(input) ||
    deps.latestLibrarianStatus(flow)?.status === "failed";
  // Fast-track: mechanical risk (text/doc/refs updates) skips fiscal material.
  if (flow.goal_binding.envelope.risk_level === "mechanical") {
    return (unresolvedGitDivergence || changedFilesContainCode(flow.changed_files)) && material();
  }
  return material();
}

export function fiscalText(flow: Flow, input: FiscalVerdictInput): string {
  return [
    flow.goal,
    flow.context,
    ...flow.risks,
    ...flow.uncertainties,
    ...flow.tasks,
    ...flow.expected_evidence,
    ...flow.done_criteria,
    ...flow.changed_files,
    input.rationale,
    input.next_step,
    ...(input.residual_risks ?? []),
    ...(input.review_findings ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}

function materialRiskText(text: string): boolean {
  return /(risco material|risco de produto|regress|erro recorrente|falh|bloque|sem reuniao|sem reunião|sem revisor|sem memoria|sem memória|bibliotecario|bibliotecário|graphify|hygiene|codigo|código|mudanca de codigo|mudança de código|principios|princípios)/i.test(text);
}

export function explicitMeetingTrigger(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized
    .split(/[\r\n.;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => positiveMeetingTrigger(segment) && !negativeMeetingTrigger(segment));
}

function negativeMeetingTrigger(text: string): boolean {
  return (
    /(required_cooperation|meeting_id|participantes insuficientes).{0,80}(nao se aplica|nao e necessario|nao ha|required false|opcional|sem necessidade|nao ocorreu)/i.test(text) ||
    /(nao se aplica|nao e necessario|nao ha|opcional|sem necessidade|nao ocorreu).{0,80}(required_cooperation|meeting_id|participantes insuficientes)/i.test(text)
  );
}

function positiveMeetingTrigger(text: string): boolean {
  return /(sem reuniao|reuniao obrigatoria|reuniao material|mesa material|cooperacao material|divergente\/convergente\/transversal|sem meeting_id|required_cooperation (obrigator|exig|missing|falt|pendente)|participantes insuficientes)/i.test(text);
}

function codeReviewRequired(flow: Flow, input: FiscalVerdictInput): boolean {
  // NOVO-1 fail-closed: commits divergentes que o diff nao consegue
  // inspecionar (base orfa) sempre exigem review.
  const unresolvedGitDivergence = flow.git_unresolved_commits === true;
  const baseCodeReviewRequired = () =>
    flow.changed_files.length > 0 || /(codigo|código|mudanca de codigo|mudança de código|diff|review|revisor)/i.test(fiscalText(flow, input));
  // Fast-track: mechanical risk (text/doc updates) does not require code review.
  if (flow.goal_binding?.envelope.risk_level === "mechanical") {
    return (unresolvedGitDivergence || changedFilesContainCode(flow.changed_files)) && baseCodeReviewRequired();
  }
  return unresolvedGitDivergence || baseCodeReviewRequired();
}

export function hasReviewEvidenceWithDeps(flow: Flow, input: FiscalVerdictInput, deps: FiscalPolicyDeps): boolean {
  const citedEvidenceIds = input.evidence_ids ? new Set(input.evidence_ids) : null;
  if (citedEvidenceIds) {
    return flow.evidence.some((evidence: Evidence) =>
      citedEvidenceIds.has(evidence.evidence_id)
      && isStructuredReviewEvidence(flow, evidence)
    );
  }
  return (
    flow.verdicts.some((verdict: Verdict) =>
      verdict.reviewed_implementation_fingerprint
        ? verdict.reviewed_implementation_fingerprint === flow.implementation_fingerprint
        : !flow.implementation_fingerprint &&
          (
            deps.truthy(verdict.review_artifact_path) ||
            verdict.review_findings.length > 0
          ) &&
          deps.changedFilesMatchReview(flow.changed_files, deps.reviewedChangedFilesForVerdict(flow, verdict)) &&
          deps.reviewRemainsCurrent(flow, verdict)
    ) ||
    flow.evidence.some((evidence: Evidence) => isStructuredReviewEvidence(flow, evidence))
  );
}

function recurringRisk(input: FiscalVerdictInput): boolean {
  return /\b(?:erros?|falhas?|bugs?|defeitos?|problemas?|incidentes?|riscos?)\s+recorrentes?\b|\btentativas?\b|\bregress/i.test(
    [input.rationale, input.next_step, ...(input.residual_risks ?? [])].filter(Boolean).join("\n")
  );
}

function hasEnoughAttempts(flow: Flow, input: FiscalVerdictInput, deps: FiscalPolicyDeps): boolean {
  const attemptCount = input.attempt_count ?? deps.countHistory(flow, "verdict_recorded");
  const regressCount = input.regress_count ?? deps.countRegressions(flow);
  return attemptCount >= 2 || regressCount >= 1 || flow.meetings.length > 0;
}

function regressLimitReached(flow: Flow, input: FiscalVerdictInput, deps: FiscalPolicyDeps): boolean {
  return (input.regress_count ?? deps.countRegressions(flow)) >= deps.maxRegressions;
}
