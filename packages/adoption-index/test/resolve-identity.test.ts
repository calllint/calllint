/**
 * resolveIdentity — the pure identity resolver, graded over its whole input space.
 *
 * WHY SYNTHETIC FIXTURES ARE MANDATORY HERE, stated up front because it is the reason this
 * file is shaped the way it is. Measured over the committed 25-entry corpus: raw name 25
 * distinct / 0 collisions · slug 25 / 0 · repositoryUrl 11 non-null / 0 · package identifier
 * 2 / 0 · publisher head 17 / 1 apparent-but-not-a-conflict. A suite that exercised the
 * resolver only through that snapshot would pass with the conflict branches never entered, and
 * its green would say nothing about them — R-2's control #11 restated: a control that passes
 * when it should fail is a finding about the harness.
 *
 * ONE SENTENCE HERE IS NOW INVERTED, kept visible because the prediction it got wrong is worth
 * more than a clean paragraph. It read: "So EVERY conflict class is structurally unreachable on
 * real data." The measurements are unchanged; their SCOPE was the error. They describe the 25
 * committed snapshot entries, and identity resolution now runs over the source's full live
 * cohort (19_739 `active` + `isLatest` names, walked to `reason=exhausted` on 2026-08-04), where
 * the SLUG class is measured — at least two case-fold pairs, a floor rather than a count.
 * "Unreachable" was true of the corpus and never of the source; the corpus was the whole world
 * this package could see at R-3, and the cap raise widened it.
 *
 * The remaining four classes are still unexercised by real data, so synthetic input remains
 * mandatory for them — the reason this file exists is intact, only its universal quantifier is
 * gone. The corpus is still measured (the last describe), because "0 conflicts on real data"
 * has to be re-measured rather than remembered; that is precisely the check that would have
 * caught this drift earlier had it been pointed at the live cohort rather than the snapshot.
 *
 * THREE PLAN CLAIMS THIS FILE CORRECTS BY MEASUREMENT, recorded rather than quietly fixed:
 *
 *   - The colliding slug pair is NOT `a.b/c` / `a-b-c`. `.` and `_` are inside the preserved
 *     class `[^a-z0-9._-]`, so only `/` is rewritten: `a.b/c` → `a.b-c` while `a-b-c` stays
 *     `a-b-c`. The real buckets are `{a.b/c, a.b-c, A.B/C}` and `{x/y, x-y}`. The conclusion
 *     the wrong witness was offered for still holds — the slug is lossy, so it is never a key.
 *   - The corpus yields TWO artifact rows, not nineteen. Artifacts follow packages, and the
 *     snapshot declares 3 packages against 22 remotes over 25 entries.
 *   - A conflict's participants are mirror ROWS, not native ids. For the official registry
 *     `sourceRecordId` IS the server name, so two records claiming one name share it; keying
 *     on it alone collapsed a real collision to one participant and made the fail-closed path
 *     THROW instead of recording its refusal.
 *
 * Negative controls this file is the measurement for:
 *   #1  group by `canonicalSlug`          — two distinct products merge
 *   #2  group by `repositoryUrl`          — 9 repo-less entries fuse into one subject
 *   #3  group by publisher head           — the `ai.agenticshelf` trio merges
 *   #4  group by remote host              — the same trio, a second path
 *   #5  keep-the-first on collision       — no conflict row is written
 *   #6  write artifacts for a CONFLICT subject
 *   #7  a conflict naming ONE record
 *   #8  `RESOLVED` releasing a subject with `resolution: null`
 *   #9  `ACKNOWLEDGED` treated as releasing
 *   #10 random ids instead of `hashJson`
 *   #11 `RESOLVED` for a single-source subject
 *   #12 a fabricated `immutableDigest`
 *   #18 raw SQL in the resolver
 *   #21 asserting the conflict path on real data only (this docblock + the last describe)
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
// Reaching into `packages/trust-index/src/` from a TEST, which the two shipped suites
// `snapshot-projection.test.ts` and `refresh-from-mirror.test.ts` already do, and which the
// ADR 0061 boundary gate permits: that gate walks the two BUNDLED entry points' module graphs
// (`calllint`, `calllint-mcp`), and no test file is reachable from either. The direction that
// would be a violation is the reverse — `packages/trust-index/src/**` naming adoption-index.
import { registryCanonicalName, parseSnapshot } from "../../trust-index/src/snapshot.js"
import {
  resolveIdentity,
  canonicalSlug,
  claimedName,
  publisherHead,
  subjectId,
  artifactVersionId,
  conflictId,
  participantId,
  sourceRecordRowId,
  toSourceRecord,
  releasesSubject,
  isTerminalIdentityStatus,
  assertConflictParticipants,
  TERMINAL_IDENTITY_STATUSES,
  RESOLVABLE_PACKAGE_TYPES,
  REGISTRY_SLUG_NAMESPACE,
  type SourceRecordV1,
  type IdentityConflictV1,
  type ConflictResolution,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC_DIR = join(PKG_ROOT, "src")
const SNAPSHOT_PATH = join(PKG_ROOT, "..", "trust-index", "snapshots", "official-mcp-registry.json")
const SOURCE = "official-mcp-registry"
const T0 = "2026-08-01T00:00:00.000Z"
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"

interface Over {
  repositoryUrl?: string
  packages?: { registryType: string; identifier: string; version?: string }[]
  remotes?: { type: string; url: string }[]
  description?: string
  version?: string
}

/**
 * Build a `SourceRecordV1` through the SHIPPED adapter, never by hand.
 *
 * Hand-authoring the record would let a fixture claim a shape the adapter cannot produce, and
 * the resolver would then be graded against an input that never reaches it in production. The
 * `version` argument is how two records differ in PAYLOAD while claiming one name — which is
 * exactly the collision input, since the adapter keys `sourceRecordId` on the name alone.
 */
function record(name: string, over?: Over): SourceRecordV1 {
  const server: Record<string, unknown> = { name }
  if (over?.description !== undefined) server.description = over.description
  if (over?.version !== undefined) server.version = over.version
  if (over?.repositoryUrl !== undefined) server.repository = { url: over.repositoryUrl, source: "github" }
  if (over?.packages !== undefined) server.packages = over.packages
  if (over?.remotes !== undefined) server.remotes = over.remotes
  const built = toSourceRecord(
    { server, _meta: { [OFFICIAL_META]: { status: "active", isLatest: true } } } as never,
    T0,
  )
  if (built === null) throw new Error(`fixture "${name}" was rejected by the shipped adapter`)
  return built
}

function resolve(records: readonly SourceRecordV1[]) {
  return resolveIdentity({ records, sourceId: SOURCE, observedAt: T0 })
}

function types(conflicts: readonly IdentityConflictV1[]): string[] {
  return conflicts.map((c) => c.conflictType).sort()
}

/** Two records claiming ONE name, differing only in payload. The class-1 collision input. */
function collidingPair(name = "io.test/dup", over?: Over): SourceRecordV1[] {
  return [record(name, { ...over, version: "1.0.0" }), record(name, { ...over, version: "2.0.0" })]
}

describe("purity — the resolver reads no clock, no filesystem, no database", () => {
  it("names no ambient source of truth in its own bytes (INV-R6, §10.3, control #18)", () => {
    const src = readFileSync(join(SRC_DIR, "identity", "resolveIdentity.ts"), "utf8")
    // Asserted over the SOURCE rather than by stubbing globals: a stub proves the paths this
    // test walked did not read a clock, while the bytes prove no path can.
    expect(src).not.toMatch(/new Date\(|Date\.now\(/)
    expect(src).not.toMatch(/readFileSync|writeFileSync|existsSync/)
    expect(src).not.toMatch(/\bfetch\(/)
    // §10.3 — SQL lives only in `store.ts` or a migration. Textual, like the shipped
    // `pack:smoke:mcp` grep, so the prose in that file must avoid these words too.
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\s/)
    // The layer direction: identity must not reach into storage. `store.ts` imports `node:fs`,
    // so an import there would also defeat the filesystem assertion two lines up.
    expect(src).not.toMatch(/from "\.\.\/storage\//)
  })

  it("is a function of its arguments alone — same input, same output, twice", () => {
    const records = [record("io.test/b"), record("io.test/a", { repositoryUrl: "https://github.com/x/a" })]
    expect(resolve(records)).toEqual(resolve(records))
    // Arrival order must not reach the output: every collection is sorted on the way out.
    expect(resolve([...records].reverse())).toEqual(resolve(records))
  })
})

describe("the slug is DERIVED from the shipped transform, and is never the key", () => {
  it("agrees with the shipped `registryCanonicalName` over every committed name", () => {
    const snapshot = parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8"))
    expect(snapshot.entries).toHaveLength(25)
    // The duplication in `canonicalSlug` is deliberate — importing the serving plane into
    // `src/` is the edge the boundary gate forbids. What makes duplication safe is precisely
    // this comparison: it catches BEHAVIOURAL drift, which a structural check (same file, same
    // export) cannot.
    for (const entry of snapshot.entries) {
      expect(canonicalSlug(entry.name)).toBe(registryCanonicalName(entry.name))
    }
  })

  it("agrees on the LOSSY inputs too, which the corpus does not contain", () => {
    // The committed names are all well-formed, so the case above only grades the easy half of
    // the transform. These are the inputs where a re-implementation would drift.
    for (const name of [
      "io.GitHub/Mixed-Case",
      "a.b/c",
      "a.b-c",
      "a-b-c",
      "x__y",
      "--lead--",
      "sp ace/here",
      "sym+bol/x",
      "trailing-",
    ]) {
      expect(canonicalSlug(name)).toBe(registryCanonicalName(name))
    }
  })

  it("flattens `/` onto `-` and folds case — the MEASURED collision buckets", () => {
    // The plan named `a.b/c` / `a-b-c` as the colliding pair. It is not one: `.` survives.
    expect(canonicalSlug("a.b/c")).not.toBe(canonicalSlug("a-b-c"))
    expect(canonicalSlug("a.b/c")).toBe(`${REGISTRY_SLUG_NAMESPACE}/a.b-c`)
    // These are the real collisions — the `/` boundary becoming indistinguishable from a
    // literal `-`, and case folding.
    expect(canonicalSlug("a.b/c")).toBe(canonicalSlug("a.b-c"))
    expect(canonicalSlug("a.b/c")).toBe(canonicalSlug("A.B/C"))
    expect(canonicalSlug("x/y")).toBe(canonicalSlug("x-y"))
  })

  it("keeps the namespace prefix on every slug", () => {
    expect(canonicalSlug("io.test/one").startsWith(`${REGISTRY_SLUG_NAMESPACE}/`)).toBe(true)
  })
})

describe("grouping is by EXACT canonicalName — the three falsified heuristics", () => {
  it("control #2: 9 records with NO repository stay 9 subjects", () => {
    // The measured worst case. `null === null` in a JS Map, so a group-by on repositoryUrl
    // fuses every repo-less product into one identity.
    const records = Array.from({ length: 9 }, (_, i) => record(`io.test/n${i}`))
    const out = resolve(records)

    // WITNESS that the fixture really is the dangerous one: all nine repos are absent.
    expect(records.every((r) => r.claimedIdentity.repositoryUrl === undefined)).toBe(true)

    expect(out.subjects).toHaveLength(9)
    expect(out.conflicts).toEqual([])
    expect(new Set(out.subjects.map((s) => s.subjectId)).size).toBe(9)
    // Absence of evidence is recorded as absence, not as a shared value.
    expect(out.subjects.every((s) => !s.identityBasis.some((b) => b.kind === "repository-url"))).toBe(true)
  })

  it("control #2b: distinct products SHARING one repository stay distinct", () => {
    // A monorepo publishing two servers is normal. Grouping on the repo would merge them.
    const repo = "https://github.com/acme/monorepo"
    const out = resolve([
      record("io.acme/one", { repositoryUrl: repo }),
      record("io.acme/two", { repositoryUrl: repo }),
    ])
    expect(out.subjects).toHaveLength(2)
    expect(out.conflicts).toEqual([])
    // The repository IS recorded as evidence on both — recording and keying are different acts.
    expect(
      out.subjects.every((s) => s.identityBasis.some((b) => b.kind === "repository-url" && b.value === repo)),
    ).toBe(true)
  })

  it("control #3: the `ai.agenticshelf` trio stays THREE subjects", () => {
    // Measured on the real corpus: a coffee roaster, an e-commerce catalog and an
    // air-purifier brand sharing one hosting platform. Merging them is the defect.
    const trio = ["ai.agenticshelf/graffeo", "ai.agenticshelf/mcp", "ai.agenticshelf/puroair"]
    const out = resolve(trio.map((n) => record(n)))

    // WITNESS: one publisher head across all three, so the heuristic really would fire.
    expect(new Set(trio.map(publisherHead)).size).toBe(1)
    expect(publisherHead("ai.agenticshelf/mcp")).toBe("ai.agenticshelf")

    expect(out.subjects).toHaveLength(3)
    expect(out.conflicts).toEqual([])
    expect(out.subjects.map((s) => s.canonicalName)).toEqual(trio)
  })

  it("control #4: the same trio behind ONE remote host stays three subjects", () => {
    const remotes = [{ type: "sse", url: "https://api.agenticshelf.ai/mcp" }]
    const out = resolve([
      record("ai.agenticshelf/graffeo", { remotes }),
      record("ai.agenticshelf/mcp", { remotes }),
      record("ai.agenticshelf/puroair", { remotes }),
    ])
    expect(out.subjects).toHaveLength(3)
    expect(out.conflicts).toEqual([])
  })

  it("control #1: two names that COLLIDE on the slug are not merged into one subject", () => {
    const out = resolve([record("a.b/c"), record("a.b-c")])
    // Two subjects, each keyed on its own canonical name...
    expect(out.subjects).toHaveLength(2)
    expect(out.subjects.map((s) => s.canonicalName)).toEqual(["a.b-c", "a.b/c"])
    // ...and the shared slug is reported as a conflict rather than silently served twice.
    expect(types(out.conflicts)).toEqual(["slug-collision"])
    expect(out.subjects.every((s) => s.identityStatus === "CONFLICT")).toBe(true)
  })

  it("a name with no `/` is its own publisher head, and still groups on the whole name", () => {
    expect(publisherHead("flat-name")).toBe("flat-name")
    expect(resolve([record("flat-name"), record("flat-name-two")]).subjects).toHaveLength(2)
  })
})

describe("participant identity — a conflict names mirror ROWS, not native ids", () => {
  it("agrees with the store's `sourceRecordRowId` over identical input", () => {
    // The same duplicate-rather-than-import trade `canonicalSlug` makes, and the same remedy:
    // importing `store.ts` would pull `node:fs` into a pure function and invert the layer
    // direction, so equivalence is asserted behaviourally instead.
    for (const r of [
      record("io.test/a"),
      record("io.test/b", { version: "2", repositoryUrl: "https://x.test/b" }),
    ]) {
      expect(participantId(r)).toBe(sourceRecordRowId(r))
    }
  })

  it("distinguishes two records that claim one name — the reason the native id is not enough", () => {
    const [first, second] = collidingPair()
    // MEASURED: the official adapter keys `sourceRecordId` on the server name (so a republish
    // is a new observation, not a new subject), so both records carry the SAME native id and
    // differ only by payload digest. Keying participants on the native id collapsed them to
    // one and made `assertConflictParticipants` THROW — the fail-closed path crashing instead
    // of recording the refusal it exists to record.
    expect(first!.source.sourceRecordId).toBe(second!.source.sourceRecordId)
    expect(first!.source.payloadDigest).not.toBe(second!.source.payloadDigest)
    expect(participantId(first!)).not.toBe(participantId(second!))
    // And the whole point: the pair now RESOLVES rather than throwing.
    expect(() => resolve([first!, second!])).not.toThrow()
  })

  it("collapses two BYTE-IDENTICAL observations — that is not a conflict", () => {
    const twice = [record("io.test/same"), record("io.test/same")]
    expect(participantId(twice[0]!)).toBe(participantId(twice[1]!))
    const out = resolve(twice)
    // One observation seen twice. No conflict, and the subject stays clean.
    expect(out.conflicts).toEqual([])
    expect(out.subjects).toHaveLength(1)
    expect(out.subjects[0]!.identityStatus).toBe("PROVISIONAL")
  })
})

describe("class 1 — canonical-name-collision (two records, one claimed name)", () => {
  it("emits a conflict naming BOTH observations and elects NEITHER", () => {
    const out = resolve(collidingPair())
    const collide = out.conflicts.find((c) => c.conflictType === "canonical-name-collision")!
    expect(collide).toBeDefined()
    expect(collide.subjectKey).toBe("io.test/dup")
    expect(collide.sourceRecordIds).toHaveLength(2)
    expect(collide.status).toBe("OPEN")
    expect(collide.resolvedAt).toBeNull()
    expect(collide.resolution).toBeNull()
    expect(collide.createdAt).toBe(T0)
  })

  it("control #5: the collision is REPORTED, never resolved by keeping the first", () => {
    const out = resolve(collidingPair())
    // One subject — the two records claim one identity — but it is CONFLICT, and the row that
    // says so exists. Silent election would produce a PROVISIONAL subject and zero conflicts.
    expect(out.subjects).toHaveLength(1)
    expect(out.subjects[0]!.identityStatus).toBe("CONFLICT")
    expect(out.conflicts.some((c) => c.conflictType === "canonical-name-collision")).toBe(true)
  })

  it("control #6: a CONFLICT subject yields ZERO artifact rows (fail closed)", () => {
    const packages = [{ registryType: "npm", identifier: "@scope/dup", version: "1.0.0" }]
    const out = resolve(collidingPair("io.test/dup", { packages }))
    expect(out.subjects[0]!.identityStatus).toBe("CONFLICT")
    // The four tables carry NO FOREIGN KEY declarations, so nothing in SQLite would refuse
    // these rows. The invariant holds here or it does not hold at all.
    expect(out.artifacts).toEqual([])

    // WITNESS that the same package DOES produce an artifact when the identity is clean —
    // otherwise this would pass on a fixture where no artifact was ever possible.
    expect(resolve([record("io.test/solo", { packages })]).artifacts).toHaveLength(1)
  })

  it("records each way the two observations DISAGREE, alongside the collision", () => {
    const out = resolve([
      record("io.test/dup", {
        version: "1",
        repositoryUrl: "https://github.com/x/one",
        packages: [{ registryType: "npm", identifier: "a" }],
      }),
      record("io.test/dup", {
        version: "2",
        repositoryUrl: "https://github.com/y/two",
        packages: [{ registryType: "npm", identifier: "b" }],
      }),
    ])
    // The collision says "these cannot be merged"; the divergences say why. A human
    // adjudicating the row needs both.
    expect(types(out.conflicts)).toEqual([
      "canonical-name-collision",
      "package-identifier-divergence",
      "repository-url-divergence",
    ])
    // Every row names the same two participants and the same subject key.
    expect(new Set(out.conflicts.map((c) => c.subjectKey))).toEqual(new Set(["io.test/dup"]))
    expect(out.conflicts.every((c) => c.sourceRecordIds.length === 2)).toBe(true)
    // Distinct ids per class, so two rows never collapse in the store's upsert.
    expect(new Set(out.conflicts.map((c) => c.conflictId)).size).toBe(3)
  })

  it("does NOT report repository divergence when one observation simply has no repository", () => {
    const out = resolve([
      record("io.test/dup", { version: "1", repositoryUrl: "https://github.com/x/one" }),
      record("io.test/dup", { version: "2" }),
    ])
    // Absence of evidence is neither agreement nor disagreement. Counting a missing repository
    // as a distinct value would report a divergence between a record that named one and one
    // that named none.
    expect(types(out.conflicts)).toEqual(["canonical-name-collision"])
  })

  it("cannot reach `publisher-divergence` through a registry name, and says so", () => {
    // The head is a PREFIX of the name, so two records sharing a name necessarily share a
    // head. The class is declared for a multi-source future; on this source it is unreachable,
    // which is recorded here rather than left as an untested enum member.
    const out = resolve(collidingPair())
    expect(out.conflicts.some((c) => c.conflictType === "publisher-divergence")).toBe(false)
    expect(publisherHead("io.test/dup")).toBe("io.test")
  })
})

describe("class 2 — slug-collision (distinct names, one served address)", () => {
  it("names every participating observation and marks EVERY owner CONFLICT", () => {
    const out = resolve([record("a.b/c"), record("a.b-c"), record("io.test/fine")])
    const slug = out.conflicts.find((c) => c.conflictType === "slug-collision")!
    expect(slug.subjectKey).toBe(canonicalSlug("a.b/c"))
    expect(slug.sourceRecordIds).toHaveLength(2)

    const byName = new Map(out.subjects.map((s) => [s.canonicalName, s]))
    expect(byName.get("a.b/c")!.identityStatus).toBe("CONFLICT")
    expect(byName.get("a.b-c")!.identityStatus).toBe("CONFLICT")
    // The uninvolved subject is untouched — a collision must not widen into its neighbours.
    expect(byName.get("io.test/fine")!.identityStatus).toBe("PROVISIONAL")
  })

  it("yields no artifacts for either colliding owner, and keeps the clean one's", () => {
    const packages = [{ registryType: "npm", identifier: "x", version: "1" }]
    const out = resolve([
      record("a.b/c", { packages }),
      record("a.b-c", { packages }),
      record("io.test/fine", { packages: [{ registryType: "npm", identifier: "fine", version: "1" }] }),
    ])
    expect(out.artifacts).toHaveLength(1)
    expect(out.artifacts[0]!.packageIdentifier).toBe("fine")
  })

  it("is detected across THREE owners as ONE conflict, not three", () => {
    const out = resolve([record("a.b/c"), record("a.b-c"), record("A.B/C")])
    const slugs = out.conflicts.filter((c) => c.conflictType === "slug-collision")
    expect(slugs).toHaveLength(1)
    expect(slugs[0]!.sourceRecordIds).toHaveLength(3)
    expect(out.subjects.every((s) => s.identityStatus === "CONFLICT")).toBe(true)
  })

  it("fires on the case-folding path too, where the names differ only in case", () => {
    const out = resolve([record("io.test/Server"), record("io.test/server")])
    expect(types(out.conflicts)).toEqual(["slug-collision"])
    expect(out.subjects).toHaveLength(2)
  })
})

describe("control #7 — a conflict naming fewer than 2 observations is not a conflict", () => {
  it("throws, by name, rather than recording a one-participant conflict", () => {
    expect(() => assertConflictParticipants(["only-one"], "io.test/x")).toThrow(
      /names 1 source record\(s\); a conflict naming fewer than 2 is not a conflict/,
    )
    expect(() => assertConflictParticipants([], "io.test/x")).toThrow(/names 0 source record/)
    expect(() => assertConflictParticipants(["a", "b"], "io.test/x")).not.toThrow()
  })

  it("every conflict the resolver emits satisfies it", () => {
    const out = resolve([record("a.b/c"), record("a.b-c"), ...collidingPair()])
    expect(out.conflicts.length).toBeGreaterThan(1)
    for (const c of out.conflicts) expect(c.sourceRecordIds.length).toBeGreaterThanOrEqual(2)
  })
})

describe("controls #8 / #9 — only RESOLVED *with* a resolution releases a subject", () => {
  const base: IdentityConflictV1 = {
    schema: "calllint.identity-conflict.v1",
    conflictId: "x",
    subjectKey: "io.test/x",
    conflictType: "canonical-name-collision",
    sourceRecordIds: ["a", "b"],
    status: "OPEN",
    createdAt: T0,
    resolvedAt: null,
    resolution: null,
  }
  // The real adjudication shape: an outcome, who decided, and why. `SPLIT` is what the
  // `ai.agenticshelf` trio would get if it ever collided — distinct products, kept apart.
  const adjudicated: ConflictResolution = {
    outcome: "SPLIT",
    decidedBy: "human",
    rationale: "distinct products that share a hosting platform",
  }

  it("#8: RESOLVED with `resolution: null` does NOT release", () => {
    // Indistinguishable from a dropped conflict: the status says settled, nothing says how.
    expect(releasesSubject({ ...base, status: "RESOLVED", resolution: null })).toBe(false)
    // Nor does an absent key, which is the same claim spelled differently.
    const { resolution: _omitted, ...noKey } = base
    expect(releasesSubject({ ...noKey, status: "RESOLVED" })).toBe(false)
  })

  it("#9: OPEN and ACKNOWLEDGED both keep the subject at CONFLICT", () => {
    expect(releasesSubject({ ...base, status: "OPEN" })).toBe(false)
    expect(releasesSubject({ ...base, status: "ACKNOWLEDGED" })).toBe(false)
    // Acknowledged means a human has SEEN it, not that they decided.
    expect(releasesSubject({ ...base, status: "ACKNOWLEDGED", resolution: adjudicated })).toBe(false)
  })

  it("releases only on RESOLVED + a resolution", () => {
    expect(releasesSubject({ ...base, status: "RESOLVED", resolution: adjudicated })).toBe(true)
  })

  it("CONFLICT and TOMBSTONED are the terminal identity statuses, and the set is frozen", () => {
    expect([...TERMINAL_IDENTITY_STATUSES].sort()).toEqual(["CONFLICT", "TOMBSTONED"])
    expect(isTerminalIdentityStatus("CONFLICT")).toBe(true)
    expect(isTerminalIdentityStatus("TOMBSTONED")).toBe(true)
    expect(isTerminalIdentityStatus("PROVISIONAL")).toBe(false)
    expect(isTerminalIdentityStatus("RESOLVED")).toBe(false)
    expect(Object.isFrozen(TERMINAL_IDENTITY_STATUSES)).toBe(true)
  })
})

describe("control #10 — every id is derived, never random", () => {
  it("the same inputs produce the same ids, and different inputs do not", () => {
    expect(subjectId(SOURCE, "io.test/a")).toBe(subjectId(SOURCE, "io.test/a"))
    expect(subjectId(SOURCE, "io.test/a")).not.toBe(subjectId(SOURCE, "io.test/b"))
    // The source is part of the key: one name from two sources is two subjects.
    expect(subjectId("other", "io.test/a")).not.toBe(subjectId(SOURCE, "io.test/a"))
  })

  it("a resolver run reproduces the ids of an independent run over the same records", () => {
    const records = [record("io.test/a", { packages: [{ registryType: "npm", identifier: "a", version: "1" }] })]
    const first = resolve(records)
    const second = resolve(records)
    expect(second.subjects.map((s) => s.subjectId)).toEqual(first.subjects.map((s) => s.subjectId))
    expect(second.artifacts.map((a) => a.artifactVersionId)).toEqual(first.artifacts.map((a) => a.artifactVersionId))
    expect(second.conflicts).toEqual(first.conflicts)
  })

  it("the conflict id does not depend on the order the participants were met", () => {
    expect(conflictId("k", "canonical-name-collision", ["b", "a"])).toBe(
      conflictId("k", "canonical-name-collision", ["a", "b"]),
    )
    // ...but it does depend on WHICH participants, and on the class.
    expect(conflictId("k", "canonical-name-collision", ["a", "c"])).not.toBe(
      conflictId("k", "canonical-name-collision", ["a", "b"]),
    )
    expect(conflictId("k", "slug-collision", ["a", "b"])).not.toBe(
      conflictId("k", "canonical-name-collision", ["a", "b"]),
    )
  })

  it("the conflict id is stable across arrival order, end to end", () => {
    const pair = collidingPair()
    const forward = resolve(pair).conflicts.map((c) => c.conflictId)
    const backward = resolve([...pair].reverse()).conflicts.map((c) => c.conflictId)
    expect(backward).toEqual(forward)
  })

  it("the artifact id separates versions of one package", () => {
    const s = subjectId(SOURCE, "io.test/a")
    expect(artifactVersionId(s, "npm", "pkg", "1.0.0")).not.toBe(artifactVersionId(s, "npm", "pkg", "2.0.0"))
    // A null version is its own key, distinct from any string version.
    expect(artifactVersionId(s, "npm", "pkg", null)).not.toBe(artifactVersionId(s, "npm", "pkg", "1.0.0"))
  })
})

describe("control #11 — single-source resolution is PROVISIONAL, never RESOLVED", () => {
  it("marks every clean subject PROVISIONAL (§8.1)", () => {
    const out = resolve([record("io.test/a"), record("io.test/b", { repositoryUrl: "https://github.com/x/b" })])
    expect(out.subjects.map((s) => s.identityStatus)).toEqual(["PROVISIONAL", "PROVISIONAL"])
    // `RESOLVED` claims multi-source corroboration. There is one source in this release, so it
    // is unreachable — asserted rather than assumed.
    expect(out.subjects.some((s) => s.identityStatus === "RESOLVED")).toBe(false)
  })

  it("a rich record is still PROVISIONAL — more evidence from ONE source is not corroboration", () => {
    const out = resolve([
      record("io.test/rich", {
        repositoryUrl: "https://github.com/x/rich",
        packages: [{ registryType: "npm", identifier: "rich", version: "1" }],
        remotes: [{ type: "sse", url: "https://rich.test/mcp" }],
      }),
    ])
    expect(out.subjects[0]!.identityStatus).toBe("PROVISIONAL")
    expect(out.subjects[0]!.identityBasis.length).toBeGreaterThan(1)
  })
})

describe("control #12 — the R-4 boundary: no digest is invented offline", () => {
  const withPackage = () =>
    resolve([record("io.test/a", { packages: [{ registryType: "npm", identifier: "a", version: "1" }] })])

  it("leaves `immutableDigest` null and OMITS `registryIntegrity`", () => {
    const artifact = withPackage().artifacts[0]!
    // Required AND nullable in the schema ⇒ an explicit null is the honest value.
    expect(artifact.immutableDigest).toBeNull()
    // `{type: "string", minLength: 1}`, not nullable, not required ⇒ the key must be ABSENT.
    // `null` would fail the schema, which is why this is `not.toHaveProperty`, not `toBeNull`.
    expect(artifact).not.toHaveProperty("registryIntegrity")
    // R-4's other columns are the store's business; the document carries none of them.
    expect(artifact).not.toHaveProperty("cacheKey")
    expect(artifact).not.toHaveProperty("lastVerifiedAt")
  })

  it("`packageRegistry` is null — the snapshot declares no registry host", () => {
    expect(withPackage().artifacts[0]!.packageRegistry).toBeNull()
  })

  it("`sourceLocator` is a human-readable coordinate, never a command", () => {
    expect(withPackage().artifacts[0]!.sourceLocator).toBe("npm:a@1")
    const noVersion = resolve([record("io.test/b", { packages: [{ registryType: "npm", identifier: "b" }] })])
    expect(noVersion.artifacts[0]!.sourceLocator).toBe("npm:b")
    expect(noVersion.artifacts[0]!.version).toBeNull()
  })

  it("`RESOLVED` means the registry declared a type we understand, never that we fetched it", () => {
    const out = resolve([
      record("io.test/known", { packages: [{ registryType: "npm", identifier: "k", version: "1" }] }),
      record("io.test/weird", { packages: [{ registryType: "brand-new-thing", identifier: "w", version: "1" }] }),
    ])
    const byType = new Map(out.artifacts.map((a) => [a.packageType, a.artifactStatus]))
    expect(byType.get("npm")).toBe("RESOLVED")
    // Unknown types are UNSUPPORTED, which never upgrades to a verdict of SAFE (INV-R3).
    expect(byType.get("brand-new-thing")).toBe("UNSUPPORTED")
    // R-4 owns FETCHED / UNAVAILABLE / REJECTED. R-3 must not write any of them.
    expect(out.artifacts.some((a) => ["FETCHED", "UNAVAILABLE", "REJECTED"].includes(a.artifactStatus))).toBe(false)
  })

  it("every resolvable type resolves, and the set is frozen", () => {
    for (const t of RESOLVABLE_PACKAGE_TYPES) {
      const out = resolve([record(`io.test/${t}`, { packages: [{ registryType: t, identifier: "x", version: "1" }] })])
      expect(out.artifacts[0]!.artifactStatus).toBe("RESOLVED")
    }
    expect(Object.isFrozen(RESOLVABLE_PACKAGE_TYPES)).toBe(true)
  })
})

describe("the shape of what is emitted", () => {
  it("labels a subject with the canonical name for EVERY official-registry record", () => {
    // MEASURED, and a correction to what this suite first assumed. `displayName` reads
    // `claimedIdentity.displayName`, and the official adapter never sets it: a registry
    // description is quarantined in `untrustedPublisherContent` (§7.1, INV-R8) and reaches the
    // served projection as `description`, not as an identity label. So on this source the
    // fallback is the ONLY reachable branch, and the label is always the canonical name.
    const described = record("io.test/a", { description: "Acme Server" })
    expect(described.claimedIdentity.displayName).toBeUndefined()
    expect(described.untrustedPublisherContent?.description).toBe("Acme Server")
    expect(resolve([described]).subjects[0]!.displayName).toBe("io.test/a")
    expect(resolve([record("io.test/b")]).subjects[0]!.displayName).toBe("io.test/b")
  })

  it("uses a claimed display name when a source DOES supply one", () => {
    // Grading the other branch of `?? name`. The record is extended past what the official
    // adapter emits, and labelled as such: this is the shape a future third-party adapter
    // would produce, not a claim that this one can.
    const base = record("io.test/a")
    const withLabel: SourceRecordV1 = {
      ...base,
      claimedIdentity: { ...base.claimedIdentity, displayName: "Acme Server" },
    }
    expect(resolve([withLabel]).subjects[0]!.displayName).toBe("Acme Server")
  })

  it("records the slug as an alias no single record supplied", () => {
    const out = resolve([record("io.test/a")])
    const id = out.subjects[0]!.subjectId
    const slugAlias = out.aliases.find((a) => a.alias === canonicalSlug("io.test/a") && a.subjectId === id)!
    expect(slugAlias).toBeDefined()
    // Derived, so no record can be cited as its origin. A fabricated citation would be worse.
    expect(slugAlias.sourceRecordId).toBeNull()
  })

  /**
   * `subject_aliases` has PRIMARY KEY `(alias, subject_id)`, and `persistIdentity` reports
   * `identity.aliases.length` while its upsert FOLDS a repeat. So a duplicate pair here is not
   * cosmetic: the document would carry a row the store cannot hold, `PersistIdentityResult`
   * would over-report, and a persist→read-back comparison would fail on a difference that is
   * not a difference. Each of the three paths to a duplicate gets its own case, because the
   * first one found (two versions of one package) hid the other two.
   */
  function aliasKeys(out: { aliases: readonly { alias: string; subjectId: string }[] }): string[] {
    return out.aliases.map((a) => `${a.alias} ${a.subjectId}`)
  }

  it("emits alias keys unique per (alias, subjectId) — two versions of ONE package", () => {
    // FOUND BY THIS TEST, in shipped R-3 code. A basis value is `registryType:identifier` with
    // no version in it, so declaring `npm:same@1` and `npm:same@2` produced `npm:same` twice.
    const out = resolve([
      record("io.test/a", {
        repositoryUrl: "https://github.com/x/a",
        packages: [
          { registryType: "npm", identifier: "same", version: "1" },
          { registryType: "npm", identifier: "same", version: "2" },
        ],
      }),
    ])
    expect(new Set(aliasKeys(out)).size).toBe(aliasKeys(out).length)
    // The subject still records ONE `package-identifier` basis, not two — same evidence.
    expect(out.subjects[0]!.identityBasis.filter((b) => b.kind === "package-identifier")).toHaveLength(1)
  })

  it("collapses a basis value TWO records of one name agree on, because the citation cannot tell them apart", () => {
    // MEASURED CORRECTION, and the fourth consequence of one structural fact. I wrote this
    // expecting 2 — "two observations agreeing is corroboration, collapsing it erases the
    // agreement" — and `dedupeBasis` said 1. The test was wrong, not the code: `IdentityBasis`
    // cites the NATIVE id, and for the official registry that IS the server name
    // (`officialRegistry.ts`: a version-qualified id would make every republish a new subject),
    // so both records here cite `io.test/dup` and the two triples are byte-identical. Two
    // indistinguishable entries carry nothing a reader could act on.
    //
    // The agreement is not lost, it is recorded where it is legible: the conflict's
    // `sourceRecordIds` are `participantId`s, which include the payload digest for exactly this
    // reason. Same fact that crashed the class-1 conflict path when it de-duplicated on native
    // ids. A multi-source cohort is where the triple key keeps two entries.
    const out = resolve(collidingPair("io.test/dup", { packages: [{ registryType: "npm", identifier: "same" }] }))
    expect(new Set(aliasKeys(out)).size).toBe(aliasKeys(out).length)
    expect(out.subjects[0]!.identityBasis.filter((b) => b.value === "npm:same")).toHaveLength(1)
    // The two observations remain distinguishable HERE, which is what makes the collapse safe.
    expect(out.conflicts[0]!.sourceRecordIds).toHaveLength(2)
    expect(new Set(out.conflicts[0]!.sourceRecordIds).size).toBe(2)
  })

  it("emits alias keys unique when a record CLAIMS the derived slug verbatim", () => {
    // The third path: a claimed value equal to the derived slug is the same primary key as the
    // derived row. `repositoryUrl` is the reachable witness — a package basis is prefixed
    // `registryType:` and so can never equal a slug, and the adapter accepts any non-empty
    // string as a repository URL. Adversarial, not accidental: a publisher can choose this.
    const slug = canonicalSlug("io.test/a")
    const out = resolve([record("io.test/a", { repositoryUrl: slug })])
    expect(new Set(aliasKeys(out)).size).toBe(aliasKeys(out).length)
    // The surviving row is the one with a real citation, not the derived one.
    const row = out.aliases.find((a) => a.alias === slug)!
    expect(row.sourceRecordId).toBe("io.test/a")
    expect(row.aliasType).toBe("repository-url")
  })

  it("names the identity basis kinds it can support offline", () => {
    const out = resolve([
      record("io.test/a", {
        repositoryUrl: "https://github.com/x/a",
        packages: [{ registryType: "npm", identifier: "a", version: "1" }],
      }),
    ])
    expect([...new Set(out.subjects[0]!.identityBasis.map((b) => b.kind))].sort()).toEqual([
      "package-identifier",
      "registry-canonical-name",
      "repository-url",
    ])
    // Every basis cites the record it came from — evidence without a citation is not evidence.
    expect(out.subjects[0]!.identityBasis.every((b) => b.sourceRecordId.length > 0)).toBe(true)
    // `verified-publisher` is declared but unreachable offline; R-3 must not invent one.
    expect(out.subjects[0]!.identityBasis.some((b) => b.kind === "verified-publisher")).toBe(false)
  })

  it("stamps every document from `observedAt`, never from a clock", () => {
    const out = resolve([record("io.test/a")])
    expect(out.subjects[0]!.firstSeenAt).toBe(T0)
    expect(out.subjects[0]!.lastSeenAt).toBe(T0)
    const other = resolveIdentity({
      records: [record("io.test/a")],
      sourceId: SOURCE,
      observedAt: "2020-01-01T00:00:00.000Z",
    })
    expect(other.subjects[0]!.firstSeenAt).toBe("2020-01-01T00:00:00.000Z")
  })

  it("falls back to the native id when a record claims no canonical name", () => {
    const named = record("io.test/a")
    // The key is OMITTED, not nulled: `canonicalName` is `?: string`, so `null` is a type
    // error, and the adapter itself only assigns optional fields when present.
    const { canonicalName: _dropped, ...rest } = named.claimedIdentity
    const anonymous: SourceRecordV1 = { ...named, claimedIdentity: rest }
    // Matches `snapshotProjection`'s `toEntry`, so the identity layer and the served
    // projection agree on what a nameless record is called.
    expect(claimedName(anonymous)).toBe(anonymous.source.sourceRecordId)
    expect(resolve([anonymous]).subjects[0]!.canonicalName).toBe(anonymous.source.sourceRecordId)
  })

  it("resolves an empty cohort to four empty collections", () => {
    expect(resolve([])).toEqual({ subjects: [], aliases: [], artifacts: [], conflicts: [] })
  })
})

describe("control #21 — the corpus measurement, which cannot grade the conflict path", () => {
  /** The 25 committed entries, rebuilt into records through the shipped adapter. */
  function committedRecords(): SourceRecordV1[] {
    const snapshot = parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8"))
    return snapshot.entries.map((e) => {
      const over: Over = {}
      if (e.repositoryUrl != null) over.repositoryUrl = e.repositoryUrl
      if (e.version != null) over.version = e.version
      if (e.description.length > 0) over.description = e.description
      if (e.packages.length > 0) {
        over.packages = e.packages.map((p) => ({
          registryType: p.registryType,
          identifier: p.identifier,
          ...(p.version == null ? {} : { version: p.version }),
        }))
      }
      if (e.remotes.length > 0) over.remotes = e.remotes.map((r) => ({ type: r.type, url: r.url }))
      return record(e.name, over)
    })
  }

  it("resolves the 25 committed entries to 25 PROVISIONAL subjects and ZERO conflicts", () => {
    const out = resolve(committedRecords())
    expect(out.subjects).toHaveLength(25)
    expect(out.conflicts).toEqual([])
    expect([...new Set(out.subjects.map((s) => s.identityStatus))]).toEqual(["PROVISIONAL"])
  })

  it("emits THREE artifact rows, not twenty-five — artifacts follow packages, not subjects", () => {
    // The measured shape of the corpus: 3 packages against 22 remotes over 25 entries, so 22
    // remote-only entries correctly yield zero artifact rows. The plan's step-6 line said 19;
    // asserting that would be asserting a number nothing in the data supports.
    const out = resolve(committedRecords())
    expect(out.artifacts).toHaveLength(3)
    expect([...new Set(out.artifacts.map((a) => a.artifactStatus))]).toEqual(["RESOLVED"])
  })

  it("states WHY the conflict path needs synthetic input: every class is 0 on real data", () => {
    const records = committedRecords()
    const names = records.map(claimedName)
    // The five measurements the plan rests on, re-measured rather than remembered. If a future
    // snapshot refresh introduces a real collision, THIS is what says so.
    expect(new Set(names).size).toBe(25)
    expect(new Set(names.map(canonicalSlug)).size).toBe(25)
    expect(new Set(records.map((r) => r.claimedIdentity.repositoryUrl).filter((u) => u != null)).size).toBe(11)
    expect(records.filter((r) => r.claimedIdentity.repositoryUrl === undefined)).toHaveLength(14)
    // 21 distinct publisher heads over 25 names — TWO repeats: `agenticshelf` (×2) and
    // `agentlookups` (×4). That is a fact about the corpus, not a conflict.
    expect(new Set(names.map(publisherHead)).size).toBe(21)
    expect(names.filter((n) => publisherHead(n) === "ai.agenticshelf")).toHaveLength(2)
    expect(names.filter((n) => publisherHead(n) === "ai.agentlookups")).toHaveLength(4)
    // Every participant is distinct, so no two committed entries are one observation twice.
    expect(new Set(records.map(participantId)).size).toBe(25)
  })

  it("every committed name passes through the irreversible `/` rewrite", () => {
    // The surviving half of the plan's slug measurement, which the corrected witness does not
    // touch: 25/25 names contain a `/`, so every one of them is lossy under the slug even
    // though no two of them collide today.
    const names = committedRecords().map(claimedName)
    expect(names.filter((n) => n.includes("/"))).toHaveLength(25)
    expect(names.every((n) => !canonicalSlug(n).slice(REGISTRY_SLUG_NAMESPACE.length + 1).includes("/"))).toBe(true)
  })
})
