import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fingerprintReviewedImplementation, gitChangedFiles } from "../src/review-snapshot.js";

const execFileAsync = promisify(execFile);

async function makeWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "ppirtv-snapshot-redaction-"));
}

describe("review snapshot redigir runtime de terceiro (Trilho 2026-10-23-snapshot-fantasma)", () => {
  it("path sensivel sob dot-dir de runtime de outro host nao bloqueia o fingerprint e o conteudo nunca entra no hash", async () => {
    const workspace = await makeWorkspace();
    const produto = path.join(workspace, "produto.ts");
    const codexConfig = path.join(workspace, ".codex", "config.toml");
    await writeFile(produto, "export const revisao = 1;\n", "utf8");
    await mkdir(path.dirname(codexConfig), { recursive: true });
    await writeFile(codexConfig, 'mcp_servers = { segredo = "token-AAA" }\n', "utf8");

    const changed = ["produto.ts", ".codex/config.toml"];
    const fp1 = await fingerprintReviewedImplementation(workspace, changed, process.platform);

    // Conteudo do arquivo redigido muda e o fingerprint NAO pode mudar:
    // prova de que o snapshot nunca leu nem hasheou o conteudo sensivel.
    await writeFile(codexConfig, 'mcp_servers = { segredo = "token-BBB" }\n', "utf8");
    const fp2 = await fingerprintReviewedImplementation(workspace, changed, process.platform);
    expect(fp2).toBe(fp1);

    // Mudanca no produto REAL continua mudando o fingerprint.
    await writeFile(produto, "export const revisao = 2;\n", "utf8");
    const fp3 = await fingerprintReviewedImplementation(workspace, changed, process.platform);
    expect(fp3).not.toBe(fp1);
  });

  it("corroboracao exclui untracked de dot-dirs de runtime de qualquer host (.codex/.zcode)", async () => {
    const workspace = await makeWorkspace();
    await execFileAsync("git", ["-C", workspace, "init"], { windowsHide: true });
    await mkdir(path.join(workspace, ".codex"), { recursive: true });
    await mkdir(path.join(workspace, ".zcode"), { recursive: true });
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, ".codex", "config.toml"), "x = 1\n", "utf8");
    await writeFile(path.join(workspace, ".zcode", "config.json"), "{}\n", "utf8");
    await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");

    const files = (await gitChangedFiles(workspace)) ?? [];
    expect(files).toContain("src/a.ts");
    expect(files.some((file) => file.includes(".codex/"))).toBe(false);
    expect(files.some((file) => file.includes(".zcode/"))).toBe(false);
  });

  it("todo path sob runtime e redigido: strict com arquivo ausente resolve e conteudo de terceiro nunca muda o hash", async () => {
    const workspace = await makeWorkspace();
    const produto = path.join(workspace, "produto.ts");
    const zcodeConfig = path.join(workspace, ".zcode", "config.json");
    await writeFile(produto, "export const revisao = 1;\n", "utf8");
    await mkdir(path.dirname(zcodeConfig), { recursive: true });
    await writeFile(zcodeConfig, '{"mcp":{"key":"AAA"}}\n', "utf8");

    const changed = ["produto.ts", ".zcode/config.json", ".agents/receipts/inexistente.json"];
    // Modo strict (o do attach de review): path runtime AUSENTE nao pode
    // derrubar com REVIEW_SNAPSHOT_FILE_REQUIRED (vitima real flow 0568).
    const strict = await fingerprintReviewedImplementation(workspace, changed, process.platform, {
      requireReviewableFiles: true
    });

    // Conteudo de runtime de terceiro muda -> hash NAO muda (nunca lido).
    await writeFile(zcodeConfig, '{"mcp":{"key":"BBB"}}\n', "utf8");
    expect(
      await fingerprintReviewedImplementation(workspace, changed, process.platform, { requireReviewableFiles: true })
    ).toBe(strict);

    // Arquivo de runtime REMOVIDO -> hash nao muda (redigido independe de
    // existencia e de leitura).
    await rm(zcodeConfig, { force: true });
    expect(
      await fingerprintReviewedImplementation(workspace, changed, process.platform, { requireReviewableFiles: true })
    ).toBe(strict);

    // A entrada redacted_runtime entra no JSON hasheado: path runtime NOVO
    // na lista muda o fingerprint (distingue redigir de descartar).
    const withCodex = await fingerprintReviewedImplementation(
      workspace,
      [...changed, ".codex/config.toml"],
      process.platform,
      { requireReviewableFiles: true }
    );
    expect(withCodex).not.toBe(strict);
  });

  it("traversal sob runtime dir resolve para produto e continua fail-closed", async () => {
    const workspace = await makeWorkspace();
    await writeFile(path.join(workspace, ".env"), "SECRET=1\n", "utf8");
    await expect(
      fingerprintReviewedImplementation(workspace, [".codex/../.env"], process.platform)
    ).rejects.toThrow(/REVIEW_SNAPSHOT_SENSITIVE_PATH/);
    await expect(
      fingerprintReviewedImplementation(workspace, [".git/../.npmrc"], process.platform)
    ).rejects.toThrow(/REVIEW_SNAPSHOT_SENSITIVE_PATH/);
  });

  it("segredo de produto proprio fora de runtime dir continua fail-closed", async () => {
    const workspace = await makeWorkspace();
    await writeFile(path.join(workspace, ".env"), "SECRET=1\n", "utf8");
    await expect(
      fingerprintReviewedImplementation(workspace, [".env"], process.platform)
    ).rejects.toThrow(/REVIEW_SNAPSHOT_SENSITIVE_PATH/);
  });
});
