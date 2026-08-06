/**
 * The committed-tree reproducibility gate (ADR 0046 §4).
 *
 * The baked pages under `apps/web/public/trust/` are committed artifacts — and,
 * because that directory is what `deploy-web.yml` ships, they are also the *served*
 * pages (ADR 0046 §2 the committed tree is the store; §4 same-origin serving). This
 * test re-runs the PURE emit and asserts every committed file is byte-identical to a
 * fresh bake. If someone changes the engine, a fixture, or the renderer without
 * re-running `pnpm --filter @calllint/trust-index bake`, this fails — the same
 * guarantee a CI `git diff --exit-code` would give, expressed as a unit test so it
 * runs in the normal suite on all three OSes.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
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
  EMPTY_CLAIM_STORE,
  type RegistrySnapshot,
  type EvidenceSnapshot,
  type AdoptionIndexSnapshot,
} from "../src/index.js"

const here = dirname(fileURLToPath(import.meta.url))
// Served + committed output root: repo-root/apps/web/public/trust.
const BAKED = resolve(here, "..", "..", "..", "apps", "web", "public", "trust")
// Committed Official MCP Registry snapshot (ingestion input, ADR 0038 §1). If it is
// present we bake it too, exactly as the bin does — so this gate covers the registry
// cohort's byte-reproducibility from the same committed snapshot CI re-bakes from.
const SNAPSHOT = resolve(here, "..", "snapshots", "official-mcp-registry.json")
// Committed maintainer-claim store (ingestion input, ADR 0048 §2). Read exactly as
// the bin does so the gate covers any committed claim flag's byte-reproducibility.
const CLAIMS = resolve(here, "..", "claims", "claim-store.json")
// Committed evidence snapshot (ingestion input, ADR 0050). Read exactly as the bin
// does so the gate covers evidence-refined verdicts' byte-reproducibility too.
const EVIDENCE = resolve(here, "..", "snapshots", "evidence-snapshot.json")
// Committed adoption index (ingestion input, ADR 0061 §7.1, R-8). The FOURTH input, and the only one
// this gate does more than read: the other three are frozen observations (a network fetch, a
// human-committed claim, a resolution result), while this one is a PURE FUNCTION of the registry
// snapshot already sitting beside it. So the gate re-derives it and byte-compares (control #117); a
// gate that only validated its schema would pass a hand-edited `identityDigest` in silence, which is
// the no-op assertion shape the negative-control checklist warns about.
const ADOPTION = resolve(here, "..", "snapshots", "adoption-index.json")
// The committed index document, read here for ONE reason: to recover the clock the committed bake
// used (`bakedAt`, S-2). It is an OUTPUT of the bake, not an ingestion input like the four above —
// which is exactly why it can carry the instant this gate must replay. See position 8 below.
const INDEX_JSON = resolve(BAKED, "index.json")

describe("committed served tree matches a fresh emit (reproducibility gate)", () => {
  const snapshot: RegistrySnapshot | null = existsSync(SNAPSHOT)
    ? parseSnapshot(readFileSync(SNAPSHOT, "utf8"))
    : null
  const claims = existsSync(CLAIMS) ? parseClaimStore(readFileSync(CLAIMS, "utf8")) : EMPTY_CLAIM_STORE
  const evidence: EvidenceSnapshot | null = existsSync(EVIDENCE)
    ? parseEvidenceSnapshot(readFileSync(EVIDENCE, "utf8"))
    : null
  const adoption: AdoptionIndexSnapshot | null = existsSync(ADOPTION)
    ? parseAdoptionIndex(readFileSync(ADOPTION, "utf8"))
    : null
  // All four, exactly as `bake.ts`'s `main()` passes them. Positions 5 and 6 (`engineVersion`,
  // `presentation`) stay defaulted because they flow only into `installFiles`, which the Safe-install
  // gate covers separately; position 7 MUST be threaded here or this gate is blind to the identity
  // wiring — measured: with it omitted, a mutation that pushed identity into every page's bytes left
  // all 120 assertions green.
  //
  // POSITION 8 (`now`, the freshness clock) IS READ BACK OUT OF THE COMMITTED DOCUMENT, not taken
  // from this process's clock. That is the only way this gate can survive a time-dependent field:
  // `freshness` is f(observedAt, now), so re-running with `Date.now()` would compute a different age
  // than the commit did and every entry would mismatch. The bake records the clock it used as
  // `bakedAt`, so the gate replays that exact instant — the same trick that lets it replay the
  // registry cohort from the snapshot's own `fetchedAt`. A committed tree with no `bakedAt` (pre-S-2)
  // yields `null`, which reproduces the freshness-free bytes it was baked with.
  const committedBakedAt: string | null = (() => {
    if (!existsSync(INDEX_JSON)) return null
    const parsed: unknown = JSON.parse(readFileSync(INDEX_JSON, "utf8"))
    const value = (parsed as { bakedAt?: unknown }).bakedAt
    return typeof value === "string" && value.length > 0 ? value : null
  })()
  const { files } = emitAllCohorts(
    snapshot,
    claims,
    evidence,
    [],
    undefined,
    undefined,
    adoption,
    committedBakedAt,
  )

  it("has a non-trivial number of committed files", () => {
    expect(files.length).toBeGreaterThanOrEqual(20)
  })

  describe("the committed adoption index is re-derivable from the committed snapshot", () => {
    it("exists once the projection bin has run (absent ⇒ inert, so this is a soft gate)", () => {
      // Stated rather than asserted-true: an absent document is a legitimate state (the bake falls
      // back to identity-free pages). What must never happen is a document that is PRESENT and wrong,
      // which the next test covers.
      expect(typeof existsSync(ADOPTION)).toBe("boolean")
    })

    it("is REQUIRED, not optional, once the committed index.json carries identity (control #114)", () => {
      // THE SOFT GATE ABOVE HAS A VACUITY HOLE AND THIS IS ITS FLOOR. Every assertion in this block
      // opens with `if (adoption === null) return`, which is correct while the document is genuinely
      // optional — and becomes silence the moment it is not. Measured by deleting the committed
      // artifact: the re-derive test (control #117) returned early and passed, and the only thing that
      // went red was `committed index.json is byte-identical to a fresh bake` — i.e. the protection was
      // real but INDIRECT, inherited from the served tree happening to carry identity today.
      //
      // So the condition is stated directly: if the SERVED bytes carry an `identity` block, the input
      // that produced it is a required input, and its absence is a failure here rather than a silent
      // skip three tests down. This is also the honest answer to control #114 — the artifact is not
      // guarded by counting its writers (there is exactly one, `projectAdoptionIndex.ts`, and a second
      // one would be caught by the re-derive comparison rather than by an enumeration). It is guarded
      // by being re-derivable, and a re-derive gate that skips itself when its input vanishes is not
      // a gate. Unlike R-4's stickiness column, a wrong second writer cannot hide here; a MISSING
      // first writer could, until this line.
      // READ FROM DISK, NOT FROM `files`. The first draft of this assertion asked whether the FRESH
      // emit carries identity, which is circular: with the artifact deleted the fresh emit has no
      // identity either, so the condition went false and the guard skipped itself — the very silence it
      // was written to close. `files` is a function of the missing input; the committed bytes are not.
      const servedPath = join(BAKED, "index.json")
      expect(existsSync(servedPath), `${servedPath} must be committed`).toBe(true)
      const servedCarriesIdentity = readFileSync(servedPath, "utf8").includes('"identity"')
      if (!servedCarriesIdentity) return
      expect(
        existsSync(ADOPTION),
        "the committed index.json carries identity, so adoption-index.json is a REQUIRED input — run `pnpm project-adoption-index:trust-index`",
      ).toBe(true)
      // And the parse must have succeeded, or every `if (adoption === null) return` below is silence
      // wearing a green tick.
      expect(adoption, "adoption-index.json exists but did not parse into a document").not.toBe(null)
    })

    it("re-derives byte-identically from the committed registry snapshot (control #117)", () => {
      if (adoption === null || snapshot === null) return
      const subjects = deriveSubjectsFromSnapshot({
        entries: snapshot.entries,
        observedAt: snapshot.fetchedAt,
      })
      // `projectedAt` comes from the committed document, not the clock: the derivation reproduces the
      // identity ROWS, while the stamp is the producer's record of when it observed them. Taking it
      // from `adoption` is what keeps this a comparison of identity rather than of timing — and the
      // stamp itself is separately pinned to `fetchedAt` below, so it cannot be an arbitrary value.
      const rederived = serializeAdoptionIndex(
        projectAdoptionIndex({ subjects, projectedAt: adoption.projectedAt }),
      )
      expect(
        rederived,
        "the committed adoption-index.json is not what the committed snapshot derives — re-run `pnpm project-adoption-index:trust-index`",
      ).toBe(readFileSync(ADOPTION, "utf8"))
      // Vacuity guard: an empty derivation would satisfy the comparison against an empty document.
      expect(subjects.length).toBeGreaterThan(0)
    })

    it("is stamped with the snapshot's own fetchedAt, so the bytes do not move per run", () => {
      if (adoption === null || snapshot === null) return
      // The derived path stamps `snapshot.fetchedAt` (`projectAdoptionIndex.ts`'s `Inputs.projectedAt`).
      // A wall-clock stamp would move these bytes on every run and make the diff above uncomparable.
      expect(adoption.projectedAt).toBe(snapshot.fetchedAt)
    })
  })

  for (const f of files) {
    it(`committed ${f.path} is byte-identical to a fresh bake`, () => {
      const abs = join(BAKED, f.path)
      expect(
        existsSync(abs),
        `missing committed artifact ${f.path} — run \`pnpm --filter @calllint/trust-index bake\``,
      ).toBe(true)
      const onDisk = readFileSync(abs, "utf8")
      expect(
        onDisk,
        `${f.path} is stale — re-run the bake and commit the result`,
      ).toBe(f.content)
    })
  }
})
