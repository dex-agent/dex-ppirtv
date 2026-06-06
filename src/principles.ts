import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_ENV, resolveConfiguredPrinciplesPath, resolveUserHome } from "./config.js";
import type { HygieneFinding } from "./domain.js";

export type PrincipleSeverity = "info" | "warning" | "error";
export type ContractVersion = number | string;
export type OperationalSeverityLevel = "INFO" | "WARN" | "BLOCK";

export type OperationalPrinciple = {
  id: string;
  legacy_id?: string;
  name?: string;
  label: string;
  summary: string;
  trigger: string[];
  required_actions: string[];
  evidence: string[];
  blocks_ready_when: string[];
  default_severity?: OperationalSeverityLevel;
  severity: PrincipleSeverity;
  checklist_label: string;
  applies_to: string[];
  trace_destination: string[];
  same_error_definition?: string[];
};

export type MemoryLayer = {
  level: "L1" | "L2" | "L3";
  path: string;
  role: string;
  rule: string;
};

export type OperationalContract = {
  version: ContractVersion;
  numeric_version?: number;
  principles_revision?: string;
  updated_at?: string;
  source: string;
  canonical_source?: string;
  canonical_contract?: string;
  canonical_repo_copy?: string;
  contract_role?: string;
  rule?: string;
  sync_rule?: string;
  principles: OperationalPrinciple[];
  ready_definition: string[];
  gate_final_output: string[];
  memory_layers: MemoryLayer[];
  prompt_guidance: string[];
  hygiene_checks: string[];
  ai_application?: AiApplication;
  traceable_destination_definition?: TraceableDestinationDefinition;
  operational_severity?: OperationalSeverityContract;
  operational_trash_definition?: OperationalTrashDefinition;
  sync_contract?: SyncContract;
  final_report_model: string[];
};

export type PrincipleChecklistItem = {
  id: string;
  label: string;
  checked: boolean;
  state?: "checked" | "unchecked" | "pending" | "blocked";
  severity: PrincipleSeverity;
  name?: string;
  summary: string;
  trigger: string[];
  required_actions: string[];
  evidence: string[];
  blocks_ready_when: string[];
  default_severity?: OperationalSeverityLevel;
  applies_to: string[];
  trace_destination: string[];
  same_error_definition?: string[];
};

export type AiApplication = {
  rule?: string;
  required_fields: string[];
  execution_format: string[];
};

export type TraceableDestinationDefinition = {
  rule?: string;
  valid_examples: string[];
  blocks_ready_when: string[];
};

export type OperationalSeverityContract = {
  rule?: string;
  levels: Partial<Record<OperationalSeverityLevel, string>>;
  default_by_principle: Record<string, string>;
  runtime_mapping: Partial<Record<OperationalSeverityLevel, PrincipleSeverity>>;
};

export type OperationalTrashDefinition = {
  principle_id?: string;
  includes: string[];
  rule?: string;
};

export type SyncContract = {
  human_source?: string;
  derived_contract?: string;
  repo_human_copy?: string;
  repo_contract_copy?: string;
  rules: string[];
};

type ContractOrigin = "env" | "shared" | "local" | "harness" | "missing";

type OperationalContractResolution = {
  contract: OperationalContract;
  origin: ContractOrigin;
  contractPath?: string;
  sourceRoot: string;
  expectedLocalPath: string;
  expectedSharedPath: string;
  configuredPath?: string;
};

const DEFAULT_CONTRACT: OperationalContract = {
  version: 1,
  source: "principles/PRINCIPLES.md",
  principles: [],
  ready_definition: [],
  gate_final_output: [],
  memory_layers: [],
  prompt_guidance: [],
  hygiene_checks: [],
  final_report_model: []
};

export async function loadOperationalContract(root = process.cwd()): Promise<OperationalContract> {
  return (await resolveOperationalContract(root)).contract;
}

export function loadOperationalContractSync(root = process.cwd()): OperationalContract {
  return resolveOperationalContractSync(root).contract;
}

export async function principleChecklist(root = process.cwd()): Promise<PrincipleChecklistItem[]> {
  const resolution = await resolveOperationalContract(root);
  const sourceText = await readSourceText(resolution, resolution.contract.source);
  return checklistFromContract(resolution.contract, sourceText);
}

export function principleChecklistSync(root = process.cwd()): PrincipleChecklistItem[] {
  const resolution = resolveOperationalContractSync(root);
  const sourcePath = sourcePathFor(resolution, resolution.contract.source);
  const sourceText = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : "";
  return checklistFromContract(resolution.contract, sourceText);
}

export async function scanOperationalPrinciples(root = process.cwd()): Promise<HygieneFinding[]> {
  const resolution = await resolveOperationalContract(root);
  const contract = resolution.contract;
  const findings: HygieneFinding[] = [];
  const sourcePath = sourcePathFor(resolution, contract.source);
  const sourceText = existsSync(sourcePath) ? await readFile(sourcePath, "utf8") : "";

  if (resolution.origin === "env" && (!resolution.contractPath || !existsSync(resolution.contractPath))) {
    findings.push({
      id: "principles:env_contract_missing",
      severity: "error",
      category: "principles",
      message: `${RUNTIME_ENV.principlesPath} aponta para contrato inexistente.`,
      evidence: [resolution.configuredPath ?? RUNTIME_ENV.principlesPath],
      action: `Corrigir ${RUNTIME_ENV.principlesPath} ou remover a env var para usar o contrato compartilhado/fallback.`
    });
  }

  if (resolution.origin === "harness") {
    findings.push({
      id: "principles:using_harness_fallback",
      severity: "info",
      category: "principles",
      message: "Contrato compartilhado de principios nao encontrado; usando fallback do dex-PPIRTV.",
      evidence: [resolution.expectedSharedPath, "dex-PPIRTV/principles/operational-contract.json"],
      action: `Criar o contrato compartilhado em $env:${RUNTIME_ENV.userProfile}/.agents/memories/principles ou configurar ${RUNTIME_ENV.principlesPath} explicitamente.`
    });
  }

  if (!existsSync(sourcePath)) {
    findings.push({
      id: "principles:source_missing",
      severity: "warning",
      category: "principles",
      message: "Arquivo fonte de principios nao encontrado.",
      evidence: [contract.source],
      action: "Criar PRINCIPLES.md ao lado do contrato operacional ou ajustar source no contrato."
    });
  }

  if (sourceText && !/operational-contract\.json/i.test(sourceText)) {
    findings.push({
      id: "principles:contract_not_linked",
      severity: "info",
      category: "principles",
      message: "PRINCIPLES.md nao aponta claramente para o contrato operacional editavel.",
      evidence: [contract.source],
      action: "Adicionar link para operational-contract.json."
    });
  }

  if (sourceText && contract.principles.length > 0) {
    for (const principle of contract.principles) {
      if (!sourceText.toLowerCase().includes(principle.label.toLowerCase())) {
        findings.push({
          id: `principles:missing_label:${principle.id}`,
          severity: "warning",
          category: "principles",
          message: "Contrato operacional referencia principio que nao aparece na fonte humana.",
          evidence: [contract.source, principle.id],
          action: "Alinhar label no contrato ou registrar o principio em PRINCIPLES.md."
        });
      }
    }
  }

  if (sourceText && !hasMemoryLayers(sourceText)) {
    findings.push({
      id: "memory:l1_l2_l3_not_documented",
      severity: "warning",
      category: "memory",
      message: "Principio de memoria nao documenta claramente L1, L2 e L3.",
      evidence: [contract.source],
      action: "Documentar L1 lembranca.md, L2 memoria.md e L3 conhecimento/."
    });
  }

  findings.push(...(await scanMemoryLayerFiles(root)));
  findings.push(...(await scanSecretLikeConfig(root)));
  return findings.sort((a, b) => a.id.localeCompare(b.id));
}

export function promptGuidance(root = process.cwd()): string[] {
  return loadOperationalContractSync(root).prompt_guidance;
}

export function readyDefinition(root = process.cwd()): string[] {
  return loadOperationalContractSync(root).ready_definition;
}

export function gateFinalOutput(root = process.cwd()): string[] {
  return loadOperationalContractSync(root).gate_final_output;
}

export function finalReportModel(root = process.cwd()): string[] {
  return loadOperationalContractSync(root).final_report_model;
}

export function operationalTrashDefinition(root = process.cwd()): OperationalTrashDefinition | undefined {
  return loadOperationalContractSync(root).operational_trash_definition;
}

export function operationalContractMeta(root = process.cwd()): Record<string, unknown> {
  const contract = loadOperationalContractSync(root);
  return {
    version: contract.version,
    numeric_version: contract.numeric_version ?? null,
    principles_revision: contract.principles_revision ?? null,
    updated_at: contract.updated_at ?? null,
    source: contract.source,
    canonical_source: contract.canonical_source ?? null,
    canonical_contract: contract.canonical_contract ?? null,
    canonical_repo_copy: contract.canonical_repo_copy ?? null,
    contract_role: contract.contract_role ?? null
  };
}

export async function resolveOperationalContract(root = process.cwd()): Promise<OperationalContractResolution> {
  const resolution = resolveOperationalContractPath(root);
  if (!resolution.contractPath || !existsSync(resolution.contractPath)) {
    return { ...resolution, contract: DEFAULT_CONTRACT };
  }
  return {
    ...resolution,
    contract: normalizeContract(JSON.parse(await readFile(resolution.contractPath, "utf8")))
  };
}

export function resolveOperationalContractSync(root = process.cwd()): OperationalContractResolution {
  const resolution = resolveOperationalContractPath(root);
  if (!resolution.contractPath || !existsSync(resolution.contractPath)) {
    return { ...resolution, contract: DEFAULT_CONTRACT };
  }
  return {
    ...resolution,
    contract: normalizeContract(JSON.parse(readFileSync(resolution.contractPath, "utf8")))
  };
}

function resolveOperationalContractPath(root: string): Omit<OperationalContractResolution, "contract"> {
  const expectedLocalPath = localContractPath(root);
  const expectedSharedPath = sharedMemoryContractPath();
  const configuredPath = resolveConfiguredPrinciplesPath();
  if (configuredPath) {
    const resolved = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(root, configuredPath);
    return {
      origin: "env",
      contractPath: resolved,
      sourceRoot: inferContractRoot(resolved),
      expectedLocalPath,
      expectedSharedPath,
      configuredPath
    };
  }
  if (existsSync(expectedSharedPath)) {
    return {
      origin: "shared",
      contractPath: expectedSharedPath,
      sourceRoot: inferContractRoot(expectedSharedPath),
      expectedLocalPath,
      expectedSharedPath
    };
  }
  if (existsSync(expectedLocalPath)) {
    return {
      origin: "local",
      contractPath: expectedLocalPath,
      sourceRoot: root,
      expectedLocalPath,
      expectedSharedPath
    };
  }
  const fallback = harnessContractPath();
  if (existsSync(fallback)) {
    return {
      origin: "harness",
      contractPath: fallback,
      sourceRoot: inferContractRoot(fallback),
      expectedLocalPath,
      expectedSharedPath
    };
  }
  return {
    origin: "missing",
    sourceRoot: root,
    expectedLocalPath,
    expectedSharedPath
  };
}

function localContractPath(root: string): string {
  return path.join(root, "principles", "operational-contract.json");
}

function sharedMemoryContractPath(): string {
  return path.join(resolveUserHome(), ".agents", "memories", "principles", "operational-contract.json");
}

function harnessContractPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "principles", "operational-contract.json");
}

function inferContractRoot(contractPath: string): string {
  const parent = path.basename(path.dirname(contractPath)).toLowerCase();
  return parent === "principles" ? path.dirname(path.dirname(contractPath)) : path.dirname(contractPath);
}

async function readSourceText(resolution: OperationalContractResolution, source: string): Promise<string> {
  const sourcePath = sourcePathFor(resolution, source);
  return existsSync(sourcePath) ? readFile(sourcePath, "utf8") : "";
}

function sourcePathFor(resolution: OperationalContractResolution, source: string): string {
  return path.isAbsolute(source) ? source : path.join(resolution.sourceRoot, source);
}

function checklistFromContract(contract: OperationalContract, sourceText: string): PrincipleChecklistItem[] {
  return contract.principles.map((principle) => {
    const operationalId = principle.legacy_id ?? principle.id;
    return {
      id: operationalId,
      label: principle.checklist_label,
      checked:
        sourceText.toLowerCase().includes(principle.label.toLowerCase()) &&
        (operationalId !== "memoria_sem_lembranca" || hasMemoryLayers(sourceText)),
      severity: principle.severity,
      name: principle.name,
      summary: principle.summary,
      trigger: principle.trigger,
      required_actions: principle.required_actions,
      evidence: principle.evidence,
      blocks_ready_when: principle.blocks_ready_when,
      default_severity: principle.default_severity,
      applies_to: principle.applies_to,
      trace_destination: principle.trace_destination,
      same_error_definition: principle.same_error_definition
    };
  });
}

function hasMemoryLayers(text: string): boolean {
  return /\bL1\b[\s\S]*lembranca\.md/i.test(text) && /\bL2\b[\s\S]*memoria\.md/i.test(text) && /\bL3\b[\s\S]*conhecimento\//i.test(text);
}

async function scanMemoryLayerFiles(root: string): Promise<HygieneFinding[]> {
  const findings: HygieneFinding[] = [];
  const entries = await safeReaddir(root);
  const dirs = entries.filter((entry) => entry.isDirectory() && ![".git", "node_modules", "dist", ".ppirtv"].includes(entry.name));

  for (const dir of dirs) {
    const dirPath = path.join(root, dir.name);
    const files = await safeReaddir(dirPath);
    const names = new Set(files.map((entry) => entry.name.toLowerCase()));
    const hasL1 = names.has("lembranca.md");
    const hasL2 = names.has("memoria.md");
    const hasL3 = names.has("conhecimento");
    if (hasL2 && !hasL1) {
      findings.push({
        id: `memory:${dir.name}:l2_without_l1`,
        severity: "warning",
        category: "memory",
        message: "Diretorio tem memoria.md sem lembranca.md para acionar gatilhos.",
        evidence: [path.join(dir.name, "memoria.md").replace(/\\/g, "/")],
        action: "Criar L1 lembranca.md com gatilhos curtos apontando para ancoras L2."
      });
    }
    if (hasL3 && !existsSync(path.join(dirPath, "conhecimento", "INDEX.md"))) {
      findings.push({
        id: `memory:${dir.name}:l3_without_index`,
        severity: "warning",
        category: "memory",
        message: "Diretorio conhecimento/ existe sem INDEX.md.",
        evidence: [path.join(dir.name, "conhecimento").replace(/\\/g, "/")],
        action: "Adicionar conhecimento/INDEX.md para descoberta sob demanda."
      });
    }
    if (hasL1 && hasL2) {
      const l1 = await readFile(path.join(dirPath, "lembranca.md"), "utf8");
      if (!/memoria\.md#/i.test(l1)) {
        findings.push({
          id: `memory:${dir.name}:l1_without_l2_anchor`,
          severity: "info",
          category: "memory",
          message: "lembranca.md existe, mas nao aponta para ancoras de memoria.md.",
          evidence: [path.join(dir.name, "lembranca.md").replace(/\\/g, "/")],
          action: "Adicionar gatilhos L1 com links para memoria.md#ancora."
        });
      }
    }
  }
  return findings;
}

async function scanSecretLikeConfig(root: string): Promise<HygieneFinding[]> {
  const findings: HygieneFinding[] = [];
  const entries = await safeReaddir(root);
  if (entries.some((entry) => entry.isFile() && entry.name === ".env")) {
    findings.push({
      id: "security:secret_like_config_present",
      severity: "info",
      category: "security",
      message: "Arquivo sensivel presente; conteudo nao inspecionado.",
      evidence: [".env:present_not_read"],
      action: "Manter .env fora de leitura, logs, ledger e evidencias; validar apenas a presenca agregada.",
      sensitive_content_read: false
    } as HygieneFinding);
  }
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name !== ".env" && /\.(toml|json|yaml|yml)$/i.test(name))
    .filter((name) => !["package-lock.json", "package.json", "tsconfig.json", "vitest.config.ts"].includes(name));

  for (const file of candidates) {
    const text = await readFile(path.join(root, file), "utf8");
    const keyMatches = [...text.matchAll(/^\s*([A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|authorization)[A-Za-z0-9_.-]*)\s*=/gim)];
    if (keyMatches.length > 0) {
      findings.push({
        id: `security:secret_like_config:${file}`,
        severity: "warning",
        category: "security",
        message: "Arquivo de configuracao contem chaves com cara de segredo.",
        evidence: keyMatches.map((match) => `${file}:${match[1]}`),
        action: "Mover segredo para mecanismo seguro local e nunca registrar valor em ledger/evidencia."
      });
    }
  }
  return findings;
}

async function safeReaddir(target: string) {
  try {
    return await readdir(target, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeContract(value: unknown): OperationalContract {
  const input = value as Partial<OperationalContract>;
  return {
    version: typeof input.version === "number" || typeof input.version === "string" ? input.version : DEFAULT_CONTRACT.version,
    numeric_version: typeof input.numeric_version === "number" ? input.numeric_version : undefined,
    principles_revision: optionalString(input.principles_revision),
    updated_at: optionalString(input.updated_at),
    source: typeof input.source === "string" ? input.source : DEFAULT_CONTRACT.source,
    canonical_source: optionalString(input.canonical_source),
    canonical_contract: optionalString(input.canonical_contract),
    canonical_repo_copy: optionalString(input.canonical_repo_copy),
    contract_role: optionalString(input.contract_role),
    rule: optionalString(input.rule),
    sync_rule: optionalString(input.sync_rule),
    principles: Array.isArray(input.principles) ? input.principles.filter(isPrinciple).map(normalizePrinciple) : [],
    ready_definition: stringArray(input.ready_definition),
    gate_final_output: stringArray(input.gate_final_output),
    memory_layers: Array.isArray(input.memory_layers) ? input.memory_layers.filter(isMemoryLayer) : [],
    prompt_guidance: stringArray(input.prompt_guidance),
    hygiene_checks: stringArray(input.hygiene_checks),
    ai_application: normalizeAiApplication(input.ai_application),
    traceable_destination_definition: normalizeTraceableDestinationDefinition(input.traceable_destination_definition),
    operational_severity: normalizeOperationalSeverity(input.operational_severity),
    operational_trash_definition: normalizeOperationalTrashDefinition(input.operational_trash_definition),
    sync_contract: normalizeSyncContract(input.sync_contract),
    final_report_model: stringArray(input.final_report_model)
  };
}

function isPrinciple(value: unknown): value is OperationalPrinciple {
  const candidate = value as OperationalPrinciple;
  return Boolean(
    candidate &&
      typeof candidate.id === "string" &&
      (candidate.legacy_id === undefined || typeof candidate.legacy_id === "string") &&
      typeof candidate.label === "string" &&
      typeof candidate.summary === "string" &&
      ["info", "warning", "error"].includes(candidate.severity) &&
      typeof candidate.checklist_label === "string" &&
      Array.isArray(candidate.applies_to)
  );
}

function normalizePrinciple(principle: OperationalPrinciple): OperationalPrinciple {
  return {
    ...principle,
    name: optionalString(principle.name),
    trigger: stringArray(principle.trigger),
    required_actions: stringArray(principle.required_actions),
    evidence: stringArray(principle.evidence),
    blocks_ready_when: stringArray(principle.blocks_ready_when),
    default_severity: normalizeOperationalSeverityLevel(principle.default_severity),
    applies_to: stringArray(principle.applies_to),
    trace_destination: stringArray(principle.trace_destination),
    same_error_definition: stringArray(principle.same_error_definition)
  };
}

function normalizeAiApplication(value: unknown): AiApplication | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    rule: optionalString(record.rule),
    required_fields: stringArray(record.required_fields),
    execution_format: stringArray(record.execution_format)
  };
}

function normalizeTraceableDestinationDefinition(value: unknown): TraceableDestinationDefinition | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    rule: optionalString(record.rule),
    valid_examples: stringArray(record.valid_examples),
    blocks_ready_when: stringArray(record.blocks_ready_when)
  };
}

function normalizeOperationalSeverity(value: unknown): OperationalSeverityContract | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    rule: optionalString(record.rule),
    levels: severityStringMap(record.levels),
    default_by_principle: stringRecord(record.default_by_principle),
    runtime_mapping: runtimeSeverityMap(record.runtime_mapping)
  };
}

function normalizeOperationalTrashDefinition(value: unknown): OperationalTrashDefinition | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    principle_id: optionalString(record.principle_id),
    includes: stringArray(record.includes),
    rule: optionalString(record.rule)
  };
}

function normalizeSyncContract(value: unknown): SyncContract | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    human_source: optionalString(record.human_source),
    derived_contract: optionalString(record.derived_contract),
    repo_human_copy: optionalString(record.repo_human_copy),
    repo_contract_copy: optionalString(record.repo_contract_copy),
    rules: stringArray(record.rules)
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeOperationalSeverityLevel(value: unknown): OperationalSeverityLevel | undefined {
  return value === "INFO" || value === "WARN" || value === "BLOCK" ? value : undefined;
}

function severityStringMap(value: unknown): Partial<Record<OperationalSeverityLevel, string>> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return {
    INFO: optionalString(record.INFO),
    WARN: optionalString(record.WARN),
    BLOCK: optionalString(record.BLOCK)
  };
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function runtimeSeverityMap(value: unknown): Partial<Record<OperationalSeverityLevel, PrincipleSeverity>> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return {
    INFO: normalizeRuntimeSeverity(record.INFO),
    WARN: normalizeRuntimeSeverity(record.WARN),
    BLOCK: normalizeRuntimeSeverity(record.BLOCK)
  };
}

function normalizeRuntimeSeverity(value: unknown): PrincipleSeverity | undefined {
  return value === "info" || value === "warning" || value === "error" ? value : undefined;
}

function isMemoryLayer(value: unknown): value is MemoryLayer {
  const candidate = value as MemoryLayer;
  return Boolean(
    candidate &&
      ["L1", "L2", "L3"].includes(candidate.level) &&
      typeof candidate.path === "string" &&
      typeof candidate.role === "string" &&
      typeof candidate.rule === "string"
  );
}
