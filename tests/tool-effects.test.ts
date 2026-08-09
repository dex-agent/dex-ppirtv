import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REQUIRED_TOOLS } from "../src/domain.js";
import {
  assertToolEffectCatalog,
  TOOL_EFFECTS,
  toolAnnotationsFor,
  type PpirtvToolName,
  type ToolEffectDeclaration
} from "../src/mcp/tool-effects.js";

const EXPECTED_READ_ONLY_TOOLS = [
  "runtime_probe",
  "ppirtv_trace",
  "spt_validate"
];

const EXPECTED_ADDITIVE_TOOLS = [
  "flow_create",
  "flow_status",
  "meeting_open",
  "checklist_render",
  "hygiene_scan",
  "goal_status",
  "ppirtv_checkout",
  "goal_gate_preflight",
  "goal_progress_record",
  "goal_meeting_open",
  "goal_meeting_add_turn"
];

const EXPECTED_STATE_CHANGING_TOOLS = [
  "flow_advance",
  "flow_return",
  "gate_check",
  "meeting_record",
  "evidence_attach",
  "verdict_record",
  "flow_archive",
  "goal_start",
  "goal_resume",
  "goal_gate_check",
  "goal_advance",
  "goal_meeting_close",
  "mm_memory_mining",
  "mm_memory_candidate_resolve",
  "mm_pipeline_run",
  "evidence_add",
  "goal_verdict",
  "goal_regress"
];

const EXPECTED_IDEMPOTENT_TOOLS = [
  "runtime_probe",
  "ppirtv_trace",
  "flow_status",
  "checklist_render",
  "flow_archive",
  "spt_validate",
  "goal_status",
  "ppirtv_checkout",
  "goal_gate_preflight",
  "goal_progress_record",
  "goal_meeting_close"
];

describe("MCP tool effect catalog", () => {
  it("covers the canonical 32-tool inventory exactly", () => {
    expect(Object.keys(TOOL_EFFECTS)).toEqual([...REQUIRED_TOOLS]);
    expect(Object.keys(TOOL_EFFECTS)).toHaveLength(32);
    expect(() => assertToolEffectCatalog(TOOL_EFFECTS)).not.toThrow();
  });

  it("publishes the exact safe hints for runtime_probe", () => {
    expect(toolAnnotationsFor("runtime_probe")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
  });

  it("keeps read-only classification restricted to behaviorally read-only tools", () => {
    const readOnlyTools = Object.entries(TOOL_EFFECTS)
      .filter(([, declaration]) => declaration.effect === "read_only")
      .map(([name]) => name)
      .sort();

    expect(readOnlyTools).toEqual([...EXPECTED_READ_ONLY_TOOLS].sort());
    for (const [name, declaration] of Object.entries(TOOL_EFFECTS)) {
      expect(declaration.annotations.openWorldHint, name).toBe(false);
      expect(declaration.annotations.readOnlyHint, name).toBe(declaration.effect === "read_only");
      expect(declaration.annotations.destructiveHint, name).toBe(declaration.effect === "state_changing");
      expect(declaration.rationale.trim().length, name).toBeGreaterThan(0);
    }
  });

  it("describes contextual effects and retries by their maximum observable behavior", () => {
    const byEffect = (effect: ToolEffectDeclaration["effect"]) => Object.entries(TOOL_EFFECTS)
      .filter(([, declaration]) => declaration.effect === effect)
      .map(([name]) => name);

    expect(byEffect("read_only")).toEqual(EXPECTED_READ_ONLY_TOOLS);
    expect(byEffect("additive")).toEqual(EXPECTED_ADDITIVE_TOOLS);
    expect(byEffect("state_changing")).toEqual(EXPECTED_STATE_CHANGING_TOOLS);
    expect(
      Object.entries(TOOL_EFFECTS)
        .filter(([, declaration]) => declaration.annotations.idempotentHint)
        .map(([name]) => name)
    ).toEqual(EXPECTED_IDEMPOTENT_TOOLS);

    for (const name of ["flow_status", "checklist_render", "goal_gate_preflight"] as const) {
      expect(toolAnnotationsFor(name)).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      });
    }
    expect(TOOL_EFFECTS.goal_status.effect).toBe("additive");
    expect(TOOL_EFFECTS.ppirtv_checkout.effect).toBe("additive");
    expect(toolAnnotationsFor("goal_status")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
    for (const name of ["evidence_attach", "evidence_add"] as const) {
      expect(toolAnnotationsFor(name)).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false
      });
    }
    for (const name of ["flow_archive", "goal_meeting_close"] as const) {
      expect(toolAnnotationsFor(name)).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true
      });
    }
    expect(TOOL_EFFECTS.goal_start.effect).toBe("state_changing");
    expect(TOOL_EFFECTS.goal_resume.effect).toBe("state_changing");
    expect(toolAnnotationsFor("goal_start")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    });
  });

  it("fails closed for a missing or unknown tool", () => {
    const missing = structuredClone(TOOL_EFFECTS) as Record<string, ToolEffectDeclaration>;
    delete missing.goal_regress;
    expect(() => assertToolEffectCatalog(missing)).toThrow("PPIRTV_TOOL_EFFECTS_CATALOG_MISMATCH");
    expect(() => toolAnnotationsFor("unknown_tool" as PpirtvToolName)).toThrow("PPIRTV_TOOL_EFFECT_UNKNOWN_TOOL");
  });

  it("rejects a mutating declaration marked read-only", () => {
    const contradictory = structuredClone(TOOL_EFFECTS) as Record<string, ToolEffectDeclaration>;
    contradictory.flow_advance = {
      ...contradictory.flow_advance,
      effect: "state_changing",
      annotations: {
        ...contradictory.flow_advance.annotations,
        readOnlyHint: true
      }
    };

    expect(() => assertToolEffectCatalog(contradictory)).toThrow(
      "PPIRTV_TOOL_EFFECT_MUTATION_MARKED_READ_ONLY"
    );
  });

  it("forbids registrations that bypass the typed effect facade", () => {
    const directRegistrations = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => containsDirectRegisterToolAccess(readFileSync(`src/${file}`, "utf8")))
      .map((file) => `src/${file.replaceAll("\\", "/")}`);

    expect(directRegistrations).toEqual(["src/mcp/tool-effects.ts"]);
  });

  it("detects whitespace, optional, computed and destructured registerTool access before it can bypass the facade", () => {
    for (const source of [
      'server.registerTool ("tool", {}, callback);',
      'server?.registerTool("tool", {}, callback);',
      'server["registerTool"]("tool", {}, callback);',
      'server?.["registerTool"]("tool", {}, callback);',
      'const { registerTool } = server; registerTool("tool", {}, callback);',
      'const { registerTool: direct } = server; direct("tool", {}, callback);'
    ]) {
      expect(containsDirectRegisterToolAccess(source), source).toBe(true);
    }
  });

  it("keeps the public contract groups synchronized with the typed catalog", () => {
    const contract = readFileSync("docs/contracts/MCP_TOOL_EFFECTS_CONTRACT.md", "utf8");

    expect(documentedTools(contract, "Leitura")).toEqual(EXPECTED_READ_ONLY_TOOLS);
    expect(documentedTools(contract, "Atualização aditiva")).toEqual(EXPECTED_ADDITIVE_TOOLS);
    expect(documentedTools(contract, "Mutação de estado")).toEqual(EXPECTED_STATE_CHANGING_TOOLS);
  });
});

function documentedTools(contract: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = contract.match(new RegExp(
    "### " + escapedHeading + "[^\\n]*\\n[\\s\\S]*?```text\\r?\\n([\\s\\S]*?)\\r?\\n```"
  ));
  if (!match) {
    throw new Error(`Missing documented tool list for ${heading}`);
  }
  return match[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function containsDirectRegisterToolAccess(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    "register-tool-probe.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === "registerTool")
      || (
        ts.isElementAccessExpression(node)
        && ts.isStringLiteralLike(node.argumentExpression)
        && node.argumentExpression.text === "registerTool"
      )
      || (
        ts.isBindingElement(node)
        && (
          (node.propertyName && ts.isIdentifier(node.propertyName) && node.propertyName.text === "registerTool")
          || (!node.propertyName && ts.isIdentifier(node.name) && node.name.text === "registerTool")
        )
      )
    ) {
      found = true;
      return;
    }
    if (!found) {
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return found;
}
