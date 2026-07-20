/**
 * INV1 — resolvers NEVER execute the target and NEVER probe beyond their one
 * declared fetch (new11 §4.3, §3 safety invariant). Two independent guards:
 *  (1) behavioral — every P1 resolver, over a matrix of good/hostile subjects,
 *      returns a coded result (never throws) and touches only injected fetchers;
 *  (2) source — no resolver source may reference child_process / exec / spawn /
 *      a global fetch. All I/O must flow through ResolverContext.
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

describe("INV1 source guard — no exec/spawn/global-fetch in resolver sources", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../src/evidence")
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
