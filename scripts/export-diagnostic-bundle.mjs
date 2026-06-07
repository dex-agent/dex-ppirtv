import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { exportRedactedDiagnosticBundle } from "../dist/diagnostic-bundle.js";
import { PpirtvStore } from "../dist/store.js";

const args = parseArgs(process.argv.slice(2));

if (!args.flowId) {
  printHelp();
  process.exitCode = 1;
} else {
  const ppirtvHome = path.resolve(args.ppirtvHome ?? process.env.PPIRTV_HOME ?? path.join(process.cwd(), ".ppirtv"));
  const store = new PpirtvStore(ppirtvHome);
  const bundle = await exportRedactedDiagnosticBundle(store, {
    flow_id: args.flowId,
    include_evidence_content: args.includeEvidenceContent === true,
    ledger_limit: args.ledgerLimit
  });
  const json = `${JSON.stringify(bundle, null, 2)}\n`;

  if (args.out) {
    const outPath = path.resolve(args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, json, "utf8");
    console.log(JSON.stringify({ ok: true, out: outPath, flow_id: args.flowId }, null, 2));
  } else {
    console.log(json);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--flow-id") parsed.flowId = argv[++i];
    else if (arg === "--ppirtv-home") parsed.ppirtvHome = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--ledger-limit") parsed.ledgerLimit = Number.parseInt(argv[++i], 10);
    else if (arg === "--include-evidence-content") parsed.includeEvidenceContent = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  npm run build
  npm run diagnostic:bundle -- --flow-id <flow_id> [--ppirtv-home <path>] [--out <file>]

Options:
  --include-evidence-content  Include redacted evidence content.
  --ledger-limit <n>          Limit ledger events in the bundle.

The exporter reads PPIRTV runtime state only. It never reads .env files.`);
}
