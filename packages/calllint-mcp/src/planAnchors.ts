/**
 * Session-scoped plan time anchors (ADR 0056 §12.3).
 *
 * `prepare` and `apply` are two separate MCP tool calls, and the caller hands back
 * only an `approvalDigest` — there is no plan file to replay. But a plan's validity
 * window (`expiresAt`) is SEALED into its `planDigest`, so apply can only reproduce
 * the digest the caller approved if it reuses the SAME window prepare computed.
 *
 * The original code met that by pinning the whole server to one clock: `expiresAt`
 * was `serverStart + 1h` and apply passed `now = serverStart`, so the shipped
 * engine's staleness guard (`now > expiresAt`) could never fire — a plan stayed
 * applyable for the entire life of the server, however long that was. This store
 * fixes that: prepare anchors the window to the REAL clock and remembers it here,
 * apply inherits it to reproduce the digest, and the engine then checks that window
 * against the REAL clock, so an expired plan is refused.
 *
 * The anchor is a timestamp, not an authority: inheriting it decides nothing. Every
 * safety fact (contract, host config, policy, local verdict) is still recomputed
 * from live inputs on apply, and the approval gate still requires the recomputed
 * digest to equal the digest the caller named.
 *
 * In-memory and per-process on purpose — a stdio server is one session, and an
 * anchor MUST NOT outlive it (that would let a plan be replayed across restarts,
 * reintroducing the unbounded window this exists to close).
 */

/** Bound the store so a long-lived session cannot grow it without limit. */
const MAX_ANCHORS = 64

/** planDigest → the ISO `expiresAt` that digest was sealed with. */
const anchors = new Map<string, string>()

/** Remember the window a prepared plan was sealed with, keyed by its digest. */
export function rememberPlanAnchor(planDigest: string, expiresAt: string): void {
  // Re-inserting refreshes recency, so the eviction order stays true.
  anchors.delete(planDigest)
  anchors.set(planDigest, expiresAt)
  while (anchors.size > MAX_ANCHORS) {
    const oldest = anchors.keys().next().value
    if (oldest === undefined) break
    anchors.delete(oldest)
  }
}

/** The window `planDigest` was sealed with, or null if this session never prepared it. */
export function recallPlanAnchor(planDigest: string): string | null {
  return anchors.get(planDigest) ?? null
}

/** Test seam only: drop all anchors so cases cannot leak into each other. */
export function resetPlanAnchors(): void {
  anchors.clear()
}
