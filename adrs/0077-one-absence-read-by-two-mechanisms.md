# ADR 0077: One absence, two readers — the weaker one blocks the record

**Status:** Accepted  
**Date:** 2026-08-13  
**Workstream:** S0-OPEN-4 follow-up (Gate 2.4-B)  
**Batch:** —

## Context

`1115639` (#234) replaced the 19-entry registry snapshot with the 25-entry one. Every served
install page's bytes changed, and three subjects left the cohort entirely — the 19→25 refresh
is a re-selection, not growth, so alphabetically-later names were displaced.

`artifacts/phase-2.4/five-second-panel-store.json` records, per response, the `sha256` of the
page the participant was **actually shown**. Ten sessions were run 2026-07-30. After #234 all
ten are stale, and three of them name a subject with no served page at all:

| participant | subject | state |
|---|---|---|
| `7` | `mcp-registry/ac.tandem-docs-mcp` | page removed by the 19→25 re-selection |
| `8` | `mcp-registry/ac.inference.sh-mcp` | page removed by the 19→25 re-selection |
| `10` | `mcp-registry/io.github.calllint-calllint` | page removed — **S0-OPEN-4's subject** |

That single condition — *the page this response measured is gone* — reaches Gate 2.4-B through
**two independent readers**.

### Reader 1 — `partitionPanelFreshness` (`packages/trust-index/src/phase24Eval.ts:396`)

```ts
const currentDigest = servedDigests.get(r.canonicalSlug) ?? null
if (currentDigest !== null && currentDigest === r.shownDigest) fresh.push(r)
else stale.push({ ...r, currentDigest })
```

A slug absent from the map is a removed page, `currentDigest` is `null`, the response is
`stale` and excluded. The gate falls to `PENDING_HUMAN_PANEL`. Its docblock states the
semantics deliberately: *"Once the page moves, an old response is not a weaker measurement of
the new page — it is not a measurement of it at all."* **Fail-closed, and correct.**

### Reader 2 — `validate()` (`scripts/phase-2.4-panel.ts:217`)

```ts
if (typeof r.canonicalSlug !== "string" || !fs.existsSync(path.join(served, r.canonicalSlug, "index.html"))) {
  errs.push(`${at}: canonicalSlug ${String(r.canonicalSlug)} is not a served install page`)
}
```

An **integrity error** → `process.exit(1)` → all three CI matrix legs red on
`Phase 2.4 human-panel store validation`.

## Measurement

Each measured, not inferred.

| claim | measurement | result |
|---|---|---|
| the 3 subjects left the cohort | slugify the 25 committed snapshot names, membership test | all three absent |
| both branches serve the same pages | `git ls-tree -r origin/main` vs `HEAD` under `apps/web/public/install` | **25 each**, same 25 |
| the 3 are absent from `main` too | `git ls-tree` per subject on `origin/main` | **0 files** each |
| PR #293 caused it | `git diff origin/main...HEAD -- apps/web/public/install` | **empty** — no served page touched |
| CI fails on this and only this | run `31683159184`, `--log-failed` | 3 legs, one step, responses `[6] [7] [9]`; `build-and-test` relays only |
| Reader 1 handles it correctly | regenerated artifacts | `PENDING_HUMAN_PANEL`, `staleResponses: 10` |

### The defect found while measuring: the store is append-blocked

`record()` validates the **whole prospective store** before writing:

```ts
const next = { ...store, responses: [...store.responses, response] }
const errs = validate(next)
if (errs.length > 0) { /* refuse */ return 1 }
fs.writeFileSync(storePath, ...)
```

`validate()` iterates every response, so the three pre-existing errors are present in `errs`
no matter what is appended. Verified by simulating the exact write gate with a perfectly
well-formed new response: **3 errors, write refused.**

The consequence is the load-bearing one. The only sanctioned way to close Gate 2.4-B is to
re-run ten human sessions via `--record`, and `--record` **cannot write while the gate is
open**. The check that exists to protect the record's integrity has made the record
unappendable, so it blocks its own remedy. No bypass flag exists: `grep` over the script
confirms `validate` is called at exactly two sites (line 356 pre-write, line 402 for the
read-only modes) and nothing skips it.

## The classification error

Both readers are defensible alone. Together they sort one event into two different *kinds* of
thing:

- Reader 1: the evidence **expired** — a state.
- Reader 2: the record is **malformed** — a break.

The record is not malformed. Those sessions genuinely happened, against pages we genuinely
served on 2026-07-30, and the store faithfully says so, digest included. What changed is the
world, not the file. A store that accurately describes a past measurement is a *correct*
store; treating it as corrupt confuses provenance with currency.

`validate`'s own docblock scopes it: *"These are about the RECORD, never about whether an
answer was right: a store the gate reads must be well-formed …"*. Of its seven rules, six are
about the record's form (schema, participant, ISO timestamp, boolean answers, `shownFrom`
shape, `shownDigest` shape, duplicate detection). The `existsSync` rule is the only one that
reads **current serving state** — which is Reader 1's subject.

Reader 2 is also the **weaker** reader of that subject. It collapses two cases Reader 1
separates:

| world state | Reader 1 | Reader 2 |
|---|---|---|
| page edited since the session | `stale`, `currentDigest: <new>` | passes — file exists |
| page removed since the session | `stale`, `currentDigest: null` | **exit 1** |

So the check that fails the build knows strictly less than the check that passes. A page
*edited* out from under a response is exactly as invalidating, and Reader 2 is blind to it —
`existsSync` cannot see a digest change. Reader 2 therefore adds no coverage Reader 1 lacks,
while adding a failure mode Reader 1 does not have.

## Decision

### D1: Move the serving-state rule out of `validate()`

`validate()` keeps only rules about the record's own form. The `existsSync` check is removed
from it. Freshness — including removal — is decided by `partitionPanelFreshness`, which
already does it correctly and more precisely.

This is a **gate-strength change**, which is why it needs an ADR rather than a commit. The
justification is that no strength is lost: every world state Reader 2 could detect is detected
by Reader 1, which additionally detects the edited-page case. The gate's floor is unchanged —
2.4-B still requires ≥10 fresh responses at ≥90%, and stale responses still do not count.

### D2: The store may not silently accept a response for an unserved page

Removing D1's check from the *record integrity* pass must not make `--record` able to run a
session against a page we do not publish. That guard already exists, at the top of `record()`:

```ts
const page = path.join(served, slug, "index.html")
if (!fs.existsSync(page)) { console.error(`no served install page for ${slug}`); return 2 }
```

It is the correct place for it — a **precondition on the new session**, checked before a human
is asked anything, rather than a verdict on history. `preflight()` additionally byte-compares
served against committed bytes and resolves stylesheets. So the rule survives where it belongs
and only the retroactive application of it is dropped.

### D3: `--validate` reports stale responses without failing

Losing the exit-1 on removal must not make the condition invisible. `--validate` prints the
freshness partition — how many responses are stale and, per stale response, whether the page
was edited or removed — and still exits 0 when the record's form is sound. The state is
already carried by `human-five-second-test.json` (`staleResponses`, `stale[]`) and by
`gate-H`'s `openGates`, both regenerated in `1ad3fbf`.

### D4: What is NOT decided here

- **The panel store is not edited.** It is data only a human writes (ADR 0053 §4). Deleting
  the three responses would not close the gate anyway — 7 remaining < the 10 floor — and would
  destroy the record of why.
- **Gate 2.4-B stays `PENDING_HUMAN_PANEL`** and `gate-H.closed` stays `false`. This ADR
  unblocks the *mechanism* for closing it; it does not close it. Only ten human sessions do.
- **S0-OPEN-4 stays open.** Participant 10's subject is our own page, restorable only by a
  re-ingest.

## Verification

Negative controls, each red on its own claim:

1. Restore the `existsSync` rule in `validate()` → `panel:validate` red again on `[6] [7] [9]`,
   and the append simulation refuses a perfect response. Proves D1 is what unblocks recording.
2. Point `servedDigests` at an empty map → every response `stale`, 2.4-B
   `PENDING_HUMAN_PANEL`. Proves Reader 1 still fails closed after D1.
3. Edit a served page's bytes → the response for it becomes `stale` with a non-null
   `currentDigest`. Proves the case Reader 2 was blind to is covered.
4. Call `--record` with an unserved slug → exit 2 before any prompt. Proves D2's precondition
   survives.
5. Drop `staleResponses` from `--validate` output → the D3 assertion reds. Proves the state
   stays visible rather than silently tolerated.

Required to pass unchanged: `pnpm test`, `pnpm typecheck`, `pnpm gate:s0:gate` (EXIT 0, cohort
25/25), and the three other Phase 2.4 drift steps.

## Consequences

- `pnpm eval:phase-2.4:panel:validate` goes green on a store that honestly records ten stale
  sessions, and CI stops reporting a *record* defect for a *world* change.
- `--record` can append again, so the ten-session re-run becomes possible.
- Gate 2.4-B remains PENDING and the new14 release boundary remains open. That is the honest
  state and this ADR does not change it.
- Reader 1 becomes the single reader of serving state for recorded evidence. The general
  lesson: when one condition can red a gate through two paths, check what each path
  *classifies* it as, and whether the CI-visible one is the weaker reader.
