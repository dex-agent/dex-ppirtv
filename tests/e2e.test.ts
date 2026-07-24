import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { REQUIRED_TOOLS } from "../src/domain.js";

const execFileAsync = promisify(execFile);

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot?.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  tempRoot = undefined;
});

describe("dex-PPIRTV e2e smoke", () => {
  it("fails explicitly when a caller requires V2 but the runtime is unconfigured", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-v2-required-"));
    let failure: { stdout?: string } | undefined;
    try {
      await execFileAsync(
        process.execPath,
        ["scripts/smoke-mcp-tools.mjs", "--workspace", tempRoot, "--require-memory-v2"],
        { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
      );
    } catch (error) {
      failure = error as { stdout?: string };
    }

    expect(failure?.stdout).toBeTruthy();
    const result = JSON.parse(failure!.stdout!) as {
      ok: boolean;
      memory_v2_requirement?: { required?: boolean; ok?: boolean; profile?: string };
    };
    expect(result.ok).toBe(false);
    expect(result.memory_v2_requirement).toEqual({
      required: true,
      ok: false,
      profile: "unconfigured"
    });
  });

  it("rejects a configured V2 bundle whose canonical entrypoint returns only a partial capability receipt", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-v2-configured-"));
    const workspace = path.join(tempRoot, "consumer");
    const canonicalRoot = path.join(tempRoot, "dex-memoria");
    const entrypoint = path.join(canonicalRoot, "bin", "dex-memoria.js");
    const memoryHome = path.join(tempRoot, "memory-home");
    const configPath = path.join(tempRoot, "config.toml");
    await mkdir(path.dirname(entrypoint), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(
      entrypoint,
      [
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', chunk => { input += chunk; });",
        "process.stdin.on('end', () => {",
        "  JSON.parse(input);",
        "  process.stdout.write(JSON.stringify({ contract: 'dex.memory.capability.receipt.v2', capability: 'v2-obsidian', require_obsidian: true, ok: true, errors: [] }));",
        "});"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      configPath,
      codexConfigToml({
        name: "dex_ppirtv",
        cwd: workspace,
        args: [path.join(process.cwd(), "dist", "index.js")],
        env: {
          PPIRTV_HOME: path.join(workspace, ".ppirtv"),
          PPIRTV_WORKSPACE: workspace,
          PPIRTV_MEMORY_WRITER_PROFILE: "v2",
          PPIRTV_DEX_MEMORIA_CANONICAL_ROOT: canonicalRoot,
          PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT: entrypoint,
          DEX_MEMORIA_HOME: memoryHome
        }
      }),
      "utf8"
    );

    let failure: { stdout?: string } | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [
          "scripts/smoke-mcp-tools.mjs",
          "--config-toml",
          configPath,
          "--server",
          "dex_ppirtv",
          "--workspace",
          workspace,
          "--require-memory-v2"
        ],
        { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
      );
    } catch (error) {
      failure = error as { stdout?: string };
    }
    expect(failure?.stdout).toBeTruthy();
    const result = JSON.parse(failure!.stdout!) as {
      ok: boolean;
      memory_v2_requirement?: { required?: boolean; ok?: boolean; profile?: string };
      memory_v2_capability?: { ok?: boolean };
    };

    expect(result.ok).toBe(false);
    expect(result.memory_v2_requirement).toEqual({ required: true, ok: true, profile: "v2" });
    expect(result.memory_v2_capability?.ok).toBe(false);

    await writeFile(
      entrypoint,
      [
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', chunk => { input += chunk; });",
        "process.stdin.on('end', () => {",
        "  JSON.parse(input);",
        "  process.stdout.write(JSON.stringify({ contract: 'dex.memory.capability.receipt.v2', capability: 'v2-obsidian', require_obsidian: true, expected_require_obsidian: true, ok: true, errors: [] }));",
        "});"
      ].join("\n"),
      "utf8"
    );
    const greenSmoke = await execFileAsync(
      process.execPath,
      [
        "scripts/smoke-mcp-tools.mjs",
        "--config-toml",
        configPath,
        "--server",
        "dex_ppirtv",
        "--workspace",
        workspace,
        "--require-memory-v2"
      ],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
    );
    const greenResult = JSON.parse(greenSmoke.stdout) as {
      ok: boolean;
      memory_v2_capability?: { ok?: boolean; contract?: string };
      runtime_probe?: { memory_writer_runtime?: { workspace_root?: string; memory_home?: string; canonical_root?: string; entrypoint?: string } };
    };
    expect(greenResult.ok).toBe(true);
    expect(greenResult.memory_v2_capability).toMatchObject({
      ok: true,
      contract: "dex.memory.capability.receipt.v2"
    });
    expect(greenResult.runtime_probe?.memory_writer_runtime).toMatchObject({
      workspace_root: workspace,
      memory_home: memoryHome,
      canonical_root: canonicalRoot,
      entrypoint
    });
  });

  it("lists MCP tools, runs a flow smoke and exports a redacted diagnostic bundle", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-e2e-"));
    const smoke = await execFileAsync(process.execPath, ["scripts/smoke-mcp-tools.mjs", "--workspace", tempRoot, "--flow-smoke"], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024
    });
    const smokeResult = JSON.parse(smoke.stdout) as {
      ok: boolean;
      flow_smoke?: {
        archived?: boolean;
        flow_id?: string;
        status_runtime?: RuntimeSmokeSummary;
        checkout_runtime?: RuntimeSmokeSummary;
      };
      missing?: string[];
      required?: string[];
      runtime_config_check?: { ok: boolean; ppirtv_home: string };
    };

    expect(smokeResult.ok).toBe(true);
    expect(smokeResult.missing).toEqual([]);
    expect(smokeResult.required).toEqual([...REQUIRED_TOOLS]);
    expect(smokeResult.required).toContain("ppirtv_trace");
    expect(smokeResult.runtime_config_check).toMatchObject({
      ok: true,
      ppirtv_home: path.resolve(tempRoot, ".ppirtv")
    });
    expect(smokeResult.flow_smoke?.archived).toBe(true);
    expect(smokeResult.flow_smoke?.flow_id).toMatch(/^flow_/);
    const canonicalTempRoot = await realpath(tempRoot);
    expect(smokeResult.flow_smoke?.status_runtime).toMatchObject({
      project_root: canonicalTempRoot,
      ppirtv_home: path.join(canonicalTempRoot, ".ppirtv"),
      runtime_layout_status: { status: "ready", missing_directories: [] }
    });
    expect(smokeResult.flow_smoke?.checkout_runtime).toMatchObject({
      project_root: canonicalTempRoot,
      ppirtv_home: path.join(canonicalTempRoot, ".ppirtv"),
      runtime_layout_status: { status: "ready", missing_directories: [] }
    });
    expect(await readdir(path.join(tempRoot, ".ppirtv"))).toEqual(
      expect.arrayContaining(["evidence", "flows", "ledger.ndjson", "logs", "meetings", "memory", "review", "specs", "tasks", "verdicts"])
    );

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

  it("keeps two consumer workspaces isolated while using the same MCP installation", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-multi-workspace-"));
    const workspaceA = path.join(tempRoot, "consumer-a");
    const workspaceB = path.join(tempRoot, "consumer-b");
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });

    const smokeA = JSON.parse(
      (await execFileAsync(process.execPath, ["scripts/smoke-mcp-tools.mjs", "--workspace", workspaceA, "--flow-smoke"], {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024
      })).stdout
    ) as { ok: boolean; flow_smoke?: { flow_id?: string }; runtime_config_check?: { ppirtv_home?: string } };
    const smokeB = JSON.parse(
      (await execFileAsync(process.execPath, ["scripts/smoke-mcp-tools.mjs", "--workspace", workspaceB, "--flow-smoke"], {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024
      })).stdout
    ) as { ok: boolean; flow_smoke?: { flow_id?: string }; runtime_config_check?: { ppirtv_home?: string } };

    expect(smokeA.ok).toBe(true);
    expect(smokeB.ok).toBe(true);
    expect(smokeA.runtime_config_check?.ppirtv_home).toBe(path.resolve(workspaceA, ".ppirtv"));
    expect(smokeB.runtime_config_check?.ppirtv_home).toBe(path.resolve(workspaceB, ".ppirtv"));

    const flowsA = await readdir(path.join(workspaceA, ".ppirtv", "flows"));
    const flowsB = await readdir(path.join(workspaceB, ".ppirtv", "flows"));
    expect(flowsA).toEqual([`${smokeA.flow_smoke!.flow_id}.json`]);
    expect(flowsB).toEqual([`${smokeB.flow_smoke!.flow_id}.json`]);
    expect(flowsA).not.toContain(`${smokeB.flow_smoke!.flow_id}.json`);
    expect(flowsB).not.toContain(`${smokeA.flow_smoke!.flow_id}.json`);

    const ledgerA = await readFile(path.join(workspaceA, ".ppirtv", "ledger.ndjson"), "utf8");
    const ledgerB = await readFile(path.join(workspaceB, ".ppirtv", "ledger.ndjson"), "utf8");
    expect(ledgerA).toContain(smokeA.flow_smoke!.flow_id!);
    expect(ledgerB).toContain(smokeB.flow_smoke!.flow_id!);
    expect(ledgerA).not.toContain(smokeB.flow_smoke!.flow_id!);
    expect(ledgerB).not.toContain(smokeA.flow_smoke!.flow_id!);
  });

  it("fails smoke early when selected MCP config points PPIRTV_HOME at another workspace", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-config-drift-"));
    const workspaceA = path.join(tempRoot, "consumer-a");
    const workspaceB = path.join(tempRoot, "consumer-b");
    const configPath = path.join(workspaceA, ".codex", "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await mkdir(workspaceB, { recursive: true });
    await writeFile(
      configPath,
      codexConfigToml({
        name: "dex_ppirtv",
        cwd: workspaceA,
        ppirtvHome: path.join(workspaceB, ".ppirtv")
      }),
      "utf8"
    );

    await expect(
      execFileAsync(
        process.execPath,
        ["scripts/smoke-mcp-tools.mjs", "--config-toml", configPath, "--server", "dex_ppirtv", "--flow-smoke"],
        { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
      )
    ).rejects.toMatchObject({ stdout: expect.stringContaining("ppirtv_home_mismatch") });
    await expect(pathExists(path.join(workspaceA, ".ppirtv"))).resolves.toBe(false);
    await expect(pathExists(path.join(workspaceB, ".ppirtv"))).resolves.toBe(false);
  });

  it("allows selected MCP config to omit PPIRTV_HOME and default to cwd/.ppirtv", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-default-home-"));
    const workspace = path.join(tempRoot, "consumer");
    const configPath = path.join(workspace, ".codex", "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      codexConfigToml({
        name: "dex_ppirtv",
        cwd: workspace
      }),
      "utf8"
    );

    const smoke = await execFileAsync(
      process.execPath,
      ["scripts/smoke-mcp-tools.mjs", "--config-toml", configPath, "--server", "dex_ppirtv", "--flow-smoke"],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
    );
    const result = JSON.parse(smoke.stdout) as {
      ok: boolean;
      runtime_config_check?: { code?: string; expected_ppirtv_home?: string };
      flow_smoke?: { flow_id?: string };
    };

    expect(result.ok).toBe(true);
    expect(result.runtime_config_check).toMatchObject({
      code: "ppirtv_home_defaults_to_cwd",
      expected_ppirtv_home: path.resolve(workspace, ".ppirtv")
    });
    expect(await readdir(path.join(workspace, ".ppirtv", "flows"))).toEqual([`${result.flow_smoke!.flow_id}.json`]);
  });

  it("runs through global launcher with workspace folder name from PPIRTV_WORKSPACE_ROOT", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-launcher-name-"));
    const projectsRoot = path.join(tempRoot, "projects");
    const workspace = path.join(projectsRoot, "consumer-a");
    const configRoot = path.join(tempRoot, "global-config");
    const configPath = path.join(configRoot, "config.toml");
    const memoryHome = path.join(tempRoot, "memory-home");
    const canonicalMemoryRoot = path.join(tempRoot, "dex-memoria");
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "AGENTS.md"), "# consumer-a\n", "utf8");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      codexConfigToml({
        name: "dex_ppirtv",
        cwd: process.cwd(),
        args: [path.join(process.cwd(), "dist", "launcher.js"), "--workspace", "consumer-a"],
        env: {
          PPIRTV_WORKSPACE_ROOT: projectsRoot,
          PPIRTV_MEMORY_WRITER_PROFILE: "v2",
          PPIRTV_DEX_MEMORIA_CANONICAL_ROOT: canonicalMemoryRoot,
          PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT: path.join(canonicalMemoryRoot, "bin", "dex-memoria.js"),
          DEX_MEMORIA_HOME: memoryHome
        }
      }),
      "utf8"
    );

    const smoke = await execFileAsync(
      process.execPath,
      ["scripts/smoke-mcp-tools.mjs", "--config-toml", configPath, "--server", "dex_ppirtv", "--flow-smoke"],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
    );
    const result = JSON.parse(smoke.stdout) as {
      ok: boolean;
      runtime_config_check?: { code?: string; launcher_workspace?: string; expected_ppirtv_home?: string };
      flow_smoke?: {
        flow_id?: string;
        status_runtime?: RuntimeSmokeSummary;
        checkout_runtime?: RuntimeSmokeSummary;
      };
    };
    const canonicalWorkspace = await realpath(workspace);

    expect(result.ok).toBe(true);
    expect(result.runtime_config_check).toMatchObject({
      code: "ppirtv_launcher_workspace_resolved",
      launcher_workspace: canonicalWorkspace,
      expected_ppirtv_home: path.join(canonicalWorkspace, ".ppirtv")
    });
    expect(result.flow_smoke?.status_runtime).toMatchObject({
      project_root: canonicalWorkspace,
      ppirtv_home: path.join(canonicalWorkspace, ".ppirtv"),
      memory_writer_runtime: {
        profile: "v2",
        workspace_root: canonicalWorkspace,
        memory_home: memoryHome
      }
    });
    expect(result.flow_smoke?.checkout_runtime).toMatchObject({
      project_root: canonicalWorkspace,
      ppirtv_home: path.join(canonicalWorkspace, ".ppirtv")
    });
    expect(await readdir(path.join(workspace, ".ppirtv", "flows"))).toEqual([`${result.flow_smoke!.flow_id}.json`]);
  });

  it("keeps global Codex launcher neutral with a blank workspace placeholder and validates a consumer by CLI context", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-launcher-placeholder-"));
    const projectsRoot = path.join(tempRoot, "projects");
    const workspace = path.join(projectsRoot, "consumer-a");
    const configPath = path.join(tempRoot, "global-config", "config.toml");
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "AGENTS.md"), "# consumer-a\n", "utf8");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      codexConfigToml({
        name: "dex_ppirtv",
        cwd: process.cwd(),
        args: [path.join(process.cwd(), "dist", "launcher.js"), "--workspace", ""],
        env: { PPIRTV_WORKSPACE_ROOT: projectsRoot }
      }),
      "utf8"
    );

    const smoke = await execFileAsync(
      process.execPath,
      [
        "scripts/smoke-mcp-tools.mjs",
        "--config-toml",
        configPath,
        "--server",
        "dex_ppirtv",
        "--workspace",
        workspace,
        "--flow-smoke"
      ],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
    );
    const result = JSON.parse(smoke.stdout) as {
      ok: boolean;
      server?: { args?: string[] };
      runtime_server?: { args?: string[] };
      workspace_placeholder?: { detected?: boolean; applied?: boolean; source?: string; workspace?: string };
      runtime_config_check?: { code?: string; launcher_workspace?: string; expected_ppirtv_home?: string };
      flow_smoke?: { flow_id?: string; status_runtime?: RuntimeSmokeSummary };
      runtime_probe?: { memory_writer_runtime?: { profile?: string }; configured_memory_bundle?: { profile?: string } };
    };
    const canonicalWorkspace = await realpath(workspace);

    expect(result.ok).toBe(true);
    expect(result.server?.args).toContain("");
    expect(result.runtime_server?.args).toContain(workspace);
    expect(result.workspace_placeholder).toMatchObject({
      detected: true,
      applied: true,
      source: "smoke_cli_workspace",
      workspace
    });
    expect(result.runtime_config_check).toMatchObject({
      code: "ppirtv_launcher_workspace_resolved",
      launcher_workspace: canonicalWorkspace,
      expected_ppirtv_home: path.join(canonicalWorkspace, ".ppirtv")
    });
    expect(result.flow_smoke?.status_runtime).toMatchObject({
      project_root: canonicalWorkspace,
      ppirtv_home: path.join(canonicalWorkspace, ".ppirtv"),
      memory_writer_runtime: { profile: "unconfigured" }
    });
    expect(result.runtime_probe).toMatchObject({
      memory_writer_runtime: { profile: "unconfigured" },
      configured_memory_bundle: { profile: "unconfigured" }
    });
    expect(await readFile(configPath, "utf8")).toContain('"--workspace", ""');
    expect(await readdir(path.join(workspace, ".ppirtv", "flows"))).toEqual([`${result.flow_smoke!.flow_id}.json`]);
  });

  it("keeps global Codex launcher neutral without --workspace and validates a consumer by CLI context", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-launcher-no-workspace-cli-"));
    const workspace = path.join(tempRoot, "consumer-a");
    const configPath = path.join(tempRoot, "global-config", "config.toml");
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "AGENTS.md"), "# consumer-a\n", "utf8");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      codexConfigToml({
        name: "dex_ppirtv",
        cwd: process.cwd(),
        args: [path.join(process.cwd(), "dist", "launcher.js")]
      }),
      "utf8"
    );

    const smoke = await execFileAsync(
      process.execPath,
      [
        "scripts/smoke-mcp-tools.mjs",
        "--config-toml",
        configPath,
        "--server",
        "dex_ppirtv",
        "--workspace",
        workspace,
        "--flow-smoke"
      ],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
    );
    const result = JSON.parse(smoke.stdout) as {
      ok: boolean;
      server?: { args?: string[] };
      runtime_server?: { args?: string[] };
      workspace_placeholder?: { kind?: string; detected?: boolean; applied?: boolean; workspace?: string };
      runtime_config_check?: { code?: string; launcher_workspace?: string; expected_ppirtv_home?: string };
      flow_smoke?: { flow_id?: string; status_runtime?: RuntimeSmokeSummary };
    };
    const canonicalWorkspace = await realpath(workspace);

    expect(result.ok).toBe(true);
    expect(result.server?.args).not.toContain("--workspace");
    expect(result.runtime_server?.args).toEqual(expect.arrayContaining(["--workspace", workspace]));
    expect(result.workspace_placeholder).toMatchObject({
      kind: "missing_workspace_argument",
      detected: true,
      applied: true,
      workspace
    });
    expect(result.runtime_config_check).toMatchObject({
      code: "ppirtv_launcher_workspace_resolved",
      launcher_workspace: canonicalWorkspace,
      expected_ppirtv_home: path.join(canonicalWorkspace, ".ppirtv")
    });
    expect(result.flow_smoke?.status_runtime).toMatchObject({
      project_root: canonicalWorkspace,
      ppirtv_home: path.join(canonicalWorkspace, ".ppirtv")
    });
    expect(await readFile(configPath, "utf8")).not.toContain("--workspace");
    expect(await readdir(path.join(workspace, ".ppirtv", "flows"))).toEqual([`${result.flow_smoke!.flow_id}.json`]);
  });

  it("fails global launcher early from install repo without workspace signal", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-launcher-no-signal-"));
    const configPath = path.join(tempRoot, "config.toml");
    await writeFile(
      configPath,
      codexConfigToml({
        name: "dex_ppirtv",
        cwd: process.cwd(),
        args: [path.join(process.cwd(), "dist", "launcher.js")]
      }),
      "utf8"
    );

    await expect(
      execFileAsync(
        process.execPath,
        ["scripts/smoke-mcp-tools.mjs", "--config-toml", configPath, "--server", "dex_ppirtv", "--flow-smoke"],
        { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
      )
    ).rejects.toMatchObject({ stdout: expect.stringContaining("ppirtv_launcher_workspace_required") });
  });

  it("accepts the install owner only when launcher argv selects it explicitly", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-launcher-owner-explicit-"));
    const configPath = path.join(tempRoot, "config.toml");
    const installRoot = process.cwd();
    await writeFile(
      configPath,
      codexConfigToml({
        name: "dex_ppirtv",
        cwd: installRoot,
        args: [path.join(installRoot, "dist", "launcher.js"), "--workspace", installRoot]
      }),
      "utf8"
    );

    const audited = await execFileAsync(
      process.execPath,
      ["scripts/smoke-mcp-tools.mjs", "--config-toml", configPath, "--server", "dex_ppirtv", "--audit-only"],
      { cwd: installRoot, maxBuffer: 1024 * 1024 }
    );
    const result = JSON.parse(audited.stdout) as {
      ok: boolean;
      runtime_config_check?: { code?: string; launcher_workspace?: string };
    };

    expect(result.ok).toBe(true);
    expect(result.runtime_config_check).toMatchObject({
      code: "ppirtv_launcher_workspace_resolved",
      launcher_workspace: await realpath(installRoot)
    });
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

function codexConfigToml(input: {
  name: string;
  enabled?: boolean;
  cwd: string;
  ppirtvHome?: string;
  args?: string[];
  env?: Record<string, string>;
}): string {
  const env = {
    ...(input.ppirtvHome ? { PPIRTV_HOME: input.ppirtvHome } : {}),
    ...(input.env ?? {})
  };
  return [
    `[mcp_servers.${input.name}]`,
    ...(input.enabled === undefined ? [] : [`enabled = ${input.enabled ? "true" : "false"}`]),
    `command = "${escapeTomlPath(process.execPath)}"`,
    `args = [${(input.args ?? [path.join(process.cwd(), "dist", "index.js")]).map((arg) => `"${escapeTomlPath(arg)}"`).join(", ")}]`,
    `cwd = "${escapeTomlPath(input.cwd)}"`,
    ...(Object.keys(env).length > 0
      ? [
        "",
        `[mcp_servers.${input.name}.env]`,
        ...Object.entries(env).map(([key, value]) => `${key} = "${escapeTomlPath(value)}"`)
      ]
      : []),
    ""
  ].join("\n");
}

function escapeTomlPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type RuntimeSmokeSummary = {
  project_root?: string;
  ppirtv_home?: string;
  runtime_layout_status?: {
    status?: string;
    missing_directories?: string[];
  };
  memory_writer_runtime?: {
    profile?: string;
    workspace_root?: string;
    memory_home?: string | null;
  };
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
