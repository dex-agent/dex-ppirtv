import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot?.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  tempRoot = undefined;
});

describe("dex-PPIRTV e2e smoke", () => {
  it("lists MCP tools, runs a flow smoke and exports a redacted diagnostic bundle", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-e2e-"));
    const smoke = await execFileAsync(process.execPath, ["scripts/smoke-mcp-tools.mjs", "--workspace", tempRoot, "--flow-smoke"], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024
    });
    const smokeResult = JSON.parse(smoke.stdout) as {
      ok: boolean;
      flow_smoke?: { archived?: boolean; flow_id?: string };
      missing?: string[];
    };

    expect(smokeResult.ok).toBe(true);
    expect(smokeResult.missing).toEqual([]);
    expect(smokeResult.flow_smoke?.archived).toBe(true);
    expect(smokeResult.flow_smoke?.flow_id).toMatch(/^flow_/);

    const outPath = path.join(tempRoot, "bundle.json");
    const exported = await execFileAsync(
      process.execPath,
      [
        "scripts/export-diagnostic-bundle.mjs",
        "--ppirtv-home",
        path.join(tempRoot, ".ppirtv"),
        "--flow-id",
        smokeResult.flow_smoke!.flow_id!,
        "--out",
        outPath
      ],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
    );
    const exportResult = JSON.parse(exported.stdout) as { ok: boolean; out: string; flow_id: string };
    const bundle = JSON.parse(await readFile(outPath, "utf8")) as Record<string, unknown>;

    expect(exportResult).toMatchObject({ ok: true, flow_id: smokeResult.flow_smoke!.flow_id });
    expect(bundle.source).toMatchObject({
      flow_id: smokeResult.flow_smoke!.flow_id,
      includes_evidence_content: false
    });
    expect(bundle.limitations).toEqual(expect.arrayContaining([expect.stringContaining("redacted snapshot")]));
  });
});
