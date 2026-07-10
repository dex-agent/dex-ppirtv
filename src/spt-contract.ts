import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { SptV2Contract } from "./domain.js";

const requiredText = z.string().trim().min(1, "must be a non-empty string");
const requiredTextList = z.array(requiredText).min(1, "must contain at least one item");

const sptV2Schema: z.ZodType<SptV2Contract> = z
  .object({
    dex_contract: z.literal("spt"),
    version: z.literal(2),
    status: requiredText,
    owner: requiredText,
    date: requiredText.regex(/^\d{4}-\d{2}-\d{2}$/, "must use YYYY-MM-DD"),
    workspace: requiredText,
    origin: requiredText,
    goal: z
      .object({
        id: requiredText.regex(/^[a-z0-9][a-z0-9._-]*$/, "must be a stable lowercase identifier"),
        title: requiredText,
        objective: requiredText
      })
      .strict(),
    context: requiredText,
    problem: requiredText,
    decision: requiredText,
    scope: z
      .object({
        include: requiredTextList,
        exclude: requiredTextList
      })
      .strict(),
    spec: requiredText,
    plan: requiredTextList,
    tasks: requiredTextList,
    expected_evidence: requiredTextList,
    done_criteria: requiredTextList,
    risks: requiredTextList,
    uncertainties: requiredTextList,
    gates: requiredTextList,
    validation: requiredTextList,
    execution_prompt: requiredText
  })
  .strict();

export type SptV2ParseResult = {
  contract: SptV2Contract | null;
  checks: {
    frontmatter_present: boolean;
    frontmatter_closed: boolean;
    yaml_valid: boolean;
    schema_valid: boolean;
  };
  errors: string[];
};

export function parseSptV2Document(input: string): SptV2ParseResult {
  const text = input.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const checks = {
    frontmatter_present: lines[0] === "---",
    frontmatter_closed: false,
    yaml_valid: false,
    schema_valid: false
  };

  if (!checks.frontmatter_present) {
    return invalid(checks, "spt_v2.frontmatter: missing opening --- at the start of the file");
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  checks.frontmatter_closed = closingIndex > 0;
  if (!checks.frontmatter_closed) {
    return invalid(checks, "spt_v2.frontmatter: missing closing ---");
  }

  const yamlText = lines.slice(1, closingIndex).join("\n");
  if (!yamlText.trim()) {
    return invalid(checks, "spt_v2.frontmatter: YAML contract is empty");
  }

  let value: unknown;
  try {
    const document = parseDocument(yamlText, {
      prettyErrors: false,
      schema: "core",
      strict: true
    });
    if (document.errors.length > 0) {
      return invalid(
        checks,
        ...document.errors.map((error) => `spt_v2.yaml: ${error.message.replace(/\s+/g, " ").trim()}`)
      );
    }
    value = document.toJS({ maxAliasCount: 50 });
    checks.yaml_valid = true;
  } catch (error) {
    return invalid(checks, `spt_v2.yaml: ${error instanceof Error ? error.message : String(error)}`);
  }

  const parsed = sptV2Schema.safeParse(value);
  if (!parsed.success) {
    return invalid(
      checks,
      ...parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "contract";
        return `spt_v2.${path}: ${issue.message}`;
      })
    );
  }

  checks.schema_valid = true;
  return { contract: parsed.data, checks, errors: [] };
}

export function fingerprintSptV2Contract(contract: SptV2Contract): string {
  return createHash("sha256").update(JSON.stringify(contract), "utf8").digest("hex");
}

function invalid(checks: SptV2ParseResult["checks"], ...errors: string[]): SptV2ParseResult {
  return { contract: null, checks, errors };
}
