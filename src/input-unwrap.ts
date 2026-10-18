// Fronteira de input do dex-PPIRTV (SPT input-nunca-bloqueante-frentes-2,
// GO do dono 2026-10-18). Artefato de cliente medido em 2026-10-17 e
// 2026-10-18 (maquina jumper): geradores de tool-call de clientes reais
// embalam valores em objetos de chave unica "value" — nao so no topo, mas em
// elementos de array e objetos aninhados (provided.changed_files,
// reviewed_targets, searched_patterns). Este modulo normaliza esse artefato
// em UM ponto para todas as tools (deep) e saneia o que ja foi persistido
// sujo em flows criados antes do fix (a releitura nunca pode morrer).
//
// Trade-off declarado: deep unwrap pode normalizar um {"value": X} legitimo
// do usuario (raro). A diretiva do dono pesa mais — erro de forma de input
// nunca e bloqueante; o dado chega ao dominio e o contrato SUBSTANCIAL
// (gates tipados, veredito fail-closed) continua valendo.
export const MAX_UNWRAP_DEPTH = 6;

export function isClientValueWrapper(value: unknown): value is { value: unknown } {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 1 && "value" in value
  );
}

function unwrapDeep(value: unknown, depth: number): unknown {
  if (depth > MAX_UNWRAP_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => unwrapDeep(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    if (isClientValueWrapper(value)) {
      return unwrapDeep(value.value, depth + 1);
    }
    const normalized: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      normalized[key] = unwrapDeep(inner, depth + 1);
    }
    return normalized;
  }
  return value;
}

// Desembrulha {"value": X} recursivamente (objetos e arrays, teto de
// profundidade). Ponto unico da fronteira: o override de validateToolInput
// chama isto antes do zod, para TODAS as tools.
export function unwrapClientValueWrappersDeep<T extends Record<string, unknown>>(args: T): T {
  return unwrapDeep(args, 0) as T;
}

// Saneia provided persistido de flow criado antes do fix (laudo jumper
// 2026-10-18: gates[implementacao].provided.changed_files com elementos
// embrulhados). Desembrulha o artefato conhecido e DESCARTA lixo irrecuperavel
// dos campos de path — drop nunca adiciona satisfacao (fail-closed honesto:
// o requisito volta a constar como faltando, o diagnostico segue ensinando).
export function sanitizePersistedProvided(
  provided: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!provided || typeof provided !== "object" || Array.isArray(provided)) {
    return {};
  }
  const sanitized = unwrapClientValueWrappersDeep({ ...provided });
  for (const key of ["changed_files", "deleted_files"] as const) {
    if (!Object.prototype.hasOwnProperty.call(sanitized, key)) {
      continue;
    }
    const raw = sanitized[key];
    sanitized[key] = Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  }
  return sanitized;
}
