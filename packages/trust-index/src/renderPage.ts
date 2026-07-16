/**
 * Render a baked Trust Page to its two on-disk artifacts (ADR 0046 §2/§4):
 *   • a JSON sidecar  — the machine-readable page content, digest-addressed
 *   • an HTML page    — the human-readable view
 *
 * Both are DETERMINISTIC (pure string building over the baked content; no clock, no
 * RNG) so a re-bake is byte-identical and the CI reproducibility diff-gate holds.
 *
 * Language boundary (ADR 0038 §2 — non-negotiable): a page states a verdict
 * "observed at digest D at time T" under stated completeness. It NEVER says
 * "certified safe", "verified safe", "CallLint approved", or "guaranteed". We reuse
 * the shipped `VERDICT_PUBLIC_LABEL` ("No blockers observed", "Review required",
 * "Blocked by policy", "Insufficient evidence") which is already boundary-safe, and
 * `check-public-copy.mjs` is extended (I1b) to enforce the forbidden set over these
 * generated pages. Every page is reproducible, sourced, completeness-stated,
 * timestamped, correction-linked, and PII-free (ADR 0038 §5).
 */
import type { Verdict } from "@calllint/types"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import type { BakedTrustPage } from "./bakeTrustPage.js"

/** Where a viewer disputes or corrects a page (ADR 0038 §5 correction link). */
export const CORRECTION_URL =
  "https://github.com/calllint/calllint/issues/new?labels=trust-page-correction"

/** Escape the five HTML-significant characters. Deterministic; no DOM. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** The stable relative path a page is stored/served at (digest-addressed). */
export function pagePath(page: BakedTrustPage): string {
  return `trust/${page.canonicalName}`
}

/**
 * The JSON sidecar — the canonical machine-readable artifact. Key order is fixed
 * (object literal order is preserved by JSON.stringify) and indentation is pinned,
 * so the bytes are stable. This is what the I2 read-only API will serve verbatim.
 */
export function renderSidecar(page: BakedTrustPage): string {
  const sidecar = {
    schema: "calllint.trust-page.v0",
    canonicalName: page.canonicalName,
    artifactDigest: page.artifactDigest,
    pageDigest: page.pageDigest,
    verdict: page.verdict,
    verdictLabel: VERDICT_PUBLIC_LABEL[page.verdict],
    observedAt: page.observedAt,
    completeness: page.preparation.authority?.completeness ?? "partial",
    correctionUrl: CORRECTION_URL,
    preparation: page.preparation,
    scan: page.scan,
  }
  return JSON.stringify(sidecar, null, 2) + "\n"
}

/** One-line, boundary-safe statement of what the page asserts. */
export function observedStatement(verdict: Verdict, page: BakedTrustPage): string {
  return (
    `${VERDICT_PUBLIC_LABEL[verdict]} — observed at ${page.artifactDigest} ` +
    `at ${page.observedAt}`
  )
}

/**
 * The human-readable HTML. Minimal, dependency-free, and deterministic. Uses only
 * boundary-safe language; the completeness and "observed at digest" framing make it
 * clear this is a point-in-time observation, never a safety guarantee.
 */
export function renderHtml(page: BakedTrustPage): string {
  const completeness = page.preparation.authority?.completeness ?? "partial"
  const caps = page.preparation.authority?.capabilities ?? []
  const notes = page.preparation.notes ?? []

  const capItems =
    caps.length === 0
      ? "<li>No elevated capabilities observed.</li>"
      : caps
          .map(
            (c) =>
              `<li><code>${esc(c.action)}</code> on <code>${esc(c.resource)}</code>` +
              `${c.pattern ? ` — ${esc(c.pattern)}` : ""}</li>`,
          )
          .join("\n        ")

  const noteItems = notes.map((n) => `<li>${esc(n)}</li>`).join("\n        ")

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(page.canonicalName)} — CallLint Trust Page</title>
    <meta name="robots" content="index,follow" />
  </head>
  <body>
    <main>
      <h1>${esc(page.canonicalName)}</h1>
      <p><strong>${esc(VERDICT_PUBLIC_LABEL[page.verdict])}</strong></p>
      <p>Observed at artifact digest <code>${esc(page.artifactDigest)}</code>
         at <time datetime="${esc(page.observedAt)}">${esc(page.observedAt)}</time>.
         Completeness: <strong>${esc(completeness)}</strong>.</p>
      <p>This is an observation at a specific artifact digest and time under the
         stated completeness. It is not a certification, an endorsement, or a
         guarantee of safety.</p>

      <h2>Observed capabilities</h2>
      <ul>
        ${capItems}
      </ul>

      <h2>Notes</h2>
      <ul>
        ${noteItems || "<li>None.</li>"}
      </ul>

      <h2>Provenance</h2>
      <ul>
        <li>Source: <code>${esc(page.preparation.artifact.source)}</code>
            (${esc(page.preparation.artifact.sourceType)})</li>
        <li>Page digest: <code>${esc(page.pageDigest)}</code></li>
        <li>Preparation state: <code>${esc(page.preparation.state)}</code></li>
        <li><a href="${esc(CORRECTION_URL)}">Report a correction or dispute</a></li>
      </ul>
    </main>
  </body>
</html>
`
}
