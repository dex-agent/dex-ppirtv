import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_ENV, resolveConfiguredPrinciplesPath, resolveUserHome } from "./config.js";
import type { HygieneFinding } from "./domain.js";
import { declaresV2Unit, inspectCanonicalV2Routes, parseV2UnitMetadata, selectExactPortableName, selectPhysicalCaseEquivalent } from "./memory/memory-v2-layout.js";

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

export type DefaultWorkflowPhase = {
  letter: string;
  name: string;
  role: string;
};

export type DefaultWorkflow = {
  id: string;
  name: string;
  fallback_rule: string;
  short_line: string;
  phases: DefaultWorkflowPhase[];
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
  default_workflow?: DefaultWorkflow;
  prompt_guidance: string[];
  hygiene_checks: string[];
  ai_application?: AiApplication;
  traceable_destination_definition?: TraceableDestinationDefinition;
  operational_severity?: OperationalSeverityContract;
  operational_trash_definition?: OperationalTrashDefinition;
  secret_env_consumption_policy?: OperationalPolicyBlock;
  early_security_proportionality_policy?: OperationalPolicyBlock;
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

export type OperationalPolicyBlock = {
  principle_id?: string;
  localizer?: string;
  rule?: string;
  allowed_when: string[];
  required_actions: string[];
  forbidden: string[];
  blocks_ready_when: string[];
  incident_response?: string[];
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
      action: "Documentar L1 lembranca.md, L2 memorias/<slug>.md e L3 conhecimento/<slug>/README.md."
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

export function defaultWorkflow(root = process.cwd()): DefaultWorkflow | undefined {
  return loadOperationalContractSync(root).default_workflow;
}

export function operationalTrashDefinition(root = process.cwd()): OperationalTrashDefinition | undefined {
  return loadOperationalContractSync(root).operational_trash_definition;
}

export function secretEnvConsumptionPolicy(root = process.cwd()): OperationalPolicyBlock | undefined {
  return loadOperationalContractSync(root).secret_env_consumption_policy;
}

export function earlySecurityProportionalityPolicy(root = process.cwd()): OperationalPolicyBlock | undefined {
  return loadOperationalContractSync(root).early_security_proportionality_policy;
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
  const hasL1 = /\bL1\b[\s\S]*lembranca\.md/i.test(text);
  const hasL2 = /\bL2\b[\s\S]*(?:memoria\.md|memorias[\\/][^\s`]+\.md)/i.test(text);
  const hasL3 = /\bL3\b[\s\S]*conhecimento[\\/]/i.test(text);
  return hasL1 && hasL2 && hasL3;
}

async function scanMemoryLayerFiles(root: string): Promise<HygieneFinding[]> {
  const findings: HygieneFinding[] = [];
  const entries = await safeReaddir(root);
  const dirs = entries.filter((entry) => entry.isDirectory() && ![".git", "node_modules", "dist", ".ppirtv"].includes(entry.name));

  for (const dir of dirs) {
    const dirPath = path.join(root, dir.name);
    const files = await safeReaddir(dirPath);
    const fileNames = files.filter((entry) => entry.isFile()).map((entry) => entry.name);
    let l1Name: string | null = null;
    let legacyL2Name: string | null = null;
    try {
      l1Name = selectPhysicalCaseEquivalent(fileNames, "lembranca.md");
      legacyL2Name = selectPhysicalCaseEquivalent(fileNames, "memoria.md");
    } catch {
      findings.push(memoryFinding(dir.name, "v2_case_equivalent_ambiguous", "memory casing ambiguo no mesmo diretorio.", dir.name, "Manter exatamente um nome fisico case-equivalent por camada."));
    }
    const names = new Set(files.map((entry) => entry.name.toLowerCase()));
    const hasL1 = l1Name !== null;
    const hasL2 = legacyL2Name !== null;
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
    const discoveredV2 = await discoverV2Units(dirPath);
    const v2Units = discoveredV2.units;
    for (const issue of discoveredV2.issues) {
      findings.push(memoryFinding(dir.name, issue.suffix, issue.message, issue.evidence, issue.action));
    }
    if (hasL3 && discoveredV2.hasLegacyKnowledge && !existsSync(path.join(dirPath, "conhecimento", "INDEX.md"))) {
      findings.push({
        id: `memory:${dir.name}:l3_without_index`,
        severity: "warning",
        category: "memory",
        message: "Diretorio conhecimento/ existe sem INDEX.md.",
        evidence: [path.join(dir.name, "conhecimento").replace(/\\/g, "/")],
        action: "Adicionar conhecimento/INDEX.md para descoberta sob demanda."
      });
    }
    if (l1Name && legacyL2Name) {
      const l1 = await readFile(path.join(dirPath, l1Name), "utf8");
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

    const linkedPaths = new Set<string>();
    if (l1Name) {
      const l1 = await readFile(path.join(dirPath, l1Name), "utf8");
      let rejectedRouteFound = false;
      for (const line of l1.split(/\r?\n/)) {
        const inspection = inspectCanonicalV2Routes(line);
        if (inspection.rejectedHrefs.length > 0) rejectedRouteFound = true;
        if (inspection.routes.length > 1) {
          const slug = inspection.routes[0]?.slug ?? "unknown";
          findings.push(memoryFinding(dir.name, `v2_l1_multiple_targets:${slug}`, "Um gatilho L1 aponta para mais de uma unidade V2.", l1Name, "Manter exatamente um destino Markdown canonico por gatilho L1."));
          continue;
        }
        const route = inspection.routes[0];
        if (!route) continue;
        linkedPaths.add(route.relativePath);
        if (!v2Units.some((unit) => unit.relativePath === route.relativePath)) {
          findings.push(memoryFinding(dir.name, `v2_target_missing:${route.relativePath}`, "O destino V2 do gatilho L1 nao existe ou nao possui metadata V2 valida.", route.relativePath, "Criar ou corrigir a unidade V2 referenciada pelo L1."));
        }
      }
      if (rejectedRouteFound) {
        findings.push(memoryFinding(dir.name, "v2_route_rejected", "Um ou mais gatilhos L1 contem rota com aparencia V2, mas fora da gramatica canonica.", l1Name, "Usar somente memorias/<slug>.md ou conhecimento/<slug>/README.md, sem URI, anchor, traversal ou backslash."));
      }
    }
    for (const unit of v2Units) {
      if (!linkedPaths.has(unit.relativePath)) {
        findings.push(memoryFinding(dir.name, `v2_orphan:${unit.relativePath}`, "Unidade V2 nao possui gatilho L1 canonico.", unit.relativePath, "Adicionar um unico gatilho L1 ou retirar a unidade da topologia ativa."));
      }
      if (unit.metadata.layer === "L3" && !unit.metadata.ownerSkill) {
        findings.push(memoryFinding(dir.name, `v2_l3_owner_skill_missing:${unit.metadata.slug}`, "Unidade V2 L3 nao declara owner_skill.", unit.relativePath, "Declarar owner_skill no front matter da unidade L3."));
      }
    }
    const layersBySlug = new Map<string, Set<string>>();
    for (const unit of v2Units) {
      const layers = layersBySlug.get(unit.metadata.slug) ?? new Set<string>();
      layers.add(unit.metadata.layer);
      layersBySlug.set(unit.metadata.slug, layers);
    }
    for (const [slug, layers] of layersBySlug) {
      if (layers.size > 1) {
        findings.push(memoryFinding(dir.name, `v2_slug_active_in_l2_and_l3:${slug}`, "O mesmo slug esta ativo simultaneamente em L2 e L3.", slug, "Escolher uma unica camada ativa para o slug."));
      }
    }
  }
  return findings;
}

async function discoverV2Units(dirPath: string) {
  const units: Array<{ relativePath: string; metadata: NonNullable<ReturnType<typeof parseV2UnitMetadata>> }> = [];
  const issues: Array<{ suffix: string; message: string; evidence: string; action: string }> = [];
  let hasLegacyKnowledge = false;
  const rootEntries = await safeReaddir(dirPath);
  const rootDirectoryNames = rootEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  try { selectExactPortableName(rootDirectoryNames, "memorias"); }
  catch (error) {
    const suffix = error instanceof Error && error.message.includes("AMBIGUOUS") ? "v2_case_equivalent_ambiguous:memorias" : `v2_noncanonical_casing:${rootDirectoryNames.find((name) => name.toLowerCase() === "memorias")}`;
    issues.push({ suffix, message: "Diretorio V2 L2 usa casing ambiguo ou nao portavel.", evidence: "memorias", action: "Manter um unico diretorio fisico com o nome exato memorias." });
  }
  const memoryRootEntry = rootEntries.find((entry) => entry.isDirectory() && entry.name === "memorias")
    ?? rootEntries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === "memorias");
  const memoryRootName = memoryRootEntry?.name ?? "memorias";
  const memoryDir = path.join(dirPath, memoryRootName);
  for (const entry of await safeReaddir(memoryDir)) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const physicalRelativePath = `${memoryRootName}/${entry.name}`;
    const text = await readFile(path.join(memoryDir, entry.name), "utf8");
    const metadata = parseV2UnitMetadata(text);
    const isDeclaredV2 = frontMatterDeclaresV2(text);
    if (isDeclaredV2 && (!metadata || metadata.layer !== "L2" || memoryRootName !== "memorias" || entry.name !== `${metadata.slug}.md`)) {
      issues.push({ suffix: `v2_metadata_invalid:${physicalRelativePath}`, message: "Unidade declarada V2 possui metadata, camada, slug ou path incoerente.", evidence: physicalRelativePath, action: "Alinhar implementation_version, layer, slug e path fisico canonico." });
      continue;
    }
    if (metadata?.layer === "L2") units.push({ relativePath: `memorias/${entry.name}`, metadata });
  }
  try { selectExactPortableName(rootDirectoryNames, "conhecimento"); }
  catch (error) {
    const suffix = error instanceof Error && error.message.includes("AMBIGUOUS") ? "v2_case_equivalent_ambiguous:conhecimento" : `v2_noncanonical_casing:${rootDirectoryNames.find((name) => name.toLowerCase() === "conhecimento")}`;
    issues.push({ suffix, message: "Diretorio V2 L3 usa casing ambiguo ou nao portavel.", evidence: "conhecimento", action: "Manter um unico diretorio fisico com o nome exato conhecimento." });
  }
  const knowledgeRootEntry = rootEntries.find((entry) => entry.isDirectory() && entry.name === "conhecimento")
    ?? rootEntries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === "conhecimento");
  const knowledgeRootName = knowledgeRootEntry?.name ?? "conhecimento";
  const knowledgeDir = path.join(dirPath, knowledgeRootName);
  for (const entry of await safeReaddir(knowledgeDir)) {
    if (entry.isFile()) {
      if (entry.name.toLowerCase() !== "index.md") hasLegacyKnowledge = true;
      continue;
    }
    if (!entry.isDirectory()) continue;
    const childEntries = await safeReaddir(path.join(knowledgeDir, entry.name));
    const childFileNames = childEntries.filter((child) => child.isFile()).map((child) => child.name);
    try { selectExactPortableName(childFileNames, "README.md"); }
    catch {
      issues.push({ suffix: `v2_noncanonical_casing:${knowledgeRootName}/${entry.name}/README.md`, message: "Arquivo V2 L3 usa casing ambiguo ou nao portavel.", evidence: `${knowledgeRootName}/${entry.name}`, action: "Manter um unico arquivo fisico com o nome exato README.md." });
    }
    const readmeEntry = childEntries.find((child) => child.isFile() && child.name === "README.md")
      ?? childEntries.find((child) => child.isFile() && child.name.toLowerCase() === "readme.md");
    if (!readmeEntry) {
      if (childEntries.length > 0) hasLegacyKnowledge = true;
      continue;
    }
    const physicalRelativePath = `${knowledgeRootName}/${entry.name}/${readmeEntry.name}`;
    const text = await readFile(path.join(knowledgeDir, entry.name, readmeEntry.name), "utf8");
    const metadata = parseV2UnitMetadata(text);
    const isDeclaredV2 = frontMatterDeclaresV2(text);
    if (!isDeclaredV2 || childEntries.some((child) => child.isFile() && child.name.toLowerCase() !== "readme.md")) hasLegacyKnowledge = true;
    if (isDeclaredV2 && (!metadata || metadata.layer !== "L3" || knowledgeRootName !== "conhecimento" || entry.name !== metadata.slug || readmeEntry.name !== "README.md")) {
      issues.push({ suffix: `v2_metadata_invalid:${physicalRelativePath}`, message: "Unidade declarada V2 possui metadata, camada, slug ou path incoerente.", evidence: physicalRelativePath, action: "Alinhar implementation_version, layer, slug e path fisico canonico." });
      continue;
    }
    if (metadata?.layer === "L3") units.push({ relativePath: `conhecimento/${entry.name}/README.md`, metadata });
  }
  return { units, issues, hasLegacyKnowledge };
}

function frontMatterDeclaresV2(text: string): boolean {
  return declaresV2Unit(text);
}

function memoryFinding(directory: string, suffix: string, message: string, evidence: string, action: string): HygieneFinding {
  return {
    id: `memory:${directory}:${suffix}`,
    severity: "warning",
    category: "memory",
    message,
    evidence: [evidence.replace(/\\/g, "/")],
    action
  };
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
  const workflow = normalizeDefaultWorkflow(input.default_workflow);
  const secretPolicy = normalizeOperationalPolicyBlock(input.secret_env_consumption_policy);
  const earlySecurityPolicy = normalizeOperationalPolicyBlock(input.early_security_proportionality_policy);
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
    ...(workflow ? { default_workflow: workflow } : {}),
    prompt_guidance: stringArray(input.prompt_guidance),
    hygiene_checks: stringArray(input.hygiene_checks),
    ai_application: normalizeAiApplication(input.ai_application),
    traceable_destination_definition: normalizeTraceableDestinationDefinition(input.traceable_destination_definition),
    operational_severity: normalizeOperationalSeverity(input.operational_severity),
    operational_trash_definition: normalizeOperationalTrashDefinition(input.operational_trash_definition),
    ...(secretPolicy ? { secret_env_consumption_policy: secretPolicy } : {}),
    ...(earlySecurityPolicy ? { early_security_proportionality_policy: earlySecurityPolicy } : {}),
    sync_contract: normalizeSyncContract(input.sync_contract),
    final_report_model: stringArray(input.final_report_model)
  };
}

function normalizeDefaultWorkflow(value: unknown): DefaultWorkflow | undefined {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string") {
    return undefined;
  }
  return {
    id: record.id,
    name: typeof record.name === "string" ? record.name : record.id,
    fallback_rule: optionalString(record.fallback_rule) ?? "",
    short_line: optionalString(record.short_line) ?? "",
    phases: Array.isArray(record.phases) ? record.phases.filter(isDefaultWorkflowPhase).map(normalizeDefaultWorkflowPhase) : []
  };
}

function isDefaultWorkflowPhase(value: unknown): value is DefaultWorkflowPhase {
  const candidate = value as DefaultWorkflowPhase;
  return Boolean(candidate && typeof candidate.letter === "string" && typeof candidate.name === "string" && typeof candidate.role === "string");
}

function normalizeDefaultWorkflowPhase(phase: DefaultWorkflowPhase): DefaultWorkflowPhase {
  return {
    letter: phase.letter,
    name: phase.name,
    role: phase.role
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

function normalizeOperationalPolicyBlock(value: unknown): OperationalPolicyBlock | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const incidentResponse = stringArray(record.incident_response);
  return {
    principle_id: optionalString(record.principle_id),
    localizer: optionalString(record.localizer),
    rule: optionalString(record.rule),
    allowed_when: stringArray(record.allowed_when),
    required_actions: stringArray(record.required_actions),
    forbidden: stringArray(record.forbidden),
    blocks_ready_when: stringArray(record.blocks_ready_when),
    ...(incidentResponse.length > 0 ? { incident_response: incidentResponse } : {})
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
