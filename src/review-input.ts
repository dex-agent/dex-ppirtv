// Fronteira de input de review do evidence_add (extraida de src/server.ts em
// 2026-10-18 pelo metodo arvore; o monolito encolheu 104 linhas).
//
// DECISAO DE PRODUTO (dono, 2026-10-18): erro de forma de input NUNCA e
// bloqueante. O unwrap do artefato de cliente {"value": X} e generico e mora
// no override de validateToolInput (todas as tools, um ponto so); o que
// sobrar de problema de shape em review vira RESSALVA no receipt com a
// referencia do campo — o gate de veredito continua fail-closed no
// SUBSTANCIAL (sem review real nao existe veredito positivo), mas nao existe
// mais loop de PPIRTV_INPUT_INVALID por serializacao de cliente.
export const REVIEW_FLAT_KEYS = ["diff_reviewed", "barata_scan", "reviewed_targets", "searched_patterns", "findings", "regression_risks"] as const;

// Unwrap do artefato de cliente {"value": X} DENTRO de observed_result (caso
// medido na maquina jumper, 2026-10-18: 14 retries com o wrapper). O unwrap
// generico de topo nao alcanca aqui; este e o par de dominio, tambem de um
// nivel e chave unica "value". Retorna as chaves normalizadas para o receipt
// anunciar (nunca silencioso).
export function unwrapReviewValueWrappers(
  observed: Record<string, unknown> | undefined
): string[] {
  if (!observed || typeof observed !== "object" || Array.isArray(observed)) {
    return [];
  }
  const unwrapped: string[] = [];
  for (const key of REVIEW_FLAT_KEYS) {
    const raw = observed[key];
    if (
      raw !== null && typeof raw === "object" && !Array.isArray(raw) &&
      Object.keys(raw).length === 1 && "value" in raw
    ) {
      observed[key] = (raw as { value: unknown }).value;
      unwrapped.push(key);
    }
  }
  return unwrapped;
}

// SPT review-gate-loop-proof (T-1): wire do review. As issues geradas aqui
// sao RESSALVAS do receipt (nunca rejeicao desde 2026-10-18). A validacao
// NAO vive no inputSchema porque schema refinado (ZodEffects) degrada o JSON
// publicado no tools/list (properties: {}), regredindo o contrato de
// descoberta; o raw shape preserva o schema publicado.
export function reviewObservedResultIssues(
  args: Record<string, unknown>
): Array<{ path: PropertyKey[]; expected: string; received: string; message: string }> {
  if (args.criterion_proof || args.declarative_proof) {
    return [];
  }
  const claims = Array.isArray(args.satisfies) ? args.satisfies.map(String) : [];
  if (!claims.some((claim) => claim === "diff_reviewed" || claim === "barata_scan" || claim === "regression_risks")) {
    return [];
  }
  const observed = args.observed_result as Record<string, unknown> | undefined;
  const flatTeaching =
    "review evidence requires six flat keys at the top level of observed_result: diff_reviewed (boolean true), barata_scan (boolean true), reviewed_targets (string[] of all changed files), searched_patterns (non-empty string[]), findings: string[], regression_risks: string[] — single-key {\"value\": X} wrappers are already unwrapped at the input boundary for every tool; any issue below is a RESSALVA (the call was accepted): fix the client serialization at the caller so the next call is flat";
  const describe = (input: unknown): string => {
    if (input === undefined) return "undefined";
    if (input === null) return "null";
    if (Array.isArray(input)) return "array";
    return typeof input;
  };
  const issues: Array<{ path: PropertyKey[]; expected: string; received: string; message: string }> = [];
  const issue = (field: string, received: unknown, expected: string): void => {
    issues.push({
      path: field ? ["observed_result", field] : ["observed_result"],
      expected,
      received: describe(received),
      message: `send observed_result${field ? `.${field}` : ""} as ${expected}; received ${describe(received)} — ${flatTeaching}`
    });
  };
  if (!observed || typeof observed !== "object" || Array.isArray(observed)) {
    issue("", observed, "object with the six flat review keys");
  } else {
    if (observed.diff_reviewed !== true) issue("diff_reviewed", observed.diff_reviewed, "boolean true");
    if (observed.barata_scan !== true) issue("barata_scan", observed.barata_scan, "boolean true");
    const stringArrayField = (field: string, allowEmpty: boolean): void => {
      const raw = observed[field];
      const invalid =
        !Array.isArray(raw) ||
        raw.some((item) => typeof item !== "string" || item.trim() === "") ||
        (!allowEmpty && raw.length === 0);
      if (invalid) {
        issue(field, raw, `string[]${allowEmpty ? "" : " (non-empty)"}`);
      }
    };
    stringArrayField("reviewed_targets", false);
    stringArrayField("searched_patterns", false);
    stringArrayField("findings", true);
    stringArrayField("regression_risks", true);
  }
  return issues;
}
