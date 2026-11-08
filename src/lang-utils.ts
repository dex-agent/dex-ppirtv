import type { Flow } from "./domain.js";

// Utilitarios puros compartilhados: motor e modulos de politica importam daqui
// (fonte unica — nasceram no monolito e sairam junto da politica de meetings).

export function unique(values: string[]): string[] {
  // SPT input-nunca-bloqueante-frentes-2: flows legados podem carregar o
  // artefato de cliente {"value": X} em changed_files; o filtro tolerante
  // descarta o nao-string em vez de lancar TypeError criptico na leitura.
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return Boolean(value);
}

export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return value ? [String(value)] : [];
}


export function uniqueCooperators(values: Flow["cooperators"]): Flow["cooperators"] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.name}\n${value.reason}\n${value.material}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return value.name.trim().length > 0 && value.reason.trim().length > 0;
  });
}
