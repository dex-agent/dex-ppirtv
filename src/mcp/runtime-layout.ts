import { existsSync } from "node:fs";
import {
  PPIRTV_RUNTIME_DIRS,
  type PpirtvRuntimePaths
} from "../config.js";
import type { RuntimeLayoutStatus } from "../store.js";

/** Inspect the runtime layout without creating directories or the ledger. */
export function inspectRuntimeLayoutReadOnly(
  runtimePaths: PpirtvRuntimePaths
): RuntimeLayoutStatus {
  const missingDirectories = PPIRTV_RUNTIME_DIRS.filter(
    (directory) => !existsSync(runtimePaths.dirs[directory])
  );
  const ledgerExists = existsSync(runtimePaths.ledgerPath);

  return {
    project_root: runtimePaths.projectRoot,
    ppirtv_home: runtimePaths.ppirtvHome,
    ledger_path: runtimePaths.ledgerPath,
    ledger_exists: ledgerExists,
    required_directories: [...PPIRTV_RUNTIME_DIRS],
    missing_directories: missingDirectories,
    directories: runtimePaths.dirs,
    status: missingDirectories.length === 0 && ledgerExists ? "ready" : "missing"
  };
}
