# ADR 0076: Detector identity gap — two existing second sources, never read by name

**Status:** Accepted  
**Date:** 2026-08-09  
**Workstream:** S (adoption-index, ongoing)  
**Batch:** S7

## Context

`project-facts.json` publishes `capabilities.detectorCount: 13`, machine-derived by
`scripts/derive-facts.mjs` and guarded in CI by `pnpm facts:check`. Four readers existed,
and **all four read only the count**:

| reader | what it does |
|---|---|
| `scripts/derive-facts.mjs:38` | counts `export { detectXxx }` lines in `packages/static-analyzer/src/index.ts` |
| `tests/facts/deriveFacts.test.ts:38` | **re-runs the same regex on the same file** and asserts `facts.detectorCount === names.size` |
| `tests/facts/deriveFacts.test.ts:54` | negative path: `+100` on a temp copy, asserts non-zero exit |
| `packages/static-analyzer/test/readmeDetectorTable.test.ts:52,62` | `rows.length === DETECTORS.length` and the count-in-words — **never the row contents** |

The second row exhibited the defect class `[[audit-keyed-on-its-own-subject]]` (S4) at
one layer weaker — S4's MCP case had two separate files (one text-scanned, one runtime),
whereas this compared a file to itself using the same regular expression. A rename moved
**both sides together**, making the assertion unfalsifiable by construction.

This was discovered while tracing S5's eviction hazard (when the detector count passes 25,
which detector name gets removed?). Census of 349 count-only assertions surfaced
`detectors.test.ts` (44 count / 0 set), and a rename probe confirmed the gap: changing
`detectOauthScope` → `detectTotallyDifferentThing` kept `detectorCount === 13` while the
name set drifted. **11 finding ids already in served bytes** (`apps/web/public/**`) could
drift silently — their presence is a second claim never guarded.

## Measurement

**Two hand-written second sources already existed, and both were correct — nothing read
their names:**

| candidate second source | covers | read by name? |
|---|---|---|
| README `## What it checks` table, first cell | all 13 detector names | **no** — only `rows.length` |
| `REASON_CODE_META[*].backedBy` in `packages/types/src/reasonCodes.ts` | 14 of 15 finding ids | **no** — only "non-empty" |

Probe on the README confirmed the 13 names were **set-equal** to
`DETECTORS.map(d => d.name)` (minus the `detect` prefix, case-insensitive) and had been
all along. Order differs — the table groups by risk symbol — so the assertion must be
**set equality, never sequence**.

Two corrections to earlier measurement, both range errors:
1. **15 finding ids, not 14.** The initial scan covered only `src/detectors/*.ts`;
   `documentSurface.ts` sits at `src/` root and emits `prompt.surface-instructions`.
   It is invisible to all four count readers because `analyzeDocumentSurfaces` does not
   match `export { detectXxx }`.

2. **`packages/calllint-mcp/src/data/` carries zero ids** (it holds
   `adoption-contracts.json` + `lookup-index.json`). 11 ids appear under
   `apps/web/public/**`, but 19 of those files are *registry scan snapshots* —
   observations, not declarations — and `report-schema.md` names only **3** ids as `e.g.`
   examples. **No id全集 exists in served bytes**, so a "served subset" assertion would
   pin examples as contract.

## The second defect (found while measuring the first)

`prompt.surface-instructions` is emitted, documented in README:367, asserted in 4 test
files, and reaches CLI output — but **no reason code backed it**. `reasonCodes.ts`
mentions surface/document **zero** times, so this was an oversight, not an exemption.

The existing readers (`new4-contracts.test.ts:56`, `previewSnapshot.ts:355`) checked only
that `backedBy` was non-empty and that every code had meta — **all read from the
vocabulary side**, so a new detector id could never enter their view. The mirror of
`[[a-guard-importing-one-of-two-copies]]`: the direction of the read decides what is
observable.

行为后果是真实且可测的:`findingsToReasonCodes` (`:17` `if (code) present.add(code)`)
**静默丢弃**未映射 id。So a `prompt.surface-instructions` hit (model-directed content
in README, REVIEW level) leaves **no trace** in `reasonCodes[]`. And `reasonCodes` is
ADR 0020's *"public language consumed by agents, CI gates, badges, and the website"*.

Blast radius:**服务字节(`adoption-contracts.json` 的 `publicObservation.reasonCodes`)
+ web 呈现("What this scan hit"小节)+ MCP 资源 + agent relay 判断**. A
`prompt.surface-instructions` hit leaves no trace in all these surfaces, though its
finding remains in `findings[]`.

Semantically, `documentSurface.ts:17` explicitly states it reuses **the same scanners**,
`symbol: "PROMPT"`, same phenomenon as `prompt.poisoning` / `prompt.hidden-instructions`.
ADR 0020 says reason codes are *"a PROJECTION of findings"*; *"detector-internal finding
ids split/merge as detectors evolve"* — this is a split: the same phenomenon on two
surfaces.

So the correct shape is **merging into `PROMPT_METADATA_INSTRUCTION.backedBy`**, not
adding a 14th public code. This does not move `REASON_CODES`' 13 codes, does not touch
the frozen order, is not a schema change.

`backedBy` also legitimately holds two non-detector sources (`drift:toolMetadataHash`,
`flow:toxic-composition`); any reverse assertion must exclude them explicitly.

## Decision

Read the two existing second sources **by name**, in the **reverse** direction
(detector → vocabulary), and resolve the unbacked id:

### D1: Read README table names, assert set equality with DETECTORS

Added `packages/static-analyzer/test/readmeDetectorTable.test.ts:66-93`. Reads the
table's first cell (backticked), removes `` ` ``, lowercases, compares with
`DETECTORS.map(d => d.name.replace(/^detect/i, '')).map(s => s.toLowerCase())` as
**set equality** (order-free). Reuses the existing `detectorTableRows` helper. The
pre-existing `rows.length` case stays — it is weak, but it was the first historical guard
and should not be removed while strengthening it.

### D2: Reverse-direction id guard — every emitted id is backed

Added `packages/types/test/new4-contracts.test.ts:93-124`. Scans
`packages/static-analyzer/src/**/*.ts` (not only `detectors/`) for all `id: "xxx"`
literals, compares with the union of `REASON_CODE_META[*].backedBy`. **Explicitly
excludes** `drift:toolMetadataHash` and `flow:toxic-composition` (they are legitimately
non-detector).

Also corrected the `:70` case title from *"maps all 13 detector finding ids correctly"*
to `"maps all wired detector finding ids"` — title claimed 13, table had 14 rows.

### D3: Back `prompt.surface-instructions`

`packages/types/src/reasonCodes.ts:92-98`: `PROMPT_METADATA_INSTRUCTION.backedBy` from
`["prompt.hidden-instructions", "prompt.poisoning"]` to three-element:
`["prompt.hidden-instructions", "prompt.poisoning", "prompt.surface-instructions"]`.

No new reason code added; no comment added (the existing *"Phase 2 (ADR 0021/0022/0023):"*
line points to the three cases above it, not this one).

## Verification

### Negative controls (each red on its own claim)

**C1: Rename detector, README fixed** — `detectOauthScope` → `detectTotallyDifferentThing`
(+ sync `index.ts` export + `DETECTORS` array). README **not changed**. D1's new case red:
*"README lists \"oauthscope\" but DETECTORS does not have it"*. Rollback md5-identical, D1
green.

**C2: Emit new id, not backed** — `oauthScope.ts:57` `"auth.oauth-scope"` →
`"auth.totally-new-id"`. `REASON_CODE_META` **not changed**. D2 red: *"Finding id
\"auth.totally-new-id\" is emitted but not backed by any reason code"*. Rollback
md5-identical, D2 green.

**C4: Rename the id in `documentSurface.ts` — the `src/` ROOT file** — added during
pre-merge self-check. C2 mutated only a file in `src/detectors/`, so it never proved the
scan reaches the root, where the file D2 exists for actually sits — the shape
`[[a-fixture-corpus-that-avoids-the-key-space]]` describes. Red: *"Finding id
\"prompt.surface-renamed\" is emitted but not backed"*. Re-run after the dependency
rewrite below, still red. Rollback md5-identical.

**C5: Point the scan at `src/detectors/` only** — red on its own message: *"scan must reach
src/ root, not only src/detectors/"*. Confirms the non-vacuity guard is itself falsifiable.

### The defect self-check found

D2 as first written called `glob.sync`. `packages/types` declares **zero** dependencies by
design (it is the schema source of truth), and `glob` resolved locally to
a `node_modules/glob` in the repo's **parent** directory — outside the repo, an accident of this
machine. A fresh CI install has no such parent, so the require would have thrown. This is
the class `[[shipped-with-no-caller-hides-degenerate-inputs]]` warns about, arriving through
module resolution rather than a caller: passing locally proved nothing about CI.

Rewritten with `node:fs` only (`readdirSync` recursion), and the CJS `require`/`__dirname`
forms switched to ESM imports (the file is ESM; they worked only via vitest's transform).
Two non-vacuity assertions added, since the rewrite could have silently scanned nothing:
`documentSurface.ts` must be among the scanned files, and `emittedIds.size > 10`.

### Outcomes

- typecheck clean
- 226 / **3752** | 1 skipped (+2 new cases: D1 + D2)
- **Phase 2.4 five gates** PASS in sync: `mcp-artifact-claims` ✓ · `mcp-tool-identity` ✓ ·
  `adoption-index-unreachable` ✓ · `new4-default-path` ✓ · `pnpm facts:check` EXIT 0
- **Gate S0** five assertions ✓: ratchet floor 19 held; `⚠️ would fail` because 19<25,
  not because a claim red
- `git diff apps/web/public packages/calllint-mcp/src/data` **empty** — zero CR on both
  sides (D3 changed projection logic, not committed snapshots)

## Consequences

**14 finding ids now have name-level guards** — a rename cannot keep 13 while their set
drifts. The 15th (`prompt.surface-instructions`) is now backed by a reason code, so a
surface-instruction hit leaves its expected trace in `reasonCodes[]`, served bytes, web
presentation, and agent relay judgments.

Four negative controls confirm falsifiability: C1 reds when the README drifts, C2 when an
unbacked id is emitted from `src/detectors/`, C4 when one is emitted from `src/` **root**,
and C5 when the scan itself is narrowed to miss that root. C4 and C5 came from the
pre-merge self-check, not the plan — the plan's two controls both happened to mutate
subdirectory files, which would have left D2's actual subject unexercised.

**Next.** ADR **0077** (0060 still reserved). Memory: the detector-count candidate marked
CLOSED, title from "next batch's candidate" to "closed by S7".
