# R0 — Reality audit

Base: `8acf297` · branch `feat/private-usage-website-reality` · audited 2026-08-19.

Only **actionable** differences between current reality and the target architecture are
recorded. Each row states what was *measured*, not what was assumed.

---

## A. Website visual / structural

| # | Finding | Evidence | Target |
|---|---|---|---|
| A1 | `.topic-nav` is **unclosed** at `styles.css:961`. Braces count **187 open / 186 close**. Under CSS nesting the whole V4 block (`.demo-split`, `.demo-col`, `.demo-label`, `.t-key`, `.t-str`, `.scenario-grid`, `.scenario*`) parses as `.topic-nav .demo-split` etc. `topic-nav` occurs **0 times** in `index.html`, so **the homepage demo + scenario sections are currently entirely unstyled**. | brace count via node; `grep -c topic-nav index.html` = 0 | close the brace; V4 rules top-level; add a brace-balance invariant |
| A2 | `.agent-card` (`styles.css:802`) has no vertical layout contract — no `display:flex`, no `flex-direction:column`, no `height:100%`. Grid stretches the cell; card contents do not distribute. Three cards with 1-line/1-line/4-link bodies therefore start their proof block at three different Y positions. | `styles.css:802-846` | `flex column` + `height:100%`; proof/action anchored via `margin-top:auto` |
| A3 | `.agents-grid-3` (`styles.css:825`) holds 3 columns until the single `@media (max-width: 860px)` collapse — and that media query only lists `.demo-split`/`.scenario-grid`, not `.agents-grid`. Tablet width renders 3 cramped columns with code blocks. | `styles.css:825-828`, `1037-1042` | intermediate 1-col (or 2-col) tier; 1 col on mobile |
| A4 | `.scenario-grid` uses `repeat(auto-fit, minmax(220px, 1fr))` — with 4 homepage scenarios this yields an accidental 3+1 at common widths. | `styles.css:996-1000` | intentional 2×2 on desktop via a homepage-scoped modifier |
| A5 | Inline one-off spacing on the second agent row: `style="margin-top: 18px;"`. | `index.html:377` | semantic class |
| A6 | `.corpus-grid` is a 2-col grid; removing the "Next" roadmap card (see B4) would leave one half-width orphan. | `index.html:415-435`, `styles.css:855-860` | single full-width evidence card |

## B. Public commercial reality

| # | Finding | Evidence | Target |
|---|---|---|---|
| B1 | `team.html` publicly sells an **unlaunched** product: `$99/org/month` (`:95`), `free forever` (`:59`), `stays free` (`:35`), `Free — local CLI, forever` (`:65`), `What stays free` (`:53`), design-partner beta in the meta description (`:7`). | grep over `apps/web/public/*.html` | page removed |
| B2 | `/team` is linked from `index.html:38`, `404.html:27`, `404.html:126`, plus `team.html`'s own nav/footer/og:url. | same grep | 0 links |
| B3 | **Governance hole.** `check-public-copy.mjs` `publicFiles` (`:71-89`) enumerates 11 paths by hand and does **not** include `team.html`. The `$99` page was never scanned by any copy gate. A new top-level public HTML escapes governance by default. | `scripts/check-public-copy.mjs:71-89` | discover `apps/web/public/*.{html,md,txt}` + README + issue templates |
| B4 | Homepage corpus section carries an internal roadmap card: `Next` → `grow toward 80 real-public snapshots`, `broader parser-boundary cases`. | `index.html:426-434` | removed, no replacement roadmap |
| B5 | `.github/ISSUE_TEMPLATE/design-partner.yml` publicly repeats the `$99` price experiment through the issue chooser. | file exists in template dir | removed |
| B6 | `project-facts.json` has **no** `commercial` block (`commercial: undefined`). There is no authoritative fact stating no paid offer is live, so no gate can key on one. | node read of facts | add `commercial.paidOfferLive:false`, `publicPrice:null` |

## C. Telemetry client

| # | Finding | Evidence | Target |
|---|---|---|---|
| C1 | **Production emitter is permanently dark.** `index.ts:152` calls `buildCliEmitter(process.env)` with no `consented`, no `anonymousInstallationId`, no sink. `shouldEmit` requires `state.consented === true` for `source:"cli"` (`gate.ts:45`), so `telemetry enable` has **no effect** on emission. | `apps/cli/src/index.ts:152`, `gate.ts:45` | pass stored consent + ID + a queue-backed sink |
| C2 | **Queue byte cap is inert.** `sizeBytes` is computed **once** at `queue.ts:71`, outside the `while` at `:72`. If the cap is exceeded the loop never re-measures → it shifts until `length === 0`, i.e. **clears the whole queue**; if not exceeded it never runs. | `apps/cli/src/queue.ts:71-74` | recompute inside the loop |
| C3 | **Failed delivery loses events.** `take()` splices **and `save()`s** (`queue.ts:80-85`) before delivery. On failure `flush.ts:53` calls `queue.load()`, which only refreshes memory from the already-truncated file. Events are gone from disk. | `queue.ts:80-85`, `flush.ts:46-54` | peek → stable `batchId` → send → ack-on-success only |
| C4 | **Retry re-mints `batchId`.** `createBatch()` calls `generateBatchId()` every time (`queue.ts:104-110`), so a retried batch is a new identity → server-side idempotency cannot dedupe. | `queue.ts:98-110` | persist a pending batch with a stable id |
| C5 | **Aggregation drops child telemetry.** `CommandResult.telemetry` is **singular** (`scan.ts:45`) and `--changed` (`:356`), `--auto` (`:424`), `--agent` all return an aggregate result with **no** telemetry field. `scan --auto` over N configs records **0** preflights. `scan-all` likewise (`scanAll.ts:22-33`). | those lines | signal list; 1 config = 1 `preflight_completed` + 1 `decision_<verdict>` |
| C6 | **Duplicate telemetry path exists.** `apps/cli/src/capture.ts` writes the queue directly (`captureScanComplete`, `:38-41`) and mis-encodes server count into `inputKind`. It has **0 importers** — dead, but a live double-count waiting to be wired. | `grep` for importers returned only its own definition | delete |
| C7 | `telemetry reset` prints the **first 16 chars of the new installation ID**. | `commands/telemetry.ts:103` | `Installation identity rotated.` |
| C8 | Default transport endpoint is `https://calllint.com/v1/events/usage` — a static Pages host that runs no Functions, so every POST hits `404.html`. | `transport.ts:9-11` | separate Worker host |

## D. Measurement backend

| # | Finding | Evidence | Target |
|---|---|---|---|
| D1 | **Two byte-identical tracked copies** of the dead Functions tree: `functions/**` (repo root) and `apps/web/public/functions/**`, 8 files each, `diff -r` reports identical. Neither has ever executed (static-only Pages project). | `git ls-files` both paths; `diff -r` | one Worker source of truth; remove both |
| D2 | `usage_events.batch_id TEXT UNIQUE NOT NULL` (`schema.sql:7`) is on the **event** row. A 100-event batch shares one `batchId` → the 2nd insert violates UNIQUE. A multi-event batch is structurally impossible. | `functions/schema.sql:5-18` | aggregate-first: `usage_daily_counts`, `usage_daily_installations`, `usage_ingested_batches` |
| D3 | Schema is raw-event-centric with indefinite retention (only the *views* window to 90/30 days; the table keeps everything). | `schema.sql:20-42` | daily aggregates; 90d installations, 30d batches |
| D4 | `adoption-signals.ts` public read API exists as source. §3 forbids it. | `functions/v1/public/adoption-signals.ts` | removed |
| D5 | `wrangler.toml` at root names `calllint-usage-observatory` with `pages_build_output_dir` — a Pages shape for what must be a Worker. D1 `calllint-usage` (`98626b00-…`) exists and is empty. | `wrangler.toml` | Worker config, no Pages output dir |

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
