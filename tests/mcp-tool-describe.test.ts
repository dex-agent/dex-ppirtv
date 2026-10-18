import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repo = process.cwd();
const script = path.join(repo, "scripts", "call-mcp-tool.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, [script, "--workspace", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env }
  });
}

describe("call-mcp-tool describe/schema/usage", () => {
  it("prints a tool description and schema without invoking the tool", () => {
    const result = run(["--describe", "evidence_add"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("evidence_add");
    expect(parsed.description).toContain("six review keys FLAT");
    expect(parsed.input_schema.type).toBe("object");
    expect(parsed.input_schema.required).toContain("flow_id");
    expect(parsed.result).toBeUndefined();
    expect(parsed.runtime_probe).toBeUndefined();
  });

  it("prints raw schema and human usage aliases", () => {
    const schema = run(["--schema", "evidence_add"]);
    expect(schema.status).toBe(0);
    const raw = JSON.parse(schema.stdout);
    expect(raw.type).toBe("object");
    expect(raw.required).toContain("title");

    const usage = run(["--usage", "evidence_add"]);
    expect(usage.status).toBe(0);
    expect(usage.stdout).toContain("Required arguments:");
    expect(usage.stdout).toContain("flow_id");
    expect(usage.stdout).toContain("--describe");
  });

  it("fails closed for an unknown tool", () => {
    const result = run(["--describe", "tool_that_does_not_exist"]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("TOOL_NOT_FOUND");
  });

  it("documents git commit corroboration and the review_required resolution route", () => {
    const start = run(["--describe", "goal_start"]);
    expect(start.status).toBe(0);
    const startDoc = JSON.parse(start.stdout);
    expect(startDoc.description).toContain("freezes git_head_base");
    expect(startDoc.description).toContain("no commit baseline");

    const verdict = run(["--usage", "goal_verdict"]);
    expect(verdict.status).toBe(0);
    expect(verdict.stdout).toContain("git diff git_head_base..HEAD");
    expect(verdict.stdout).toContain(".ppirtv/");
    expect(verdict.stdout).toContain("fail closed");
    expect(verdict.stdout).toContain("Resolution route");
    expect(verdict.stdout).toContain("six flat review keys");
  });
});
