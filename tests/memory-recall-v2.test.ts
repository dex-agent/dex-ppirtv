import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { MemoryLibrarian } from "../src/memory/index.js";
import { inspectCanonicalV2Routes, parseV2UnitMetadata, selectExactPortableName, selectPhysicalCaseEquivalent } from "../src/memory/memory-v2-layout.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let workspace: string;
let engine: FlowEngine;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-memory-recall-v2-"));
  workspace = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspace, ".agents"), { recursive: true });
  engine = new FlowEngine(new PpirtvStore(path.join(tempRoot, "runtime")));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("mixed V1 and V2 curated recall", () => {
  it("recalls a lowercase physical L1, the V1 monolith and the linked V2 L2 unit", async () => {
    await writeMemory("lembranca.md", [
      "- PPIRTV-V2-RECALL -> [Recall V2](memorias/recall-v2.md) [[memorias/recall-v2|Recall V2]] #ppirtv/memory ^recall-v2"
    ].join("\n"));
    await writeMemory("memoria.md", "## PPIRTV legacy recall\n\nCompatibilidade V1 continua recuperavel.\n");
    await writeMemory("memorias/recall-v2.md", v2Unit("L2", "recall-v2", "Recall V2", "Conteudo operacional do recall V2."));

    const recalled = await recall("PPIRTV V2 recall compatibilidade legacy operacional");
    const paths = recalled.items.map((item) => item.path).filter(Boolean) as string[];

    expect(paths).toContain(path.join(workspace, ".agents", "lembranca.md"));
    expect(paths).toContain(path.join(workspace, ".agents", "memoria.md"));
    expect(paths).toContain(path.join(workspace, ".agents", "memorias", "recall-v2.md"));
  });

  it("follows only the linked L3 README and never scans a strong orphan L2 unit", async () => {
    await writeMemory("lembranca.md", [
      "- PPIRTV-V2-L3 -> [Conhecimento profundo](conhecimento/conhecimento-profundo/README.md) [[conhecimento/conhecimento-profundo/README|Conhecimento profundo]] #ppirtv/memory ^conhecimento-profundo"
    ].join("\n"));
    await writeMemory("conhecimento/conhecimento-profundo/README.md", v2Unit("L3", "conhecimento-profundo", "Conhecimento profundo", "Modelo profundo recuperado sob demanda.", "dex-memoria"));
    await writeMemory("memorias/orfao-forte.md", v2Unit("L2", "orfao-forte", "PPIRTV V2 L3 conhecimento profundo", "Termos fortes nao autorizam varredura orfa."));

    const recalled = await recall("PPIRTV V2 L3 conhecimento profundo termos fortes");
    const paths = recalled.items.map((item) => item.path).filter(Boolean) as string[];

    expect(paths).toContain(path.join(workspace, ".agents", "conhecimento", "conhecimento-profundo", "README.md"));
    expect(paths).not.toContain(path.join(workspace, ".agents", "memorias", "orfao-forte.md"));
  });

  it("treats Markdown plus its companion wikilink as one route", async () => {
    await writeMemory("lembranca.md", "- ROUTE-ONE -> [Uma rota](memorias/uma-rota.md) [[memorias/uma-rota|Uma rota]] #ppirtv/memory ^uma-rota\n");
    await writeMemory("memorias/uma-rota.md", v2Unit("L2", "uma-rota", "Uma rota", "Uma unica unidade."));

    const recalled = await recall("ROUTE ONE uma rota");
    const unitPath = path.join(workspace, ".agents", "memorias", "uma-rota.md");

    expect(recalled.items.filter((item) => item.path === unitPath)).toHaveLength(1);
  });

  it("selects the physical case-equivalent name and rejects an ambiguous inventory deterministically", () => {
    expect(selectPhysicalCaseEquivalent(["lembranca.md", "memoria.md"], "LEMBRANCA.md")).toBe("lembranca.md");
    expect(() => selectPhysicalCaseEquivalent(["LEMBRANCA.md", "lembranca.md"], "lembranca.md")).toThrow("MEMORY_CASE_EQUIVALENT_AMBIGUOUS");
  });

  it("does not activate an image or a documentary link without the canonical arrow", () => {
    expect(inspectCanonicalV2Routes("- SCREEN -> ![imagem](memorias/imagem.md)").routes).toEqual([]);
    expect(inspectCanonicalV2Routes("- Consulte [documento](memorias/documento.md)").routes).toEqual([]);
    expect(inspectCanonicalV2Routes("- ACTIVE -> [Memoria](memorias/ativa.md) ^ativa").routes).toEqual([
      { relativePath: "memorias/ativa.md", layer: "L2", slug: "ativa" }
    ]);
  });

  it("distinguishes legacy knowledge indexes from malformed V2 route candidates", () => {
    const legacy = inspectCanonicalV2Routes(
      "- LEGACY -> [Local](memoria.md) | [L3](conhecimento/INDEX.md) ^legacy"
    );
    expect(legacy).toEqual({ routes: [], rejectedHrefs: [] });

    for (const href of [
      "memorias/../invalida.md",
      "memorias/invalida.md#anchor",
      "https://example.invalid/memorias/invalida.md",
      "memorias\\invalida.md",
      "conhecimento/../invalida/README.md",
      "conhecimento/invalida/README.md#anchor",
      "https://example.invalid/conhecimento/invalida/README.md",
      "conhecimento\\invalida\\README.md",
      "conhecimento/invalida/README.md.bak"
    ]) {
      expect(inspectCanonicalV2Routes(`- INVALIDA -> [Destino](${href})`).rejectedHrefs).toEqual([href]);
    }
  });

  it("rejects duplicate governed front-matter keys", () => {
    expect(parseV2UnitMetadata("---\nimplementation_version: v2\nlayer: L2\nlayer: L3\nslug: duplicada\n---\n# Duplicada\n")).toBeNull();
  });

  it("deduplicates and ranks linked routes before applying the target budget", async () => {
    const weak = Array.from({ length: 8 }, (_, index) => `- PPIRTV-fraco-${index} -> [Fraca](memorias/fraca.md) ^fraca-${index}`);
    await writeMemory("lembranca.md", [...weak, "- PPIRTV-FORTE -> [Forte](memorias/forte.md) ^forte"].join("\n"));
    await writeMemory("memorias/fraca.md", v2Unit("L2", "fraca", "Fraca", "Sem correspondencia relevante."));
    await writeMemory("memorias/forte.md", v2Unit("L2", "forte", "Forte", "PPIRTV FORTE alvo prioritario."));

    const recalled = await recall("PPIRTV FORTE alvo prioritario");
    expect(recalled.items.map((item) => item.path)).toContain(path.join(workspace, ".agents", "memorias", "forte.md"));
  });

  it("recalls a valid V2 unit larger than 64 KiB but below the canonical 1 MiB limit", async () => {
    await writeMemory("lembranca.md", "- GRANDE -> [Grande](memorias/grande.md) ^grande\n");
    await writeMemory("memorias/grande.md", v2Unit("L2", "grande", "Grande", `conteudo-grande ${"x".repeat(70 * 1024)}`));

    const recalled = await recall("GRANDE conteudo grande");
    expect(recalled.items.map((item) => item.path)).toContain(path.join(workspace, ".agents", "memorias", "grande.md"));
  });

  it("rejects non-portable nested casing", async () => {
    await writeMemory("lembranca.md", "- CASING -> [Casing](memorias/casing.md) ^casing\n");
    await writeMemory("Memorias/casing.md", v2Unit("L2", "casing", "Casing", "Nao portavel."));

    const recalled = await recall("CASING");
    expect(recalled.items.map((item) => item.path)).not.toContain(path.join(workspace, ".agents", "Memorias", "casing.md"));
    expect(recalled.warnings).toContain("curated_v2_target_noncanonical_casing");
  });

  it("reports a missing linked V2 target", async () => {
    await writeMemory("lembranca.md", "- AUSENTE -> [Ausente](memorias/ausente.md) ^ausente\n");
    await mkdir(path.join(workspace, ".agents", "memorias"), { recursive: true });

    const recalled = await recall("AUSENTE");
    expect(recalled.warnings).toContain("curated_v2_target_missing");
  });

  it("keeps all eight linked destinations in the final bounded recall result", async () => {
    const triggers: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      triggers.push(`- COMUM -> [Unidade ${index}](memorias/unidade-${index}.md) ^unidade-${index}`);
      await writeMemory(`memorias/unidade-${index}.md`, v2Unit("L2", `unidade-${index}`, `Unidade ${index}`, "COMUM conteudo recuperado."));
    }
    await writeMemory("lembranca.md", triggers.join("\n"));

    const recalled = await recall("COMUM");
    expect(recalled.items.filter((item) => item.source === "curated_l2")).toHaveLength(8);
  });

  it("keeps all eight linked V2 destinations even when matching V1 blocks compete for the final result", async () => {
    const triggers: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      triggers.push(`- MISTO -> [Unidade ${index}](memorias/mista-${index}.md) ^mista-${index}`);
      await writeMemory(`memorias/mista-${index}.md`, v2Unit("L2", `mista-${index}`, `Mista ${index}`, "MISTO corpo V2."));
    }
    await writeMemory("lembranca.md", triggers.join("\n"));
    await writeMemory("memoria.md", "## V1 A\nMISTO legado A\n\n## V1 B\nMISTO legado B\n\n## V1 C\nMISTO legado C\n");

    const recalled = await recall("MISTO");
    const linkedV2 = recalled.items.filter((item) => item.path?.includes(`${path.sep}memorias${path.sep}mista-`));
    expect(linkedV2).toHaveLength(8);
  });

  it("rejects an ownerless L3 target during recall", async () => {
    await writeMemory("lembranca.md", "- OWNER -> [Owner](conhecimento/owner/README.md) ^owner\n");
    await writeMemory("conhecimento/owner/README.md", v2Unit("L3", "owner", "Owner", "Sem owner."));

    const recalled = await recall("OWNER");
    expect(recalled.items.map((item) => item.source)).not.toContain("curated_l3");
    expect(recalled.warnings).toContain("curated_v2_target_owner_missing");
  });

  it("rejects an exact nested name when another case-equivalent sibling also exists", () => {
    expect(() => selectExactPortableName(["memorias", "Memorias"], "memorias")).toThrow("MEMORY_CASE_EQUIVALENT_AMBIGUOUS");
  });

  it("reports deterministic truncation above eight linked targets", async () => {
    const triggers: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      triggers.push(`- LIMITE -> [Limite ${index}](memorias/limite-${index}.md) ^limite-${index}`);
      await writeMemory(`memorias/limite-${index}.md`, v2Unit("L2", `limite-${index}`, `Limite ${index}`, "LIMITE conteudo."));
    }
    await writeMemory("lembranca.md", triggers.join("\n"));
    const recalled = await recall("LIMITE");
    expect(recalled.items.filter((item) => item.path?.includes(`${path.sep}memorias${path.sep}limite-`))).toHaveLength(8);
    expect(recalled.warnings).toContain("curated_v2_targets_truncated");
  });

  it("rejects a linked target above the canonical 1 MiB read limit", async () => {
    await writeMemory("lembranca.md", "- ENORME -> [Enorme](memorias/enorme.md) ^enorme\n");
    await writeMemory("memorias/enorme.md", v2Unit("L2", "enorme", "Enorme", `ENORME ${"x".repeat(1024 * 1024)}`));
    const recalled = await recall("ENORME");
    expect(recalled.items.map((item) => item.path)).not.toContain(path.join(workspace, ".agents", "memorias", "enorme.md"));
    expect(recalled.warnings).toContain("curated_recall_file_too_large");
  });
});

async function recall(goal: string) {
  const flow = await engine.createFlow({ goal, context: goal, risks: [], uncertainties: [] });
  flow.goal_binding = {
    envelope: {
      workspace,
      spt_path: path.join(workspace, "trail.md"),
      objective: flow.goal,
      idempotency_key: `recall-${flow.flow_id}`,
      evidence_required: true,
      required_evidence: [],
      requested_verdict_policy: "evidence_required",
      source: "memory-recall-v2.test"
    },
    started_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  };
  return await new MemoryLibrarian(path.join(tempRoot, "runtime")).beforePhase({ flow, phase: "planejamento" });
}

async function writeMemory(relativePath: string, content: string): Promise<void> {
  const target = path.join(workspace, ".agents", ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function v2Unit(layer: "L2" | "L3", slug: string, title: string, body: string, ownerSkill?: string): string {
  return [
    "---",
    "implementation_version: v2",
    `layer: ${layer}`,
    `slug: ${slug}`,
    ...(ownerSkill ? [`owner_skill: ${ownerSkill}`] : []),
    "---",
    `# ${title}`,
    "",
    body,
    ""
  ].join("\n");
}
