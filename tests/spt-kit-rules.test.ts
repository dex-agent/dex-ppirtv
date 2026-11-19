// ISSUE-LOCAL-0009 — vigia da classe do falso verde de tipos: o D-47 declarou
// "check exit 0" com `tsc -p` src-only enquanto tests/ carregava 3 erros
// vivos (stash-probe no HEAD d4f86f5). A cura de classe mora no CONTRATO dos
// Trilhos futuros: regra R09 no RULES.md + âncora no MOLDE.md. NUNCA podar.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..");

describe("ISSUE-LOCAL-0009 — contrato do SPT ensina prova de tipos integral", () => {
  const molde = readFileSync(path.join(REPO, "spt-kit", "MOLDE.md"), "utf8");
  const rules = readFileSync(path.join(REPO, "spt-kit", "RULES.md"), "utf8");

  it("MOLDE ancora a prova de tipos no campo procedure (R9 + check:types)", () => {
    expect(molde).toContain("check:types");
    expect(molde).toContain("R9");
  });

  it("RULES traz R9: ER de tipos cita o script integral, nunca tsc parcial", () => {
    expect(rules).toContain("R9:");
    expect(rules).toContain("npm run check:types");
    expect(rules).toContain("tsc -p");
    expect(rules).toContain("verde parcial");
    expect(rules).toContain("S11");
  });
});
