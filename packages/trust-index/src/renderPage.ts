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
import type { VerifiedPublisher } from "./claim.js"
import { evidenceLevel, EVIDENCE_LEVEL_META } from "./evidenceLevel.js"
import { reproductionCommand, scanHistory } from "./pageProjections.js"

/** Where a viewer disputes or corrects a page (ADR 0038 §5 correction link). */
export const CORRECTION_URL =
  "https://github.com/calllint/calllint/issues/new?labels=trust-page-correction"

/**
 * The public origin the Trust Pages are served from (ADR 0046 §4 decision 4,
 * same-origin `calllint.com`). Single source of truth for absolute URLs the bake
 * emits — the JSON-LD `url`/`@id` here and the sitemap `<loc>` entries. No trailing
 * slash; callers append the clean path.
 */
export const SITE_ORIGIN = "https://calllint.com"

/**
 * The clean (extensionless) public URL a page is served at. The `.html` artifact
 * 308-redirects to this form at the edge, so this is the canonical, non-redirecting
 * address — the only form that belongs in `<link rel="canonical">` and in the
 * sitemap (a sitemap must list final URLs, never redirects).
 */
export function pageUrl(page: BakedTrustPage): string {
  return `${SITE_ORIGIN}/trust/${page.canonicalName}`
}

/**
 * A deterministic, boundary-safe JSON-LD block for a Trust Page (discovery only).
 *
 * Purpose is SEO discovery (Q5: maintainers can't find their page) — nothing more.
 * It is a pure projection of already-public page facts, so it never changes the
 * verdict, the page digest, the sidecar, or the index (a claim/observation stays
 * immutable, ADR 0053 §3). It is emitted only into the `.html` bytes.
 *
 * Schema choice is deliberately boundary-safe (ADR 0038 §2 / 0053 §3): the page is a
 * `TechArticle` — a dated, authored technical document — NOT a `Review`, `Rating`,
 * `Product`, or `Certification`. Modeling it as a rating/certification would encode
 * exactly the "CallLint graded/approved this" overclaim the language boundary forbids.
 * We publish WHAT was observed and WHEN, never a score. `abstract` reuses the same
 * boundary-safe verdict label + digest + time the visible page states, and carries
 * the standing disclaimer so even a machine-extracted summary keeps the boundary.
 * No email, no "certified", no "trusted publisher", no "Verified Publisher" — so the
 * committed bytes pass check-public-copy 15–19 unchanged.
 */
export function structuredData(page: BakedTrustPage): string {
  const completeness = page.preparation.authority?.completeness ?? "partial"
  const ld = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "@id": pageUrl(page),
    url: pageUrl(page),
    name: `${page.canonicalName} — CallLint Trust Page`,
    headline: `${VERDICT_PUBLIC_LABEL[page.verdict]} — ${page.canonicalName}`,
    // WHAT was observed + WHEN + under what completeness — never a grade or score.
    abstract:
      `${VERDICT_PUBLIC_LABEL[page.verdict]}, observed at artifact digest ` +
      `${page.artifactDigest} at ${page.observedAt} (completeness: ${completeness}). ` +
      `An observation at a specific artifact digest and time — not a certification, ` +
      `an endorsement, or a guarantee of safety.`,
    datePublished: page.observedAt,
    dateModified: page.observedAt,
    inLanguage: "en",
    isAccessibleForFree: true,
    author: { "@type": "Organization", name: "CallLint", url: SITE_ORIGIN },
    publisher: { "@type": "Organization", name: "CallLint", url: SITE_ORIGIN },
  }
  // Escape `<` per HTML rules for inline <script> (prevents `</script>`/`<!--`
  // sequences in data from ending the block). Deterministic; no other transform.
  const json = JSON.stringify(ld, null, 2).replace(/</g, "\\u003c")
  return `<script type="application/ld+json">\n${json}\n    </script>`
}

/**
 * The public GitHub App install funnel a maintainer uses to claim a namespace
 * (ADR 0048 §1 — the App install IS the control grant). Shown only on UNCLAIMED
 * pages, as an invitation to prove namespace control; a claimed page shows the
 * resulting Verified Publisher block instead. This is a control funnel, never a
 * safety funnel — the copy below never implies claiming makes a page safe.
 */
export const CLAIM_APP_URL = "https://github.com/apps/calllint-trust"

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
 *
 * `verifiedPublisher` is an OPTIONAL overlay (ADR 0048 §2): it states namespace
 * control (never safety) and is NOT part of `pageDigest` (the digest addresses the
 * immutable observation; a claim is a revocable overlay). When absent it is
 * `undefined`, which `JSON.stringify` drops — so an unclaimed page is byte-identical
 * to one baked before I2c, and the committed-tree reproducibility gate holds.
 */
export function renderSidecar(
  page: BakedTrustPage,
  verifiedPublisher?: VerifiedPublisher,
): string {
  const sidecar = {
    schema: "calllint.trust-page.v0",
    canonicalName: page.canonicalName,
    artifactDigest: page.artifactDigest,
    pageDigest: page.pageDigest,
    verdict: page.verdict,
    verdictLabel: VERDICT_PUBLIC_LABEL[page.verdict],
    observedAt: page.observedAt,
    completeness: page.preparation.authority?.completeness ?? "partial",
    // Four independent status dimensions + evidence level (ADR 0053 §5). Emitted as
    // separate fields — machines MUST NOT combine them into one score. `authorityClaimed`
    // reflects the (revocable) publisher overlay, so it is set here from the argument.
    status: {
      verdict: page.verdict,
      completeness: page.preparation.authority?.completeness ?? "partial",
      authorityClaimed: verifiedPublisher !== undefined,
      reproducibility: { pageDigest: page.pageDigest, observedAt: page.observedAt },
      evidenceLevel: evidenceLevel(page).level,
      evidenceRationale: evidenceLevel(page).rationale,
    },
    verifiedPublisher,
    correctionUrl: CORRECTION_URL,
    // Gate-C quality fields (PR-D5): HOW to replay the verdict, and WHEN it was
    // observed. Both are pure projections over this page (no new score, no verdict
    // movement); fixed position keeps the bytes stable for the reproducibility gate.
    reproduction: reproductionCommand(page),
    scanHistory: scanHistory(page),
    preparation: page.preparation,
    scan: page.scan,
  }
  return JSON.stringify(sidecar, null, 2) + "\n"
}

/**
 * A deterministic sitemap (`trust/sitemap.xml`) over the baked pages (discovery only).
 *
 * Q5: a maintainer cannot find their page. A sitemap lets a crawler enumerate every
 * served Trust Page from one URL instead of relying on incidental inbound links. It
 * is pure site chrome — it carries no verdict, no digest, and no claim, so it never
 * touches the reproducibility surface beyond its own bytes.
 *
 * Load-bearing correctness points:
 *  • Lists ONLY the clean, extensionless URLs (`/trust/{name}`). The `.html` artifact
 *    308-redirects to this form at the edge; a sitemap must list final URLs, never
 *    redirects — so we deliberately do NOT list `.html`.
 *  • `lastmod` is each page's pinned `observedAt` (already deterministic), so a
 *    re-bake is byte-identical and the committed-tree gate holds. No clock is read.
 *  • Takes the exact `{name, observedAt}` pairs the caller baked, sorted, so the
 *    emitted bytes are order-stable regardless of cohort bake order.
 *  • The `app-created` landing page is `noindex` and is intentionally omitted.
 */
export function renderSitemap(pages: readonly { canonicalName: string; observedAt: string }[]): string {
  const sorted = [...pages].sort((a, b) =>
    a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0,
  )
  const urls = sorted
    .map(
      (p) =>
        `  <url>\n` +
        `    <loc>${esc(`${SITE_ORIGIN}/trust/${p.canonicalName}`)}</loc>\n` +
        `    <lastmod>${esc(p.observedAt)}</lastmod>\n` +
        `  </url>`,
    )
    .join("\n")
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}\n` +
    `</urlset>\n`
  )
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
export function renderHtml(page: BakedTrustPage, verifiedPublisher?: VerifiedPublisher): string {
  const completeness = page.preparation.authority?.completeness ?? "partial"
  const caps = page.preparation.authority?.capabilities ?? []
  const notes = page.preparation.notes ?? []

  // Publisher block (ADR 0048 §6): namespace control, NEVER safety. A CLAIMED page
  // shows the Verified Publisher overlay; an UNCLAIMED page shows a "claim this page"
  // invitation into the public App install funnel (DX-1). The two branches are
  // mutually exclusive, so a claimed page never shows the CTA and vice-versa. Neither
  // branch touches the sidecar or the page digest (a claim is a revocable overlay);
  // the CTA carries no per-viewer or dynamic data, so the bake stays deterministic.
  // Copy in both branches is bounded by the extended forbidden set (language.ts).
  const publisherBlock = verifiedPublisher
    ? `
      <h2>Verified Publisher</h2>
      <p>Claimed by <code>${esc(verifiedPublisher.owner)}</code>, which controls the
         <code>github.com/${esc(verifiedPublisher.owner)}</code> namespace. This
         verifies namespace control only — it is not a safety claim, an endorsement,
         or a certification, and it does not change the observed verdict.</p>
      <p>Control verified at
         <time datetime="${esc(verifiedPublisher.verifiedAt)}">${esc(verifiedPublisher.verifiedAt)}</time>,
         against artifact digest <code>${esc(verifiedPublisher.observedArtifactDigest)}</code>.</p>
`
    : `
      <h2>Are you the maintainer?</h2>
      <p>No one has claimed the <code>${esc(page.canonicalName)}</code> namespace yet.
         If you control it, you can
         <a href="${esc(CLAIM_APP_URL)}">claim this page</a> by installing the CallLint
         Trust GitHub App on the account that owns it. Claiming records who controls the
         namespace — it is not a safety claim, an endorsement, or a certification, and it
         does not change the observed verdict.</p>
`

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

  // Gate-C quality sections (PR-D5). "How to reproduce" gives the exact command to
  // replay the verdict at the pinned digest; "Scan history" lists the observation(s)
  // of this artifact. Both are boundary-safe: the reproduction note frames a re-run as
  // reproducing an OBSERVED VERDICT, never as proving safety.
  const repro = reproductionCommand(page)
  const reproBlock = `
      <h2>How to reproduce</h2>
      <p>${esc(repro.note)}</p>
      <pre><code>${esc(repro.command)}</code></pre>
      <p>Reproduces the verdict observed at artifact digest
         <code>${esc(repro.artifactDigest)}</code>.</p>`
  const historyItems = scanHistory(page)
    .map(
      (h) =>
        `<li>Observed at <time datetime="${esc(h.observedAt)}">${esc(h.observedAt)}</time> — ` +
        `page digest <code>${esc(h.pageDigest)}</code></li>`,
    )
    .join("\n        ")
  const historyBlock = `
      <h2>Scan history</h2>
      <ul>
        ${historyItems}
      </ul>`

  // Four INDEPENDENT status dimensions + the evidence level (ADR 0053 §5). These are
  // presented as separate rows and deliberately NEVER multiplied/averaged into a
  // single "trust score" — a page states four distinct things, not one number. The
  // evidence level says WHAT was observed (E0–E6); it is not a grade.
  const ev = evidenceLevel(page)
  const evMeta = EVIDENCE_LEVEL_META[ev.level]
  const statusBlock = `
      <h2>Status (four independent dimensions)</h2>
      <p>These four dimensions are reported separately and are not combined into a
         single score — each answers a different question.</p>
      <ul>
        <li><strong>Verdict:</strong> ${esc(VERDICT_PUBLIC_LABEL[page.verdict])}</li>
        <li><strong>Evidence completeness:</strong> ${esc(completeness)}</li>
        <li><strong>Authority (namespace control):</strong> ${verifiedPublisher ? "claimed" : "unclaimed"} — control only, never safety</li>
        <li><strong>Reproducibility:</strong> page digest <code>${esc(page.pageDigest)}</code> observed at <time datetime="${esc(page.observedAt)}">${esc(page.observedAt)}</time></li>
      </ul>
      <p><strong>Evidence level:</strong> <code>${esc(ev.level)}</code> — ${esc(evMeta.label)}
         (${esc(evMeta.supports)}). ${esc(ev.rationale)}</p>`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(page.canonicalName)} — CallLint Trust Page</title>
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${esc(pageUrl(page))}" />
    ${structuredData(page)}
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
${statusBlock}
${publisherBlock}
      <h2>Observed capabilities</h2>
      <ul>
        ${capItems}
      </ul>

      <h2>Notes</h2>
      <ul>
        ${noteItems || "<li>None.</li>"}
      </ul>
${reproBlock}
${historyBlock}

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
