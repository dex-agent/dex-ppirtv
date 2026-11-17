// Pipeline policy — normalizacao e evidence text dos itens do mm_pipeline_run.
// Extraido do flow-engine na onda da maratona 2026-11-17 (Trilho
// maratona-pipeline-binding-261117, record SHRINK 1 do camping fiscal).
import { requireText, unique } from "./lang-utils.js";
import { assertNoSecretLikeItems, assertNoSecretLikeText } from "./security/secret-redaction.js";
import type { PipelineItem } from "./domain.js";

export type NormalizedPipelineItem = {
  goal: string;
  context: string;
  scope_in: string[];
  scope_out: string[];
  tasks: string[];
  done_criteria: string[];
  expected_evidence: string[];
  risks: string[];
  uncertainties: string[];
  changed_files: string[];
  evidence: string[];
  residual_risks: string[];
  verdict_parking_lot: string[];
  verdict_gold_mining: string[];
};

export function normalizePipelineItem(item: PipelineItem, index: number): NormalizedPipelineItem {
  requireText(item.goal, `pipeline[${index}].goal`);
  assertNoSecretLikeText(item.goal, `pipeline[${index}].goal`);
  assertNoSecretLikeText(item.context, `pipeline[${index}].context`);
  const scopeIn = unique(item.scope_in ?? []);
  const scopeOut = unique(item.scope_out ?? []);
  const tasks = unique(item.tasks ?? []);
  const doneCriteria = unique(item.done_criteria ?? []);
  const expectedEvidence = unique(item.expected_evidence ?? []);
  const changedFiles = unique(item.changed_files?.length ? item.changed_files : scopeIn);
  const evidence = unique(item.evidence?.length ? item.evidence : expectedEvidence);
  const residualRisks = unique(item.residual_risks ?? []);
  const verdictParkingLot = unique(item.verdict_parking_lot ?? []);
  const verdictGoldMining = unique(item.verdict_gold_mining ?? []);
  const risks = unique(
    item.risks?.length
      ? item.risks
      : ["Automacao de pipeline nao substitui evidencia externa quando a tarefa exigir execucao real."]
  );
  const uncertainties = unique(
    item.uncertainties?.length
      ? item.uncertainties
      : ["mm_pipeline_run orquestra gates PPIRTV; execucao externa deve ser anexada como evidencia quando existir."]
  );
  assertNoSecretLikeItems(
    [
      ...scopeIn,
      ...scopeOut,
      ...tasks,
      ...doneCriteria,
      ...expectedEvidence,
      ...changedFiles,
      ...evidence,
      ...risks,
      ...uncertainties,
      ...residualRisks,
      ...verdictParkingLot,
      ...verdictGoldMining
    ],
    `pipeline[${index}]`
  );
  return {
    goal: item.goal.trim(),
    context: item.context?.trim() || `Pipeline item ${index + 1}: ${item.goal.trim()}`,
    scope_in: scopeIn,
    scope_out: scopeOut,
    tasks,
    done_criteria: doneCriteria,
    expected_evidence: expectedEvidence,
    risks,
    uncertainties,
    changed_files: changedFiles,
    evidence,
    residual_risks: residualRisks,
    verdict_parking_lot: verdictParkingLot,
    verdict_gold_mining: verdictGoldMining
  };
}

export function pipelineEvidenceText(item: NormalizedPipelineItem): string {
  return [
    `Goal: ${item.goal}`,
    "",
    "Scope in:",
    ...item.scope_in.map((entry) => `- ${entry}`),
    "",
    "Tasks:",
    ...item.tasks.map((entry) => `- ${entry}`),
    "",
    "Expected evidence declared:",
    ...item.expected_evidence.map((entry) => `- ${entry}`),
    "",
    "Done criteria:",
    ...item.done_criteria.map((entry) => `- ${entry}`),
    "",
    "Pipeline evidence:",
    ...(item.evidence.length > 0 ? item.evidence.map((entry) => `- ${entry}`) : ["- no extra evidence declared"])
  ].join("\n");
}
