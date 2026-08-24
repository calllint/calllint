# Discovery → Conversion review, for the three AVAILABLE surfaces

- **Date:** 2026-08-24
- **Asked by:** new20 §13, which names the four legs verbatim: *Discovery: Can user find
  CallLint? · Installation: Can user install? · First action: Can user run first scan? ·
  Trust: Can user understand — no execution, deterministic, evidence-based.*
- **Subject:** the 3 channels the SSOT records as `state: AVAILABLE`, out of 31 total.
  Measured against `apps/web/data/distribution-surfaces.json` at
  `generatedAt: 2026-08-19T00:00:00.000Z` and the projections generated from it.
- **Location note:** §13 asks for this at `docs/architecture/DISCOVERY_CONVERSION_REVIEW.md`.
  `docs/` is gitignored repo-wide — deliberately, as local-only planning notes — so a review
  written there would never reach the repository or any reviewer. It lives under
  `artifacts/architecture/` instead, alongside the tracked ADRs it cites. Same filename, same
  content, a path that is actually version-controlled.

## The cohort

| host | kind | supportClass | evidence arm | `truthfulCommands` |
|---|---|---|---|---|
| `claude-code` | `mcp-stdio` | `NATIVE` | `upstream: officialMcpRegistry` | 1 |
| `claude-desktop` | `mcp-stdio` | `NATIVE` | `upstream: officialMcpRegistry` | 1 |
| `cline` | `mcp-stdio` | `DISCOVERY_ONLY` | `upstream: officialMcpRegistry` | 0 |

All three satisfy HD-07 through the Registry arm; none carries a `liveUrl`. That matters for
reading the rest of this document: `AVAILABLE` here is a claim about **the Registry listing**,
not about whether CallLint auto-discovers that host's config file. HD-07's two arms are
independent, and `cline` is the case that separates them.

## Leg 1 — Discovery: **passes, 3/3**

Each of the three appears in every discovery projection: `agent-discovery-index.json`,
`agent-surfaces.json`, `harnesses/sitemap.xml`, and `llms.txt`. Measured per host rather than
in aggregate, because an aggregate count cannot distinguish "all three present" from "one
present three times".

Guarded, not merely observed: `check-agent-surface` fails when a host's canonical URL is
absent from the sitemap, and the index's own `counts.total` is cross-checked against the
number of unique surface ids.

## Leg 2 — Installation: **passes, 3/3**

`officialMcpRegistry.state` is `LIVE`, and liveness is read back from the live Registry by
`scripts/verify-registry-presence.mjs`, which fails closed. This leg is the one whose evidence
comes from outside the repository, which is why it is checked weekly rather than per-PR.

## Leg 3 — First action: **passes 2/3. `cline` publishes no command.**

`claude-code` and `claude-desktop` each publish an install command and a host-specific verify
command, resolved at generation time from `activation.installRef` against
`project-facts.json`. `cline` publishes neither: its `truthfulCommands` is `[]` and it has no
`installRef`, so the host-page template's `{{#if activation.installCommand}}` guard emits no
"How to start" section at all.

**This is disclosed, not hidden**, and it is the correct behaviour rather than a data defect:

- The page states the boundary in its own words — *"CallLint does not yet auto-discover Cline
  configuration"* — and `activation.whyHere` explains why the host is listed anyway.
- The template comment records the intent: a guide-only page *"prints no start path at all
  rather than a plausible one — the honest counterpart to its 'Guide only' label."*

So the funnel has a real gap at this leg for `cline`, and the gap is honest. It closes when
Cline config discovery is implemented, not by writing copy. `cline` is the only host in the
repository that is simultaneously `AVAILABLE` and command-less; the asymmetry is a consequence
of HD-07's two arms coming apart, which is exactly what that design permits.

## Leg 4 — Trust: **fails on all 18 host pages, including all 3 AVAILABLE ones.**

This is the review's one new finding, and it is structural rather than editorial.

### What was measured

Searching each host page for the three concepts §13 names, with patterns broad enough to catch
equivalent wording (`never runs|never executes|does not run|does not execute|without
running|without executing|static-only|statically analys|no execution`, and
`determinist|reproducib`):

| concept | host pages asserting it (of 18) |
|---|---|
| no execution | **0** |
| deterministic | 0 (2 raw hits, both incidental — see below) |
| evidence-based | 9 (10 raw hits, one incidental) |

The two determinism hits are `opencode` and `continue`, and neither is the trust claim: both
are SSOT coverage-boundary prose about CallLint's *extractor* ("Schema generation ambiguity
must be handled deterministically", "a deterministic extractor must read both shapes"). The
tenth "evidence" hit, on `roo-code`, is likewise prose about *config* evidence not being
collected — the opposite of the claim, on a page that carries no verdict paragraph at all.
Counting raw matches would have scored all three as passes.

### Why the number is 0, and why it is not a wording problem

The verdict-semantics paragraph — the only place a host page explains what a verdict does and
does not mean — sits **inside** the `{{#if activation.installCommand}}` block in
`scripts/templates/host-page.hbs`. The correlation is exact across all 18 pages: the 9 hosts
with an `installRef` carry the paragraph, the 9 without do not (zero mismatches). So the trust
copy is coupled to the install command, and a host loses its safety framing as a side effect of
not having a start path — the hosts that need the framing most lose it.

Even on the 9 pages that do carry it, that paragraph covers `SAFE` semantics and
`UNKNOWN`-never-upgrades. It does not assert no-execution or determinism. Those two concepts
appear on the homepage (5 and 5 hits) and in `llms.txt` (2 and 3), so the *site* makes the
claim; no *host page* does.

### Why no gate caught this

`project-facts.json` already carries the governed sentence — `headlines.trustLine`: *"Offline
by default. Deterministic. Never executes the server it judges. SAFE means no blockers
observed, not guaranteed safe."* — and `requiredPhrases` includes *"Never executes the server
it judges"*. Two reasons it never reached these pages:

> The sentence quoted above is the value **as measured**; its final clause now reads *"not a
> proof of runtime safety."* Rendering it verbatim is what exposed the old ending as a
> `forbiddenPhrase` collision — see **Resolution**.

1. **`trustLine` has no consumer.** Repo-wide, the string `trustLine` appears in
   `project-facts.json` and nowhere else — no script, template, test, or page reads it. It is a
   fact with no reader.
2. **The copy gate cannot see host pages, and joins its corpus anyway.**
   `scripts/check-public-copy.mjs` discovers served files at **depth 1** of
   `apps/web/public/`, so `harnesses/*/index.html` is outside its corpus entirely — measured:
   23 files in the corpus, none under `harnesses/`. And its required-phrase check runs against
   `allText` — every governed file concatenated — so **one** occurrence anywhere satisfies the
   phrase for the whole site. Both properties are documented choices with good reasons (the
   depth limit exists because `trust/**` has a stricter corpus of its own), and together they
   mean 18 generated pages can omit every safety phrase while the gate prints a checkmark.

   **Negative control, so this is not merely a reading of the source.** Replacing the sole
   occurrence of "never executes" in `llms.txt` with a placeholder and re-running the gate:
   it printed `✓ all required safety phrases present` and exited 0. The homepage's copy
   satisfied the phrase on the redacted file's behalf. The tree was restored byte-for-byte
   (md5 verified) afterwards.

This is the repo's dominant fault class in its usual shape: a guard that cannot observe its
subject. The gate is not wrong about what it checks; its corpus does not contain the pages
this leg is about.

## Verdict

| leg | claude-code | claude-desktop | cline |
|---|---|---|---|
| Discovery | pass | pass | pass |
| Installation | pass | pass | pass |
| First action | pass | pass | **no command published** (disclosed) |
| Trust | ~~fails~~ → pass | ~~fails~~ → pass | ~~fails~~ → pass |

Three of four legs hold for two of three surfaces. The chain new20 closes with —
真实性 → 可发现 → 可安装 → 可测量 — is intact through installation for all three.

> **The trust row was measured as failing and is now fixed.** Everything above this line is the
> original measurement, kept in the past tense on purpose: it is the evidence for *why* the fix
> is shaped the way it is, and a measurement document that edits its own findings once they are
> addressed destroys the record of what the defect actually was. See **Resolution** at the end
> for what changed, and for the negative controls that establish the new gates have teeth.

## What this review does not do

It does not change the template, the SSOT, or any projection. Two candidate fixes exist and
both are follow-on work, deliberately not bundled into a measurement document:

1. **Move the trust paragraph out of the `installCommand` guard** and render `trustLine` from
   `project-facts.json` on every host page. That gives `trustLine` its first reader and makes
   the three concepts unconditional. It regenerates all 18 pages, so it needs the drift gate
   and a fixture that fails if the paragraph goes back inside a conditional.
2. **Extend the copy gate's corpus to the harness pages, per-file rather than joined**, for the
   safety phrases specifically. Per-file is the point: a joined corpus is what made this
   invisible. This one has teeth immediately — it fails on the current tree until fix 1 lands,
   which is the correct order (guard demonstrably red, then green).

Neither is speculative scope: §13 asks whether the user *can understand* the three properties
on an AVAILABLE surface, and today the answer is no on every one of them.

`cline`'s missing first-scan command is **not** on that list. It is a real gap with an honest
disclosure, and the fix is implementing Cline config discovery — a scanner change, outside
this review's plane.

## Resolution (2026-08-24)

Both fixes landed, in the order this document specified.

**Fix 1 — the framing is unconditional.** `host-page.hbs` gained a `#trust` section that no
`{{#if}}` encloses, and the generator now reads `headlines.trustLine` and passes it to the
template, which renders it verbatim. The generator **throws** if the field is absent rather than
falling back to a literal: a fallback would make it a second, unaudited author of the claim,
which is the `--config`-shaped defect the `installRef` indirection exists to prevent.

`trustLine` itself had to change first. Rendered verbatim, its old ending — *"…not guaranteed
safe."* — planted the `forbiddenPhrase` **"guaranteed safe"** on 18 pages, because check 2 is a
naive substring match and cannot see that the sentence negates it. The homepage had silently
diverged to *"not a proof of runtime safety"* instead of reconciling the governed field, so the
field was aligned to the homepage. It now trips 0 forbidden phrases and carries 3 required ones.

Measured after regeneration: `Never executes the server it judges` 18/18, `Deterministic` 18/18,
`Not a proof of runtime safety` 18/18, `id="trust"` 18/18. `#start` still 9 — the conditional
half is intact, so the coupling broke without collapsing the guard.

**Fix 2 — two gates, deliberately non-redundant.**

- `check-public-copy.mjs` **check 25** walks `harnesses/**` recursively and asserts each clause of
  `trustLine` **per host page**. It excludes the hub and the `deepseek/` model-intent landing page
  (not a host page; its "offline by default" hit is a feature bullet), and asserts cohort size
  ≥ 10 and a ≥ 3-clause split *before* asserting anything about contents, so a collapsed scan reds
  instead of passing.
- `activation-contract.invariants.test.ts` gained a `new20 §13` block pinning the **structure**:
  the `#trust` section's conditional nesting depth must be exactly 0.

Both are needed, and one control proves it. Re-nesting `#trust` inside `{{#if displayName}}` — a
condition true for all 18 hosts — left every page's text unchanged, so **check 25 stayed green
(rc=0)** while the structural test failed. A gate reading the output cannot see fragility
reintroduced upstream of it; the next host entering with a falsy condition would ship bare.

### Negative controls

Every gate was made to fail for its own reason, then restored and verified byte-exact by md5.

| control | result |
|---|---|
| pre-fix-1 template restored (`git show HEAD:`), regenerate | check 25 **rc=1**, naming all 18 pages and all 4 missing clauses |
| one clause removed from **one** page (`kiro`) | **rc=1** naming exactly that page and that clause — the per-file property; a joined corpus passes this |
| cohort collapsed to an empty dir | **rc=1** on the anti-vacuity floor, with 43 other checks still green — only check 25 reacted |
| `headlines.trustLine` deleted | generator **throws**, and check 25 reds independently — both planes refuse |
| `#trust` re-nested under an always-true condition | copy gate **green**, structural test **red** (see above) |
| `depthOfSection` stubbed to always return 0 | the `#start` control **reds** — the walker cannot be silently broken |

One assertion in the new block was itself wrong on the first run: it read the raw template and
failed on the phrase appearing inside a `{{!-- --}}` docblock that explains the template must not
author it. A comment is not a published string; the assertion now strips comments, as
`depthOfSection` already did. Recorded because it is the same failure mode this file's
`resolveActivation` probe carries a warning about — a probe searching the wrong text.

### Verification

`pnpm test` 255 files / 4756 passed / 1 skipped (+5), `typecheck`, `check:distribution-drift`
(31 generated files tracked, byte-for-byte), `check:agent-surface`, `check:harness-distribution`,
`check:public-copy` — all rc=0.

### Still open

`cline`'s missing first-scan command, unchanged and still honestly disclosed — it needs Cline
config discovery, a scanner change outside this plane.
