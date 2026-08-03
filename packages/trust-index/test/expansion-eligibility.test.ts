import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { emitAllCohorts, type ExpansionCandidate } from "../src/emitCohort.js"
import { resolveMaxEntries, resolveMirrorMaxEntries } from "../src/refreshSnapshot.js"
import { DEFAULT_MAX_ENTRIES } from "../src/fetchRegistry.js"
import { DEFAULT_MIRROR_MAX_ENTRIES } from "@calllint/adoption-index"
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
    expect(resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: "26" }, DEFAULT_MAX_ENTRIES)).toBe(26)
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
    // 24 (below) is obviously wrong; 25 (EQUAL) is the subtle one — reading exactly as many
    // records as the snapshot emits makes the snapshot's cap structurally unreachable, since
    // the mirror also stores the records the snapshot drops.
    expect(resolveMirrorMaxEntries({ TRUST_INGEST_MIRROR_MAX_ENTRIES: "24" }, DEFAULT_MAX_ENTRIES)).toBe(
      DEFAULT_MIRROR_MAX_ENTRIES,
    )
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
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
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

  it("still writes the snapshot — only the BAKE was removed", () => {
    // The scope control. Deleting the write of SNAPSHOT_PATH would silently turn the
    // scheduled workflow into a no-op that opens an empty PR, and every assertion above
    // would still pass.
    const code = ingestCode()
    expect(code).toMatch(/writeFileSync\(SNAPSHOT_PATH/)
  })
})
