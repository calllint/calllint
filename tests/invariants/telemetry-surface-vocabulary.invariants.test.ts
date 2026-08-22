/**
 * new19 §21 — the telemetry `discoverySurface` vocabulary is a PROJECTION of the
 * published discovery index, and this file is the assertion that keeps it one.
 *
 * WHY THIS LIVES HERE AND NOT IN packages/telemetry-contract/test/.
 * The natural home would be the contract's own suite, next to the enum it checks. It
 * cannot go there: §23 (NC-01/02/03/07/08) forbids any file under `packages/` from so
 * much as NAMING a distribution artifact, because the security engine lives there and a
 * distribution fact must not be able to reach the verdict path. Reading
 * `agent-discovery-index.json` from inside a package is exactly that coupling — and the
 * §23 guard caught this test doing it. The guard is right; the test moved. `tests/`
 * is outside its scan root and is already this repo's home for cross-boundary
 * invariants, so the assertion survives at full strength without drilling a hole in a
 * security boundary to keep it convenient.
 *
 * WHAT WOULD BREAK WITHOUT IT. The ingress rejects any `discoverySurface` outside the
 * contract enum (that rejection is itself load-bearing — a silently dropped dimension
 * still increments a counter, just under a narrower key, so it reads as "that surface
 * sent no traffic"). Add a seventh surface type upstream and the enum stays at six:
 * every event from the new surface is rejected at the boundary while the aggregate
 * calmly shows zero for it. A measurement whose denominator excludes the thing being
 * missed — the dominant fault class in this repo. Pinning the two lists together makes
 * that drift red here instead of going quiet.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { DISCOVERY_SURFACES } from "../../packages/telemetry-contract/src/index.js"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const INDEX_REL = "apps/web/public/agent-discovery-index.json"

const index = JSON.parse(readFileSync(path.join(repoRoot, INDEX_REL), "utf8")) as {
  surfaceTypes?: unknown
  counts?: { byType?: Record<string, number> }
}

describe("§21 — discoverySurface vocabulary tracks the published surface types", () => {
  /* ANTI-VACUITY PREMISE, ASSERTED FIRST. If the index were missing, unparseable, or
   * carried an empty `surfaceTypes`, a set-equality assertion against it would compare
   * two empty sets and pass while proving nothing. Both sides must be non-empty before
   * the equality below means anything. */
  it("reads a non-empty surfaceTypes list from the published index", () => {
    expect(Array.isArray(index.surfaceTypes), `${INDEX_REL} must publish surfaceTypes`).toBe(true)
    expect((index.surfaceTypes as string[]).length).toBeGreaterThan(0)
    expect(DISCOVERY_SURFACES.length).toBeGreaterThan(0)
  })

  it("the contract enum equals the published surfaceTypes exactly", () => {
    const published = new Set(index.surfaceTypes as string[])
    const contract = new Set<string>(DISCOVERY_SURFACES)
    const missingFromContract = [...published].filter((t) => !contract.has(t))
    const extraInContract = [...contract].filter((t) => !published.has(t))
    expect(
      { missingFromContract, extraInContract },
      "discoverySurface drifted from the published surface types: a type published but " +
        "absent from the contract is REJECTED at the usage ingress and reads as zero " +
        "traffic; a type in the contract but not published can never legitimately occur.",
    ).toEqual({ missingFromContract: [], extraInContract: [] })
  })

  it("every published surface type is a safe dimension token", () => {
    /* The vocabulary has to survive the ingress's own validator. `/` and `@` are excluded
     * there on purpose so a filesystem path or a scoped package name can never be stored
     * as a dimension — which is the measured reason this enum carries surface TYPES and
     * not surface IDS (an id like `io.github.calllint/calllint` would fail right here). */
    const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._+-]{1,64}$/
    for (const t of index.surfaceTypes as string[]) {
      expect(SAFE_TOKEN_PATTERN.test(t), `surface type "${t}" is not a safe dimension token`).toBe(
        true,
      )
    }
  })

  it("the index's byType breakdown covers exactly the same vocabulary", () => {
    /* A second, independent projection inside the same artifact. If `surfaceTypes` and
     * `counts.byType` disagreed, one of them is stale and the "which surfaces exist"
     * question would have two answers — so neither could be trusted as the denominator. */
    const byType = index.counts?.byType
    expect(byType, `${INDEX_REL} must publish counts.byType`).toBeTruthy()
    expect(new Set(Object.keys(byType as Record<string, number>))).toEqual(
      new Set(index.surfaceTypes as string[]),
    )
  })
})
