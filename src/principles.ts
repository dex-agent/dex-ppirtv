import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
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
  severity: PrincipleSeverity;
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
  const filePath = contractPath(root);
  if (!existsSync(filePath)) {
    return DEFAULT_CONTRACT;
  }
  return normalizeContract(JSON.parse(await readFile(filePath, "utf8")));
}

export function loadOperationalContractSync(root = process.cwd()): OperationalContract {
  const filePath = contractPath(root);
  if (!existsSync(filePath)) {
    return DEFAULT_CONTRACT;
  }
  return normalizeContract(JSON.parse(readFileSync(filePath, "utf8")));
}

export async function principleChecklist(root = process.cwd()): Promise<PrincipleChecklistItem[]> {
  const contract = await loadOperationalContract(root);
  const sourceText = await readSourceText(root, contract.source);
  return checklistFromContract(contract, sourceText);
}

export function principleChecklistSync(root = process.cwd()): PrincipleChecklistItem[] {
  const contract = loadOperationalContractSync(root);
  const sourcePath = path.join(root, contract.source);
  const sourceText = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : "";
  return checklistFromContract(contract, sourceText);
}

export async function scanOperationalPrinciples(root = process.cwd()): Promise<HygieneFinding[]> {
  const contract = await loadOperationalContract(root);
  const findings: HygieneFinding[] = [];
  const sourcePath = path.join(root, contract.source);
  const sourceText = existsSync(sourcePath) ? await readFile(sourcePath, "utf8") : "";

  if (!existsSync(sourcePath)) {
    findings.push({
      id: "principles:source_missing",
      severity: "warning",
      category: "principles",
      message: "Arquivo fonte de principios nao encontrado.",
      evidence: [contract.source],
      action: "Criar principles/PRINCIPLES.md ou ajustar source no contrato operacional."
    });
  }

  if (sourceText && !/operational-contract\.json/i.test(sourceText)) {
    findings.push({
      id: "principles:contract_not_linked",
      severity: "info",
      category: "principles",
      message: "PRINCIPLES.md nao aponta claramente para o contrato operacional editavel.",
      evidence: [contract.source],
      action: "Adicionar link para principles/operational-contract.json."
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

function contractPath(root: string): string {
  return path.join(root, "principles", "operational-contract.json");
}

async function readSourceText(root: string, source: string): Promise<string> {
  const sourcePath = path.join(root, source);
  return existsSync(sourcePath) ? readFile(sourcePath, "utf8") : "";
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
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name === ".env" || /\.(toml|json|yaml|yml)$/i.test(name))
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
