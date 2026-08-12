import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { emitAllCohorts, type ExpansionCandidate } from "../src/emitCohort.js"
import {
  resolveArtifactsEnabled,
  resolveEvidenceEnabled,
  resolveMaxEntries,
  resolveMirrorMaxEntries,
  resolveMirrorMaxPages,
} from "../src/refreshSnapshot.js"
import { DEFAULT_MAX_ENTRIES } from "../src/fetchRegistry.js"
import { DEFAULT_MIRROR_MAX_ENTRIES, DEFAULT_MAX_PAGES, PAGE_SIZE } from "@calllint/adoption-index"
import { hashJson } from "@calllint/fingerprint"
import { adoptionBasisPolicy, defaultPolicy } from "@calllint/policy"
import { engineVersion } from "../src/bake.js"
import { mergeResults, type EvidenceSubject, type ResolverResult } from "@calllint/evidence"

/**
 * Phase C — Trust Index scale-out, CODE-READY (I1).
 *
 * Two seams make future scale-out (37 → 100+) possible AND safe by construction,
 * without changing the committed seed:
 *   1. `resolveMaxEntries` parameterizes the ADR 0038 §6 cap (fail-safe fallback).
 *   2. `emitAllCohorts(..., expansion)` gates each expansion candidate through the
 *      §4.7 publish-eligibility check — eligible ⇒ baked, ineligible ⇒ incomplete
 *      with the failing criteria — while an EMPTY expansion list (today's reality)
 *      emits byte-identically to the seed (the reproducibility gate stays green).
 */

// ── §4.7 gate over expansion candidates ───────────────────────────────────────

const subject: EvidenceSubject = {
  schema: "calllint.evidence-subject.v0",
  subjectType: "npm-package",
  id: "npm:acme-mcp@2.0.0",
}

/** A fully-resolved bundle: identity name + exact version, no gaps → §4.7-eligible. */
function eligibleBundle() {
  const r: ResolverResult = {
    resolver: "R1:npm",
    status: "complete",
    items: [
      { field: "identity.name", value: "acme-mcp", tier: "registry", source: "R1:npm" },
      { field: "identity.version", value: "2.0.0", tier: "registry", source: "R1:npm" },
    ],
    gaps: [],
  }
  return mergeResults(subject, [r])
}

/** A partial bundle: name only, no version → fails `exact-version-or-digest`. */
function ineligibleBundle() {
  const r: ResolverResult = {
    resolver: "R1:npm",
    status: "partial",
    items: [{ field: "identity.name", value: "acme-mcp", tier: "registry", source: "R1:npm" }],
    gaps: [],
  }
  return mergeResults(subject, [r])
}

const CONFIG = JSON.stringify({ mcpServers: { acme: { command: "npx", args: ["-y", "acme-mcp@2.0.0"] } } })

function candidate(bundle: ReturnType<typeof eligibleBundle>, verdictBound: boolean): ExpansionCandidate {
  return {
    input: {
      canonicalName: "expansion/acme-mcp",
      configText: CONFIG,
      sourceLabel: "expansion:test",
      observedAt: "2026-07-21T00:00:00.000Z",
    },
    bundle,
    verdictBound,
  }
}

describe("expansion eligibility gate (§4.7)", () => {
  it("an eligible + verdict-bound candidate is BAKED as a page", () => {
    const out = emitAllCohorts(null, undefined, null, [candidate(eligibleBundle(), true)])
    expect(out.baked).toBeGreaterThan(0)
    // its page files exist
    expect(out.files.some((f) => f.path === "expansion/acme-mcp.json")).toBe(true)
    expect(out.files.some((f) => f.path === "expansion/acme-mcp.html")).toBe(true)
    // and the index records it baked under the expansion cohort
    const index = JSON.parse(out.files.find((f) => f.path === "index.json")!.content)
    expect(index.cohorts).toContain("expansion")
    const entry = index.entries.find((e: { canonicalName: string }) => e.canonicalName === "expansion/acme-mcp")
    expect(entry.status).toBe("baked")
  })

  it("an ineligible candidate is INCOMPLETE, never a page, with the failing criterion", () => {
    const out = emitAllCohorts(null, undefined, null, [candidate(ineligibleBundle(), true)])
    expect(out.files.some((f) => f.path.startsWith("expansion/acme-mcp."))).toBe(false)
    const index = JSON.parse(out.files.find((f) => f.path === "index.json")!.content)
    const entry = index.entries.find((e: { canonicalName: string }) => e.canonicalName === "expansion/acme-mcp")
    expect(entry.status).toBe("incomplete")
    expect(entry.reason).toContain("§4.7")
    expect(entry.reason).toContain("exact-version-or-digest")
  })

  it("fails CLOSED: an eligible bundle with NO bound verdict is withheld", () => {
    const out = emitAllCohorts(null, undefined, null, [candidate(eligibleBundle(), false)])
    const index = JSON.parse(out.files.find((f) => f.path === "index.json")!.content)
    const entry = index.entries.find((e: { canonicalName: string }) => e.canonicalName === "expansion/acme-mcp")
    expect(entry.status).toBe("incomplete")
    expect(entry.reason).toContain("verdict-bound")
  })
})

describe("no-expansion emit is byte-identical to the seed (reproducibility preserved)", () => {
  it("emitAllCohorts() with default (empty) expansion == the 3-arg call", () => {
    const withDefault = emitAllCohorts(null)
    const withEmptyExpansion = emitAllCohorts(null, undefined, null, [])
    expect(withEmptyExpansion.files.map((f) => f.path + "\0" + f.content)).toEqual(
      withDefault.files.map((f) => f.path + "\0" + f.content),
    )
    // and the cohorts label is unchanged (no "expansion" appended)
    const idx = JSON.parse(withEmptyExpansion.files.find((f) => f.path === "index.json")!.content)
    expect(idx.cohorts).toEqual(["fixtures"])
  })
})

// ── cap parameterization (ADR 0038 §6) ────────────────────────────────────────

describe("resolveMaxEntries — parameterized cap, fail-safe", () => {
  it("defaults to DEFAULT_MAX_ENTRIES when unset or empty", () => {
    expect(resolveMaxEntries({})).toBe(DEFAULT_MAX_ENTRIES)
    expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: "" })).toBe(DEFAULT_MAX_ENTRIES)
    expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: "   " })).toBe(DEFAULT_MAX_ENTRIES)
  })

  it("honors a valid positive integer override (scale-out)", () => {
    expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: "100" })).toBe(100)
    expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: "1000" })).toBe(1000)
  })

  it("falls back to the default on invalid input (fail-safe, never unbounded/empty)", () => {
    for (const bad of ["0", "-5", "abc", "12.5", "NaN"]) {
      expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: bad })).toBe(DEFAULT_MAX_ENTRIES)
    }
  })
})

// ── the RAW-READ ceiling — a different quantity from the cap above (R-1) ───────

/**
 * `resolveMirrorMaxEntries` bounds how many raw records the mirror READS, in arrival order,
 * before any filter. `resolveMaxEntries` bounds how many entries the snapshot EMITS, after
 * filtering to live records and sorting by name. The two count different populations, and the
 * mirror's must be STRICTLY greater — live records are a subset of read records, so emitting
 * N requires reading at least N, and `paginate` flags `capReached` at `yielded >= maxEntries`.
 *
 * The env var is read here rather than in the operation because `refreshFromMirror` takes the
 * resolved number; there is no ambient env access inside `@calllint/adoption-index`.
 */
describe("resolveMirrorMaxEntries — the raw-read ceiling, fail-safe and strictly above the cap", () => {
  it("defaults to DEFAULT_MIRROR_MAX_ENTRIES when unset, empty, or whitespace", () => {
    expect(resolveMirrorMaxEntries({}, DEFAULT_MAX_ENTRIES)).toBe(DEFAULT_MIRROR_MAX_ENTRIES)
    expect(resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: "" }, DEFAULT_MAX_ENTRIES)).toBe(
      DEFAULT_MIRROR_MAX_ENTRIES,
    )
    expect(resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: "   " }, DEFAULT_MAX_ENTRIES)).toBe(
      DEFAULT_MIRROR_MAX_ENTRIES,
    )
  })

  it("honors a valid integer strictly above the snapshot cap", () => {
    expect(resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: "5000" }, DEFAULT_MAX_ENTRIES)).toBe(5000)
    // Below the default but still strictly above the snapshot cap: honoured, because the
    // invariant is the inequality, not the constant. An operator may legitimately LOWER the
    // read ceiling for a bounded run.
    //
    // DERIVED, not literal — and this line is why. It read `"26"` while the cap was 25, which was
    // the SMALLEST honoured value then. ADR 0074 raised the cap to 100, and 26 silently became a
    // REFUSED value: the assertion would have red claiming the resolver broke, when what had
    // changed was the test's own hidden dependency on the old cap. Written as `cap + 1` the case
    // stays "the smallest honoured value" at every cap, which is what the comment above already
    // claimed the test was doing.
    const justAboveCap = DEFAULT_MAX_ENTRIES + 1
    expect(
      resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: String(justAboveCap) }, DEFAULT_MAX_ENTRIES),
    ).toBe(justAboveCap)
  })

  it("falls back on invalid input, the same shapes as the snapshot cap", () => {
    for (const bad of ["0", "-5", "abc", "12.5", "NaN"]) {
      expect(resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: bad }, DEFAULT_MAX_ENTRIES)).toBe(
        DEFAULT_MIRROR_MAX_ENTRIES,
      )
    }
  })

  it("REFUSES a ceiling at or below the snapshot cap, raising it to the floor instead", () => {
    // The distinguishing behaviour, and the reason `<=` rather than `<`: honouring either
    // value would guarantee a read whose only outcome is the fail-closed MirrorIncompleteError.
    // `cap - 1` (below) is obviously wrong; `cap` (EQUAL) is the subtle one — reading exactly as
    // many records as the snapshot emits makes the snapshot's cap structurally unreachable, since
    // the mirror also stores the records the snapshot drops.
    //
    // Both derived from the cap. The below-case was the literal `"24"`, which stayed GREEN when ADR
    // 0074 raised the cap to 100 — but 24 is then 76 below the boundary, so the case no longer
    // measured the boundary it was written for. A green assertion that stopped testing its subject
    // is the failure mode the equal-case never had, because it was already derived.
    expect(
      resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: String(DEFAULT_MAX_ENTRIES - 1) }, DEFAULT_MAX_ENTRIES),
    ).toBe(DEFAULT_MIRROR_MAX_ENTRIES)
    expect(
      resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: String(DEFAULT_MAX_ENTRIES) }, DEFAULT_MAX_ENTRIES),
    ).toBe(DEFAULT_MIRROR_MAX_ENTRIES)
  })

  it("derives the floor, so the FALLBACK itself never violates the inequality", () => {
    // A scale-out run raises the snapshot cap past the mirror default. Returning the bare
    // constant here would break the invariant on the path a run with no mirror override takes
    // — a defect visible only at 1000+, which is exactly where the expansion is headed.
    const big = DEFAULT_MIRROR_MAX_ENTRIES + 500
    for (const env of [{}, { TRUST_INGEST_MIRROR_MAX_ENTRIES: "abc" }, { TRUST_INGEST_MIRROR_MAX_ENTRIES: "10" }]) {
      expect(resolveMirrorMaxEntries(env, big)).toBeGreaterThan(big)
    }
    expect(resolveMirrorMaxEntries({}, big)).toBe(big + 1)
  })

  it("the resolved pair always satisfies mirror > snapshot, across every input shape", () => {
    // The invariant stated as one property over the cross product, rather than as a list of
    // cases. A future edit that adds a branch has to keep this true too.
    for (const snapshotRaw of [undefined, "", "  ", "0", "-5", "abc", "1", "25", "100", "1000", "2000"]) {
      const snapshotEnv = snapshotRaw === undefined ? {} : { TRUST_INGEST_MAX_ENTRIES: snapshotRaw }
      const snapshotCap = resolveMaxEntries(snapshotEnv)
      for (const mirrorRaw of [undefined, "", "0", "-1", "1.5", "1", "25", "26", "999", "5000"]) {
        const mirrorEnv = mirrorRaw === undefined ? {} : { TRUST_INGEST_MIRROR_MAX_ENTRIES: mirrorRaw }
        expect(resolveMirrorMaxEntries(mirrorEnv, snapshotCap)).toBeGreaterThan(snapshotCap)
      }
    }
  })
})

// ── the PAGE-COUNT ceiling — the third bound, and the one that had no knob ──────

/**
 * A read stops at whichever of THREE limits it reaches first: the served-cohort cap
 * (`resolveMaxEntries`), the raw-record cap (`resolveMirrorMaxEntries`), or this one. The first
 * two were already operator-settable; the page ceiling was a bare constant, so an operator facing
 * a page-cap truncation had no env var to raise and the only remedy was a code change.
 *
 * That asymmetry is what `resolveMirrorMaxPages` closes, and it is not cosmetic:
 * `MirrorIncompleteError`'s `page-cap` remedy NAMES `TRUST_INGEST_MIRROR_MAX_PAGES`, and a remedy
 * naming a knob the operator does not have is not a remedy.
 */
describe("resolveMirrorMaxPages — the page ceiling, fail-safe, with NO inequality to enforce", () => {
  it("defaults to DEFAULT_MAX_PAGES when unset, empty, or whitespace", () => {
    expect(resolveMirrorMaxPages({})).toBe(DEFAULT_MAX_PAGES)
    expect(resolveMirrorMaxPages({ TRUST_INGEST_MIRROR_MAX_PAGES: "" })).toBe(DEFAULT_MAX_PAGES)
    expect(resolveMirrorMaxPages({ TRUST_INGEST_MIRROR_MAX_PAGES: "   " })).toBe(DEFAULT_MAX_PAGES)
  })

  it("honors any valid positive integer, above OR below the default", () => {
    expect(resolveMirrorMaxPages({ TRUST_INGEST_MIRROR_MAX_PAGES: "1000" })).toBe(1000)
    // Below the default is honoured, unlike the record cap. There is deliberately NO inequality
    // here: a page count has no fixed relationship to a record count, since records-per-page is
    // the SOURCE's choice and not ours. An operator bounding a probe run to 3 pages is doing
    // something legitimate, and raising that to 400 behind their back would be the bug.
    expect(resolveMirrorMaxPages({ TRUST_INGEST_MIRROR_MAX_PAGES: "3" })).toBe(3)
    expect(resolveMirrorMaxPages({ TRUST_INGEST_MIRROR_MAX_PAGES: "1" })).toBe(1)
  })

  it("falls back on invalid input, the same shapes as both caps above", () => {
    for (const bad of ["0", "-5", "abc", "12.5", "NaN", "Infinity", "-Infinity"]) {
      expect(resolveMirrorMaxPages({ TRUST_INGEST_MIRROR_MAX_PAGES: bad })).toBe(DEFAULT_MAX_PAGES)
    }
  })

  it("accepts exponent notation, because Number('1e3') IS the integer 1000", () => {
    // Recorded because I first asserted the opposite and the code was right. `Number.isInteger`
    // tests the VALUE, not the spelling, so `1e3` is 1000 and is honoured — the same as it is by
    // both caps above, which share this exact validation shape. Pinned so the three stay aligned.
    expect(resolveMirrorMaxPages({ TRUST_INGEST_MIRROR_MAX_PAGES: "1e3" })).toBe(1000)
    expect(resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: "1e3" }, DEFAULT_MAX_ENTRIES)).toBe(1000)
    expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: "1e3" })).toBe(1000)
  })

  it("never returns a non-positive integer, across every input shape", () => {
    // Fail-safe stated as a property: an unbounded or zero page count is the one outcome that
    // must be unreachable. Zero would read nothing and report it as a complete source; unbounded
    // would let a source that never terminates spin forever.
    for (const raw of [undefined, "", "  ", "0", "-1", "-400", "abc", "1.5", "NaN", "1", "400", "9999"]) {
      const env = raw === undefined ? {} : { TRUST_INGEST_MIRROR_MAX_PAGES: raw }
      const n = resolveMirrorMaxPages(env)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThan(0)
    }
  })

  it("the two ceilings bind at the SAME read by construction, so neither is dead code", () => {
    // The measured argument for the numbers, asserted rather than left in a docblock.
    //
    // A record cap BELOW pages x page-size can never let the page ceiling fire; ABOVE it, the
    // record cap can never fire itself. Set equal, whichever exit reports first is the one that
    // actually bound — so the operator's remedy names the knob that will change the outcome.
    expect(DEFAULT_MIRROR_MAX_ENTRIES).toBe(DEFAULT_MAX_PAGES * PAGE_SIZE)
  })

  it("the default read ceiling clears the EXHAUSTED source size with headroom", () => {
    // INVERTED, not edited. This assertion read `MEASURED_SOURCE_FLOOR = 21_000` and described a
    // walk that "reached 21_000 records at 210 pages and was STILL not exhausted". Both halves of
    // that sentence were true and the number was still wrong as a measurement of the SOURCE:
    // 21_000 is 210 x 100, i.e. the PROBE'S OWN CEILING. A second probe capped at 500 pages duly
    // reported "50_000+" for the same reason. Only a walk that terminated with `reason=exhausted`
    // measured anything: `pages=653 total=65235 elapsed=7090s` (2026-08-04).
    //
    // The cost of believing the old figure: the ceiling shipped to fix this very defect was
    // 40_000, which is BELOW 65_235, so the fail-closed guard would have kept firing on every
    // scheduled run. Suspect the probe before the source — including your own probe.
    //
    // Still pinned as a floor, not an equality: the source grows, and a ceiling sized exactly to
    // today's measurement starts failing the week it does.
    const EXHAUSTED_SOURCE_SIZE = 65_235
    expect(DEFAULT_MAX_PAGES * PAGE_SIZE).toBeGreaterThan(EXHAUSTED_SOURCE_SIZE)
    // 100 is the source's HARD maximum page size, not a number chosen here: limit=100 returns
    // 100, and limit=101/200/500/999 are all refused with HTTP 422.
    expect(PAGE_SIZE).toBe(100)
  })

  it("the ceiling stays REACHABLE inside the ingest job's pinned wall-clock budget", () => {
    // The upper bound, and the one that had no control at all. Everything above this test bounds
    // the ceiling from BELOW — clear the source or every run truncates. Nothing bounded it from
    // above, and above is where the failure is silent: a ceiling the job cannot reach before the
    // runner kills it is not the limit that binds. The TIMEOUT is. And a timeout truncates without
    // a word — the process dies, no `MirrorIncompleteError` is constructed, `assertMirrorComplete`
    // never runs, and the fail-closed guard this whole file feeds is simply bypassed.
    //
    // So "raise the cap for headroom" is not a free move: past the budget it DISABLES the guard.
    // At 2000 pages the arithmetic below lands at ≈362 min, over both the pin and GitHub's own
    // 360-min job maximum, and no assertion in the repo would have noticed.
    //
    // Throughput is measured, not assumed: 7090s / 653 pages ≈ 10.9 s/page against this source.
    const MEASURED_SECONDS_PER_PAGE = 7090 / 653
    const budgetMinutes = ingestJobTimeoutMinutes()
    const worstCaseMinutes = (DEFAULT_MAX_PAGES * MEASURED_SECONDS_PER_PAGE) / 60

    expect(worstCaseMinutes).toBeLessThan(budgetMinutes)
    // And the pin itself must stay inside the platform's ceiling, or it is decorative: GitHub
    // kills the job at 360 whatever the file says.
    expect(budgetMinutes).toBeLessThanOrEqual(360)
  })
})

/**
 * `timeout-minutes` on the `ingest` job, read from the workflow rather than duplicated here.
 *
 * Read, not copied, because a copy is what the test would then be checking. The number is
 * load-bearing for the cap argument above, and the failure it guards against is a future edit that
 * raises the ceiling without re-reading the budget — which a second hardcoded 300 could not see.
 *
 * Throws when the key is ABSENT rather than defaulting to GitHub's 360. Inheriting the platform
 * default is exactly the state this batch found and fixed: the ceiling was argued against a limit
 * no line in the repo stated.
 */
function ingestJobTimeoutMinutes(): number {
  const wf = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows", "trust-ingest.yml"),
    "utf8",
  )
    // CRLF normalized at the READ. `git check-attr text eol -- .github/workflows/trust-ingest.yml`
    // reports `unspecified`, so a Windows checkout can hold `\r\n` — the unpinned-newline shape
    // that already cost one windows-only red leg in this workstream.
    .replace(/\r\n/g, "\n")
  const m = /^\s*timeout-minutes:\s*(\d+)\s*$/m.exec(wf)
  if (m === null) {
    throw new Error(
      "trust-ingest.yml pins no timeout-minutes — the mirror's page ceiling is argued against " +
        "that budget, and without it the job silently inherits GitHub's 360-minute maximum",
    )
  }
  return Number(m[1])
}

// ── the ingest bin does not bake (R-2, §16.2) ──────────────────────────────────

describe("refreshSnapshot measures; it does not write the served tree (controls #7, #8)", () => {
  /**
   * The module's own source, with comments STRIPPED.
   *
   * Load-bearing. The deleted step is recorded in the file's docblock as an inverted
   * assertion — the house discipline is to invert a stale claim, never delete it — so a bare
   * grep for `writeServedTree` matches the explanation and the control passes for the wrong
   * reason (or fails for one). Stripping comments first is what makes this a check on CODE.
   */
  function ingestCode(): string {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "refreshSnapshot.ts"),
      "utf8",
    )
    // CRLF normalized at the READ, so this function's output does not depend on the checkout.
    // `git check-attr text eol` reports `unspecified` for `refreshSnapshot.ts`, which is the
    // shape that cost a windows-only red leg once already.
    //
    // MEASURED, and stated precisely rather than as a scare: today's assertions survive CRLF
    // unnormalized, because `indexOf("\n    })")` finds the `\n` inside `\r\n`. What is NOT
    // stable is the stripped output itself — `.*$` matches `\r`, so comment lines lose theirs
    // while code lines keep them, leaving mixed endings. Normalizing removes the coincidence
    // this currently rests on.
    return src
      .replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
  }

  it("references neither writeServedTree nor emitAllCohorts in code", () => {
    // Until R-2 this bin baked all cohorts with `claims=undefined, evidence=undefined`, and
    // MEASURED that tree differs from `bake.ts`'s in 94 of the 158 committed served files — a
    // claims- and evidence-stripped shape. It never shipped only because the workflow runs
    // `bake:trust-index` immediately afterwards and `writeServedTree` rmSyncs both roots
    // first. Deleted rather than gated: a wrong-shaped bake stays wrong-shaped when it runs
    // less often, and one that fires rarely is harder to find than one that fires always.
    const code = ingestCode()
    expect(code).not.toMatch(/writeServedTree/)
    expect(code).not.toMatch(/emitAllCohorts/)
  })

  it("the stripper really does remove the docblock that names them (positive control)", () => {
    // Without this, a stripper that accidentally deleted the WHOLE file would make the
    // assertion above vacuous. The raw source must mention the deleted call; the stripped
    // source must still contain the code that remains.
    const raw = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "refreshSnapshot.ts"),
      "utf8",
    )
    expect(raw).toMatch(/writeServedTree/) // the inverted-assertion record
    expect(ingestCode()).toMatch(/refreshFromMirror/) // the code that stayed
    expect(ingestCode()).toMatch(/describeSourceChange/) // the verdict it now reports
  })

  it("passes all THREE resolved ceilings into the read — a resolved-but-unpassed knob is dead", () => {
    // ADDED because negative control #45 stayed GREEN, which is a finding about the harness
    // and not a pass. Deleting `maxPages,` from the `refreshFromMirror` call left `main()`
    // resolving the env var and then dropping it, and typecheck plus all 1210 package tests
    // still passed — because `maxPages` is OPTIONAL on the options type and `main()` is neither
    // exported nor callable (it opens a real DB and hits the network).
    //
    // That is the exact "shipped-not-wired" shape: `MirrorIncompleteError`'s page-cap remedy
    // names `TRUST_INGEST_MIRROR_MAX_PAGES`, and an operator would set it, see no change, and
    // have no way to tell the knob from a no-op. Asserted on the CALL SITE rather than on the
    // resolver, because the resolvers already have their own tests and all six passed while
    // the wire was cut.
    const code = ingestCode()
    const at = code.indexOf("refreshFromMirror({")
    expect(at).toBeGreaterThan(-1)
    // The argument object, from `({` to the first line that closes it at the call's indent.
    const args = code.slice(at, code.indexOf("\n    })", at))
    for (const wired of ["snapshotMaxEntries: maxEntries", "mirrorMaxEntries,", "maxPages,"]) {
      expect(args).toContain(wired)
    }
    // And each name is the resolver's result, not a literal that happens to share the name.
    expect(code).toMatch(/const maxEntries = resolveMaxEntries\(process\.env\)/)
    expect(code).toMatch(/const mirrorMaxEntries = resolveMirrorMaxEntries\(process\.env, maxEntries\)/)
    expect(code).toMatch(/const maxPages = resolveMirrorMaxPages\(process\.env\)/)
  })

  it("still writes the snapshot — only the BAKE was removed", () => {
    // The scope control. Deleting the write of SNAPSHOT_PATH would silently turn the
    // scheduled workflow into a no-op that opens an empty PR, and every assertion above
    // would still pass.
    const code = ingestCode()
    expect(code).toMatch(/writeFileSync\(SNAPSHOT_PATH/)
  })

  /**
   * THE TWO BOOLEAN CAPABILITY SWITCHES — and a debt R-4 left that S-1 found by looking.
   *
   * The three ceilings above each had a switch table from the batch that shipped them.
   * `resolveArtifactsEnabled` (R-4) had NONE: measured across every `*.test.ts` in the repo, no test
   * named it. So S-1 writes both tables, not just its own, because a polarity defect in either one
   * is silent in the same way — the run simply does less work and reports a `null` layer, which
   * reads as "not asked" rather than as "broken".
   *
   * WHY `!== "0"` AND NOT `=== "1"`, asserted rather than argued: the default must be ON, and a
   * TYPO must fail toward DOING the measurement. `TRUST_INGEST_EVIDENCE=fasle` should compile
   * evidence, not skip it. `resolveMaxEntries` and both mirror caps already fail-safe this way; a
   * boolean's version of fail-safe is a single recognized off-spelling.
   */
  describe("the two boolean capability switches — default ON, one off-spelling each", () => {
    const CASES: ReadonlyArray<readonly [string | undefined, boolean]> = [
      [undefined, true],
      ["", true],
      ["   ", true],
      // The ONE spelling that disables. Whitespace-trimmed, matching the cap resolvers.
      ["0", false],
      [" 0 ", false],
      ["\t0\n", false],
      // Everything else is ON — including every plausible near-miss. A typo must fail toward
      // doing the measurement, never toward silently skipping it.
      ["1", true],
      ["false", true],
      ["FALSE", true],
      ["no", true],
      ["off", true],
      ["disabled", true],
      ["00", true],
      ["0.0", true],
      ["-0", true],
      ["null", true],
      ["undefined", true],
      ["true", true],
    ]

    it("resolveEvidenceEnabled: exactly `0` disables, everything else enables", () => {
      for (const [raw, expected] of CASES) {
        const env = raw === undefined ? {} : { TRUST_INGEST_EVIDENCE: raw }
        expect(resolveEvidenceEnabled(env), `TRUST_INGEST_EVIDENCE=${JSON.stringify(raw)}`).toBe(
          expected,
        )
      }
    })

    it("resolveArtifactsEnabled: the SAME table — R-4's untested switch, pinned here", () => {
      // Identical polarity by construction, so the two knobs cannot drift into behaving
      // differently for the same operator input.
      for (const [raw, expected] of CASES) {
        const env = raw === undefined ? {} : { TRUST_INGEST_ARTIFACTS: raw }
        expect(resolveArtifactsEnabled(env), `TRUST_INGEST_ARTIFACTS=${JSON.stringify(raw)}`).toBe(
          expected,
        )
      }
    })

    it("neither switch reads the other's variable", () => {
      // A copy-paste of the resolver body would leave both reading `TRUST_INGEST_ARTIFACTS`, and
      // every assertion above would still pass — each table only ever sets its own name. Setting
      // one OFF must leave the other ON.
      expect(resolveEvidenceEnabled({ TRUST_INGEST_ARTIFACTS: "0" })).toBe(true)
      expect(resolveArtifactsEnabled({ TRUST_INGEST_EVIDENCE: "0" })).toBe(true)
      expect(resolveEvidenceEnabled({ TRUST_INGEST_EVIDENCE: "0", TRUST_INGEST_ARTIFACTS: "0" })).toBe(
        false,
      )
      expect(resolveArtifactsEnabled({ TRUST_INGEST_EVIDENCE: "0", TRUST_INGEST_ARTIFACTS: "0" })).toBe(
        false,
      )
    })

    it("the resolved switch reaches the CALL as a port — a resolved-but-unpassed switch is dead", () => {
      // The #45 lesson applied to S-1's own wire. `evidencePort` is OPTIONAL on the options type,
      // so dropping it from the call site typechecks clean and every table above stays green —
      // exactly how `maxPages` was resolved-then-discarded for a whole batch.
      const code = ingestCode()
      const at = code.indexOf("refreshFromMirror({")
      expect(at).toBeGreaterThan(-1)
      const args = code.slice(at, code.indexOf("\n    })", at))
      // Spread-or-nothing, both ports: passing `evidencePort: undefined` explicitly would make the
      // run report `evidence: null` for a DIFFERENT reason than "not asked", and R-4 established
      // the spread form for exactly that distinction.
      expect(args).toContain("...(artifactPort === undefined ? {} : { artifactPort })")
      expect(args).toContain("...(evidencePort === undefined ? {} : { evidencePort })")
      // And each port is gated by its own resolver, not by a literal or by the other's.
      expect(code).toMatch(/const artifactPort = resolveArtifactsEnabled\(process\.env\)/)
      expect(code).toMatch(/const evidencePort = resolveEvidenceEnabled\(process\.env\)/)
    })

    it("the evidence port injects the policy DIGEST and the ONE engine version", () => {
      // `compileEvidence` takes `policyDigest` and `engineVersion` as required inputs precisely so
      // a policy change cannot silently reuse evidence graded under the old one. A hardcoded ""
      // would satisfy the type and defeat that (control #126), so the call is pinned on the code.
      const code = ingestCode()
      expect(code).toMatch(/policyDigest: hashJson\(adoptionBasisPolicy\(\)\)/)
      // `engineVersion()` CALLED, not the identifier passed — the latter would put a function
      // reference where a string belongs and only fail at runtime inside the digest.
      expect(code).toMatch(/engineVersion: engineVersion\(\)/)
      // A fingerprint, never a decision: no decision engine is named anywhere in this module.
      expect(code).not.toMatch(/\bdecideOverAuthority\b/)
      expect(code).not.toMatch(/\bapplyPolicy\b/)
    })

    /**
     * AND THE TWO EXPRESSIONS ACTUALLY YIELD USABLE VALUES — the half a source scan cannot see.
     *
     * The scan above proves the CALL SITE says `hashJson(adoptionBasisPolicy())` and
     * `engineVersion()`. It cannot prove either one returns a non-blank string, and after S-1 that
     * gap is load-bearing in a way it was not before: `compileEvidence` now THROWS on a blank
     * `policyDigest` or `engineVersion` (control #126), so a degenerate return here would take the
     * whole ingest run down at the port instead of silently storing a blank grouping key.
     *
     * Measured by hand first — a throwaway probe drove these two expressions against the real
     * `.var/` store and printed `sha256:1db6cc…` / `0.1.0`. That measurement is worth nothing to a
     * later reader, so it is pinned here. Both suites that exercise `compileEvidence` inject their
     * OWN digest, so nothing else in the repo evaluates what the bin actually passes.
     */
    it("and both injected expressions EVALUATE to values `compileEvidence` accepts", () => {
      // Evaluated, not string-matched. `hashJson` is a fixed-width digest and `engineVersion()`
      // reads the package's own `version`, so both are asserted on shape rather than on a literal
      // value that would pin this test to a version bump.
      const policyDigest = hashJson(adoptionBasisPolicy())
      const engine = engineVersion()
      expect(policyDigest.trim().length).toBeGreaterThan(0)
      expect(policyDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(engine.trim().length).toBeGreaterThan(0)
      expect(engine).toMatch(/^\d+\.\d+\.\d+/)

      // THE GUARD THIS FEEDS, run for real rather than described. `compileEvidence` refuses a blank
      // on either field; these two values must pass that same floor, or the production port throws
      // on every run. Asserted through the refusal's own predicate so the two cannot drift.
      for (const [field, value] of [
        ["policyDigest", policyDigest],
        ["engineVersion", engine],
      ] as const) {
        expect(value.trim().length, `${field} is blank — the evidence port would throw on it`).toBeGreaterThan(0)
      }

      // POSITIVE CONTROL on the digest's own sensitivity: two DIFFERENT policies must not share a
      // grouping key, which is the entire reason the field exists (#56). Without this, the assertion
      // above would pass on a `hashJson` that returned a constant.
      expect(hashJson(adoptionBasisPolicy())).toBe(policyDigest)
      expect(hashJson(defaultPolicy())).not.toBe(policyDigest)
    })

    it("a not-asked layer prints NOTHING, and a measured one prints its counts", () => {
      // R-4's rule, inherited verbatim: "'0 considered, 0 fetched' and 'not asked to resolve' are
      // different facts". The clause is empty-string on `null` rather than a zero line (#122).
      const code = ingestCode()
      expect(code).toMatch(/mirrored\.artifacts === null \? "" :/)
      expect(code).toMatch(/mirrored\.evidence === null \? "" :/)
      // The wording comes from the package that owns the numbers, not re-phrased at the bin.
      expect(code).toMatch(/describeEvidenceCompilation\(mirrored\.evidence\)/)
    })
  })
})
