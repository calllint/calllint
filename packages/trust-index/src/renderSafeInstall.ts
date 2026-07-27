// ---------------------------------------------------------------------------
// Phase 2.4 Batch 2 — Human Install renderer + machine Contract sidecar
// (ADR 0056; new14-integration §7). PURE + deterministic.
//
// Two artifacts, both projections of the SAME Batch-1 `SafeInstallProjection`
// (INV-2.4-01 one fact object): the human HTML and the sealed contract JSON. No
// re-scan, no verdict, no writer, no clock, no LLM, and — critically — NO
// decision JS: the page has no <script> and no inline handlers; JS never decides
// (ADR 0056 §7). The visible decision language is the shipped verdict label plus
// the two honest states; every byte passes BOTH forbidden-phrase sets.
//
// Above the fold = exactly six groups, semantic DOM order == visual order (§7):
//   1 identity · 2 disposition · 3 one-sentence consequence · 4 ≤3 authority
//   facts · 5 one primary action · 6 two secondary links.
// Publisher text is quarantined in a labeled block, escaped, and NEVER placed in
// a decision group (INV-2.4-05). Unsupported → an honest EXPLAIN_ONLY page whose
// primary action is "View manual setup", never a fabricated command (INV-2.4-08).
// ---------------------------------------------------------------------------

import type { SafeInstallProjection, Installability } from "./safeInstallProjection.js"
import { CORRECTION_URL, SITE_ORIGIN } from "./renderPage.js"

/** Escape the five HTML-significant characters. Deterministic; no DOM. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * The primary-action href per installability — a DOCUMENTATION anchor, never a
 * command and never a live writer. The CTA takes a human to the honest next step
 * (prepare docs / blockers / pre-flight / manual setup); it never applies config.
 */
const CTA_DOC_HREF: Record<Installability, string> = {
  PREPARE_AVAILABLE: `${SITE_ORIGIN}/docs/safe-install`,
  REVIEW_REQUIRED: `${SITE_ORIGIN}/docs/safe-install#review`,
  BLOCKED: `${SITE_ORIGIN}/docs/safe-install#blocked`,
  LOCAL_PREFLIGHT_REQUIRED: `${SITE_ORIGIN}/docs/safe-install#preflight`,
  UNSUPPORTED: `${SITE_ORIGIN}/docs/safe-install#manual`,
}

/** The clean, non-redirecting Trust Page URL for a projected resource. */
function trustPageUrl(p: SafeInstallProjection): string {
  return `${SITE_ORIGIN}/trust/${p.canonicalName}`
}

/** Group 4 — the ≤3 authority facts, each an observation (never "impossible"). */
function authorityFactsBlock(p: SafeInstallProjection): string {
  const items = p.authorityDecisionFacts
    .map(
      (f) =>
        `        <li data-observed="${f.observed}"><code>${esc(f.authority)}</code>` +
        ` — ${esc(f.consequence)}</li>`,
    )
    .join("\n")
  return `      <section class="install-authority" aria-label="Authority facts">
      <h2>What it can do</h2>
      <ul>
${items}
      </ul>
    </section>`
}

/**
 * The quarantined publisher block (INV-2.4-05). Rendered ONLY here, always under
 * the fixed label, escaped. Absent when the publisher supplied no description, so
 * a page with no publisher text is byte-stable. It carries NO decision meaning.
 */
function publisherBlock(p: SafeInstallProjection): string {
  const desc = p.subject.publisherDescription
  if (desc === null || desc === undefined || desc === "") return ""
  return `      <section class="install-publisher" aria-label="Publisher description">
      <h2>Publisher-provided description — not used for CallLint's safety decision.</h2>
      <p>${esc(desc)}</p>
    </section>`
}

/**
 * Render the human Install page. Deterministic (pure string build; no clock/RNG).
 * The six decision groups appear in semantic DOM order == visual order; the
 * quarantined publisher block, provenance (with both binding digests, so the
 * HTML↔JSON digest-consistency test can verify one fact object), and the boundary
 * framing follow below the fold. No <script>, no inline `on*` handler.
 */
export function renderSafeInstall(p: SafeInstallProjection): string {
  const c = p.agentContract
  const version = p.subject.version
  const identityVersion = version ? ` <code>${esc(version)}</code>` : ""
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Add ${esc(p.displayName)} with CallLint</title>
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${esc(`${SITE_ORIGIN}/install/${p.canonicalSlug}/`)}" />
    <link rel="alternate" type="application/vnd.calllint.agent-adoption+json;version=1" href="./index.json" />
  </head>
  <body>
    <main>
      <section class="install-identity" aria-label="Identity">
        <h1>${esc(p.displayName)}${identityVersion}</h1>
        <p><code>${esc(p.canonicalName)}</code></p>
      </section>
      <section class="install-disposition" aria-label="Disposition">
        <p class="install-headline"><strong>${esc(p.humanDisposition.headline)}</strong></p>
        <p><a class="install-cta" data-primary-action="${p.installability}"
              href="${esc(CTA_DOC_HREF[p.installability])}">${esc(p.humanDisposition.primaryCta)}</a></p>
      </section>
      <section class="install-consequence" aria-label="Consequence">
        <p>${esc(p.consequenceSummary)}</p>
      </section>
${authorityFactsBlock(p)}
      <section class="install-secondary" aria-label="More">
        <p>
          <a href="${esc(trustPageUrl(p))}">View the full Trust Page</a> ·
          <a href="${esc(CORRECTION_URL)}">Report a correction</a>
        </p>
      </section>
${publisherBlock(p)}
      <section class="install-provenance" aria-label="Provenance">
        <h2>Provenance</h2>
        <ul>
          <li>Verdict: <strong>${esc(p.publicObservation.publicLabel)}</strong></li>
          <li>Artifact digest: <code>${esc(c.subject.artifactDigest)}</code></li>
          <li>Contract digest: <code>${esc(c.contract.contractDigest)}</code></li>
        </ul>
        <p>This page is an observation at a specific artifact digest and time under the
           stated completeness. It is not a certification, an endorsement, or a
           guarantee of safety.</p>
      </section>
    </main>
  </body>
</html>
`
}

/**
 * The machine Contract sidecar — the sealed `calllint.agent-adoption-contract.v1`
 * as canonical, stably-keyed JSON (the builder froze key order; indentation is
 * pinned). Byte-identical on a re-project, so the shadow-tree gate holds.
 */
export function renderSafeInstallContract(p: SafeInstallProjection): string {
  return JSON.stringify(p.agentContract, null, 2) + "\n"
}
