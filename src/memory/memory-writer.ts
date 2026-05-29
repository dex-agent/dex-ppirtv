import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryCandidate } from "../domain.js";

export async function writeMemoryCandidate(candidate: MemoryCandidate): Promise<string[]> {
  const [l1Path, l2Path] = candidate.target_files;
  if (!l1Path || !l2Path) {
    return [];
  }
  await appendUniqueBlock(l1Path, candidate.l1_gatilho);
  await appendUniqueBlock(l2Path, candidate.l2_bloco);
  return [l1Path, l2Path];
}

async function appendUniqueBlock(filePath: string, block: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    existing = "";
  }
  if (existing.includes(block.trim())) {
    return;
  }
  const prefix = existing.trim().length > 0 ? "\n\n" : "";
  await appendFile(filePath, `${prefix}${block.trim()}\n`, "utf8");
}
