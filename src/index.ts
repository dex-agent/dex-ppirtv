#!/usr/bin/env node
import { runStdioServer } from "./server.js";

const HELP_FLAGS = new Set(["--help", "-h", "--describe", "--schema", "--usage", "--list"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    const { runToolCli } = await import("./tool-cli.js");
    process.exitCode = await runToolCli(args);
    return;
  }
  await runStdioServer();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("dex-PPIRTV MCP server failed: " + message);
  process.exit(1);
});
