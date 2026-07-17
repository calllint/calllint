import type { ApiResponse } from "./types.js"

/**
 * Shared response headers. The API is public, read-only, cacheable, and
 * cross-origin embeddable (ADR 0038 §4). No cookies, no auth, no private data.
 */
export function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "x-content-type-options": "nosniff",
    // Read-only cache posture: CDN caches an hour, browsers 5 min. The Index is
    // curated + slow-moving (ADR 0046 §Consequences); this is not a live scanner.
    "cache-control": "public, max-age=300, s-maxage=3600",
    ...extra,
  }
}

/** A strong ETag from the immutable page digest (ADR 0038 §4: ETag + digest). */
export function etagFor(pageDigest: string): string {
  return `"${pageDigest}"`
}

/** 200 with a JSON body and an ETag; honors conditional GET → 304. */
export function ok(body: unknown, pageDigest: string, ifNoneMatch?: string): ApiResponse {
  const etag = etagFor(pageDigest)
  if (ifNoneMatch && ifNoneMatch === etag) {
    return { status: 304, headers: baseHeaders({ etag }), body: "" }
  }
  return { status: 200, headers: baseHeaders({ etag }), body: JSON.stringify(body, null, 2) + "\n" }
}

/** A uniform JSON error (never leaks internals; ADR 0038 §4: no private data). */
export function err(status: number, code: string, message: string): ApiResponse {
  return {
    status,
    headers: baseHeaders(),
    body: JSON.stringify({ schema: "calllint.partner-api.error.v0", code, message }, null, 2) + "\n",
  }
}

/** Preflight / OPTIONS. */
export function preflight(): ApiResponse {
  return { status: 204, headers: baseHeaders(), body: "" }
}
