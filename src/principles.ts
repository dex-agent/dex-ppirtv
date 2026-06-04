import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_ENV, resolveConfiguredPrinciplesPath, resolveUserHome } from "./config.js";
import type { HygieneFinding } from "./domain.js";

export type PrincipleSeverity = "info" | "warning" | "error";

export type OperationalPrinciple = {
  id: string;
  label: string;
  summary: string;
  severity: PrincipleSeverity;
  checklist_label: string;
  applies_to: string[];
};

export type MemoryLayer = {
  level: "L1" | "L2" | "L3";
  path: string;
  role: string;
  rule: string;
};

export type OperationalContract = {
  version: number;
  source: string;
  principles: OperationalPrinciple[];
  memory_layers: MemoryLayer[];
  prompt_guidance: string[];
  hygiene_checks: string[];
};

export type PrincipleChecklistItem = {
  id: string;
  label: string;
  checked: boolean;
  state?: "checked" | "unchecked" | "pending" | "blocked";
  severity: PrincipleSeverity;
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
  memory_layers: [],
  prompt_guidance: [],
  hygiene_checks: []
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
  return contract.principles.map((principle) => ({
    id: principle.id,
    label: principle.checklist_label,
    checked:
      sourceText.toLowerCase().includes(principle.label.toLowerCase()) &&
      (principle.id !== "memoria_sem_lembranca" || hasMemoryLayers(sourceText)),
    severity: principle.severity
  }));
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
    version: typeof input.version === "number" ? input.version : DEFAULT_CONTRACT.version,
    source: typeof input.source === "string" ? input.source : DEFAULT_CONTRACT.source,
    principles: Array.isArray(input.principles) ? input.principles.filter(isPrinciple) : [],
    memory_layers: Array.isArray(input.memory_layers) ? input.memory_layers.filter(isMemoryLayer) : [],
    prompt_guidance: Array.isArray(input.prompt_guidance) ? input.prompt_guidance.filter((item): item is string => typeof item === "string") : [],
    hygiene_checks: Array.isArray(input.hygiene_checks) ? input.hygiene_checks.filter((item): item is string => typeof item === "string") : []
  };
}

function isPrinciple(value: unknown): value is OperationalPrinciple {
  const candidate = value as OperationalPrinciple;
  return Boolean(
    candidate &&
      typeof candidate.id === "string" &&
      typeof candidate.label === "string" &&
      typeof candidate.summary === "string" &&
      ["info", "warning", "error"].includes(candidate.severity) &&
      typeof candidate.checklist_label === "string" &&
      Array.isArray(candidate.applies_to)
  );
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
