import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const receipt = JSON.parse(readFileSync(path.join(root, "CAPACITY.receipt.json"), "utf8"));

function markdownCapabilities() {
  const content = readFileSync(path.join(root, "CAPACITY.md"), "utf8");
  return content
    .split(/\r?\n/)
    .filter((line) => /^\|\s*CAP-\d+\s*\|/.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4)
    .map((cells) => ({ id: cells[1], state: cells[3].replace(/\*/g, "").trim() }));
}

describe("capacity receipt consistency", () => {
  it("keeps the canonical receipt complete and aligned with the human matrix", () => {
    expect(receipt.schema).toBe("dex.capacity.snapshot.v1");
    expect(receipt.capabilities.length).toBeGreaterThanOrEqual(34);
    const ids = new Set<string>();
    for (const capability of receipt.capabilities) {
      expect(capability.id).toMatch(/^CAP-\d+$/);
      expect(ids.has(capability.id)).toBe(false);
      ids.add(capability.id);
      for (const field of ["capability", "owner", "consumer", "trigger", "behavior", "oracle"]) {
        expect(typeof capability[field]).toBe("string");
        expect(capability[field].trim().length).toBeGreaterThan(0);
      }
      expect(Array.isArray(capability.evidence)).toBe(true);
      expect(capability.evidence.length).toBeGreaterThan(0);
      expect(Array.isArray(capability.limits)).toBe(true);
    }
    const human = markdownCapabilities();
    expect(human.map((item) => item.id).sort()).toEqual([...ids].sort());
    for (const item of human) {
      const canonical = receipt.capabilities.find((capability: { id: string }) => capability.id === item.id);
      expect(canonical?.state).toBe(item.state);
    }
  });
});
