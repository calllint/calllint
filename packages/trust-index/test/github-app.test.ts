/**
 * I2c setup guard — the GitHub App manifest stays least-privilege (ADR 0048 §3).
 *
 * Creating the App is human-gated, but the *manifest* is committed, so its scope is
 * reviewable and testable. This asserts the App can only ever be created asking for
 * `metadata: read` and the two installation events — no code/contents/write/PII scope
 * can slip in — and that the one-click helper's inlined copy matches the JSON source
 * of truth (they must never drift).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, "..", "github-app")
const manifest = JSON.parse(readFileSync(resolve(appDir, "app-manifest.json"), "utf8"))
const helperHtml = readFileSync(resolve(appDir, "create-app.html"), "utf8")

describe("GitHub App manifest — least privilege (ADR 0048 §3)", () => {
  it("requests ONLY metadata:read — no other permission", () => {
    expect(manifest.default_permissions).toEqual({ metadata: "read" })
  })

  it("declares NO default_events — installation lifecycle events are auto-delivered", () => {
    // `installation` / `installation_repositories` are lifecycle events GitHub pushes
    // to every App; they are NOT subscribable and are rejected in default_events when
    // no gating permission backs them. Phase I polls installations anyway (§4), so the
    // manifest declares no event subscriptions at all.
    expect(manifest.default_events).toBeUndefined()
  })

  it("carries no write/code/contents/PII-bearing permission", () => {
    const forbidden = ["contents", "administration", "actions", "secrets", "issues", "pull_requests", "members", "emails", "checks", "deployments"]
    for (const k of forbidden) expect(manifest.default_permissions, k).not.toHaveProperty(k)
    // Every declared permission value must be read-only.
    for (const v of Object.values(manifest.default_permissions)) expect(v).toBe("read")
  })

  it("keeps the Phase I webhook inactive (batch poll reconciles — §4)", () => {
    expect(manifest.hook_attributes.active).toBe(false)
  })

  it("the one-click helper inlines a manifest byte-equal to the JSON source of truth", () => {
    // Extract the MANIFEST literal from the helper and compare structurally.
    const m = helperHtml.match(/const MANIFEST = (\{[\s\S]*?\n {6}\})/)
    expect(m, "MANIFEST literal not found in create-app.html").toBeTruthy()
    // eslint-disable-next-line no-new-func
    const inlined = new Function(`return (${m![1]})`)()
    expect(inlined).toEqual(manifest)
  })
})
