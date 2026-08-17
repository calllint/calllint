/**
 * ADR 0089 — an artifact derived from the bake needs a step that rebuilds it, or the ingest PR is red
 * by construction.
 *
 * `bake.ts` does `rmSync(join(publicRoot, "install"), { recursive: true, force: true })` and rewrites
 * the tree. Five committed artifacts under `artifacts/phase-2.4/` are pure functions of that tree, and
 * `ci.yml` enforces each with a drift check that fails when the committed bytes differ from a fresh
 * run. So any ingest that moves the cohort invalidates all five — measured on the 2026-08-17 refresh:
 * 205 install pages changed, five artifacts went stale, five red checks on a PR the ingest workflow
 * opened itself.
 *
 * ADR 0087 fixed this for `packages/calllint-mcp/src/data/` by adding `sync:mcp-bundle` to the ingest,
 * and named the general rule — *the remedy for a guard has to be runnable, or the guard is satisfied by
 * luck* — without closing the class. This file closes it.
 *
 * WHY THIS IS NOT A LIST OF FIVE FILENAMES. A hardcoded list is the fault class it guards against: a
 * sixth artifact would be added, this test would keep passing, and the next ingest would arrive red
 * again. So the class is DERIVED — from `ci.yml`'s drift steps, which are the things that can actually
 * turn a PR red. The test cannot go stale relative to CI without failing.
 *
 * THE THREE PROPERTIES, each with a negative control below:
 *
 *   1. Every drift-checked artifact in the phase-2.4 class has a writer script (`--write`). An
 *      unrunnable remedy is ADR 0087's exact defect.
 *   2. Every such writer is invoked by `trust-ingest.yml`. This is the property whose absence cost the
 *      2026-08-17 ingest five red checks.
 *   3. The ingest invokes them in an order that respects the one real data dependency:
 *      `preview-snapshot.ts` reads `human-five-second-test.json`.
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n")

const CI = read(".github/workflows/ci.yml")
const INGEST = read(".github/workflows/trust-ingest.yml")
const PKG = JSON.parse(read("package.json")) as { scripts: Record<string, string> }

/** The source file a pnpm script runs, if it runs one. */
function sourceOf(script: string): string | null {
  return PKG.scripts[script]?.match(/(?:tsx|node)\s+(\S+)/)?.[1] ?? null
}

/**
 * The pnpm scripts `ci.yml` drift-checks AND whose source reads the baked tree.
 *
 * Both halves are load-bearing, and the second one was learned by measurement rather than assumed.
 * My first version of this selected on script name (`^eval:phase-2.4|^audit:`) and swept in
 * `audit:calibration`, `audit:coverage` and `audit:evidence` — three real drift checks that read
 * `project-facts.json` and the source tree, have no `--write` at all, and are unaffected by a bake.
 * Requiring them to be rebuilt after an ingest would have been a false demand, and the ordering
 * assertion failed on them immediately.
 *
 * So membership is decided by the dependency that actually causes the staleness: does the script read
 * `apps/web/public/install` or `apps/web/public/trust`, the trees `bake.ts` wipes and rewrites. Adding a
 * new bake-derived drift check to `ci.yml` extends this set automatically; adding an unrelated audit
 * does not.
 */
function bakeDerivedDriftScripts(): string[] {
  const found = new Set<string>()
  for (const m of CI.matchAll(/^\s*run:\s*pnpm\s+(\S+)\s*$/gm)) {
    const script = m[1]!
    if (/:(gate|validate|record|reseat|write)$/.test(script)) continue
    const src = sourceOf(script)
    if (!src) continue
    let body: string
    try {
      body = read(src)
    } catch {
      continue
    }
    // The cue must tolerate BOTH spellings of the served root, because the scripts use both:
    // `"apps/web/public/install"` as one literal, and `path.join(repoRoot, "apps", "web", "public",
    // "install")` as segments. A pattern written only for the first silently dropped `audit:preview` —
    // whose artifact was one of the five measured stale — and dropping it is invisible: the coverage
    // assertion just stops having that subject.
    if (!/public.{0,6}(install|trust)|servedPageDigests/.test(body)) continue
    // …and it must WRITE a committed artifact. Reading the baked tree is not enough: `check:public-copy`
    // and `gate-s0.ts` both read it and hold zero `writeFileSync` calls (measured), because they are
    // validators. A script with no committed output cannot go stale, so demanding a `--write` for it
    // would be the same false demand the name-based filter made one revision earlier.
    if (artifactsWrittenBy(script).length === 0) continue
    found.add(script)
  }
  return [...found].sort()
}

/** The `--write` counterpart of a drift script, if the repo defines one. */
function writerFor(script: string): string | null {
  const candidate = `${script}:write`
  return PKG.scripts[candidate] ? candidate : null
}

/**
 * Which artifacts under `artifacts/phase-2.4/` a script writes — resolved by matching every `*.json`
 * basename the source mentions against the files actually committed in that directory.
 *
 * WHY NOT PARSE THE PATH EXPRESSIONS. I tried, and got it wrong three times in a row. The scripts spell
 * their outputs at least four ways: `path.join(repoRoot, "artifacts", "phase-2.4", name)`, a literal
 * `artifacts/phase-2.4/x.json`, `path.join(outDir, "x.json")` with `outDir` bound on an earlier line,
 * and a table of `{ gate, file: "gate-A-consistency.json" }` rows the writer later joins. Each miss made
 * the coverage assertion below pass VACUOUSLY for the artifact it failed to see — which is this file's
 * own fault class turned on itself.
 *
 * Matching basenames against the committed directory listing is coarser (a script that merely READS an
 * artifact is credited with writing it — `preview-snapshot.ts` reads `human-five-second-test.json`), and
 * that is acceptable here: this set feeds "does a writer exist and does the ingest run it", where an
 * over-broad attribution costs a redundant `:write` invocation, never a missed one. The direction of the
 * error is the reason it is allowed.
 */
function artifactsWrittenBy(script: string): string[] {
  const src = sourceOf(script)
  if (!src) return []
  let body: string
  try {
    body = read(src)
  } catch {
    return []
  }
  return committedPhase24Artifacts()
    .filter((f) => body.includes(f))
    .map((f) => `artifacts/phase-2.4/${f}`)
    .sort()
}

/** The committed `*.json` basenames under `artifacts/phase-2.4/`. */
function committedPhase24Artifacts(): string[] {
  return readdirSync(path.join(repoRoot, "artifacts", "phase-2.4"))
    .filter((f) => f.endsWith(".json"))
    .sort()
}

describe("the premise: ci.yml really does drift-check a phase-2.4 class (not behaviour, the instrument)", () => {
  it("finds the drift steps, so the assertions below have subjects", () => {
    const scripts = bakeDerivedDriftScripts()
    // Measured 2026-08-17 — exactly the five that went stale on the refresh:
    //   eval:phase-2.4, eval:phase-2.4:gates, audit:presentation, audit:presentation:lock, audit:preview
    //
    // `eval:phase-2.4:dogfood` is deliberately NOT here, and its exclusion was measured rather than
    // assumed: it drives the five canonical FIXTURES through the built binary in a temp sandbox, reads no
    // served page, and was the one phase-2.4 drift check still exit-0 after the bake that staled the
    // other five. Its absence from this set is the filter working, not a miss.
    expect(
      scripts.length,
      "no bake-derived drift steps found in ci.yml — the cue stopped matching and every assertion below is vacuous",
    ).toBeGreaterThanOrEqual(5)
    expect(scripts).toContain("eval:phase-2.4")
    expect(scripts).toContain("audit:preview")
    expect(scripts, "dogfood reads fixtures, not the baked tree — including it would be a false demand").not.toContain(
      "eval:phase-2.4:dogfood",
    )
  })

  it("names the five artifacts measured stale on the 2026-08-17 ingest", () => {
    // Not a tautology of the membership rule (which already requires a resolved artifact), but a pin on
    // WHICH artifacts. If the resolver silently stops seeing one of these five, the set shrinks, the
    // `uncovered` assertion below passes vacuously for it, and the next ingest arrives red again.
    const resolved = new Set(bakeDerivedDriftScripts().flatMap(artifactsWrittenBy))
    for (const f of [
      "artifacts/phase-2.4/human-five-second-test.json",
      "artifacts/phase-2.4/gate-A-consistency.json",
      "artifacts/phase-2.4/presentation-plane-audit.json",
      "artifacts/phase-2.4/presentation-lock.json",
      "artifacts/phase-2.4/preview-snapshot.json",
    ]) {
      expect([...resolved], `${f} is no longer reachable from any ci.yml drift step`).toContain(f)
    }
  })
})

describe("every drift-checked artifact has a RUNNABLE remedy (ADR 0087's rule, as a test)", () => {
  it("defines a :write script for each drift check", () => {
    const missing = bakeDerivedDriftScripts().filter((s) => writerFor(s) === null)
    expect(
      missing,
      `ci.yml drift-checks these with no \`:write\` counterpart, so the failure message cannot be acted on: ${missing.join(", ")}`,
    ).toEqual([])
  })
})

describe("the ingest workflow rebuilds every artifact its own bake invalidates (ADR 0089)", () => {
  it("bake.ts still wipes the tree these artifacts derive from — the premise of this whole file", () => {
    const bake = read("packages/trust-index/src/bake.ts")
    expect(
      /rmSync\(\s*join\(publicRoot,\s*"install"\)/.test(bake),
      "bake.ts no longer wipes public/install — re-measure whether this class still exists before trusting these tests",
    ).toBe(true)
  })

  it("invokes the writer for each drift-checked artifact", () => {
    // THE LOAD-BEARING ASSERTION. Its absence is what made the 2026-08-17 ingest PR arrive with five
    // red checks. Delete the step from trust-ingest.yml and this reds naming the uncovered script.
    const uncovered = bakeDerivedDriftScripts().filter((s) => {
      const w = writerFor(s)
      return w === null || !INGEST.includes(w)
    })
    expect(
      uncovered,
      `trust-ingest.yml bakes a new tree but never rebuilds the artifacts these produce, so the PR it opens is red by construction: ${uncovered.join(", ")}`,
    ).toEqual([])
  })

  it("still syncs the MCP bundle, the instance ADR 0087 fixed", () => {
    // Guarding the earlier fix from silent removal: same class, same failure mode.
    expect(INGEST).toContain("pnpm sync:mcp-bundle")
  })

  it("orders the eval before the preview snapshot, which READS its artifact", () => {
    // The one real dependency in the class. `preview-snapshot.ts` reads human-five-second-test.json, so
    // running it first bakes a stale threshold into a file CI then drift-checks.
    const preview = read("scripts/preview-snapshot.ts")
    expect(
      preview.includes("human-five-second-test.json"),
      "preview-snapshot no longer reads the eval artifact — this ordering constraint may be obsolete",
    ).toBe(true)
    const evalAt = INGEST.indexOf("eval:phase-2.4:write")
    const previewAt = INGEST.indexOf("audit:preview:write")
    expect(evalAt, "eval:phase-2.4:write absent from the ingest").toBeGreaterThan(-1)
    expect(previewAt, "audit:preview:write absent from the ingest").toBeGreaterThan(-1)
    expect(evalAt, "the preview snapshot runs before the eval whose artifact it reads").toBeLessThan(previewAt)
  })

  it("rebuilds AFTER the bake, not before", () => {
    const bakeAt = INGEST.indexOf("pnpm bake:trust-index")
    expect(bakeAt, "bake step absent").toBeGreaterThan(-1)
    for (const s of bakeDerivedDriftScripts()) {
      const w = writerFor(s)
      if (w === null) continue
      expect(INGEST.indexOf(w), `${w} runs before the bake, so it would derive from the OLD tree`).toBeGreaterThan(bakeAt)
    }
  })
})
