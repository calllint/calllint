# ADR 0085 — a version bump is not a de-listing

- **Status:** Accepted
- **Date:** 2026-08-16
- **Supersedes:** the *stated cause* in ADR 0084's Open section (§0084 "S0-OPEN-6"). ADR 0084's
  decisions D1–D4 stand unchanged; only its account of *why* `agency.goji/goji` left the cohort
  is corrected here. Per the repository rule that history is amended in place and never rewritten,
  0084's text stays as written and this ADR is the correction of record.
- **Relates to:** S0-OPEN-6 (reframed and answered), ADR 0074 (the cap), ADR 0075 (reserved names),
  ADR 0082 (`refused` is not a pass), ADR 0083 (ratchet magnitude), ADR 0084 (ratchet identity).

## Context — the question I was asked, and why it had no correct answer

S0-OPEN-6 was carried as a **product judgement**: when a subject is de-listed upstream, should its
Trust Page return **410**, keep a **tombstone**, or **vanish**? STATUS.md recorded the current
behaviour as "it just vanishes". ADR 0084 recorded the cause as a publisher de-listing:

> that is what happened to `agency.goji/goji` between the 2026-08-10 and 2026-08-15 snapshots:
> de-listed upstream, six served files removed, `--regression` EXIT 0.

I measured before answering. **Every clause of that premise is false**, and the three options as
posed describe a situation that does not exist. A judgement made on that premise would have
shipped a tombstone for an event that never happened, and left the real defect in place.

## What was measured

### 1. The subject was never de-listed

Live upstream, 2026-08-16 (`registry.modelcontextprotocol.io/v0/servers?search=goji`):

| version | `status` | `isLatest` | `publishedAt` |
|---|---|---|---|
| 1.0.0 | `active` | **false** | 2026-08-03T10:29:06Z |
| 1.0.1 | `active` | **true**  | 2026-08-13T13:12:26Z |

`agency.goji/goji` is `active` and `isLatest` **today**. On 2026-08-13 — two days *before* the
snapshot that "lost" it was fetched — the publisher shipped **1.0.1**, and upstream flipped 1.0.0
to `isLatest: false`. The 2026-08-10 snapshot holds the subject at `version: "1.0.0"`,
`publishedAt: 2026-08-03`: exactly the row that is now stale.

**A publisher shipping an update was recorded by this system as a publisher withdrawing.** Those
are close to opposite events.

### 2. The cap did not evict it either

The other available explanation was ADR 0074's alphabetical cap. It is also false, and the
snapshot's own bytes refute it: `agency.goji/goji` **would sort at index 1 of 100**, between
`ag.hood/name-service` (index 0, present) and `agency.kesey/pretrip` (index 1, present). A prefix
that admits its neighbours on both sides cannot evict what lies between them. The cohort *grew*
25 → 100 in this transition and exactly one name left.

### 3. The actual mechanism — a hash decides which version is current

`refreshFromMirror` projects from `store.listLatestSourceRecordPayloads`, which is
`listLatestSourceRecords` (`packages/adoption-index/src/storage/store.ts:1515`):

```sql
ROW_NUMBER() OVER (
  PARTITION BY source_native_id
  ORDER BY last_seen_at DESC, payload_digest DESC
) AS rn
… WHERE rn = 1
```

The mirror is append-only and stores **one row per version**
(`UNIQUE(source, nativeId, payloadDigest)`), deliberately deferring the `active`/`isLatest` filter
to the projection (`officialRegistry.ts:184-187`). So this window function is the only thing that
decides *which version row represents the subject* — and it decides on `last_seen_at`, then on
**`payload_digest`**, a content hash. Neither operand is `isLatest`. Neither is `publishedAt`.

One sync stamps every row it observes with the same `last_seen_at`, so the first key **always
ties** and the hash **always** decides. This is structural, not incidental:
`persistSourceRecords(records, ctx.retrievedAt)` (`syncSource.ts:178`) passes **one** timestamp for
the whole batch, and the upsert's only `DO UPDATE SET` is `last_seen_at = excluded.last_seen_at`
(`store.ts:1438`) — so after any full sync, every row of every subject carries an identical value.

The docblock above the query (`store.ts:1510-1513`) states the opposite as its justification:

> Two rows can share a `last_seen_at` **only** when one run yielded the same native id twice with
> different bytes

That describes a pathological source. In fact a full sync observes *every* version of *every*
subject in one pass, so sharing a `last_seen_at` is the **normal** case for all 89 multi-version
subjects. The docblock's reasoning about `last_seen_at` vs `first_seen_at` (the revert argument) is
sound and is preserved by D1; what it got wrong is the *frequency* of the tie it delegates to a
hash — and with it, how much the hash was deciding. **Measured** over the real store
(`packages/trust-index/.var/…/adoption-index.sqlite`, 1200 rows / 298 subjects):

- multi-version subjects: **89**
- of those, all rows sharing one `last_seen_at` — i.e. the tie the digest must break: **89 of 89**
- where the digest selects an `isLatest: false` row *while an `isLatest: true` row exists*: **60**

For goji specifically, with the repository's own `hashJson`:

```
1.0.0  isLatest false  sha256:d110c7cb077dcb4b…   ← wins `payload_digest DESC`
1.0.1  isLatest true   sha256:5acae86414372e91…
```

`d110c7…` > `5acae8…`, so the projection receives the **stale** row, `isLiveCohort` sees
`isLatest: false`, and the subject is dropped from the cohort entirely. The served files are then
removed by `writeServedTree`'s `rmSync`, and the identity witness reports a lost name.

**This is a coin flip on a hash.** A publisher who ships an update has a roughly even chance of
being deleted from the trust index, and the outcome is stable per content — so an unlucky subject
stays deleted across every subsequent run until it publishes again.

### 4. Scale: this is systemic, not one subject

Replaying the same window function over the whole store and asking what the projection *would*
emit versus what it would drop purely on the tiebreak:

| | subjects |
|---|---|
| projection emits | **235** |
| dropped **only** because the digest picked a non-latest row | **58** |
| cohort if the tiebreak keyed on `isLatest` | **293** |

**58 subjects — 20% of the mirror — are invisible to the trust index for no reason but a hash
comparison.** `ac.inference.sh/mcp` and `ac.tandem/docs-mcp` are alphabetical ranks 0 and 1 of the
live cohort, both absent from a 100-entry snapshot whose first entry is rank 2. That is visible in
the committed artifact and had not been read.

(goji is not among those 58 because that store snapshot predates 1.0.1 and holds only one goji row.
The 58 and goji are the same defect observed at two different times, not two defects.)

### 5. What a de-listed subject actually serves today

Independent of the above, I measured the surface S0-OPEN-6 asks about. All three requests return
**HTTP 200**:

| request | status | content-type | sha256(body)[0:12] |
|---|---|---|---|
| live subject `.json` | 200 | `application/json` | `7a69a9080e34` |
| absent subject `agency.goji-goji.json` | 200 | **`text/html`** | `1ceb1deb15e5` |
| never-existed `zzz.never-existed.json` | 200 | `text/html` | **`1ceb1deb15e5`** |

`apps/web/public/` has no `404.html`, and `_routes.json` claims only `/v1/public/*` for the Pages
Function, so every unmatched path falls through to the marketing homepage. An absent subject and a
typo are **byte-identical on the wire**. A machine client asking for `.json` receives HTML, and
`JSON.parse` throwing is the only failure signal it gets — accidental, not designed.

So "vanish" was never one of three options someone chose. It is the absence of any option, and the
observable result is not a vanish at all: it is a **200 with marketing copy**.

## Decision

### D1: The current version of a subject is decided by `isLatest`, never by a hash

`listLatestSourceRecords` orders by `isLatest` first, then `publishedAt`, and keeps
`payload_digest` only as a final total-order tiebreak so the query stays deterministic:

```sql
ORDER BY json_extract(payload_json, '$.lifecycle.isLatest') DESC,
         json_extract(payload_json, '$.lifecycle.publishedAt') DESC,
         last_seen_at DESC,
         payload_digest DESC
```

`isLatest` is the source's own statement of which version is current; using it is not a heuristic.
`publishedAt` second covers a source that marks several rows latest or none. `last_seen_at` is kept —
the docblock's revert argument for it is correct — but demoted below the two keys that carry meaning.
`payload_digest` stays last because a query that is not a total order returns rows in an unspecified
sequence, and the reproducibility gate compares bytes.

The docblock at `store.ts:1498-1514` is corrected in the same change: its claim that a `last_seen_at`
tie needs "one run yielding the same native id twice" is false, and it is the sentence that made the
digest look harmless.

**A hash may break a tie. It may never decide a fact.**

### D2: A cohort departure must be classified before it is reported as a loss

ADR 0084's D4 said a de-listing is "reportable, not automatically wrongdoing". Measurement shows
the witness cannot currently tell *what it is reporting*: it saw a version bump and reported a
de-listing. So the identity witness gains a classification step. For each name present in the
previous cohort and absent from the current one, it distinguishes:

- **`superseded`** — the subject is still `active` upstream and a newer version exists. Not a
  withdrawal. This is the defect class D1 fixes; after D1 it should not occur, and if it does the
  witness names it as a **bug in this system**, not an act by the publisher.
- **`de-listed`** — the subject is absent from the source, or present and not `active`.
- **`evicted`** — the subject is still live upstream but fell outside the cap (ADR 0074/0075).
- **`unknown`** — the source could not be consulted. Per ADR 0082 this is **not** a flavour of any
  of the above and must not be printed as one.

The exit code stays the caller's decision (0084 D4). What changes is that the verdict now carries
*which* event occurred, because "a name left the cohort" has at least four causes with opposite
meanings and the operator cannot act on the undifferentiated fact.

### D3: S0-OPEN-6's three options are rejected as posed; the answer is 404 plus a reason document

410 / tombstone / vanish all presuppose a de-listing. The measured need is different and narrower:

1. **An absent subject returns `404`, not `200`.** A `404.html` ships in `apps/web/public/`. This
   is the whole fix for the indistinguishability in §5 and it is independent of every judgement
   above. A trust surface that answers `200` for a subject it has never assessed is making a
   claim it cannot support.
2. **A `.json` request for an absent subject returns JSON**, shaped like the partner API's existing
   error document (`calllint.partner-api.error.v0`), not HTML. A machine consumer must be able to
   tell "no such subject" from "malformed response".
3. **No tombstone, for now.** A tombstone asserts "this subject was withdrawn", and this system has
   just been shown to be unable to distinguish withdrawal from a version bump. Shipping a
   tombstone before D1 and D2 land would publish that error as a durable, user-visible claim about
   a named third party. Once D2 can classify a departure, a tombstone for the `de-listed` class
   becomes a defensible follow-up; it is explicitly **not** authorized by this ADR.
4. **410 is rejected outright.** It means "gone, permanently, and I know it". We do not know it.

The order is deliberate: **correct the record before publishing a claim about someone else.**

### D4: The withdrawal machinery stays unwired

`planWithdrawal`/`applyWithdrawal`/`setSubjectLifecycle` remain uninvoked from any agent- or
user-facing surface, and `TOMBSTONED` stays unreachable from any automatic path. J2/J2b in
`tests/invariants/open-judgements.invariants.test.ts` are **unchanged and must stay green** —
nothing in D1–D3 gives them a caller. D3's 404 is a serving-plane artifact, not a lifecycle
transition. Had I answered S0-OPEN-6 with "tombstone", those two controls would have gone red, and
that red would have been correct.

## Consequences

- The cohort is expected to **grow substantially** on the next full ingest as the 58 wrongly-dropped
  subjects reappear. That is a correction, not growth, and it must not be read as adoption.
  ADR 0083's ratchet measures *magnitude* and will see a large positive delta; the floor is a floor,
  so it does not red, but the run's log must say why the number moved.
- ADR 0084's `--identity` witness should, after D1, stop reporting `agency.goji/goji` as lost — the
  subject returns to the cohort at its correct version. The acknowledgement of goji recorded in
  0084 per its D4 is left in place and annotated: **the loss was real, the stated cause was wrong.**
- The reproducibility gate is affected: changing the window function changes which payload the
  projection reads, so committed bytes move. This is the intended effect and must be landed as a
  deliberate re-bake with the delta explained, never as an incidental diff.
- `S0_REQUIRED_RECORDS` and `S0_REGRESSION_FLOOR` are untouched here.

## Open

- **S0-OPEN-6 is answered as reframed and remains open as work**: D1 (tiebreak), D2
  (classification), D3 (404 + JSON error) are decided and unimplemented as of this ADR.
- **S0-OPEN-7 (new)** — a tombstone for the `de-listed` class, unblocked only once D2 can classify
  a departure. Deliberately deferred rather than half-shipped.
- The `last_seen_at`-always-ties observation deserves its own look: a key that never discriminates
  is not a tiebreak, it is dead weight in the ordering, and it may be masking other places where a
  single sync's uniform timestamp is treated as ordering information.
- Why no guard caught 58 missing subjects is the sharper question than goji. The count ratchet
  cannot see it (ADR 0084's whole subject), and nothing compares the mirror's live subject count
  against the projection's output. **A projection that silently drops a fifth of its input has no
  reader.** That is the next guard to write.
