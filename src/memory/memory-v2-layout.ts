import { readdir } from "node:fs/promises";

export type CanonicalV2Route = {
  relativePath: string;
  layer: "L2" | "L3";
  slug: string;
};

export type CanonicalV2RouteInspection = {
  routes: CanonicalV2Route[];
  rejectedHrefs: string[];
};

export type V2UnitMetadata = {
  layer: "L2" | "L3";
  slug: string;
  ownerSkill?: string;
};

const L2_ROUTE = /^memorias\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const L3_ROUTE = /^conhecimento\/([a-z0-9]+(?:-[a-z0-9]+)*)\/README\.md$/;

export function selectPhysicalCaseEquivalent(entries: string[], expectedName: string): string | null {
  const matches = entries.filter((entry) => entry.toLowerCase() === expectedName.toLowerCase());
  if (matches.length > 1) throw new Error("MEMORY_CASE_EQUIVALENT_AMBIGUOUS");
  return matches[0] ?? null;
}

export function selectExactPortableName(entries: string[], expectedName: string): string | null {
  const matches = entries.filter((entry) => entry.toLowerCase() === expectedName.toLowerCase());
  if (matches.length > 1) throw new Error("MEMORY_CASE_EQUIVALENT_AMBIGUOUS");
  if (matches.length === 1 && matches[0] !== expectedName) throw new Error("MEMORY_CASE_EQUIVALENT_NONCANONICAL");
  return matches[0] ?? null;
}

export async function resolvePhysicalCaseEquivalent(directory: string, expectedName: string): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true });
  return selectPhysicalCaseEquivalent(entries.filter((entry) => entry.isFile()).map((entry) => entry.name), expectedName);
}

export function inspectCanonicalV2Routes(markdownLine: string): CanonicalV2RouteInspection {
  const routes = new Map<string, CanonicalV2Route>();
  const rejectedHrefs: string[] = [];
  const arrow = markdownLine.match(/^\s*[-*]\s+.+?\s+->\s+([\s\S]+)$/);
  if (!arrow) return { routes: [], rejectedHrefs };
  for (const match of arrow[1]!.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = match[1]!;
    const route = canonicalV2Route(href);
    if (route) {
      routes.set(`${route.layer}:${route.relativePath}`, route);
    } else if (looksLikeV2RouteCandidate(href)) {
      rejectedHrefs.push(href);
    }
  }
  return { routes: [...routes.values()], rejectedHrefs };
}

function looksLikeV2RouteCandidate(href: string): boolean {
  if (/(?:^|[\\/])memorias[\\/]/i.test(href)) return true;
  const knowledge = href.match(/(?:^|[\\/])conhecimento[\\/]([\s\S]*)/i);
  return /[\\/]/.test(knowledge?.[1] ?? "");
}

export function canonicalV2Route(href: string): CanonicalV2Route | null {
  if (!href || href.includes("?") || href.includes("#") || href.includes("\\") || href.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const l2 = href.match(L2_ROUTE);
  if (l2) return { relativePath: href, layer: "L2", slug: l2[1]! };
  const l3 = href.match(L3_ROUTE);
  if (l3) return { relativePath: href, layer: "L3", slug: l3[1]! };
  return null;
}

export function parseV2UnitMetadata(text: string): V2UnitMetadata | null {
  const frontMatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontMatter) return null;
  const fields = new Map<string, string>();
  for (const line of frontMatter[1]!.split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
    if (match) {
      if (fields.has(match[1]!)) return null;
      fields.set(match[1]!, match[2]!.replace(/^['"]|['"]$/g, ""));
    }
  }
  if (fields.get("implementation_version") !== "v2") return null;
  const layer = fields.get("layer");
  const slug = fields.get("slug");
  if ((layer !== "L2" && layer !== "L3") || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const ownerSkill = fields.get("owner_skill")?.trim();
  return { layer, slug, ...(ownerSkill ? { ownerSkill } : {}) };
}

export function declaresV2Unit(text: string): boolean {
  const frontMatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontMatter) return false;
  return frontMatter[1]!.split(/\r?\n/).some((line) => {
    const match = line.match(/^implementation_version:\s*(.*?)\s*$/);
    return match?.[1]?.replace(/^['"]|['"]$/g, "") === "v2";
  });
}
