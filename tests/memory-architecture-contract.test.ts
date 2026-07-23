import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Dex Memoria V2 multi-route architecture contract", () => {
  it("keeps internal targets relative to resolved_root", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const contract = JSON.parse(
      await readFile(path.join(repositoryRoot, "principles", "operational-contract.json"), "utf8")
    );
    const principles = await readFile(
      path.join(repositoryRoot, "principles", "PRINCIPLES.md"),
      "utf8"
    );

    expect(contract.memory_architecture_profiles.target_paths).toEqual({
      L1: "existing case-equivalent L1 wins; otherwise project/lembranca.md or global-theme/LEMBRANCA.md",
      L2: "<resolved_root>/memorias/<slug>.md",
      L3: "<resolved_root>/conhecimento/<slug>/README.md"
    });
    expect(JSON.stringify(contract.memory_architecture_profiles.target_paths)).not.toMatch(
      /(?:C:\\\\Users|[A-Z]:\\\\|\/home\/)/i
    );
    expect(principles).toMatch(/mesmo[\s\S]{0,40}`resolved_root`/i);
    expect(principles).not.toMatch(/mesmo tema/i);
  });

  it("does not retain V1-only routing clauses in the active operational contract", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const contractText = await readFile(
      path.join(repositoryRoot, "principles", "operational-contract.json"),
      "utf8"
    );
    const principlesText = await readFile(
      path.join(repositoryRoot, "principles", "PRINCIPLES.md"),
      "utf8"
    );

    expect(contractText).not.toContain("sem L1, sem L2 ou sem destino seguro");
    expect(contractText).not.toContain("L1 recuperavel apontando para ancora L2");
    expect(contractText).not.toContain("recuperavel sempre; dispara L2; nao deve virar tutorial");
    expect(contractText).toContain("L1 -> L2 ou L1 -> L3");
    expect(principlesText).not.toContain("memoria nova/alterada tem L1 -> L2 -> L3 quando houver?");
    expect(principlesText).toMatch(/memoria nova\/alterada tem exatamente uma rota ativa L1 -> L2 ou L1 -> L3/i);
  });
});
