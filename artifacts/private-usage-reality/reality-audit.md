# R0 — Reality audit

Base: `8acf297` · branch `feat/private-usage-website-reality` · audited 2026-08-19.

Only **actionable** differences between current reality and the target architecture are
recorded. Each row states what was *measured*, not what was assumed.

> **RE-MEASURED AT HEAD (`aebddcd`), 2026-08-19.** This audit was written against base
> `8acf297`. Most of it has since been closed by work on this branch, so reading the tables
> below as a to-do list would re-do finished work — and, worse, would treat their "Target"
> column as unmet when the gates now enforce it. Every row was re-measured; a `CLOSED` row
> states the evidence that it is closed, and section F records what re-measurement found
> that the original audit got *wrong*.
>
> **All of A and B are closed; all of C except C8 is closed. Every open row is in the
> measurement backend: C8, D1, D2, D3, D4, D5** — and D2/D3/D4 are *subsumed* by D1, since
> the files they name live in the two dead trees D1 removes. So the open set is really three
> independent pieces of work: repoint the endpoint (C8), delete the dead trees and rebuild
> the schema aggregate-first (D1+D2+D3+D4), and reshape `wrangler.toml` from Pages to Worker
> (D5). R4–R8 are untouched: `apps/usage` does not exist, no usage or telemetry workflow
> exists, and only `reality-audit.md` + `visual-review.md` are present under
> `artifacts/private-usage-reality/`.
>
> The specification driving this work was also authored against `8acf297`. Its R1 stage is
> therefore already satisfied in full, and its R2 stage nearly so; §7.1's central premise
> (an unclosed `.topic-nav`) is **false at HEAD** and true in history. See section F.

---

## A. Website visual / structural

| # | Finding | Evidence | Target | State |
|---|---|---|---|---|
| A1 | `.topic-nav` is **unclosed** at `styles.css:961`. Braces count **187 open / 186 close**. Under CSS nesting the whole V4 block (`.demo-split`, `.demo-col`, `.demo-label`, `.t-key`, `.t-str`, `.scenario-grid`, `.scenario*`) parses as `.topic-nav .demo-split` etc. `topic-nav` occurs **0 times** in `index.html`, so **the homepage demo + scenario sections are currently entirely unstyled**. | brace count via node; `grep -c topic-nav index.html` = 0 | close the brace; V4 rules top-level; add a brace-balance invariant | **CLOSED** — `.topic-nav {` now at `:1008`, closes at `:1014`; **192 open / 192 close**. `check:web-structure` names the selector and line on mutation (verified both directions). See F1 for what this audit got wrong about it. |
| A2 | `.agent-card` (`styles.css:802`) has no vertical layout contract — no `display:flex`, no `flex-direction:column`, no `height:100%`. Grid stretches the cell; card contents do not distribute. Three cards with 1-line/1-line/4-link bodies therefore start their proof block at three different Y positions. | `styles.css:802-846` | `flex column` + `height:100%`; proof/action anchored via `margin-top:auto` | **CLOSED** — `styles.css:808-816` carries all three declarations; `:843` anchors the last child with `margin-top:auto` **and** `margin-bottom:0` (the trailing-margin half was a second, separately measured defect). |
| A3 | `.agents-grid-3` (`styles.css:825`) holds 3 columns until the single `@media (max-width: 860px)` collapse — and that media query only lists `.demo-split`/`.scenario-grid`, not `.agents-grid`. Tablet width renders 3 cramped columns with code blocks. | `styles.css:825-828`, `1037-1042` | intermediate 1-col (or 2-col) tier; 1 col on mobile | **CLOSED** — `:947` gives `.agents-grid-3` a 2-column tablet tier; `:955` collapses it to 1 column with `.corpus-grid`. |
| A4 | `.scenario-grid` uses `repeat(auto-fit, minmax(220px, 1fr))` — with 4 homepage scenarios this yields an accidental 3+1 at common widths. | `styles.css:996-1000` | intentional 2×2 on desktop via a homepage-scoped modifier | **CLOSED** — `:1048` is an explicit `1fr 1fr`, and the homepage has exactly 4 `.scenario` cards → 2×2. `:1091` collapses to 1 column. |
| A5 | Inline one-off spacing on the second agent row: `style="margin-top: 18px;"`. | `index.html:377` | semantic class | **CLOSED** — promoted to `.agents-grid + .agents-grid` (`styles.css:938`). The 6 remaining inline styles in the tree are in `embed/example.html` (a deliberate copy-paste sample) and the dead Functions tree (D1). |
| A6 | `.corpus-grid` is a 2-col grid; removing the "Next" roadmap card (see B4) would leave one half-width orphan. | `index.html:415-435`, `styles.css:855-860` | single full-width evidence card | **CLOSED** — `.corpus-grid-single` (`styles.css:888`) is `grid-template-columns: 1fr`. |

## B. Public commercial reality

| # | Finding | Evidence | Target | State |
|---|---|---|---|---|
| B1 | `team.html` publicly sells an **unlaunched** product: `$99/org/month` (`:95`), `free forever` (`:59`), `stays free` (`:35`), `Free — local CLI, forever` (`:65`), `What stays free` (`:53`), design-partner beta in the meta description (`:7`). | grep over `apps/web/public/*.html` | page removed | **CLOSED** — file absent; **0** `$99` matches across `apps/web/public/`, `.github/ISSUE_TEMPLATE/`, `README.md`; 0 "free forever"/"stays free"/"forever" in public HTML. |
| B2 | `/team` is linked from `index.html:38`, `404.html:27`, `404.html:126`, plus `team.html`'s own nav/footer/og:url. | same grep | 0 links | **CLOSED** — 0 `/team` or `team.html` references in public HTML or issue templates. |
| B3 | **Governance hole.** `check-public-copy.mjs` `publicFiles` (`:71-89`) enumerates 11 paths by hand and does **not** include `team.html`. The `$99` page was never scanned by any copy gate. A new top-level public HTML escapes governance by default. | `scripts/check-public-copy.mjs:71-89` | discover `apps/web/public/*.{html,md,txt}` + README + issue templates | **CLOSED, negative-controlled.** The gate now derives its set via `readdirSync` over `PUBLIC_EXTENSIONS` + `ISSUE_TEMPLATE_DIR`. Planting a fresh `team.html` containing `$99 / org / month` took it to **EXIT 1**, citing the file, the matched text, and `commercial.paidOfferLive = false`. This is the structural fix the spec asked for: a new public page is governed *by default*, not by remembering to list it. |
| B4 | Homepage corpus section carries an internal roadmap card: `Next` → `grow toward 80 real-public snapshots`, `broader parser-boundary cases`. | `index.html:426-434` | removed, no replacement roadmap | **CLOSED** — no roadmap card; no "Coming soon"/"waitlist" replacement. The only `next` on the page is `Suggested next step` (`:361`), which is CLI usage guidance, not a roadmap. |
| B5 | `.github/ISSUE_TEMPLATE/design-partner.yml` publicly repeats the `$99` price experiment through the issue chooser. | file exists in template dir | removed | **CLOSED** — absent. The dir holds 8 templates, none commercial. |
| B6 | `project-facts.json` has **no** `commercial` block (`commercial: undefined`). There is no authoritative fact stating no paid offer is live, so no gate can key on one. | node read of facts | add `commercial.paidOfferLive:false`, `publicPrice:null` | **CLOSED** — present, with `paidOfferLive:false`, `publicPrice:null`, and a `$comment` recording that flipping the flag re-permits price copy across every public surface at once. |

## C. Telemetry client

| # | Finding | Evidence | Target | State |
|---|---|---|---|---|
| C1 | **Production emitter is permanently dark.** `index.ts:152` calls `buildCliEmitter(process.env)` with no `consented`, no `anonymousInstallationId`, no sink. `shouldEmit` requires `state.consented === true` for `source:"cli"` (`gate.ts:45`), so `telemetry enable` has **no effect** on emission. | `apps/cli/src/index.ts:152`, `gate.ts:45` | pass stored consent + ID + a queue-backed sink | **CLOSED** — `index.ts:175` passes `sink: queueSink()`, `consented: telemetryState.telemetryEnabled === true`, `installationId`. State load failure falls through to off (fail closed). |
| C2 | **Queue byte cap is inert.** `sizeBytes` is computed **once** at `queue.ts:71`, outside the `while` at `:72`. If the cap is exceeded the loop never re-measures → it shifts until `length === 0`, i.e. **clears the whole queue**; if not exceeded it never runs. | `apps/cli/src/queue.ts:71-74` | recompute inside the loop | **CLOSED** — `:119` sums per-event `Buffer.byteLength`, `:125` trims against a running total. Measures bytes not characters, and measures the same bytes `save()` writes. |
| C3 | **Failed delivery loses events.** `take()` splices **and `save()`s** (`queue.ts:80-85`) before delivery. On failure `flush.ts:53` calls `queue.load()`, which only refreshes memory from the already-truncated file. Events are gone from disk. | `queue.ts:80-85`, `flush.ts:46-54` | peek → stable `batchId` → send → ack-on-success only | **CLOSED** — `take()` replaced by `peek()` (`:144`) + `removeDelivered()` (`:157`). |
| C4 | **Retry re-mints `batchId`.** `createBatch()` calls `generateBatchId()` every time (`queue.ts:104-110`), so a retried batch is a new identity → server-side idempotency cannot dedupe. | `queue.ts:98-110` | persist a pending batch with a stable id | **CLOSED** — `:191` derives the id from a content digest, so a retry of the same events reproduces the same id without needing to persist it. |
| C5 | **Aggregation drops child telemetry.** `CommandResult.telemetry` is **singular** (`scan.ts:45`) and `--changed` (`:356`), `--auto` (`:424`), `--agent` all return an aggregate result with **no** telemetry field. `scan --auto` over N configs records **0** preflights. `scan-all` likewise (`scanAll.ts:22-33`). | those lines | signal list; 1 config = 1 `preflight_completed` + 1 `decision_<verdict>` | **CLOSED** — the field is now `TelemetrySignal \| readonly TelemetrySignal[]` (`:49`); `:204` emits the two-signal pair per config; the three aggregate paths (`:368`, `:437`, `:517`) each return `collectSignals(results)`. |
| C6 | **Duplicate telemetry path exists.** `apps/cli/src/capture.ts` writes the queue directly (`captureScanComplete`, `:38-41`) and mis-encodes server count into `inputKind`. It has **0 importers** — dead, but a live double-count waiting to be wired. | `grep` for importers returned only its own definition | delete | **CLOSED** — deleted in `79f3cb8`. One pipeline remains. |
| C7 | `telemetry reset` prints the **first 16 chars of the new installation ID**. | `commands/telemetry.ts:103` | `Installation identity rotated.` | **CLOSED** — `:109` prints `Installation identity rotated.`; `:95` prints a fact about rotation carrying no identifier. No ID fragment reaches stdout. |
| C8 | Default transport endpoint is `https://calllint.com/v1/events/usage` — a static Pages host that runs no Functions, so every POST hits `404.html`. | `transport.ts:9-11` | separate Worker host | **OPEN** — still `https://calllint.com/v1/events/usage` (`transport.ts:9-11`), overridable via `CALLLINT_TELEMETRY_ENDPOINT`. Because the host is static-only, the failure is not a clean error: the POST receives `404.html`, whose body is *example* `partner-api.error.v0` JSON, so a dead endpoint answers shaped like a live backend. |

## D. Measurement backend

| # | Finding | Evidence | Target | State |
|---|---|---|---|---|
| D1 | **Two byte-identical tracked copies** of the dead Functions tree: `functions/**` (repo root) and `apps/web/public/functions/**`, 8 files each, `diff -r` reports identical. Neither has ever executed (static-only Pages project). | `git ls-files` both paths; `diff -r` | one Worker source of truth; remove both | **OPEN** — 16 tracked files across the two paths. Neither is covered by `typecheck:functions`, which points at `apps/web/functions/tsconfig.json` (see the note below). |
| D2 | `usage_events.batch_id TEXT UNIQUE NOT NULL` (`schema.sql:7`) is on the **event** row. A 100-event batch shares one `batchId` → the 2nd insert violates UNIQUE. A multi-event batch is structurally impossible. | `functions/schema.sql:5-18` | aggregate-first: `usage_daily_counts`, `usage_daily_installations`, `usage_ingested_batches` | **OPEN** (subsumed by D1 — the file lives in the tree D1 removes). Confirmed still present at `functions/schema.sql:7`. |
| D3 | Schema is raw-event-centric with indefinite retention (only the *views* window to 90/30 days; the table keeps everything). | `schema.sql:20-42` | daily aggregates; 90d installations, 30d batches | **OPEN** (subsumed by D1). |
| D4 | `adoption-signals.ts` public read API exists as source. §3 forbids it. | `functions/v1/public/adoption-signals.ts` | removed | **OPEN** — **2** tracked paths match `adoption-signals` (one per D1 copy). Never executed (static-only host), so `PUBLIC_USAGE_SIGNALS = DEFERRED` holds in *behaviour* today; the source is a latent contradiction, not a live surface. |
| D5 | `wrangler.toml` at root names `calllint-usage-observatory` with `pages_build_output_dir` — a Pages shape for what must be a Worker. D1 `calllint-usage` (`98626b00-…`) exists and is empty. | `wrangler.toml` | Worker config, no Pages output dir | **OPEN** — `:1` `name = "calllint-usage-observatory"`, `:3` `pages_build_output_dir = "public"`, `:8` `database_name = "calllint-usage"`. A `wrangler pages deploy` never applies `wrangler.toml` bindings at all, so the D1 binding declared here has never been reachable — the same mechanism as C8's dead endpoint, one layer down. |

## E. Governance / gates present

`check:public-copy`, `check:harness-distribution`, `check:telemetry-boundary`, `facts:check`,
`typecheck` (+`:functions` → `apps/web/functions/tsconfig.json`, which does **not** cover
`apps/web/public/functions/**` or root `functions/**`), `agent:smoke`, and a 20-step
`ci:local`. The presentation ledger's subject is the content catalog, not served HTML, so
homepage edits owe no ledger entry.

**Note:** `typecheck:functions` points at `apps/web/functions/tsconfig.json` (the *trust*
Functions, which are live on a different path). The dead usage Functions had their own
`tsconfig.json` in-tree that nothing chains to — consistent with the known
"observer gap needs a separate project" finding. Removing them closes it by deletion.

Measured at HEAD: `check:public-copy`, `check:web-structure`, `check:harness-distribution`,
`check:agent-surface`, `check:telemetry-boundary`, `facts:check` — **all EXIT 0**.

`check:web-structure` deserves note as the gate that closes A1's *class* rather than its
instance. It already asserts brace balance across all 7 served stylesheets, that every
`<link>` resolves, and that every layout-contract class used in HTML is actually defined —
a superset of a brace counter. A second CSS gate was drafted during this pass and
**discarded as a duplicate**; the pre-existing one is strictly better (7 stylesheets vs 2,
and it names the offending selector).

## F. What re-measurement corrected in this audit

The rows above were written from a real defect state, but three of them described it
inaccurately. The inaccuracies matter because each would have sent work to the wrong place.

**F1 — A1's headline was right and its blast radius was wrong.** `.topic-nav` *was*
unclosed, and the missing `}` *was* immediately before the `/* ---- V4 ---- */` comment,
exactly as stated. But A1 says the defect is live at HEAD; it is not. History:

| commit | braces | state |
|---|---|---|
| `720e34d` | 152 / 152 | balanced |
| `8f10a75` | 166 / 165 | **UNBALANCED** — the V4 restructure itself introduced it |
| `6f99fa4` … `8acf297` | …/…−1 | unbalanced, 6 further commits |
| `aebddcd` | 192 / 192 | balanced |

So the defect was live for **seven commits**, and was closed on this branch by `aebddcd`
— a commit titled *"Registry identity projection"* whose diff appends a bare `+}`. The fix
was **incidental**, not deliberate: nothing in that commit's message or body mentions CSS.
That is worth recording precisely because an incidental fix is indistinguishable from a
deliberate one in the tree, and re-doing it would have been the natural next step.

**A1's count of swallowed rules was also understated.** A1 lists 7 selectors; the measured
count of rules trailing the unclosed block is **14** — the 12 `.demo-*`/`.scenario*` rules,
plus an `@media (max-width: 860px)` block and its nested `.scenario-grid`. All 14 are
referenced by `index.html`. The user's instinct was correct and stronger than the audit
recorded it: the visible Demo/Scenario anomalies were **not** a design problem.

**F2 — `main` is still broken.** The fix exists only on this branch. `main`'s `styles.css`
measures 192 open / 191 close, with `.topic-nav` unclosed at `:961`. The homepage demo and
scenario sections are unstyled *in production right now*, and will be until this branch
merges. This is the one finding in the audit whose urgency was understated rather than
overstated: A1 is closed in the working tree and **open on the live site**.

**F3 — a probe of mine reported a self-referential zero.** While locating the unclosed
block I printed "0 later top-level openers sit inside it," which reads as *nothing was
affected*. It is vacuous: once depth never returns to 0, no later rule *can* be classified
as top-level, so the counter is guaranteed to print 0 regardless of how many rules follow.
Counting brace-openers after the offending line instead gave 14. Recorded because it is the
same fault class as the rest of this file — a measurement whose result was determined by
its own framing rather than by its subject.


**F4 — the "static-only host" premise this audit rests on is FALSE, re-measured 2026-08-20.**
Rows C8, D1 and D4 each state, as measured fact, that `calllint.com` is "a static Pages host
that runs no Functions". It runs Functions: `POST /v1/events/trust` returns **204 with an
empty body**, which is `apps/web/functions/v1/events/trust.ts` executing. The narrower true
statement is a **routing** one — `_routes.json` includes only `/v1/public/*`,
`/v1/events/trust` and `/trust/*`, so `/v1/events/usage` was *unrouted*, not unsupported.

The rows' *conclusions* survive on the corrected premise: an unrouted POST still receives
`404.html`, so C8's trap (a dead endpoint answering in the shape of a live
`partner-api.error.v0` response) is real and unchanged, and D1/D4's dead sources were still
never executed.

Why the premise held for a day: it was inferred from status codes measured **without a
control**. On this project a `POST` to a path that certainly has no handler returns **405**,
and a `GET` returns **404** with a 6067-byte HTML body — identical to what the "dead"
Function routes returned. Every observation was consistent with both "no runtime" and
"unrouted" and could distinguish neither. This is the same fault class as F3 above and as the
rest of this file: a measurement whose result was fixed by its framing rather than by its
subject. Only a reply that *differs* from a known-nonexistent sibling is evidence.

Row states as of 2026-08-20: **C8 CLOSED in code, blocked on deploy** —
`transport.ts` `TELEMETRY_ENDPOINT` now points at `https://telemetry.calllint.com/v1/events/usage`,
a separate Worker host, which is the target this row asked for; the Worker is unpublished, so
the POST still fails, but it now fails against a host with no static 404 page to mimic an API
error. **D1 and D4 are CLOSED by deletion**: both `functions/**` and
`apps/web/public/functions/**` were removed on 2026-08-20 (0 tracked files remain under
either), so the two byte-identical dead trees and the `adoption-signals.ts` source are gone.
`PUBLIC_USAGE_SIGNALS = DEFERRED` now holds in source as well as in behaviour.
