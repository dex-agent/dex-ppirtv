export const RECALL_ERROR_MAX_REFERENCES = 12;
export const RECALL_ERROR_MAX_REFERENCE_LENGTH = 160;

export type RecallConsumptionInput = {
  references: string[];
  graphify_references?: string[];
  note?: string;
};

export type NormalizedRecallConsumption = {
  references: string[];
  graphifyReferences: string[];
  note: string | null;
};

export type RecallConsumptionReferenceValidation = {
  validReferences: string[];
  validGraphifyReferences: string[];
};

export class RecallConsumptionReferenceError extends Error {
  readonly code: "RECALL_CONSUMPTION_UNKNOWN_REFERENCES" | "GRAPHIFY_CONSUMPTION_UNKNOWN_REFERENCES";
  readonly unknownReferences: string[];
  readonly validReferences: string[];
  readonly validGraphifyReferences: string[];

  constructor(
    code: RecallConsumptionReferenceError["code"],
    unknownReferences: string[],
    validReferences: string[],
    validGraphifyReferences: string[] = []
  ) {
    const boundedUnknownReferences = boundedRecallErrorReferences(unknownReferences);
    super(`${code}: ${boundedUnknownReferences.length} unknown reference(s)`);
    this.name = "RecallConsumptionReferenceError";
    this.code = code;
    this.unknownReferences = boundedUnknownReferences;
    this.validReferences = boundedRecallErrorReferences(validReferences);
    this.validGraphifyReferences = boundedRecallErrorReferences(validGraphifyReferences);
  }
}

export function boundedRecallErrorReferences(references: string[]): string[] {
  return uniqueStrings(
    references
      .map((reference) => reference.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((reference) => reference.slice(0, RECALL_ERROR_MAX_REFERENCE_LENGTH))
  ).slice(0, RECALL_ERROR_MAX_REFERENCES);
}

export function normalizeRecallConsumptionInput(input: RecallConsumptionInput): NormalizedRecallConsumption {
  const references = uniqueStrings((input.references ?? []).map((item) => item.trim()).filter(Boolean));
  if (references.length === 0) {
    throw new Error("RECALL_CONSUMPTION_REFERENCES_REQUIRED: informe ao menos uma referencia recuperada");
  }
  return {
    references,
    graphifyReferences: uniqueStrings((input.graphify_references ?? []).map((item) => item.trim()).filter(Boolean)),
    note: input.note?.trim() ?? null
  };
}

export function validateRecallConsumptionReferences(
  input: NormalizedRecallConsumption,
  recalledItems: Array<Record<string, unknown>>
): RecallConsumptionReferenceValidation {
  const validReferences = recallReferenceValues(recalledItems);
  const knownReferences = recallReferenceSet(validReferences);
  const unknownReferences = input.references.filter((reference) => !knownReferences.has(normalizeRecallReference(reference)));
  if (unknownReferences.length > 0) {
    throw new RecallConsumptionReferenceError(
      "RECALL_CONSUMPTION_UNKNOWN_REFERENCES",
      unknownReferences,
      validReferences
    );
  }

  const validGraphifyReferences = recallReferenceValues(recalledItems.filter((item) => item.source === "graphify"));
  const knownGraphifyReferences = recallReferenceSet(validGraphifyReferences);
  const unknownGraphifyReferences = input.graphifyReferences.filter(
    (reference) => !knownGraphifyReferences.has(normalizeRecallReference(reference))
  );
  if (unknownGraphifyReferences.length > 0) {
    throw new RecallConsumptionReferenceError(
      "GRAPHIFY_CONSUMPTION_UNKNOWN_REFERENCES",
      unknownGraphifyReferences,
      validReferences,
      validGraphifyReferences
    );
  }

  return { validReferences, validGraphifyReferences };
}

export function normalizeRecallReference(reference: string): string {
  return reference.trim().replace(/\\/g, "/").toLowerCase();
}

export function sameRecallReferences(left: string[], right: string[]): boolean {
  const leftNormalized = uniqueStrings(left.map(normalizeRecallReference)).sort();
  const rightNormalized = uniqueStrings(right.map(normalizeRecallReference)).sort();
  return leftNormalized.length === rightNormalized.length && leftNormalized.every((item, index) => item === rightNormalized[index]);
}

function recallReferenceValues(items: Array<Record<string, unknown>>): string[] {
  return uniqueStrings(
    items.flatMap((item) => [item.path, item.title, item.destination])
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
  );
}

function recallReferenceSet(references: string[]): Set<string> {
  return new Set(references.map(normalizeRecallReference));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
