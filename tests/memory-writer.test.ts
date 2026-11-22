import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryCandidate } from "../src/domain.js";
import { writeMemoryCandidate } from "../src/memory/memory-writer.js";
import { memoryAnchor } from "../src/memory/mining-policy.js";

let tempRoot = "";

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  tempRoot = "";
});

describe("memory writer hardening", () => {
  it("propagates non-ENOENT read errors instead of appending over unknown state", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-writer-"));
    const l1AsDirectory = path.join(tempRoot, "LEMBRANCA.md");
    await mkdir(l1AsDirectory, { recursive: true });
    const candidate = buildCandidate([
      l1AsDirectory,
      path.join(tempRoot, "MEMORIA.md")
    ]);

    await expect(writeMemoryCandidate(candidate)).rejects.toThrow(/EISDIR|illegal operation.*read/i);
  });
});

describe("memory writer idempotency by anchor", () => {
  it("does not duplicate a governed block when the same finding is re-mined with a distinct candidate id", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-writer-idem-"));
    const l1Path = path.join(tempRoot, "LEMBRANCA.md");
    const l2Path = path.join(tempRoot, "MEMORIA.md");
    const title = "Barata-mestra do mining";

    await writeMemoryCandidate(governCandidate("mc_primeira_mineracao", title, l1Path, l2Path));
    await writeMemoryCandidate(governCandidate("mc_remineracao", title, l1Path, l2Path));

    const anchor = memoryAnchor(title);
    const l1 = await readFile(l1Path, "utf8");
    const l2 = await readFile(l2Path, "utf8");
    // O block-id ^anchor fecha a identidade do achado: re-mineracao com Candidate id
    // distinto nao pode criar segunda copia (loop de duplicata do flow 5583).
    expect(countBlockId(l1, anchor)).toBe(1);
    expect(countBlockId(l2, anchor)).toBe(1);
    expect(l2).toContain("`mc_primeira_mineracao`");
  });

  it("keeps exact-content dedupe for legacy blocks without an anchor line", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-writer-legacy-"));
    const l1Path = path.join(tempRoot, "LEMBRANCA.md");
    const l2Path = path.join(tempRoot, "MEMORIA.md");

    await writeMemoryCandidate(buildCandidate([l1Path, l2Path]));
    await writeMemoryCandidate(buildCandidate([l1Path, l2Path]));

    const l1 = await readFile(l1Path, "utf8");
    const l2 = await readFile(l2Path, "utf8");
    expect(l1.match(/\[MEMORY-READ-ERROR\]/g)?.length).toBe(1);
    expect(l2.match(/## Memoria com erro de leitura/g)?.length).toBe(1);
  });
});

function countBlockId(content: string, anchor: string): number {
  const matches = content.match(new RegExp(`\\^${anchor}$`, "gm"));
  return matches ? matches.length : 0;
}

function governCandidate(id: string, title: string, l1Path: string, l2Path: string): MemoryCandidate {
  const anchor = memoryAnchor(title);
  const flowId = `flow_${id}`;
  return {
    id,
    title,
    source: "gold_mining",
    scope: "projeto",
    layer: "L2",
    has_l1: true,
    score: { reaproveitamento: 3, evidencia: 3, custo_esquecimento: 2, transferibilidade: 2, total: 10 },
    confidence: "alta",
    l1_gatilho: `- [GATILHO-${anchor.toUpperCase()}] ${title} ^${anchor}`,
    l2_bloco: [
      `## ${title} {#${anchor}}`,
      "",
      "Achado com trilha auditavel.",
      `Flow: \`${flowId}\``,
      `Candidate: \`${id}\``,
      `^${anchor}`
    ].join("\n"),
    target_files: [l1Path, l2Path],
    blocked: false,
    blocked_reason: null
  };
}

function buildCandidate(targetFiles: string[]): MemoryCandidate {
  return {
    id: "mc_read_error",
    title: "Memoria com erro de leitura",
    source: "gold_mining",
    scope: "projeto",
    layer: "L2",
    has_l1: true,
    score: { reaproveitamento: 2, evidencia: 2, custo_esquecimento: 1, transferibilidade: 1, total: 6 },
    confidence: "media",
    l1_gatilho: "[MEMORY-READ-ERROR] Memoria com erro de leitura.",
    l2_bloco: "## Memoria com erro de leitura\n\nProblema: erro real nao pode virar arquivo vazio.",
    target_files: targetFiles,
    blocked: false,
    blocked_reason: null
  };
}

// Frente C (GitHub #30, auditoria 377f94a): memoryAnchor trunca em 64 chars —
// dois titulos distintos com prefixo comum recebem o MESMO anchor e o guard
// ^anchor$ (cura da barata-mestra) engole o 2o achado DISTINTO: a escrita
// retorna 4 caminhos, mas o L2 so contem o primeiro titulo. Receita da issue:
// "Coleta ... em Linux" vs "Coleta ... em Windows" (prefixo comum >64).
describe("frente C (#30) — anchors distintos para titulos com prefixo comum", () => {
  const TITLE_LINUX = "Coleta do resultado da validacao integral dos contratos locais da bancada em Linux";
  const TITLE_WINDOWS = "Coleta do resultado da validacao integral dos contratos locais da bancada em Windows";

  it("dois titulos com prefixo comum >64 chars -> L2 contem os DOIS achados", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-writer-frentec-"));
    const l1Path = path.join(tempRoot, "LEMBRANCA.md");
    const l2Path = path.join(tempRoot, "MEMORIA.md");

    await writeMemoryCandidate(governCandidate("mc_linux", TITLE_LINUX, l1Path, l2Path));
    await writeMemoryCandidate(governCandidate("mc_windows", TITLE_WINDOWS, l1Path, l2Path));

    const l2 = await readFile(l2Path, "utf8");
    expect(l2).toContain(`## ${TITLE_LINUX}`);
    expect(l2).toContain(`## ${TITLE_WINDOWS}`);
    // anchors distintos no disco: 1 block-id por titulo.
    expect(memoryAnchor(TITLE_LINUX)).not.toBe(memoryAnchor(TITLE_WINDOWS));
    expect(countBlockId(l2, memoryAnchor(TITLE_LINUX))).toBe(1);
    expect(countBlockId(l2, memoryAnchor(TITLE_WINDOWS))).toBe(1);
  });

  it("controle idempotencia: regravar o MESMO titulo longo nao cria segunda copia", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-writer-frentec-idem-"));
    const l1Path = path.join(tempRoot, "LEMBRANCA.md");
    const l2Path = path.join(tempRoot, "MEMORIA.md");

    await writeMemoryCandidate(governCandidate("mc_primeira", TITLE_LINUX, l1Path, l2Path));
    await writeMemoryCandidate(governCandidate("mc_remineracao", TITLE_LINUX, l1Path, l2Path));

    const l1 = await readFile(l1Path, "utf8");
    const l2 = await readFile(l2Path, "utf8");
    const anchor = memoryAnchor(TITLE_LINUX);
    expect(countBlockId(l1, anchor)).toBe(1);
    expect(countBlockId(l2, anchor)).toBe(1);
  });

  it("controle compatibilidade: titulo com slug <=64 gera anchor sem sufixo (formato atual)", () => {
    // Titulo curto: anchor e o slug puro, igual ao formato da era atual —
    // memorias existentes curtas nao podem mudar de identidade.
    expect(memoryAnchor("Barata-mestra do mining")).toBe("barata-mestra-do-mining");
    expect(memoryAnchor("Barata-mestra do mining")).toHaveLength("barata-mestra-do-mining".length);
    const anchor = memoryAnchor(TITLE_LINUX);
    expect(anchor.length).toBeLessThanOrEqual(64);
    expect(anchor).toMatch(/^[a-z0-9-]+$/);
  });
});
