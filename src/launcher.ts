#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLauncherWorkspace } from "./config.js";

async function main(): Promise<void> {
  const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const resolution = resolveLauncherWorkspace({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    installRoot
  });

  process.chdir(resolution.workspace);
  process.env.PPIRTV_HOME = resolution.ppirtvHome;
  process.env.PPIRTV_LAUNCHER_WORKSPACE = resolution.workspace;
  process.env.PPIRTV_LAUNCHER_SOURCE = resolution.source;

  const { runStdioServer } = await import("./server.js");
  await runStdioServer();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dex-PPIRTV launcher failed: ${message}`);
  process.exit(1);
});
