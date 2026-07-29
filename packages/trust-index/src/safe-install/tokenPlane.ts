// ---------------------------------------------------------------------------
// Workstream P Batch 4 — the L0 (design token) plane, MEASURED (new15 §4.2 PR
// P-4; ADR 0058 §1/§4). PURE: parsing and comparison only, no filesystem.
//
// L0 is ADR 0058's lowest configuration level: "not reachable into any digest,
// and appears only in CSS." The level existed as a declaration from P-1 —
// `LEVEL_BY_SECTION.tokens = "L0"`, a schema `$defs.tokens`, an `l0Digest` —
// but nothing populated it, so `l0Digest` was sha256 of `{}` and the level was
// indistinguishable from one that does not work. PR P-4 populates it.
//
// This file exists so the lock script and the tests measure the token plane
// through ONE implementation instead of describing it twice. The observer /
// evaluator split is the repo's standing pattern: everything here is pure, and
// the file reads live in `scripts/presentation-lock.ts` and the test.
//
// WHY PARSE CSS AT ALL. ADR 0058 §4 forbids PR P-4 from editing the served
// `apps/web/public/styles.css`, so the token values it defines must be
// DUPLICATED into the new plane. Duplication is unavoidable this batch; the
// only real choice is whether it is measured or latent. Parsing both files and
// comparing shared names per-name turns "we copied the palette" into a gate
// that fails when the two drift — which is the coupling P-4b needs, since it
// must not inherit a stale palette.
//
// The parser is deliberately narrow and stated rather than clever. It reads
// custom-property declarations out of a `:root` block and class selectors out
// of rule heads. It is NOT a CSS parser and must never become the thing a
// safety claim rests on: the safety claim is structural (the plane is outside
// the served directory), and these measurements only keep the plane honest
// about itself.
// ---------------------------------------------------------------------------

/** A parsed `--name: value` declaration, value trimmed, `;` stripped. */
export interface CssToken {
  readonly name: string
  readonly value: string
}

/** CSS constructs a token plane may never contain, with why each is refused. */
export const FORBIDDEN_CSS_CONSTRUCTS: readonly { readonly pattern: string; readonly why: string }[] =
  Object.freeze([
    Object.freeze({
      pattern: "@import",
      why: "an @import makes the token plane fetch a second document, so the bytes a page receives would no longer be the bytes this repo commits",
    }),
    Object.freeze({
      pattern: "url(",
      why: "a url() can reference a remote font or image, which would turn a style sheet into a network request on a page whose whole point is offline-verifiable provenance",
    }),
    Object.freeze({
      pattern: "!important",
      why: "!important lets a token override a rule it cannot see, which is how a configuration plane starts winning arguments against code",
    }),
    Object.freeze({
      pattern: "http",
      why: "any absolute URL in the token plane points outside calllint.com's own bytes",
    }),
  ])

/**
 * CSS properties that could HIDE or collapse a decision group. A stylesheet
 * cannot compute a verdict, but it can make one invisible, and an invisible
 * disposition is a safety regression wearing a theme's clothes. So the token
 * plane may style the install surface and may never suppress it.
 *
 * Matched only inside `install-*` rules — the marketing surface is not this
 * batch's business, and a `display` in some unrelated rule is not a finding.
 */
export const SUPPRESSION_PROPERTIES: readonly string[] = Object.freeze([
  "display: none",
  "visibility: hidden",
  "visibility:hidden",
  "display:none",
  "content:",
  "content: ",
])

/** Strip `/* … *\/` comments so a commented-out construct is not a finding. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

/**
 * Parse the custom properties declared in the FIRST `:root { … }` block.
 *
 * First block only, and by design: a second `:root` would silently re-declare
 * tokens with last-wins semantics, so a plane that needed one would be a plane
 * whose values cannot be read off the file. `duplicateNames` reports that case
 * instead of quietly resolving it.
 */
export function parseRootTokens(css: string): {
  readonly tokens: readonly CssToken[]
  readonly duplicateNames: readonly string[]
  readonly rootBlockCount: number
} {
  const body = stripComments(css)
  const blocks = [...body.matchAll(/:root\s*\{([^}]*)\}/g)]
  const first = blocks[0]?.[1] ?? ""
  const seen = new Map<string, number>()
  const tokens: CssToken[] = []
  for (const m of first.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = (m[1] ?? "").trim()
    const value = (m[2] ?? "").trim()
    seen.set(name, (seen.get(name) ?? 0) + 1)
    if ((seen.get(name) ?? 0) === 1) tokens.push({ name, value })
  }
  return {
    tokens: tokens.sort((a, b) => a.name.localeCompare(b.name)),
    duplicateNames: [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([n]) => n)
      .sort(),
    rootBlockCount: blocks.length,
  }
}

/**
 * Every class the sheet MENTIONS anywhere in a selector, e.g. `install-cta`.
 *
 * This is the VOCABULARY measure: it answers "what class names does this plane
 * know about", which is the right scope for asking whether the plane declares a
 * class the renderer never emits (dead configuration).
 *
 * It is the WRONG scope for coverage — see `parseStyledClasses`.
 */
export function parseClassSelectors(css: string): readonly string[] {
  const body = stripComments(css)
  const out = new Set<string>()
  for (const head of ruleHeads(body)) {
    for (const m of head.matchAll(/\.([a-z][a-z0-9_-]*)/gi)) out.add(m[1] as string)
  }
  return [...out].sort()
}

/**
 * Every class that DIRECTLY receives declarations — the subject of at least one
 * selector, e.g. `install-cta` from both `.install-cta { … }` and
 * `.install-cta:hover { … }`.
 *
 * This is the COVERAGE measure, and the distinction from `parseClassSelectors`
 * is load-bearing. A descendant-only mention such as `.install-authority code`
 * styles the `code` element, not the class: counting it as coverage would let
 * the rule that actually styles `.install-authority` be deleted while the
 * coverage number sat unmoved — which is exactly the drift the coverage gate
 * exists to catch.
 */
export function parseStyledClasses(css: string): readonly string[] {
  const out = new Set<string>()
  for (const head of ruleHeads(stripComments(css))) {
    for (const selector of head.split(",")) {
      // The subject is the last compound selector: whatever follows the final
      // descendant space or `>`/`+`/`~` combinator.
      const subject = selector.trim().split(/[\s>+~]+/).pop() ?? ""
      for (const m of subject.matchAll(/\.([a-z][a-z0-9_-]*)/gi)) out.add(m[1] as string)
    }
  }
  return [...out].sort()
}

/** The selector text of each rule — everything before a `{`, comments stripped. */
function ruleHeads(body: string): string[] {
  return [...body.matchAll(/(^|[};])([^{};]+)\{/g)].map((m) => (m[2] ?? "").trim()).filter((h) => h.length > 0)
}

/** Count rule blocks — a coarse "is there anything here" measure. */
export function countCssRules(css: string): number {
  return [...stripComments(css).matchAll(/\{/g)].length
}

/** Forbidden constructs actually present, as `pattern` strings. */
export function forbiddenCssConstructs(css: string): readonly string[] {
  const body = stripComments(css)
  return FORBIDDEN_CSS_CONSTRUCTS.filter((c) => body.includes(c.pattern)).map((c) => c.pattern)
}

/**
 * Suppression properties present inside a rule whose selector mentions an
 * `install-*` class. Returns `"selector → property"` strings.
 */
export function suppressionViolations(css: string): readonly string[] {
  const body = stripComments(css)
  const out: string[] = []
  for (const m of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = (m[1] ?? "").trim()
    const block = (m[2] ?? "").toLowerCase()
    if (!/\.install-/.test(selector)) continue
    for (const prop of SUPPRESSION_PROPERTIES) {
      if (block.includes(prop)) out.push(`${selector} → ${prop.trim()}`)
    }
  }
  return out.sort()
}

/**
 * Compare two token sets by NAME, reporting only names present in both.
 *
 * Shared-names-only is the correct scope: the served marketing sheet may carry
 * tokens the install surface has no use for, and the install plane may later
 * add its own. Neither is drift. A shared name holding two different values IS
 * drift — that is the palette splitting in two.
 */
export function tokenDrift(
  plane: readonly CssToken[],
  served: readonly CssToken[],
): {
  readonly sharedNames: readonly string[]
  readonly drifted: readonly { readonly name: string; readonly plane: string; readonly served: string }[]
} {
  const servedByName = new Map(served.map((t) => [t.name, t.value]))
  const shared = plane.filter((t) => servedByName.has(t.name))
  return {
    sharedNames: shared.map((t) => t.name).sort(),
    drifted: shared
      .filter((t) => servedByName.get(t.name) !== t.value)
      .map((t) => ({ name: t.name, plane: t.value, served: servedByName.get(t.name) as string }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/**
 * The class names the install renderer actually emits, read out of rendered
 * HTML. Derived from real bytes so the coverage check cannot drift from the
 * renderer the way a hardcoded list would.
 */
export function emittedInstallClasses(html: string): readonly string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const cls of (m[1] as string).split(/\s+/)) {
      if (cls.startsWith("install-")) out.add(cls)
    }
  }
  return [...out].sort()
}
