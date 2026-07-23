#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getMemoryWriterSelectorCutoverStatus,
  confirmMemoryWriterSelectorCutover,
  prepareMemoryWriterSelectorCutover,
  resumeMemoryWriterSelectorCutover,
  rollbackMemoryWriterSelectorCutover
} from "./memory/memory-writer-selector-cutover.js";
import type { MemoryWriterSelectorAfterProfile, MemoryWriterSelectorBeforeProfile } from "./memory/memory-writer-selector-cutover.js";

type CliIo = { stdout: (line: string) => void };

export async function runMemoryWriterSelectorCutoverCli(argv: string[], io: CliIo = { stdout: console.log }): Promise<number> {
  const command = argv[0];
  if (!command || !["prepare", "resume", "rollback", "status", "confirm"].includes(command)) {
    throw new Error("PPIRTV_SELECTOR_CUTOVER_COMMAND_REQUIRED: prepare|resume|rollback|status|confirm");
  }
  const options = parseOptions(argv.slice(1));
  if (options.has("restart-receipt")) throw new Error("PPIRTV_SELECTOR_CUTOVER_MANUAL_RECEIPT_NOT_ACCEPTED");
  const controlRoot = required(options, "control-root");
  const configPath = required(options, "config");
  const journalPath = required(options, "journal");
  const paths = { controlRoot, configPath, journalPath };

  let result: unknown;
  if (command === "prepare") {
    result = await prepareMemoryWriterSelectorCutover({
      ...paths,
      selector_before: beforeProfile(options),
      selector_after: afterProfile(options),
      canonical_root: required(options, "canonical-root"),
      entrypoint: required(options, "entrypoint"),
      activation_action: optionalAction(options, "activation-action"),
      rollback_action: optionalAction(options, "rollback-action")
    });
  } else if (command === "status") {
    result = await getMemoryWriterSelectorCutoverStatus(paths);
  } else if (command === "confirm") {
    result = await confirmThroughCausalProbe({ controlRoot, configPath, journalPath, options });
  } else {
    result = command === "resume"
      ? await resumeMemoryWriterSelectorCutover(paths)
      : await rollbackMemoryWriterSelectorCutover(paths);
  }

  io.stdout(JSON.stringify(result));
  return 0;
}

async function confirmThroughCausalProbe(input: {
  controlRoot: string;
  configPath: string;
  journalPath: string;
  options: Map<string, string>;
}): Promise<unknown> {
  const reason = required(input.options, "reason");
  if (reason !== "activate" && reason !== "rollback") throw new Error("PPIRTV_SELECTOR_CUTOVER_ARG_INVALID: --reason");
  const action = required(input.options, "action");
  if (action !== "restart" && action !== "reconnect") throw new Error("PPIRTV_SELECTOR_CUTOVER_ARG_INVALID: --action");
  const server = input.options.get("server")?.trim() || "dex_ppirtv";
  if (server !== "dex_ppirtv") throw new Error("PPIRTV_SELECTOR_CUTOVER_SERVER_MISMATCH");
  return confirmMemoryWriterSelectorCutover({
    controlRoot: input.controlRoot,
    configPath: input.configPath,
    journalPath: input.journalPath,
    reason,
    action
  });
}

function parseOptions(argv: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`PPIRTV_SELECTOR_CUTOVER_ARG_INVALID: ${name ?? "<missing>"}`);
    }
    options.set(name.slice(2), value);
  }
  return options;
}

function required(options: Map<string, string>, name: string): string {
  const value = options.get(name)?.trim();
  if (!value) throw new Error(`PPIRTV_SELECTOR_CUTOVER_ARG_REQUIRED: --${name}`);
  return value;
}

function optionalAction(options: Map<string, string>, name: string): "restart" | "reconnect" | undefined {
  const value = options.get(name)?.trim();
  if (!value) return undefined;
  if (value !== "restart" && value !== "reconnect") throw new Error(`PPIRTV_SELECTOR_CUTOVER_ARG_INVALID: --${name}`);
  return value;
}

function beforeProfile(options: Map<string, string>): MemoryWriterSelectorBeforeProfile {
  const value = required(options, "before");
  if (value !== "unconfigured" && value !== "legacy-v1") throw new Error("PPIRTV_SELECTOR_CUTOVER_ARG_INVALID: --before");
  return value;
}

function afterProfile(options: Map<string, string>): MemoryWriterSelectorAfterProfile {
  const value = required(options, "after");
  if (value !== "v2") throw new Error("PPIRTV_SELECTOR_CUTOVER_ARG_INVALID: --after");
  return value;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  runMemoryWriterSelectorCutoverCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  });
}
