/**
 * INV1 — resolvers NEVER execute the target and NEVER probe beyond their one
 * declared fetch (new11 §4.3, §3 safety invariant). THREE independent guards:
 *  (1) behavioral — every P1 resolver, over a matrix of good/hostile subjects,
 *      returns a coded result (never throws) and touches only injected fetchers;
 *  (2) source — no resolver source may reference child_process / exec / spawn /
 *      a global fetch. All I/O must flow through ResolverContext.
 *  (3) capability set — ResolverContext declares EXACTLY three capabilities, and
 *      the closed enumeration is the point (see below).
 *
 * WHY (3) EXISTS, measured rather than assumed. R-5's negative control #63 adds a CAS
 * blob capability to `ResolverContext` to prove the Observed/Inferred boundary is
 * enforced. Applied as a REQUIRED field it produces 12 typecheck errors — but applied
 * the way a real author would add a capability to a shipped interface, `readBlob?:`,
 * it produced a clean `pnpm typecheck` and 158/158 passing tests. Nothing failed.
 *
 * That green run is a finding about this harness, not a pass. Guard (2) reads resolver
 * SOURCES for capability tokens, so it cannot see a capability handed in through the
 * context; and an optional field breaks no caller, so the type system has nothing to
 * object to. The boundary was resting entirely on review.
 *
 * The distinction guard (3) protects: P1 resolvers answer what a registry, repo or
 * domain CLAIMS (Inferred, over the network). R-5's evidence compiler answers what
 * VERIFIED BYTES CONTAIN (Observed, from the CAS). Fusing them into one context makes
 * the two indistinguishable downstream — the same fusion R-4 refused when it kept
 * `registry_integrity` and `immutable_digest` as two columns that are never compared
 * for equality. R-5 therefore adds a SECOND port at the adoption-index edge and never
 * widens this one.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { P1_RESOLVERS } from "../../src/evidence/index.js"
import type { EvidenceSubject } from "@calllint/evidence"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"

const SUBJECTS: EvidenceSubject[] = [
  { schema: "calllint.evidence-subject.v0", subjectType: "npm-package", id: "x@1.0.0" },
  { schema: "calllint.evidence-subject.v0", subjectType: "github-repo", id: "o/r" },
  { schema: "calllint.evidence-subject.v0", subjectType: "mcp-registry-entry", id: "io.x/y" },
  { schema: "calllint.evidence-subject.v0", subjectType: "domain", id: "x.com" },
  { schema: "calllint.evidence-subject.v0", subjectType: "tool", id: "https://x/t.json" },
  { schema: "calllint.evidence-subject.v0", subjectType: "remote-endpoint", id: "https://x.com" },
  // hostile / malformed ids — must still never throw:
  { schema: "calllint.evidence-subject.v0", subjectType: "npm-package", id: "" },
  { schema: "calllint.evidence-subject.v0", subjectType: "domain", id: "'; rm -rf / #" },
  { schema: "calllint.evidence-subject.v0", subjectType: "remote-endpoint", id: "file:///etc/passwd" },
]

describe("INV1 behavioral — never throws, never probes off-path", () => {
  it("every resolver returns a coded result for every subject, throwing fetchers", async () => {
    const ctx: ResolverContext = {
      fetchJson: async () => { throw new Error("network denied") },
      fetchText: async () => { throw new Error("network denied") },
      resolvedAt: "2026-07-20T00:00:00.000Z",
    }
    for (const r of P1_RESOLVERS) {
      for (const s of SUBJECTS) {
        const res = await r.resolve(s, ctx)
        expect(res.resolver).toBe(r.id)
        // Either it produced items or it produced gaps — never a silent empty pass.
        expect(res.items.length + res.gaps.length).toBeGreaterThan(0)
      }
    }
  })
})

/** The resolver source directory, shared by guards (2) and (3). */
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../src/evidence")

describe("INV1 source guard — no exec/spawn/global-fetch in resolver sources", () => {
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts"))

  // Forbidden capability tokens. Word-boundary-ish patterns so prose like
  // "executes" / "spawned" in comments does not trip the guard.
  const FORBIDDEN: [string, RegExp][] = [
    ["child_process", /child_process/],
    [".exec(", /\.exec\(/],
    ["spawn(", /\bspawn\(/],
    ["execSync(", /\bexecSync\(/],
    ["global fetch(", /(^|[^.\w])fetch\(/m],
  ]

  it("scans every resolver source file", () => {
    expect(sources.length).toBeGreaterThanOrEqual(6)
  })

  it.each(["npmResolver.ts", "githubResolver.ts", "registryResolver.ts", "domainResolver.ts", "toolResolver.ts", "remoteResolver.ts"])(
    "%s contains no forbidden capability token",
    (file) => {
      const src = readFileSync(join(dir, file), "utf8")
      for (const [label, re] of FORBIDDEN) {
        expect(re.test(src), `${file} must not use ${label}`).toBe(false)
      }
    },
  )
})

describe("INV1 capability set — ResolverContext grants EXACTLY three capabilities", () => {
  /**
   * Read the DECLARATION, not a value. An optional field is erased at runtime, so
   * `Object.keys(someCtx)` cannot see `readBlob?:` — and optional is precisely the
   * form a real author reaches for, because it breaks no existing caller. Parsing the
   * source is what makes control #63 fire in its realistic form.
   */
  const ifaceSrc = readFileSync(join(dir, "resolverInterface.ts"), "utf8")

  const body = /export interface ResolverContext \{([\s\S]*?)\n\}/.exec(ifaceSrc)?.[1]

  it("the ResolverContext declaration is locatable (vacuity guard)", () => {
    // Without this, a rename would empty the field set and every assertion below
    // would pass over nothing — the shape of vacuous-green this file exists to refuse.
    expect(body, "could not locate `export interface ResolverContext { ... }`").toBeDefined()
  })

  /** Declared field names, `?` stripped, comments and blank lines dropped. */
  const declared = (body ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("*") && !l.startsWith("/") && !l.startsWith("//"))
    .map((l) => /^([A-Za-z_$][\w$]*)\??\s*:/.exec(l)?.[1])
    .filter((n): n is string => n !== undefined)

  it("declares exactly fetchJson, fetchText, resolvedAt — and nothing else", () => {
    // A CLOSED enumeration. Any added capability — optional or required, however
    // reasonable — fails here and must be argued for, not slipped in. A blob reader is
    // the specific case control #63 exercises; the assertion is deliberately general
    // because the next capability nobody predicted is the one that needs catching.
    expect([...declared].sort()).toEqual(["fetchJson", "fetchText", "resolvedAt"])
  })

  it("grants no filesystem, blob, CAS or process capability by type either", () => {
    // A capability can also arrive without a new field, by widening an existing one's
    // TYPE (`fetchText: FetchText | ReadBlob`). Names alone would not see that.
    const FORBIDDEN_TYPES: [string, RegExp][] = [
      ["a blob reader", /\bblob\b/i],
      ["CAS access", /\bcas\b/i],
      ["a digest-keyed reader", /\bdigest\b/i],
      ["Uint8Array bytes", /\bUint8Array\b/],
      ["Buffer bytes", /\bBuffer\b/],
      ["a filesystem handle", /\bnode:fs\b|\breadFile|\bwriteFile/],
      ["a process handle", /child_process|\bspawn\b|\bexec\b/],
    ]
    for (const [label, re] of FORBIDDEN_TYPES) {
      expect(re.test(body ?? ""), `ResolverContext must not grant ${label}`).toBe(false)
    }
  })
})
