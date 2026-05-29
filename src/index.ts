#!/usr/bin/env node
import { runStdioServer } from "./server.js";

runStdioServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dex-PPIRTV MCP server failed: ${message}`);
  process.exit(1);
});
