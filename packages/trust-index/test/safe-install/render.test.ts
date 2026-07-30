/**
 * Human Install renderer + Contract sidecar acceptance tests (Phase 2.4 Batch 2;
 * ADR 0056 §7 / new14-integration §7). These pin, at the SOURCE, the invariants a
 * regression must never silently break:
 *
 *   • ONE fact object drives both surfaces (INV-2.4-01): the HTML's binding digests
 *     (artifact + contract) are byte-identical to the JSON sidecar's.
 *   • Exactly ONE primary CTA, state-correct; BLOCK/UNSUPPORTED never offer a
 *     prepare/apply command (plan §6.7 / INV-2.4-08).
 *   • Six decision groups in semantic DOM order == visual order (§7).
 *   • JS never decides: only the ADR 0059 copy-assist script, no inline on* (§7).
 *   • Publisher text is quarantined + labeled, never in a decision group (INV-2.4-05).
 *   • No forbidden overclaim/coercion copy — BOTH the Trust-Page and Safe-install sets.
 *   • Deterministic: byte-identical re-render.
 *
 * Pure: no I/O, no clock, no network.
 */
import { describe, it, expect } from "vitest"
import {
  CLI_VERSION,
  fixtureCohort,
  bakeTrustPage,
  safeInstallProjection,
  renderSafeInstall,
  renderSafeInstallContract,
  INSTALL_COPY_SCRIPT_SRC,
  TRUST_PAGE_FORBIDDEN_PHRASES,
  SAFE_INSTALL_FORBIDDEN_PHRASES,
  type BakedTrustPage,
  type AdoptionSubjectInput,
  type SafeInstallProjection,
  type SafeInstallProjectionInput,
} from "../../src/index.js"

const pages: BakedTrustPage[] = fixtureCohort()
  .filter((e) => e.case.expect !== "parse-error")
  .map((e) => bakeTrustPage(e.input))

function subjectFor(page: BakedTrustPage, over: Partial<AdoptionSubjectInput> = {}): AdoptionSubjectInput {
  const slug = page.canonicalName
  return {
    canonicalName: page.canonicalName,
    canonicalSlug: slug,
    packageType: "npm",
    packageName: "@fixture/" + slug.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
    version: "1.4.2",
    sourceLocator: "npm:@fixture@1.4.2",
    publisherDescription: null,
    ...over,
  }
}

function project(page: BakedTrustPage, over: Partial<SafeInstallProjectionInput> = {}): SafeInstallProjection {
  return safeInstallProjection({
    page,
    subject: subjectFor(page, over.subject),
    snapshotDigest: "sha256:" + "a".repeat(64),
    registrySnapshotDigest: "sha256:" + "b".repeat(64),
    evidenceDigest: "sha256:" + "c".repeat(64),
    engineVersion: "9.9.9",
    ...over,
  })
}

const anyPage = pages[0]!

describe("renderSafeInstall — one fact object drives HTML + JSON (INV-2.4-01)", () => {
  it("the HTML's binding digests are byte-identical to the JSON sidecar's", () => {
    for (const page of pages) {
      const p = project(page)
      const html = renderSafeInstall(p)
      const json = JSON.parse(renderSafeInstallContract(p))
      const artifact = html.match(/Artifact digest: <code>(sha256:[0-9a-f]{64})<\/code>/)?.[1]
      const contract = html.match(/Contract digest: <code>(sha256:[0-9a-f]{64})<\/code>/)?.[1]
      expect(artifact, "HTML must show the artifact digest").toBe(json.subject.artifactDigest)
      expect(contract, "HTML must show the contract digest").toBe(json.contract.contractDigest)
    }
  })

  it("the sidecar is the sealed contract verbatim (canonical, trailing newline)", () => {
    const p = project(anyPage)
    expect(renderSafeInstallContract(p)).toBe(JSON.stringify(p.agentContract, null, 2) + "\n")
  })
})

/**
 * The renderer's attribute escape, restated here because it is not exported. A display
 * name containing `&` or a quote must be compared in its ESCAPED form — comparing the raw
 * name would pass today only because no fixture happens to contain one.
 */
function escForTest(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

describe("renderSafeInstall — exactly one primary CTA, state-correct (plan §6.7)", () => {
  it("renders exactly one primary-action anchor per page", () => {
    for (const page of pages) {
      const html = renderSafeInstall(project(page))
      expect((html.match(/data-primary-action=/g) ?? []).length).toBe(1)
      expect((html.match(/class="install-cta"/g) ?? []).length).toBe(1)
    }
  })

  it("the CTA copy matches the projection's humanDisposition and NAMES ITS TARGET", () => {
    for (const page of pages) {
      const p = project(page)
      const html = renderSafeInstall(p)
      // R-2: the anchor now closes with "<verb phrase> <display name>", so the assertion
      // is on that composed ending rather than on the phrase alone. Anchoring to `</a>`
      // keeps it a check on the CTA's real text and not a substring found anywhere.
      expect(html).toContain(`${p.humanDisposition.primaryCta} ${escForTest(p.displayName)}</a>`)
      expect(html).not.toMatch(/>Install<\/a>/)
    }
  })

  it("BLOCK and UNSUPPORTED CTAs are documentation links — never a prepare/apply command", () => {
    const block = project(pages.find((pg) => pg.verdict === "BLOCK") ?? anyPage)
    const unsupported = project(anyPage, { unsupported: true })
    for (const p of [block, unsupported]) {
      const html = renderSafeInstall(p)
      const href = html.match(/class="install-cta"[\s\S]*?href="([^"]+)"/)?.[1] ?? ""
      expect(href.startsWith("https://calllint.com/docs/")).toBe(true)
      // The human CTA is never a shell command or a live apply.
      expect(href).not.toMatch(/^(npx|calllint|pnpm|npm) /)
    }
  })

  it("the CTA note states which of the two things the link does, per state", () => {
    // No SHIPPED page is in a non-deep-link state (all 19 are REVIEW_REQUIRED or
    // PREPARE_AVAILABLE), so without this the docs-anchor branch and its note would
    // ship unexercised by anything.
    const deep = project(pages.find((pg) => pg.verdict !== "BLOCK") ?? anyPage)
    const deepHtml = renderSafeInstall(deep)
    // Dual equal CTAs: Open (deep link, gate primary) + copy CLI install.
    expect(deepHtml).toContain('class="install-cta-row"')
    expect(deepHtml).toContain('data-deep-link="true"')
    expect(deepHtml).toMatch(/class="install-cta"[^>]*href="calllint:\/\//)
    expect(deepHtml).toContain("I don't have CallLint yet")
    expect(deepHtml).toContain(`data-copy-text="npm i -g calllint@${CLI_VERSION}"`)
    expect(deepHtml).toContain("install, then click Open on the left")
    expect(deepHtml).toContain('id="install-command"')
    expect(deepHtml).toContain("Or add this MCP now")
    expect(deepHtml).toContain("Full command with artifact digest")
    expect(deepHtml).toContain('class="install-copy"')

    for (const p of [
      project(pages.find((pg) => pg.verdict === "BLOCK") ?? anyPage),
      project(anyPage, { unsupported: true }),
    ]) {
      const html = renderSafeInstall(p)
      expect(html).toContain('data-deep-link="false"')
      expect(html).toContain("Opens the documentation for this verdict")
      expect(html).not.toContain("I don't have CallLint yet")
      expect(html).not.toContain("install-cta-row")
      expect(html).not.toContain("install-primary-path")
      expect(html).not.toContain("install-badge")
    }
  })

  it("the visible short command omits the digest; the full command still carries it", () => {
    for (const page of pages) {
      const p = project(page)
      const html = renderSafeInstall(p)
      const short = /class="install-fallback"[^>]*>[\s\S]*?<code>([\s\S]*?)<\/code>/.exec(html)?.[1] ?? ""
      if (html.includes('id="install-command-full"')) {
        const full = /id="install-command-full"[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1] ?? ""
        expect(short).not.toContain("--expect-artifact-digest")
        expect(short).toMatch(/--apply\b/)
        expect(full).toContain("--expect-artifact-digest")
        expect(full).toContain(p.agentContract.subject.artifactDigest)
        expect(full).toMatch(/--apply\b/)
        expect(full).not.toMatch(/--approve\b/)
        expect(full).not.toMatch(/--plan-out\b/)
      } else {
        // Docs-primary pages still show the full muted command in the single code block.
        expect(short).toContain("--expect-artifact-digest")
        expect(short).toContain(p.agentContract.subject.artifactDigest)
        expect(short).toMatch(/--apply\b/)
      }
    }
  })

  it("the authority glyph maps observed→warning and absent→check, NOT the reverse", () => {
    // The inversion is the one thing a reader can get exactly backwards, so it is pinned:
    // `observed: true` means the capability was SEEN, which is the cautionary case.
    let checked = 0
    const seen = new Set<string>()
    for (const page of pages) {
      const html = renderSafeInstall(project(page))
      for (const [, observed, cls] of html.matchAll(
        /<li data-observed="(true|false)"><span class="install-authority-mark (is-observed|is-absent)"/g,
      )) {
        expect(cls).toBe(observed === "true" ? "is-observed" : "is-absent")
        seen.add(observed as string)
        checked++
      }
    }
    // Anti-vacuity: a regex that matched nothing would pass the loop above perfectly.
    // Both branches must be present too, or the mapping is only half-tested.
    expect(checked).toBeGreaterThan(0)
    expect([...seen].sort()).toEqual(["false", "true"])
  })

  it("an UNSUPPORTED page routes to EXPLAIN_ONLY with no command (INV-2.4-08)", () => {
    const p = project(anyPage, { unsupported: true })
    expect(p.installability).toBe("UNSUPPORTED")
    expect(p.agentContract.recommendedNextAction.kind).toBe("EXPLAIN_ONLY")
    expect(renderSafeInstall(p)).toContain('data-primary-action="UNSUPPORTED"')
  })
})

describe("renderSafeInstall — six decision groups, semantic DOM order (§7)", () => {
  it("emits identity → disposition → consequence → authority → secondary in that order", () => {
    const html = renderSafeInstall(project(anyPage))
    const order = [
      "install-identity",
      "install-disposition",
      "install-consequence",
      "install-authority",
      "install-secondary",
    ].map((cls) => html.indexOf(`class="${cls}"`))
    for (const idx of order) expect(idx).toBeGreaterThan(-1)
    const sorted = [...order].sort((a, b) => a - b)
    expect(order).toEqual(sorted)
  })

  it("shows at most three authority facts (plan §6.6)", () => {
    for (const page of pages) {
      const p = project(page)
      const html = renderSafeInstall(p)
      const items = (html.match(/data-observed=/g) ?? []).length
      expect(items).toBe(p.authorityDecisionFacts.length)
      expect(items).toBeLessThanOrEqual(5)
    }
  })
})

describe("renderSafeInstall — the first-run path actually runs (R-2)", () => {
  it("pins CLI_VERSION to the published CLI manifest", async () => {
    // The page tells a visitor to run `npx calllint@<CLI_VERSION>`. If the CLI ships 1.8.0
    // and this constant stays at 1.7.3, every Install page points at a stale version; if
    // the constant is bumped ahead of a publish, it points at one that does not exist.
    // Neither is visible in a byte-diff of the page, so it is pinned here instead.
    const { readFile } = await import("node:fs/promises")
    const manifest = JSON.parse(
      await readFile(new URL("../../../../apps/cli/package.json", import.meta.url), "utf8"),
    ) as { version: string }
    expect(CLI_VERSION).toBe(manifest.version)
  })

  it("the fallback command needs no pre-existing install, applies, and never self-approves", () => {
    for (const page of pages) {
      const html = renderSafeInstall(project(page))
      const cmd = /class="install-fallback"[^>]*>[\s\S]*?<code>([^<]*)<\/code>/.exec(html)?.[1]
      expect(cmd, page.canonicalName).toBeTruthy()
      // `npx` is the whole point: a bare `calllint …` assumed the binary was already on
      // PATH, i.e. it had the same precondition as the dead deep link it was rescuing.
      expect(cmd!.startsWith(`npx calllint@${CLI_VERSION} `)).toBe(true)
      // Pinned, so the verifier is not whatever `latest` happens to be at click time.
      expect(cmd!).not.toMatch(/npx calllint /)
      // INVERTED FROM `not.toContain("--apply")` (ADR 0057 §6), deliberately, because the
      // original assertion pinned the defect: a command with no write flag ends at
      // PREPARED, so the one route available to a visitor without CallLint could not
      // finish the install it was offered for. Interactive `--apply` now prints the
      // resolved plan and blocks on a real TTY for a typed `yes`, so the human authorizes
      // bytes they have read — which is the property the missing flag was standing in for.
      expect(cmd!).toContain("--apply")
      // `--approve` SKIPS the human. On a command published for strangers to paste, it is
      // the one flag that must never appear, whatever else changes here. Same for
      // `--plan-out`: a page-published command must not tell a machine to write a plan
      // file somewhere the visitor did not choose.
      expect(cmd!).not.toContain("--approve")
      expect(cmd!).not.toContain("--plan-out")
    }
  })

  it("no visible copy claims the page installs or adds anything by itself", () => {
    // A regression guard for a real defect, not a hypothetical: the shipped fallback
    // sentence once read "This one command installs it and adds the server", while the
    // argv it introduced carried no --apply and returned PREPARED / "NOT applied"
    // (apps/cli/src/commands/safeInstall.ts). Copy that promises a write the command
    // structurally cannot perform is the acquisition-surface overclaim SAFE_INSTALL_
    // FORBIDDEN_PHRASES exists to stop — but phrase lists only catch phrasings someone
    // already thought of, and no assertion covered the verb. This covers the verb.
    //
    // The command was since given `--apply` (ADR 0057 §6), so that particular sentence
    // would now be TRUE — and these patterns still stay, because what they actually guard
    // is the subject of the verb. The PAGE writes nothing: no <script>, no handler, no
    // fetch. A visitor who reads "this installs" while looking at a document that cannot
    // install has been told the wrong thing about where authority lives, independent of
    // what some command elsewhere can do. The command's own honest description lives in
    // the fallback sentence, pinned by the --apply assertion above.
    //
    // Also pins the badge: "Continuously protected" was false twice over — this page
    // installs nothing, and continuous Guard is a separate ASK_AFTER_SUCCESS offer
    // defaulting to [Not now] (INV-2.4-07).
    const claimsAWrite = [
      /\binstalls it and adds\b/i,
      /\bthis (?:one )?command installs\b/i,
      /\bcontinuously protected\b/i,
      /\bautomatically (?:installs|adds|enables)\b/i,
      /\balready protected\b/i,
    ]
    for (const page of pages) {
      const visible = renderSafeInstall(project(page)).replace(/<[^>]*>/g, " ")
      for (const claim of claimsAWrite) expect(visible).not.toMatch(claim)
    }
  })
})

describe("renderSafeInstall — JS never decides (§7 / ADR 0059)", () => {
  it("carries only the whitelist copy-assist script and no inline on* handler", () => {
    for (const page of pages) {
      const html = renderSafeInstall(project(page))
      expect(html).toContain(`src="${INSTALL_COPY_SCRIPT_SRC}"`)
      expect(html).not.toMatch(/\son[a-z]+=/i)
      expect(html).not.toMatch(/<script\b[^>]*>\s*[^<\s]/i)
    }
  })
})

describe("renderSafeInstall — publisher text quarantined + labeled (INV-2.4-05)", () => {
  const MARK = "Publisher-provided description — not used for CallLint's safety decision."

  it("renders publisher text ONLY under the fixed label, escaped", () => {
    const p = project(anyPage, {
      subject: subjectFor(anyPage, { publisherDescription: "Best & <safest> \"tool\"" }),
    })
    const html = renderSafeInstall(p)
    expect(html).toContain(MARK)
    expect(html).toContain("Best &amp; &lt;safest&gt; &quot;tool&quot;")
    // The label sits AFTER the five decision groups (below the fold).
    expect(html.indexOf(MARK)).toBeGreaterThan(html.indexOf('class="install-secondary"'))
  })

  it("omits the publisher block entirely when there is no description (byte-stable)", () => {
    const html = renderSafeInstall(project(anyPage, { subject: subjectFor(anyPage, { publisherDescription: null }) }))
    expect(html).not.toContain("install-publisher")
    expect(html).not.toContain(MARK)
  })

  it("publisher text never changes the sealed contract digest", () => {
    const bare = project(anyPage, { subject: subjectFor(anyPage, { publisherDescription: null }) })
    const withText = project(anyPage, {
      subject: subjectFor(anyPage, { publisherDescription: "totally safe, trust me" }),
    })
    expect(withText.agentContract.contract.contractDigest).toBe(bare.agentContract.contract.contractDigest)
  })
})

describe("renderSafeInstall — language boundary + framing", () => {
  it("uses no forbidden phrase from EITHER set (Trust-Page + Safe-install)", () => {
    for (const page of pages) {
      const lc = renderSafeInstall(project(page)).toLowerCase()
      for (const phrase of [...TRUST_PAGE_FORBIDDEN_PHRASES, ...SAFE_INSTALL_FORBIDDEN_PHRASES]) {
        expect(lc, `page ${page.canonicalName}: "${phrase}"`).not.toContain(phrase.toLowerCase())
      }
    }
  })

  it("carries the boundary disclaimer + a correction link (public-copy guard 16)", () => {
    const html = renderSafeInstall(project(anyPage))
    expect(html).toContain("not a certification")
    expect(html).toContain("guarantee of safety")
    expect(html).toContain("Report a correction")
  })

  it("carries no email-like PII token (check 17)", () => {
    const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    const p = project(anyPage, {
      subject: subjectFor(anyPage, { publisherDescription: "contact me", sourceLocator: "npm:@x@1.0.0" }),
    })
    expect(EMAIL.test(renderSafeInstall(p))).toBe(false)
  })
})

describe("renderSafeInstall — deterministic (reproducibility gate)", () => {
  it("is byte-identical across renders of the same projection", () => {
    for (const page of pages) {
      const p = project(page)
      expect(renderSafeInstall(p)).toBe(renderSafeInstall(p))
      expect(renderSafeInstallContract(p)).toBe(renderSafeInstallContract(p))
    }
  })
})
