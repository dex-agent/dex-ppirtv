import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
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

function capacityDoc(reevaluation: boolean): string {
  const rows: string[] = [];
  for (let index = 1; index <= 32; index += 1) {
    rows.push("| CAP-" + String(index).padStart(2, "0") + " | capability " + index + " | **comprovada** | test |");
  }
  return [
    "# CAPACITY — fixture",
    "",
    "## Matriz de capacidades",
    "",
    "| ID | Capacidade | Estado | Oráculo que decidiu |",
    "|---|---|---|---|",
    ...rows,
    ...(reevaluation ? ["", "## Reavaliação 2026-10-18", "", "Reavaliado para o teste do gate."] : []),
    ""
  ].join("\n");
}

afterEach(async () => {
  if (temp) {
    await rm(temp, { recursive: true, force: true });
    temp = "";
  }
});

describe("capacity commit gate", () => {
  it("blocks capability changes without CAPACITY re-evaluation and passes after staging it", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "capacity-gate-"));
    await mkdir(path.join(temp, "src"), { recursive: true });
    await writeFile(path.join(temp, "src", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(temp, "CAPACITY.md"), capacityDoc(false), "utf8");
    git(temp, ["init"]);
    git(temp, ["config", "user.email", "fixture@example.com"]);
    git(temp, ["config", "user.name", "Fixture"]);
    git(temp, ["add", "-A"]);
    git(temp, ["commit", "-m", "base"]);

    await writeFile(path.join(temp, "src", "a.ts"), "export const a = 2;\n", "utf8");
    const blocked = runGate(temp);
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain("CAPACITY_REEVALUATION_REQUIRED");

    await writeFile(path.join(temp, "CAPACITY.md"), capacityDoc(true), "utf8");
    const passed = runGate(temp);
    expect(passed.status).toBe(0);
    expect(passed.stdout).toContain('"status": "PASS"');

    git(temp, ["add", "src/a.ts"]);
    const stagedBlocked = runGate(temp, true);
    expect(stagedBlocked.status).toBe(1);
    expect(stagedBlocked.stdout).toContain("CAPACITY_REEVALUATION_REQUIRED");

    git(temp, ["add", "CAPACITY.md"]);
    const stagedPassed = runGate(temp, true);
    expect(stagedPassed.status).toBe(0);
  });
});
