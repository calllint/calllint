# A redaction mounted on a path production had already retired

- **Date:** 2026-09-08
- **Branch:** `feat/new22-cursor-authority-boundary-v2`
- **Trigger:** scheduled `trust-ingest` failed again — the 2026-08-31 and 2026-09-07 runs
- **Amends:** [ADR 0096](../../adrs/0096-an-isolation-seam-that-did-not-isolate-and-a-pii-free-claim-over-unfiltered-text.md) §D2 and one of its Consequences

## The claim that was false when it was written

ADR 0096 (2026-09-01) added `redactPii` and recorded the consequence as:

> No email-like token can reach a served page through an upstream description.

Six days later `check:public-copy` failed the ingest on exactly that, with `redactPii` present in
the tree at the failing commit:

```
✗ Safe-install PII (email-like) in
  apps/web/public/install/mcp-registry/ai.byteray-byteray-mcp/index.html: "hi@byteray.ai"
✓ no PII (email-like) across 805 Trust Page file(s)     ← same run, same regex, passed
```

The guard is symmetric — check #17 and #17b use a byte-identical regex and an identical loop — so
the asymmetry was never in the guard. It was in which path produced the bytes.

## Root cause

`redactPii` was placed on `toSnapshotEntry`, inside `fetchRegistrySnapshot`. **Production has no
callers of that function.** Measured:

```
grep -rn 'fetchRegistrySnapshot' --include=*.ts .   → 13 hits, every one a test or a comment
```

What actually writes the committed snapshot is `refreshSnapshot.ts:717-719`:

```ts
const snapshotText = mirrored.snapshotText          // ← from refreshFromMirror, i.e. adoption-index
writeFileSync(SNAPSHOT_PATH, snapshotText, "utf8")
```

and on that path there was no redaction at all: `officialRegistry.ts:236` stores the upstream
description verbatim, `snapshotProjection.ts:83` projected it straight out. `grep -rn
'redact\|EMAIL' packages/adoption-index/src` returned nothing.

So the fix was real, correct, and installed on the retired path. ADR 0096 names the repo's
standing fault class — *a guard that cannot observe its subject* — two paragraphs before shipping
an instance of it.

## Why nothing caught it for a week

`packages/adoption-index/test/snapshot-projection.test.ts` byte-compares the two implementations
over one raw body. That control **should** have redded on 2026-09-01: one side began redacting and
the other did not, so the bytes had to diverge.

It stayed green because **none of its six fixture descriptions contained an address.** The two
paths agreed about descriptions vacuously — they would have agreed with no redaction anywhere, or
with redaction on one side only.

And `registry.test.ts:130`, the test written *for* the redaction, asserts against
`fetchRegistrySnapshot`: the dead path. It was green through both failed ingests.

Locally the defect was masked a third way: the committed snapshot reads `[contact redacted]`
because it is the artifact of the 2026-08-27 successful `workflow_dispatch`, not the output of
current code. `check:public-copy` reads committed served bytes, so it passes on this machine
regardless. **Its local green is not evidence for this fix** — the projection test and the
negative controls are.

Every `schedule` run failed and every `workflow_dispatch` run succeeded, which reads like a
trigger-permissions problem and is not: dispatch runs happened to precede the cohort admitting
`ai.byteray/byteray-mcp`.

## Changes

| file | change | why here |
|---|---|---|
| `packages/adoption-index/src/projections/snapshotProjection.ts` | `redactPii` + `EMAIL_LIKE`, applied at `toEntry`'s `description` | the projection is what `refreshSnapshot.ts:717` writes. Redacted at the projection, not the store, so the mirror keeps the upstream bytes it was given — `payloadDigest` is computed over the raw item |
| `packages/adoption-index/test/snapshot-projection.test.ts` | one fixture carries the real upstream string; counts 6→7 / 3→4; two new cases | supplies the subject the control could not previously see |

A **fourth** copy of one regex, matching the deliberate policy the third copy already records:
each defends a different plane, and a shared import would let one edit silently retire all of
them. This package has zero imports of `trust-index` and an import-boundary gate keeps it that
way, so an import was not available even had it been wanted.

The two new cases defend different failures. Byte-equivalence reds when *one* side redacts; it
stays green when **neither** does — which is precisely the state that shipped. So the PII case
asserts the absolute property (no address in the projected bytes) on the path production runs.

## Verification

| gate | result |
|---|---|
| `snapshot-projection.test.ts` | 12/12 |
| `pnpm test` | 277 files, **5684 passed**, 1 pre-existing skip |
| `pnpm typecheck` / `pnpm build` | EXIT 0 |
| `verify-security-semantic-diff.mjs` | `SECURITY_SEMANTICS = UNCHANGED`, 0 diff across 6 verdict packages |
| `check:public-copy` | PASS — **but see the masking note above** |
| `check:web-structure`, `check:harness-distribution`, `check:agent-surface`, `check:security-semantics`, `check:distribution-drift` | EXIT 0 |
| `corpus:test` | all contracts hold, toxic-flow failures 0, UNKNOWN ratio 10.0% |

### Negative controls — 5/5 red, restores `cmp`-identical

| # | mutation | intended red | observed |
|---|---|---|---|
| NC-P1 | remove the projection redaction (**re-introduce the shipped defect**) | PII case | red, `failed=3` |
| NC-P2 | same mutation | byte-equivalence case | red, `failed=3` |
| NC-P3 | marker drifts to `[redacted]` | PII case | red, `failed=3` |
| NC-P4 | widen the regex to eat every `@` token | **the negative arm** | red — `load-bearing negative` named in the output |
| NC-P5 | remove the address from the fixture | PII case | red, **`failed=1`** |

NC-P5 is the one worth reading twice. With the address gone, the byte-equivalence case goes back
to **green** while the pipeline would still leak — the exact 2026-09-01 state, reproduced on
demand. That is the demonstration that the corpus, not the assertion, was the thing missing.

NC-P4 confirms ADR 0096's load-bearing negative still holds: a redactor that ate `@scope/pkg@1.2.3`
or `@maintainer` would damage ordinary text on every clean page.

## Left open, deliberately

`fetchRegistrySnapshot` is production-dead and still carries `redactPii`. Not removed: it is the
reference implementation the equivalence control compares against, and that comparison is now the
mechanism keeping the two redactions identical. Its own PII test (`registry.test.ts:130`) is left
in place for the same reason — it is a valid test of the reference, and it is no longer the only
one. What was wrong was never that it existed; it was that nothing else did.

The general lesson is narrower than "test the production path": **when a duplicated-implementation
pair is kept honest by an equivalence test, that test's corpus must contain an input that
exercises every behaviour either side implements.** Otherwise the pair can silently diverge in
exactly the region the corpus does not reach.