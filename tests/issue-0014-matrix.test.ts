// ISSUE-LOCAL-0014 — runner Linux no CI: a barra precisa provar a suíte nos
// DOIS mundos (windows-latest + ubuntu-latest). Vigia do contrato do yaml —
// a matrix é o aceite da issue, o runs-on amarra o job a ela. NUNCA podar.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..");

describe("ISSUE-LOCAL-0014 — CI prova a suíte em windows E ubuntu", () => {
  const ci = readFileSync(path.join(REPO, ".github", "workflows", "ci.yml"), "utf8");

  it("ci.yml declara strategy matrix os [windows-latest, ubuntu-latest] e runs-on matrix.os", () => {
    expect(ci).toMatch(/strategy:\s*\r?\n\s*matrix:\s*\r?\n\s*os:\s*\[[^\]]*windows-latest[^\]]*ubuntu-latest[^\]]*\]/);
    expect(ci).toContain("runs-on: ${{ matrix.os }}");
  });
});
