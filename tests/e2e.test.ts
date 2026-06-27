import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("audits inherited Codex PPIRTV configs with divergent PPIRTV_HOME without relying on list_tools", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-config-audit-"));
    const parentWorkspace = path.join(tempRoot, "skills");
    const childWorkspace = path.join(parentWorkspace, "technical-book-to-skill-router");
    const parentConfig = path.join(parentWorkspace, ".codex", "config.toml");
    const childConfig = path.join(childWorkspace, ".codex", "config.toml");
    await mkdir(path.dirname(parentConfig), { recursive: true });
    await mkdir(path.dirname(childConfig), { recursive: true });
    await writeFile(
      parentConfig,
      codexConfigToml({
        name: "dex-ppirtv",
        enabled: true,
        cwd: parentWorkspace,
        ppirtvHome: path.join(parentWorkspace, ".ppirtv")
      }),
      "utf8"
    );
    await writeFile(
      childConfig,
      codexConfigToml({
        name: "dex_ppirtv",
        cwd: childWorkspace,
        ppirtvHome: path.join(childWorkspace, ".ppirtv")
      }),
      "utf8"
    );

    await expect(
      execFileAsync(
        process.execPath,
        [
          "scripts/smoke-mcp-tools.mjs",
          "--config-toml",
          childConfig,
          "--server",
          "dex_ppirtv",
          "--audit-config-toml",
          parentConfig,
          "--audit-only",
          "--fail-on-config-conflict"
        ],
        { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
      )
    ).rejects.toMatchObject({ stdout: expect.stringContaining("ppirtv_config_conflict") });

    await writeFile(
      parentConfig,
      codexConfigToml({
        name: "dex-ppirtv",
        enabled: false,
        cwd: parentWorkspace,
        ppirtvHome: path.join(parentWorkspace, ".ppirtv")
      }),
      "utf8"
    );
    const audited = await execFileAsync(
      process.execPath,
      [
        "scripts/smoke-mcp-tools.mjs",
        "--config-toml",
        childConfig,
        "--server",
        "dex_ppirtv",
        "--audit-config-toml",
        parentConfig,
        "--audit-only",
        "--fail-on-config-conflict"
      ],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
    );
    const result = JSON.parse(audited.stdout) as {
      ok: boolean;
      config_audit: {
        conflicts: unknown[];
        warnings: Array<{ code: string; server: string }>;
        interpretation: string;
      };
    };

    expect(result.ok).toBe(true);
    expect(result.config_audit.conflicts).toEqual([]);
    expect(result.config_audit.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "disabled_ppirtv_config_visible", server: "dex-ppirtv" })])
    );
    expect(result.config_audit.interpretation).toContain("stale-client risk");
  });
});

function codexConfigToml(input: { name: string; enabled?: boolean; cwd: string; ppirtvHome: string }): string {
  return [
    `[mcp_servers.${input.name}]`,
    ...(input.enabled === undefined ? [] : [`enabled = ${input.enabled ? "true" : "false"}`]),
    `command = "${escapeTomlPath(process.execPath)}"`,
    `args = ["${escapeTomlPath(path.join(process.cwd(), "dist", "index.js"))}"]`,
    `cwd = "${escapeTomlPath(input.cwd)}"`,
    "",
    `[mcp_servers.${input.name}.env]`,
    `PPIRTV_HOME = "${escapeTomlPath(input.ppirtvHome)}"`,
    ""
  ].join("\n");
}

function escapeTomlPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
