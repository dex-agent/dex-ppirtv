import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMemoryWriterConfigFromEnv, resolveLauncherWorkspace } from "../src/config.js";
import { applyLauncherWorkspaceEnvironment } from "../src/launcher-environment.js";

describe("launcher V2 workspace propagation", () => {
  it("propagates the resolved workspace for the V2 writer without replacing a global workspace root", async () => {
    const projectsRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-launcher-v2-"));
    const workspace = path.join(projectsRoot, "consumer-a");
    await mkdir(path.join(workspace, ".agents"), { recursive: true });
    const env: NodeJS.ProcessEnv = {
      PPIRTV_WORKSPACE_ROOT: projectsRoot,
      PPIRTV_MEMORY_WRITER_PROFILE: "v2",
      PPIRTV_DEX_MEMORIA_CANONICAL_ROOT: path.join(projectsRoot, "dex-memoria"),
      PPIRTV_DEX_MEMORIA_V2_ENTRYPOINT: path.join(projectsRoot, "dex-memoria", "bin", "dex-memoria.js"),
      DEX_MEMORIA_HOME: path.join(projectsRoot, "memories")
    };
    const resolution = resolveLauncherWorkspace({ argv: ["--workspace", "consumer-a"], cwd: projectsRoot, env });

    applyLauncherWorkspaceEnvironment(resolution, env);

    const canonicalWorkspace = await realpath(workspace);
    expect(env.PPIRTV_WORKSPACE).toBe(canonicalWorkspace);
    expect(env.PPIRTV_WORKSPACE_ROOT).toBe(projectsRoot);
    expect(env.PPIRTV_HOME).toBe(path.join(canonicalWorkspace, ".ppirtv"));
    expect(resolveMemoryWriterConfigFromEnv(env)).toMatchObject({ profile: "v2", workspace_root: canonicalWorkspace });
  });

  it("fails closed when an explicit PPIRTV_WORKSPACE conflicts with --workspace", async () => {
    const projectsRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-launcher-conflict-"));
    const selected = path.join(projectsRoot, "selected");
    const configured = path.join(projectsRoot, "configured");
    await mkdir(path.join(selected, ".agents"), { recursive: true });
    await mkdir(path.join(configured, ".agents"), { recursive: true });
    const env: NodeJS.ProcessEnv = { PPIRTV_WORKSPACE: configured };
    const resolution = resolveLauncherWorkspace({ argv: ["--workspace", selected], cwd: projectsRoot, env });

    expect(() => applyLauncherWorkspaceEnvironment(resolution, env)).toThrow("PPIRTV_LAUNCHER_WORKSPACE_CONFLICT");
    expect(env.PPIRTV_WORKSPACE).toBe(configured);
  });

  it("fails a real launcher process before server startup when argv and env workspaces diverge", async () => {
    const projectsRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-launcher-process-conflict-"));
    const selected = path.join(projectsRoot, "selected");
    const configured = path.join(projectsRoot, "configured");
    await mkdir(path.join(selected, ".agents"), { recursive: true });
    await mkdir(path.join(configured, ".agents"), { recursive: true });

    const result = await runLauncherProcess(["--workspace", selected], { PPIRTV_WORKSPACE: configured });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("PPIRTV_LAUNCHER_WORKSPACE_CONFLICT");
  });
});

function runLauncherProcess(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/launcher.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["pipe", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end();
  });
}
