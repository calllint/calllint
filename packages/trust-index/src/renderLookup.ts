/**
 * The client-facing Trust lookup surface (ADR 0055 §5 / §Context): a deterministic
 * index + a human search page so a maintainer or agent operator can FIND the CallLint
 * Trust Page for a resource by name. Two emitted artifacts, both site chrome under
 * `/trust/` (NOT resources — absent from `index.json`, exactly like `sitemap.xml` and
 * `app-created.html`):
 *
 *   • `renderLookupIndex(entries)` → `lookup-index.json` — the machine-readable index.
 *   • `renderLookupPage()`         → `lookup.html`        — the human search UI.
 *
 * DETERMINISTIC by construction (ADR 0055 §5 — "no LLM, no fuzzy"). The index is a pure
 * sorted projection of the SAME baked entries that produce `index.json`, so the two
 * cannot drift; the page's matching is pure client-side string comparison (exact →
 * prefix → substring, alphabetical within each tier) with no ranking model, no network
 * call per keystroke, no embedding, and no fuzzy distance. Both are byte-identical on a
 * re-bake, so the committed-tree reproducibility gate holds (ADR 0046 §4).
 *
 * This is a lean PUBLIC projection — real baked resources only — and is DISTINCT from
 * the internal `calllint.trust-index.v0` registry listing AND from the API-side
 * `partner-api/src/lookup.ts` (ADR 0055 §5). It carries no score, no free-text, and no
 * PII: it publishes only what each page already states (name, verdict + its boundary-safe
 * public label, artifact digest, observed-at). Because it is a projection of an already
 * public, immutable observation, emitting it never changes a verdict, a page digest, the
 * sidecar, or the index (ADR 0053 §3).
 *
 * Language boundary (ADR 0038 §2 — non-negotiable): the page states that a CallLint Trust
 * Page is "an observation at a specific artifact digest and time … not a certification, an
 * endorsement, or a guarantee of safety", carries a correction link, and reuses the
 * shipped boundary-safe `VERDICT_PUBLIC_LABEL`. It NEVER hardcodes a verdict label in its
 * static bytes (labels are rendered client-side from the index), so it needs no per-page
 * SAFE scope block (check 20). It reads as claimed-style chrome — it mentions the Verified
 * Publisher note but carries no per-page claim funnel (there is no single namespace to
 * claim here), exactly like `app-created.html` (check 19).
 */
import type { Verdict } from "@calllint/types"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import { CORRECTION_URL } from "./renderPage.js"
import { LEXICAL_MATCH_BROWSER_JS } from "./matchLexical.js"

/**
 * One source row for the lookup index — the minimal projection of a baked page the
 * index needs. The caller (`emitAllCohorts`) builds these from the SAME baked `index`
 * array that produces `index.json`, filtered to real baked resources, so a lookup entry
 * can never exist without a matching index entry (the anti-drift invariant the test pins).
 */
export interface LookupSourceEntry {
  canonicalName: string
  verdict: Verdict
  artifactDigest: string
  observedAt: string
}

/**
 * Build `lookup-index.json` — a deterministic, sorted, closed projection of the baked
 * real resources. Pure: given the same entries it returns byte-identical bytes (sorted by
 * `canonicalName`, fixed key order, pinned indentation), so a re-bake is stable and the
 * committed-tree gate holds. `verdictLabel` is the shipped boundary-safe public label; the
 * clean `/trust/{name}` URL is the canonical non-redirecting form (matching the sitemap).
 */
export function renderLookupIndex(entries: readonly LookupSourceEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0,
  )
  const doc = {
    schema: "calllint.trust-lookup-index.v1",
    entries: sorted.map((e) => ({
      canonicalName: e.canonicalName,
      url: `/trust/${e.canonicalName}`,
      verdict: e.verdict,
      verdictLabel: VERDICT_PUBLIC_LABEL[e.verdict],
      artifactDigest: e.artifactDigest,
      observedAt: e.observedAt,
    })),
  }
  return JSON.stringify(doc, null, 2) + "\n"
}

/**
 * The deterministic client matcher, kept in a named constant so the test can assert it
 * carries no fuzzy/embedding/ranking-model vocabulary. Pure string comparison only:
 * exact match first, then prefix, then substring; alphabetical within each tier. No
 * per-keystroke network, no cookie/localStorage, credential-less fetch of the same-origin
 * index we emitted. Uses `textContent`/`href` (never `innerHTML`) so a resource name is
 * inert data, never markup.
 */
const LOOKUP_SCRIPT = `(function () {
  var input = document.getElementById('q');
  var list = document.getElementById('results');
  var status = document.getElementById('status');
  var entries = [];

${LEXICAL_MATCH_BROWSER_JS}

  function render(rows) {
    list.textContent = '';
    if (!rows.length) {
      var empty = document.createElement('li');
      empty.textContent = 'No Trust Page matches that name.';
      list.appendChild(empty);
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var e = rows[i];
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = String(e.url);
      a.textContent = String(e.canonicalName);
      var note = document.createElement('span');
      note.className = 'lookup-verdict';
      note.textContent = ' — ' + String(e.verdictLabel);
      li.appendChild(a);
      li.appendChild(note);
      list.appendChild(li);
    }
  }

  fetch('/trust/lookup-index.json', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : { entries: [] }; })
    .then(function (doc) {
      entries = Array.isArray(doc.entries) ? doc.entries : [];
      status.textContent = entries.length + ' Trust Pages indexed.';
      render(match(input.value));
    })
    .catch(function () { status.textContent = 'The lookup index is unavailable right now.'; });

  input.addEventListener('input', function () { render(match(input.value)); });
})();`

/**
 * Render the static lookup page. Pure: returns byte-identical HTML on every call (a
 * single static string with an inlined deterministic script; no clock, no RNG, no
 * per-resource interpolation). Reuses `CORRECTION_URL` so the correction link has one
 * source of truth, and the marketing chrome (`/styles.css`, `.site-header`,
 * `.section-narrow`, footer) the rest of the site uses.
 */
export function renderLookupPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Find a CallLint Trust Page</title>
    <meta name="description" content="Look up the CallLint Trust Page for an MCP server or agent tool by name. Each page is an observation at a specific artifact digest and time — not a certification, an endorsement, or a guarantee of safety." />
    <link rel="icon" href="/favicon.png" type="image/png" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="https://calllint.com/trust/lookup" />
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
        <p class="lede">CallLint Trust · lookup</p>
        <h1>Find a Trust Page</h1>
        <p class="prose">
          Search by resource name to open its CallLint Trust Page. Matching runs entirely
          in your browser over a published index — it is a plain name search (exact, prefix,
          then substring), with no ranking model and no server round-trip per keystroke.
        </p>

        <form class="lookup-form" role="search" onsubmit="return false;">
          <label for="q">Resource name</label>
          <input id="q" type="search" name="q" autocomplete="off" spellcheck="false"
                 placeholder="e.g. mcp-registry/io.github.example" aria-describedby="status" />
        </form>
        <p id="status" class="prose" aria-live="polite">Loading the lookup index…</p>
        <ul id="results" class="lookup-results"></ul>
        <noscript>
          <p class="prose">
            Search needs JavaScript. You can still browse every listed page from the
            <a href="/trust/sitemap.xml">Trust sitemap</a>.
          </p>
        </noscript>

        <div class="callout">
          A CallLint Trust Page publishes an observation at a specific artifact digest and
          time under stated completeness. It is <strong>not a certification, an endorsement,
          or a guarantee of safety</strong>, and it reports four independent dimensions
          separately rather than a single score. A page a maintainer has claimed also carries
          a <strong>Verified Publisher</strong> note — that records who controls the
          namespace, never that the tool is safe, and it does not change the observed verdict.
          Identity verification does not change the CallLint verdict.
          Something look wrong on a page? <a href="${CORRECTION_URL}">Report a correction</a>.
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
    <script>${LOOKUP_SCRIPT}</script>
  </body>
</html>
`
}
