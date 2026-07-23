/**
 * The post-install landing page for the maintainer-claim funnel (ADR 0047/0048 §2).
 *
 * A maintainer who clicks "Are you the maintainer?" on an unclaimed Trust Page is sent
 * to the CallLint Trust GitHub App install (the install IS the control grant), and
 * GitHub then redirects them to the App manifest's `redirect_url`,
 * `https://calllint.com/trust/app-created.html`
 * ([github-app/app-manifest.json](../github-app/app-manifest.json)). This module renders
 * that page. Without it the funnel dead-ends on a 404.
 *
 * DETERMINISTIC by construction (a single static string; no clock, no RNG, no
 * per-namespace interpolation) so a re-bake is byte-identical and the committed-tree
 * reproducibility gate holds (ADR 0046 §4). It is emitted by `emitAllCohorts` next to
 * `index.json`, NOT written into the index — it is site chrome under `/trust/`, not a
 * resource page, so it never touches a verdict, a page digest, or the completeness count.
 *
 * Language boundary (ADR 0038 §2 / ADR 0048 §6 — non-negotiable): claiming records
 * namespace CONTROL, never safety. The copy states this is "not a safety claim, an
 * endorsement, or a certification, and it does not change the observed verdict", carries
 * the shared "not a certification … guarantee of safety" disclaimer and a correction
 * link, and never emits a forbidden overclaim phrase. Because this is a post-install
 * (already-claimed) page it shows the "Verified Publisher" framing and deliberately does
 * NOT carry the App install funnel URL — it must never re-solicit an install. Both
 * properties are enforced by `scripts/check-public-copy.mjs` (checks 15–20), which walks
 * every served `.html` under `apps/web/public/trust/**`.
 *
 * Visual: reuses the marketing-site chrome (`/styles.css`, `.site-header`,
 * `.section-narrow topic`, `.callout`, `.btn`) — the SAME site and domain the App
 * redirects to — rather than the intentionally-bare Trust-Page shell, because this is a
 * human onboarding moment, not a machine-addressed artifact.
 */
import { CORRECTION_URL } from "./renderPage.js"

/**
 * Render the static post-install landing page. Pure: returns byte-identical HTML on
 * every call. Reuses `CORRECTION_URL` so the correction link has one source of truth.
 */
export function renderAppCreatedPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>You're in — claim your Verified Publisher note on CallLint Trust</title>
    <meta name="description" content="You installed CallLint Trust. Your Trust Page will name you as the verified controller of your namespace and you can embed a live badge. Free, least-privilege, revocable — it records namespace control only, not a safety claim, and never changes a verdict." />
    <link rel="icon" href="/favicon.png" type="image/png" />
    <meta name="robots" content="noindex" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="brand-lockup" href="/" aria-label="CallLint home">
        <img class="brand-mark" src="/logo-mark-128.png" width="40" height="40" alt="" />
        <span class="brand-name">CallLint</span>
      </a>
      <nav class="nav-links" aria-label="Primary">
        <a href="/#how">How</a>
        <a href="/agents">For agents</a>
        <a href="/mcp-security">MCP security</a>
        <a href="/team">Team</a>
        <a href="https://github.com/calllint/calllint">GitHub</a>
      </nav>
    </header>
    <main>
      <section class="section section-narrow topic">
        <p class="lede">CallLint Trust · you're verified</p>
        <h1>You're in. Your namespace claim is on its way.</h1>
        <p class="prose">
          You just installed CallLint Trust on the account that controls your namespace —
          and that install is all the proof of control we need. Nothing else is required
          from you. Here's what you get for it.
        </p>

        <h2>Your page now speaks for you</h2>
        <p class="prose">
          Right now anyone can read a CallLint Trust Page for your tool, but it's an
          anonymous, third-party observation. On the next refresh, your page gains a
          <strong>Verified Publisher</strong> note that names <em>you</em> as the account
          that controls the namespace — a public, checkable signal that the real maintainer
          is present and paying attention. It's the difference between "some scanner looked
          at this" and "the maintainer stands behind this listing."
        </p>
        <p class="prose">
          To be clear about what that note is and isn't: it records
          <strong>who controls the namespace</strong>. It is <strong>not a safety claim</strong>,
          an endorsement, or a certification, and it does not change the observed verdict on
          any page — a verdict stays exactly what the evidence shows, claimed or not. That
          honesty is the point: a Verified Publisher note you can trust is worth more than a
          badge that pretends to grade you.
        </p>
        <div class="callout">
          <strong>Free, least-privilege, and revocable.</strong> Claiming is free — CallLint
          reads only your public installation metadata, never your code or any private data.
          Verification isn't instant: a scheduled job reconciles installations and re-bakes
          your page, so the Verified Publisher note appears on the <strong>next refresh</strong>,
          not immediately. Change your mind? Uninstall the app and the note is dropped on the
          following refresh — you stay in control.
        </p>

        <h2>Put a live badge on your README</h2>
        <p class="prose">
          Show visitors the current status of your tool without sending them anywhere. This
          one-tag badge links to your live Trust Page and displays your page's
          <em>current observed verdict</em> — it runs no scanner, and it is not a
          certification or a guarantee of safety, just an honest, up-to-date signal you can
          embed anywhere. Replace <code>your-resource</code> with the identifier shown in
          your Trust Page's URL:
        </p>
        <pre class="prose"><code>&lt;script type="module" src="https://calllint.com/embed/calllint-trust.js"&gt;&lt;/script&gt;
&lt;calllint-trust resource="mcp-registry/your-resource"&gt;
  &lt;a href="https://calllint.com/trust/mcp-registry/your-resource.html"&gt;CallLint Trust Page&lt;/a&gt;
&lt;/calllint-trust&gt;</code></pre>
        <p class="prose">
          The inner link is the no-JavaScript fallback: if scripts are blocked, the plain
          link to your Trust Page is shown unchanged.
        </p>

        <div class="callout">
          CallLint publishes an observation at a specific artifact digest and time under
          stated completeness. It is <strong>not a certification, an endorsement, or a
          guarantee of safety</strong> — which is exactly why a Verified Publisher note
          carries weight. Something look wrong on your page?
          <a href="${CORRECTION_URL}">Report a correction</a>.
        </div>

        <div class="cta-row">
          <a class="btn btn-primary" href="/mcp-security">See what CallLint checks</a>
          <a class="btn btn-ghost" href="/">Back to CallLint</a>
        </div>

        <p class="topic-nav">Related:
          <a href="/">Home</a> ·
          <a href="/agents">For agents</a> ·
          <a href="/mcp-security">MCP security</a> ·
          <a href="/team">Team</a>
        </p>
      </section>
    </main>
    <footer class="site-footer">
      <div class="footer-brand">
        <img src="/logo-mark-128.png" width="28" height="28" alt="" />
        <span>CallLint · evidence-backed verdicts for agent tools</span>
      </div>
      <div class="footer-links">
        <a href="/">Home</a> · <a href="/agents">For agents</a> ·
        <a href="/team">Team</a> ·
        <a href="https://github.com/calllint/calllint">Source</a> ·
        <a href="/llms.txt">llms.txt</a>
      </div>
    </footer>
  </body>
</html>
`
}
