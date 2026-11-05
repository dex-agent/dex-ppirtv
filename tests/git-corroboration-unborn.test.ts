// Trilho 2026-11-05-snapshot-unborn-aninhado (A-01, RED-first).
// Consumo das issues #6 (PPIRTV-SNAPSHOT-SCOPE-261105) e #5 lapidação 1:
// reprodução independente da fixture do consumidor dex-hub (RED ao vivo em
// .agents/TMP/repro-261105/ws antes deste arquivo). Comportamentos contratados:
// - C-01: repo UNBORN (sem HEAD) não tem corroboração por status — gitChangedFiles
//   retorna null e o chamador mantém a declaração (contrato l.176-178 da fonte).
// - C-02: repo aninhado (entrada de diretório com barra final do porcelain -z,
//   com HEAD ou sem HEAD) NUNCA entra na corroboração — diretório não é
//   revisável e hoje congela o verdict com REVIEW_SNAPSHOT_FILE_REQUIRED.
// - C-03 (casing win32): declaração INDEX.md + status index.md produzem 1 entrada
//   preservando o casing da declaração (identidade fs case-insensitive).
// - C-05 (flow ferido): changed_files já persistido com book-to-skill/ é saneado
//   na próxima visita do merge (trailing-slash é assinatura de coletor).
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dedupeChangedFilesByFsIdentity, gitChangedFiles, withGitCorroboratedChangedFiles } from "../src/review-snapshot.js";
import type { Flow } from "../src/domain.js";

let tempRoot = "";
afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

const git = (workspace: string, args: string[]) =>
  execFileSync("git", ["-C", workspace, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();

// Fixture da issue #6: workspace com mission.txt declarável, preexisting.txt
// (pendência geral do checkout) e repo aninhado book-to-skill com .git próprio.
async function makeWorkspace(withHead: boolean): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "corrob-unborn-"));
  const workspace = path.join(tempRoot, "ws");
  await mkdir(workspace, { recursive: true });
  git(workspace, ["init", "-q"]);
  git(workspace, ["config", "user.email", "test@fixture"]);
  git(workspace, ["config", "user.name", "test"]);
  await writeFile(path.join(workspace, "mission.txt"), "mission content\n", "utf8");
  await writeFile(path.join(workspace, "preexisting.txt"), "preexisting\n", "utf8");
  const nested = path.join(workspace, "book-to-skill");
  await mkdir(nested, { recursive: true });
  git(nested, ["init", "-q"]);
  await writeFile(path.join(nested, "SKILL.md"), "skill doc\n", "utf8");
  if (withHead) {
    git(workspace, ["add", "mission.txt"]);
    git(workspace, ["commit", "-q", "-m", "initial"]);
  }
  return workspace;
}

function fakeFlow(workspace: string, changedFiles: string[]): Flow {
  return {
    changed_files: changedFiles,
    goal_binding: { envelope: { workspace } }
  } as unknown as Flow;
}

describe("git corroboration: unborn / nested repo / casing (issues #6 + #5.1)", () => {
  it("C-01: repo unborn (sem HEAD) retorna null — sem corroboração por status", async () => {
    const workspace = await makeWorkspace(false);
    expect(await gitChangedFiles(workspace)).toBeNull();
  });

  it("C-02: repo aninhado não entra na corroboração mesmo com HEAD", async () => {
    const workspace = await makeWorkspace(true);
    // worktree sufo: mission.txt já commitado; nested segue untracked dir entry
    const files = await gitChangedFiles(workspace);
    expect(files).not.toBeNull();
    expect(files as string[]).not.toContain("book-to-skill/");
    expect(files as string[]).not.toContain("book-to-skill");
  });

  it("C-03: casing win32 — declaração INDEX.md + status index.md = 1 entrada com casing da declaração", async () => {
    const workspace = await makeWorkspace(true);
    await writeFile(path.join(workspace, "INDEX.md"), "# index modificado\n", "utf8");
    git(workspace, ["add", "INDEX.md"]);
    const flow = fakeFlow(workspace, ["INDEX.md"]);
    const merged = (await withGitCorroboratedChangedFiles(flow)).changed_files;
    expect(merged.filter((item) => item.toLowerCase() === "index.md")).toEqual(["INDEX.md"]);
  });

  it("C-05: flow ferido com book-to-skill/ persistido é saneado no próximo merge", async () => {
    const workspace = await makeWorkspace(true);
    const flow = fakeFlow(workspace, ["book-to-skill/", "src/a.ts"]);
    const merged = (await withGitCorroboratedChangedFiles(flow)).changed_files;
    expect(merged).not.toContain("book-to-skill/");
    expect(merged).toContain("src/a.ts");
  });

  it("C-04: linux — INDEX.md e index.md permanecem 2 entradas distintas; trailing-slash descartado", () => {
    expect(dedupeChangedFilesByFsIdentity(["INDEX.md", "index.md", "book-to-skill/"], "linux"))
      .toEqual(["INDEX.md", "index.md"]);
    expect(dedupeChangedFilesByFsIdentity(["INDEX.md", "index.md"], "win32"))
      .toEqual(["INDEX.md"]);
  });
});
