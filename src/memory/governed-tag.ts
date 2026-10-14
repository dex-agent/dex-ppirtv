// Single source for the governed nested tag contract (#tema/assunto, at least
// one "/" segment, lowercase slugs). Every producer-facing boundary — MCP zod
// schemas, flow-engine validation and the Dex Memoria V2 adapter — must consume
// this pattern so a malformed tag is rejected identically everywhere.
// Duplicated inline copies of the regex drift silently and split the contract.
export const GOVERNED_TAG_PATTERN = /^#[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

export function isGovernedTag(value: string): boolean {
  return GOVERNED_TAG_PATTERN.test(value);
}

// Owners the validation decision together with the pattern: consumers pass
// their boundary's failure message so error codes stay stable while the
// policy (what a governed tag IS) lives only here.
export function assertGovernedTag(tag: string, failureMessage: string): void {
  if (!GOVERNED_TAG_PATTERN.test(tag)) {
    throw new Error(failureMessage);
  }
}
