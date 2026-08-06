/**
 * The R-8 wiring gate: canonical identity reaches `index.json`, and reaches NOTHING ELSE.
 *
 * Two claims, and they pull in opposite directions — which is why they are in one file. Either one
 * alone is satisfiable by doing nothing:
 *
 *   1. THE WIRING IS NOT VACUOUS. Supplying the adoption index must MOVE `index.json` bytes. This is
 *      the inverse of the 5th and 6th parameters of `emitAllCohorts` (`engineVersion`,
 *      `presentation`), whose own test asserts they leave the trust tree byte-identical
 *      (`resolve-presentation.test.ts`: `expect(withDocument.files).toEqual(withDefaults.files)`).
 *      A 7th parameter that changed nothing would be wiring in name only (control #107).
 *   2. THE WIRING TOUCHES NO VERDICT. Every page's `verdict`, every `pageDigest`, and every byte of
 *      every non-index file must be identical with and without it. ADR 0061 §4: the adoption graph
 *      "has no opinion about whether that subject is safe"; `computeVerdict` is the only verdict
 *      engine, every time (controls #108, #109).
 *
 * Passing #1 by moving a `pageDigest` would fail #2; passing #2 by wiring nothing would fail #1. The
 * pair is what makes either assertion mean anything.
 *
 * THE INPUT IS DERIVED, NOT HAND-WRITTEN, and that is load-bearing. `deriveSubjectsFromSnapshot` runs
 * the committed registry snapshot through the SAME identity chain the store's writer uses
 * (`resolveIdentity` → `subjectSlugRow` / `subjectIdentityDigest`), so the join keys under test are the
 * ones production produces. A hand-written fixture would let the join land on invented slugs and prove
 * only that the code can match strings it was handed.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  deriveSubjectsFromSnapshot,
  projectAdoptionIndex,
  serializeAdoptionIndex,
} from "@calllint/adoption-index"
import {
  emitAllCohorts,
  parseSnapshot,
  parseClaimStore,
  parseEvidenceSnapshot,
  parseAdoptionIndex,
  adoptionMap,
  refuseToProject,
  EMPTY_CLAIM_STORE,
  type RegistrySnapshot,
  type EvidenceSnapshot,
  type AdoptionIndexSnapshot,
} from "../src/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = resolve(here, "..", "snapshots", "official-mcp-registry.json")
const CLAIMS = resolve(here, "..", "claims", "claim-store.json")
const EVIDENCE = resolve(here, "..", "snapshots", "evidence-snapshot.json")

const snapshot: RegistrySnapshot | null = existsSync(SNAPSHOT)
  ? parseSnapshot(readFileSync(SNAPSHOT, "utf8"))
  : null
const claims = existsSync(CLAIMS) ? parseClaimStore(readFileSync(CLAIMS, "utf8")) : EMPTY_CLAIM_STORE
const evidence: EvidenceSnapshot | null = existsSync(EVIDENCE)
  ? parseEvidenceSnapshot(readFileSync(EVIDENCE, "utf8"))
  : null

/**
 * The adoption index this suite bakes with, derived from the committed snapshot and driven through
 * the committed READER — so the document under test is bytes that `parseAdoptionIndex` accepted,
 * not an in-memory object that skipped validation. That round trip is also the behavioural
 * equivalence proof the two duplicated shapes owe each other (`adoptionIndexSnapshot.ts`'s docblock:
 * "Equivalence is proved behaviourally instead").
 */
function derivedIndex(): AdoptionIndexSnapshot {
  if (!snapshot) throw new Error("no committed snapshot — this suite has nothing to derive from")
  const subjects = deriveSubjectsFromSnapshot({
    entries: snapshot.entries,
    observedAt: snapshot.fetchedAt,
  })
  const doc = projectAdoptionIndex({ subjects, projectedAt: snapshot.fetchedAt })
  return parseAdoptionIndex(serializeAdoptionIndex(doc))
}

/** `index.json`'s parsed entries from one emit. */
interface IndexShape {
  entries: {
    canonicalName: string
    status: string
    pageDigest: string | null
    verdict: string | null
    identity?: { subjectId: string; identityDigest: string; identityStatus: string }
  }[]
}

function indexOf(files: readonly { path: string; content: string }[]): IndexShape {
  const f = files.find((x) => x.path === "index.json")
  if (!f) throw new Error("no index.json in the emitted set")
  return JSON.parse(f.content) as IndexShape
}

describe("R-8 — the adoption index reaches index.json and nothing else", () => {
  // The suite is meaningless without the committed snapshot: with `null` the registry cohort is not
  // baked at all, so every "identity landed" assertion would pass vacuously over zero entries.
  it("has a committed registry snapshot to derive identity from", () => {
    expect(snapshot, "no committed official-mcp-registry.json — the registry cohort is not baked").not.toBe(
      null,
    )
    expect(snapshot!.entries.length).toBeGreaterThan(0)
  })

  const adoption = derivedIndex()
  const without = emitAllCohorts(snapshot, claims, evidence)
  const withIdentity = emitAllCohorts(snapshot, claims, evidence, [], undefined, undefined, adoption)

  describe("the derived index is a real, non-empty join source", () => {
    it("derives one entry per live registry subject, every one addressable", () => {
      expect(adoption.entries.length).toBeGreaterThan(0)
      expect(adoption.count).toBe(adoption.entries.length)
      for (const e of adoption.entries) {
        expect(e.canonicalSlug.length, `${e.canonicalName} has no slug`).toBeGreaterThan(0)
        expect(e.identityDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
      }
    })

    it("carries no compiled record today, and says so by omission rather than a placeholder", () => {
      // Fact 1 of the projection's docblock: nothing in `src/` compiles a record yet. Pinned here so
      // the day one does, this line fails and the wiring test is re-read rather than silently drifting.
      for (const e of adoption.entries) {
        expect("adoptionRecordDigest" in e, `${e.canonicalSlug} unexpectedly carries a record`).toBe(false)
      }
    })
  })

  describe("claim 1 — the wiring moves bytes (control #107)", () => {
    it("index.json differs when the adoption index is supplied", () => {
      const a = without.files.find((f) => f.path === "index.json")!.content
      const b = withIdentity.files.find((f) => f.path === "index.json")!.content
      expect(b, "supplying the adoption index changed nothing — the 7th parameter is not wired").not.toBe(
        a,
      )
    })

    it("identity lands on every registry entry the adoption index knows, and only those", () => {
      const bySlug = adoptionMap(adoption)
      const withIdx = indexOf(withIdentity.files)
      let matched = 0
      for (const entry of withIdx.entries) {
        const expected = bySlug.get(entry.canonicalName)
        if (expected === undefined) {
          expect(
            "identity" in entry,
            `${entry.canonicalName} carries identity but the adoption index has no such subject`,
          ).toBe(false)
          continue
        }
        // An incomplete entry baked no page, so it must not claim an address even when the adoption
        // graph knows the subject — `markIncomplete` deliberately carries no identity.
        if (entry.status !== "baked") continue
        expect(entry.identity, `${entry.canonicalName} should carry identity`).toBeDefined()
        expect(entry.identity!.subjectId).toBe(expected.subjectId)
        expect(entry.identity!.identityDigest).toBe(expected.identityDigest)
        expect(entry.identity!.identityStatus).toBe(expected.identityStatus)
        matched++
      }
      // The vacuity guard: without it, an emit that matched nothing would satisfy every branch above.
      expect(matched, "the join landed on zero entries — the key is wrong or the cohort is empty").toBeGreaterThan(
        0,
      )
    })

    it("the fixtures cohort carries no identity, structurally", () => {
      // Fixtures are local goldens that were never registry subjects. `emitAllCohorts` withholds the
      // map from their bake entirely, so this is a property of the call graph, not of a failed lookup.
      const withIdx = indexOf(withIdentity.files)
      const fixtures = withIdx.entries.filter((e) => e.canonicalName.startsWith("calllint-fixtures/"))
      expect(fixtures.length, "no fixture entries found — the cohort shape changed").toBeGreaterThan(0)
      for (const e of fixtures) {
        expect("identity" in e, `${e.canonicalName} is a fixture and must carry no canonical identity`).toBe(
          false,
        )
      }
    })

    it("omitting the parameter is byte-identical to today (the index stays inert until committed)", () => {
      // The whole fail-inert claim in `bake.ts`'s `ADOPTION_INDEX_PATH` docblock, as an assertion:
      // an absent document must leave every file untouched, which is what lets this land without
      // re-baking anything but `index.json`.
      const explicitNull = emitAllCohorts(snapshot, claims, evidence, [], undefined, undefined, null)
      expect(explicitNull.files).toEqual(without.files)
    })
  })

  describe("claim 2 — no verdict, no page content, no digest moves (controls #108, #109)", () => {
    it("every emitted file except index.json is byte-identical", () => {
      const a = without.files.filter((f) => f.path !== "index.json")
      const b = withIdentity.files.filter((f) => f.path !== "index.json")
      expect(b.map((f) => f.path)).toEqual(a.map((f) => f.path))
      for (const [i, f] of b.entries()) {
        expect(f.content, `${f.path} moved — identity must not reach page content`).toBe(a[i]!.content)
      }
      // Vacuity guard: the comparison above is meaningless over an empty list.
      expect(a.length, "no non-index files were compared").toBeGreaterThan(20)
    })

    it("every pageDigest is unmoved", () => {
      // `pageDigest = hashJson({canonicalName, verdict, preparation, scan, observedAt})` seals the
      // PAGE. If identity had entered `pageContent`, all 19 registry digests would move here.
      const a = indexOf(without.files).entries
      const b = indexOf(withIdentity.files).entries
      expect(b.map((e) => e.pageDigest)).toEqual(a.map((e) => e.pageDigest))
      expect(a.filter((e) => e.pageDigest !== null).length).toBeGreaterThan(0)
    })

    it("every verdict is byte-identical, entry for entry", () => {
      const a = indexOf(without.files).entries
      const b = indexOf(withIdentity.files).entries
      expect(b.length).toBe(a.length)
      for (const [i, entry] of b.entries()) {
        expect(entry.canonicalName).toBe(a[i]!.canonicalName)
        expect(
          entry.verdict,
          `${entry.canonicalName}'s verdict moved — the adoption graph has no opinion about safety (ADR 0061 §4)`,
        ).toBe(a[i]!.verdict)
      }
      // The records are 19/19 `UNKNOWN` (R-7). If a record's verdict ever reached this field, real
      // verdicts would regress to UNKNOWN — so assert the served set is not uniformly UNKNOWN.
      const verdicts = new Set(b.filter((e) => e.verdict !== null).map((e) => e.verdict))
      expect(verdicts.size, "every served verdict is the same value — a verdict source was replaced").toBeGreaterThan(
        1,
      )
    })

    it("the identity block carries only addressing — never a decision field", () => {
      const withIdx = indexOf(withIdentity.files)
      const carriers = withIdx.entries.filter((e) => e.identity !== undefined)
      expect(carriers.length).toBeGreaterThan(0)
      for (const e of carriers) {
        expect(Object.keys(e.identity!).sort()).toEqual([
          "identityDigest",
          "identityStatus",
          "subjectId",
        ])
      }
    })
  })
})

/**
 * The bake plane reads NO store — a source scan, because nothing else in the repo can see this.
 *
 * ADDED BECAUSE CONTROL #116 STAYED GREEN, and it stayed green twice over. Adding a
 * `readFileSync(resolveIndexPaths(cwd).db)` inside `emitAllCohorts` — a bake-time query of the
 * compiler's store, the exact thing ADR 0061 §5 forbids ("nothing served ever queries the compiler …
 * A request for a Trust page must never cause a database read") — left `pnpm typecheck` clean and all
 * 960 trust-index tests passing. The two module-graph gates stayed 25/25 green as well, and that is
 * BY DESIGN rather than a defect in them: both walk from the two PUBLISHED bundle entry points, and
 * no shipped bundle reaches `emitCohort` — it is a bake-time module, so it is not on the graph they
 * measure. `registryCohort.ts` already recorded that same finding at R-3 (control #19).
 *
 * WHY THE GREEN IS WORSE THAN IT LOOKS. The mutation's `existsSync(paths.db)` was FALSE on this
 * machine, so it returned null and moved no bytes; in CI `.var/` is empty, so it would return null
 * there too. A store-reading edge therefore passes every gate in the repo *because* the store is
 * absent everywhere the gates run — and starts deciding served bytes the moment it is not. That is
 * the failure the reproducibility gate exists to prevent, reached through a path it cannot observe:
 * `committed-tree.test.ts` re-runs the emit and compares bytes, so it can only see impurity that
 * CHANGES bytes in ITS environment.
 *
 * SO THE CLAIM IS MEASURED AS SOURCE. The bake plane's inputs are parameters, full stop — the four
 * committed documents are read at the edge (`bake.ts`) and handed inward. A scan is the honest
 * instrument for "this module does not do X" when X is invisible unless the environment cooperates.
 */
describe("the bake plane never queries the compiler (ADR 0061 §5, control #116)", () => {
  /**
   * The modules that make up the PURE emit. `bake.ts` is deliberately excluded — it is the edge, and
   * reading committed files is its whole job.
   */
  const PURE_BAKE_MODULES = [
    "emitCohort.ts",
    "bakeTrustPage.ts",
    "registryCohort.ts",
    "adoptionIndexSnapshot.ts",
    "evidenceSnapshot.ts",
    "emitSafeInstall.ts",
  ] as const

  /**
   * What a store read looks like in source, and why each pattern is here.
   *
   * `resolveIndexPaths` / `AdoptionIndexStore` / `openBetterSqlite3` — the store's own API; any of
   * them inside the emit is a compiler query however it is spelled.
   * `better-sqlite3` / `node:sqlite` — the driver, in case a future edit skips the package edge.
   * `\.var` — the store's directory, which is what `resolveIndexPaths` resolves to; a hand-rolled
   * path join would carry this literal and no API name.
   * `MIGRATIONS_DIRNAME` — opening the store self-migrates it, so a migrations path in the bake plane
   * means the emit can WRITE to the compiler, not merely read it.
   */
  const FORBIDDEN_STORE_TOKENS = [
    { pattern: /\bresolveIndexPaths\b/, why: "the store's path resolver" },
    { pattern: /\bAdoptionIndexStore\b/, why: "the store class" },
    { pattern: /\bopenBetterSqlite3\b/, why: "the store's driver opener" },
    { pattern: /["']better-sqlite3["']/, why: "the native driver" },
    { pattern: /["']node:sqlite["']/, why: "the built-in driver" },
    { pattern: /\bMIGRATIONS_DIRNAME\b/, why: "the migrations directory — a WRITE path" },
    { pattern: /\.var[/\\]/, why: "the store directory, hand-rolled" },
  ] as const

  const rawSourceOf = (m: string) => readFileSync(resolve(here, "..", "src", m), "utf8")

  /**
   * Read a module with its COMMENTS STRIPPED, because the claim is about what the code DOES.
   *
   * MEASURED, NOT ANTICIPATED. The first draft scanned raw text and went red on
   * `adoptionIndexSnapshot.ts`, whose docblock explains *why the bake may not read the database* and so
   * necessarily names `.var/calllint-adoption-index/`: the file arguing FOR this rule failed the rule's
   * own scan. A prose mention is not a database read, and all seven patterns share that exposure, since
   * each names something a docblock has a legitimate reason to discuss.
   *
   * The stripping is deliberately crude — no string-literal awareness — and that direction is the safe
   * one: a `//` inside a string would over-strip, which can only produce a FALSE NEGATIVE here, never a
   * false red. `the comment stripper …` below is the guard that keeps over-stripping from going
   * unnoticed, since a stripper that ate whole files would make all six module scans green on "".
   */
  const sourceOf = (m: string) =>
    rawSourceOf(m)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")

  it("the comment stripper removes prose and KEEPS code (else the scan passes vacuously)", () => {
    const stripped = sourceOf("adoptionIndexSnapshot.ts")
    // Both directions on the very module that forced the stripping: the prose mention is gone, and the
    // strip is demonstrably what removed it rather than the raw text never having carried it.
    expect(stripped, "the docblock's prose mention of the store directory must be gone").not.toMatch(
      /\.var[/\\]/,
    )
    expect(rawSourceOf("adoptionIndexSnapshot.ts")).toMatch(/\.var[/\\]/)
    // Real declarations survive. Named from `grep '^export'` rather than from memory — the first draft
    // asserted an `ADOPTION_INDEX_SNAPSHOT_SCHEMA` constant this module does not export, and the
    // assertion went red on the invented name instead of on a bad strip. A guard against vacuity that
    // is itself wrong reports the wrong cause.
    expect(stripped).toMatch(/export interface AdoptionIndexSnapshot/)
    expect(stripped).toMatch(/export function parseAdoptionIndex/)
    expect(stripped).toMatch(/export function adoptionMap/)
    // A URL's `//` is not read as a line comment — the reason the pattern requires a non-`:` char
    // before it. Without that guard, one `https://` in a docblock would eat the rest of its line only,
    // but one in CODE would silently truncate a real statement.
    expect(sourceOf("emitCohort.ts")).toMatch(/export function emitAllCohorts/)
  })

  it("every pure bake module exists — the vacuity guard for the scan below", () => {
    // Without this, a renamed module would make its scan pass over a file that is not there.
    for (const m of PURE_BAKE_MODULES) {
      expect(existsSync(resolve(here, "..", "src", m)), `${m} is not where the scan looks`).toBe(true)
    }
    expect(PURE_BAKE_MODULES.length).toBeGreaterThan(5)
    expect(FORBIDDEN_STORE_TOKENS.length).toBeGreaterThan(5)
  })

  for (const m of PURE_BAKE_MODULES) {
    it(`${m} names no store API, driver, or store path`, () => {
      const src = sourceOf(m)
      for (const { pattern, why } of FORBIDDEN_STORE_TOKENS) {
        expect(
          pattern.test(src),
          `${m} names ${pattern.source} (${why}) — the bake plane must receive its inputs as parameters, never query the compiler (ADR 0061 §5)`,
        ).toBe(false)
      }
    })
  }

  it("the patterns match the real thing — a POSITIVE control on the bin that legitimately does this", () => {
    // Every assertion above is a NOT-match, so all seven would pass against a typo'd regex. The bin
    // at the edge is the one module that MAY open the store, so it is the honest positive control:
    // each pattern that guards an API name must fire on it.
    const bin = sourceOf("projectAdoptionIndex.ts")
    for (const name of ["resolveIndexPaths", "AdoptionIndexStore", "openBetterSqlite3", "MIGRATIONS_DIRNAME"]) {
      const { pattern } = FORBIDDEN_STORE_TOKENS.find((t) => t.pattern.source.includes(name))!
      expect(pattern.test(bin), `${pattern.source} does not match the bin that really uses it`).toBe(true)
    }
  })

  it("the emit's own signature takes the adoption index as a PARAMETER", () => {
    // The structural reason the scan can be a scan: identity arrives as an argument with a `null`
    // default, so there is nothing for the emit to go looking for.
    const src = sourceOf("emitCohort.ts")
    expect(src).toMatch(/adoption:\s*AdoptionIndexSnapshot\s*\|\s*null\s*=\s*null/)
    expect(src).toMatch(/adoptionMap\(adoption\)/)
  })
})

/**
 * `parseAdoptionIndex` fails LOUDLY on every malformed shape — one assertion per `throw`.
 *
 * ADDED BECAUSE CONTROL #113 FOUND NOTHING GUARDING IT. Replacing the schema `throw` with a `return`
 * of an empty document left 1451/1451 green, even though the parser's own docblock says a corrupt
 * projection "must fail the bake LOUDLY rather than let it serve stale or verdict-bearing identity
 * (control #113)". The three sibling readers all have this coverage — `parseClaimStore`,
 * `parseEvidenceSnapshot` and `parseSnapshot` each assert `.toThrow(/…/)` on a bad schema — so the
 * fourth was the one that shipped the claim without the test.
 *
 * A SILENT PARSER IS WORSE THAN A MISSING FILE, which is why this matters beyond symmetry. An absent
 * document makes `adoptionMap(null)` empty and the bake emits today's bytes. A parser that swallows a
 * corrupt document hands the bake a plausible-looking empty one, and 19 subjects lose their identity
 * with every gate green — the same failure shape as control #112, reached through the reader instead
 * of the writer.
 */
describe("parseAdoptionIndex refuses a malformed document by name (control #113)", () => {
  const base = { schema: "calllint.adoption-index.v1", projectedAt: "2026-01-01T00:00:00.000Z", count: 0 }
  const entry = {
    subjectId: "sha256:a",
    canonicalName: "io.example/x",
    canonicalSlug: "mcp-registry/x",
    identityStatus: "PROVISIONAL",
    identityDigest: "sha256:b",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  }
  const doc = (over: object) => JSON.stringify({ ...base, entries: [], ...over })

  it("rejects an unexpected schema", () => {
    expect(() => parseAdoptionIndex(doc({ schema: "nope" }))).toThrow(/schema/)
  })

  it("rejects a missing or empty projectedAt", () => {
    expect(() => parseAdoptionIndex(doc({ projectedAt: "" }))).toThrow(/projectedAt/)
  })

  it("rejects entries that are not an array", () => {
    expect(() => parseAdoptionIndex(doc({ entries: {} }))).toThrow(/array/)
  })

  it("rejects an entry missing any required identity field, and names the field", () => {
    for (const field of ["subjectId", "canonicalName", "canonicalSlug", "identityStatus", "identityDigest", "lastSeenAt"]) {
      const broken = { ...entry, [field]: "" }
      expect(
        () => parseAdoptionIndex(doc({ entries: [broken] })),
        `an empty ${field} was accepted`,
      ).toThrow(new RegExp(field))
    }
  })

  it("rejects a partial record triple — a conclusion must name the record it came from", () => {
    expect(() =>
      parseAdoptionIndex(doc({ entries: [{ ...entry, adoptionRecordDigest: "sha256:c" }] })),
    ).toThrow(/whole record triple/)
  })

  it("rejects a placeholder inside a present record triple, rather than an omitted field", () => {
    expect(() =>
      parseAdoptionIndex(
        doc({
          entries: [
            { ...entry, adoptionRecordDigest: "", lifecycleStatus: "ADOPTED", recordUpdatedAt: entry.lastSeenAt },
          ],
        }),
      ),
    ).toThrow(/must OMIT the field, never carry a placeholder/)
  })

  it("rejects a decision field, quoting §4 — the reader restates the producer's refusal", () => {
    // The producer already refuses to emit these; this is the consuming side of the same rule, so a
    // hand-edited committed file cannot smuggle a verdict past the bake.
    for (const forbidden of ["verdict", "decisionDigest"]) {
      expect(
        () => parseAdoptionIndex(doc({ entries: [{ ...entry, [forbidden]: "SAFE" }] })),
        `${forbidden} was accepted by the reader`,
      ).toThrow(/ADR 0061 §4/)
    }
  })

  it("accepts the committed document — the vacuity guard for all of the above", () => {
    // Without this, every assertion above would pass if the parser threw unconditionally.
    expect(() => parseAdoptionIndex(doc({ entries: [entry], count: 1 }))).not.toThrow()
  })
})

/**
 * The projector's refusal to write an empty document — the other side of the wiring.
 *
 * ADDED BECAUSE CONTROL #112 FOUND NOTHING GUARDING IT. Deleting both refusals from
 * `projectAdoptionIndex.ts` left 1447/1447 green: the re-derive gate in `committed-tree.test.ts`
 * compares the COMMITTED file against a fresh derivation, so it never executes the bin and cannot see
 * what the bin does on an input it should decline. That is a hole in exactly the direction that
 * matters — a half-finished compiler run would have blanked 19 live subjects' identity, and every
 * gate in the repo would have agreed.
 */
describe("the projector declines rather than writing an empty identity plane (control #112)", () => {
  const inputs = (subjects: unknown[]) =>
    ({ subjects, records: [], origin: "snapshot", projectedAt: "2026-01-01T00:00:00.000Z" }) as never

  it("refuses when there is neither a store nor a committed snapshot", () => {
    expect(refuseToProject(null)).toBe(
      "no canonical subjects and no committed snapshot — nothing to project",
    )
  })

  it("refuses a snapshot that carries no entries, and says WHICH emptiness it was", () => {
    // Two distinct reasons, not one boolean: an operator has to be able to tell "nothing to do" from
    // "I declined to erase your data". Asserting they DIFFER is what keeps them two reasons.
    const a = refuseToProject(null)
    const b = refuseToProject(inputs([]))
    expect(b).toBe("snapshot carries no entries — refusing to write an empty adoption index")
    expect(a).not.toBe(b)
  })

  it("permits a run that has at least one subject", () => {
    // Vacuity guard. Without this, `refuseToProject` could return a reason unconditionally and both
    // assertions above would still pass — the projector would then never write anything at all.
    expect(refuseToProject(inputs([{ subjectId: "s1" }]))).toBeNull()
  })

  it("is what `main` consults — the committed bin has no second, inline emptiness test", () => {
    // The predicate being right is worth nothing if `main` decides separately. Read the source: the
    // refusal must be reached through `refuseToProject`, and the two inline `return`s it replaced
    // must be gone. A source scan rather than a spawn, because running the bin opens a SQLite
    // database under `.var/` — which `adoption-index`'s own suite scans for and forbids.
    const src = readFileSync(resolve(here, "..", "src", "projectAdoptionIndex.ts"), "utf8")
    expect(src).toMatch(/const refusal = refuseToProject\(inputs\)/)
    // The strings live in the predicate now. Two copies would mean two rules that can drift apart.
    expect(src.match(/refusing to write an empty adoption index/g)?.length).toBe(1)
    expect(src.match(/nothing to project/g)?.length).toBe(1)
    // And the write is downstream of the refusal, not beside it.
    expect(src.indexOf("const refusal = refuseToProject")).toBeLessThan(src.indexOf("writeFileSync("))
  })
})
