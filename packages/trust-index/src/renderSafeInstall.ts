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
//   1 identity · 2 disposition · 3 one-sentence consequence · 4 ≤5 authority
//   facts · 5 one primary action · 6 two secondary links.
// Publisher text is quarantined in a labeled block, escaped, and NEVER placed in
// a decision group (INV-2.4-05). Unsupported → an honest EXPLAIN_ONLY page whose
// primary action is "View manual setup", never a fabricated command (INV-2.4-08).
// ---------------------------------------------------------------------------

import { buildAdoptionUri } from "@calllint/core"
import { REASON_CODE_META, type ReasonCode } from "@calllint/types"
import type { MustAskToken } from "./agentAdoptionContract.js"
import type { SafeInstallProjection, Installability } from "./safeInstallProjection.js"
import { CLI_VERSION, CORRECTION_URL, SITE_ORIGIN } from "./renderPage.js"
import {
  DEFAULT_LAYOUT,
  type AboveFoldSectionId,
  type ResolvedLayout,
} from "./safe-install/layoutStructure.js"
import { DEFAULT_TOKENS, type ResolvedTokens } from "./safe-install/tokenPlane.js"

/** The only script Gate 2.4-B / ADR 0059 permit on this surface (copy assist). */
export const INSTALL_COPY_SCRIPT_SRC = "/scripts/install-copy.js" as const

/**
 * The renderer's FIXED section titles (PR P-2 lifts the wording; the POSITION and
 * the key set stay code — ADR 0058 §3, INV-2.4-05).
 *
 * `publisherBlock` is the quarantine label. Its wording is configurable so a locale
 * can say it naturally, but no configuration can move publisher text out of this
 * block or into a decision group: the block is emitted from exactly one place below,
 * after every decision group, and nothing in the document can address its position.
 *
 * `boundary` is the fourth slot, WIRED by PR P-4b. P-2 deferred it for one reason:
 * its emitted form was folded across three source lines, so lifting it meant either
 * storing the renderer's HTML indentation in the content document (configuration
 * owning layout, which §3 forbids) or re-folding the text and moving served bytes,
 * which §4 reserves for this PR. P-4b is that PR, so the sentence is now emitted as
 * ONE line through `escText` and the fold is gone — the slot holds a sentence, and
 * nothing about the renderer's whitespace is configurable.
 *
 * `UNWIRED_SECTION_TITLES` is consequently now empty, which is why the test that
 * covered it became a synthetic positive control rather than a vacuous pass.
 */
export const SECTION_TITLES = {
  authorityFacts: "What it can do",
  agentReads: "What your agent must ask you about first",
  /**
   * The value line above the primary action (R-2 item 3). A copy slot rather than a
   * renderer literal for the same reason the CTA verb phrase is one: it is the sentence
   * most likely to need a locale, and it is the sentence a reviewer must be able to
   * change without touching a renderer.
   *
   * It states the two things true of EVERY route — the page was produced by a scan, and
   * nothing installs beyond the authority approved locally. Neither half is route-
   * dependent, so one fixed sentence is honest on all five states; a per-state value
   * line would invite a claim the state cannot support.
   */
  /**
   * The value line above the primary action (R-2 item 3), REWRITTEN.
   *
   * The first version said "installs with only the authority you approve locally" — a
   * mechanism description, addressed to a reader who already knew what CallLint was. A
   * first-time visitor does not, and the sentence spent its one line without telling them.
   *
   * Recognition, not recall (the panel measures a five-second glance): name the thing,
   * then the guarantee, in that order. "Scanned by CallLint" is the claim; the clause
   * after it says what CallLint IS in six words, so the badge below and the button both
   * inherit a defined term instead of asserting an unknown brand.
   */
  valueLine:
    "Scanned by CallLint — one config entry can expand what your agent is allowed to do," +
    " so the blast radius is stated here before you approve it, not after. No server was executed" +
    " to produce this page.",
  /**
   * The protection badge beside the action (R-2 items 2/5/7).
   *
   * Names the ROUTE, not a state. An earlier draft read "Continuously protected by
   * CallLint" — false twice over: this page installs nothing by itself, and continuous
   * Guard is a separate `ASK_AFTER_SUCCESS` offer that defaults to [Not now]
   * (INV-2.4-07 forbids a one-time setup implying a persistent component). "Added
   * through CallLint's approval gate" is what the button below actually does.
   */
  protectionBadge: "Added through CallLint's approval gate",
  /**
   * The consequence group's heading.
   *
   * Without it the group was one unlabelled sentence between two labelled cards, and it
   * repeated the observed authority row verbatim — so it read as a duplicate rather than
   * as the headline. Naming it turns the repetition into summary-then-detail: this is what
   * happens, and the inventory below is which capabilities produce it.
   */
  consequenceHeading: "What happens if you install it",
  /**
   * Second paragraph under the consequence summary (ADR 0059). The FIRST `<p>` must
   * remain `consequenceSummary` for Gate 2.4-B extraction; this sentence frames it.
   */
  consequenceLead:
    "This is the top consequence CallLint observed from a static scan of the install config — not a product pitch. Capability rows and hit reason codes follow; the full Trust Page holds every finding.",
  /**
   * Heading for the sealed reason-code inventory under the authority list (ADR 0059).
   */
  reasonCodesHeading: "What this scan hit",
  provenance: "Provenance",
  publisherBlock: "Publisher-provided description — not used for CallLint's safety decision.",
  boundary:
    "This page is an observation at a specific artifact digest and time under the stated completeness." +
    " It is not a certification, an endorsement, or a guarantee of safety.",
} as const

export type SectionTitles = Record<keyof typeof SECTION_TITLES, string>

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
 * Escape for ELEMENT TEXT CONTENT: `&`, `<`, `>` — the three characters that can end
 * a text node or start a reference. Quotes are only significant inside an attribute
 * value, so a text node does not need them escaped.
 *
 * Why this exists alongside `esc` rather than reusing it: the section titles below sit
 * in text position and one of them contains an apostrophe ("CallLint's"). `esc` is the
 * attribute-grade escape and would render that as `&#39;`, changing bytes the shipped
 * tree already serves — and ADR 0058 §4 reserves any served-byte change for PR P-4b.
 * So this is the correct escape for the position, chosen because it is also the one
 * that leaves the shipped bytes alone; it is never used for an attribute value.
 *
 * Escaping is defense in depth, not the only defense: `resolvePresentation` refuses a
 * configured title containing markup, so a bad value falls back to the shipped default
 * instead of shipping a page full of entities.
 */
function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * The primary-action href per installability — a DOCUMENTATION anchor, never a
 * command and never a live writer. The CTA takes a human to the honest next step
 * (prepare docs / blockers / pre-flight / manual setup); it never applies config.
 *
 * These remain the href for every state a click cannot honestly act on, and the
 * fallback for every state when a deep link cannot be built.
 *
 * EXPORTED at P-6 (additive; no emitted byte changes). The preview harness grades
 * "同一 Host 的 CTA 一致" by reading this table's totality over `Installability` and by
 * partitioning pages on the CTA route. A harness that restated the hrefs instead would
 * be self-certifying — it would agree with its own copy while the renderer drifted.
 */
export const CTA_DOC_HREF: Record<Installability, string> = {
  PREPARE_AVAILABLE: `${SITE_ORIGIN}/docs/safe-install`,
  REVIEW_REQUIRED: `${SITE_ORIGIN}/docs/safe-install#review`,
  BLOCKED: `${SITE_ORIGIN}/docs/safe-install#blocked`,
  LOCAL_PREFLIGHT_REQUIRED: `${SITE_ORIGIN}/docs/safe-install#preflight`,
  UNSUPPORTED: `${SITE_ORIGIN}/docs/safe-install#manual`,
}

/**
 * The states where a click can honestly DO something locally, so the CTA becomes a
 * `calllint://adoption/…` deep link (ADR 0057).
 *
 * `BLOCKED` and `UNSUPPORTED` are excluded because there is nothing to adopt — a deep
 * link there would open the CLI only to refuse, which is worse than a link that
 * explains. `LOCAL_PREFLIGHT_REQUIRED` is excluded for the same reason: the honest next
 * step is the pre-flight, not an adoption prompt.
 *
 * EXPORTED at P-6 (additive). `dispositionBlock` emits two structurally different
 * branches, and this set is exactly the predicate that chooses between them — so the
 * harness's page-consistency partition is DERIVED from the renderer's own condition
 * rather than a hand-kept list that could fall out of step with it.
 */
export const DEEP_LINK_STATES: ReadonlySet<Installability> = new Set<Installability>([
  "PREPARE_AVAILABLE",
  "REVIEW_REQUIRED",
])

/**
 * The CTA href: a deep link where a click can act, the documentation anchor otherwise.
 *
 * The link carries BOTH digests as assertions. That is what makes one click safe rather
 * than merely fast: the local CLI re-checks them against what it actually reads and
 * stops on mismatch, so a page that has drifted from the bytes it describes cannot talk
 * a user into adopting something else. It never carries an apply flag — that property is
 * enforced on the CLI side over produced argv (ADR 0057 §1).
 *
 * `buildAdoptionUri` returns null if any component fails the parser's own grammar, in
 * which case this falls back to the documentation anchor. So an un-parseable link is
 * structurally impossible to emit, rather than emitted and refused on click.
 */
function ctaHref(p: SafeInstallProjection): string {
  if (!DEEP_LINK_STATES.has(p.installability)) return CTA_DOC_HREF[p.installability]
  const deepLink = buildAdoptionUri({
    canonicalSlug: p.canonicalSlug,
    version: p.subject.version ?? null,
    expectedArtifactDigest: p.agentContract.subject.artifactDigest,
    expectedContractDigest: p.agentContract.contract.contractDigest,
  })
  return deepLink ?? CTA_DOC_HREF[p.installability]
}

/** The clean, non-redirecting Trust Page URL for a projected resource. */
function trustPageUrl(p: SafeInstallProjection): string {
  return `${SITE_ORIGIN}/trust/${p.canonicalName}`
}

/**
 * The exact command the CTA's deep link would run — shown, not hidden.
 *
 * Two audiences, one string. A macOS visitor (no OS handler; ADR 0057 §4) needs a path
 * that does not route through documentation, and a cautious visitor on any platform
 * wants to read the command before a link runs it. Emitting it verbatim serves both and
 * costs nothing, since this IS what `url-handler open` prints.
 *
 * IT CARRIES `--apply`, AND `--approve` IS STILL FORBIDDEN. An earlier revision omitted
 * every write flag "for the same reason the deep link never does" — but the two are not
 * the same reason. The deep link is untrusted input crossing a machine boundary, so
 * `FORBIDDEN_ARGS` keeps a write flag out of the argv a URL can build. This string is a
 * command the visitor reads and types themselves, and interactive `--apply` now prints
 * the resolved plan and blocks for a typed `yes` (ADR 0057 §6) — the human sees the exact
 * config change before authorizing it. Omitting `--apply` did not add safety here; it
 * only guaranteed the command stopped at PREPARED, which is why the page could not
 * honestly offer a route for a visitor starting from nothing.
 *
 * `--approve` and `--plan-out` stay absent, permanently. `--approve` is the flag that
 * SKIPS the human, and a command published on a web page is exactly the place it must
 * never appear.
 *
 * The fallback paragraph carries exactly ONE `<code>` span, and that constraint belongs
 * here because it is not cosmetic: two test extractors identify the command as "the code
 * span inside `install-fallback`", so wrapping an inline word (`yes`, a flag name) in
 * `<code>` there silently redirects both assertions to the wrong string and the command
 * stops being checked at all.
 */
function fallbackCommand(p: SafeInstallProjection): string {
  // `npx`, not a bare `calllint`. This is the ONLY path that works for a visitor who does
  // not have CallLint yet, and that visitor is the majority of first-time readers:
  //
  //   • the CTA is a `calllint://` link, which the OS resolves only after
  //     `calllint url-handler --apply` has run. On a machine without it the click is
  //     silently DEAD — no error, no navigation. That is the reported defect.
  //   • a bare `calllint …` assumed the binary was already on PATH, so the documented
  //     escape hatch had the same precondition as the thing it was escaping from.
  //
  // `npx calllint@1.7.3` fetches the published CLI and runs it in one step, so one visible
  // command genuinely does both halves — the guard and the server — for someone starting
  // from nothing. The version is PINNED: an unpinned `npx calllint` resolves whatever
  // `latest` is at click time, which is a different program from the one this page's
  // digests were computed against, and "verified bytes, unverified verifier" is the wrong
  // trade on a page whose whole claim is provenance.
  //
  // `--apply` is what closes the gap: without it the command ends at PREPARED and the
  // visitor is left holding a plan with no way to accept it. With it, the same command
  // fetches the verifier, verifies this exact artifact, PRINTS the config change, and
  // waits for a typed `yes` — one command, one approval, both halves installed.
  return (
    `npx calllint@${CLI_VERSION} safe-install --contract ${SITE_ORIGIN}/install/${p.canonicalSlug}/index.json` +
    ` --expect-artifact-digest ${p.agentContract.subject.artifactDigest} --apply`
  )
}

/**
 * Group 2 — the verdict headline plus the primary action.
 *
 * ACTION HIERARCHY (dual-track, equal CTAs). Cold-start visitors without an OS
 * handler used to face a long paste-only path. The honest split is now:
 *   1. PRIMARY (Gate 2.4-B) — `calllint://` "Open in CallLint {name}" for visitors
 *      who already have CallLint registered;
 *   2. EQUAL ALT — "I don't have CallLint yet" copies a one-line CLI install
 *      (`npm i -g calllint@pinned`) and tells them to return and click Open;
 *   3. COMMAND CARD — shortened `npx … safe-install --contract … --apply` to add
 *      this MCP without a prior install; full digest lives under <details>;
 *   4. EXIT — install the MCP without CallLint (sourceLocator), visually quietest.
 *
 * On BLOCKED / UNSUPPORTED / LOCAL_PREFLIGHT_REQUIRED there is nothing honest to adopt,
 * so the primary stays the documentation CTA and the command remains a muted reference.
 *
 * Exactly ONE `.install-cta` / `data-primary-action` remains (the Open link). The
 * equal-weight sibling is `.install-cta-alt`, never a second primary for the gate.
 */
function dispositionBlock(p: SafeInstallProjection, titles: SectionTitles): string {
  const deepLinked = DEEP_LINK_STATES.has(p.installability)
  const ctaLabel = `${esc(p.humanDisposition.primaryCta)} ${esc(p.displayName)}`
  const fullCmd = fallbackCommand(p)
  const shortCmd = shortFallbackCommand(p)
  const cliInstall = `npm i -g calllint@${CLI_VERSION}`
  const badge = deepLinked
    ? `        <p class="install-badge"><img class="install-badge-mark" src="/logo-mark-256.png" width="28" height="28" alt="" /><span class="install-badge-check" aria-hidden="true">✓</span> ${escText(titles.protectionBadge)}</p>\n`
    : ""

  if (deepLinked) {
    const deepHref = ctaHref(p)
    return `      <section class="install-disposition" aria-label="Disposition">
        <p class="install-headline"><strong>${esc(p.humanDisposition.headline)}</strong></p>
        <p class="install-value-line">${escText(titles.valueLine)}</p>
${badge}        <div class="install-cta-row" role="group" aria-label="Choose how to continue">
          <a class="install-cta" data-primary-action="${p.installability}"
              data-deep-link="true"
              href="${esc(deepHref)}">${ctaLabel}</a>
          <button type="button" class="install-cta-alt install-copy"
              data-copy-text="${esc(cliInstall)}"
              data-copy-done="Copied — install, then click Open on the left"
              data-copy-label="I don't have CallLint yet"
              aria-label="Copy CallLint install command">I don't have CallLint yet</button>
        </div>
        <p class="install-cta-pair-note">${escText(
          "Left opens CallLint if it is already installed. Right copies a one-line CLI install; when that finishes, return here and click Open on the left.",
        )}</p>
        <div class="install-primary-path">
        <p class="install-fallback" id="install-command"><span class="install-command-label">${escText(
          "Or add this MCP now (no prior install)",
        )}</span><span class="install-command-row" id="install-command-text"><code>${esc(shortCmd)}</code>` +
        `<button type="button" class="install-copy" data-copy-from="install-command-full"` +
        ` aria-label="Copy full command">Copy</button></span>` +
        `<span id="install-command-full" hidden>${esc(fullCmd)}</span>` +
        `<details class="install-command-full"><summary>${escText(
          "Full command with artifact digest",
        )}</summary><code>${esc(fullCmd)}</code></details></p>
        <p class="install-cta-note">${escText(
          "Paste into a terminal and type yes when asked. The Copy button includes the artifact digest so CallLint verifies this exact page.",
        )}</p>
        </div>
        ${altRouteLink(p)}
      </section>`
  }

  // Docs-primary: nothing honest to adopt on this route.
  return `      <section class="install-disposition" aria-label="Disposition">
        <p class="install-headline"><strong>${esc(p.humanDisposition.headline)}</strong></p>
        <p class="install-value-line">${escText(titles.valueLine)}</p>
        <p><a class="install-cta" data-primary-action="${p.installability}"
              data-deep-link="false"
              href="${esc(ctaHref(p))}">${ctaLabel}</a></p>
        <p class="install-cta-note">${escText("Opens the documentation for this verdict. Nothing is written.")}</p>
        <p class="install-fallback"><code>${esc(fullCmd)}</code></p>
        ${altRouteLink(p)}
      </section>`
}

/** Visible cold-start command — same as full, minus the digest flag (shown under details). */
function shortFallbackCommand(p: SafeInstallProjection): string {
  return (
    `npx calllint@${CLI_VERSION} safe-install --contract ${SITE_ORIGIN}/install/${p.canonicalSlug}/index.json` +
    ` --apply`
  )
}

/**
 * The opt-out link: the MCP WITHOUT CallLint.
 *
 * It used to point at `calllint.com/docs/safe-install#manual` — CallLint's own site. An
 * opt-out that routes back to the thing being opted out of is not an opt-out, and the
 * page already held the right target: `subject.sourceLocator`, the upstream the scan was
 * performed against. Using it makes the choice real, which is what earns the default.
 *
 * Two shapes ship, so both are handled rather than assuming URLs:
 *   • `https://…` (17 pages) — linked as-is.
 *   • `npm:pkg@version` (2 pages) — not a navigable URL, so it is mapped to the registry
 *     page for that exact package. The version is dropped from the path because npmjs.com
 *     has no per-version route; the package page is the honest landing spot.
 *   • `null` — no link at all. A dead or invented target would be worse than its absence,
 *     and no shipped page is in this state today (a fixture is, which is why it is here).
 */
function altRouteLink(p: SafeInstallProjection): string {
  const href = altRouteHref(p)
  if (href === null) return ""
  return `<p class="install-alt-route"><a href="${esc(href)}" rel="nofollow noopener"
              >Install this MCP only (without CallLint)</a></p>`
}

/**
 * The opt-out target, or `null` when this projection has none.
 *
 * EXTRACTED + EXPORTED at P-6 (additive; `altRouteLink` emits the same bytes it always
 * did). `install-alt-route` is one of the conditional sites the preview harness records
 * as `present|absent`, and the plan's rule is that every tolerated variance carries the
 * assertion of the condition that produced it. A harness that re-derived "is there an
 * opt-out?" from its own copy of the `npm:` mapping and the https test would be checking
 * its own arithmetic — and on the day the two disagreed, the copy claiming success would
 * be the wrong one. So the condition is READ from here.
 */
export function altRouteHref(p: SafeInstallProjection): string | null {
  const loc = p.agentContract.subject.sourceLocator
  if (loc === null) return null
  const npm = /^npm:(.+)$/.exec(loc)
  // Split the version off the LAST `@`, so a scoped name (`@adeu/mcp-server`) keeps its own.
  const href = npm
    ? `https://www.npmjs.com/package/${(npm[1] ?? "").replace(/@[^@]*$/, "")}`
    : loc
  return /^https:\/\//.test(href) ? href : null
}

/**
 * Human sentences for the contract's `mustAskBefore` tokens.
 *
 * This is the same move ADR 0020 made for reason codes: the token is the durable
 * machine fact, the sentence is a PROJECTION of it. The tokens already ship inside the
 * sealed contract, so the agent has always been told to stop and ask — but a human
 * reading the page could not see that, which meant the page's strongest guarantee was
 * the one thing it never showed. This surfaces it without adding a new fact.
 *
 * Keyed by the frozen token list. A token with no sentence here is rendered as its own
 * token rather than dropped: showing an unpolished string is honest, while silently
 * omitting one would understate what the agent is bound by.
 */
const MUST_ASK_SENTENCE: Readonly<Record<MustAskToken, string>> = Object.freeze({
  new_secret_access: "before it reads a new secret or credential",
  external_mutation: "before it changes anything outside this machine",
  shell_execution: "before it runs a shell command",
  broad_filesystem_access: "before it reads or writes broadly across your filesystem",
  financial_action: "before it takes any action that spends money",
  persistent_calllint_components: "before it leaves any CallLint component running",
})

/**
 * The "what your agent reads" block — the sealed contract's own `mustAskBefore` list,
 * made visible.
 *
 * Read-only projection of `p.agentContract.agentGuidance.mustAskBefore`. It reads the
 * contract; it cannot alter it, and it introduces no fact the contract does not already
 * carry — so no digest moves because of this section's existence.
 */
function agentReadsBlock(p: SafeInstallProjection, titles: SectionTitles): string {
  const items = p.agentContract.agentGuidance.mustAskBefore
    .map((t) => `        <li><code>${esc(t)}</code> — ${escText(MUST_ASK_SENTENCE[t] ?? t)}</li>`)
    .join("\n")
  return `      <section class="install-agent-reads" aria-label="Agent obligations">
      <h2>${escText(titles.agentReads)}</h2>
      <p>Your agent reads this page's machine contract. It is instructed to stop and ask you:</p>
      <ul>
${items}
      </ul>
    </section>`
}

/** Group 4 — the ≤5 authority facts + sealed reason-code inventory (ADR 0059). */
function authorityFactsBlock(
  p: SafeInstallProjection,
  titles: SectionTitles,
  maxFacts: number,
): string {
  // The cap is applied HERE, at render time, and nowhere else. `authorityDecisionFacts`
  // has already been selected from evidence; a configured cap can only reduce what is
  // DISPLAYED — it cannot reach the selection, the completeness precondition, or any
  // digest (ADR 0058 §1 reachability; INV-P1).
  const items = p.authorityDecisionFacts
    .slice(0, Math.max(1, maxFacts))
    .map(
      (f) =>
        `        <li data-observed="${f.observed}">` +
        `<span class="install-authority-mark ${f.observed ? "is-observed" : "is-absent"}"` +
        ` aria-hidden="true">${f.observed ? "!" : "✓"}</span>` +
        ` <code>${esc(f.authority)}</code> — ${esc(f.consequence)}</li>`,
    )
    .join("\n")

  const codes = p.agentContract.publicObservation.reasonCodes
  const reasonItems =
    codes.length === 0
      ? `        <li class="install-reason-empty">No capability reason codes were projected from findings at this digest.</li>`
      : codes
          .map((code) => {
            const label = REASON_CODE_META[code as ReasonCode]?.label ?? code
            return `        <li><code>${esc(code)}</code> — ${esc(label)}</li>`
          })
          .join("\n")

  return `      <section class="install-authority" aria-label="Authority facts">
      <h2>${escText(titles.authorityFacts)}</h2>
      <ul>
${items}
      </ul>
      <h3 class="install-reason-heading">${escText(titles.reasonCodesHeading)}</h3>
      <ul class="install-reason-codes">
${reasonItems}
      </ul>
    </section>`
}

/**
 * Group 6 — the two secondary links, capped at render time.
 *
 * The links are ordered by how much they serve the reader's decision: the full Trust
 * Page first (the evidence behind this page), then the correction route. A cap of 1
 * therefore drops the correction link, and a cap of 0 emits the section with an empty
 * paragraph rather than deleting the section — configuration narrows what is shown; it
 * does not delete a structural element (ADR 0058 §3).
 *
 * The shipped cap of 2 reproduces the committed bytes exactly, including the `·`
 * separator and the two-space continuation indent.
 */
function secondaryLinksBlock(p: SafeInstallProjection, maxLinks: number): string {
  const links = [
    `<a href="${esc(trustPageUrl(p))}">View the full Trust Page</a>`,
    `<a href="${esc(CORRECTION_URL)}">Report a correction</a>`,
  ].slice(0, Math.max(0, maxLinks))
  const body = links.length === 0 ? "" : `\n          ${links.join(" ·\n          ")}\n        `
  return `      <section class="install-secondary" aria-label="More">
        <p>${body}</p>
      </section>`
}

/**
 * The quarantined publisher block (INV-2.4-05). Rendered ONLY here, always under
 * the fixed label, escaped. Absent when the publisher supplied no description, so
 * a page with no publisher text is byte-stable. It carries NO decision meaning.
 */
function publisherBlock(p: SafeInstallProjection, titles: SectionTitles): string {
  const desc = p.subject.publisherDescription
  if (desc === null || desc === undefined || desc === "") return ""
  return `      <section class="install-publisher" aria-label="Publisher description">
      <h2>${escText(titles.publisherBlock)}</h2>
      <p>${esc(desc)}</p>
    </section>`
}

/**
 * Render the human Install page. Deterministic (pure string build; no clock/RNG).
 * The six decision groups appear in semantic DOM order == visual order; the
 * quarantined publisher block, provenance (with both binding digests, so the
 * HTML↔JSON digest-consistency test can verify one fact object), and the boundary
 * framing follow below the fold. No <script>, no inline `on*` handler.
 *
 * PR P-4b — THIS RENDERER NOW MOVES SERVED BYTES, by exactly two edits per page:
 *
 *   • one `<link rel="stylesheet">` in `<head>`, last, AFTER the agent-contract
 *     `alternate` link. Order is deliberate: the machine relation that makes this
 *     surface agent-readable stays the first thing a parser meets, and a stylesheet
 *     — which no agent needs — does not get inserted ahead of it.
 *   • the boundary sentence, refolded from three source lines to one (−22 B), which
 *     is what let the fourth copy slot be wired at all.
 *
 * Net +34 B per page. The `<link>` is still not JS and still cannot decide anything:
 * ADR 0056 §7's rule is that JS never decides, and CSS cannot even in principle. What
 * CSS *can* do is hide a decision group, which is why the plane it points at is
 * gated for suppression properties rather than trusted.
 *
 * `tokens.stylesheetHref` goes through the ATTRIBUTE escape, not the text one — it
 * lands in an attribute value, and it is the only configured value on this surface
 * that does. `resolvePresentation` additionally refuses any href that is not a
 * single-slash-rooted same-origin path, so configuration cannot point a served page
 * at a third-party sheet.
 */
export function renderSafeInstall(
  p: SafeInstallProjection,
  titles: SectionTitles = SECTION_TITLES,
  layout: ResolvedLayout = DEFAULT_LAYOUT,
  tokens: ResolvedTokens = DEFAULT_TOKENS,
): string {
  const c = p.agentContract
  const version = p.subject.version
  const identityVersion = version ? ` <code>${esc(version)}</code>` : ""

  // One emitter per above-the-fold section, keyed by the section id the structural model
  // declares. Each emitter owns its own leading indentation, so assembling them in the
  // shipped order reproduces the previously-committed bytes EXACTLY — that byte identity
  // is the whole point of restructuring here rather than in PR P-4b, and it is asserted
  // by the reproducibility gate, not assumed.
  //
  // `install-disposition` emits TWO display groups (the verdict headline and the primary
  // CTA) because the shipped markup fuses them. That is why the structural model refuses
  // any order separating them: there is no third emitter to produce.
  const sections: Record<AboveFoldSectionId, () => string> = {
    // The canonical name is emitted ONLY when it differs from the display name.
    //
    // It is the same string on 17 of the 19 shipped pages, where repeating it spent the
    // reader's first line on nothing. But it is NOT decoration: `displayName` is what the
    // publisher calls itself and `canonicalName` is the identity CallLint resolved, so on
    // the pages where they diverge (`calllint-mcp` vs `io.github.calllint-calllint`) the
    // second line is the anti-impersonation signal — exactly the case a reader must see.
    // Dropping the line outright would have removed it there too, so the condition keeps
    // the signal where it carries information and drops the echo where it does not.
    "install-identity": () => `      <section class="install-identity" aria-label="Identity">
        <h1>${esc(p.displayName)}${identityVersion}</h1>${
          p.canonicalName === p.displayName
            ? ""
            : `\n        <p class="install-canonical">Verified identity: <code>${esc(p.canonicalName)}</code></p>`
        }
      </section>`,
    "install-disposition": () => dispositionBlock(p, titles),
    "install-consequence": () => `      <section class="install-consequence" aria-label="Consequence">
        <h2>${escText(titles.consequenceHeading)}</h2>
        <p>${esc(p.consequenceSummary)}</p>
        <p class="install-consequence-lead">${escText(titles.consequenceLead)}</p>
      </section>`,
    "install-authority": () => authorityFactsBlock(p, titles, layout.maxAuthorityFacts),
    "install-secondary": () => secondaryLinksBlock(p, layout.maxSecondaryLinks),
  }
  const aboveFold = layout.sectionOrder.map((id) => sections[id]()).join("\n")

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Add ${esc(p.displayName)} with CallLint</title>
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${esc(`${SITE_ORIGIN}/install/${p.canonicalSlug}/`)}" />
    <link rel="alternate" type="application/vnd.calllint.agent-adoption+json;version=1" href="./index.json" />
    <link rel="stylesheet" href="${esc(tokens.stylesheetHref)}" />
  </head>
  <body>
    <main>
${aboveFold}
${agentReadsBlock(p, titles)}
${publisherBlock(p, titles)}
      <section class="install-provenance" aria-label="Provenance">
        <h2>${escText(titles.provenance)}</h2>
        <ul>
          <li>Verdict: <strong>${esc(p.publicObservation.publicLabel)}</strong></li>
          <li>Artifact digest: <code>${esc(c.subject.artifactDigest)}</code></li>
          <li>Contract digest: <code>${esc(c.contract.contractDigest)}</code></li>
        </ul>
        <p>${escText(titles.boundary)}</p>
      </section>
    </main>
    <script src="${INSTALL_COPY_SCRIPT_SRC}" defer></script>
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
