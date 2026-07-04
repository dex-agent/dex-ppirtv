import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryCandidate } from "../domain.js";

export async function writeMemoryCandidate(candidate: MemoryCandidate): Promise<string[]> {
  const [l1Path, l2Path, ...extraPaths] = candidate.target_files;
  if (!l1Path || !l2Path) {
    return [];
  }
  await appendUniqueBlock(l1Path, candidate.l1_gatilho);
  await appendUniqueBlock(l2Path, candidate.l2_bloco);
  const touched = [l1Path, l2Path];
  for (const filePath of extraPaths) {
    const block = memoryExtraBlock(candidate, filePath);
    if (!block) {
      continue;
    }
    await appendUniqueBlock(filePath, block);
    touched.push(filePath);
  }
  return touched;
}

function memoryExtraBlock(candidate: MemoryCandidate, filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.endsWith("/conhecimento/index.md")) {
    return candidate.l3_index_entry ?? null;
  }
  if (normalized.includes("/conhecimento/")) {
    return candidate.l3_bloco ?? null;
  }
  return null;
}

async function appendUniqueBlock(filePath: string, block: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    existing = "";
  }
  if (existing.includes(block.trim())) {
    return;
  }
  const prefix = existing.trim().length > 0 ? "\n\n" : "";
  await appendFile(filePath, `${prefix}${block.trim()}\n`, "utf8");
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}
