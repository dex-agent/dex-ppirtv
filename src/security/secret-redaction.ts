/**
 * Secret redaction — single source of truth (SSOT) for detecting and
 * scrubbing secret-like values across the dex-PPIRTV codebase.
 *
 * Before this module existed, 6+ independent regex implementations were
 * spread across store.ts, diagnostic-bundle.ts, mining-policy.ts and others,
 * with inconsistent coverage. The most dangerous surfaces (ledger, JSON
 * export) used the weakest patterns.
 *
 * Usage: import { scrubSecretLike, SECRET_LIKE_PATTERN, isSecretLikeText }
 * from "../security/secret-redaction.js";
 *
 * Design decisions:
 * - Detection is by CONTENT (regex on string values), not just by key name.
 *   A token `sk-live-abc123` pasted into `goal` or `context` (free-text
 *   fields without SPT validation) is redacted.
 * - Key-name detection is kept as a second layer (defense in depth).
 * - The pattern is intentionally broad, but provider prefixes that are also
 *   common word starts (for example `sk` in `skill`) require a real separator.
 */

// The canonical pattern. Covers:
// - Bearer tokens: `Bearer eyJ...`, `Authorization: Bearer ...`
// - API keys: `sk-...`, `sk_live_...`, `sk-proj-...`, `pk_live_...`
// - GitHub/GitLab PATs: `ghp_...`, `github_pat_...`, `glpat-...`
// - Key=value assignments: `api_key=...`, `token:...`, `password=...`
// - Long hex/base64 strings prefixed by common secret names
export const SECRET_LIKE_PATTERN =
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk[_-](?:live[_-]?|test[_-]?|proj[_-]?|[A-Za-z0-9_-]{12,})[A-Za-z0-9_-]*|\bpk[_-]?live[_-][A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9_]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{20,}|\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*["']?[A-Za-z0-9_~+/=-]{8,}["']?/i;

// Key names that indicate a secret value regardless of content.
export const SECRET_KEY_PATTERN = /secret|token|password|api[_-]?key|authorization|credential|private[_-]?key/i;

/**
 * Returns true if the string value contains a secret-like pattern.
 */
export function isSecretLikeText(value: string): boolean {
  return SECRET_LIKE_PATTERN.test(value);
}

/**
 * Returns true if the key name indicates a secret field.
 */
export function isSecretKeyName(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * Redact a single string value. If it contains a secret-like pattern,
 * replace the entire value with `[redacted]`.
 */
export function scrubSecretLikeText(value: string): string {
  return isSecretLikeText(value) ? "[redacted]" : value;
}

/**
 * Deep-scrub an unknown value (object, array, primitive).
 * Redacts by BOTH content (SECRET_LIKE_PATTERN on string values) AND
 * key name (SECRET_KEY_PATTERN on object keys).
 *
 * This is the canonical scrubber for all persistence and export paths.
 */
export function scrubSecretLike<T>(value: T, redactions?: Set<string>): T {
  if (typeof value === "string") {
    if (isSecretLikeText(value)) {
      redactions?.add("secret-like-value");
      return "[redacted]" as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubSecretLike(item, redactions)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKeyName(key)) {
        redactions?.add(key);
        result[key] = "[redacted]";
      } else {
        result[key] = scrubSecretLike(nested, redactions);
      }
    }
    return result as unknown as T;
  }
  return value;
}
