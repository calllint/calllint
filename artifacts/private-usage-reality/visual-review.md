# R2 — Website visual closure: measured review

Scope: layout normalization of the **current** site. Not a redesign, not a new design
system. Every row below is either PASS with the measurement that proves it, or a FIX with
the exact change made.

Method: served `apps/web/public/` over a local static server and measured the real CSSOM /
layout boxes in Chrome. Numbers are `getComputedStyle` / `getBoundingClientRect` output,
not visual impressions. A visual review can only report "this looks wrong"; these
measurements say *where* and *why*.

Why measured rather than eyeballed: the defect that motivated this stage (an unclosed
`.topic-nav` rule) is invisible to a text gate and reads as a *design* problem in a
screenshot. The only way to distinguish "styled badly" from "not styled at all" is to read
the computed box.

---

## S1 — Structural break fixed before any aesthetic change

Per the instruction 先修结构，再调美感, this was done first, and the rest of the review
was performed only afterwards.

`apps/web/public/styles.css` shipped with an unclosed `.topic-nav {`. Under CSS nesting
that does not fail loudly: every following top-level rule silently became a **descendant**
of it. `.demo-split` became `.topic-nav .demo-split`, and `topic-nav` appears zero times in
`index.html`, so the homepage's whole demo + scenario block rendered with **no styling at
all**.

| item | before | after |
|---|---|---|
| brace balance, `styles.css` | 1 unclosed rule | **192 open / 192 close** |
| `.demo-split` computed columns @1440 | (unstyled — single flow) | `404px 404px` |
| `.scenario-grid` computed columns @1440 | (unstyled — single flow) | `404px 404px` |

The demo/scenario grids resolving to real two-column tracks is direct proof the brace fix
mattered: those tracks are declared in rules that were previously nested out of reach.

Verdict: **FIX APPLIED** — closed the rule; the observed Demo/Scenario anomaly was
structural, not a design problem, exactly as suspected.

A new gate, `scripts/check-web-structure.mjs`, now makes this fault class observable — see
S6.

## S2 — Agent-card vertical rhythm (fixed by layout, no copy shortened)

The card row looked ragged because grid equalizes *cell* height while the content inside
each cell ends wherever it ends. The contract applied is
`title → copy → flexible space → evidence/action`:
`display:flex; flex-direction:column; height:100%` on the card, `margin-top:auto` on the
last child.

No true copy was shortened to equalize string lengths. That was explicitly out of bounds,
and it is also the wrong fix: it trades a true sentence for a cosmetic one, and the row
re-breaks the next time the copy is honest.

Measured @1440 after the contract:

| row | cards | height spread | slack absorbed by `margin-top:auto` |
|---|---|---|---|
| 0 | 3 | `230/230/230` → **0** | 22.8px |
| 1 | 2 | `340/340` → **0** | 40.975px |

### The residual 12px, and the real cause

With the flex contract in place a **12px baseline spread** survived in row 0. Diagnosed by
enumerating the CSSOM rather than guessing:

```
.agent-card p        { margin: 0px 0px 12px }   specificity 0,1,1   ← wins
.agent-card-links    { margin: 0 }               specificity 0,1,0
```

`.agent-card p` outranks `.agent-card-links` regardless of source order, so the existing
`margin: 0` was **dead code** and the link-ending card kept a 12px tail the `<pre>`-ending
cards did not have.

Fixed at the anchor rule, which owns *both* ends of the last child:

```css
.agent-card > .agent-card-example:last-child,
.agent-card > .agent-card-links:last-child {
  margin-top: auto;
  margin-bottom: 0;
}
```

Re-measured — gap below last child, per card:

| row | per-card gap | spread |
|---|---|---|
| 0 | 22.8 / 22.8 / 22.8 (`pre`, `pre`, `p`) | **0** |
| 1 | 22.8 / 22.8 (`pre`, `pre`) | **0** |

Every card's evidence block now sits on a common baseline whether it ends in a `<pre>` or a
`<p>`. Verdict: **FIX APPLIED**, layout only.

## S3 — Responsive behavior across breakpoints

Measured at each width. `docOverflow` = does the document scroll horizontally (the classic
responsive defect).

| width | `.agents-grid` | `.demo-split` / `.scenario-grid` | card rows | gap spread | nav rows | docOverflow |
|---|---|---|---|---|---|---|
| 1440 | 3-col (262.663×3) | `404px 404px` | 3 + 2 | 0 | 1 | no |
| 1027 | 3-col (267.275×3) | `410.913px ×2` | 3 + 2 | 0 | 1 | no |
| 987 | **2-col** (411.513×2) | `412.513px ×2` | 2 + 1 + 2 | 0 | 1 | no |
| 822 | 2-col (361.337×2) | **`740.675px` 1-col** | 2 + 1 + 2 | 0 | 1 | no |
| 770 | 2-col (337.425×2) | `692.85px` 1-col | 2 + 1 + 2 | 0 | 1 | no |
| 390 (device emulation) | **1-col** (350.4px) | 1-col | 1×5 | n/a | hidden | no |

Both new tiers engage where intended: the `max-width: 1000px` 2-col tier at 987, and the
860px demo/scenario collapse by 822. Card baseline spread stays **0** at every width where
cards share a row — the flex contract is width-independent, not tuned to 1440.

Note on method: a window resize clamps at 500px in this environment, so 390 was measured
with device emulation (`390x844x2,mobile,touch`), where `innerWidth` reports 421 but
`visualViewport.width` is 390 and the `max-width: 400px` tier is confirmed active. Reading
`innerWidth` alone would have mis-attributed which tier was being exercised.

### One flagged non-defect

At 822 a `<code>` element reports `right: 952`, past the 822 viewport. Traced to its
parent: a `<pre>` with `overflow-x: auto` that genuinely scrolls. The element is
**contained** — intended behavior for a fixed-width code sample — and the document itself
never scrolls sideways at any width. Recorded rather than "fixed" so a later reader does
not chase it.

Verdict: **PASS** at all six widths.

## S4 — Header nav after `/team` removal

`.nav-links` @1440 and @1027, 8 items, one row, no overflow:

```
Demo · Checks · Use · Trust · For agents · Limitations · GitHub · npm
```

Team is gone; the remaining links fit on a single row at every width where the nav is
shown, with no wrap and no clipping.

At ≤720px `.nav-links` is `display: none` (`styles.css:397-399`). This is **pre-existing**
and unrelated to the Team removal — verified by reading the rule, not inferred from the
measurement. It is not a dead end: the footer still exposes nine working links at mobile
(For agents · MCP security · Agent tool risk · Source · npm · CI demo · Security · Corpus ·
llms.txt), none of which is Team.

Verdict: **PASS**.

## S5 — Every served page, not just the homepage

The Team removal touched four files, two of them **generated**. Checking only the homepage
would have missed the generated pair, and hand-editing the committed HTML would have let the
next ingest restore the links — so the fix went into the renderers
(`renderAppCreated.ts`, `renderLookup.ts`) and the pages were regenerated from them.

All seven served pages fetched and parsed:

| page | status | `/team` hrefs | "Team" link text | dangling `·` |
|---|---|---|---|---|
| 404.html | 200 | 0 | 0 | no |
| agent-tool-risk.html | 200 | 0 | 0 | no |
| agents.html | 200 | 0 | 0 | no |
| claude-desktop-mcp-security.html | 200 | 0 | 0 | no |
| cursor-mcp-security.html | 200 | 0 | 0 | no |
| mcp-security.html | 200 | 0 | 0 | no |
| trust/app-created.html | 200 | 0 | 0 | no |
| trust/lookup.html | 200 | 0 | 0 | no |

The `danglingSep` column is not decoration: the removed links sat in `·`-separated runs, so
deleting a line without its separator leaves a visible orphaned `·`. Zero found.

`git diff --stat` on the regenerated pair was `2 files changed, 2 insertions(+), 8
deletions(-)` — only Team links and separators moved, which also proves the committed pages
were in sync with the renderers beforehand.

Verdict: **PASS**.

## S6 — The fault class is now observable

The `.topic-nav` defect survived because **no gate could see it**: browsers recover from
unclosed rules, the copy gates read text not structure, and the presentation lock measures
`apps/web/styles/tokens.css` — a different file. `apps/web/public/styles.css` was only a
token drift pin.

`scripts/check-web-structure.mjs` closes that: brace balance per served stylesheet,
stylesheet `<link>` resolution, and layout-contract classes defined in CSS. It names the
offending selector and line, so a structural break is never again diagnosed as a design
problem.

Brace counting is lexically aware on purpose — `content: "}"` and `/* } */` are legal CSS,
and one false positive is how a gate stops being enforced. Comments and strings are blanked
with equal-length whitespace so reported line numbers stay exact.

Wired into **both** `ci:local` and `.github/workflows/ci.yml`, closing the
`local-green/remote-blind` gap the workflow itself names.

Current run:

```
✓ apps/web/public/styles.css: brace-balanced (192 open / 192 close)
✓ all 7 local stylesheet link(s) across 7 page(s) resolve
✓ all 20 layout-class use(s) resolve to a CSS rule
Served web structure gate: PASS
```

Negative controls for this gate are recorded with the other WV controls in R7.

Verdict: **PASS**.

## S7 — Grid audit: no further defects

All seven fixed-column grids were checked for a responsive collapse, since a fixed-column
grid without one is the defect that produces sideways scroll on a phone:

`.ci-inner`, `.agents-grid`, `.agents-grid-3`, `.corpus-grid`, `.release-grid`,
`.demo-split`, `.scenario-grid` — all seven collapse. Every remaining grid uses `auto-fit`,
which self-collapses.

Verdict: **PASS** — no additional fixes needed.

---

## Summary

| section | verdict |
|---|---|
| S1 structural break (`.topic-nav`) | FIX APPLIED |
| S2 agent-card rhythm | FIX APPLIED (layout only) |
| S3 responsive, 6 widths | PASS |
| S4 header nav after Team removal | PASS |
| S5 all 7 served pages | PASS |
| S6 structure gate wired | PASS |
| S7 grid audit | PASS |

Two fixes, both structural. No copy shortened, no redesign, no new design system — the
constraint the stage was given.

### Not verified here

- Cross-browser rendering. All measurements are Chrome-only; no Firefox or Safari engine
  was exercised.
- Visual/aesthetic quality. This review proves the layout *contract* holds (baselines
  align, grids collapse, nothing overflows). Whether the result looks good is a human
  judgment it does not make.
- Real mobile hardware. 390 was device *emulation*, which does not reproduce
  platform-specific text metrics or scrollbar behavior.
