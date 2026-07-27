/**
 * Phase 2.5-B — the client funnel shim (public/embed/trust-events.js).
 *
 * Mirrors embed.test.ts: import the SERVED file directly (the CDN bytes ARE the
 * unit under test, so there is nothing to drift), unit-test its pure helpers, and
 * grep the source for the privacy/scanner-boundary invariants ADR 0055 §2 freezes.
 * The anti-drift block ties the inlined wire tag + vocabulary to the shipping
 * @calllint/trust-event-contract, so the shim and the contract can never diverge.
 *
 * Ships DARK this round: this test proves the shim is correct + safe; no page
 * references it and /v1/events/trust is not in _routes.json.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
// The served bytes are the unit under test — same convention as embed.test.ts.
import * as shim from "../public/embed/trust-events.js"
import { TRUST_EVENT_VERSION, TRUST_EVENTS as CONTRACT_EVENTS } from "@calllint/trust-event-contract"

const jsPath = fileURLToPath(new URL("../public/embed/trust-events.js", import.meta.url))
const src = readFileSync(jsPath, "utf8")

describe("buildPayload — pure, fail-closed", () => {
  it("builds a closed payload with the coarse page for a valid event", () => {
    expect(shim.buildPayload("trust_page_viewed", "/trust/x.html")).toEqual({
      schema: shim.TRUST_EVENT_SCHEMA,
      event: "trust_page_viewed",
      page: "/trust/x.html",
    })
  })
  it("strips query + fragment from the page before it can leave the browser", () => {
    const p = shim.buildPayload("claim_cta_clicked", "/trust/x.html?token=secret#frag")
    expect(p.page).toBe("/trust/x.html")
    expect(JSON.stringify(p)).not.toContain("secret")
  })
  it("caps the coarse path length", () => {
    const p = shim.buildPayload("app_created_viewed", "/" + "a".repeat(1000))
    expect(p.page.length).toBe(256)
  })
  it("omits page entirely when there is none", () => {
    const p = shim.buildPayload("trust_page_viewed", "")
    expect(p).toEqual({ schema: shim.TRUST_EVENT_SCHEMA, event: "trust_page_viewed" })
    expect(p).not.toHaveProperty("page")
  })
  it("returns null for an off-vocabulary event (a typo is never sent)", () => {
    expect(shim.buildPayload("surprise", "/trust/")).toBeNull()
    expect(shim.buildPayload("", "/trust/")).toBeNull()
  })
})

describe("sendTrustEvent — never throws, sends only closed events", () => {
  it("returns false for an off-vocabulary event (nothing dispatched)", () => {
    expect(shim.sendTrustEvent("nope", { page: "/trust/" })).toBe(false)
  })
  it("dispatches a valid event via sendBeacon and posts the closed payload", () => {
    const calls = []
    const g = globalThis as { navigator?: unknown }
    const prev = g.navigator
    g.navigator = { sendBeacon: (url: string, body: string) => (calls.push({ url, body }), true) }
    try {
      expect(shim.sendTrustEvent("trust_page_to_install", { page: "/trust/x.html?q=1" })).toBe(true)
    } finally {
      if (prev === undefined) delete g.navigator
      else g.navigator = prev
    }
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe(shim.EVENTS_PATH)
    const sent = JSON.parse(calls[0].body)
    expect(sent).toEqual({ schema: shim.TRUST_EVENT_SCHEMA, event: "trust_page_to_install", page: "/trust/x.html" })
    expect(calls[0].body).not.toContain("q=1") // query stripped before send
  })
  it("returns false when no transport is available (no beacon, no fetch)", () => {
    const g = globalThis as { navigator?: unknown; fetch?: unknown }
    const pNav = g.navigator
    const pFetch = g.fetch
    delete g.navigator
    delete g.fetch
    try {
      expect(shim.sendTrustEvent("trust_page_viewed", { page: "/trust/" })).toBe(false)
    } finally {
      if (pNav !== undefined) g.navigator = pNav
      if (pFetch !== undefined) g.fetch = pFetch
    }
  })
})

describe("served-file invariants (ADR 0055 §2)", () => {
  it("is import-free (no bare import — the embed no-import guard)", () => {
    expect(src).not.toMatch(/\bimport\s.+\sfrom\b/)
  })
  it("imports no scanner package (scanner-free serving surface, ADR 0038 §3)", () => {
    const scanners = [
      "@calllint/core",
      "@calllint/static-analyzer",
      "@calllint/resolver",
      "@calllint/risk-engine",
      "@calllint/flow-analyzer",
      "@calllint/online",
      "@calllint/trust-index",
      "@calllint/partner-api",
    ]
    for (const s of scanners) expect(src, s).not.toContain(s)
  })
  it("writes no cookie and no web-storage (PII/cookie-free by construction)", () => {
    expect(src).not.toContain("localStorage")
    expect(src).not.toContain("sessionStorage")
    expect(src).not.toContain("document.cookie")
    expect(src).not.toMatch(/\.setItem\s*\(/)
  })
  it("targets only the first-party same-origin sink (no absolute/vendor URL)", () => {
    expect(src).toContain('"/v1/events/trust"')
    expect(src).not.toMatch(/https?:\/\//) // no external beacon endpoint anywhere
  })
})

describe("no drift between shim and @calllint/trust-event-contract", () => {
  it("the shim's inlined wire tag equals the contract's TRUST_EVENT_VERSION", () => {
    expect(shim.TRUST_EVENT_SCHEMA).toBe(TRUST_EVENT_VERSION)
  })
  it("the shim's vocabulary set-equals the contract's TRUST_EVENTS", () => {
    expect(new Set(shim.TRUST_EVENTS)).toEqual(new Set(CONTRACT_EVENTS))
  })
})
