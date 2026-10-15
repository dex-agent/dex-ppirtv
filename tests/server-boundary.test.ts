import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(repoRoot, "dist", "index.js");

// A fronteira real: o SDK valida input com zod ANTES do handler e devolve a
// message crua. Este teste pinta RED se o override de envelope sumir (upgrade
// do SDK, refatoracao) ou se o payload deixar de ensinar campo/tipo/exemplo/rota.
describe("MCP boundary teaches input shape (PPIRTV_INPUT_INVALID)", () => {
  let client: Client;
  let tempWorkspace: string;

  beforeAll(async () => {
    if (!existsSync(serverEntry)) {
      throw new Error(`dist/index.js ausente em ${serverEntry} — rode npm run build antes do vitest`);
    }
    tempWorkspace = mkdtempSync(path.join(tmpdir(), "ppirtv-boundary-ws-"));
    client = new Client({ name: "boundary-input-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      cwd: tempWorkspace,
      env: {
        ...getDefaultEnvironment(),
        PPIRTV_HOME: path.join(tempWorkspace, ".ppirtv"),
        PPIRTV_WORKSPACE: tempWorkspace
      }
    }));
  }, 60_000);

  afterAll(async () => {
    await client.close();
    rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it("devolve envelope com campo, tipo recebido, tipo esperado e rota quando o input quebra o schema", async () => {
    const response = await client.callTool({ name: "ppirtv_trace", arguments: { flow_id: 12345 } }) as {
      isError?: boolean;
      content?: Array<{ type: string; text?: string }>;
    };

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text ?? "";
    expect(text).toContain("PPIRTV_INPUT_INVALID");
    const marker = text.indexOf("PPIRTV_INPUT_INVALID: ");
    const payload = JSON.parse(text.slice(marker + "PPIRTV_INPUT_INVALID: ".length)) as {
      code: string;
      tool: string;
      input_issues: Array<{ field: string; received_type: string; expected_type: string; example: unknown }>;
      next_required_action: { type: string; tool: string };
    };
    expect(payload.code).toBe("PPIRTV_INPUT_INVALID");
    expect(payload.tool).toBe("ppirtv_trace");
    expect(payload.input_issues.length).toBeGreaterThan(0);
    const issue = payload.input_issues[0];
    expect(issue.field).toBe("flow_id");
    expect(issue.received_type.toLowerCase()).toContain("number");
    expect(issue.expected_type.toLowerCase()).toContain("string");
    expect(String(issue.example)).toContain("string");
    expect(payload.next_required_action.type).toBe("fix_input_fields");
    expect(payload.next_required_action.tool).toBe("ppirtv_trace");
  }, 60_000);

  it("nao intercepta input valido: diagnostico de trace segue o caminho normal do handler", async () => {
    const response = await client.callTool({
      name: "ppirtv_trace",
      arguments: { flow_id: "flow_inexistente_boundary_probe" }
    }) as { content?: Array<{ type: string; text?: string }> };
    const text = JSON.stringify(response.content ?? []);
    expect(text).not.toContain("PPIRTV_INPUT_INVALID");
  }, 60_000);
});
