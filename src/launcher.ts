#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLauncherWorkspace } from "./config.js";
import { applyLauncherWorkspaceEnvironment } from "./launcher-environment.js";

async function main(): Promise<void> {
  const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configuredWorkspace = process.env.PPIRTV_WORKSPACE?.trim()
    ? resolveLauncherWorkspace({ argv: [], cwd: process.cwd(), env: process.env, installRoot }).workspace
    : undefined;
  const resolution = resolveLauncherWorkspace({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    installRoot
  });

  applyLauncherWorkspaceEnvironment(resolution, process.env, configuredWorkspace);
  process.chdir(resolution.workspace);

  const { runStdioServer } = await import("./server.js");
  await runStdioServer();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dex-PPIRTV launcher failed: ${message}`);
  process.exit(1);
});
