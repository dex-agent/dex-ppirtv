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
    expect(result.metrics!.decision_points.delta).toBeLessThanOrEqual(0);
  });

  it("accepts the current camping owner $oraculo-refatoracao alongside the legacy owner", () => {
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
    const shrinkScenario = (owner: string) => evaluateFlowEngineChange({
      baseSource,
      headSource,
      declaration: {
        ...baseDeclaration,
        owner,
        mode: "SHRINK",
        removed_symbols: ["legacyPolicy"],
        symbol_mappings: { legacyPolicy: "goalFiscalPolicy" },
        same_responsibility: true,
        behavior_preserved_by: ["tests/goal-fiscal-policy.test.ts"]
      }
    });

    expect(shrinkScenario("$oraculo-refatoracao").status).toBe("PASS");
    expect(shrinkScenario("$refactoring-fowler-rich").status).toBe("PASS");
    expect(shrinkScenario("$owner-desconhecido").reasons).toContain("DECLARATION_OWNER_INVALID");
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


  it("RED classe selagem retroativa + convergencia: EXCEPTION apos record retroativo selado ou que supersede passa; sem isso falha", () => {
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

    const retroactiveSeal = evaluateFlowEngineChange({
      baseSource, headSource, declaration,
      history: [{ mode: "EXCEPTION", id: "sealed-old-cut", commit: "5b66f56", sealed_retroactive: true }]
    });
    expect(retroactiveSeal.status).toBe("PASS");

    const superseded = evaluateFlowEngineChange({
      baseSource, headSource,
      declaration: { ...declaration, supersedes_record: "recent-exception" },
      history: [{ mode: "EXCEPTION", id: "recent-exception" }]
    });
    expect(superseded.status).toBe("PASS");

    const plain = evaluateFlowEngineChange({
      baseSource, headSource, declaration,
      history: [{ mode: "EXCEPTION", id: "recent-exception" }]
    });
    expect(plain.status).toBe("FAIL");
    expect(plain.reasons).toContain("CONSECUTIVE_EXCEPTION_FORBIDDEN");
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

    expect(result.metrics!.decision_points.delta).toBe(0);
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
    expect(receipt.reasons).toContain("LEDGER_REQUIRES_APPENDED_RECORDS_COVERING_DIFF");
    expect(receipt.reasons).toContain("CHANGELOG_MARKER_MUST_BE_NEW");
  });

  it("accepts a covered ledger chain when the accumulated origin-main..HEAD diff spans several classified visits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-chain-"));
    tempRoots.push(root);
    for (const directory of ["src", "tests", "docs/architecture", ".agents/PLAN-TASKS"]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }
    const v0 = "export class FlowEngine {\n  legacyPolicy() { return true; }\n  run() { return this.legacyPolicy(); }\n}\n";
    const v1 = "import { policy } from \"./policy.js\";\nexport class FlowEngine {\n  legacyPolicy() { return true; }\n  run() { return policy(); }\n}\n";
    const v2 = "import { policy } from \"./policy.js\";\nexport class FlowEngine {\n  run() { return policy(); }\n}\n";
    await writeFile(path.join(root, "src", "flow-engine.ts"), v0);
    await writeFile(path.join(root, "src", "policy.ts"), "export const policy = () => true;\n");
    await writeFile(path.join(root, "src", "server.ts"), "import { policy } from './policy.js';\nexport const server = policy;\n");
    await writeFile(path.join(root, "tests", "policy.test.ts"), "test('policy', () => {});\n");
    await writeFile(path.join(root, "tests", "flow-engine-boundary.test.ts"), "it('flow-engine responsibility balance', () => {});\n");
    await writeFile(path.join(root, ".agents", "PLAN-TASKS", "fixture.md"), "# Fixture SPT\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n");
    const gitIn = (args: string[]) => execFileSync("git", args, { cwd: root });
    gitIn(["init"]);
    gitIn(["config", "user.email", "fixture@example.invalid"]);
    gitIn(["config", "user.name", "Fixture"]);
    gitIn(["add", "."]);
    gitIn(["commit", "-m", "baseline"]);
    gitIn(["update-ref", "refs/remotes/origin/main", execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()]);
    const blobAtRef = (ref: string) => execFileSync("git", ["rev-parse", `${ref}:src/flow-engine.ts`], { cwd: root, encoding: "utf8" }).trim();

    // Visit 1: CONTAIN (glue only) opening a payable debt.
    await writeFile(path.join(root, "src", "flow-engine.ts"), v1);
    const record1 = {
      ...baseDeclaration,
      id: "chain-visit-1",
      mode: "CONTAIN",
      base_blob: blobAtRef("HEAD"),
      head_blob: execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim(),
      destination_module: "src/policy.ts",
      glue_only: true,
      debt: { id: "FE-DEBT-CHAIN", status: "open", owner: "$refactoring-fowler-rich", when: "next target diff", responsibility: "goal fiscal policy", payment_scope: "any_verified_shrink" }
    };
    await writeFile(path.join(root, "CHANGELOG.md"), `# Changelog\n\n## [Unreleased]\n${record1.changelog_marker}\n`);
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), `# Architecture\n${record1.architecture_marker}\n`);
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify({
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: [record1]
    }));
    gitIn(["add", "."]);
    gitIn(["commit", "-m", "visit 1"]);

    // Visit 2: SHRINK paying the debt and chaining from visit 1's head blob.
    await writeFile(path.join(root, "src", "flow-engine.ts"), v2);
    const record2 = {
      ...baseDeclaration,
      id: "chain-visit-2",
      mode: "SHRINK",
      base_blob: blobAtRef("HEAD"),
      head_blob: execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim(),
      destination_module: "src/policy.ts",
      removed_symbols: ["legacyPolicy"],
      symbol_mappings: { legacyPolicy: "policy" },
      same_responsibility: true,
      behavior_preserved_by: ["tests/policy.test.ts"],
      pays_debt_id: "FE-DEBT-CHAIN"
    };
    await writeFile(path.join(root, "CHANGELOG.md"), `# Changelog\n\n## [Unreleased]\n${record1.changelog_marker}\n${record2.changelog_marker}\n`);
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), `# Architecture\n${record1.architecture_marker}\n${record2.architecture_marker}\n`);
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify({
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: [record1, record2]
    }));
    gitIn(["add", "."]);
    gitIn(["commit", "-m", "visit 2"]);

    // Clean tree, HEAD ahead of origin/main: the accumulated diff has no single
    // (base_blob, head_blob) pair — only the covered chain can prove it.
    const accumulated = runBoundaryCli({ cwd: root, argv: [] });
    const receipt = JSON.parse(accumulated.output);
    expect(accumulated.exitCode).toBe(0);
    expect(receipt).toMatchObject({ status: "PASS", declaration_id: "chain-visit-2" });
    expect(receipt.ledger_chain).toMatchObject({ status: "PASS", records: ["chain-visit-1", "chain-visit-2"] });

    // A broken link in the middle must fall back to MATCHING_DECLARATION_REQUIRED.
    const broken = JSON.parse(JSON.stringify([record1, record2]));
    broken[1].base_blob = "0".repeat(40);
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify({
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: broken
    }));
    const brokenRun = runBoundaryCli({ cwd: root, argv: ["--base", "origin/main"] });
    expect(JSON.parse(brokenRun.output).reasons).toContain("MATCHING_DECLARATION_REQUIRED");
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

  // Corte de cura (P1 adversarial Onda 2): selo parent_commit mentiroso em
  // commit de PAI ÚNICO passava em silêncio (l.495 usava parents[0] e ignorava
  // o campo armazenado). RED primeiro: sealedParentReasons não existe no
  // baseline 9df1304.
  it("sealedParentReasons reprova parent_commit que não casa nenhum pai real — inclusive em pai único — e aceita prefixo não-ambíguo", async () => {
    const module = await import("../scripts/validate-flow-engine-boundary.mjs") as unknown as Record<string, unknown>;
    const sealedParentReasons = module.sealedParentReasons as
      ((record: Record<string, unknown>, parents: string[]) => string[]) | undefined;
    expect(typeof sealedParentReasons).toBe("function");

    const realParent = "0bdd37598e86f0f8f8cf8f0f8f8cf8f0f8f8cf8f";
    // pai único + pai armazenado que não é pai (o caso 5b66f56 do PATH-ATTRIBUTION)
    expect(sealedParentReasons!({ parent_commit: "5b66f564e4b27aca7527e3d10d7fe4b5cf86319c" }, [realParent]))
      .toEqual(["COMMIT_PARENT_MISMATCH"]);
    // prefixo não-ambíguo (sha curto legado) aceita
    expect(sealedParentReasons!({ parent_commit: "0bdd375" }, [realParent])).toEqual([]);
    // pai cheio aceita
    expect(sealedParentReasons!({ parent_commit: realParent }, [realParent])).toEqual([]);
    // sem parent_commit armazenado: helper sem opinião (COMMIT_PARENT_REQUIRED cuida do merge)
    expect(sealedParentReasons!({}, [realParent])).toEqual([]);
    // merge com pai armazenado que não casa nenhum dos pais reais
    expect(sealedParentReasons!({ parent_commit: "abc1234def567890abc1234def567890abc1234d" }, [realParent, "080abdd4e7c688265d8389e1d84c3480a8aa72fc"]))
      .toEqual(["COMMIT_PARENT_MISMATCH"]);
  });

  // Cura-2 (P1 adversarial da cura): o helper vivia SÓ no replay de bootstrap
  // (inalcançável desde o manifesto existir) — o selo vivo aceitava
  // parent_commit mentiroso conferindo apenas o blob. RED primeiro: no
  // baseline 665bb5f este selo passa em silêncio.
  it("selo vivo reprova parent_commit mentiroso do record selado (COMMIT_SEAL_PARENT_MISMATCH)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return true; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "commit 0 preterido"], { cwd: root });
    const liarParent = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

    const unsealedRecord: Record<string, unknown> = {
      ...baseDeclaration,
      id: "seal-cura2",
      mode: "EXCEPTION",
      exception_reason: "integrity",
      rollback: "revert do commit de selagem",
      expires: "2026-11-15",
      red_evidence: "tests/flow-engine-boundary.test.ts::selo vivo reprova parent_commit mentiroso do record selado (COMMIT_SEAL_PARENT_MISMATCH)",
      red_base_blob: "0".repeat(40),
      red_observed_failure: "RED da cura-2",
      red_command: "npx vitest run tests/flow-engine-boundary.test.ts -t \"selo vivo reprova parent_commit mentiroso do record selado (COMMIT_SEAL_PARENT_MISMATCH)\"",
      changelog_marker: "seal-marker",
      architecture_marker: "seal-marker",
      consumers: ["src/server.ts"]
    };
    // blobs ANTES da selagem: selagem real so adiciona commit/parent_commit
    unsealedRecord.base_blob = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    unsealedRecord.head_blob = unsealedRecord.base_blob;
    const manifestOf = (record: Record<string, unknown>) => JSON.stringify({
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: [record]
    });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf(unsealedRecord));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "ledger sem selo"], { cwd: root });
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const headBlob = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();

    // selagem MENTIROSA: commit real do selo, mas parent_commit aponta para o
    // commit 0 (ancestral) — o pai real do commit de selagem é o commit do
    // ledger sem selo.
    execFileSync("git", ["commit", "--allow-empty", "-m", "selagem"], { cwd: root });
    const sealCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const sealedRecord = {
      ...unsealedRecord,
      commit: sealCommit,
      parent_commit: liarParent
    };
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf(sealedRecord));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "selo mentiroso"], { cwd: root });

    const result = runBoundaryCli({ cwd: root, argv: ["--base", baseSha] });
    const receipt = JSON.parse(result.output);
    expect(result.exitCode).toBe(1);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_PARENT_MISMATCH:seal-cura2"))).toBe(true);
  });

  // Cura-3 (P1 adversarial cura-2, confirmado por comando): seletor que o
  // vitest -t (REGEX) não executa passava no gate (substring acha, regex não
  // casa — parênteses literais). RED primeiro: helper não existe no baseline.
  it("selectorRunsAsRegex detecta seletor que substring-acha mas regex não casa o título", async () => {
    const module = await import("../scripts/validate-flow-engine-boundary.mjs") as unknown as Record<string, unknown>;
    const selectorRunsAsRegex = module.selectorRunsAsRegex as
      ((selector: string, titles: string[]) => boolean) | undefined;
    expect(typeof selectorRunsAsRegex).toBe("function");
    const title = "selo vivo reprova parent_commit mentiroso do record selado (COMMIT_SEAL_PARENT_MISMATCH)";
    // o caso canônico: seletor idêntico ao título com parênteses — substring acha, regex não casa
    expect(selectorRunsAsRegex!(title, [title])).toBe(false);
    // seletor sem parênteses casa
    expect(selectorRunsAsRegex!("selo vivo reprova parent_commit mentiroso", [title])).toBe(true);
    // regex inválida não derruba (fail-safe: false)
    expect(selectorRunsAsRegex!("(", [title])).toBe(false);
  });

  // Cura-3 (P2 convergente 4 revisores): selagem SEM parent_commit passava em
  // silêncio (opt-in por omissão) e REMOÇÃO do campo em seal-diff idem.
  it("selagem exige parent_commit (MISSING) e reprova remoção do campo (REMOVED)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal3-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return true; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal3-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal3-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blob = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const baseRecord = {
      ...baseDeclaration,
      id: "seal-cura3",
      mode: "EXCEPTION",
      changelog_marker: "seal3-marker",
      architecture_marker: "seal3-marker",
      base_blob: blob,
      head_blob: blob,
      consumers: ["src/server.ts"]
    };
    const manifestOf = (record: Record<string, unknown>) => JSON.stringify({
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: [record]
    });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf(baseRecord));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "ledger sem selo"], { cwd: root });
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const parent = baseSha;

    // selagem SEM parent_commit: hoje passa (RED espera COMMIT_SEAL_PARENT_MISSING)
    execFileSync("git", ["commit", ["--allow-empty"], "-m", "selagem sem parent"].flat(), { cwd: root });
    const sealCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(
      path.join(root, "docs", "architecture", "flow-engine-evolution.json"),
      manifestOf({ ...baseRecord, commit: sealCommit })
    );
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "selo sem parent"], { cwd: root });
    const missingRun = runBoundaryCli({ cwd: root, argv: ["--base", baseSha] });
    const missingReceipt = JSON.parse(missingRun.output);
    expect(missingRun.exitCode).toBe(1);
    expect(missingReceipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_PARENT_MISSING:seal-cura3"))).toBe(true);

    // remocao do campo em seal-diff: base com parent honesto, head sem
    await writeFile(
      path.join(root, "docs", "architecture", "flow-engine-evolution.json"),
      manifestOf({ ...baseRecord, commit: sealCommit, parent_commit: parent })
    );
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "selo com parent"], { cwd: root });
    const withParentBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(
      path.join(root, "docs", "architecture", "flow-engine-evolution.json"),
      manifestOf({ ...baseRecord, commit: sealCommit })
    );
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "remove parent"], { cwd: root });
    const removedRun = runBoundaryCli({ cwd: root, argv: ["--base", withParentBase] });
    const removedReceipt = JSON.parse(removedRun.output);
    expect(removedRun.exitCode).toBe(1);
    expect(removedReceipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_PARENT_REMOVED:seal-cura3"))).toBe(true);
  });


  // Cura-4 (P1-1 adversarial cura-3, RED B1): motor-laundering — parent_commit
  // REMOVIDO de record selado passava quando o diff tocava o motor (stripSeal
  // isenta parent; LEDGER_PREFIX so conferia quando commit mudava; seal-diff
  // exige motor intocado). A conferencia de linhagem e INCONDICIONAL a janela.
  it("motor-laundering: parent removido de record selado reprova mesmo em diff de motor", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal4-b1-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal4-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal4-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const ledgerBase = {
      ...baseDeclaration,
      id: "seal-cura4-b1",
      mode: "EXCEPTION",
      destination_module: undefined,
      changelog_marker: "seal4-marker",
      architecture_marker: "seal4-marker",
      base_blob: blobV1,
      head_blob: blobV1,
      consumers: ["src/server.ts"]
    };
    const manifestOf = (recs: Record<string, unknown>[]) => JSON.stringify({
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: recs
    });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([ledgerBase]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "ledger base"], { cwd: root });
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    // selo honesto: commit real + parent real
    execFileSync("git", ["commit", ["--allow-empty"], "-m", "seal"].flat(), { cwd: root });
    const sealCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"),
      manifestOf([{ ...ledgerBase, commit: sealCommit, parent_commit: baseSha }]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "selo honesto"], { cwd: root });
    const sealBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    // laundry: diff TOCA O MOTOR, ANEXA declaration EXCEPTION legitima cobrindo o
    // corte E remove o parent do record selado (commit inalterado) — antes da
    // cura-4 passava porque o LEDGER_PREFIX so olhava commit mudado.
    const blobV2 = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: "export class FlowEngine { run() { return 2; } }\n", encoding: "utf8" }).trim();
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 2; } }\n");
    const declarationCover = {
      ...baseDeclaration,
      id: "seal-cura4-b1-cover",
      mode: "EXCEPTION",
      exception_reason: "integrity",
      expires: "2026-11-15",
      base_blob: blobV1,
      head_blob: blobV2,
      evidence: ["tests/flow-engine-boundary.test.ts"],
      changelog_marker: "seal4-marker",
      architecture_marker: "seal4-marker",
      consumers: ["src/server.ts"]
    };
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"),
      manifestOf([{ ...ledgerBase, commit: sealCommit }, declarationCover]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "motor + declaration + parent removido"], { cwd: root });
    const run = runBoundaryCli({ cwd: root, argv: ["--base", sealBase] });
    const receipt = JSON.parse(run.output);
    expect(run.exitCode).toBe(1);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_PARENT_REMOVED:seal-cura4-b1"))).toBe(true);
  });

  // Cura-4 (P1-1, RED B2): record NOVO nascendo com parent fabricado passava
  // no path de declaracao (loop LEDGER_PREFIX so cobria records da base).
  it("record novo com parent fabricado reprova no path de declaracao", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal4-b2-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal4-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal4-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 2; } }\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "motor muda"], { cwd: root });
    const headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const headBlob = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const fabricated = { ...baseDeclaration, id: "seal-cura4-b2", mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal4-marker", architecture_marker: "seal4-marker", base_blob: blobV1, head_blob: headBlob, consumers: ["src/server.ts"], commit: headCommit, parent_commit: "f000000000000000000000000000000000000000" };
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify({
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: [fabricated]
    }));
    // worktree sujo pelo manifest; base = HEAD (motor ja mudou no HEAD)
    const run = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD~1"] });
    const receipt = JSON.parse(run.output);
    expect(run.exitCode).toBe(1);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_PARENT_MISMATCH:seal-cura4-b2") || reason.includes("COMMIT_SEAL_PARENT_MISSING:seal-cura4-b2"))).toBe(true);
  });

  // Cura-4 (P1-2/P2, RED C): bootstrap com ledger legado de seletor com
  // parenteses era vermelho POR CONSTRUCAO — grandfathering declarado torna
  // o replay verde com a isencao visivel no codigo.
  it("bootstrap com seletor legado de parenteses e verde por grandfathering declarado", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal4-c-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, ".agents", "PLAN-TASKS"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return true; } }\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal4-marker\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal4-marker\n");
    await writeFile(path.join(root, "src", "server.ts"), 'import { FlowEngine } from "./flow-engine.js";\nexport const engine = new FlowEngine();\n');
    await writeFile(path.join(root, ".agents", "PLAN-TASKS", "fixture.md"), "# fixture\n");
    const titulo = "selo vivo reprova parent_commit mentiroso do record selado (COMMIT_SEAL_PARENT_MISMATCH)";
    await writeFile(path.join(root, "tests", "fixture-evidence.test.ts"), 'import { describe, expect, it } from "vitest";\ndescribe("g", () => { it(' + JSON.stringify(titulo) + ', () => { expect(true).toBe(true); }); });\n');
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blob = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("git", ["commit", ["--allow-empty"], "-m", "c1"].flat(), { cwd: root });
    const c0 = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: root, encoding: "utf8" }).trim();
    const c1 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const legacy = { ...baseDeclaration, id: "FE-2026-11-08-CURA2-VALIDADOR-SELO-VIVO", mode: "EXCEPTION", exception_reason: "integrity", expires: "2026-11-15", destination_module: undefined, changelog_marker: "seal4-marker", architecture_marker: "seal4-marker", base_blob: blob, head_blob: blob, consumers: ["src/server.ts"], evidence: ["tests/fixture-evidence.test.ts"], evidence_selectors: { "tests/fixture-evidence.test.ts": titulo }, red_evidence: `tests/fixture-evidence.test.ts::${titulo}`, red_base_blob: blob, commit: c1, parent_commit: c0, rollback: "reverte o commit", red_observed_failure: "RED provado no baseline", red_command: `npx vitest run tests/fixture-evidence.test.ts -t "${titulo}"` };
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify({
      contract: "dex.flow-engine.evolution-ledger.v1",
      target: "src/flow-engine.ts",
      owner: "$refactoring-fowler-rich",
      records: [legacy]
    }));
    // base SEM manifest -> bootstrap roda; motor intocado
    const run = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD", "--head", "WORKTREE"] });
    const receipt = JSON.parse(run.output);
    expect(run.exitCode).toBe(0);
    expect(receipt.reasons).toEqual([]);
  });


  // Cura-5 (P1 adversarial cura-4, RED 1): commit inexistente no seal-diff
  // CRASHAVA sem receipt (rev-list fora do try — regressão da reorganização da
  // cura-4). O error-path tem que devolver receipt com reason estruturado.
  // Fixture: manifest base commitado; selagem com commit f000 fica NO WORKTREE
  // (--head WORKTREE é o que faz o seal-diff ler o worktree sujo).
  it("seal-diff com commit inexistente devolve receipt estruturado sem crash", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal5-1-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal5-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal5-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blob = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const base = { ...baseDeclaration, id: "seal-cura5-1", mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal5-marker", architecture_marker: "seal5-marker", base_blob: blob, head_blob: blob, consumers: ["src/server.ts"] };
    const manifestOf = (recs: Record<string, unknown>[]) => JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: recs });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([base]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "base"], { cwd: root });
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    // selagem com commit INEXISTENTE (f000...) no worktree: deve vir reason, nao crash
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([{ ...base, commit: "f000000000000000000000000000000000000000", parent_commit: baseSha }]));
    const run = runBoundaryCli({ cwd: root, argv: ["--base", baseSha, "--head", "WORKTREE"] });
    expect(run.output.trim().length).toBeGreaterThan(0);
    const receipt = JSON.parse(run.output);
    expect(run.exitCode).toBe(1);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_COMMIT_NOT_FOUND:seal-cura5-1"))).toBe(true);
  });

  // Cura-5 (P2, RED 2): record novo (declaration do diff) com commit REAL cujo
  // blob diverge do head_blob declarado — o nascimento conferia so linhagem;
  // o blob do commit selado precisa casar com o head_blob do record.
  it("record novo com commit de blob divergente reprova no nascimento", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal5-2-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal5-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal5-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    // c1 empty: motor continua v1 — o commit selado NAO contem o blob novo
    execFileSync("git", ["commit", "--allow-empty", "-m", "c1"], { cwd: root });
    const c1 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const c0 = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 2; } }\n");
    const blobV2 = execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const lie = { ...baseDeclaration, id: "seal-cura5-2", mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal5-marker", architecture_marker: "seal5-marker", base_blob: blobV1, head_blob: blobV2, consumers: ["src/server.ts"], commit: c1, parent_commit: c0 };
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: [lie] }));
    const run = runBoundaryCli({ cwd: root, argv: ["--base", "HEAD~1", "--head", "WORKTREE"] });
    const receipt = JSON.parse(run.output);
    expect(run.exitCode).toBe(1);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_BLOB_MISMATCH:seal-cura5-2"))).toBe(true);
  });

  // Cura-5 (P2, RED 3): deselagem em diff de MOTOR — record A selado na base
  // perde o commit no head enquanto B cobre o diff; o guard antigo
  // (after.commit &&) deixava a remoção escapar limpa do LEDGER_PREFIX.
  it("deselagem: remover commit de record selado reprova COMMIT_SEAL_COMMIT_MISSING", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal5-3-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal5-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal5-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const recordOf = (extra: Record<string, unknown>) => ({ ...baseDeclaration, mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal5-marker", architecture_marker: "seal5-marker", consumers: ["src/server.ts"], ...extra });
    const manifestOf = (recs: Record<string, unknown>[]) => JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: recs });
    const a = recordOf({ id: "seal-cura5-3", base_blob: blobV1, head_blob: blobV1 });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([a]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "record A sem selo"], { cwd: root });
    const aBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("git", ["commit", "--allow-empty", "-m", "seal"], { cwd: root });
    const sealCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([{ ...a, commit: sealCommit, parent_commit: aBase }]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "selo honesto"], { cwd: root });
    const sealBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    // diff de motor (v1->v2) + deselagem de A + B cobrindo o diff
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 2; } }\n");
    const blobV2 = execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const b = recordOf({ id: "seal-cura5-3-novo", base_blob: blobV1, head_blob: blobV2 });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([a, b]));
    const run = runBoundaryCli({ cwd: root, argv: ["--base", sealBase, "--head", "WORKTREE"] });
    const receipt = JSON.parse(run.output);
    expect(run.exitCode).toBe(1);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_COMMIT_MISSING:seal-cura5-3"))).toBe(true);
  });


  // Cura-6 (P2-A adversarial cura-5): ledger ENCOLHIDO — record selado em
  // índice órfão dereferenciava after.id sem guard: TypeError engolido pelo
  // catch externo virava BASE_LEDGER_UNREADABLE FALSO. O reason próprio tem
  // que dizer o que falhou (record removido) sem mentir sobre a base.
  it("ledger encolhido reprova RECORD_REMOVED sem acusar base ilegivel", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal6-a-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal6-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal6-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 2; } }\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c1 motor v2"], { cwd: root });
    const c1 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const c0 = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: root, encoding: "utf8" }).trim();
    const recordOf = (extra: Record<string, unknown>) => ({ ...baseDeclaration, mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal6-marker", architecture_marker: "seal6-marker", consumers: ["src/server.ts"], ...extra });
    const manifestOf = (recs: Record<string, unknown>[]) => JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: recs });
    // base com DOIS records; head encolhe para UM novo cobrindo o diff — o
    // índice 1 fica órfão (after undefined) com before selado
    const blobV2 = execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const x = recordOf({ id: "seal6-x", base_blob: blobV2, head_blob: blobV2 });
    const y = recordOf({ id: "seal6-y", base_blob: blobV2, head_blob: blobV2, commit: c1, parent_commit: c0 });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([x, y]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "ledger base"], { cwd: root });
    const sealBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 3; } }\n");
    const blobV3 = execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const z = recordOf({ id: "seal6-z", base_blob: blobV2, head_blob: blobV3 });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([z]));
    const run = runBoundaryCli({ cwd: root, argv: ["--base", sealBase, "--head", "WORKTREE"] });
    const receipt = JSON.parse(run.output);
    expect(run.exitCode).toBe(1);
    expect(receipt.reasons.some((reason: string) => reason.includes("LEDGER_PREFIX_RECORD_REMOVED:seal6-y"))).toBe(true);
    expect(receipt.reasons.some((reason: string) => reason.includes("BASE_LEDGER_UNREADABLE"))).toBe(false);
  });

  // Cura-6 (P2-B adversarial cura-5): record INTERMEDIÁRIO NOVO de chain
  // nascendo com selo de blob mentiroso — o B2 conferia só o declaration
  // (tail); a conferência de nascimento cobre TODOS os records da chain.
  it("chain com intermediario selado de blob divergente reprova no nascimento", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal6-b-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal6-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal6-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "v1"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 2; } }\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "v2"], { cwd: root });
    const blobV2 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const v2 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const v1 = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 3; } }\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "v3"], { cwd: root });
    const blobV3 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const v3 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const recordOf = (extra: Record<string, unknown>) => ({ ...baseDeclaration, mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal6-marker", architecture_marker: "seal6-marker", consumers: ["src/server.ts"], ...extra });
    // A intermediario: head_blob v2, mas commit selado v3 (blob divergente)
    const a = recordOf({ id: "seal6-a", base_blob: blobV1, head_blob: blobV2, commit: v3, parent_commit: v2 });
    const b = recordOf({ id: "seal6-b", base_blob: blobV2, head_blob: blobV3 });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: [a, b] }));
    const run = runBoundaryCli({ cwd: root, argv: ["--base", v1, "--head", "WORKTREE"] });
    const receipt = JSON.parse(run.output);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_BLOB_MISMATCH:seal6-a"))).toBe(true);
  });

  // Cura-6 (P3 Provide Context): commit que EXISTE mas não contém o target
  // era rotulado COMMIT_SEAL_COMMIT_NOT_FOUND — o consumidor não distingue
  // selo-fantasma de commit-real-sem-arquivo. Enum próprio TARGET_MISSING.
  it("commit existente sem o target reprova TARGET_MISSING distinto de NOT_FOUND", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal6-c-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal6-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal6-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    // commit órfão de tree VAZIA: existe, mas nao contem src/flow-engine.ts
    const emptyTree = execFileSync("git", ["hash-object", "-t", "tree", "/dev/null"], { cwd: root, encoding: "utf8" }).trim();
    const orphan = execFileSync("git", ["commit-tree", emptyTree, "-m", "orphan"], { cwd: root, encoding: "utf8" }).trim();
    const c0 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const recordOf = (extra: Record<string, unknown>) => ({ ...baseDeclaration, mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal6-marker", architecture_marker: "seal6-marker", consumers: ["src/server.ts"], ...extra });
    const base = recordOf({ id: "seal6-c", base_blob: blobV1, head_blob: blobV1 });
    const manifestOf = (recs: Record<string, unknown>[]) => JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: recs });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([base]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "base"], { cwd: root });
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([{ ...base, commit: orphan, parent_commit: c0 }]));
    const run = runBoundaryCli({ cwd: root, argv: ["--base", baseSha, "--head", "WORKTREE"] });
    const receipt = JSON.parse(run.output);
    expect(run.exitCode).toBe(1);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_TARGET_MISSING:seal6-c"))).toBe(true);
  });

  // Cura-6 (P2-C vacina de regressão — passa no baseline por desenho): o
  // canonicalJson (cura-5) garante que RE-SERIALIZAÇÃO com outra ordem de
  // chaves não fabrica COMMIT_SEAL_RECORD_CHANGED/LEDGER_HISTORY_MUTATED.
  // Sem o canônico (stringify cru) este teste reprovaria — é a rede que
  // faltava para a promessa central da cura-5.
  it("re-serializacao com ordem de chaves trocada nao fabrica mudanca de record", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal6-d-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal6-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal6-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const c0 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const recordOf = (extra: Record<string, unknown>) => ({ ...baseDeclaration, mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal6-marker", architecture_marker: "seal6-marker", consumers: ["src/server.ts"], ...extra });
    const manifestOf = (recs: Record<string, unknown>[]) => JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: recs });
    const base = recordOf({ id: "seal6-d", base_blob: blobV1, head_blob: blobV1 });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([base]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "record base SEM selo"], { cwd: root });
    const sealBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("git", ["commit", "--allow-empty", "-m", "seal"], { cwd: root });
    const seal = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    // MESMO record, MESMOS valores, ORDEM de chaves trocada (commit/parent primeiro)
    const reordered: Record<string, unknown> = { commit: seal, parent_commit: sealBase };
    for (const [key, value] of Object.entries(base)) reordered[key] = value;
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: [reordered] }));
    const run = runBoundaryCli({ cwd: root, argv: ["--base", sealBase, "--head", "WORKTREE"] });
    const receipt = JSON.parse(run.output);
    expect(run.exitCode).toBe(0);
    expect(receipt.reasons).toEqual([]);
    expect(receipt.ledger_commit_seal?.sealed_records).toContain("seal6-d");
  });



  // Cura-6 (P2-C vacina DISCRIMINANTE — derruba com stringify cru): ordem de
  // chaves NÃO-SELO trocada no prefixo do ledger (head_blob/base_blob antes de
  // id). Com canonicalJson: sem LEDGER_HISTORY_MUTATED (reordenação não é
  // mutação); com JSON.stringify cru o preservedPrefix fabrica MUTATED.
  it("prefixo re-serializado com ordem de chaves nao-selo trocada nao e mutacao", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal6-e-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n")
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal6-marker\n")
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal6-marker\n")
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const recordOf = (extra: Record<string, unknown>) => ({ ...baseDeclaration, mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal6-marker", architecture_marker: "seal6-marker", consumers: ["src/server.ts"], ...extra });
    const manifestOf = (recs: Record<string, unknown>[]) => JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: recs });
    // R selado honesto commitado na base (ordem natural: id...base_blob, head_blob, commit, parent)
    const r = recordOf({ id: "seal6-r", base_blob: blobV1, head_blob: blobV1, commit: "PLACEHOLDER", parent_commit: "PLACEHOLDER" });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([{ ...r, commit: undefined, parent_commit: undefined }]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "record base"], { cwd: root });
    const rBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("git", ["commit", "--allow-empty", "-m", "seal"], { cwd: root });
    const seal = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([{ ...r, commit: seal, parent_commit: rBase }]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "selo honesto"], { cwd: root });
    const sealBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    // worktree: motor v2 + R com ordem NAO-SELO trocada (head_blob/base_blob primeiro) + declaration novo
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 2; } }\n")
    const blobV2 = execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const reordered: Record<string, unknown> = { head_blob: blobV1, base_blob: blobV1, commit: seal, parent_commit: rBase };
    for (const [key, value] of Object.entries({ ...r, commit: seal, parent_commit: rBase })) reordered[key] = value;
    const z = recordOf({ id: "seal6-z", base_blob: blobV1, head_blob: blobV2 });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([reordered, z]));
    const run = runBoundaryCli({ cwd: root, argv: ["--base", sealBase, "--head", "WORKTREE"] });
    const receipt = JSON.parse(run.output);
    expect(receipt.reasons.some((reason: string) => reason.includes("LEDGER_HISTORY_MUTATED"))).toBe(false);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_RECORD_CHANGED:seal6-r"))).toBe(false);
  });



  // Cura-6 emenda (P1 adversarial cura-6, CONFIRMADO por probe real: janela
  // 4bf8aab..HEAD fabricava 5 COMMIT_SEAL_PARENT_MISSING falsos): elo NOVO na
  // janela cujo selo ja esta COMMITADO em commit intermediario (selagem
  // legitima do seu tempo, ex.: parent pre-cura-3) — birth check nao julga o
  // passado pela lei nova; nascimento e o selo que ainda NAO esta commitado.
  it("elo com selo commitado em commit intermediario nao e re-julgado no nascimento", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-engine-seal6-f-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 1; } }\n");
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\nseal6-marker\n");
    await writeFile(path.join(root, "docs", "architecture", "FLOW_ENGINE_EVOLUTION.md"), "# Architecture\nseal6-marker\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c0 v1"], { cwd: root });
    const blobV1 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const recordOf = (extra: Record<string, unknown>) => ({ ...baseDeclaration, mode: "EXCEPTION", destination_module: undefined, changelog_marker: "seal6-marker", architecture_marker: "seal6-marker", consumers: ["src/server.ts"], ...extra });
    const manifestOf = (recs: Record<string, unknown>[]) => JSON.stringify({ contract: "dex.flow-engine.evolution-ledger.v1", target: "src/flow-engine.ts", owner: "$refactoring-fowler-rich", records: recs });
    // base: motor v1 + manifest [R0(v1->v1)] sem selo
    const r0 = recordOf({ id: "seal6-r0", base_blob: blobV1, head_blob: blobV1 });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([r0]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "base com R0"], { cwd: root });
    const diffBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    // commit intermediario: motor v2 + R1(v1->v2) selado SEM parent (pre-cura-3)
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 2; } }\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "c1 v2"], { cwd: root });
    const blobV2 = execFileSync("git", ["rev-parse", "HEAD:src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const r1 = recordOf({ id: "seal6-r1", base_blob: blobV1, head_blob: blobV2, commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([r0, r1]));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "selo historico de R1 sem parent"], { cwd: root });
    // worktree: motor v3 + R2(v2->v3) sem selo -> chain [R0, R1, R2]
    await writeFile(path.join(root, "src", "flow-engine.ts"), "export class FlowEngine { run() { return 3; } }\n");
    const blobV3 = execFileSync("git", ["hash-object", "src/flow-engine.ts"], { cwd: root, encoding: "utf8" }).trim();
    const r2 = recordOf({ id: "seal6-r2", base_blob: blobV2, head_blob: blobV3 });
    await writeFile(path.join(root, "docs", "architecture", "flow-engine-evolution.json"), manifestOf([r0, r1, r2]));
    const run = runBoundaryCli({ cwd: root, argv: ["--base", diffBase, "--head", "WORKTREE"] });
    const receipt = JSON.parse(run.output);
    expect(receipt.reasons.some((reason: string) => reason.includes("COMMIT_SEAL_PARENT_MISSING:seal6-r1"))).toBe(false);
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
