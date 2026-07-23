import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LauncherWorkspaceResolution } from "./config.js";

export function applyLauncherWorkspaceEnvironment(
  resolution: LauncherWorkspaceResolution,
  env: NodeJS.ProcessEnv,
  configuredWorkspace = env.PPIRTV_WORKSPACE
): void {
  if (configuredWorkspace?.trim() && !samePath(configuredWorkspace, resolution.workspace)) {
    throw new Error(
      `PPIRTV_LAUNCHER_WORKSPACE_CONFLICT: --workspace resolved to '${resolution.workspace}' but PPIRTV_WORKSPACE resolved to '${configuredWorkspace}'`
    );
  }
  env.PPIRTV_HOME = resolution.ppirtvHome;
  env.PPIRTV_WORKSPACE = resolution.workspace;
  env.PPIRTV_LAUNCHER_WORKSPACE = resolution.workspace;
  env.PPIRTV_LAUNCHER_SOURCE = resolution.source;
  env.PPIRTV_PROCESS_GENERATION = randomUUID();
  env.PPIRTV_SESSION_GENERATION = randomUUID();
}

function samePath(left: string, right: string): boolean {
  const leftPath = path.resolve(left).replace(/[\\/]+$/, "");
  const rightPath = path.resolve(right).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? leftPath.toLowerCase() === rightPath.toLowerCase() : leftPath === rightPath;
}
