/**
 * `OFFICIAL_META_KEY` drift — the test R-8 promised and did not write.
 *
 * `deriveSubjectsFromSnapshot.ts` duplicates one string literal that `officialRegistry.ts` also
 * holds, because `OFFICIAL_META` is module-private there and widening a module's surface to serve a
 * derivation would invert the dependency. Its docblock said the duplication was "pinned by a test
 * that reads a real record's lifecycle back out". Measured at HEAD `994a2b6`: no such test existed.
 * R-8's own memory records the debt ("OWED, deliberately not in R-8"), so this closes it rather
 * than discovering it.
 *
 * THE DOCBLOCK ALSO MISSTATED THE FAILURE MODE, and the correction is in that file, in place. It
 * claimed a drift "fails rather than silently yielding `status: null` on every entry".
 * `normalizeLifecycle` has no `null` branch — its `default:` returns `"unknown"`
 * (`officialRegistry.ts:168-179`), and it returns it BY DESIGN: "an unrecognized status becomes
 * `unknown`, never `active`", because UNKNOWN is not SAFE. So a drift is worse than the docblock
 * feared, not better: `null` is obviously missing data, while `"unknown"` is a legal, expected,
 * fully-typed member of `SourceLifecycleStatus` that no schema check, no parse, and no type can
 * distinguish from a real observation of an unrecognized upstream status.
 *
 * MEASURED consequences of a one-character drift, both of them silent, neither of them `null`:
 *   - `lifecycle.status`  active x19  →  unknown x19
 *   - `lifecycle.isLatest`  true x19  →  ABSENT x19  (the `typeof === "boolean"` guard never fires)
 *
 * WHY THE ASSERTIONS LAND ON `deriveSourceRecords` AND NOT ON SUBJECTS. Measured: a drifted key
 * still yields 19 subjects, because `resolveIdentity` reads `claimedIdentity` and never touches
 * `lifecycle`. A test that derived subjects and counted them would be GREEN under full drift — the
 * no-op assertion shape [[negative-control-validity-checklist]] warns about. The lifecycle is
 * readable only one layer up, at the source records, so that is where the pin goes.
 *
 * The second `isLatest` consequence is why this matters beyond a status string.
 * `deriveSubjectsFromSnapshot.ts` FORCES `isLatest: true` precisely because "a derivation that left
 * the flag absent would re-filter an already-filtered set and produce fewer subjects than the
 * pipeline" — so drift silently disarms a guard that file went out of its way to install.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  deriveSourceRecords,
  deriveSubjectsFromSnapshot,
  OFFICIAL_META_KEY,
  toSourceRecord,
} from "../src/index.js"
import { parseSnapshot } from "../../trust-index/src/snapshot.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SNAPSHOT_PATH = join(PKG_ROOT, "..", "trust-index", "snapshots", "official-mcp-registry.json")
const OFFICIAL_REGISTRY_SRC = join(PKG_ROOT, "src", "sources", "officialRegistry.ts")
const T0 = "2026-08-01T00:00:00.000Z"

/** The real committed corpus, parsed through the shipped parser — never hand-authored. */
const snapshot = parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8"))

describe("OFFICIAL_META_KEY is pinned against the corpus and against its private twin", () => {
  it("the corpus actually carries a lifecycle to read — the vacuity guard for everything below", () => {
    // Without this, every assertion in this file passes on an empty set or on a corpus whose
    // entries carry no status at all, and the drift guard would report "no drift" about nothing.
    expect(snapshot.entries.length).toBeGreaterThan(0)
    const withStatus = snapshot.entries.filter((e) => typeof e.status === "string" && e.status.length > 0)
    expect(withStatus.length, "no committed entry carries a status — the pin below is vacuous").toBe(
      snapshot.entries.length,
    )
    // And the statuses are ones `normalizeLifecycle` RECOGNIZES. A corpus of genuinely unrecognized
    // statuses would legitimately normalize to `"unknown"`, making the drift indistinguishable from
    // the healthy case — the one corpus shape that would make this whole file unfalsifiable.
    const recognized = new Set(["active", "deprecated", "deleted"])
    expect(withStatus.every((e) => recognized.has(String(e.status)))).toBe(true)
  })

  it("a real record's lifecycle reads back out through the key (the promise R-8 made)", () => {
    const records = deriveSourceRecords(snapshot.entries, T0)
    expect(records).toHaveLength(snapshot.entries.length)

    // THE POSITIVE ASSERTION. Not "no entry is unknown" — that is the same statement, but it goes
    // green on an empty set. Count the entries whose status survived the round trip.
    const active = records.filter((r) => r.lifecycle.status === "active")
    expect(active.length, "the derived records lost their lifecycle — the _meta key is not being read").toBe(
      snapshot.entries.length,
    )
    expect(records.some((r) => r.lifecycle.status === "unknown")).toBe(false)

    // The SECOND consequence, and the one a status-only test would miss entirely. `toSourceRecord`
    // assigns `isLatest` only when `typeof meta?.isLatest === "boolean"`, so a missed `_meta`
    // silently drops the flag that `deriveSubjectsFromSnapshot` forces true on purpose.
    expect(records.filter((r) => r.lifecycle.isLatest === true)).toHaveLength(snapshot.entries.length)
  })

  it("a one-character drift is CAUGHT — the negative control, run as a test", () => {
    // Applied to the INPUT rather than to the source, so this stays a test rather than a mutation:
    // it feeds `toSourceRecord` the same corpus under a `_meta` key that differs by one character,
    // which is exactly what a drift between the two spellings produces at this seam.
    const drifted = snapshot.entries
      .map((e) => {
        const server: Record<string, unknown> = { name: e.name }
        if (e.version != null) server.version = e.version
        return toSourceRecord(
          { server, _meta: { [`${OFFICIAL_META_KEY}X`]: { status: e.status, isLatest: true } } } as never,
          T0,
        )
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    // MEASURED, both of them. The record count is UNCHANGED — which is the point: nothing throws,
    // nothing is null, the count still says 19. Only the lifecycle is quietly gone.
    expect(drifted).toHaveLength(snapshot.entries.length)

    // Asserted as the SET of observed statuses rather than `.every(...)`, because control #125
    // (`normalizeLifecycle`'s `default:` made to return `null`) reported only a bare
    // "expected false to be true" through the boolean form — a red with no name on it. The set
    // form prints the value that actually arrived, and it is also strictly stronger: `.every()`
    // is vacuously true on an empty array, while `toEqual(["unknown"])` demands at least one.
    const driftedStatuses = [...new Set(drifted.map((r) => r.lifecycle.status))]
    expect(
      driftedStatuses,
      "a drift must normalize EVERY lifecycle to `unknown` — another value here means `normalizeLifecycle`'s `default:` branch changed, and the failure mode this file documents is stale again",
    ).toEqual(["unknown"])
    expect(
      drifted.filter((r) => r.lifecycle.isLatest === true),
      "a drift must drop `isLatest` on every record — the `typeof === \"boolean\"` guard cannot fire on a missed `_meta` key",
    ).toHaveLength(0)
  })

  it("the two spellings are byte-identical — read from SOURCE, since the twin is module-private", () => {
    // `OFFICIAL_META` is not exported, so the only way to compare is to read the literal out of the
    // source text. Comments are stripped first: a docblock that discusses the key would otherwise
    // satisfy this assertion without the CODE agreeing ([[source-scan-must-read-code-not-prose]]).
    const raw = readFileSync(OFFICIAL_REGISTRY_SRC, "utf8")
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

    // Two-sided guard on the stripper, because it is now load-bearing: a stripper that ate the file
    // would make the match below fail on "" and report a drift that does not exist, and one that
    // stripped nothing would let prose satisfy a claim about code.
    expect(stripped, "the stripper ate the declarations").toMatch(/export function toSourceRecord/)
    expect(stripped).toMatch(/export function normalizeLifecycle/)
    expect(raw.length).toBeGreaterThan(stripped.length)

    const match = /const OFFICIAL_META\s*=\s*"([^"]+)"/.exec(stripped)
    expect(match, "officialRegistry.ts no longer declares `const OFFICIAL_META = \"…\"` — the pin cannot read it").not.toBeNull()
    expect(match![1], "the two spellings of the registry's _meta key have DRIFTED").toBe(OFFICIAL_META_KEY)
  })

  it("subjects are BLIND to this drift — why the pin is not written one layer down", () => {
    // The honest record of why the assertions above target records. This is not a redundant count:
    // it is the measurement that makes a subjects-level test unacceptable, kept as an executable
    // fact so a later refactor cannot quietly move the pin here and believe it still guards.
    //
    // THE ORIGINAL REASON IS FALSIFIED, AND IS INVERTED HERE IN PLACE. It read "`StoredSubject`
    // carries no lifecycle field at all — so there is nothing here a drift could move", asserted as
    // two `not.toContain` lines. R-11 gave the row a lifecycle (`migrations/003`), so the absence
    // that argument rested on is gone. The CONCLUSION survives, on a strictly stronger measurement:
    // the drift IS reachable here (`toRawItem` builds its `_meta` from the same shared constant),
    // yet the derivation writes `lifecycleStatus` as a LITERAL rather than as a function of
    // `_meta` — so the field is present AND provably immovable. Asserted as deep equality over the
    // whole subject array instead of over two key names, because what makes a pin here
    // unfalsifiable is that NO field moves, not that two of them are absent.
    const subjects = deriveSubjectsFromSnapshot({ entries: snapshot.entries, observedAt: T0 })
    expect(subjects).toHaveLength(snapshot.entries.length)
    expect(subjects.every((s) => s.identityDigest.length > 0)).toBe(true)

    // `status` is the ONE lever a drift moves that is reachable from this input: `isLatest` is
    // forced true by the derivation and never read from the entry, so it cannot be gutted from
    // here. An unrecognized status is what a drifted key produces downstream (`→ "unknown"`).
    // Applied to the input, so this stays a test and not a mutation of the constant.
    const gutted = snapshot.entries.map((e) => ({ ...e, status: "drifted-x" }))
    const fromGutted = deriveSubjectsFromSnapshot({ entries: gutted, observedAt: T0 })
    expect(
      fromGutted,
      "a gutted lifecycle moved a subject — a subjects-level pin is NOT unfalsifiable after all, and the assertions above belong here too",
    ).toEqual(subjects)
    expect(
      [...new Set(fromGutted.map((s) => s.lifecycleStatus))],
      "the derivation began reading `_meta` for its lifecycle — it must stay a literal, or a drift silently de-lists the cohort",
    ).toEqual(["ACTIVE"])
  })
})
