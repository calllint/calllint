/**
 * Phase 2.5-B — the first-party trust-event sink (functions/v1/events/trust.ts).
 *
 * The CF Pages function is not covered by `tsc` (tsconfig excludes the functions dir,
 * exactly like the existing apps/web/test suite) — so, like embed.test.ts, this runs
 * under vitest against the real module. It proves the behaviors ADR 0055 §2 freezes:
 * POST-only, 204 on EVERY outcome (fail-open UX), and — the security-critical one —
 * the coarse `page` dimension is hashed SERVER-SIDE into a sha256 bucket with the raw
 * path (incl. any query/fragment) discarded before anything is storable.
 *
 * Ships DARK: the route is not in _routes.json, so it is unreachable in prod; this
 * test exercises the handler in-process, it does not wire a live sink.
 */
import { describe, it, expect } from "vitest"
import { onRequest, processTrustEvent, hashPage } from "../functions/v1/events/trust.js"
import { TRUST_EVENT_VERSION, PAGE_BUCKET_RE } from "@calllint/trust-event-contract"

const NOW = "2026-07-24T12:00:00.000Z"
const post = (body: unknown) =>
  new Request("https://calllint.com/v1/events/trust", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
const ctx = (request: Request) => ({ request, env: {} })

describe("onRequest — POST-only, 204 on every outcome", () => {
  it("rejects a non-POST with 405 + Allow: POST (write sink, not readable)", async () => {
    const res = await onRequest(ctx(new Request("https://calllint.com/v1/events/trust", { method: "GET" })))
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })

  it("answers 204 with no body for a VALID event", async () => {
    const res = await onRequest(ctx(post({ schema: TRUST_EVENT_VERSION, event: "trust_page_viewed" })))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe("")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("answers 204 for an INVALID event (dropped — client never learns it failed)", async () => {
    const res = await onRequest(ctx(post({ schema: TRUST_EVENT_VERSION, event: "not-in-vocab" })))
    expect(res.status).toBe(204)
  })

  it("answers 204 for a malformed (non-JSON) body", async () => {
    const res = await onRequest(ctx(post("}{ not json")))
    expect(res.status).toBe(204)
  })
})

describe("hashPage — server-side sha256 of a coarse identifier", () => {
  it("returns the sha256:<64hex> shape the contract expects", async () => {
    const h = await hashPage("/trust/x.html")
    expect(h).toMatch(PAGE_BUCKET_RE)
  })
  it("strips query + fragment before hashing (raw path never influences the bucket)", async () => {
    expect(await hashPage("/trust/x.html?token=secret#frag")).toBe(await hashPage("/trust/x.html"))
  })
  it("is deterministic and path-sensitive", async () => {
    expect(await hashPage("/trust/a")).toBe(await hashPage("/trust/a"))
    expect(await hashPage("/trust/a")).not.toBe(await hashPage("/trust/b"))
  })
  it("returns undefined when there is nothing to hash", async () => {
    expect(await hashPage(null)).toBeUndefined()
    expect(await hashPage("")).toBeUndefined()
  })
})

describe("processTrustEvent — raw page hashed server-side, never stored raw", () => {
  it("substitutes a server-hashed pageBucket and NEVER carries the raw page", async () => {
    const rec = await processTrustEvent(
      { schema: TRUST_EVENT_VERSION, event: "trust_page_to_install", page: "/trust/x.html?token=secret#f" },
      NOW,
    )
    expect(rec).not.toBeNull()
    expect(rec!.pageBucket).toMatch(PAGE_BUCKET_RE)
    // The stored record contains no raw path and no leaked query token.
    expect(rec).not.toHaveProperty("page")
    const asJson = JSON.stringify(rec)
    expect(asJson).not.toContain("secret")
    expect(asJson).not.toContain("/trust/x.html")
    // The bucket is exactly the hash of the COARSENED path (query/fragment gone).
    expect(rec!.pageBucket).toBe(await hashPage("/trust/x.html"))
  })

  it("produces a closed record (schema/event/ts) with no bucket when no page is sent", async () => {
    const rec = await processTrustEvent({ schema: TRUST_EVENT_VERSION, event: "app_created_viewed" }, NOW)
    expect(rec).toEqual({ schema: TRUST_EVENT_VERSION, event: "app_created_viewed", ts: NOW })
    expect(rec).not.toHaveProperty("pageBucket")
  })

  it("drops (null) an off-vocabulary event and a wrong wire tag", async () => {
    expect(await processTrustEvent({ schema: TRUST_EVENT_VERSION, event: "surprise" }, NOW)).toBeNull()
    expect(await processTrustEvent({ schema: "calllint.telemetry-event", event: "trust_page_viewed" }, NOW)).toBeNull()
  })

  it("discards any extra client field (only schema/event/pageBucket are forwarded to the sanitizer)", async () => {
    const rec = await processTrustEvent(
      { schema: TRUST_EVENT_VERSION, event: "claim_cta_clicked", email: "a@b.com", extra: 1 },
      NOW,
    )
    expect(rec).toEqual({ schema: TRUST_EVENT_VERSION, event: "claim_cta_clicked", ts: NOW })
  })
})
