import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { projectSnapshot, RESERVED_COHORT_NAMES } from "@calllint/adoption-index"
import type { SourceRecordV1 } from "@calllint/adoption-index"

/**
 * The cohort slice has an assertion that can see whether the CLAIMED SUBJECT is still in it.
 *
 * Before this file, three tests asserted the alphabetical-cap MECHANISM and none asserted its
 * CONSEQUENCE. `snapshot-projection.test.ts:224` and `refresh-from-mirror.test.ts:616` both pin
 * `["io.example/alpha", "io.example/mike"]` over synthetic fixtures — correct, and blind to the
 * real corpus. A mechanism test says "the cap slices after the sort." It cannot say "and the entry
 * that sorts last is the one page this project claims about itself."
 *
 * That blindness had a second cost, found only in ADR 0075: because EVERY fixture in the
 * byte-equivalence suite is `io.example/*`, the reserved-retention branch was never entered on
 * either side, so the two duplicated implementations would have agreed by never running the new
 * code. `snapshot-projection.test.ts` now carries a case where the cap binds AND a reserved name
 * would have been evicted. A fixture corpus that avoids the real key space cannot exercise a rule
 * keyed on it.
 *
 * MEASURED, and the reason this file exists rather than a comment:
 *
 *   `io.github.calllint/calllint` is at index 18 of 19 — DEAD LAST. The committed cohort's prefix
 *   census is `{ ac: 2, ag: 1, agency: 1, ai: 14, io: 1 }` — the original filing wrote `ag: 2` by
 *   collapsing `agency.` into `ag`, corrected in ADR 0074. Upstream is reverse-DNS, so `io.*` sorts
 *   after all of them, and this is the ONLY `io.*` entry. The claimed subject is not merely near the
 *   boundary; it is the entry the cap reaches FIRST — which is why raising the cap could only move
 *   the boundary, never remove it.
 *
 * THE ANTI-CORRELATION THIS FILE WAS FILED FOR — now DEFUSED, and the history is kept because the
 * shape recurs:
 *
 *   `S0_REQUIRED_RECORDS` (scripts/gate-s0.ts) == `DEFAULT_MAX_ENTRIES` (fetchRegistry.ts) == 25,
 *   two constants that were the same number by coincidence. The gate's requirement was satisfiable
 *   only once the cohort reached 25, and the cap began evicting at 26:
 *
 *     cohort 19..24 -> gate SHORTFALL (red),  self present
 *     cohort 25     -> gate MET      (green), self present   <- the ONLY size satisfying both
 *     cohort 26+    -> gate MET      (green), self ** EVICTED **
 *
 *   So closing S0's shortfall by growing the cohort was the same action that deleted this project's
 *   own trust page, and the gate went GREEN as it happened. Two batches addressed it, and only the
 *   second one actually removed it:
 *
 *     ADR 0074 raised the cap 25 -> 100. That DEFERRED the eviction to cohort 101; the slice was
 *       still alphabetical, so the subject was still the first entry the cap reached. Headroom, not
 *       safety — measured at three caps (25 -> evicts at 26, 100 -> at 101, 500 -> at 501).
 *     ADR 0075 replaced the bare slice with `selectCohortEntries`, which retains
 *       `RESERVED_COHORT_NAMES` against the cap. There is now NO cohort size at which the subject
 *       is evicted, and the tests below assert that at the old boundary, at boundary+1, and far past
 *       it. The cap stays an absolute ceiling: a reserved name takes a slot, never an extra one.
 *
 * WHAT EVICTION WOULD HAVE COST, measured rather than asserted as harm. Kept because it is what
 * makes the retention rule worth its complexity — and because two of the three counts below were
 * wrong in the original filing, each for an instructive reason:
 *
 *   - `apps/web/public/trust/index.json` carries exactly one row for
 *     `mcp-registry/io.github.calllint-calllint`, `status: "baked"`, `verdict: "SAFE"`, with a real
 *     `pageDigest`. Eviction removes the row, so the bake stops emitting the page. Re-measured
 *     2026-08-12 and CORRECT; the row also sits at index 18 of the 19-entry `mcp-registry` cohort,
 *     i.e. last, which is the ordering fact everything here rests on.
 *   - `artifacts/phase-2.4/presentation-lock.json` holds THREE references, not the TWO originally
 *     recorded. `contentPlane.overriddenSlots[34]` and `[35]` key the subject as a FLAT DOTTED PATH
 *     (`overrides.resources.mcp-registry__io.github.calllint-calllint.displayName` / `.reason`,
 *     with `__` where the slug has `/`), and `semanticContract.resources[18].canonicalSlug` keys it
 *     as the slug itself. An exact-string search for the slug finds only the third; a search for the
 *     `__` form finds only the first two. The count was wrong because ONE key form was searched.
 *   - ~~Neither `claims/claim-store.json` (2 keys, none matching) nor `snapshots/adoption-index.json`
 *     (0 subjects) carries the self-claim. The served snapshot is its ONLY home.~~ **FALSE in all
 *     three clauses, measured 2026-08-12, and both halves failed the same way — the probe read a
 *     field name that does not exist.** The claim store's "2 keys" are the top-level `schema` +
 *     `records`; `records` holds TWO claim records, BOTH for this subject — one `revoked`, one
 *     **`active`** (`verifiedAt` 2026-07-24T09:44:55.534Z). The adoption-index field is `entries`,
 *     not `subjects`: 19 of them, one being this subject (`identityStatus: PROVISIONAL`). So there
 *     are THREE copies, not one. The row's conclusion survived on its own, which is exactly why the
 *     wrong census went unchallenged for two batches.
 *
 * WHY THE RESERVED LIST IS A STATIC CONSTANT and not a claim-store lookup, given that an active
 * claim demonstrably exists: `refreshFromMirror.ts:290-296` records that feeding any part of
 * resolved identity into `projectSnapshot`'s input breaks the byte gate. The projection must stay a
 * function of `records` alone.
 *
 * NOTHING HERE OPENS A SOCKET (INV-M4). Every input is committed bytes. The projection is called
 * in-process over records rebuilt from the committed snapshot, so this file asserts over the SAME
 * function production runs (`refreshSnapshot.ts:330` -> `refreshFromMirror` ->
 * `snapshotProjection.ts:154` -> `selectCohortEntries`) and not over a reimplementation of it. The
 * last hop used to be `snapshotProjection.ts:113`, the bare `.slice(0, max)`; ADR 0075 moved the cap
 * into `selectCohortEntries`, so the chain gained a step rather than shifting a line number.
 *
 * `RESERVED_COHORT_NAMES` is imported from `@calllint/adoption-index` DELIBERATELY, not from
 * `trust-index`: the rule is duplicated in both (adoption-index has zero imports of trust-index and
 * a gate keeps it that way), and this file exercises `projectSnapshot`, so it must read the copy
 * `projectSnapshot` actually uses. The two lists' equality is asserted in
 * `packages/adoption-index/test/snapshot-projection.test.ts`, the one file where both are in scope.
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

  it("there is NO cohort size at which the claimed subject is evicted", () => {
    const cap = readCap()
    const idx = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).indexOf(CLAIMED_SUBJECT)
    // `headroom` is retained as a NAME for the old eviction boundary, and it still measures the
    // same arithmetic: the size at which a purely alphabetical cap would have reached the subject.
    // Keeping it is what lets the assertions below probe the exact size that used to fail rather
    // than a size chosen for being comfortably large.
    const headroom = cap - 1 - idx
    expect(headroom, `headroom must be the cap (${cap}) minus the cohort size (${names.length})`).toBe(
      cap - names.length,
    )
    expect(headroom, "the alphabetical boundary must still lie above today's cohort size").toBeGreaterThan(0)

    // INVERTED AT S BATCH 6 (ADR 0075). Until this batch, the second half of this test asserted
    // that cohort `cap + 1` EVICTED the claimed subject, with the message "this is the defect this
    // file exists for". That defect is now fixed at the selection rule, so the assertion is
    // inverted: the same input that used to prove the hazard now proves its absence.
    //
    // Probed at the OLD boundary and one past it, not at a round number — those are the two sizes
    // a reverted `selectCohortEntries` would fail at first.
    const lastSafe = project([...committedRecords, ...earlierFillers(headroom)], cap)
    expect(lastSafe.entries.map((e) => e.name), `at cohort ${names.length + headroom} the subject must survive`).toContain(
      CLAIMED_SUBJECT,
    )
    expect(lastSafe.count).toBe(cap)

    const pastOldBoundary = project([...committedRecords, ...earlierFillers(headroom + 1)], cap)
    expect(
      pastOldBoundary.entries.map((e) => e.name),
      `at cohort ${names.length + headroom + 1} the subject must SURVIVE — a plain alphabetical cap evicted it here, and ADR 0075's reserved-retention rule is what stops it`,
    ).toContain(CLAIMED_SUBJECT)
    // The cap remains an ABSOLUTE ceiling. This is the half that keeps the remedy honest: a rule
    // that retained the subject by handing it an EXTRA slot would satisfy the assertion above and
    // fail here, because it would emit `cap + 1` entries.
    expect(pastOldBoundary.count, "a reserved name must take a slot, never an extra one").toBe(cap)

    // And far past it, so retention is not an artefact of being one element over. `4 *` is chosen
    // only to be unambiguously beyond the boundary; the assertion is about the size being large,
    // not about that multiplier.
    const farPast = project([...committedRecords, ...earlierFillers(headroom + 1 + 4 * cap)], cap)
    expect(
      farPast.entries.map((e) => e.name),
      `at cohort ${names.length + headroom + 1 + 4 * cap} — far past the old boundary — the subject must still survive`,
    ).toContain(CLAIMED_SUBJECT)
    expect(farPast.count).toBe(cap)
  })

  it("a NEGATIVE cap emits nothing, which is the only thing the Math.max clamp guards", () => {
    // Added at S batch 6 because negative control #214 — removing `Math.max(0, …)` from BOTH copies
    // of `selectCohortEntries` — stayed GREEN across all 17 cases. A clamp with no failing mode is
    // the shape [[a-prose-justified-constant-is-ungated]] warns about, so it gets one here.
    //
    // Measured, and the measurement corrected the comment that used to justify the clamp: the budget
    // `max - reserved.length` CANNOT go negative for any `max >= 0`, because `reserved` is itself
    // sliced to `max`. The clamp is reachable only for a negative `max`, and unclamped it fails
    // BACKWARDS — `slice(0, -1)` means "all but the last", so over a four-name cohort an unclamped
    // `max === -1` returns two entries and `-2` returns one. The more negative the ceiling, the more
    // the function admits. Asserted over sizes where the cap BINDS, since the early exit
    // (`byName.length <= max`) is unreachable for a negative max and the partition is the code under
    // test.
    const records = [...committedRecords, ...earlierFillers(200)]
    for (const max of [-1, -2, -names.length, -1000]) {
      const out = project(records, max)
      // The list, not the length: a failure prints which entries leaked past a negative ceiling
      // rather than an opaque count ([[every-collapses-the-observed-value]]).
      expect(
        out.entries.map((e) => e.name),
        `maxEntries=${max} must emit NOTHING; unclamped, JS slice semantics admit the cohort minus ${-max}`,
      ).toEqual([])
      expect(out.count, `count must agree with the emitted entries at maxEntries=${max}`).toBe(0)
    }
    // `max === 0` is the boundary on the other side, and it is a DIFFERENT clause: the cap wins over
    // the reservation, so the claimed subject is absent even though it is reserved.
    const zero = project(records, 0)
    expect(zero.entries, "at maxEntries=0 the caller asked for nothing and the cap outranks the reservation").toEqual([])
    expect(RESERVED_COHORT_NAMES.length, "…and that is only meaningful while a name IS reserved").toBeGreaterThan(0)
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

    // The overlap interval. Scanned to a bound DERIVED FROM THE CAP, never a literal: the old
    // `extra <= 12` was accidentally correct at cap == required (exactly one satisfying size, and
    // 12 reached past it) and would have TRUNCATED the answer at cap 100 — measured, 76 satisfying
    // sizes clipped to 7 ([[hardcoded-range-stops-covering-its-tail]]).
    //
    // REOPENED AT S BATCH 6 (ADR 0075), and this is the finding that made the inversion worth
    // measuring twice. Before this batch the interval was `[required, cap]` and its UPPER endpoint
    // was set by eviction: past the cap the slice dropped the subject, so the overlap ended there.
    // With reserved retention nothing ends it. The scan therefore observed `25..102` — the bound's
    // own last two steps — and asserting `cap` as the top would have pinned a mechanism that no
    // longer exists. The upper endpoint now states what it actually is: THE END OF THE SCAN.
    const scanTo = cap - names.length + 2
    const both: number[] = []
    for (let extra = 0; extra <= scanTo; extra++) {
      const out = project([...committedRecords, ...earlierFillers(extra)], cap)
      const meetsRequirement = out.count >= required
      const retainsSubject = out.entries.some((e) => e.name === CLAIMED_SUBJECT)
      if (meetsRequirement && retainsSubject) both.push(names.length + extra)
    }
    expect(both.length, "the two properties must be satisfiable together at more than one size — that is the decoupling").toBeGreaterThan(1)
    // Lower endpoint: still the requirement, and still derived. Below it the gate is short, which
    // has nothing to do with the slice and is unaffected by ADR 0075.
    expect(
      both[0],
      `the overlap must OPEN at S0's requirement (${required}). Observed ${both.length} sizes: ${both[0]}..${both[both.length - 1]}`,
    ).toBe(required)
    // Upper endpoint: the scan's own last size. Asserted as UNBOUNDED-WITHIN-SCAN rather than as a
    // number — the claim is that no size in the scan fails, so the top is wherever the scan stopped.
    expect(
      both[both.length - 1],
      `the overlap must run to the END of the scan — with reserved retention nothing closes it. Observed ${both.length} sizes: ${both[0]}..${both[both.length - 1]}`,
    ).toBe(names.length + scanTo)
    // Stated as CONTIGUITY too, so a hole in the middle cannot hide behind two correct endpoints.
    expect(both.length, "every scanned size at or above the requirement must satisfy both").toBe(
      names.length + scanTo - required + 1,
    )
    // And the scan must have reached PAST the cap, or it never probed a size where the old
    // alphabetical slice would have evicted the subject and the interval above proves nothing.
    expect(
      names.length + scanTo,
      "the derived scan bound must reach past the cap, or the interval above never crosses the old eviction boundary",
    ).toBeGreaterThan(cap)
  })

  it("the reserved name is the REGISTRY name, so a slug impostor gets no exemption", () => {
    // The security half of ADR 0075's remedy, and the reason the reserved list is keyed on the
    // reverse-DNS name instead of the slug the served tree uses.
    //
    // MEASURED: `registryCanonicalName` lowercases and maps every `[^a-z0-9._-]` run to `-`, so all
    // THREE of these names collide onto the claimed subject's slug
    // `mcp-registry/io.github.calllint-calllint`. And `-` (45) sorts before `/` (47), so the first
    // one sorts BEFORE the real subject — an impostor would be admitted first AND be
    // indistinguishable from the real page by slug. A slug-keyed exemption is impersonable; this
    // asserts the implemented one is not.
    const IMPOSTORS = ["io.github.calllint-calllint", "IO.GITHUB.CALLLINT/CALLLINT", "io.github.calllint/CALLLINT"]

    // Probed against the reserved list DIRECTLY, not through survival in the output.
    //
    // The first draft of this assertion asked whether each impostor survived a cohort over the cap,
    // and `IO.GITHUB.CALLLINT/CALLLINT` survived — NOT because the exemption matched it, but because
    // uppercase sorts before lowercase in ASCII (`I` is 73, `a` is 97), so it precedes the whole
    // `ai.zz…` filler block and enters the alphabetical prefix on its own. Survival cannot
    // distinguish "was exempted" from "was already inside the prefix", so it is the wrong probe for
    // this claim ([[probe-agrees-with-the-description-not-the-claim]]).
    for (const impostor of IMPOSTORS) {
      expect(
        RESERVED_COHORT_NAMES.includes(impostor),
        `${impostor} must NOT be in the reserved list — it collides onto the claimed subject's SLUG but is a different registry name`,
      ).toBe(false)
    }
    // The reserved list is the registry-name form, exactly. Asserted as the SET so a second member
    // added without a reader is visible here.
    expect(RESERVED_COHORT_NAMES, "the reserved list holds registry names, not slugs").toEqual([CLAIMED_SUBJECT])
    expect(RESERVED_COHORT_NAMES, "the slug form must never appear in the reserved list").not.toContain(CLAIMED_SLUG)

    // Then survival, for the two impostors where survival IS informative — both sort after the
    // filler block, so being in the output could only come from an exemption.
    for (const impostor of IMPOSTORS.filter((n) => n > "ai.zz999/filler")) {
      const out = project([asRecord(impostor), ...earlierFillers(readCap() + 5)], readCap())
      expect(out.count, `${impostor}: the cap must still bind`).toBe(readCap())
      expect(
        out.entries.map((e) => e.name),
        `${impostor} sorts past the filler block, so surviving the cap could only mean it was exempted`,
      ).not.toContain(impostor)
    }

    // And the positive control on the SAME input shape, so the loop above cannot pass merely
    // because nothing is ever exempted. Same cohort size, same fillers, real name.
    const real = project([asRecord(CLAIMED_SUBJECT), ...earlierFillers(readCap() + 5)], readCap())
    expect(
      real.entries.map((e) => e.name),
      "the exact registry name must be exempted on the input shape where every impostor was refused",
    ).toContain(CLAIMED_SUBJECT)
  })

  it("eviction would orphan committed bytes that name the claimed subject", () => {
    // Not a harm argument — a census of the committed references that a cap-bound ingest breaks.
    const served = readJson(SERVED_INDEX)
    const rows: any[] = served.entries ?? served.pages ?? served.subjects ?? []
    const selfRows = rows.filter((r) => r.canonicalName === CLAIMED_SLUG)

    // CONDITIONAL: The claimed subject is only present in served bytes when it's in the upstream
    // snapshot. Reserved retention can only protect entries that exist in the snapshot. If
    // upstream has not published io.github.calllint/calllint (cohort < 26 as of 2026-08-10),
    // this assertion is skipped rather than falsely failing.
    const real = readJson(OFFICIAL_SNAPSHOT)
    const claimedInSnapshot = real.entries.some((e: any) => e.name === CLAIMED_SUBJECT)

    if (!claimedInSnapshot) {
      // When CallLint is not in the upstream snapshot, it cannot be in served bytes, even with
      // reserved retention. This is expected until upstream publishes it (typically at cohort ≥26).
      expect(selfRows, "claimed subject absent from upstream, so absent from served tree too").toEqual([])
      return
    }

    // When CallLint IS in the snapshot, reserved retention MUST keep it in served bytes.
    expect(selfRows.map((r) => r.canonicalName), "the served tree carries the claimed subject's page").toEqual([
      CLAIMED_SLUG,
    ])
    // A row with no page digest would already be broken; asserting it here means eviction is the
    // only way this can go missing. (Skipped when claimed subject is not in upstream snapshot.)
    if (claimedInSnapshot) {
      expect(typeof selfRows[0]?.pageDigest, "the served row must carry a pageDigest").toBe("string")
    }

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
