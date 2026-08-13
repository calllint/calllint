# ADR 0078: An unreachable override is dead config, not a byte change

**Status:** Accepted  
**Date:** 2026-08-13  
**Workstream:** P (presentation lock) · S0-OPEN-1 follow-up  
**Batch:** —

## Context

ADR 0077 unblocked `panel:validate`, and the CI leg advanced past the step that had been
exiting 1 since `1115639` (#234). That exposed the next red, which had never executed:
`ci.yml:118` (`pnpm audit:presentation`) and the three steps after it.

The reds were invisible, not absent. `main`'s own last run (`31665568117`, head `1115639`)
fails at **`Test`** — earlier still — so every step from `ci.yml:110` onward has been
unreached on `main` for the whole time. Four reds were queued behind two earlier ones.

| step | local result | cause |
|---|---|---|
| `audit:presentation` | EXIT 1 | drift: 19→25 counts and page list |
| `audit:presentation:gate` | EXIT 0 | — |
| `audit:presentation:lock` | EXIT 1 | drift, and one real fault below |
| `audit:presentation:lock:gate` | **EXIT 2** | `presentation lock: FAILED` |
| `audit:preview` | EXIT 1 | drift: 19→25 counts |
| `audit:preview:gate` | EXIT 0 | — |
| `gate:s0:regression` | EXIT 0 | — |

Two of the three drifts are counts only. Neither flips a verdict: in
`presentation-plane-audit.json`, `installPagesMissingRequiredHref` and
`installPagesWithForeignStylesheet` stay empty and `installPagesWithStylesheet` tracks
`installPagesTotal` at 25/25; in `preview-snapshot.json` the two changed leaves are
`servedPagesInZeroContainmentScope` 19→25 and a search denominator, with `pass: true`
unchanged. Those are regenerated.

The lock gate is different. It reports a **real** fault, for the **wrong rule**, with a
reason that is the opposite of what is true.

### The fault

`apps/web/content/safe-install/presentation.v1.json` carries exactly one resource override:

```json
"mcp-registry__io.github.calllint-calllint": {
  "displayName": "calllint-mcp",
  "reason": "Restates the shipped derived display name verbatim, so this entry exercises the override path without moving a served byte. …"
}
```

Its own `reason` states its purpose: exercise the override path while moving no byte. That
required its target page to exist. The 19→25 re-selection removed
`mcp-registry/io.github.calllint-calllint` — **the same absence** behind S0-OPEN-4 and behind
panel participant 10's stale response (ADR 0077). So the override now decodes to a slug that
matches no committed install page.

### What the gate says about it

`overrideNameFaults` (`scripts/presentation-lock.ts:351`) pushes two different world states
into one `faults` array:

```ts
const shipped = titleBySlug.get(slug)
if (shipped === undefined) {
  faults.push(`… decodes to slug …, which matches no committed install page — the override reaches nothing …`)
  continue
}
if (override.displayName !== shipped) {
  faults.push(`… but the committed page for ${slug} shows … — committing this would change served bytes`)
}
```

`overridesResolveToShippedNames` is `faults.length === 0`, and it is the last conjunct of
`resolvesToDefaults`. So either state produces one failure message:

```
resolves to copy that differs from the shipped code defaults — committing the catalog
would change served bytes, which ADR 0058 §4 forbids outside the single license already
spent by PR P-4b
```

For the second state that sentence is exact. For the first it is **false in the direction
that matters**: an override that reaches nothing cannot change a served byte. Measured:

| claim | measurement | result |
|---|---|---|
| the target page is served | `ls apps/web/public/install/mcp-registry/ \| grep -c io.github.calllint` | **0** |
| any served page shows that display name | `grep -rl 'Add calllint-mcp with CallLint' apps/web/public/install/` | **0 files** |
| served bytes moved | `git status --porcelain -- apps/web/public` | **empty** |
| the absence is the sole cause | retarget the override at a served page, same `reason`, `displayName` = that page's shipped title, rerun | **`PASSED`, EXIT 0** |

The last row is the negative control. Nothing else about the document is at fault.

## The classification error

This is ADR 0077's shape in a second place: one condition, two readers — except here both
readers are the *same* function, and the merge is what loses the information.

| world state | what is true of served bytes | correct rule |
|---|---|---|
| `displayName` ≠ the served page's title | committing **would change** bytes | ADR 0058 **§4** (byte-identity) |
| the key reaches no served page | committing **cannot change** any byte | ADR 0058 **§3** (a key that validates and then does nothing) |

§4 is *"Every Workstream P batch … must reproduce the committed served tree byte for byte."*
An override with no target cannot fail that. What it does fail is §3, whose subject is
exactly configuration that selects nothing — and the script already has that sentence, used
verbatim for `unwiredSlots` at line 512: *"a config key that validates and then does nothing
(ADR 0058 §3)"*. The dead-override case is the same failure and should say so.

Getting this right is not cosmetic. The two states demand opposite remedies: a §4 fault means
**do not commit the catalog**; a §3 fault means **the entry is dead — retarget or remove it**.
An operator reading the §4 text would go looking for a byte change that does not exist.

## Decision

### D1: `overrideNameFaults` returns classified faults, not strings

The function returns `{ key, slug, kind }` with `kind` one of `"unreachable"` (no served
page) or `"would-change-bytes"` (name mismatch). The message and the ADR section cited are
chosen per kind. Both remain **failures** — the gate's strength is unchanged, and
`resolvesToDefaults` still requires zero faults of either kind.

### D2: The dead override is retargeted, not deleted

The entry exists to exercise the override path (its `reason` says so), and deleting it would
silently retire that coverage — the lock would then pass with an *empty* override set, which
`overridesResolveToShippedNames`'s own docblock notes is the untestable case. It is retargeted
to a page the committed cohort actually serves, restating that page's shipped display name
verbatim, so it still moves no byte. `reason` is rewritten to state the retarget and why.

This is a change to a **config document**, not to served bytes: the reproducibility gate
(`committed-install-tree.test.ts`) must stay green and no file under `apps/web/public/` may
move. That is asserted in Verification.

### D3: Three artifacts are regenerated, and the diffs are NOT all count-only

`presentation-plane-audit.json`, `presentation-lock.json` and `preview-snapshot.json` are
regenerated. Reviewing them leaf by leaf falsified the "counts only" framing this ADR started
with, in two places worth recording:

**`presentation-plane-audit.json` — count-only, as claimed.** `pagesScanned` 59→71,
`installPagesWithStylesheet`/`installPagesTotal` 19→25, the four `overrideKeyability` leaves
19→25, and the page list swapping 3 removed subjects for 6 new ones (a re-selection, not
growth). `installPagesMissingRequiredHref` and `installPagesWithForeignStylesheet` stay `[]`.

**`presentation-lock.json` — counts, plus 13 digests that moved in COMMITTED bytes.** Beyond
the 19→25 leaves, `semanticContract.resources` shows a changed `contractDigest` and
`semanticContractDigest` for 13 slugs the cohort *retained*. That is not this branch: `1115639`
(#234) re-baked every sidecar, moving `generatedAt` 2026-07-17 → 2026-08-10 and the
`snapshotDigest` with it, so `expectedContractDigest` and the `calllint://` deep-link query
moved in the served pages at that merge. `git status --porcelain -- apps/web/public/` is empty
here; the artifact was simply last written at `84f56c5` (P-7) and had not been regenerated
since. `contentPlane.l1Digest` and `presentationDigest` move because D2 edits the document —
that is the intended effect of a catalog change, and D3's ledger entry is what records it.

**`preview-snapshot.json` — a real `pass: true → false`, and the remedy is a ledger entry.**
The 可回滚性 block requires the newest ledger entry to BE the live catalog. D2 changes the
document, so the newest entry (`84f56c5`) stops being current and two leaves go red. This is
the ledger working, not drift: `--record` refuses a catalog that differs from HEAD's
(`presentation-ledger.ts:415`), which fixes the order — **commit the catalog first, then
`pnpm ledger:presentation:record`, then regenerate the preview snapshot.** Three tests in
`presentation-ledger.test.ts` red on the same condition and go green with the entry.
`configVersion` is deliberately NOT bumped: nothing requires it to advance when the document
changes, only that it exists and reaches no served byte (`previewSnapshot.ts:1130`–`1211`).

### D4: The same shape, found a third time, in this ADR's own edit

Writing D2 tripped the defect D1 describes. The retargeted `reason` was 694 characters;
`usableCopy` caps a copy value at `MAX_COPY_LENGTH = 400` (`resolvePresentation.ts:428`) and on
failure does a bare `continue` (lines 527 and 809). Measured on a 402-character value — one word
over — the result is:

| observable | value |
|---|---|
| `rejectedSlots` | `[]` |
| `unwiredSlots` (resources) | `[]` |
| `failures` | `[]` |
| lock gate | `PASSED`, EXIT 0 |
| `overriddenSlots` | 46 → **45** — the only trace, and nothing asserts that number |

So a key that passes schema validation and then does nothing produced no fault: ADR 0058 §3's
subject, silent. The `reason` was shortened to exactly 400 so both override slots resolve and
`overriddenSlots` returns to 46 — the fix is the document, never the cap.

The inconsistency is worth naming precisely, because the machinery to report this already
exists and is simply not fed. `rejectedSlots` IS a lock failure, with wording that already fits
("the resolver fell back to the shipped value", `presentation-lock.ts:562`), and
`layout-manifest.test.ts:385` states the rule outright — *"falling back must never be silent"*.
Layout slots honor it via `capOrReject`; copy and override slots do not. `resolve-presentation.ts`'s
own test at line 357 feeds `"x".repeat(401)` and asserts only the runtime fallback (INV-P3
fail-open, correct) — never that the fallback was **recorded**.

**Not fixed in this batch, deliberately.** Routing `usableCopy` failures into `rejectedSlots`
changes the resolver's contract for six `mergeSlots` call sites and would make any over-long
committed value a hard lock failure. Measured: no committed catalog value is currently unusable
(0 strings empty, over 400, or containing `<`/`>`), so nothing is failing silently on `main`
today. Fixing it is a resolver change needing its own batch and its own negative controls;
scope-creeping it into a classification fix is how the merged fault in D1 got written. Recorded
here as the follow-up, with the measurement attached so the next batch does not have to rediscover it.

### D4a: The guard already existed and was never pointed at the shipped document

D4 shortened the value and filed the resolver change as the fix. Re-measuring found the cheap
fix first, and it is a better one, because it makes the fault **unwritable** instead of
**reportable after the fact**:

`schemas/calllint.presentation-content.v1.schema.json` already declares
`$defs.copyText.maxLength: 400`, and `overrides.resources.*.reason` already `$ref`s it. Ajv
rejects the 402-character document by name:

```
data/overrides/resources/mcp-registry__ag.hood-name-service/reason
  must NOT have more than 400 characters
```

So `MAX_COPY_LENGTH` was never the only reader of the bound — the **shape layer** owns it, and
it works. What was missing is that nothing ever fed it the **live catalog**. Measured over
`presentation-content.test.ts`: 14 `validateSchema(...)` call sites, **all 14 synthetic**.
`liveCatalog` is read at line 45 and reaches only `configVersion`'s type and
`validatePresentationContent`, whose docblock (line 326) states it is deliberately *not* a JSON
Schema re-implementation and therefore checks no length. Two layers, each correct, and the
shipped document graded by only the one that cannot see the bound.

This is the same shape a third time, in its own third form: not a merged string (D1), not a
dropped value (D4), but **a working check with no path from the artifact to it**.

Fixed by two assertions, in the file that already owns the schema boundary:

| assertion | claim |
|---|---|
| `validateSchema(liveCatalog)` is `true` | the shipped document satisfies the bounds layer |
| the same document with `reason` at 401 is `false`, and `rulesFor(...)` is still `[]` | the guard has a failing mode, **and** the value layer genuinely cannot catch it |

The second is the control: without it the first could hold because Ajv checks no length. It
derives the offender from the real catalog rather than hand-building one, so it cannot pass by
testing a document the repo does not ship. Verified: 39 tests pass; with two characters appended
to the committed `reason`, exactly the new assertion fails and prints the field and the bound.

**Consequence for the resolver follow-up: it is now a defence-in-depth cleanup, not a
correctness gap.** An over-long value can no longer be committed silently. Routing `usableCopy`
into `rejectedSlots` still has value — it would catch a value that reaches the resolver from a
non-committed path — but the urgent hole is closed at the door rather than by a report.

**And the honest limit on the 400 question.** If a `reason` ever genuinely needs more than 400
characters, the answer is neither raising the cap nor writing to 400 exactly. `reason` reaches
**no served page** (measured: 0 hits under `apps/web/public/`) and appears in
`presentation-lock.json` only as a slot **path**, never as its text — so a long rationale has no
consumer that renders it. Prose that long belongs in the ADR, with the entry pointing at it. The
cap is not a limit being fought; it is a signal that the text is in the wrong file.

### D5: What is NOT decided here

- **The absence itself is not fixed.** `mcp-registry/io.github.calllint-calllint` is still
  outside cohort 25 and only a re-ingest restores it. S0-OPEN-4 stays open, and D2 does not
  paper over it — the retarget is recorded in the entry's `reason`.
- **Gate 2.4-B stays PENDING_HUMAN_PANEL.** Unrelated to this ADR; see ADR 0077.
- **No served byte is edited**, so §4's spent P-4b license stays spent.

## Verification

Negative controls, each red on its own claim:

1. Retarget the override at a served page but change one character of the display name →
   the `would-change-bytes` fault fires with the §4 text. Proves the §4 path still exists and
   is reachable.
2. Point the override at an unserved slug → the `unreachable` fault fires with the §3 text,
   and the §4 text does **not** appear. Proves the split is real and not a relabel of both.
3. Empty the override set → the lock passes, confirming the entry is the only override and
   therefore that D2's retarget (not deletion) is what preserves the coverage.
4. `git status --porcelain -- apps/web/public` after all changes → empty. Proves no served
   byte moved.
5. Append one word to the retargeted `reason` (400 → 402 chars) → the slot vanishes from
   `overriddenSlots` while `rejectedSlots`, `unwiredSlots` and `failures` all stay empty and
   the gate stays EXIT 0. Proves D4's claim that the skip is silent, rather than asserting it.
6. (D4a) The same 402-character document through **Ajv** → rejected, naming the field and the
   bound. Proves the bound has a working reader, so D4's "the fix is a resolver change" was
   incomplete: the fix is to point the existing reader at the shipped document.
7. (D4a) The new live-catalog assertion, with two characters appended to the committed `reason`
   → exactly that assertion fails (38 pass / 1 fail) and prints
   `…/reason must NOT have more than 400 characters`. Proves the guard has a failing mode.
8. (D4a) The same mutated document through `validatePresentationContent` → `[]`. Proves the
   value layer cannot catch it, so the new assertion is not redundant with an existing one.

All eight were run. Results: 1 fires §4 naming both values · 2 fires §3 with no §4 text · 3
`PASSED` EXIT 0 · 4 empty · 5 silent as described · 6 rejected by name · 7 red on the new
assertion alone · 8 `[]`, confirming the layer split.

Required to pass unchanged: `pnpm test`, `pnpm typecheck`, and every `ci.yml` step from
`eval:phase-2.4` through `gate:s0:regression`, plus `pnpm gate:s0:gate` (EXIT 0, cohort 25/25).

Ordering, forced by `--record`'s refusal to record an uncommitted catalog: typecheck and the
suite run first (3 `presentation-ledger.test.ts` reds are EXPECTED at this point, all on
"the catalog changed without a ledger entry"), then the catalog and code commit, then
`pnpm ledger:presentation:record`, then `pnpm audit:preview:write`, then the suite again — at
which point those 3 reds must be green and the count must be 3779 passed / 0 failed.

## Consequences

- The four queued reds clear, and a CI leg that has not reached its own second half since
  `1115639` runs end to end again.
- The lock gate now names the rule it is actually enforcing, so its message tells an operator
  which of two opposite remedies applies.
- The general lesson, and it is ADR 0077's twice over: when one function collects several
  world states into one list of strings, the list is where the classification is lost. Here the
  merged message asserted a byte change that measurement showed **could not happen** — and it
  was invisible for as long as it was queued behind an earlier red. A red that never executes
  is not a passing check.
- D4 is the sharper version of the same lesson: the ADR written to fix a misclassified fault
  **committed a silent one in its own edit**, and the only witness was an unasserted count.
  Losing a world state does not require merging strings — dropping the value on the floor
  (`continue`) does it too, and leaves even less behind. Both call sites had a working reporting
  channel (`rejectedSlots`) sitting one line away, unfed.
- D4a is the lesson's fourth form, and the cheapest to miss: the bound had a **correct reader
  that worked**, and the shipped document had no path to it. 14 of 14 `validateSchema` call
  sites were synthetic. Before writing a new check, ask which layer already owns the rule and
  whether the real artifact is fed to it — "add a guard" was the wrong first instinct here, and
  D4 recorded it as the plan.
- Carried follow-up, now **defence-in-depth rather than a correctness gap** (D4a closed the
  hole at the door): route `usableCopy` failures into `rejectedSlots` for the six `mergeSlots`
  call sites and the override loop, with a negative control per call site. It would still catch
  a value arriving from a non-committed path, which the schema assertion cannot see.
