import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeFlowEngineSource,
  evaluateFlowEngineChange,
  runBoundaryCli,
  type FlowEngineChangeDeclaration
} from "../scripts/validate-flow-engine-boundary.mjs";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const baseDeclaration = {
  id: "fixture-change",
  spt_path: ".agents/PLAN-TASKS/fixture.md",
  responsibility: "goal fiscal policy",
  owner: "$refactoring-fowler-rich",
  destination_module: "src/goal/goal-fiscal-policy.ts",
  consumers: ["src/server.ts"],
  evidence: ["tests/flow-engine-boundary.test.ts"],
  evidence_selectors: { "tests/flow-engine-boundary.test.ts": "flow-engine responsibility balance" },
  changelog_marker: "PPIRTV-FLOW-ENGINE-RESPONSIBILITY-BALANCE",
  architecture_marker: "fixture-change"
} satisfies Partial<FlowEngineChangeDeclaration>;

describe("flow-engine responsibility balance", () => {
  it("returns NOT_APPLICABLE when flow-engine.ts did not change", () => {
    const source = "export class FlowEngine { run() { return true; } }\n";
    const result = evaluateFlowEngineChange({ baseSource: source, headSource: source });

    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.flow_engine_changed).toBe(false);
  });

  it("accepts SHRINK only when named symbols disappear with decisions preserved or reduced", () => {
    const baseSource = `
      export class FlowEngine {
        legacyPolicy(value: boolean) { if (value) return "yes"; return "no"; }
        run(value: boolean) { return this.legacyPolicy(value); }
      }
    `;
    const headSource = `
      import { goalFiscalPolicy } from "./goal/goal-fiscal-policy.js";
      export class FlowEngine { run(value: boolean) { return goalFiscalPolicy(value); } }
    `;
    const result = evaluateFlowEngineChange({
      baseSource,
      headSource,
      declaration: {
        ...baseDeclaration,
        mode: "SHRINK",
        removed_symbols: ["legacyPolicy"],
        symbol_mappings: { legacyPolicy: "goalFiscalPolicy" },
        same_responsibility: true,
        behavior_preserved_by: ["tests/goal-fiscal-policy.test.ts"]
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.mode).toBe("SHRINK");
    expect(result.metrics.decision_points.delta).toBeLessThanOrEqual(0);
  });

  it("rejects line compression that removes no responsibility", () => {
    const baseSource = `
      export class FlowEngine {
        run(value: boolean) {
          if (value) return "yes";
          return "no";
        }
      }
    `;
    const headSource = `export class FlowEngine { run(value: boolean) { if (value) return "yes"; return "no"; } }`;
    const result = evaluateFlowEngineChange({
      baseSource,
      headSource,
      declaration: {
        ...baseDeclaration,
        mode: "SHRINK",
        removed_symbols: [],
        symbol_mappings: {},
        same_responsibility: true,
        behavior_preserved_by: ["tests/flow-engine-boundary.test.ts"]
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("SHRINK_REQUIRES_REMOVED_SYMBOL");
  });

  it("accepts CONTAIN for glue only and opens a payable debt", () => {
    const baseSource = `export class FlowEngine { run() { return true; } }`;
    const headSource = `
      import { diagnose } from "./spt-path-diagnostics.js";
      export class FlowEngine { run() { return diagnose(); } }
    `;
    const result = evaluateFlowEngineChange({
      baseSource,
      headSource,
      declaration: {
        ...baseDeclaration,
        mode: "CONTAIN",
        glue_only: true,
        debt: {
          id: "FE-DEBT-001",
          status: "open",
          owner: "$refactoring-fowler-rich",
          when: "next diff that touches src/flow-engine.ts",
          responsibility: "goal fiscal policy",
          payment_scope: "any_verified_shrink"
        }
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.mode).toBe("CONTAIN");
  });

  it("rejects CONTAIN when a new branch enters the facade", () => {
    const baseSource = `export class FlowEngine { run(value: boolean) { return value; } }`;
    const headSource = `export class FlowEngine { run(value: boolean) { if (value) return true; return false; } }`;
    const result = evaluateFlowEngineChange({
      baseSource,
      headSource,
      declaration: {
        ...baseDeclaration,
        mode: "CONTAIN",
        glue_only: true,
        debt: {
          id: "FE-DEBT-002",
          status: "open",
          owner: "$refactoring-fowler-rich",
          when: "next diff that touches src/flow-engine.ts",
          responsibility: "goal fiscal policy",
          payment_scope: "any_verified_shrink"
        }
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("CONTAIN_ADDED_DECISION_POINT");
  });

  it("allows one bounded EXCEPTION but rejects consecutive exceptions", () => {
    const baseSource = `export class FlowEngine { run(value: boolean) { return value; } }`;
    const headSource = `export class FlowEngine { run(value: boolean) { if (!value) throw new Error("integrity"); return value; } }`;
    const declaration = {
      ...baseDeclaration,
      mode: "EXCEPTION",
      exception_reason: "integrity",
      rollback: "Revert the isolated guard commit.",
      expires: "next diff that touches src/flow-engine.ts",
      red_evidence: "tests/engine.test.ts::integrity",
      red_base_blob: "a".repeat(40),
      red_observed_failure: "integrity guard absent at the base revision",
      red_command: "vitest tests/engine.test.ts -t integrity"
    } satisfies FlowEngineChangeDeclaration;

    const accepted = evaluateFlowEngineChange({ baseSource, headSource, declaration, history: [] });
    const rejected = evaluateFlowEngineChange({
      baseSource,
      headSource,
      declaration,
      history: [{ mode: "EXCEPTION", id: "previous-exception" }]
    });

    expect(accepted.status).toBe("PASS");
    expect(rejected.status).toBe("FAIL");
    expect(rejected.reasons).toContain("CONSECUTIVE_EXCEPTION_FORBIDDEN");
  });

  it("blocks a second CONTAIN while debt is open and accepts SHRINK that pays it", () => {
    const history = [{
      id: "previous-containment",
      mode: "CONTAIN",
      debt: { id: "FE-DEBT-OPEN", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" }
    }];
    const contain = evaluateFlowEngineChange({
      baseSource: `export class FlowEngine { run() { return true; } }`,
      headSource: `import { next } from "./next.js"; export class FlowEngine { run() { return next(); } }`,
      history,
      declaration: {
        ...baseDeclaration,
        mode: "CONTAIN",
        glue_only: true,
        debt: { id: "FE-DEBT-NEW", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" }
      }
    });
    const shrink = evaluateFlowEngineChange({
      baseSource: `
        export class FlowEngine {
          legacyPolicy() { return true; }
          run() { return this.legacyPolicy(); }
        }
      `,
      headSource: `
        import { policy } from "./policy.js";
        export class FlowEngine { run() { return policy(); } }
      `,
      history,
      declaration: {
        ...baseDeclaration,
        mode: "SHRINK",
        removed_symbols: ["legacyPolicy"],
        symbol_mappings: { legacyPolicy: "policy" },
        same_responsibility: true,
        behavior_preserved_by: ["tests/policy.test.ts"],
        pays_debt_id: "FE-DEBT-OPEN"
      }
    });

    expect(contain.status).toBe("FAIL");
    expect(contain.reasons).toContain("OPEN_DEBT_MUST_BE_PAID:FE-DEBT-OPEN");
    expect(shrink.status).toBe("PASS");
  });

  it("does not let a non-SHRINK record pay debt", () => {
    const history = [
      { mode: "CONTAIN", responsibility: "goal fiscal policy", debt: { id: "FE-DEBT-OPEN", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" } },
      { mode: "EXCEPTION", pays_debt_id: "FE-DEBT-OPEN" }
    ];
    const result = evaluateFlowEngineChange({
      baseSource: `export class FlowEngine { run() { return true; } }`,
      headSource: `import { next } from "./next.js"; export class FlowEngine { run() { return next(); } }`,
      history,
      declaration: {
        ...baseDeclaration,
        mode: "CONTAIN",
        glue_only: true,
        debt: { id: "FE-DEBT-NEW", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" }
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("OPEN_DEBT_MUST_BE_PAID:FE-DEBT-OPEN");
  });

  it("accepts any independently verified SHRINK as payment for global monolith debt", () => {
    const history = [{
      mode: "CONTAIN",
      responsibility: "spt path diagnostics",
      debt: { id: "FE-DEBT-SPT", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "spt path diagnostics", payment_scope: "any_verified_shrink" }
    }];
    const result = evaluateFlowEngineChange({
      baseSource: `
        export class FlowEngine {
          legacyPolicy() { return true; }
          run() { return this.legacyPolicy(); }
        }
      `,
      headSource: `
        import { policy } from "./policy.js";
        export class FlowEngine { run() { return policy(); } }
      `,
      history,
      declaration: {
        ...baseDeclaration,
        mode: "SHRINK",
        removed_symbols: ["legacyPolicy"],
        symbol_mappings: { legacyPolicy: "policy" },
        same_responsibility: true,
        behavior_preserved_by: ["tests/policy.test.ts"],
        pays_debt_id: "FE-DEBT-SPT"
      }
    });

    expect(result.status).toBe("PASS");
  });

  it("rejects a relocated decision even when the global count stays flat", () => {
    const result = evaluateFlowEngineChange({
      baseSource: `export class FlowEngine { legacy(value: boolean) { if (value) return 1; return 0; } run() { return 0; } }`,
      headSource: `export class FlowEngine { legacy() { return 0; } run(value: boolean) { if (value) return 1; return 0; } }`,
      declaration: {
        ...baseDeclaration,
        mode: "CONTAIN",
        glue_only: true,
        debt: { id: "FE-DEBT-MOVED", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" }
      }
    });

    expect(result.metrics.decision_points.delta).toBe(0);
    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("CONTAIN_ADDED_OR_RELOCATED_DECISION");
  });

  it("rejects a relocated boolean policy disguised as guard adaptation", () => {
    const result = evaluateFlowEngineChange({
      baseSource: `export class FlowEngine { old(a: boolean, b: boolean) { return a && b; } run() { return true; } }`,
      headSource: `export class FlowEngine { old() { return true; } run(a: boolean, b: boolean) { return a && b; } }`,
      declaration: {
        ...baseDeclaration,
        mode: "CONTAIN",
        glue_only: true,
        guard_adaptation: "boolean policy moved",
        debt: { id: "FE-DEBT-GUARD", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" }
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("CONTAIN_ADDED_POLICY_GUARD");
  });

  it("rejects an unbounded exception with a decorative rollback", () => {
    const result = evaluateFlowEngineChange({
      baseSource: `export class FlowEngine { run(value: boolean) { return value; } }`,
      headSource: `export class FlowEngine { run(value: boolean) { if (!value) throw new Error("integrity"); return value; } }`,
      declaration: {
        ...baseDeclaration,
        mode: "EXCEPTION",
        exception_reason: "security",
        rollback: "x",
        expires: "9999-12-31",
        red_evidence: "tests/engine.test.ts"
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("EXCEPTION_REQUIRES_ACTIONABLE_ROLLBACK");
    expect(result.reasons).toContain("EXCEPTION_REQUIRES_BOUNDED_EXPIRY");
    expect(result.reasons).toContain("EXCEPTION_REQUIRES_CAUSAL_RED_SELECTOR");
  });

  it("reports structural metrics independently from formatting", () => {
    const expanded = analyzeFlowEngineSource(`
      export function decide(value: boolean) {
        if (value) return 1;
        return 0;
      }
    `);
    const compressed = analyzeFlowEngineSource(`export function decide(value: boolean) { if (value) return 1; return 0; }`);

    expect(expanded.decision_points).toBe(compressed.decision_points);
    expect(expanded.guard_expressions).toBe(compressed.guard_expressions);
    expect(expanded.symbols).toEqual(compressed.symbols);
    expect(expanded.nonblank_lines).toBeGreaterThan(compressed.nonblank_lines);
  });

  it("fails a changed worktree without changelog proof and passes after the marker exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-boundary-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    const baseSource = `export class FlowEngine { run() { return true; } }\n`;
    const headSource = `import { diagnose } from "./diagnostics.js";\nexport class FlowEngine { run() { return diagnose(); } }\n`;
    await writeFile(path.join(root, "src", "flow-engine.ts"), baseSource);
    await writeFile(path.join(root, "src", "diagnostics.ts"), "export const diagnose = () => true;\n");
    await writeFile(path.join(root, "src", "server.ts"), "import { diagnose } from './diagnostics.js';\nexport const server = diagnose;\n");
    await writeFile(path.join(root, "tests", "flow-engine-boundary.test.ts"), "it('flow-engine responsibility balance', () => {});\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nfixture-change\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "baseline"], { cwd: root });
    const baseBlob = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "src", "flow-engine.ts"), headSource);
    const headBlob = execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const manifest = {
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: [{
        ...baseDeclaration,
        mode: "CONTAIN",
        base_blob: baseBlob,
        head_blob: headBlob,
        destination_module: "src/diagnostics.ts",
        glue_only: true,
        debt: { id: "FE-DEBT-FIXTURE", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" }
      }]
    };
    manifest.records[0].evidence = ["tests/missing.test.ts"];
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify(manifest));

    const masked = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD", "--head", "HEAD"] });
    const red = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD", "--head", "WORKTREE"] });
    await writeFile(path.join(root, "CHANGELOG.md"), `# Changelog\n\n## [Unreleased]\n${baseDeclaration.changelog_marker}\n`);
    const missingEvidence = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD", "--head", "WORKTREE"] });
    manifest.records[0].evidence = ["tests/flow-engine-boundary.test.ts"];
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify(manifest));
    await writeFile(path.join(root, "tests", "flow-engine-boundary.test.ts"), "it.skip('flow-engine responsibility balance', () => {});\n");
    const skippedEvidence = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD", "--head", "WORKTREE"] });
    await writeFile(path.join(root, "tests", "flow-engine-boundary.test.ts"), "it('flow-engine responsibility balance', () => {});\n");
    await writeFile(path.join(root, "src", "server.ts"), "import type { diagnose } from './diagnostics.js';\nexport type Diagnostic = typeof diagnose;\n");
    const typeOnlyConsumer = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD", "--head", "WORKTREE"] });
    await writeFile(path.join(root, "src", "server.ts"), "import { diagnose } from './diagnostics.js';\nexport type Diagnostic = typeof diagnose;\n");
    const typePositionConsumer = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD", "--head", "WORKTREE"] });
    await writeFile(path.join(root, "src", "server.ts"), "import { diagnose } from './diagnostics.js';\nexport const server = diagnose;\n");
    const green = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD", "--head", "WORKTREE"] });

    expect(JSON.parse(masked.output).reasons).toContain("EXPLICIT_COMPARISON_IGNORES_DIRTY_TARGET");
    expect(red.exitCode).toBe(1);
    expect(JSON.parse(red.output).reasons).toContain("CHANGELOG_MARKER_REQUIRED_IN_UNRELEASED");
    expect(JSON.parse(missingEvidence.output).reasons).toContain("EVIDENCE_NOT_FOUND:tests/missing.test.ts");
    expect(JSON.parse(skippedEvidence.output).reasons).toContain("CAUSAL_TEST_SELECTOR_REQUIRED");
    expect(JSON.parse(typeOnlyConsumer.output).reasons.some((reason: string) => reason.startsWith("PRODUCT_CONSUMER_EDGE_NOT_FOUND"))).toBe(true);
    expect(JSON.parse(typePositionConsumer.output).reasons.some((reason: string) => reason.startsWith("PRODUCT_CONSUMER_EDGE_NOT_FOUND"))).toBe(true);
    expect(green.exitCode).toBe(0);
    expect(JSON.parse(green.output)).toMatchObject({ status: "PASS", mode: "CONTAIN" });
  });

  it("rejects deleted ledger history and reuse of an old changelog marker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-ledger-"));
    tempRoots.push(root);
    for (const directory of ["src", "tests", "docs/architecture"]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }
    const baseSource = `export class FlowEngine { run() { return true; } }\n`;
    await writeFile(path.join(root, "src", "flow-engine.ts"), baseSource);
    await writeFile(path.join(root, "src", "previous.ts"), "export const previous = () => true;\n");
    await writeFile(path.join(root, "src", "next.ts"), "export const next = () => true;\n");
    await writeFile(path.join(root, "src", "server.ts"), "import { previous } from './previous.js';\nexport const server = previous;\n");
    await writeFile(path.join(root, "tests", "proof.test.ts"), "test('proof', () => {});\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nold-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nold-record\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    const baseBlob = execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const baseManifest = {
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: [{
        ...baseDeclaration,
        id: "old-record",
        mode: "CONTAIN",
        base_blob: baseBlob,
        head_blob: baseBlob,
        destination_module: "src/previous.ts",
        consumers: ["src/server.ts"],
        evidence: ["tests/proof.test.ts"],
        evidence_selectors: { "tests/proof.test.ts": "proof" },
        changelog_marker: "old-marker",
        architecture_marker: "old-record",
        glue_only: true,
        debt: { id: "FE-DEBT-OPEN", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" }
      }]
    };
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify(baseManifest));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "baseline"], { cwd: root });

    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify({ ...baseManifest, records: [] }));
    const ledgerOnly = runBoundaryCli({ cwd: root });

    const headSource = `import { next } from "./next.js";\nexport class FlowEngine { run() { return next(); } }\n`;
    await writeFile(path.join(root, "src", "flow-engine.ts"), headSource);
    await writeFile(path.join(root, "src", "server.ts"), "import { next } from './next.js';\nexport const server = next;\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nold-record\nnew-record\n");
    const headBlob = execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const forgedManifest = {
      ...baseManifest,
      records: [{
        ...baseDeclaration,
        id: "new-record",
        mode: "CONTAIN",
        base_blob: baseBlob,
        head_blob: headBlob,
        destination_module: "src/next.ts",
        consumers: ["src/server.ts"],
        evidence: ["tests/proof.test.ts"],
        evidence_selectors: { "tests/proof.test.ts": "proof" },
        changelog_marker: "old-marker",
        architecture_marker: "new-record",
        glue_only: true,
        debt: { id: "FE-DEBT-NEW", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" }
      }]
    };
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify(forgedManifest));

    const result = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD", "--head", "WORKTREE"] });
    const receipt = JSON.parse(result.output);
    expect(JSON.parse(ledgerOnly.output).reasons).toContain("LEDGER_CHANGE_REQUIRES_TARGET_CHANGE");
    expect(result.exitCode).toBe(1);
    expect(receipt.reasons).toContain("LEDGER_HISTORY_MUTATED");
    expect(receipt.reasons).toContain("LEDGER_REQUIRES_SINGLE_APPENDED_RECORD");
    expect(receipt.reasons).toContain("CHANGELOG_MARKER_MUST_BE_NEW");
  });

  it("rejects a forged first ledger bootstrap", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-bootstrap-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    const source = `export class FlowEngine { run() { return true; } }\n`;
    await writeFile(path.join(root, "src", "flow-engine.ts"), source);
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nforged-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nforged-record\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "baseline without ledger"], { cwd: root });
    const headBlob = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const forged = {
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: [{
        ...baseDeclaration,
        id: "forged-record",
        commit: "HEAD",
        mode: "SHRINK",
        base_blob: headBlob,
        head_blob: headBlob,
        changelog_marker: "forged-marker",
        architecture_marker: "forged-record",
        removed_symbols: ["invented"],
        symbol_mappings: { invented: "invented" },
        same_responsibility: true,
        behavior_preserved_by: ["tests/missing.test.ts"]
      }]
    };
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify(forged));

    const result = runBoundaryCli({ cwd: root });
    const receipt = JSON.parse(result.output);
    expect(result.exitCode).toBe(1);
    expect(receipt.ledger_bootstrap).toMatchObject({ status: "FAIL", records_replayed: 1 });
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_PARENT_REQUIRED"))).toBe(true);
  });

  it("keeps the living architecture public and discoverable", async () => {
    const [readme, agents, rootIndex, docsIndex, gitignore, architecture, ledger] = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("AGENTS.md", "utf8"),
      readFile("INDEX.md", "utf8"),
      readFile("docs/INDEX.md", "utf8"),
      readFile(".gitignore", "utf8"),
      readFile("docs/architecture/FLOW_ENGINE_EVOLUTION.md", "utf8"),
      readFile("docs/architecture/flow-engine-evolution.json", "utf8")
    ]);

    for (const surface of [readme, agents, rootIndex]) {
      expect(surface).toContain("docs/architecture/FLOW_ENGINE_EVOLUTION.md");
    }
    expect(docsIndex).toContain("architecture/FLOW_ENGINE_EVOLUTION.md");
    expect(gitignore).toContain("!docs/architecture/**");
    expect(architecture).toContain("PPIRTV-FLOW-ENGINE-RESPONSIBILITY-BALANCE");
    expect(JSON.parse(ledger)).toMatchObject({ contract: "dex.flow-engine.evolution-ledger.v1" });
  });
});
