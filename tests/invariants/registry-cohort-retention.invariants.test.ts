import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { projectSnapshot } from "@calllint/adoption-index"
import type { SourceRecordV1 } from "@calllint/adoption-index"

/**
 * The cohort slice has an assertion that can see whether the CLAIMED SUBJECT is still in it.
 *
 * Before this file, three tests asserted the alphabetical-cap MECHANISM and none asserted its
 * CONSEQUENCE. `snapshot-projection.test.ts:208` and `refresh-from-mirror.test.ts:602` both pin
 * `["io.example/alpha", "io.example/mike"]` over synthetic fixtures — correct, and blind to the
 * real corpus. A mechanism test says "the cap slices after the sort." It cannot say "and the entry
 * that sorts last is the one page this project claims about itself."
 *
 * MEASURED, and the reason this file exists rather than a comment:
 *
 *   `io.github.calllint/calllint` is at index 18 of 19 — DEAD LAST. Every other live name in the
 *   committed cohort begins `ac.` / `ag.` / `ai.` (2/2/14). Upstream is reverse-DNS, so `io.*`
 *   sorts after all of them, and this is the ONLY `io.*` entry. The claimed subject is not merely
 *   near the boundary; it is the entry the cap reaches first.
 *
 * THE ANTI-CORRELATION, which is the finding this file guards:
 *
 *   `S0_REQUIRED_RECORDS` (scripts/gate-s0.ts) == `DEFAULT_MAX_ENTRIES` (fetchRegistry.ts) == 25.
 *   The gate's requirement is satisfiable only once the cohort reaches 25, and the cap begins
 *   evicting at 26. So:
 *
 *     cohort 19..24 -> gate SHORTFALL (red),  self present
 *     cohort 25     -> gate MET      (green), self present   <- the ONLY size satisfying both
 *     cohort 26+    -> gate MET      (green), self ** EVICTED **
 *
 *   Closing S0's shortfall by growing the cohort is therefore the same action that deletes this
 *   project's own trust page, and the gate goes GREEN as it happens. That is not a slippery-slope
 *   argument; it is arithmetic over two constants that are the same number by coincidence.
 *
 * WHAT EVICTION COSTS, measured rather than asserted as harm:
 *
 *   - `apps/web/public/trust/index.json` carries exactly one row for
 *     `mcp-registry/io.github.calllint-calllint`, `status: "baked"`, `verdict: "SAFE"`, with a real
 *     `pageDigest`. Eviction removes the row, so the bake stops emitting the page.
 *   - `artifacts/phase-2.4/presentation-lock.json` holds TWO overrides keyed to that exact slug
 *     (`displayName`, `reason`). Eviction orphans both — a lock entry for a page that no longer
 *     exists.
 *   - Neither `claims/claim-store.json` (2 keys, none matching) nor `snapshots/adoption-index.json`
 *     (0 subjects) carries the self-claim. The served snapshot is its ONLY home, so there is no
 *     second copy to fall back on.
 *
 * NOTHING HERE OPENS A SOCKET (INV-M4). Every input is committed bytes. The projection is called
 * in-process over records rebuilt from the committed snapshot, so this file asserts over the SAME
 * function production runs (`refreshSnapshot.ts:330` -> `refreshFromMirror` ->
 * `snapshotProjection.ts:113`) and not over a reimplementation of it.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..", "..")

/** The subject this project claims about itself, in the registry's own key space. */
const CLAIMED_SUBJECT = "io.github.calllint/calllint"
/** The same subject after slug normalization, as the served tree keys it. */
const CLAIMED_SLUG = "mcp-registry/io.github.calllint-calllint"

const SNAPSHOT = path.join(repoRoot, "packages/trust-index/snapshots/official-mcp-registry.json")
const SERVED_INDEX = path.join(repoRoot, "apps/web/public/trust/index.json")
const PRESENTATION_LOCK = path.join(repoRoot, "artifacts/phase-2.4/presentation-lock.json")
const GATE_S0 = path.join(repoRoot, "scripts/gate-s0.ts")
const FETCH_REGISTRY = path.join(repoRoot, "packages/trust-index/src/fetchRegistry.ts")

function readJson(file: string): any {
  // Normalized before parse: these are committed artifacts with no `eol=lf` pin of their own, and a
  // CRLF checkout must not change what this file measures. Counting CR over RAW bytes elsewhere is
  // the other half of that rule; here the parse only needs the separators uniform.
  return JSON.parse(readFileSync(file, "utf8").replace(/\r\n/g, "\n"))
}

const snapshot = readJson(SNAPSHOT)
const names: string[] = snapshot.entries.map((e: any) => e.name)

/**
 * Rebuild the projection's INPUT from the committed snapshot. The snapshot is the projection's
 * output, so this is a round-trip: it carries only the fields `toEntry` reads, which is exactly
 * what makes a re-projection over it comparable.
 */
function asRecord(name: string, over: Record<string, unknown> = {}): SourceRecordV1 {
  return {
    source: { sourceRecordId: name },
    claimedIdentity: { canonicalName: name, version: null, repositoryUrl: null, packages: [], remotes: [] },
    lifecycle: { status: "active", isLatest: true, publishedAt: null },
    untrustedPublisherContent: { description: "" },
    ...over,
  } as unknown as SourceRecordV1
}

const committedRecords = names.map((n) => asRecord(n))

/** Names that sort strictly before the claimed subject, i.e. the ones that consume its headroom. */
function earlierFillers(count: number): SourceRecordV1[] {
  // `ai.zz…` sorts after every real `ai.*` name in the corpus and before `io.*`, so a filler is
  // added at the boundary rather than at the front. A filler that sorted first would still evict,
  // but would not measure the boundary the real corpus sits on.
  return Array.from({ length: count }, (_, i) => asRecord(`ai.zz${String(i).padStart(3, "0")}/filler`))
}

function project(records: readonly SourceRecordV1[], maxEntries: number) {
  return projectSnapshot({
    records,
    endpoint: snapshot.endpoint,
    fetchedAt: snapshot.fetchedAt,
    maxEntries,
  })
}

describe("the registry cohort slice retains the claimed subject", () => {
  it("the claimed subject is in the committed cohort at all", () => {
    // The base fact every other assertion in this file depends on. Asserted as a SET so a failure
    // prints what the cohort actually holds instead of `expected false to be true`.
    expect(names.filter((n) => n === CLAIMED_SUBJECT), `${CLAIMED_SUBJECT} must be in the committed snapshot`).toEqual([
      CLAIMED_SUBJECT,
    ])
  })

  it("the claimed subject sorts LAST, so the cap reaches it first", () => {
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    // Derived, not restated: the index is computed from the committed names, and the cohort size is
    // read from the same array. A hardcoded 18 would agree with the corpus only until it grows.
    expect(sorted.indexOf(CLAIMED_SUBJECT), `${CLAIMED_SUBJECT} is expected to sort last`).toBe(sorted.length - 1)
    // And it is the only `io.*` entry — the reason it sorts last is structural (reverse-DNS), not a
    // coincidence of the current 19 names.
    expect(names.filter((n) => n.startsWith("io."))).toEqual([CLAIMED_SUBJECT])
  })

  it("re-projecting the committed cohort keeps the claimed subject at today's cap", () => {
    const out = project(committedRecords, readCap())
    expect(out.entries.map((e) => e.name)).toContain(CLAIMED_SUBJECT)
    // The cap does not bind today, so `count` is the cohort size and not the cap. Stating both
    // makes a future cohort that silently reached the cap visible here.
    expect(out.count).toBe(names.length)
    expect(out.count).toBeLessThan(readCap())
  })

  it("names the EXACT cohort size at which the claimed subject is evicted", () => {
    const cap = readCap()
    const idx = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).indexOf(CLAIMED_SUBJECT)
    // Headroom is derived: the subject survives while at most `cap - 1` names sort before it.
    const headroom = cap - 1 - idx
    // Stated as the IDENTITY, not as a literal. The subject sorts last (asserted above), so
    // `idx === names.length - 1` and the headroom collapses to `cap - cohortSize` — a claim about
    // two independently-read numbers rather than a copy of today's difference. `toBe(6)` was true at
    // cap 25 and `toBe(81)` would be true at cap 100; neither says WHY.
    expect(headroom, `headroom must be the cap (${cap}) minus the cohort size (${names.length})`).toBe(
      cap - names.length,
    )
    // And it must be POSITIVE, or the subject is already evicted at today's cohort and every
    // boundary measured below is measuring the wrong side of it.
    expect(headroom, "the claimed subject must still have headroom at today's cohort size").toBeGreaterThan(0)

    // The boundary, measured on both sides through the REAL projection rather than argued.
    const lastSafe = project([...committedRecords, ...earlierFillers(headroom)], cap)
    expect(lastSafe.entries.map((e) => e.name), `at cohort ${names.length + headroom} the subject must survive`).toContain(
      CLAIMED_SUBJECT,
    )
    expect(lastSafe.count).toBe(cap)

    const firstEvicting = project([...committedRecords, ...earlierFillers(headroom + 1)], cap)
    expect(
      firstEvicting.entries.map((e) => e.name),
      `at cohort ${names.length + headroom + 1} the cap evicts the claimed subject — this is the defect this file exists for`,
    ).not.toContain(CLAIMED_SUBJECT)
    expect(firstEvicting.count).toBe(cap)
  })

  it("the cap is STRICTLY ABOVE the requirement, so green and eviction no longer coincide", () => {
    const cap = readCap()
    const required = readRequired()
    // INVERTED AT S BATCH 5 (ADR 0074), and the inversion is this assertion's whole history.
    //
    // It previously required `{cap: 25, required: 25}` — the EQUALITY — because that equality was
    // the defect: the cohort size satisfying Gate S0 was the size at which the cap began evicting,
    // so the action closing S0's shortfall deleted this project's own page and the gate went green
    // as it happened. The remedy raised the cap, which reds this assertion BY DESIGN. It is now the
    // inequality, and the message says what a revert would mean.
    //
    // Asserted as the RELATIONSHIP, not as `{cap: 100, required: 25}`. Two literals would agree
    // with a copy of today's values and would red on any future expansion step — including a
    // legitimate one — while saying nothing about the property that matters
    // ([[prose-justified-constant-is-ungated]]).
    expect(
      cap,
      `the served cap (${cap}) must stay STRICTLY ABOVE S0's requirement (${required}). At equality the size that satisfies the gate is the size that evicts the claimed subject — S0-OPEN-4's arithmetic. Re-read ADR 0074 before changing either number`,
    ).toBeGreaterThan(required)

    // The overlap interval, which is what the decoupling actually bought. Scanned to a bound
    // DERIVED FROM THE CAP, never a literal: the old `extra <= 12` was accidentally correct at
    // cap == required (exactly one satisfying size, and 12 reached past it) and would have
    // TRUNCATED the answer here — measured, 76 satisfying sizes clipped to 7, reporting a
    // shortfall instead of the decoupling ([[hardcoded-range-stops-covering-its-tail]]).
    const scanTo = cap - names.length + 2
    const both: number[] = []
    for (let extra = 0; extra <= scanTo; extra++) {
      const out = project([...committedRecords, ...earlierFillers(extra)], cap)
      const meetsRequirement = out.count >= required
      const retainsSubject = out.entries.some((e) => e.name === CLAIMED_SUBJECT)
      if (meetsRequirement && retainsSubject) both.push(names.length + extra)
    }
    // Endpoints, derived on both sides. The interval opens at the requirement (below it the gate is
    // short) and closes at the cap (above it the slice evicts), so `[required, cap]` states the
    // property rather than restating two numbers.
    expect(both.length, "the two properties must be satisfiable together at more than one size — that is the decoupling").toBeGreaterThan(1)
    expect(
      [both[0], both[both.length - 1]],
      `the overlap must run from S0's requirement to the cap. Observed ${both.length} sizes: ${both[0]}..${both[both.length - 1]}`,
    ).toEqual([required, cap])
    // And the scan must have RUN — a bound that collapsed to <= 0 would leave `both` empty or
    // singular and the endpoints assertion would compare undefined against undefined.
    expect(scanTo, "the derived scan bound must reach past the cap, or the interval above is truncated").toBeGreaterThan(
      cap - names.length,
    )
  })

  it("eviction would orphan committed bytes that name the claimed subject", () => {
    // Not a harm argument — a census of the committed references that a cap-bound ingest breaks.
    const served = readJson(SERVED_INDEX)
    const rows: any[] = served.entries ?? served.pages ?? served.subjects ?? []
    const selfRows = rows.filter((r) => r.canonicalName === CLAIMED_SLUG)
    expect(selfRows.map((r) => r.canonicalName), "the served tree carries the claimed subject's page").toEqual([
      CLAIMED_SLUG,
    ])
    // A row with no page digest would already be broken; asserting it here means eviction is the
    // only way this can go missing.
    expect(typeof selfRows[0]?.pageDigest, "the served row must carry a pageDigest").toBe("string")

    // The lock names the slug in VALUES, not keys — `overriddenSlots` is an array of dotted slot
    // paths, and `semanticContract.resources[]` carries `canonicalSlug`. Flattening to
    // `dottedPath -> value` and matching the value is what finds all three; matching keys found
    // zero, which is how the first run of this assertion red.
    const flat = flatten(readJson(PRESENTATION_LOCK))
    const lockRefs = Object.entries(flat)
      .filter(([, v]) => String(v).includes("io.github.calllint-calllint"))
      .map(([k]) => k)
    // Printed as the paths, not a count: a failure names WHICH committed references eviction
    // orphans. Asserted as the exact set so a batch that adds or drops one is visible here.
    expect(lockRefs, `presentation-lock paths naming ${CLAIMED_SLUG}`).toEqual([
      "contentPlane.overriddenSlots[34]",
      "contentPlane.overriddenSlots[35]",
      "semanticContract.resources[18].canonicalSlug",
    ])
    // `resources[18]` is the same last position the subject holds in the cohort: the lock's own
    // resource list is in cohort order, so the eviction boundary and the lock's last index are the
    // same boundary. That is why an evicting ingest orphans the tail of this list, not a middle row.
    expect(flat["semanticContract.resources[18].canonicalSlug"]).toBe(CLAIMED_SLUG)
  })
})

/**
 * Read a numeric constant from the file that DECLARES it, never restating the value here. A missing
 * declaration throws naming the constant and its file: the two numbers this test reasons about are
 * the whole subject, so "which file stopped declaring it" is the datum a failure must carry.
 */
function readNumericConstant(file: string, decl: RegExp, label: string): number {
  const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
  const captured = decl.exec(src)?.[1]
  if (captured === undefined) {
    throw new Error(`${label} not found in ${path.relative(repoRoot, file)} — it is read here, never restated`)
  }
  return Number(captured.replace(/_/g, ""))
}

/** The cap that selects the cohort, read from `fetchRegistry.ts`. */
function readCap(): number {
  return readNumericConstant(FETCH_REGISTRY, /export const DEFAULT_MAX_ENTRIES\s*=\s*(\d[\d_]*)/, "DEFAULT_MAX_ENTRIES")
}

/** S0's requirement, read from the gate that declares it. */
function readRequired(): number {
  return readNumericConstant(GATE_S0, /const S0_REQUIRED_RECORDS\s*=\s*(\d[\d_]*)/, "S0_REQUIRED_RECORDS")
}

/** Flatten to dotted keys so an override's position in the lock's shape does not matter. */
function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, prefix === "" ? k : `${prefix}.${k}`, out)
    }
  } else {
    out[prefix] = value
  }
  return out
}
