// Issue #21 janela de fechamento — P2-6 (leitor fabrica strings de inválidos),
// P2-8 (fichas TOOLSBOOK com sha dependente de EOL do checkout) e P3 residual
// (attributionHint sem lista elegível afirma "reutilizável" para ID vencido).
// Repros publicadas na issue, decodificadas NA FONTE (LAUDO
// .agents/AUDITORIAS/2026-11-19-corte-d-fechamento21/). NUNCA podar.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attributionHint } from "../src/verdict-fiscal-policy.js";
import { promptGuidance, readyDefinition } from "../src/principles.js";
import { readFileSync } from "node:fs";

const REPO = path.resolve(import.meta.dirname, "..");

describe("issue 21 P2-6 — leitor do contrato filtra valores inválidos (repro da issue)", () => {
  it("ready_definition ['valid',null,7,{}] devolve ready=['valid'] e guidance=[]", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ppirtv-principles-"));
    try {
      const contractPath = path.join(dir, "contract.json");
      await writeFile(contractPath, JSON.stringify({
        ready_definition: ["valid", null, 7, {}],
        prompt_guidance: { rule: "x" }
      }));
      const previous = process.env.PPIRTV_PRINCIPLES_PATH;
      process.env.PPIRTV_PRINCIPLES_PATH = contractPath;
      try {
        expect(readyDefinition(dir)).toEqual(["valid"]);
        expect(promptGuidance(dir)).toEqual([]);
      } finally {
        if (previous === undefined) delete process.env.PPIRTV_PRINCIPLES_PATH;
        else process.env.PPIRTV_PRINCIPLES_PATH = previous;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("issue 21 P2-8 — frescor do TOOLSBOOK canônico por blob (EOL-agnóstico)", () => {
  const catalog = JSON.parse(readFileSync(path.join(REPO, "TOOLSBOOK.json"), "utf8")) as {
    tools: Array<{ id: string; sources: Record<string, string> }>;
  };

  it("toda fonte de ficha casa com o sha256 do BLOB canonico do HEAD", () => {
    expect(catalog.tools.length).toBeGreaterThan(0);
    for (const card of catalog.tools) {
      for (const [rel, declared] of Object.entries(card.sources ?? {})) {
        const relFwd = rel.replace(/\\/g, "/");
        // Guard: fonte fora do HEAD (ex.: AGENTS.md gitignored por design —
        // sha da máquina da frota) não é canônica de blob; mantida como está.
        if (spawnSync("git", ["-C", REPO, "cat-file", "-e", `HEAD:${relFwd}`]).status !== 0) continue;
        const blob = execFileSync("git", ["-C", REPO, "show", `HEAD:${relFwd}`], {
          maxBuffer: 16 * 1024 * 1024
        });
        const canonical = createHash("sha256").update(blob).digest("hex");
        expect(canonical, `${card.id} -> ${rel} deve casar com o blob do HEAD (EOL canônico)`).toBe(declared);
      }
    }
  });

  it("fronteira: mudança de conteúdo (não-EOL) segue detectada", () => {
    const [card] = catalog.tools;
    const [rel, declared] = Object.entries(card.sources)[0];
    const disk = readFileSync(path.join(REPO, rel));
    const mutated = Buffer.concat([disk.subarray(0, Math.max(1, disk.length - 20)), Buffer.from("// mutacao-de-conteudo\n")]);
    const mutatedSha = createHash("sha256").update(mutated).digest("hex");
    expect(mutatedSha).not.toBe(declared);
  });
});

describe("issue 21 P3 — attributionHint sem lista elegível não recomenda ID não provado", () => {
  const flow = {
    evidence: [{
      evidence_id: "e1",
      kind: "review_scope_attribution",
      scope_classification: "outside"
    }]
  } as never;

  it("fallback SEM reusableIds não afirma 'reutilizavel' (RED com a repro da issue)", () => {
    const hint = attributionHint(flow, undefined, undefined);
    expect(hint).not.toBeNull();
    expect(hint ?? "").not.toContain("reutilizavel: cite");
  });

  it("COM reusableIds o comportamento pago no corte A permanece", () => {
    expect(attributionHint(flow, [], ["e1"])).toContain("reutilizavel");
    expect(attributionHint(flow, [], [])).toContain("renove");
  });
});
