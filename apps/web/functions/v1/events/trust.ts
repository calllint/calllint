/**
 * Cloudflare Pages function — the first-party trust-event sink (new13 §Phase-2.5-B;
 * ADR 0055 §2). Mirrors the sole existing adapter functions/v1/public/[[path]].ts
 * in style: a named `onRequest`, local `Env`/`Ctx` interfaces (no `PagesFunction`
 * ambient type), `new URL(request.url)`, and plain `Response`.
 *
 * Privacy posture (ADR 0055 §2), enforced here + in @calllint/trust-event-contract:
 *   • first-party only — no third-party vendor, no external beacon;
 *   • PII-free, cookie-free, no localStorage (the client shim never sets any);
 *   • server-side hashing of the one coarse dimension — the raw page path is
 *     hashed HERE (Web Crypto) into `pageBucket` and the raw value is discarded
 *     before the payload ever reaches the sanitizer, so a raw path is structurally
 *     unstorable;
 *   • `204 No Content` on EVERY outcome — the client never learns whether the write
 *     was valid (fail-open for UX); an invalid/oversized/off-contract event is
 *     dropped and never stored (fail-closed for writes);
 *   • no LLM anywhere on the path.
 *
 * Scanner-free by construction (ADR 0038 §3): it imports ONLY
 * @calllint/trust-event-contract, a zero-runtime-dep definition+sanitizer package.
 *
 * SHIPS DARK this round: `apps/web/public/_routes.json` is deliberately NOT
 * extended (its `include` stays `["/v1/public/*"]`), so `/v1/events/trust` is not
 * routed to a Function in production — this handler is unreachable until a separate,
 * explicit go-live step flips `_routes.json` and (per ADR 0055 §2) opens a follow-on
 * ADR for the Analytics-Engine binding. There is NO live sink wired here yet.
 */
import { sanitizeTrustEvent, type SanitizedTrustEvent } from "@calllint/trust-event-contract"

/** No bindings needed while dark: the sink (Analytics Engine) is a later go-live step. */
interface Env {}
interface Ctx {
  request: Request
  env: Env
}

/** 204 with no body — the single response for every outcome (valid or dropped). */
function noContent(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      // Same-origin POST beacon: no CORS, no cache, no sniff.
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  })
}

/** sha256 over a coarse page identifier, computed SERVER-SIDE (ADR 0055 §2). Returns
 *  the `sha256:…` shape the contract expects, or undefined when there is nothing to
 *  hash. Never stores or logs the raw input. Exported so the route test can prove the
 *  hashing happens and the raw path (query/fragment) never survives — the CF runtime
 *  only ever invokes `onRequest`, so the extra named export is inert in production. */
export async function hashPage(raw: string | null): Promise<string | undefined> {
  if (!raw) return undefined
  // Coarsen first: path only, no query/fragment, capped — a raw path never leaves.
  const coarse = raw.split(/[?#]/)[0]!.slice(0, 256)
  if (!coarse) return undefined
  const bytes = new TextEncoder().encode(coarse)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `sha256:${hex}`
}

/**
 * The pure core: take a parsed request body + a server clock, hash the coarse page
 * dimension SERVER-SIDE, strip the raw `page` (a forbidden field), and return the
 * closed record that WOULD be stored (or null when the event is dropped). No I/O, no
 * Response — factored out of `onRequest` so a test can prove the raw path never
 * survives and the bucket is a server-side sha256, without a live sink. `onRequest`
 * calls this and then always answers 204 regardless of the result.
 */
export async function processTrustEvent(body: unknown, now: string): Promise<SanitizedTrustEvent | null> {
  // Server-side hash of the coarse page dimension (from the payload's `page`, which
  // the contract forbids as a stored field — it exists only to be hashed here).
  const rawPage = typeof (body as { page?: unknown })?.page === "string" ? (body as { page: string }).page : null
  const pageBucket = await hashPage(rawPage)

  // Rebuild the sanitizer input WITHOUT the raw `page` (a forbidden field): pass
  // only the wire tag, the event name, and the server-hashed bucket. Anything else
  // the client sent is discarded before sanitization.
  const event = typeof (body as { event?: unknown })?.event === "string" ? (body as { event: string }).event : undefined
  const schema = (body as { schema?: unknown })?.schema

  return sanitizeTrustEvent(pageBucket ? { schema, event, pageBucket } : { schema, event }, now)
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const { request } = context

  // POST-only. Every non-POST (incl. GET/OPTIONS) gets 405 — this is a write sink,
  // not a readable resource.
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST", "x-content-type-options": "nosniff" } })
  }

  // Parse defensively — a malformed body is a drop, but STILL a 204 (fail-open UX).
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return noContent()
  }

  const sanitized = await processTrustEvent(body, new Date().toISOString())

  // On a valid event: this round has NO live sink, so we simply drop it (the seam
  // is dark). When the Analytics-Engine binding is enabled (a later 🌐 step), the
  // write happens HERE, guarded by `sanitized !== null`. Either way → 204.
  void sanitized
  return noContent()
}
