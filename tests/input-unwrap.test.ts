import { describe, expect, it } from "vitest";
import { unwrapClientValueWrappersDeep, sanitizePersistedProvided } from "../src/input-unwrap.js";

// SPT input-nunca-bloqueante-frentes-2 (GO do dono 2026-10-18): o artefato de
// cliente {"value": X} foi medido em qualquer nivel (elementos de array e
// objetos aninhados — laudo jumper 2026-10-18: provided.changed_files e
// reviewed_targets embrulhados). O unwrap profundo da fronteira precisa
// normalizar todos eles antes do zod.
describe("unwrapClientValueWrappersDeep", () => {
  it("desembrulha nivel 1 (retrocompativel com o unwrap raso de 57479f9)", () => {
    expect(unwrapClientValueWrappersDeep({ flow_id: { value: "flow_1" } })).toEqual({ flow_id: "flow_1" });
  });

  it("desembrulha elementos de array (o caso real do provided.changed_files do consumidor)", () => {
    expect(
      unwrapClientValueWrappersDeep({ provided: { changed_files: [{ value: "src/a.php" }, { value: "src/b.php" }] } })
    ).toEqual({ provided: { changed_files: ["src/a.php", "src/b.php"] } });
  });

  it("desembrulha em profundidade (objetos dentro de objetos)", () => {
    expect(
      unwrapClientValueWrappersDeep({ a: { value: { b: { value: { c: { value: 1 } } } } } })
    ).toEqual({ a: { b: { c: 1 } } });
  });

  it("NAO toca objeto multi-chave (dados legitimos do usuario permanecem)", () => {
    const legit = { a: { value: 1, other: 2 }, b: { keep: true, also: true } };
    expect(unwrapClientValueWrappersDeep(legit)).toEqual(legit);
  });

  it("preserva escalares, arrays de escalares e null/undefined", () => {
    expect(unwrapClientValueWrappersDeep({ a: 1, b: "x", c: [1, "y"], d: null, e: undefined, f: [{ v: 1 }] }))
      .toEqual({ a: 1, b: "x", c: [1, "y"], d: null, e: undefined, f: [{ v: 1 }] });
  });

  it("respeita teto de profundidade em cadeia infinita simulada (nao explode)", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 50; i += 1) {
      cursor.value = {};
      cursor = cursor.value as Record<string, unknown>;
    }
    expect(() => unwrapClientValueWrappersDeep(deep)).not.toThrow();
  });
});

describe("sanitizePersistedProvided", () => {
  it("saneia provided persistido sujo do flow velho: unwrap + so paths validos", () => {
    expect(
      sanitizePersistedProvided({
        changed_files: [{ value: "src/a.ts" }, "src/b.ts", { garbage: true }, 42],
        implementation_done: { value: true }
      })
    ).toEqual({ changed_files: ["src/a.ts", "src/b.ts"], implementation_done: true });
  });

  it("nao adiciona satisfacao: lixo irrecuperavel e descartado (fail-closed honesto)", () => {
    expect(sanitizePersistedProvided({ changed_files: [{ garbage: true }] })).toEqual({ changed_files: [] });
  });

  it("provided limpo passa intacto", () => {
    const clean = { changed_files: ["a.ts"], next_step: "seguir" };
    expect(sanitizePersistedProvided(clean)).toEqual(clean);
  });
});
