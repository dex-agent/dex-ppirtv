#!/usr/bin/env node
// PPIRTV-CAPACITY-COMMIT-GATE
// Blocks a commit that changes capability-bearing files without a fresh
// re-evaluation section in CAPACITY.md. Read-only: does not edit files.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd());
const staged = args.includes("--staged");
const asJson = args.includes("--json");
const capabilityPrefixes = [
  "src/",
  "tests/",
  "scripts/",
  "package.json",
  "package-lock.json",
  "tsconfig.json"
];
const allowedStates = new Set(["comprovada", "parcial", "não comprovada", "nao comprovada"]);

function git(names) {
  return execFileSync("git", ["-C", root, ...names], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

function changedPaths() {
  const raw = staged
    ? git(["diff", "--cached", "--name-only"])
    : git(["status", "--porcelain", "--untracked-files=all"]);
  if (staged) return raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return raw
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .flatMap((line) => {
      const renamed = line.split(" -> ");
      return renamed.length === 2 ? [renamed[1]] : [line];
    });
}

function isCapabilityPath(file) {
  const normalized = file.replace(/\\/g, "/");
  return capabilityPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
}

function fail(reasons, details) {
  const result = {
    schema: "dex.capacity.gate.v1",
    status: "FAIL",
    root,
    mode: staged ? "staged" : "worktree",
    reasons,
    capability_files: details.capability_files,
    capacity_updated: details.capacity_updated,
    cap_ids: details.cap_ids,
    next_required_action: {
      action: "run npm run check:capacity -- --staged, update CAPACITY.md with a live re-evaluation section, and stage it",
      when: "before any commit that changes capability-bearing files",
      owner: "$oraculo-refatoracao"
    }
  };
  if (asJson) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else process.stderr.write("CAPACITY GATE FAIL: " + reasons.join(", ") + "\n");
  process.exit(1);
}

if (!existsSync(path.join(root, "CAPACITY.md"))) {
  fail(["CAPACITY_MD_MISSING"], { capability_files: [], capacity_updated: false, cap_ids: [] });
}
const capacity = readFileSync(path.join(root, "CAPACITY.md"), "utf8");
const changed = changedPaths();
const capabilityFiles = changed.filter(isCapabilityPath);
const capacityUpdated = changed.includes("CAPACITY.md");
const capIds = [...capacity.matchAll(/^\|\s*(CAP-\d+)\s*\|/gm)].map((match) => match[1]);
const uniqueIds = new Set(capIds);
const states = [...capacity.matchAll(/^\|\s*CAP-\d+\s*\|[^|]*\|\s*\*{0,2}([^|*]+?)\*{0,2}\s*\|/gm)].map((match) => match[1].trim());
const invalidStates = states.filter((state) => !allowedStates.has(state));
const reasons = [];
if (!capacity.includes("# CAPACITY")) reasons.push("CAPACITY_HEADER_MISSING");
if (capIds.length < 32) reasons.push("CAPACITY_MATRIX_TOO_SMALL");
if (uniqueIds.size !== capIds.length) reasons.push("CAPACITY_IDS_NOT_UNIQUE");
if (invalidStates.length > 0) reasons.push("CAPACITY_STATE_INVALID");
if ((staged || capabilityFiles.length > 0) && !capacityUpdated) reasons.push("CAPACITY_REEVALUATION_REQUIRED");
if (capacityUpdated && !/^##\s+Reavaliação/m.test(capacity)) reasons.push("CAPACITY_REEVALUATION_SECTION_REQUIRED");
if (reasons.length > 0) {
  fail(reasons, { capability_files: capabilityFiles, capacity_updated: capacityUpdated, cap_ids: capIds });
}

const result = {
  schema: "dex.capacity.gate.v1",
  status: "PASS",
  root,
  mode: staged ? "staged" : "worktree",
  reasons: [],
  capability_files: capabilityFiles,
  capacity_updated: capacityUpdated,
  cap_ids: capIds,
  summary: {
    capabilities: capIds.length,
    states: {
      comprovada: states.filter((state) => state === "comprovada").length,
      parcial: states.filter((state) => state === "parcial").length,
      nao_comprovada: states.filter((state) => state.startsWith("não") || state.startsWith("nao")).length
    }
  }
};
if (asJson) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
else process.stdout.write("CAPACITY GATE PASS: " + capIds.length + " capabilities; " + capabilityFiles.length + " capability file(s) changed\n");
