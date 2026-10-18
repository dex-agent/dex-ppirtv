import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repo = process.cwd();
const entry = path.join(repo, "dist", "index.js");

function run(args: string[]) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 15000
  });
}

describe("dist/index.js read-only tool help", () => {
  it("prints help without starting the stdio server", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--describe <tool>");
    expect(result.stdout).toContain("never invoke");
  });

  it("fails closed when --describe has no tool", () => {
    const result = run(["--describe"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("--describe <tool>");
  });

  it("prints description and schema from tools/list without calling the tool", () => {
    const result = run(["--describe", "evidence_add"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("evidence_add");
    expect(parsed.description).toContain("six review keys FLAT");
    expect(parsed.input_schema.type).toBe("object");
    expect(parsed.result).toBeUndefined();
    expect(parsed.runtime_probe).toBeUndefined();
  });

  it("prints raw schema and human usage aliases", () => {
    const schema = run(["--schema", "evidence_add"]);
    expect(schema.status).toBe(0);
    expect(JSON.parse(schema.stdout).type).toBe("object");

    const usage = run(["--usage", "evidence_add"]);
    expect(usage.status).toBe(0);
    expect(usage.stdout).toContain("Required arguments:");
    expect(usage.stdout).toContain("flow_id");
  });
});
