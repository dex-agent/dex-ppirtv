// ISSUE-LOCAL-0002 (emenda adversarial D-31, 2026-11-09): julgamento de
// provided.changed_files/deleted_files do gate de implementação — módulo
// extraído do monólito (camping CONTAIN: comportamento novo fora, fachada
// ganha só cola). Veredito documental oraculo-clean-code: cap 7 (Provide
// Context with Exceptions — o typo nunca é mudo), cap 8 (Clean Boundaries —
// sem envelope não se julga; nunca o CWD do servidor), cap 3 (Do One Thing).
import { statSync } from "node:fs";
import path from "node:path";
import type { Flow } from "./domain.js";
import { normalizeReviewPath } from "./review-snapshot.js";

export interface ProvidedPathFindings {
  missingPaths: string[];
  unconfirmedDeletions: string[];
}

// Typo sozinho em changed_files (fora de deleted): não existe (ou não é
// arquivo) ⇒ RESSALVA provided_missing_paths e NÃO entra na union (morte na
// nascente — caso da issue). Par changed+deleted simultâneo é o formato
// CANÔNICO de deleção (1ª declaração de arquivo apagado): ENTRA na union por
// atestação do cliente — e quando o disco não confirma o arquivo e a union
// histórica não o conhece, vira aviso provided_unconfirmed_deletions (nunca
// bloqueia; indistinguível de deleção real no disco).
export function providedPathFindingsFor(
  flow: Flow,
  providedChangedFiles: string[],
  deletedFiles: string[]
): ProvidedPathFindings {
  // Sem envelope (gate_check legado / flow de pipeline) não há fronteira
  // legítima para julgar existência — silêncio em vez de consultar o CWD do
  // processo servidor (arquivo do servidor nunca entra na fiscalização).
  const root = flow.goal_binding?.envelope.workspace ?? null;
  if (!root) return { missingPaths: [], unconfirmedDeletions: [] };
  const previousUnion = new Set(flow.changed_files.map(normalizeReviewPath).filter(Boolean));
  const deletedSet = new Set(deletedFiles.map(normalizeReviewPath).filter(Boolean));
  const missingPaths: string[] = [];
  const unconfirmedDeletions: string[] = [];
  for (const file of providedChangedFiles) {
    const normalized = normalizeReviewPath(file);
    if (deletedSet.has(normalized)) {
      if (!previousUnion.has(normalized) && !isExistingFile(path.resolve(root, file))) {
        unconfirmedDeletions.push(file);
      }
      continue;
    }
    if (!isExistingFile(path.resolve(root, file))) {
      missingPaths.push(file);
    }
  }
  return { missingPaths, unconfirmedDeletions };
}

// Campos de receipt (GateRecord/preflight) a partir dos achados — os spreads
// condicionais moram aqui para a fachada não ganhar decisão nova.
export function providedPathFindingsFields(findings: ProvidedPathFindings): Record<string, unknown> {
  return {
    ...(findings.missingPaths.length > 0 ? { provided_missing_paths: [...new Set(findings.missingPaths)] } : {}),
    ...(findings.unconfirmedDeletions.length > 0
      ? { provided_unconfirmed_deletions: [...new Set(findings.unconfirmedDeletions)] }
      : {})
  };
}

// Preview tolerante do preflight (read-only): coerção de strings, sem
// strictPathArray — o gate persistente continua a autoridade estrita.
export function providedPathPreviewFields(
  flow: Flow,
  changedFilesValue: unknown,
  deletedFiles: string[],
  phase: string
): Record<string, unknown> {
  if (phase !== "implementacao" || !Array.isArray(changedFilesValue)) return {};
  const changedFiles = changedFilesValue.filter((entry): entry is string => typeof entry === "string");
  return providedPathFindingsFields(providedPathFindingsFor(flow, changedFiles, deletedFiles));
}

function isExistingFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}
