# new22 closure report

- **Date:** 2026-09-01
- **Branch:** `feat/new22-cursor-authority-boundary-v2` (off `main` @ `c4c388b`)
- **Source plan:** `docs/new22.md`. `docs/` is gitignored (`.gitignore:44`), so this file and
  [`NEW19-21_OPEN_ITEMS.md`](NEW19-21_OPEN_ITEMS.md) are the tracked record of what it asked for.
- **Scope:** one P1 (Cursor authority boundary v2) + two P2 (Copilot permission watch, OpenAI
  isolation incident). **No detector, no schema change, no verdict-semantics change.**

## §FIRST — the six questions, answered from the repo before any edit

new22 required these be answered from actual code, not from the plan. Measured at `c4c388b`.

| # | question | measured answer |
|---|---|---|
| 1 | Where is the canonical Cursor host record? | `apps/web/data/distribution-surfaces.json`, `id: "cursor"` — one of 18 hosts |
| 2 | What is its `supportClass` / state? | `NATIVE`; 2 primitives — `mcp-stdio` = `AUDIT_REQUIRED`, `cursor-plugin` = `PENDING_UPSTREAM` |
| 3 | Which config artifacts are actually extracted? | **only** `~/.cursor/mcp.json` + `<project>/.cursor/mcp.json`; `authoritySurfaces: [mcp, filesystem, shell]` |
| 4 | Which surfaces describe Cursor support? | one SSOT → `pnpm gen:distribution` → 31 projections (per-host page, `agent-surfaces.json`, `agent-discovery-index.json`, `llms*.txt`, `agent-instructions.md`, 2 matrices, sitemap, `_redirects`, …) |
| 5 | What does `coverageBoundary` already say? | ✅ Cloud Agents / background agents / event-or-timer wakeups, already `UNSUPPORTED` + *not statically observable*. ❌ **absent:** repo-less execution, Cursor Origin repository, port forwarding, Vercel publish |
| 6 | Is it wide enough to be misread? | **Yes.** Naming only *what starts* an agent leaves a reader to assume *where it runs* and *what it changes* are covered |

**Three reuse findings decided the implementation path** — every one of them removed work rather
than adding it:

- **Authority Model v2 vocabulary already ships in full.** `packages/types/src/authority.ts`:
  `AUTHORITY_LAYERS` (5 layers), `AUTHORITY_LAYER_STATES` (`observed|unknown|unsupported`),
  `authorityLayerVerdictFloor()`. Nothing needed to be built or extended.
- **`coverageBoundary` is already a required free-text field**
  (`schemas/distribution-surfaces.schema.json`), so expressing a new boundary needs **no schema
  change** — matching new22's own `DEFAULT: NO schema change`.
- **A guard for exactly this subject already existed**:
  `tests/invariants/activation-contract.invariants.test.ts`, the `new21 §7/§10.D` block, with
  `HOSTS = ["cursor"]`, four subject regexes, an `unsupported` assertion and a SAFE-negation
  assertion. new22 asked to *extend the smallest existing structure*; this was it.

All seven gates new22 lists already exist as npm scripts. **Zero new scripts, zero new gate files.**

## What changed

| file | change |
|---|---|
| `apps/web/data/distribution-surfaces.json` | `cursor.coverageBoundary` **only** — 377 → 1046 chars. The single data edit. |
| 6 generated projections | `pnpm gen:distribution` output. Never hand-edited. |
| `tests/invariants/activation-contract.invariants.test.ts` | +205 lines: one `new22 §NC-CURSOR-V2` describe block, 6 tests |
| `artifacts/adr/0005-authority-layers-vocabulary.md` | new Amendment 2026-09-01 (P2-b) |
| `artifacts/distribution-watch/COPILOT_PERMISSION_AUTHORITY_WATCH.md` | **new** (P2-a), evidence only |
| `artifacts/architecture/NEW19-21_OPEN_ITEMS.md` | new22 section: P1 closed, 2 P2 registered |

**Unchanged, and asserted so by NC-08:** `authoritySurfaces`, `configEvidence`, `supportClass`, and
both primitive `state`s. `packages/types/src/authority.ts` is **byte-identical** to `main`.

### P1 — the boundary now names all three cloud-resident layers

The pre-existing sentence covered `entrypoint` alone. Appended: `execution` (a Cloud Agent can start
with **no repository at all**, in a Cursor-managed cloud environment — so there is no config file to
read the run out of) and `effect` (Origin repository creation/change, browser-facing port forwarding,
Vercel publication). Each is `UNSUPPORTED`, with the existing *"rather than reading it as SAFE"*
formulation reused because four shipped assertions depend on that word form.

The closing sentence is the one that does the work: *"Reading Cursor's MCP config tells you what one
layer of Cursor's authority declares, never that the layers CallLint cannot see are safe."*

**One necessary second edit.** The word *subscription* was absent from the boundary, while new22's
NC-02 names "Cloud Agent subscriptions". Left alone, that assertion would have passed **vacuously** —
green because its subject did not exist. `cloud subscriptions and ` was added to make the assertion
observable. This is the repo's dominant fault class caught during its own remediation.

### P2-a — Copilot: evidence recorded, deliberately no detector

`artifacts/distribution-watch/COPILOT_PERMISSION_AUTHORITY_WATCH.md` records the three GitHub
2026-08-28 changes (`defaultMode`/`defaultPermissionMode`, mid-turn session resume, JetBrains
enterprise control) against their Authority v2 layers, plus **five questions the next Copilot reality
mapping must answer from the shipped product**. It says, in its own text, *"Do not build a detector
from this file."*

Why a new hand-written file rather than an entry in `official-sources.json`: that file is
**generated** by `scripts/check-official-sources.mjs` and is its own change-detection baseline. A
hand entry there would be overwritten by the next run **and** would corrupt the diff it exists to
produce.

Why no detector: whether these settings persist to a stable, locally-readable path is **not
established**. A detector against an unverified path reproduces a defect this repo has already
shipped once and pinned — `scan --config` advertised on eight surfaces while nothing read it. An
unread detector is worse than none, because its silence reads as *nothing found*.

### P2-b — the `execution` layer means a *declared* boundary, never an enforced one

Recorded as an amendment to ADR 0005. `observed` on `execution` means "we read what was declared" —
the sandbox flag, the container image, the permission mode a config asks for. It carries **no claim**
that the declaration was enforced at runtime.

Prompted by OpenAI's 2026-08-26 report of a research model escaping its network isolation in a
reduced-safeguard test environment: every declaration involved was still exactly as written on disk.
The two properties come apart in practice. The correct response is therefore **not** a
sandbox/runtime detector — CallLint does not execute, connect or observe runtime behaviour (Product
Principles 6/7) — it is to keep the two ideas named separately.

**Why the prose is in the ADR and not in the docblock it describes.** `packages/types/src/authority.ts`
is a verdict-deciding file under the §18 zero-diff gate
(`scripts/verify-security-semantic-diff.mjs`), whose whitelist exempts only **append-only** changes
to it. Inserting prose mid-docblock is not append-only, so the gate red — **correctly**. Measured:
`head.startsWith(base)` → `False` (11321 → 12719 bytes). Teaching that gate to distinguish a comment
from code would require restoring the TypeScript parser its author deliberately removed
("append-only needs no parser at all") — a real widening of a security gate, bought for a comment.
The edit was reverted; `authority.ts` is byte-unchanged. **The gate was respected, not weakened.**

## Negative controls — 12, each proven to red

Every assertion was mutated until the intended test failed, then restored and verified
**byte-identical with `cmp`** (never `git status`, which cannot see a byte-level revert). Script:
`d:\tmp\nc22-negctl.sh`.

Two findings inside the control harness itself, both recorded in the script so the next reader
does not reintroduce them:

- **The probe reported `failing=0` on runs that exited 1** — all 12. It grepped for `"× .*"`, a
  multi-byte glyph behind ANSI prefixes the pattern silently missed. Fixed by stripping ANSI and
  parsing the ASCII `^ FAIL` lines. **A control harness that cannot see failure reports success** —
  the fault class, one level up.
- **NC-02b was misdiagnosed as vacuous.** Its regex is an alternation
  (`/\btimers?\b|\bcron\b/`); the mutation dropped only `cron`, leaving "timer wakeups" matching, so
  green was **correct**. The control was rebuilt to remove the whole subject.

NC-01b is the one worth naming: mutating **only** the served HTML while leaving the SSOT correct
reds the page assertion **alone** — proving it is an independent reader of the served bytes, not a
restatement of the data file.

## Acceptance (new22 §ACCEPTANCE)

| | criterion | how it is met |
|---|---|---|
| A | Cursor extractor behaviour unchanged | no extractor touched; NC-08 pins `authoritySurfaces`/`configEvidence`/`supportClass`/primitive states |
| B | scan output & verdict semantics unchanged | one free-text field; `authority.ts` byte-identical; `check:security-semantics` = `UNCHANGED` |
| C | five-layer coverage readable without platform expertise | boundary is plain prose; no enum name is exposed publicly |
| D | repo-less execution explicitly outside static observation | NC-01, SSOT + served page |
| E | cloud subscription / trigger likewise | NC-02 (regression protection for the pre-existing 4 subjects) |
| F | Origin / port / Vercel not inferable as covered | NC-03, NC-04, NC-05 |
| G | unobservable never SAFE | NC-06: per-occurrence SAFE-negation **plus** `authorityLayerVerdictFloor("unsupported") === "UNKNOWN"` |
| H | a future broadened claim reds a committed gate | NC-07: both machine surfaces must match the SSOT **verbatim** |
| I | all SSOT projections deterministic and in sync | `check:distribution-drift` — 31 projections byte-for-byte |
| J | no new runtime dependency or credential | none added; no network, no clock, no cloud call |

**NC-07 closed a real gap.** `check-agent-surface-contract.mjs` cross-checks the two machine surfaces
against **each other**, so nothing compared either to the SSOT — one edit applied to both would have
agreed with itself and passed.

## Verification

Node **v20.20.2** (`export PATH="/c/Users/admin/AppData/Local/nvm/v20.20.2:$PATH"` — the machine
default is v16, where vitest dies at startup; a green run under v16 is not evidence of anything).

| gate | result |
|---|---|
| `pnpm typecheck` | EXIT 0 |
| `pnpm test` | EXIT 0 — 277 files, **5673 passed / 1 skipped** (pre-existing) |
| `pnpm build` | EXIT 0 |
| `pnpm corpus:test` | EXIT 0 — "All corpus contracts hold"; toxic-flow failures 0 |
| `pnpm check:distribution-drift` | EXIT 0 — 31 projections byte-identical |
| `pnpm check:harness-distribution` | EXIT 0 |
| `pnpm check:agent-surface` | EXIT 0 |
| `pnpm check:public-copy` | EXIT 0 |
| `pnpm check:security-semantics` | EXIT 0 — `SECURITY_SEMANTICS = UNCHANGED` |
| `packages/types/test/authority-layers.test.ts` | EXIT 0 — 18 tests |
| the extended invariants file | 44 tests pass |

## What was deliberately not done

Per new22 §FORBIDDEN, and each of these was a live option rejected on evidence, not overlooked:

- **No `CopilotPermissionDetector`** — Q1–Q3 of the watch file are unanswered.
- **No Cursor cloud API call, no credential, no account-state scrape, no runtime monitoring, no
  browser/Vercel inspection, no Cursor-specific engine, no LLM classification, no telemetry.**
- **No domain entities** — `CursorCloudAgent`/`CursorSubscription`/`CursorOrigin`/`CursorVercel`/
  `CursorPortForward` were all declined.
- **No fabricated fixture.** Cursor exposes no subscription/Origin/Vercel config file; inventing one
  would fake an artifact the product does not provide. The controls express *"this authority is not
  covered"*, never *"we parsed it"*.
- **No inference of remote state from absent local evidence**, and **no UNKNOWN → SAFE**.
- **Not pushed, not merged, not published** — new22 requires stopping at the report plus green gate
  evidence.

## Still open after this round

**R-9** (Aliyun rolling worker production enable + CAS retention) is the only open Workstream R
batch — its systemd units are committed, but the enable itself is an ops act on the host and cannot
be closed from this repo. **Gate S1** needs one `pnpm ingest:trust-index` run to emit a v3 report,
and its `disk-growth` claim needs **calendar time** between two real runs — unclosable by running
anything. ~~**Gate S2** needs 6 more ingests to reach cohort 500 (auto-growth +50/run): a cadence
matter, not an engineering one.~~ **N22-P2a** stays registered pending the next Copilot reality
mapping.

**Gate S2 — corrected 2026-09-01 against the gate's own output, and the struck clause was wrong in
the direction that stops inquiry.** "A cadence matter, not an engineering one" implies waiting is the
only lever. `pnpm gate:s2` says otherwise, and names its own constraint: the newest run read **86984**
raw upstream records and emitted a cohort capped at `snapshot=200`, so *"this run COULD NOT have
reached the threshold whatever upstream held"* — the cap bound it, not upstream. The gate offers two
remedies, not one (let auto-growth run at +50/run, **or** set `TRUST_INGEST_MAX_ENTRIES`), and also
names the knob that would change nothing: `capReached` grades the mirror read against `mirror=100000`,
a different quantity from the served cohort.

**But the second remedy is gated, and the gate's message does not say so** — checked rather than
assumed, because "the gate named two remedies" would otherwise read as two available choices.
**ADR 0009** (`artifacts/adr/0009-instrumentation-precedes-the-cohort-cap.md`, Decided 2026-08-27)
holds the cap at its compiled value until **three quantities are measured at 100 and at one larger
cohort, with the numbers committed**: ingest wall-clock + request count, mirror read volume in bytes
and requests, and bake time + projection output size. It gives the reason in the form of a distinction
worth keeping: *"a single-shot fetch that works at 100 may exceed a platform timeout at 500; that is a
cliff, not a slope, and it cannot be extrapolated from one data point."* Mirror read volume is singled
out as the one that *"turns into someone else's rate limit — an external harm, not a local slowdown."*
And `+50/run` auto-growth is **separately** gated: a measured static cap says 500 is affordable once,
whereas auto-growth asserts every future value is affordable, so it additionally requires a hard
ceiling plus a stop condition on the measured quantities. `open-judgements.invariants.test.ts` reads
`DEFAULT_MAX_ENTRIES` from source, so a cap that moves without its artifact reds.

So S2's honest status is neither "6 ingests away" nor "one env var away": it is **blocked on
instrumentation that does not exist yet**, and that instrumentation is itself a measurement task
(two cohort sizes, three quantities) rather than a wait. Not taken here — it is outside new22's
scope and would need its own batch.

Measured in the same pass as the above (fourth Gate S1 measurement, `artifacts/gate-s1/open-items.md`):
`gate:s1` EXIT 0 with **5 MEASURED / 2 REFUSED**, and `processing-time-mean-p95`'s refusal has moved
from `blocked on SCHEMA` to `PREDATES THE OBSERVABLE` — ADR 0097's monotonic clock is wired end to end
(six links re-read at this commit and now enrolled in the pointer layer), so that measure's blocker is
**one ingest**, no longer a schema change. The ingest was not performed: it writes the gitignored run
report the measure needs, but also rewrites the **tracked** `packages/trust-index/snapshots/official-mcp-registry.json`
and reaches the upstream registry, which is not a side effect a measurement pass should have.
