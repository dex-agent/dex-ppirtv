import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryCandidate, MemoryPostWriteValidation, MemoryPostWriteValidationFinding } from "../domain.js";
import { AUTO_WRITE_REVIEW_MARKER, AUTO_WRITE_REVIEW_TAGS, memoryAnchor } from "./mining-policy.js";

export async function validateMemoryPostWrite(input: {
  written: Array<{ candidate_id: string; files: string[] }>;
  candidates: MemoryCandidate[];
  validatedAt: string;
}): Promise<MemoryPostWriteValidation> {
  const touchedFiles = unique(input.written.flatMap((item) => item.files));
  if (input.written.length === 0) {
    return baseValidation("not_required", input.validatedAt, touchedFiles, [], [], []);
  }

  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const findings: MemoryPostWriteValidationFinding[] = [];
  const checkedTriggers: string[] = [];
  const recallProof: Array<Record<string, unknown>> = [];

  for (const written of input.written) {
    const candidate = candidateById.get(written.candidate_id);
    if (!candidate) {
      findings.push({
        code: "candidate-not-found-for-written-memory",
        message: `Written memory candidate ${written.candidate_id} was not found in the mined candidate list.`,
        candidate_id: written.candidate_id
      });
      continue;
    }
    const [l1Path, l2Path, ...l3Paths] = written.files;
    const anchor = memoryAnchor(candidate.title);
    const localizer = candidate.l1_gatilho.match(/\[([A-Z0-9-]+)\]/)?.[1] ?? candidate.id;
    checkedTriggers.push(localizer, anchor, AUTO_WRITE_REVIEW_MARKER);
    const l1Text = await readMaybe(l1Path);
    const l2Text = await readMaybe(l2Path);

    validateL1({ text: l1Text, filePath: l1Path, anchor, localizer, candidateId: candidate.id, findings });
    validateL2({ text: l2Text, filePath: l2Path, anchor, localizer, flowMarker: AUTO_WRITE_REVIEW_MARKER, candidateId: candidate.id, findings });
    if (l1Text.ok && l2Text.ok) {
      recallProof.push(
        ...proofForTerms([AUTO_WRITE_REVIEW_MARKER, localizer, anchor], [
          { file: l1Path, text: l1Text.text },
          { file: l2Path, text: l2Text.text }
        ])
      );
    }

    for (const l3Path of l3Paths) {
      const l3Text = await readMaybe(l3Path);
      validateL3({ text: l3Text, filePath: l3Path, anchor, candidateId: candidate.id, findings });
    }
  }

  return {
    ...baseValidation(findings.length === 0 ? "passed" : "failed", input.validatedAt, touchedFiles, checkedTriggers, recallProof, findings),
    l1_files: memoryLayerFiles(touchedFiles, "L1"),
    l2_files: memoryLayerFiles(touchedFiles, "L2"),
    l3_files: memoryLayerFiles(touchedFiles, "L3")
  };
}

function baseValidation(
  status: MemoryPostWriteValidation["status"],
  validatedAt: string,
  touchedFiles: string[],
  checkedTriggers: string[],
  recallProof: Array<Record<string, unknown>>,
  findings: MemoryPostWriteValidationFinding[]
): MemoryPostWriteValidation {
  return {
    required: touchedFiles.length > 0,
    status,
    validator: "consciencia-memorias-post-write",
    validated_at: validatedAt,
    touched_files: touchedFiles,
    l1_files: memoryLayerFiles(touchedFiles, "L1"),
    l2_files: memoryLayerFiles(touchedFiles, "L2"),
    l3_files: memoryLayerFiles(touchedFiles, "L3"),
    checked_triggers: unique(checkedTriggers),
    recall_proof: recallProof,
    findings,
    parking_lot: findings.map(validationFindingParkingItem),
    commands_required: [
      'validate-memory-tags.ps1 -ThemePath <tema-ou-corte> -AsJson',
      'validate-memory-links.ps1 -ThemePath <tema-ou-corte> -RequireObsidian -AsJson',
      `find-memory.ps1 -Term "${AUTO_WRITE_REVIEW_MARKER}" -RecallJson`,
      `rg -n "${AUTO_WRITE_REVIEW_MARKER}|<localizador>|<anchor>" <tema-ou-corte>`
    ]
  };
}

async function readMaybe(filePath: string | undefined): Promise<{ ok: true; text: string } | { ok: false; text: ""; error: string }> {
  if (!filePath) {
    return { ok: false, text: "", error: "missing-file-path" };
  }
  try {
    return { ok: true, text: await readFile(filePath, "utf8") };
  } catch (error) {
    return { ok: false, text: "", error: error instanceof Error ? error.message : String(error) };
  }
}

function validateL1(input: {
  text: { ok: boolean; text: string; error?: string };
  filePath: string | undefined;
  anchor: string;
  localizer: string;
  candidateId: string;
  findings: MemoryPostWriteValidationFinding[];
}): void {
  if (!input.text.ok) {
    addFinding(input.findings, "l1-file-not-readable", `L1 file could not be read: ${input.text.error}`, input.filePath, undefined, input.candidateId);
    return;
  }
  requireContains(input, AUTO_WRITE_REVIEW_MARKER, "l1-missing-auto-write-review-marker");
  for (const tag of AUTO_WRITE_REVIEW_TAGS) {
    requireContains(input, tag, "l1-missing-required-tag");
  }
  requireContains(input, `[${input.localizer}]`, "l1-missing-localizer");
  requireContains(input, `#${input.anchor}`, "l1-missing-markdown-anchor-link");
  requireContains(input, `#^${input.anchor}`, "l1-missing-obsidian-block-link");
  requireContains(input, `^${input.anchor}`, "l1-missing-block-id");
}

function validateL2(input: {
  text: { ok: boolean; text: string; error?: string };
  filePath: string | undefined;
  anchor: string;
  localizer: string;
  flowMarker: string;
  candidateId: string;
  findings: MemoryPostWriteValidationFinding[];
}): void {
  if (!input.text.ok) {
    addFinding(input.findings, "l2-file-not-readable", `L2 file could not be read: ${input.text.error}`, input.filePath, undefined, input.candidateId);
    return;
  }
  requireRegex(input, new RegExp(`^## .+ \\{#${escapeRegExp(input.anchor)}\\}`, "m"), "l2-heading-missing-anchor");
  requireRegex(input, new RegExp(`^\\^${escapeRegExp(input.anchor)}$`, "m"), "l2-missing-block-id");
  requireSingleRegex(input, new RegExp(`^## .+ \\{#${escapeRegExp(input.anchor)}\\}`, "gm"), "l2-duplicate-heading-anchor");
  requireSingleRegex(input, new RegExp(`^\\^${escapeRegExp(input.anchor)}$`, "gm"), "l2-duplicate-block-id");
  requireContains(input, `Localizador: \`${input.localizer}\``, "l2-missing-localizer");
  requireContains(input, "Tags:", "l2-missing-tags");
  requireContains(input, "Aliases:", "l2-missing-aliases");
  requireContains(input, "Obsidian: L1", "l2-missing-l1-backlink");
  requireContains(input, `#^${input.anchor}`, "l2-l1-backlink-missing-block-id");
  requireContains(input, `conhecimento/${input.anchor}.md`, "l2-missing-l3-link");
  requireContains(input, "Obsidian: L3 [[", "l2-missing-l3-obsidian-link");
  requireContains(input, "OrigemAuto: mm_memory_mining", "l2-missing-auto-origin");
  requireContains(input, "ReviewStatus: pending_consciencia_memorias", "l2-missing-review-status");
  requireContains(input, input.flowMarker, "l2-missing-auto-write-review-marker");
}

function validateL3(input: {
  text: { ok: boolean; text: string; error?: string };
  filePath: string | undefined;
  anchor: string;
  candidateId: string;
  findings: MemoryPostWriteValidationFinding[];
}): void {
  if (input.filePath && path.basename(input.filePath).toLowerCase() === "index.md") {
    return;
  }
  if (!input.text.ok) {
    addFinding(input.findings, "l3-file-not-readable", `L3 file could not be read: ${input.text.error}`, input.filePath, undefined, input.candidateId);
    return;
  }
  requireContains(input, `#${input.anchor}`, "l3-missing-l2-markdown-backlink");
  requireContains(input, `#^${input.anchor}`, "l3-missing-l2-obsidian-block-backlink");
}

function requireContains(
  input: { text: { text: string }; filePath: string | undefined; candidateId: string; findings: MemoryPostWriteValidationFinding[] },
  term: string,
  code: string
): void {
  if (!input.text.text.includes(term)) {
    addFinding(input.findings, code, `Expected term not found: ${term}`, input.filePath, 1, input.candidateId);
  }
}

function requireRegex(
  input: { text: { text: string }; filePath: string | undefined; candidateId: string; findings: MemoryPostWriteValidationFinding[] },
  pattern: RegExp,
  code: string
): void {
  if (!pattern.test(input.text.text)) {
    addFinding(input.findings, code, `Expected pattern not found: ${pattern.source}`, input.filePath, 1, input.candidateId);
  }
}

function requireSingleRegex(
  input: { text: { text: string }; filePath: string | undefined; candidateId: string; findings: MemoryPostWriteValidationFinding[] },
  pattern: RegExp,
  code: string
): void {
  const matches = input.text.text.match(pattern) ?? [];
  if (matches.length > 1) {
    addFinding(input.findings, code, `Expected exactly one match, found ${matches.length}: ${pattern.source}`, input.filePath, 1, input.candidateId);
  }
}

function addFinding(
  findings: MemoryPostWriteValidationFinding[],
  code: string,
  message: string,
  filePath: string | undefined,
  line: number | undefined,
  candidateId: string
): void {
  findings.push({ code, message, file: filePath, line, candidate_id: candidateId });
}

function validationFindingParkingItem(finding: MemoryPostWriteValidationFinding): string {
  const file = finding.file ?? "arquivo-desconhecido";
  const line = typeof finding.line === "number" ? finding.line : 1;
  const candidate = finding.candidate_id ? ` candidate=${finding.candidate_id}` : "";
  return `Achado pos-write memoria estacionado: ${finding.code} em ${file}:${line}${candidate}. Quando: corrigir links/anchors L1<->L2/L3 do corte tocado e reexecutar mm_memory_mining antes de repetir goal_verdict.`;
}

function proofForTerms(terms: string[], files: Array<{ file: string | undefined; text: string }>): Array<Record<string, unknown>> {
  const proof: Array<Record<string, unknown>> = [];
  for (const term of unique(terms)) {
    const matches = files
      .filter((file) => file.file && file.text.includes(term))
      .map((file) => ({ file: file.file, line: lineOf(file.text, term) }));
    proof.push({ method: "rg", term, matches, passed: matches.length > 0 });
  }
  return proof;
}

function lineOf(text: string, term: string): number | undefined {
  const index = text.indexOf(term);
  if (index < 0) {
    return undefined;
  }
  return text.slice(0, index).split(/\r?\n/).length;
}

function memoryLayerFiles(files: string[], layer: "L1" | "L2" | "L3"): string[] {
  return files.filter((file) => {
    const normalized = file.replace(/\\/g, "/").toLowerCase();
    if (layer === "L1") {
      return normalized.endsWith("/lembranca.md");
    }
    if (layer === "L2") {
      return normalized.endsWith("/memoria.md");
    }
    return normalized.includes("/conhecimento/");
  });
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
