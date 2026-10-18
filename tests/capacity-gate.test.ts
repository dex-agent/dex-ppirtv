import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let temp = "";

function git(cwd: string, args: string[]) {
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function runGate(root: string, staged = false) {
  const args = [path.join(process.cwd(), "scripts", "check-capacity.mjs"), "--root", root, "--json"];
  if (staged) args.push("--staged");
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function capacityRows() {
  const rows = [];
  for (let index = 1; index <= 32; index += 1) {
    rows.push("| CAP-" + String(index).padStart(2, "0") + " | capability " + index + " | **comprovada** | test |");
  }
  return rows;
}

function capacityDoc() {
  return [
    "# CAPACITY — fixture",
    "",
    "## Matriz de capacidades",
    "",
    "| ID | Capacidade | Estado | Oráculo que decidiu |",
    "|---|---|---|---|",
    ...capacityRows(),
    "",
    "## Reavaliação 2026-10-18",
    "",
    "Fixture de reavaliação."
  ].join("\n");
}

function receiptDoc() {
  return JSON.stringify({
    schema: "dex.capacity.snapshot.v1",
    objeto: "fixture",
    fotografia_id: "fixture-2026-10-18",
    head: "0".repeat(40),
    generated_at: "2026-10-18T12:00:00.000Z",
    ambiente: "test",
    escopo: ["fixture"],
    fora_de_escopo: [],
    fontes_vivas: ["CAPACITY.md"],
    suite: { passed: 1, skipped: 0, files: 1 },
    tools_count: 1,
    capabilities: capacityRows().map((row, index) => {
      const id = "CAP-" + String(index + 1).padStart(2, "0");
      return {
        id,
        capability: "capability " + (index + 1),
        owner: "fixture",
        consumer: "fixture",
        trigger: "fixture",
        behavior: "fixture",
        oracle: "fixture",
        evidence: ["fixture"],
        state: "comprovada",
        limits: []
      };
    }),
    limits: ["fixture"]
  }, null, 2);
}

afterEach(async () => {
  if (temp) {
    await rm(temp, { recursive: true, force: true });
    temp = "";
  }
});

describe("capacity commit gate", () => {
  it("blocks capability changes without CAPACITY receipt/re-evaluation and passes after staging both", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "capacity-gate-"));
    await mkdir(path.join(temp, "src"), { recursive: true });
    await writeFile(path.join(temp, "src", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(temp, "CAPACITY.md"), capacityDoc(), "utf8");
    await writeFile(path.join(temp, "CAPACITY.receipt.json"), receiptDoc(), "utf8");
    git(temp, ["init"]);
    git(temp, ["config", "user.email", "fixture@example.com"]);
    git(temp, ["config", "user.name", "Fixture"]);
    git(temp, ["add", "-A"]);
    git(temp, ["commit", "-m", "base"]);

    await writeFile(path.join(temp, "src", "a.ts"), "export const a = 2;\n", "utf8");
    const blocked = runGate(temp);
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain("CAPACITY_REEVALUATION_REQUIRED");

    await writeFile(path.join(temp, "CAPACITY.md"), capacityDoc() + "\n<!-- reevaluated -->\n", "utf8");
    const receipt = JSON.parse(receiptDoc());
    receipt.limits.push("reevaluated");
    await writeFile(path.join(temp, "CAPACITY.receipt.json"), JSON.stringify(receipt, null, 2), "utf8");
    const passed = runGate(temp);
    expect(passed.status).toBe(0);
    expect(passed.stdout).toContain('"status": "PASS"');

    git(temp, ["add", "src/a.ts"]);
    const stagedBlocked = runGate(temp, true);
    expect(stagedBlocked.status).toBe(1);
    expect(stagedBlocked.stdout).toContain("CAPACITY_REEVALUATION_REQUIRED");

    git(temp, ["add", "CAPACITY.md", "CAPACITY.receipt.json"]);
    const stagedPassed = runGate(temp, true);
    expect(stagedPassed.status).toBe(0);
  });
});
