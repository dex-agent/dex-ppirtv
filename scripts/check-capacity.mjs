#!/usr/bin/env node
// PPIRTV-CAPACITY-COMMIT-GATE
// Read CAPACITY.receipt.json as the canonical machine contract; CAPACITY.md is
// the human view. Blocks a commit without a fresh re-evaluation staged.
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
  "tsconfig.json",
  "CAPACITY.md",
  "CAPACITY.receipt.json"
];
const allowedStates = new Set(["comprovada", "parcial", "não comprovada", "nao comprovada"]);

function git(names) {
  return execFileSync("git", ["-C", root, ...names], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
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

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateReceipt(receipt) {
  const reasons = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return ["CAPACITY_RECEIPT_NOT_OBJECT"];
  }
  if (receipt.schema !== "dex.capacity.snapshot.v1") reasons.push("CAPACITY_RECEIPT_SCHEMA_INVALID");
  for (const field of ["objeto", "fotografia_id", "head", "generated_at", "ambiente"]) {
    if (!nonEmpty(receipt[field])) reasons.push("CAPACITY_RECEIPT_FIELD_REQUIRED:" + field);
  }
  if (!Number.isFinite(Date.parse(receipt.generated_at))) reasons.push("CAPACITY_RECEIPT_GENERATED_AT_INVALID");
  for (const field of ["escopo", "fora_de_escopo", "fontes_vivas", "limits"]) {
    if (!Array.isArray(receipt[field])) reasons.push("CAPACITY_RECEIPT_FIELD_REQUIRED:" + field);
  }
  if (!receipt.suite || !Number.isInteger(receipt.suite.passed) || receipt.suite.passed < 0
    || !Number.isInteger(receipt.suite.skipped) || receipt.suite.skipped < 0) {
    reasons.push("CAPACITY_RECEIPT_SUITE_INVALID");
  }
  if (!Number.isInteger(receipt.tools_count) || receipt.tools_count < 1) reasons.push("CAPACITY_RECEIPT_TOOLS_COUNT_INVALID");
  if (!Array.isArray(receipt.capabilities) || receipt.capabilities.length === 0) {
    reasons.push("CAPACITY_RECEIPT_CAPABILITIES_REQUIRED");
    return reasons;
  }
  const ids = new Set();
  for (const capability of receipt.capabilities) {
    if (!capability || typeof capability !== "object") {
      reasons.push("CAPACITY_RECEIPT_CAPABILITY_INVALID");
      continue;
    }
    if (!nonEmpty(capability.id)) reasons.push("CAPACITY_RECEIPT_CAPABILITY_ID_REQUIRED");
    else if (ids.has(capability.id)) reasons.push("CAPACITY_RECEIPT_CAPABILITY_ID_DUPLICATE:" + capability.id);
    else ids.add(capability.id);
    for (const field of ["capability", "owner", "consumer", "trigger", "behavior", "oracle"]) {
      if (!nonEmpty(capability[field])) reasons.push("CAPACITY_RECEIPT_CAPABILITY_FIELD_REQUIRED:" + capability.id + "." + field);
    }
    if (!Array.isArray(capability.evidence) || capability.evidence.length === 0) {
      reasons.push("CAPACITY_RECEIPT_CAPABILITY_EVIDENCE_REQUIRED:" + capability.id);
    }
    if (!allowedStates.has(capability.state)) reasons.push("CAPACITY_RECEIPT_CAPABILITY_STATE_INVALID:" + capability.id);
    if (!Array.isArray(capability.limits)) reasons.push("CAPACITY_RECEIPT_CAPABILITY_LIMITS_REQUIRED:" + capability.id);
  }
  return reasons;
}

function fail(reasons, details) {
  const result = {
    schema: "dex.capacity.gate.v1",
    status: "FAIL",
    root,
    mode: staged ? "staged" : "worktree",
    reasons,
    capability_files: details.capability_files,
    capacity_md_updated: details.capacity_md_updated,
    receipt_updated: details.receipt_updated,
    capability_count: details.capability_count,
    next_required_action: {
      action: "refresh CAPACITY.receipt.json and CAPACITY.md with a live re-evaluation, stage both, and rerun npm run check:capacity -- --staged",
      when: "before any commit",
      owner: "$oraculo-refatoracao"
    }
  };
  if (asJson) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else process.stderr.write("CAPACITY GATE FAIL: " + reasons.join(", ") + "\n");
  process.exit(1);
}

const capacityPath = path.join(root, "CAPACITY.md");
const receiptPath = path.join(root, "CAPACITY.receipt.json");
const missing = [];
if (!existsSync(capacityPath)) missing.push("CAPACITY.md");
if (!existsSync(receiptPath)) missing.push("CAPACITY.receipt.json");
const changed = changedPaths();
const capabilityFiles = changed.filter(isCapabilityPath);
const capacityMdUpdated = changed.includes("CAPACITY.md");
const receiptUpdated = changed.includes("CAPACITY.receipt.json");
const capacityUpdated = capacityMdUpdated && receiptUpdated;
if (missing.length > 0) {
  fail(["CAPACITY_FILES_MISSING:" + missing.join("+")], {
    capability_files: capabilityFiles, capacity_md_updated: capacityMdUpdated,
    receipt_updated: receiptUpdated, capability_count: 0
  });
}
let receipt;
try {
  receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
} catch (error) {
  fail(["CAPACITY_RECEIPT_INVALID_JSON"], {
    capability_files: capabilityFiles, capacity_md_updated: capacityMdUpdated,
    receipt_updated: receiptUpdated, capability_count: 0
  });
}
const capacity = readFileSync(capacityPath, "utf8");
const reasons = validateReceipt(receipt);
if (!capacity.includes("# CAPACITY")) reasons.push("CAPACITY_HEADER_MISSING");
if (!/^##\s+Reavaliação/m.test(capacity)) reasons.push("CAPACITY_REEVALUATION_SECTION_REQUIRED");
if ((staged || capabilityFiles.length > 0) && !capacityUpdated) {
  reasons.push("CAPACITY_REEVALUATION_REQUIRED");
}
if (reasons.length > 0) {
  fail(reasons, {
    capability_files: capabilityFiles, capacity_md_updated: capacityMdUpdated,
    receipt_updated: receiptUpdated, capability_count: receipt.capabilities?.length ?? 0
  });
}
const result = {
  schema: "dex.capacity.gate.v1",
  status: "PASS",
  root,
  mode: staged ? "staged" : "worktree",
  reasons: [],
  capability_files: capabilityFiles,
  capacity_md_updated: capacityMdUpdated,
  receipt_updated: receiptUpdated,
  capability_count: receipt.capabilities.length,
  summary: {
    suite: receipt.suite,
    tools_count: receipt.tools_count,
    states: {
      comprovada: receipt.capabilities.filter((item) => item.state === "comprovada").length,
      parcial: receipt.capabilities.filter((item) => item.state === "parcial").length,
      nao_comprovada: receipt.capabilities.filter((item) => item.state === "não comprovada" || item.state === "nao comprovada").length
    }
  }
};
if (asJson) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
else process.stdout.write("CAPACITY GATE PASS: " + result.capability_count + " capabilities; " + capabilityFiles.length + " capability file(s) changed\n");
