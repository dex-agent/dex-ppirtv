// Issue #21 corte C — P1-2: hooks de merge deixam suíte vermelha atravessar.
// Repro da issue portada: merge AUTOMÁTICO (pre-merge-commit roda ANTES de
// MERGE_HEAD existir — a guarda A3a mata o merge legítimo) e RESOLUÇÃO MANUAL
// (o git chama só pre-commit, que não delega ao gate de merge). LAUDO em
// .agents/AUDITORIAS/2026-11-19-corte-c-issue21/. NUNCA podar.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOKS_SRC = path.resolve(import.meta.dirname, "../tools/playbook/hooks");
const RESOLVE_GATE = path.join(HOOKS_SRC, "merge-resolve-gate.sh");

let temp = "";

function git(cwd: string, args: string[], ok = false) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (ok) return res;
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} -> ${res.status}: ${res.stderr}`);
  return res;
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cortec-"));
  const g = (...args: string[]) => git(root, args);
  g("init", "-q", "-b", "main");
  g("config", "user.name", "QA");
  g("config", "user.email", "qa@example.invalid");
  g("config", "commit.gpgsign", "false");
  temp = root;
  return { root, g };
}

async function commit(root: string, file: string, value: string) {
  await writeFile(path.join(root, file), value);
  git(root, ["add", "--", file]);
  git(root, ["commit", "-qm", value]);
}

async function installHooks(root: string, suite: string | null) {
  const hooks = path.join(root, "hooks");
  await mkdir(hooks);
  const names = ["pre-merge-commit", "pre-commit", "post-merge"];
  for (const name of names) {
    await copyFile(path.join(HOOKS_SRC, name), path.join(hooks, name));
    await chmod(path.join(hooks, name), 0o755);
  }
  if (existsSync(RESOLVE_GATE)) {
    await copyFile(RESOLVE_GATE, path.join(hooks, "merge-resolve-gate.sh"));
    await chmod(path.join(hooks, "merge-resolve-gate.sh"), 0o755);
  }
  const conf = suite === null ? "# sem suíte declarada (no-op P10)\n" : `SUITE="${suite}"\n`;
  await writeFile(path.join(hooks, "merge-check.conf"), conf);
  git(root, ["config", "core.hooksPath", "hooks"]);
}

// Fluxo AUTOMÁTICO: branches divergentes em arquivos DISTINTOS (merge sem
// conflito) — o hook pre-merge-commit roda com MERGE_HEAD ausente.
async function scenarioAuto(suite: string | null) {
  const { root } = await setupRepo();
  await commit(root, "base", "base");
  git(root, ["branch", "side"]);
  await commit(root, "left", "main");
  git(root, ["switch", "-q", "side"]);
  await commit(root, "right", "side");
  git(root, ["switch", "-q", "main"]);
  await installHooks(root, suite);
  const merged = git(root, ["merge", "--no-ff", "--no-edit", "side"], true);
  return merged.status;
}

// Estado de RESOLUÇÃO MANUAL: merge conflituoso resolvido e staged, commit AINDA
// não feito — MERGE_HEAD presente no disco (é esse o detector do pre-commit).
async function scenarioResolved(suite: string | null) {
  const { root } = await setupRepo();
  await commit(root, "base", "base");
  git(root, ["branch", "side"]);
  await commit(root, "base", "main-mudou");
  git(root, ["switch", "-q", "side"]);
  await commit(root, "base", "side-mudou");
  git(root, ["switch", "-q", "main"]);
  await installHooks(root, suite);
  const merged = git(root, ["merge", "--no-ff", "--no-edit", "side"], true);
  expect(merged.status).not.toBe(0);
  await writeFile(path.join(root, "base"), "resolvido");
  git(root, ["add", "base"]);
  expect(existsSync(path.join(root, ".git", "MERGE_HEAD"))).toBe(true);
  return root;
}

function runResolveGate(root: string, extraEnv: Record<string, string> = {}) {
  // Layout de instalação real: o script mora JUNTO do merge-check.conf em
  // <root>/hooks (o conf é resolvido por dirname $0 — invocar o script do
  // repo leria o SUITE="npm test" do repo, não o do cenário).
  return spawnSync("bash", [path.join(root, "hooks", "merge-resolve-gate.sh")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_DIR: path.join(root, ".git"), ...extraEnv }
  });
}

afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = "";
});

describe("issue 21 P1-2 — merge automático gated (pre-merge-commit real via git)", () => {
  it("suíte vermelha (SUITE=false) reprova o merge automático", async () => {
    expect(await scenarioAuto("false")).not.toBe(0);
  });

  it("suíte verde (SUITE=true) permite o merge automático", async () => {
    expect(await scenarioAuto("true")).toBe(0);
  });

  it("sem suíte declarada é no-op (exit 0, P10)", async () => {
    expect(await scenarioAuto(null)).toBe(0);
  });
});

describe("issue 21 P1-2 — gate da resolução manual (script real no estado MERGE_HEAD)", () => {
  it("suíte vermelha reprova o commit de resolução", async () => {
    const root = await scenarioResolved("false");
    expect(runResolveGate(root).status).not.toBe(0);
  });

  it("suíte verde permite o commit de resolução", async () => {
    const root = await scenarioResolved("true");
    expect(runResolveGate(root).status).toBe(0);
  });

  it("escape MERGE_CHECK_SKIP=1 declarado passa (exit 0)", async () => {
    const root = await scenarioResolved("false");
    expect(runResolveGate(root, { MERGE_CHECK_SKIP: "1" }).status).toBe(0);
  });
});

describe("issue 21 P1-2 — ligação e publicação", () => {
  it("sentinela: pre-commit real delega ao merge-resolve-gate.sh quando MERGE_HEAD existe", async () => {
    const preCommit = await import("node:fs/promises").then((fs) => fs.readFile(path.join(HOOKS_SRC, "pre-commit"), "utf8"));
    expect(preCommit).toContain("MERGE_HEAD");
    expect(preCommit).toContain("merge-resolve-gate.sh");
  });

  it("hooks publicados com bit executável (modo 100755 no índice)", () => {
    const listing = execFileSync("git", ["-C", HOOKS_SRC, "ls-files", "-s"], { encoding: "utf8" });
    const modes = new Map(
      listing
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const [mode, , , file] = line.split(/\s+/);
          return [file, mode];
        })
    );
    for (const script of ["pre-merge-commit", "pre-commit", "post-merge", "merge-resolve-gate.sh"]) {
      expect(modes.get(script), `modo de ${script}`).toBe("100755");
    }
  });
});
