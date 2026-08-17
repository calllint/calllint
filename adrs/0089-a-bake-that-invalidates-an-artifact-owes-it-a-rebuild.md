# ADR 0089 — a bake that invalidates an artifact owes it a rebuild

- **Status:** Accepted
- **Date:** 2026-08-17
- **Closes:** the general class ADR 0087 named and fixed only one instance of.
- **Relates to:** ADR 0087 (*the remedy for a guard has to be runnable*), ADR 0074 (the
  alphabetical cap), ADR 0061 §5 (history is not rewritten).

## Context

`trust-ingest.yml` bakes a new served tree and opens a PR. `bake.ts` does

```ts
rmSync(join(publicRoot, "install"), { recursive: true, force: true })
```

and rewrites it. **Five committed artifacts under `artifacts/phase-2.4/` are pure functions of
that tree**, and `ci.yml` drift-checks each one — the check fails when the committed bytes differ
from a fresh run. So any ingest that moves the cohort invalidates all five, and the workflow had
no step that rebuilt them.

The PR the ingest opens is therefore **red by construction**. Not intermittently, not under load:
every time the cohort moves.

ADR 0087 met this exact shape for the two files under `packages/calllint-mcp/src/data/`, added
`sync:mcp-bundle` to the ingest, and stated the rule — *the remedy for a guard has to be runnable,
or the guard is satisfied by luck*. It fixed the instance and named the class without closing it.
This ADR closes the class.

## What was measured

### 1. The blast radius is five artifacts, not one

CI reported one failure, which is the number I would have fixed had I trusted the report instead
of running the rest. Each drift check was run directly against the freshly baked tree
(2026-08-17):

| artifact | writer | reads | after the bake |
|---|---|---|---|
| `human-five-second-test.json` | `pnpm eval:phase-2.4` | `public/install/*/index.html` | **stale** |
| `gate-A-consistency.json` | `pnpm eval:phase-2.4:gates` | `public/install` + `public/trust` | **stale** |
| `presentation-plane-audit.json` | `pnpm audit:presentation` | `public/install` + `public/trust` | **stale** |
| `presentation-lock.json` | `pnpm audit:presentation:lock` | `public/install` | **stale** |
| `preview-snapshot.json` | `pnpm audit:preview` | `public/install` | **stale** |
| `eval:phase-2.4:dogfood` | — | five canonical *fixtures*, temp sandbox | **exit 0** |

**Five red checks on a PR this workflow opened itself.** The dogfood row is the control: it is a
phase-2.4 drift check that a bake does *not* invalidate, so "phase-2.4" is not the class — "reads
the baked tree" is.

### 2. The staleness is input-driven, not pre-existing

Worth establishing before writing a workflow step, because the alternative diagnosis (the
artifacts were already wrong on `main`) demands a different fix:

- all five artifacts were **byte-identical to `main`** before regeneration;
- `main`'s `ci.yml` is green;
- the ingest commit touched **205** install pages and **313** trust files, and **zero** files
  under `artifacts/phase-2.4/`.

So the bake moved the inputs and nothing rebuilt the outputs.

### 3. The 100 → 99 count in the regenerated artifacts is correct

The regenerated artifacts recorded one fewer install page than ADR 0086 measured subjects
(100 → 100 there). A count that moves for an unexplained reason is not a number I will commit, so
it was traced rather than accepted.

Not a slug collision (100 distinct slugs for 100 entries) and not a bad evidence snapshot. The
bake had already recorded its own reason in `apps/web/public/trust/index.json`, which carries
`incomplete: 2`:

```
calllint-fixtures/malformed                    config did not parse — recorded as incomplete, no page baked
mcp-registry/ai.ankimcp-anki-mcp-server-addon  entry declares neither a remote nor a package — nothing to scan
```

Verified at the registry snapshot: `ai.ankimcp/anki-mcp-server-addon` has `remotes: []` and
`packages: []` — a registered name with no installable artifact. `emitCohort.ts` drops it through
`markIncomplete` and bakes no page. Correct behaviour, correctly recorded, and the drop is
**visible in the served index rather than silent**. The five regenerated artifacts are faithful.

## Decision

**D1 — the ingest rebuilds every artifact its own bake invalidates.** One step, after the bake,
in `ci.yml`'s order:

```
pnpm eval:phase-2.4:write && pnpm eval:phase-2.4:gates:write && pnpm audit:presentation:write \
  && pnpm audit:presentation:lock:write && pnpm audit:preview:write
```

Order is load-bearing here in a way it was not for the MCP bundle: `preview-snapshot.ts` **reads**
`human-five-second-test.json`, so running the preview first would bake a stale threshold into a
file CI then drift-checks. `eval:phase-2.4:dogfood` is deliberately absent — see §1's control row;
demanding its rebuild would be a false demand.

**D2 — the guarded class is DERIVED from `ci.yml`, never hardcoded.** A list of five filenames is
the fault class it guards against: a sixth artifact gets added, the test keeps passing, the next
ingest arrives red. `tests/invariants/derived-artifact-freshness.invariants.test.ts` enumerates
the class from `ci.yml`'s own drift steps, so the test cannot go stale relative to CI without
failing.

**D3 — membership is decided by the dependency that causes the staleness, and both halves were
learned by measurement.** A script is in the class when it (a) reads `public/install` or
`public/trust` **and** (b) writes a committed artifact. Selecting on script name instead swept in
`audit:calibration`, `audit:coverage`, `audit:evidence` — real drift checks that read
`project-facts.json`, have no `--write`, and are unaffected by a bake. Requiring their rebuild
would have been a false demand. And reading the tree is not sufficient: `check:public-copy` and
`gate-s0.ts` read it and hold **zero** `writeFileSync` sites, because they are validators; a
script with no committed output cannot go stale.

**D4 — the resolver matches committed basenames instead of parsing output paths.** The scripts
spell their outputs at least four ways: `path.join(repoRoot, "artifacts", "phase-2.4", name)`, a
bare literal, `path.join(outDir, "x.json")` with `outDir` bound earlier, and a table of
`{ gate, file: "gate-A-consistency.json" }` rows joined later. Three successive regex attempts
each missed at least one, and **every miss made the coverage assertion pass vacuously for the
artifact it failed to see.** Intersecting each source body with `readdirSync("artifacts/phase-2.4")`
is coarser — a script that merely *reads* an artifact is credited with writing it — and the
direction of that error is why it is allowed: over-attribution costs a redundant `:write`
invocation, never a missed rebuild.

**D5 — the premise is asserted, not assumed.** Three tests measure the instrument rather than the
product: that `ci.yml` still yields ≥5 bake-derived drift scripts, that the five artifacts are
each still reachable from one, and that `bake.ts` still wipes `public/install`. Without them, a
cue that stops matching reads as a pass.

## §5 — five defects in this guard, caught before it shipped

Recorded rather than quietly fixed, because each one is this repo's dominant fault class — *a
guard that cannot observe its subject* — occurring **inside the guard written to close it**:

| # | defect | how it was caught |
|---|---|---|
| 1 | name-prefix membership swept in three unrelated audits | ordering assertion failed on them immediately |
| 2 | validators counted as producers (`check:public-copy`, `gate:s0:*`) | measured `writeFileSync` sites: zero |
| 3 | path-expression regex missed 2 of 5 artifacts | pinned the five filenames; the pin failed |
| 4 | cue `public.{0,3}install` cannot match `"public", "install"` — silently dropped `audit:preview` | mutation control M5 |
| 5 | asserted ≥6 scripts; measured 5 (`dogfood` reads fixtures) | the assertion failed |

Defects 3 and 4 are the instructive pair: both were *silent*. The coverage assertion simply
stopped having a subject and stayed green. That is why D5's premise block exists and why M5 below
is in the control table.

## Consequences

- An ingest PR is no longer red by construction. The five artifacts are rebuilt in the same commit
  as the bake that invalidates them, so a reviewer sees one coherent diff.
- **A sixth bake-derived drift check cannot be added silently.** It either appears in the ingest
  step or fails D2's test — which is exactly what ADR 0087 left open.
- The ingest writes committed bytes in two places now (`sync:mcp-bundle`, this step). Both are pure
  derivations of the same bake, so regenerating them is finishing the bake, not editing a source.
  `--check` remains what CI runs on the resulting PR.
- The cue in D3 is prose-shaped and will need extending if a script spells the served root a fifth
  way. The failure mode is a red premise block (D5), not a vacuous pass — which is the whole reason
  that block exists.
- ADR 0087's rule now has a mechanism behind it rather than a precedent: *the remedy for a guard has
  to be runnable*, and a test derives the set of guards that need one.

## Controls run

The assertions that matter are the ones that must red. Each mutant restores a real defect:

| control | result |
|---|---|
| **M1:** remove the whole refresh step (the 2026-08-17 defect) | **killed** — 3 red, incl. the coverage assertion |
| **M2:** drop only `audit:preview:write` from the step | **killed** — 3 red, naming the uncovered script |
| **M3:** move the refresh step **before** the bake | **killed** — 1 red, "would derive from the OLD tree" |
| **M4:** remove `pnpm sync:mcp-bundle` (ADR 0087 regression) | **killed** — 1 red |
| **M5:** narrow the served-root cue to `public.{0,3}install` (defect #4) | **killed** — 2 red, **in the premise block** |
| all restored | 8 passed |

M5 is the load-bearing one. It targets the instrument, not the product: before D5's premise block
existed, that same narrowing left the suite **green** while the guard silently stopped observing
`audit:preview` — one of the five artifacts measured stale. A control that reds only on product
defects cannot distinguish a working guard from a blind one.
