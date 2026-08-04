# Changelog

All notable changes to CallLint are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0.0
onward. While pre-1.0, minor versions may include breaking changes.

`MCPGuard` was the internal codename for this project; the public product is
**CallLint** (see ADR 0008).

## [Unreleased]

### Added

- **Workstream R PR R-4 (ADR 0061 §2/§10) — the Package Adapter Registry: fetch the declared
  artifact, verify its bytes against the registry's own integrity claim, and never execute it.**
  R-3 concluded *which* artifact a subject declares; R-4 obtains it. `artifact_versions` stops being
  a table with four permanently-null columns: `immutable_digest`, `registry_integrity`, `cache_key`
  and `last_verified_at` now carry measurements, `artifact_status` reaches `FETCHED` /
  `UNAVAILABLE` / `REJECTED`, and the §16.1 chain gains its third link
  (`sourcePayloadDigest → identityDigest → artifactDigest`). No verdict or decision behavior moves,
  no served byte moves (`git diff --stat -- apps/web/public` EMPTY), the MCP surface stays at 13
  tools / 19 resources, **zero migrations** (all four columns landed with R-1's canonical DDL, whose
  digest is still pinned by value at `sha256:4ac16f9636b2fadcbb…`, re-verified over the real bytes),
  and **zero new dependencies** — `packages/adoption-index` still declares exactly
  `@calllint/fingerprint` and `better-sqlite3@12.9.0`. Decompression is `node:zlib`; the tar reader
  is a read-only header parser in this package. No `tar`, `pacote`, `npm-registry-fetch`, `execa`,
  `cross-spawn`, or package manager. ADR 0061 §2's enforcement is *dependency absence*, so a
  violation has to appear in a lockfile diff rather than in a control-flow review — and a new gate
  (`tests/invariants/adoption-index-no-execution.invariants.test.ts`) now walks every module under
  `src/` for a forbidden specifier and pins the manifest's dependency set to those two entries.
  **The defect this batch exists to avoid is the comparison, not the fetch.** npm states integrity as
  SRI (`sha512-<base64>`); this repo's digest convention is `sha256:<hex>`. They never compare equal.
  Verification therefore parses the claim, takes *its* algorithm, computes that algorithm over the
  bytes, and compares in the claim's own encoding — so `registry_integrity` and `immutable_digest`
  are two different strings that agree, and the tests assert they are *unequal* as stored. Replacing
  the parse with string equality (control #22) rejects **every** artifact, which is what makes the
  parse observably load-bearing rather than incidental.
  **Metadata and bytes are two phases because they are two risk classes.** Phase A reads one JSON
  document for the version and the integrity claim (the mapping is ported from
  `resolver/src/evidence/npmResolver.ts`, not forked); Phase B downloads, hashes, compares. Phase A
  can succeed while Phase B fails, and collapsing them would make "the registry claims `sha512-…`"
  and "we hold bytes that hash to it" one indistinguishable field — exactly the Observed-vs-Inferred
  line Product Principle 8 requires be kept. A failed attempt still records the claim, because the
  claim is an observation either way.
  **The CAS only ever contains verified bytes.** Buffer under a hard streaming cap → hash → compare →
  *then* stage at `work/<digest>.part` and rename into `cas/blobs/<hex[0:2]>/<hex>`. A refused blob is
  never written at all, which is strictly stronger than write-then-delete; the staging name is the
  digest itself, so there is no clock and no `Math.random`, and two concurrent writes of identical
  content are idempotent. Writing before verifying (control #26) puts unverified bytes in the CAS;
  removing the byte cap (#24) turns the oversized fixture `FETCHED` instead of `REJECTED`; flipping
  one byte of the fixture tarball (#23) yields `REJECTED` **and** an empty `cas/blobs`. `cas/expanded`
  stays empty — "static unpack" here means parsing the tar stream in memory to enumerate and hash
  entries, and expansion is the evidence batch's need, not R-4's.
  **`UNAVAILABLE` and `REJECTED` are not interchangeable, and `REJECTED` is terminal.** No bytes in
  hand (404, reset, timeout, cap) is *tried and failed* — retryable. Bytes in hand and refused (digest
  mismatch, not a gzip/tar, path escape, entry cap) is terminal for that (artifact, claim) pair,
  because a digest mismatch is not transient. Widening the transition table to permit
  `REJECTED → FETCHED` (control #25) lets a re-run silently heal a mismatch. A package type with **no
  adapter** is a third thing again: R-4 ships one adapter (npm — the only type the corpus declares),
  and pypi/oci/nuget/mcpb are *not tried*, so they must not become `UNAVAILABLE`, which would claim an
  attempt that never happened. They stay `RESOLVED` and are counted under `skipped: NO_ADAPTER`.
  **The stickiness guard had a second writer, and only an end-to-end replay found it.** Control #25
  passed because it measures the guard inside `updateArtifactResolution` — but `persistIdentity`'s
  artifact upsert assigned `artifact_status = excluded.artifact_status` unconditionally, and
  `artifactVersionId` hashes only `{subjectId, packageType, packageIdentifier, version}` while
  `resolveIdentity` derives the status from `packageType` alone. So the row collides every run and
  R-3's replay reset `FETCHED`/`REJECTED` back to `RESOLVED` **without ever reaching the transition
  table**: a rejected artifact was silently un-rejected and refetched, and a cache hit could never be
  observed because `FETCHED` never survived. The upsert now narrows that assignment to rows still in
  `RESOLVED`/`UNSUPPORTED`, which keeps the identity layer able to re-grade what it owns (asserted:
  `UNSUPPORTED → RESOLVED` still works) while making `updateArtifactResolution` the only path out.
  Control #32 removes the narrowing and observes `expected "REJECTED" … received "RESOLVED"`. **The
  guard was enforced on one writer and bypassed on the other; a per-writer control cannot see that,
  which is why the two-run end-to-end test exists.**
  **Where it runs: a port, not an import.** Artifact resolution is a network loop with a per-artifact
  time budget, and `store.transaction()` issues raw `BEGIN`/`COMMIT`, so the loop cannot live inside
  `refreshFromMirror`'s short transaction. `resolveArtifacts` persists **one transaction per
  artifact** — one slow or failing artifact cannot roll back the cohort, asserted by a throwing
  artifact that leaves its neighbours committed. `refreshFromMirror` gains an *optional injected*
  `artifactPort`; omitted, `artifactResolved` stays `null` and the returned verdict is byte-identical
  to R-3's, so every existing assertion stays green unchanged. Keeping it a port also keeps the
  data-flow invariant structurally visible: `snapshot` remains a function of `records` alone, which is
  what the reproducibility gate byte-compares (asserted: port and no-port commit identical
  `snapshotText`/`snapshotDigest`). `detectSourceChange` moves *after* the port so the verdict
  describes what the run did; its four inputs are all read before the persist, so the no-port verdict
  is unchanged. `rebuild.artifact` flips `null → measured`, `null` on `NO_CHANGE` even when the caller
  passed `true`; defaulting it to `false` (#27) asserts "no artifact rebuild needed" with nothing
  behind it, and passing `true` with `NO_CHANGE` (#28) must stay `null`.
  **Measured end-to-end, offline, over the committed corpus:** 19 entries → **2** npm artifacts, both
  `FETCHED`, 0 `UNAVAILABLE`, 0 `REJECTED`, 0 skipped, exactly 2 CAS blobs byte-compared at their
  digest-derived paths, `cas/expanded` and `work/` empty, `rebuild.artifact === true` with the four
  unknowable tiers still `null`. Only two hosts are contacted and no remote-only subject's URL is ever
  fetched. A warm second run re-verifies with **0** tarball calls and `last_verified_at` unmoved —
  which can only ever be a test, never a CI observation, because every scheduled run is a cold
  checkout. Wire-level tampering yields 0 fetched / 2 rejected / no blobs / sticky; a 404'd tarball
  yields 2 `UNAVAILABLE` that a later run retries to `FETCHED`. Fixtures are built in memory with
  `zlib.gzipSync` and a hand-written tar header, never a committed binary: the tests must control the
  exact byte to flip, and a committed archive would make git call the file binary.
  `sha256Bytes` is added to `@calllint/fingerprint` (§10 keeps hashing in one package) — additive, so
  no committed digest can move, and its control is that it agrees with `sha256()` on their overlap.
  **Measured once against the LIVE registry, and it exercised the paths the corpus cannot.** The
  committed 19-entry corpus declares 2 packages, so `UNAVAILABLE` and `NO_ADAPTER` were fixture-only
  facts. A local live run (`TRUST_INGEST_MIRROR_MAX_ENTRIES=5000`, never in CI) read 1200 records /
  298 subjects and reported **64 considered, 45 fetched, 8 unavailable, 0 rejected, 11 skipped (no
  adapter)** — so all three non-terminal outcomes are now observed on real data, and `REJECTED` stayed
  at zero across 45 real tarballs, which is the expected shape when every registry states a claim its
  own bytes satisfy. All 45 blobs re-verified independently of the writer: each filename equals the
  sha256 of its bytes, each sits in its correct `<hex[0:2]>` shard, all 45 carry the gzip magic,
  3.89 MiB total, with `cas/expanded` and `work/` empty (no staging residue survives a real run).
  Resolution is default-ON in the ingest bin with `TRUST_INGEST_ARTIFACTS=0` to disable, safe because
  it writes only to the gitignored `.var/` — confirmed for both roots the bin can resolve, since
  `pnpm --filter` runs with the package as cwd and creates `packages/trust-index/.var/`, which
  `.gitignore:57` also covers. A scheduled run's PR diff is unchanged by R-4: only public HTTP GETs
  whose bytes are never executed. **New negative controls #22–#32; #31 is the
  vacuity control on the new gate — pointed at a module-free directory it must FAIL, not pass.**
- **Workstream R PR R-3 (§8.1) — the Canonical Adoption Graph: identity resolution that fails
  closed.** `SourceRecord` records what one source *claimed*; R-3 adds the layer that CONCLUDES an
  identity across records (`canonical_subjects`, `subject_aliases`, `artifact_versions` identity
  columns) and, when two records claim one identity, **refuses to merge them** and records the
  refusal as a first-class `identity_conflicts` row. `CONFLICT` is terminal, never a warning: a
  conflicted subject yields **zero** `artifact_versions` rows, so a collision produces *less* data
  rather than a winner. No verdict or decision behavior moves, no served byte moves
  (`git status --porcelain -- apps/web/public/` EMPTY), the MCP surface stays at 13 tools /
  19 resources, and **zero migrations** — all four tables landed with the canonical DDL in R-1, whose
  digest is still pinned by value at `sha256:4ac16f9636b2fadcbb…`.
  **The merge keys the corpus proves wrong are the ones worth naming.** Grouping is by EXACT
  `canonical_name` only. `repositoryUrl` cannot be a key: 9 of 19 committed entries have
  `repositoryUrl: null`, and `null === null` in a JS `Map`, so a naive group-by fuses 9 unrelated
  products into one subject. Publisher (reverse-DNS head) cannot be a key either: the corpus's one
  *apparent* publisher collision is `ai.agenticshelf/{graffeo,mcp,puroair}` — a coffee roaster, an
  e-commerce catalog and an air-purifier brand sharing one hosting platform. `publisher-divergence`
  therefore means *one identity claimed by different publishers*, **never** *one publisher with many
  products*. Both wrong keys, plus the remote-host variant that reaches the same trio a second way,
  are negative controls; they fail in 18, 19 and 2 tests respectively.
  **The slug is lossy, so it is never an identity key — and the witness for that was itself wrong
  until it was measured.** `registryCanonicalName` preserves `[a-z0-9._-]` and rewrites only the runs
  outside it, so the reverse-DNS `/` boundary flattens while `.` and `-` pass through: `a.b/c` and
  `a.b-c` collide, `a-b-c` does **not**, and `A.B/C` joins via the lowercase step. Grouping by slug
  instead of name fails 13 tests and destroys the classification as well as the count
  (`expected ['canonical-name-collision'] to deeply equal ['slug-collision']`).
  **`registryCohort`'s silent election becomes a reported collision, with the bytes pinned unmoved.**
  Keeping the first entry answers "which file owns this path"; it does not answer "are these the same
  product", and reading it as though it did is how one product's evidence would reach another's page.
  `registryCollisions` now reports the shared slug with every ORIGINAL name, as a plain structural
  value — `packages/trust-index` gains no dependency on `@calllint/adoption-index`. The election
  itself is unchanged, `incompleteReason` included byte for byte, which is why `apps/web/public/`
  cannot move.
  **Measured on real data: the conflict path is unreachable, all five classes.** Over the committed
  snapshot — raw name 19 distinct / 0 collisions · slug 19 / 0 · `repositoryUrl` 10 / 0 ·
  package-identifier 2 / 0 · publisher head 17 / 1 *apparent, and not a conflict*. So the conflict
  logic is graded on synthetic fixtures by necessity, and re-pointing those fixtures at the real
  corpus fails 5 tests with `expected [] to have a length of 1` — the vacuity a real-data-only suite
  would have shipped as a permanent green over a branch never entered.
  **`rebuild.identity` flips from `null` to a measured boolean, and stays asymmetric on purpose.**
  `true` when a run actually resolved an identity layer; `null` on `NO_CHANGE`, because a skipped run
  measured nothing and asserting `false` would be a claim with nothing behind it. Setting it `false`
  there fails with `expected false to be null`. (`rebuild.artifact` stayed `null` at R-3 for the same
  reason; **R-4 below flips it to measured, with the same asymmetry.**)
  **19 subjects, 2 artifact rows — not 19.** Artifact versions follow PACKAGES, and the corpus
  declares 2 packages against 18 remotes: a remote is an endpoint with nothing to pin a digest to.
  The R-4 columns (`immutable_digest`, `registry_integrity`, `cache_key`, `last_verified_at`,
  `artifact_status = FETCHED`) are left unwritten **by R-3 — R-4 below now writes all five**, and the
  two are deliberately not symmetric on the document — `immutableDigest` is required-and-nullable,
  `registryIntegrity` is omitted — because a fabricated digest is worse than an absent one.
  **Two negative controls did not fire where they were aimed, and both are recorded rather than
  quietly re-specified** (R-2's control #11: a control that passes when it should fail is a finding
  about the harness, not a pass). (1) "Resolve identity BEFORE `projectSnapshot`" leaves 44/44 green,
  and structurally must: `resolveIdentity` is pure, `records` is computed before both call sites, and
  the projection never reads what resolution returns, so the two statements commute. **Line order was
  never the invariant; the data dependency is.** Restated as "feed identity output *into* the
  projection", it fails 12 tests. (2) Importing the store into `registryCohort.ts` leaves the
  module-graph boundary gate at 11/11 green — that gate walks from the two PUBLISHED bundle entry
  points, and no shipped bundle reaches `emitCohort`, which is bake-time. Re-aimed at `matchLexical.ts`
  (one of the two `exports` subpaths the gate's own witness test pins as a set) it fails three ways:
  15 adoption-index modules bundled, the `@calllint/adoption-index` specifier named, and
  `better-sqlite3` named — the last being the `.node`-cannot-be-bundled failure ADR 0061 exists to
  produce. Every wrong claim was inverted in place with its reason, in source, test and plan alike.
- **Workstream R PR R-2 (§16.1/§16.2) — the source-payload change detector, and the deletion of a
  re-bake that was emitting the wrong tree.** Replaces the unconditional full re-bake at the ingest
  bin with a measured verdict: an unchanged upstream is now *skippable* and provably commits
  byte-identical bytes (INV-R6), while a changed one reports which §16.2 tier the change reaches. No
  verdict or decision behavior moves, no served byte moves (`git status --porcelain --
  apps/web/public/` EMPTY), the MCP surface stays at 13 tools / 19 resources, and **zero migrations**
  — `source_checkpoints.snapshot_digest` was already declared in the canonical DDL
  (`001-canonical-adoption-graph.sql:38`) and round-tripped by the store; what was missing was a
  **producer**. A column with no writer is not a feature, and the mutation that adds a second
  `ALTER TABLE` for it now fails by name with `duplicate column name: snapshot_digest`.
  **A count cannot be the change key, and it is unsound in the one direction that ships a wrong
  page.** `PersistResult` already splits `inserted` from `unchanged`, so `inserted === 0` looks like a
  ready-made "nothing changed" — and it passes on every fixture where upstream only ever ADDS. When
  upstream **withdraws** a server the run inserts no row, so the count says "unchanged" while the
  cohort that feeds the bake has lost an entry. The mirror is append-only (there is no `DELETE`
  anywhere in the package), so its memory of a withdrawn subject outlives the withdrawal and a count
  can never see the difference. Keyed on the digest instead, the withdrawal fixture fails the count
  shortcut in 4 tests.
  **The digest is over the projected cohort's `entries`, which is the only one of three candidates
  that is honest.** The raw mirror rows carry `last_seen_at`, refreshed on every unchanged
  observation, so that digest moves every run and the detector never skips — a detector that never
  skips delivers nothing. The whole projected snapshot carries `fetchedAt`, the run's one clock read,
  so it fails the same way. The `entries` are exactly the population the served tree is derived from
  and free of both the storage bookkeeping and the clock. Both wrong candidates are negative controls,
  and the `fetchedAt` one additionally breaks "a skipped run still advances the run bookkeeping" —
  with the clock in the digest there is no skip left to bookkeep.
  **The prior digest is read back from durable state, before the sync.** A digest compared against
  something the same run computed detects nothing, and the failure is silent because the code still
  *looks* like a comparison. Read ordering is equally load-bearing: the prior digest and the mirror's
  current subject set are both read **before** the sync, because afterwards this run's own records are
  current and the withdrawal set-difference is structurally blind. `observedNativeIds` is therefore
  reported by the sync rather than recovered from `last_seen_at`, which would be wrong whenever two
  runs share a clock value — every test that pins `now`, and any two real runs in the same
  millisecond.
  **`RebuildScope` says `null` where it cannot measure, never `false`.** §16.2 spans seven tiers;
  R-2 honestly owns exactly the first (source-payload ⇒ canonicalize). The other six are `null` with
  the batch that fills each named in a comment, because `false` asserts "no rebuild needed" — a claim
  with no measurement behind it — while `null` says "this batch cannot know". A partial fan-out that
  reads as complete is precisely the drift that makes a later batch trust a field nothing ever wrote.
  **INVERTED, not deleted: the ingest bin's re-bake was emitting a claims- and evidence-stripped
  tree.** Its docblock claimed the emitted trust and Safe-install trees were "byte-identical" to
  `bake.ts`'s. Measured, **94 of the 158 committed served files differ**, over the same file set:
  `bake.ts:165-184` passes `loadClaimStoreIfPresent()` and `loadEvidenceSnapshotIfPresent()`, while
  the ingest bin passed `undefined, undefined, []`. The original claim was true only of the two
  arguments it was *written about* — `engineVersion()` and the presentation document, whose own
  comments at `emitCohort.ts:226-236` say they flow ONLY into `installFiles` — and false of everything
  else. It never shipped a wrong page for a reason that is an accident of **ordering** rather than a
  safeguard: `.github/workflows/trust-ingest.yml:49-53` runs ingest, then resolve-evidence, then bake,
  and `writeServedTree` `rmSync`s both roots before writing, so the stripped bytes were deleted and
  rewritten by the correct bin seconds later inside the same job. Reproduced by writing the stripped
  shape to disk on purpose: the two committed-tree gates fail on **94** files and `public/` restores
  to zero. **Deleted rather than made conditional** — a bake of the wrong shape stays the wrong shape
  when it runs less often, so gating it behind the new detector would have made the defect *rarer*,
  which is strictly worse: a bake that emits a stripped tree on every run is found the first time
  anyone looks. The stale assertion is left standing, inverted in place with the measurement beside
  it. The bin now measures and reports; `bake.ts` remains the one bin that bakes, because it is the
  one that loads the complete input set, and the workflow already runs it on the next line.
  **Seventeen negative controls, each restored byte-identical, and one of them was a finding about the
  harness rather than the code.** Control #11 edits the applied migration in place and **passed when
  it had to fail**: every migration test builds a fresh `:memory:` store from whatever bytes are on
  disk, so an in-place edit moves the file and the recorded digest together and no assertion can see
  the difference — `loadMigrations` only checks the digest's *shape*. The drift guard itself is real
  and fires on a synthetic tamper, but it can only fire against a store applied from the OLD bytes,
  and no such store exists in CI: `.var/` is gitignored and every run is a cold checkout. So an edit
  to the canonical DDL was green on every leg and would throw on exactly the machines that already
  hold a store — an operator's, days later, with the failure attributed to whatever ran last. The
  shipped migration's digest is now pinned to its **value** (transcribed from `loadMigrations`' own
  output, never derived from the file — deriving it would pass for any bytes, which is the mutation
  restated), and the filename set is pinned alongside it so adding a legitimate `002` forces a
  deliberate visit rather than silently widening what the pin covers.
  **That pin then found a second, older fault, on the one CI leg that could see it.** With the digest
  pinned by value, `test (windows-latest)` went red **alone** while ubuntu and macOS passed: expected
  `sha256:4ac16f96…`, received `sha256:7886b43b…` — the same DDL, digested after a CRLF checkout.
  `git check-attr text eol -- packages/adoption-index/migrations/001-…sql` reported `unspecified` for
  both. R-0 pinned `artifacts/adoption-index-v1/**` and its comment names this exact trap, but the pin
  covered audit artifacts, not the one directory whose bytes the compiler *hashes*. Migrations are the
  single place in the repo where a **source** file's bytes are a durable identifier: the digest is
  recorded into `schema_migrations` and `applyMigrations` refuses to open a store whose recorded digest
  no longer matches the file, so a CRLF checkout does not reformat the migration, it changes its
  **identity** — a store created on Linux would report "modified after it was applied" on Windows and
  refuse to open. That fault was latent from R-1; pinning the digest is what made it observable.
  `packages/adoption-index/migrations/** text eol=lf` is now pinned, and — because a pin no gate reads
  is itself unguarded (the P-4b lesson) — the *consequence* is asserted in the suite as well, following
  `resolve-presentation.test.ts:109`'s pattern, so all three legs measure it. Control #18 rewrites the
  migration to CRLF locally: 2 failed / 15 passed, naming both the digest mismatch **and** the newline
  shape. The second assertion is the diagnostic one — alone, the digest pin reports only "expected
  4ac16f96… to be 7886b43b…", which is true of any edit and therefore diagnostic of none.
  The other controls: the count
  key (4 failures), a self-compared digest (4), a producerless column (8 — the widest, since the skip
  path becomes structurally unreachable), a skippable withdrawal (16 — the guard gates every row of
  the input-space table), the raw-row digest (2), `fetchedAt` in the digest (2), a conditional re-bake
  and a last-writer re-bake (1 and 94), the `RebuildScope` `false` claim, `toEqual` on the parsed
  snapshot instead of `===` on the bytes (measured: re-indentation is byte-different and
  parse-equal, so the weaker assertion passes where the real gate fails), a clock parameter on the
  detector, a bundled-in store (3 axes, naming all 13 leaked modules plus `better-sqlite3`), and a
  loosened driver pin. The detector's own purity is what makes this cheap: three inputs, so the
  6-row table over `prior ∈ {null, equal, different} × absent ∈ {empty, non-empty}` **is** the
  specification rather than a sample of it, with a count assertion that exactly one row is skippable —
  a detector that skipped two, or none, would satisfy every individual row while being wrong about the
  whole.
  **A defect the controls caught in the implementation itself.** Every verdict returned the
  module-level `RebuildScope` constant *by reference*, so one caller writing
  `verdict.rebuild.identity = true` — exactly what a later batch filling in its own tier reaches for —
  would silently rewrite every verdict computed afterwards in the process. The constants are now
  frozen **and** spread at each return site, because neither alone suffices: the freeze without the
  spread turns a reasonable caller into a crash, and the spread without the freeze leaves the next
  branch added there free to reintroduce the sharing unnoticed.
  **The structural test that the re-bake cannot come back strips comments first.** The house
  discipline is "invert a stale assertion, never delete it", so the docblock deliberately *names*
  `writeServedTree` — a bare grep over the source would pass or fail for the wrong reason. The check
  runs on comment-stripped source and carries a positive control that the raw source still matches
  and that the stripped source still contains the code it should, so a stripper that deleted
  everything cannot make it vacuous.
- **Workstream R PR R-1 (ADR 0061) — the canonical adoption store, the seven identity schemas, and
  the `SourceRecord` mirror.** The first Workstream-R batch that builds: R-0 measured the repo, this
  adds the private SQLite adoption index and demotes the committed registry snapshot to a
  **projection** of a full upstream mirror. No verdict or decision behavior moves, no served byte
  moves (`git diff main...HEAD -- apps/web/public/` EMPTY), the MCP surface stays at 13 tools / 19
  resources, and `deploy-web` did not run — no `apps/web/**`, `assets/brand/**`, or `deploy-web.yml`
  path is touched. Note this is **not** the "PR R-1" at the bottom of this section: that one is the
  `calllint://` deep link under ADR 0057. Two different batches legitimately share the label and the
  disambiguator is permanently the ADR number.
  **`packages/adoption-index/` (private).** The canonical 10-table DDL ships as one digest-pinned
  migration applied on open, WAL enabled, `foreign_keys` ON per connection, forward-only: a migration
  edited after it was applied is rejected by digest, a pending migration numbered below the highest
  applied one is rejected as a backfill, and a migration that fails mid-way is rolled back whole so no
  partial schema survives.
  **The seven identity schemas, flat in `schemas/`.** `calllint.source-record.v1`,
  `canonical-subject.v1`, `adoption-record.v1`, `artifact-version.v1`, `identity-conflict.v1`,
  `compiler-job.v1`, `compiler-run.v1`, each `additionalProperties: false` at every level so a score,
  a verdict, or a PII field is structurally impossible rather than merely discouraged. A
  `SourceRecord` keeps the identity it *claims* in a `claimedIdentity` object precisely so no reader
  can mistake it for resolved identity, and publisher prose is quarantined under
  `untrustedPublisherContent` (INV-2.4-05). The schema-compatibility gate validates **real store
  output**; hand-authored instances would grade the schemas against a fixture rather than against
  what the code emits.
  **The mirror in front of the snapshot.** `refreshSnapshot` becomes an orchestrator: mirror the full
  cursor-paginated source into `source_records` behind an `updated_since` watermark, then project the
  snapshot out of the mirror. Until now the snapshot WAS the record of upstream, so everything the
  emitter dropped at ingestion — deprecated servers, superseded versions, anything past the cap — was
  unrecoverable, and the cap kept the alphabetically-first entries rather than a considered cohort
  (R-0's own capability matrix already named this reduction at
  `artifacts/adoption-index-v1/current-capability-matrix.json:231`). The projection is asserted
  **byte-identical** to what `fetchRegistrySnapshot` produced for the same upstream, over the shipped
  emitter's own output rather than claimed, because these bytes feed the reproducibility gate.
  **Neither shipped smoke gate could detect a bundled-in store.** `scripts/package-smoke.mjs:121` and
  `scripts/mcp-pack-smoke.mjs:67` assert runtime `dependencies` are empty and `:137`/`:80` assert no
  unresolved `@calllint/*` specifier survives — but both bundles are built with an unqualified
  `bundle: true` and **no `external` list**, so esbuild inlines every reachable module and runtime
  deps stay empty whatever the graph contains. A bundled-in store satisfies all four assertions, would
  ship silently, and the first symptom would be `better-sqlite3` failing to load on a user's machine,
  since a `.node` binary cannot be bundled at all. The manifest is the wrong boundary; the module
  graph is the right one. `tests/invariants/adoption-index-unreachable.invariants.test.ts` walks the
  graph the bundler walks, from the same two entry points, and it lives in `tests/invariants/` because
  **`pnpm test` is in the 19-link `ci:local` chain while `pack:smoke` and `pack:smoke:mcp` are not** —
  the #240 trap shape, where a gate that only runs in the 3-OS matrix cannot be reproduced locally.
  Its assertions would go green by resolving nothing, so it carries two guards that must both hold
  first: a **witness** that subpath `exports` resolution works (`calllint-mcp` must reach exactly the
  two trust-index subpath modules it imports, the same two esbuild's own metafile reports) and a
  **positive control** that the detector fires (the same walker, from the real shipped file that
  legitimately imports the store, must reach adoption-index and must name `better-sqlite3`).
  **Nothing asserted the publishable SET.** Each smoke script validates one bundle it is handed by
  name; neither enumerates the workspace, so a package that silently became publishable was invisible
  to both. Now pinned as a set of four — `@calllint/credits`, `@calllint/signature`, `calllint`,
  `calllint-mcp` — so a swap that keeps the size at four still fails.
  **ADR 0061 §7 is amended by measurement, and the pin is now gated.** The ADR pinned `12.11.1`;
  re-measured, `better-sqlite3` **dropped its Node 20 prebuild (ABI 115) at `12.10.0`** while still
  declaring `engines.node: "20.x || …"`. All three CI legs run Node 20 (`ci.yml:42`) and the install
  script is `prebuild-install || node-gyp rebuild`, so any resolution at or above `12.10.0` falls
  through to a **source build**, adding a Python and C++ toolchain requirement on three operating
  systems. Re-pinned to `12.9.0`, whose prebuilds cover ABI 115/127/131/137/141 on `win32-x64`,
  `darwin-arm64`, `darwin-x64` and `linux-x64`; `trust-ingest.yml` runs `node-version: 24` (ABI 137),
  inside that set. Confirmed in CI rather than argued: `install: Done` landed 0.8 s after
  `prebuild-install || node-gyp rebuild --release` on windows and macOS with no `gyp` output and no
  `gyp ERR`, and the tests that open a real store passed on all three legs. The reusable lesson, now
  written into the ADR: **`engines.node` states what upstream permits; the prebuild assets state what
  upstream ships, and only the second decides whether CI compiles C++.** The superseded reasoning is
  left standing with a supersession note beside it. The pin itself was documented in three places and
  read by no gate — mutating it to `^12.9.0` passed all 117 R-1 tests, the P-4b shape exactly — so it
  is now asserted in `packages/adoption-index/test/store-schema.test.ts` on the **declared** specifier,
  not the resolved version: a lockfile already resolves to something exact, which is why
  `pnpm-lock.yaml` looked fine either way and why the range survived every gate.
  **Four defects this batch found in its own first draft or in the assertions themselves.** An ABI
  assertion was coupled to the schema, so a 10-table→2 mutation failed the DDL test *and* the ABI
  test, reporting "no source build required" for a schema defect; it now goes through the driver
  (`SELECT 1`, plus the `foreign_keys` pragma that is the driver's own contract) and touches no schema.
  Three assertions failed without naming their offender — an INV-R7 boolean reported "expected false
  to be true", true of every violation and diagnostic of none — and each is now a collected list that
  names the offending write, path, or module. `resolveMirrorMaxEntries` had two boundary defects: the
  raw-read ceiling is a different quantity from the served cap, and since `paginate` reports
  `capReached` at `yielded >= maxEntries`, a mirror ceiling merely *equal* to the snapshot cap makes
  the snapshot's own cap structurally unreachable, failing closed on exactly the run where the
  snapshot would first fill — hence strict inequality, and a fallback that is derived rather than the
  bare constant, because `TRUST_INGEST_MAX_ENTRIES` can raise the snapshot cap above
  `DEFAULT_MIRROR_MAX_ENTRIES`. And a missing `invokedAsScript` guard meant
  `expansion-eligibility.test.ts`, which imports `refreshSnapshot.ts` for `resolveMaxEntries` alone,
  performed a **real network read at import** and left `.var/calllint-adoption-index/` behind — a test
  that passed only because the rejection landed after the suite had finished.
  **Twelve negative controls, each restored byte-identical**, covering the store reaching `apps/cli`
  runtime deps, the store imported from `packages/core/src/`, a dropped `"private": true`, `.var/` out
  of `.gitignore`, `^`/`~` on the driver pin, a `tsconfig` path with no vitest alias, 2 tables instead
  of 10, a mirror that perturbs the snapshot, a hand-authored schema instance, a removed `failRun()`,
  `Date.now()`/argless `new Date()`, and a write outside the root. Controls 1 and 2 are the
  load-bearing pair — one fires the shipping gate, the other the reachability scan — and only #1's
  mutation added a dependency, so the reachability scan correctly stayed silent; that separation is
  what makes the pair meaningful rather than redundant. Verified on the squashed tree at `c7f25e8`,
  not inherited from the branch: `pnpm ci:local` exit 0 with `Test Files 193 passed (193)` and
  `Tests 2896 passed | 1 skipped (2897)` (the skip pre-exists in
  `packages/report-renderer/test/sarif-schema.test.ts`), both smoke gates PASS, and a real cold
  compile run producing 10 tables at schema version 1 with exactly one persisted file, `.var/` proven
  *ignored* rather than merely absent via `git check-ignore -v` — an empty diff alone would not
  distinguish an ignore rule from an unwritten file.
- **Workstream R PR R-0 — the compiler boundary ADR and the Batch-0 reality audit.** Documents only:
  no production code, no served bytes, no verdict or decision behavior. That is the batch's gate, not
  its modesty — a Workstream-R entry that changed one byte under `packages/*/src/**` would have
  failed whatever else it proved, so it is asserted as a `git status --porcelain` path check rather
  than trusted as intent, alongside an empty `apps/web/public/` diff and an unmoved MCP surface
  (13 tools / 19 resources).
  **The boundary ADR is `0061`, and the number is a correction with an evidence chain.** Both trackers
  said 0057. Measured at `84f56c5`: 0057 is `adrs/0057-adoption-deep-link-boundary.md` (`8ef6319`,
  #245), 0058 is the presentation control plane, 0059 is the install capsule — and **0060 is reserved
  by committed, drift-checked artifact bytes**, not by a note:
  `artifacts/phase-2.4/presentation-plane-audit.json:135` states the reservation verbatim, with it
  also written into the generator at `scripts/presentation-plane-audit.ts:296` and a fault message at
  `:389`. Taking 0060 would have put a new ADR in contradiction with bytes a gate already reads. The
  renumber is in-contract rather than a deviation: integration §2.1 carries its own escape clause —
  final numbers are assigned *at authoring, after re-inspecting the repo, never trusting the
  blueprint's numbers* — and R-0 is that authoring moment. The stale tracker rows were **inverted in
  place with their reason preserved**, following the shipped "invert a stale assertion, never delete
  it" discipline, so a later reader finds why the number moved instead of a bare 0061 matching no
  document. 0060's reservation is untouched, and the ADR-0057-as-"PR R-1" label collision is left
  alone by design: two different things legitimately share that label and the disambiguator is
  permanently the ADR number.
  **The one-writer gate passes by resource class, which is what makes it pass honestly.** The gate
  says *one live-config writer is identified* and *stop if one writer cannot be identified*. A bare
  count returns 2 and halts the workstream on a false negative; recording 1 and omitting the second
  writer would make the audit less honest than the ADR it audits, since ADR 0057:191 put the second
  writer on the record itself — *"'one writer' is now 'one config writer plus one narrowly-scoped
  OS-registration writer', and that distinction has to be kept"*. So `current-authority-map.md`
  records `liveHostConfigWriters: 1` (`applyPlan`, `install-planner/src/applyEngine.ts:99`, with all
  three of its filesystem writes enumerated), `osRegistrationWriters: 1` (`applyUrlHandler`,
  `core/src/gateway/urlHandlerWriter.ts:84`, disjoint and disclosed — grep for
  `mcp.json|settings.json|mcpServers` in that file returns no hit), and `contendingWriters: 0`. The
  same axis splits the other two duals, plan digest and rollback. This is the correction P-7 made
  when it replaced `bindingUnchanged: true` with a measurement: a count is not a fact about authority.
  **Five of the 21 named subsystems have two real owners, so the schema was extended rather than the
  truth flattened.** §6.2's example gives one scalar `path`/`symbol` per row; 16 rows honour it
  exactly and the five forks carry `bindings[{path, symbol, line, role, note}]`. Naming one owner
  loses the second and inventing a composite path is fiction — both point a later batch at the wrong
  file. Concretely: evidence resolution is a tsx script whose **only** export is `remoteSubjects`
  (`main()` at `:48` is not exported, so it cannot be driven as a schedulable unit) beside the
  reusable engine `resolver/src/evidence/resolveSubject.ts:17`; receipt **v0 still ships** for
  `scan --receipt` alongside v1; telemetry is two independent closed vocabularies with separate
  version constants. Row 4 is the only `PARTIAL` of 21 and the fork is precisely why.
  **`CONTRADICTED` is a used bucket, not an edge case.** Five capabilities the blueprint asserts as
  confirmed gaps measurably shipped — self-claim closed 3/3 on the live account (new13), safe search
  (N7, `b7c7bfd`/#227), install interception (N8, `95587aa`/#228), the `/install/{tool}/` capsule
  (new14 Batch 3, `f0e58d6`, 38 served files) and 19 Agent Adoption Contracts. Grading them `ABSENT`
  would re-authorize building what exists, the exact waste `Blueprint v1.4:216` forbids. Of 55 graded
  rows, 18 are `ABSENT` but 12 of those are do-not-build rows where absence is the *passing* state, so
  the real gap surface is **six**. Every `EXISTS` row names its tests and the generator **exits
  nonzero rather than emit one that does not** — each cited path is `existsSync`-checked, which turns
  "an EXISTS with no test is unfalsifiable" from a review step into a property.
  `current-generated-tree.json` enumerates **159** committed files from `git ls-files`, not from a
  bake (§6.3's "do not infer from code"), with a producer per entry and `.well-known/security.txt`
  marked **FOREIGN** on the evidence of `.gitattributes:35` — claiming authorship of a file the repo
  deliberately disowns would license a later batch to regenerate or delete it.
  Open decisions: **O-2** the compiler lives in `packages/adoption-index/`; **O-3** the driver is
  `better-sqlite3` pinned to exactly `12.11.1` — measured, and the newest version is the wrong one,
  because the repo's Node floor is `>=20` (so `node:sqlite` is out) and `better-sqlite3@13.x`
  declares `engines.node: ">=22"`, reintroducing the same incompatibility; **O-1** LORDL credential
  handling stays the user's call, deferred in the ADR by name, never harvested.
  (**Superseded at R-1: the version is `12.9.0`, not `12.11.1`.** The reasoning above was right about
  the driver and about `13.x`, and wrong about which `12.x`: it read `engines.node`, which states what
  upstream *permits*, where the deciding evidence is the prebuild assets, which state what upstream
  *ships*. Node-20 prebuilds (ABI 115) were dropped at `12.10.0`, so `12.11.1` would have compiled
  from source on all three CI legs. Left standing rather than edited, per "invert a stale assertion,
  never delete it" — see the R-1 entry above and ADR 0061 §7's amendment.) The ADR restates the
  compiler's hard boundaries: never executes the target, writes **0** host config, persists only
  under `.var/calllint-adoption-index/`. `artifacts/adoption-index-v1/**` is pinned `text eol=lf` in
  this batch, before anything measures it — no gate reads these bytes yet, so nothing fails today,
  but a missing pin false-fails on windows-latest alone and `ci:local` structurally cannot see it.
- **Workstream P PR P-7 — config version, the deploy ledger, and digest→document rollback.**
  Closes new15 §14's fifth acceptance block, **可回滚性**, whose three lines were prose nothing ran:
  每个 presentation config 有版本 / 每次 deploy 记录 presentationDigest / 可按 digest 恢复上一版本.
  Measured against the code, each was a distinct unmet obligation — the document had no version
  field, no deploy recorded anything durable, and no code mapped a digest back to a document. They
  are one loop, so they land together: **version → recorded digest → restorable document.**
  `configVersion` is a third **identity** key modelled on `locale`, not a levelled section. Two
  shipped constraints force that shape: `presentation-content.test.ts` pins `schema.properties`
  minus the identity keys to exactly `LEVEL_BY_SECTION`'s keys, and `sectionsAtLevel` walks only
  `LEVEL_BY_SECTION`. So a levelled section would move a level digest and a bare property would
  fail an existing test; identity is the only shape yielding the intended signature —
  `presentationDigest` **moves** while `l0`/`l1`/`l2` **hold**, asserted derivationally through
  `presentationDigest` itself rather than as a hex literal that could not detect its own subject
  changing. It is **optional**, which is load-bearing three ways: the empty document's digest stays
  `sha256:b9bbb27a…` so P-1's pin and rollback's non-branching predecessor both survive, the seven
  historical documents stay valid restore inputs instead of becoming retroactively malformed, and a
  catalog omitting it still resolves. Its value shape copies `tokensVersion` verbatim — a non-prose
  token, so it cannot be rendered as copy — and it is validated and digested but **never resolved**:
  `overriddenSlots` stays 46.
  The ledger is a **committed** artifact with an explicit append mode, not a git query. Measured:
  no workflow sets `fetch-depth`, so CI's clone is depth-1 while the local one is full — a grader
  shelling out to `git log` would pass locally and fail on CI for a reason unrelated to its claim.
  `artifacts/phase-2.4/presentation-deploy-ledger.json` is shaped on `five-second-panel-store.json`
  and appended only by `pnpm ledger:presentation:record`, never by a `:write`. Validation splits in
  two **on purpose**: `validateOffline` recomputes all five recorded values from each entry's stored
  document and is CI-safe, while `validate` adds the git layer — ancestry of HEAD, and each stored
  document equals the document at its own commit. The honest limit is stated rather than papered
  over: the ledger is append-only by convention plus a duplicate refusal, not by cryptography, and
  a self-consistent forgery (a fabricated document stored with that document's correctly-computed
  digest) is invisible to the offline layer **by construction**. A test asserts that zero-fault
  result plainly and pins the git layer as the one that names it — a test that only checked "a
  forgery fails" would pass while the two layers were silently collapsed into one.
  The split needed one more piece to be gradeable on both kinds of clone. The suite first shipped
  calling the git layer unconditionally and went red on all three CI OSes while `ci:local` was
  green — the same depth-1 trap, reproduced one level up, in the test instead of the grader. So
  `historyIsReachable` measures whether the historical commits are present, and the real-ledger git
  assertions branch on it: with history the git layer is asserted green, without it the offline
  layer is, so neither branch is a no-op and no authenticity coverage was dropped to make CI pass.
  The probe is itself graded against a fabricated sha and an empty ledger, unconditionally, so it
  cannot rot into a constant `false` that would silently neuter every gate above it.
  A second green-locally/red-remotely fault surfaced in the same shape and is recorded rather than
  quietly patched: the new `deploy-web.yml` permissions probe spelled its line break as a literal
  `\n`, and `.gitattributes` does not cover `.github/workflows/**`, so on `windows-latest` — the
  only OS whose `core.autocrlf` defaults to true — it reported a write permission the workflow does
  not have. Matching `\r?\n` fixes it, and the fix is deliberately not a `.gitattributes` pin: what
  is under test is the workflow's permissions, not the line endings of the machine that cloned it.
  The 19 shipped `REGRESSION_CHECKS` anchors were audited for the same fault class and are safe,
  because `$` under `/m` matches before a `\r` and `\s` spans it.
  `deploy-web.yml` gains a step that **verifies** the record and cannot create one:
  `permissions: contents: read` stays exactly as it is, because a deploy workflow that writes to
  the repo is a new writer needing its own ADR. The developer records; the workflow refuses to
  deploy a document the ledger does not name.
  可回滚性 joins `gradePreviewSnapshot` as a fifth block over an 8-member corpus (7 committed
  documents + the empty predecessor `emptyPresentationDigest` reserved for exactly this batch), so
  `REGRESSION_CHECKS` stays 19, gate-H `measures` stays 30, and `GATE_ARTIFACTS.length` stays 7.
  `restoreByDigest` is **pure** — it takes the corpus as a parameter, and the round-trip
  `presentationDigest(restoreByDigest(d)) === d` is asserted for all 8 members, the only control
  that separates a real restore from a constant.
  A twentieth check, `version/reaches-no-served-byte`, exists because a negative control was run
  and **found a gap rather than firing**: rendering `configVersion` into the install-page head
  drifted all 19 served pages, yet 900 trust-index tests, `check:public-copy`, the plane audit, the
  lock's `configuredCopy` containment and all five gate-H blocks stayed green. The lock was blind
  by construction — that scan searches only the 9 guard/relay slot strings, and an identity key is
  in neither slice. The sole detector was `git status -- apps/web/public/`, which is a reviewer's
  habit and not a gate: it is silent on a stale tree, and each regenerating `:write` half would
  re-baseline the leak into the artifact. So the version's **value** is now searched for across the
  committed pages, in the shape the lock already uses for copy. It is not redundant with
  `not-a-resolver-slot`: that proves the resolver cannot carry the key, while a renderer can read
  the document directly and needs no slot at all — which is the path the control actually took.
  An empty page list is graded as a named `vacuous` failure, so the search cannot pass by having
  looked at nothing.
  `semanticContract.bindingUnchanged` stops being a self-certifying literal. It was one occurrence
  repo-wide, asserted by no test, and is now **derived** from five facts measured over the 19
  committed sidecars: `kind`, `tool`, the exact five-key argument set,
  `expectedContractDigest === contract.contractDigest` (19/19), and **no argument value equal to
  the computed `semanticContractDigest`** — the clause that makes new15 §2.5's deliberately-deferred
  re-pointing a visible artifact diff instead of a silent one. A per-resource `bindingFaults[]`
  names any sidecar that disagrees. Re-pointing itself stays out of scope; it needs an ADR
  amendment. Zero served bytes: `git status --porcelain -- apps/web/public/` is EMPTY, the inverse
  of P-4b's gate and the same one P-5 and P-6 proved. **Workstream P is complete.**

- **Workstream P PR P-6 — the preview & snapshot harness, the decision-relay surface, and the
  6-vs-4 slot reconciliation.** new15 §14 declared four acceptance-gate blocks and nothing ran
  them; five of six relay slots reached no consumer; and the schema shipped six relay slots
  against §5's four, recorded as unreconciled. These are one problem seen from three sides — the
  slots cannot be wired without a surface, and a new surface should not be trusted before the
  harness that grades it exists.
  `pnpm audit:preview` grades all four blocks over the five canonical fixtures (a measured choice:
  the 19 served pages carry exactly ONE structural signature and only two verdicts, so grading
  page consistency against them would pass while never exercising BLOCK, UNKNOWN or UNSUPPORTED).
  **配置完整性** enumerates six copy domains and closes the one gap a compiler could close —
  `MUST_ASK_SENTENCE` is now `Readonly<Record<MustAskToken, string>>`, so a seventh token without a
  sentence is a typecheck error rather than a page rendering a raw identifier. Duplicate catalog
  keys are measured over **raw bytes**, because `JSON.parse` collapses them last-wins and a parsed
  check is structurally blind. **页面一致性** partitions on the CTA route and asserts the signature
  differs ACROSS partitions as well as matching within one — the cross-partition inequality is the
  load-bearing half, since a signature that collapsed to a constant would satisfy the first half
  perfectly while measuring nothing. **安全隔离** grades all five zero-counts; three had no grader,
  above all publisher→HTML, where the five injection blurbs were previously checked only against
  the contract's decision scope, so nothing ever rendered them into HTML and counted (and the
  check runs in BOTH escape forms, because `esc` and `escText` differ on the quote characters).
  **视觉回归** is browserless and says so: it measures which declarations apply (var()-resolved)
  and how the one grid reflows across three viewports straddling the 452 px column boundary and
  the 720 px cap — not glyph rasterization. Zero `@media` is asserted rather than assumed, since
  `resolveDeclarations` is a flat rule walk that would silently mis-parse a nested query.
  The five relay slots land in the MCP prepare result's non-decision `notes[]`, composed by
  `composeRelayNotes` and **fact-gated**: each sentence is relay wording plus a machine fact read
  off the sealed contract, and a sentence whose basis is absent is not emitted — `adds` only with a
  non-empty `authorityDelta.adds`, `notObserved` only when `completeness === "complete"` (absence
  of evidence is recorded as absence, never as safety), `approvalQuestion` only with a real
  `planDigest`. `CODE_OWNED_SLOTS.agentRelayCopy` is now `{}` and the compiler forces both slot
  tables to move together. That gating is also the 6-vs-4 reconciliation: §5's four are the
  **minimum**, the two extras name `authorityDelta.{adds,notObserved}` as their basis, and a
  seventh slot with no contract field behind it fails the check. Recorded rather than implied:
  configuration reaches these sentences at **build time only** — both binaries declare empty
  runtime deps and the catalog ships in no `files` list, the same limit `guardOffer` has carried
  since P-5 — so the lock's `resolvesToDefaults` is what keeps a reworded catalog from silently
  disagreeing with the shipped binary.
  §14's *"at most three authority facts"* is **inverted, not deleted**: ADR 0059's cap of 5 is
  later and more specific, and all five fixtures measure exactly 5, so grading a 3 would fail 5/5.
  `thresholds.maxAuthorityFacts` also stops being self-certifying — the harness now READS it and
  grades the measured counts against it. The MCP result schema declares the 8 properties the code
  already emitted (declaring is additive and changes no published byte; dropping them would have
  been a behavior change), and real results from every outcome path are validated against it.
  No verdict moves, `git status --porcelain -- apps/web/public/` is empty, and `l0Digest` /
  `l2Digest` do not move while `l1Digest` / `presentationDigest` do.

- **Workstream P PR P-5 — close the three dead presentation sections, and make `unwiredSlots`
  total.** `LEVEL_BY_SECTION` declared eight presentation sections; the resolver read five. The
  other three — `guardConversion`, `agentRelayCopy`, `overrides` — validated clean, were levelled,
  moved `presentationDigest`, appeared in the lock's `sections` list, and reached **nothing**. A
  document carrying all three resolved to `overriddenSlots: []`, `unwiredSlots: []`,
  `rejectedSlots: []`: a clean bill of health for a document that did nothing. That is ADR 0058
  §3's named drift ("a key that validates and then does nothing") live in three places, invisible
  to every gate.
  Each section now has at least one slot with a real consumer: three of `guardConversion`'s four
  reach the Guard offer render, `agentRelayCopy.guardOffer` templates the MCP relay line, and
  `overrides.resources.*.{displayName,reason}` reach the install page and the lock artifact. The
  remaining slots are **declared code-owned with their measured reason** rather than accepted in
  silence — a security floor compares it as a literal (`declineLabel`), no consumer exists yet
  (the five decision-relay slots, P-6), wiring it would add served bytes, it is L3-reachable, or
  honoring it would make the bake clock-dependent (`expiresAt`). `unwiredSlots` is derived over
  all eight sections from the WIRED set, and both tables `satisfies Record<PresentationSection, …>`,
  so adding a ninth section without classifying it is a **typecheck error** rather than a silent
  hole. Gate 2.4-F now grades the **configured** surface, which makes its shipped floors — every
  component label disclosed, the disable command shown, `[Not now]` visible — guard configuration
  for free, plus two new measures (8 → 10): configured wording cannot move the `disclosureDigest`
  a human approved, and the surface those floors grade is provably the resolved plane rather than
  the built-in defaults. The second exists because the first eight cannot see the difference — the
  catalog restates the defaults, so the render is byte-identical whether or not the observing edge
  reads the plane at all, and a label that merely *claims* it did would keep every floor green
  while grading copy no document can reach. The edge derives that answer from a sentinel probe
  built through the same constructor as the graded offer, so it cannot self-certify.
  Per-resource overrides are keyed by a measured `/` → `__` encoding (19 of 19
  committed slugs round-trip; `__` occurs in none), which works around a schema `propertyNames`
  pattern that admits the *leaf* segment and so would silently key the wrong resource; the pattern
  defect is recorded, not fixed. **No behavior change and zero served bytes** — the catalog
  restates every default verbatim, and the claim is measured rather than promised: no resolved
  guard or relay string appears in any of the 19 committed pages or 19 sealed contracts, and
  `apps/web/public/` comes out byte-identical.

- **Workstream R PR R-1 — the `calllint://` adoption deep link (ADR 0057).** A registered URI
  scheme turns a page link into a local CallLint invocation, so cold-start adoption no longer
  requires the visitor to transcribe a command. What it deliberately does **not** do is the
  whole design: a link may never produce a write. `calllint://adopt/...` builds an argv that is
  asserted against a `FORBIDDEN_ARGS` set — `--approve` is unreachable from any link path, and
  `calllint://safe-install/...` is rejected outright — so the deep link can only ever open a
  preview that a human then approves on a real TTY. **Silent apply stays permanently rejected**
  (§1); `open` prints the command rather than running it (§5); and the §6 amendment makes the
  approval prompt reachable through a locally-decided `--apply` that requires both a TTY and a
  preview port, never a link. The link also cannot choose the contract origin, so a crafted URL
  cannot re-point CallLint at bytes this repo does not serve. Registration is per-user and never
  elevated; macOS reports unsupported **with a reason** instead of half-registering. Because
  `applyPlan` is JSON-patch-only, OS handler registration needed its own bounded writer — a
  second live writer, which is why it carries an ADR rather than an inline exception.

- **Workstream R PR R-2 — install-capsule first impression + a copy-only assist (ADR 0059).**
  The Human Install capsule was compressing to a two-line template: the authority-fact cap of 3
  hid an inventory the engine had already computed, and the honest cold-start path ("copy a
  pinned `npx … --apply`, paste, type `yes`") sat visually below a CTA that only scrolled. This
  raises the shipped cap to **5** (configuration may still only narrow it, never raise it),
  surfaces the contract's sealed `reasonCodes` under the inventory as a read-only projection —
  it cannot invent a code the contract does not carry — and makes a command card the primary
  visual path, with `calllint://` a louder but still secondary alternative. Exactly one
  `data-primary-action` control remains, and it still names its target.
  §4 replaces Gate 2.4-B's literal "no `<script>` substring" rule with a **whitelist**: exactly
  `src="/scripts/install-copy.js"`, empty body, `defer`, zero inline `on*` handlers — anything
  else still fails. The script may read a `data-copy-from` target and write the clipboard; it
  may not fetch, navigate, eval, or read the contract, and the test asserts those absences over
  the served bytes rather than trusting the ADR. ADR 0056 §7's *intent* ("JS never decides")
  holds; only the crude substring proxy for it is gone. Like `tokens.css`, the script is
  authored outside `public/` and synced in by `sync-assets.mjs`, and the guard **byte-compares
  the two copies** — a reference is not a file, and every HTML-side measure reads as satisfied
  while a missing served copy 404s on all 19 pages. Both sides carry a `.gitattributes eol=lf`
  pin, and `apps/web/public/scripts/**` is registered in `SERVED_SUBTREES`, because a pin no
  gate reads is itself unguarded. Registering it surfaced that P-4b's own
  `apps/web/public/styles/**` pin had been unregistered since #244; that row is added here too.

- **Gate 2.4-B CLOSED — the human five-second panel, recorded (new14 §gates; ADR 0053 §4).**
  Ten `--record` sessions over ten **distinct** install pages, each response byte-bound to the
  page it was shown via `shownDigest`, 0 stale, 100% recognition on all three questions
  (target / consequence / action) against a ≥90% floor. The recorder refuses non-TTY stdin, so
  neither CI nor an agent can manufacture this data; `--validate` never writes. With 2.4-B
  PASSED, `releaseBoundary.closed` flips to **true** for the first time — Gate 2.4-H's status
  and the boundary stay separate fields on purpose, and this is the state where that separation
  stops mattering. Note the freshness binding is load-bearing in both directions: the panel
  test now branches on measured freshness, so a future page change demotes the gate to
  `PENDING_HUMAN_PANEL` rather than inheriting recognition the new page never earned.

- **Workstream P PR P-4b — serving the L0 plane (ADR 0058 §1/§4).** P-4 built the token plane
  and proved it unpublishable; this batch **serves** it. `sync-assets.mjs` copies
  `apps/web/styles/tokens.css` to `apps/web/public/styles/tokens.css`, the renderer emits a
  single `<link rel="stylesheet">` in `<head>`, and the resolved `tokens.stylesheetHref` is what
  it emits — so all 19 install pages gain **+34 bytes each and 0 JSON bytes**: the agent
  contract, all four sealed digests, every verdict, and every `recommendedNextAction` are
  untouched, and the change is measured that way rather than asserted. This is the one
  Workstream-P PR §4 licenses to change a served byte. Net +34 rather than +56 because wiring
  the fourth copy slot let the boundary sentence refold onto one line (−22): `sectionTitles`
  now has **no unwired slot**, closing the deferral P-2 opened. Because the source and the
  served copy are two files, the lock **byte-compares** them — without that, every token,
  coverage, and hygiene measure would read the source while browsers read the copy, and a
  hand-edit under `public/` would pass all of them. Two measures are new because P-4b is the
  first batch where they could fail: an **element baseline** asserted as an exact set
  (`:root`/`body`/`main` were invisible to every class-scoped parser, and a missing `body` rule
  would have shipped the `<link>` with none of the visual-hierarchy outcome — styled sections on
  a browser-default page), and a **`var()`-resolved visual digest**, which a raw-bytes digest
  cannot be (it moves on a comment edit) and a token-name comparison cannot be (it misses a
  palette re-pointed through renamed tokens). The suppression scan now covers those element
  heads too: `body { display: none }` hides a disposition exactly as well as the class-scoped
  form did, and under an install-only scan it was not a finding. The resolver gains an
  **href allow-list** — rooted, same-origin, `.css`, no query or fragment — so a catalog cannot
  point a served trust surface at third-party bytes; a rejected href falls back to the shipped
  sheet, is reported in `rejectedSlots`, and never echoes the offending value into a CI log.
  `unwiredSlots` is now derived from the *wired* set rather than the deferral list, which keeps
  the mechanism alive with an empty list and catches a case it previously missed entirely: a
  **misspelled** title key, which the per-key merge silently dropped. Three P-4 assertions
  **invert** rather than being deleted (a deleted check cannot fail when a page silently loses
  its stylesheet), and both the wiring probe and the byte-compare were verified by
  reintroducing the defects they exist to catch.

- **Workstream P PR P-4 — the L0 design-token plane (ADR 0058 §1/§4).** Populates the one
  configuration level that was declared but empty: **L0**, defined as "not reachable into any
  digest, and appears only in CSS." Adds `apps/web/styles/tokens.css` — the 11 shipped `:root`
  tokens mirrored byte-for-byte from the served `apps/web/public/styles.css`, plus real rules
  for the nine `install-*` classes the Safe-install renderer actually emits, written only in
  terms of those mirrored `var(--…)` tokens — and records `tokens.tokensVersion` /
  `tokens.stylesheetHref` in the committed presentation catalog. **Assets-only: no served byte
  moves.** The plane is unpublishable by construction, not merely unreferenced — it sits outside
  `apps/web/public/`, which is the only directory the site deploy publishes — and the renderer
  is untouched, so `stylesheetHref` is *recorded, not emitted* (referencing it is P-4b's job,
  the only Workstream-P PR permitted to change a served byte). Three new measurements make the
  level verifiable rather than asserted: `presentation-lock.json` gains a `tokenPlane` block
  whose every value is **derived from the files** — `l0DigestWasEmpty` (the before/after: the
  L0 digest moved off the digest of `{}`, while L1/L2 held), a per-token **drift pin** against
  the served sheet, selector coverage computed from `install-*` classes parsed out of the 19
  committed served pages, and a hygiene scan that refuses `@import`, `url(`, `!important`, any
  `http`, and — because a stylesheet cannot decide a verdict but can hide one — any
  `display:none` / `visibility:hidden` / `content:` inside an `install-*` rule. The plane audit
  flips `apps/web/styles` from `absent` to `present` and widens its served-stylesheet check
  from an install-only count to an exact **set** over all 59 served trust + install pages,
  pinned to the two pre-existing styled trust pages — strictly stronger, and it closes the
  blind spot that a stylesheet quietly added to a third trust page would have passed. No
  schema change, no new MCP tool, no new scanner or writer, and no verdict movement: 24 new
  tests pin INV-P2 behavior isolation (under any `tokens` block, every digest, the verdict, the
  installability and the rendered HTML stay byte-identical, measured against a never-mutated
  control twin).

- **Phase 2.6 Sentinel — `calllint_guard_external_tools` (ADR 0055 §3).** Adds an
  always-loaded, honest-presence MCP tool to the shipped `calllint-mcp` server (now 7 pure
  delegators, still one server, ADR 0025). It **states what CallLint does** — a static,
  deterministic preflight gate that returns an evidence-backed SAFE/REVIEW/BLOCK/UNKNOWN
  verdict, never executes the target, never decides with an LLM, and where UNKNOWN is never
  SAFE — and reports that CallLint is available; it holds no logic, changes no verdict, and
  performs no action of its own (the handler echoes the shipped boundary-safe
  `VERDICT_PUBLIC_LABEL` and the shipped tool names). It is **never an injected instruction**
  to the host agent: copy that redirects/coerces/impersonates the agent's turn ("you must…",
  "ignore…", "always call … before…") is a §七 forbidden method and is prohibited. Two guards
  pin this: the description + output stay **≤2500 bytes** (a ceiling assertion, ADR 0055 §3),
  and `check:public-copy` gains **check 21** — it scans the committed `tools.ts` description
  literals for forbidden overclaim (the project-facts corpus) and any injection imperative,
  so every MCP tool description is now governed like every other public string. Additive: no
  schema, no verdict movement, no served-page byte change; the trust tree is untouched. Adds an origin
  `apps/web/public/robots.txt` whose only directive is
  `Sitemap: https://calllint.com/trust/sitemap.xml`, so the Trust Index sitemap is
  auto-discovered by crawlers with no ongoing manual step. This is deliberately additive:
  `calllint.com` is fronted by Cloudflare, which **prepends** its managed AI-crawler +
  content-signals policy to `robots.txt` at the edge and serves the origin file after it
  (verified live — the managed block appears first, then this file). The origin already
  returned HTTP 200 for `/robots.txt` (the SPA catch-all), so adding a real file keeps
  Cloudflare in the same append branch: the managed AI-crawler `Disallow` policy is
  preserved and this file contributes only the `Sitemap:` reference. It declares **no**
  `User-agent`/`Allow`/`Disallow`, so it can never silently widen crawler permission on its
  own. (Supersedes the "`robots.txt` reference intentionally not included" note on the
  discovery entry below — the Cloudflare append behavior is now verified, so the reference
  is safe to ship.)

- **Phase 2.6 Safe Search — `calllint_search_agent_tools` (ADR 0055 §4).** Adds a second
  Phase 2.6 tool to the shipped `calllint-mcp` server (now 8 pure delegators, still one
  server, ADR 0025): it finds already-published CallLint Trust Pages **by name** and surfaces
  each match's **shipped verdict and boundary-safe label verbatim** (plus artifact digest,
  observed-at, and Trust Page URL). Matching is **deterministic lexical only** — exact, then
  prefix, then substring, alphabetical within a tier — using the **one shared `matchLexical`
  ranker** now extracted from the lookup page's inline script into `@calllint/trust-index`
  (`matchLexical.ts`) and re-embedded there byte-for-byte, so the page and the tool rank
  through a single source (no second ranker; Product Principle 4/5). There is **no LLM, no
  embedding, no fuzzy/semantic distance, and no new score**, and the tool **computes and
  moves no verdict** (ADR 0053 §3): it is a pure projection of a **committed** index snapshot
  bundled into the server as a module (`src/data/lookup-index.json`, a byte-copy of the baked
  `apps/web/public/trust/lookup-index.json`, inlined by esbuild — so the server stays
  self-contained with empty runtime dependencies and never reads the served tree, reaches the
  network, or executes a server at runtime). A resource with **no** Trust Page simply does not
  appear; absence is not a verdict, and a match is an existing observation at a specific digest
  and time, not a certification, endorsement, or guarantee of safety. Additive: no schema, no
  verdict movement, no served-page byte change (the re-embedded ranker is byte-identical, so
  `lookup.html` and `lookup-index.json` are unchanged). An anti-drift test pins the bundled
  copy byte-identical to the baked file, and the existing no-exec invariant gains a Safe Search
  case; `check:public-copy` (check 21) governs the new description like every other public string.

- **Phase 2.6 Install Hook — capture the install action, re-adjudicate via the shipped route
  (ADR 0055 §4).** Extends the shipped ADR 0051 preflight hook
  (`plugins/calllint/hooks/preflight-core.mjs`) so that when an agent edits an agent-tool
  config surface, its non-blocking recommendation now also **captures the install action** and
  names the exact **human-in-the-loop Trust-Gateway route** that re-adjudicates it verbatim:
  `calllint trust prepare <name> --host <id>` (read-only — builds a reviewable plan, executes
  nothing), review, then `calllint trust apply --plan <f> --approve <plan-digest>` (the **only**
  step that writes host config, and only on the human's approval of that exact plan digest;
  optionally `--receipt` emits a `calllint.receipt.v1` decision receipt). This holds the ADR
  0051/0052 floor exactly: the hook **captures, it never decides or writes** — it never reaches
  `applyPlan`, constructs no `ApplyOptions`/fs port, always exits 0, and emits no
  `permissionDecision` (the route is guidance in `additionalContext`, not a gating field). A
  model may skip CallLint, but the install **action** is always routed back through the
  human-approved gateway. The recommendation vocabulary is mirrored from
  `@calllint/agent-triggers` (the dependency-free plugin cannot import it at runtime) and pinned
  identical by the invariant test — one vocabulary, no drift — with the capture treated as
  `gather-evidence` (UNKNOWN-equivalent, never SAFE). The `preflight-hook-non-blocking`
  invariant gains cases proving exit 0, no `permissionDecision`, no file written, and the
  verbatim route; no schema, no verdict movement, no served-page byte change.

- **Trust Page discovery — sitemap + structured data (SEO, no verdict movement).** Trust
  Pages are search-indexable (`robots: index,follow`) but nothing helped a crawler — or a
  maintainer — find them. The bake now emits a deterministic `trust/sitemap.xml` listing
  each real published resource's **clean, non-redirecting URL** (`/trust/{name}` — the
  `.html` artifact 308-redirects to that form at the edge, so a sitemap must list the final
  URL). The synthetic `calllint-fixtures/*` reproducibility goldens are deliberately excluded
  from the sitemap (a maintainer never claims a fixture, and a search engine should not
  surface one as "the CallLint page for X") — they remain baked and counted in `index.json`
  for completeness; only discovery omits them. Each Trust Page's `<head>` also gains a
  `<link rel="canonical">` plus a boundary-safe JSON-LD block.
  The JSON-LD is a `schema.org/TechArticle` (a dated technical document) — deliberately
  **not** a `Review`, `Rating`, `Product`, or `Certification`, because modeling a verdict as
  a rating would encode the "CallLint graded/approved this" overclaim the language boundary
  forbids (ADR 0038 §2, ADR 0053 §3). It publishes **what** was observed and **when**, never
  a score, and carries the standing "not a certification … guarantee of safety" disclaimer so
  even a machine-extracted summary keeps the boundary. Emitted by `emitAllCohorts` as site
  chrome (the sitemap adds **no** `index.json` entry; the JSON-LD/canonical touch only the
  `.html` bytes), so every `.json` sidecar, `.manifest.json`, and `index.json` — and every
  `pageDigest` and verdict — is **byte-identical** (proved by `git status` after the bake:
  1 new file, 38 modified `.html`, 0 modified `.json`). The committed-tree reproducibility
  gate auto-covers the new sitemap with no test edit; `check:public-copy` passes 15–20 over
  the new bytes unchanged. (The `robots.txt` `Sitemap:` reference that makes this sitemap
  auto-discoverable is now shipped — see the `robots.txt` entry above; the Cloudflare
  edge-managed append behavior was verified before wiring it.)
- **Claim funnel — post-install landing page (`/trust/app-created.html`).** Closes the
  one offline gap in the maintainer-claim funnel: the CallLint Trust GitHub App's
  `redirect_url` already points at `https://calllint.com/trust/app-created.html`, but the
  page did not exist, so a maintainer who installed the App landed on a 404. The page now
  renders through the bake (`renderAppCreatedPage` in `@calllint/trust-index`, emitted by
  `emitAllCohorts` as site chrome — **not** an index resource), so it survives the
  destructive re-bake and is pinned byte-for-byte by the committed-tree reproducibility
  gate. It reuses the marketing-site chrome (`/styles.css`) rather than the bare
  Trust-Page shell, explains the async delay honestly (the Verified Publisher note appears
  on the next scheduled refresh, not instantly), and offers the embeddable Trust badge.
  Boundary-safe by construction: it records **namespace control, never safety**, states no
  verdict, carries no page digest, and passes `check:public-copy` (checks 15–20) with **no
  guard change** — it takes check 19's claimed-page branch (shows "Verified Publisher",
  never re-solicits an install). The 38 existing served pages and `index.json` are
  byte-identical (a claim/funnel page never moves a verdict, ADR 0047/0048 §2, ADR 0053 §3).
- **Gate B PASSED — human-calibration sign-offs (PR #211).** The nine negative-verdict
  Trust Pages (7 BLOCK + 2 high-severity REVIEW) are each dual-reviewed by two distinct
  humans; the committed calibration projection now reports **9/9 dual-reviewed, blocker
  precision 100%, 0 dangerous false-SAFE**, so `pnpm audit:calibration --gate` exits 0.
  This is the ADR 0053 §4 `REVIEW_HOLD` exit condition, and it unblocks Gate C. The
  sign-offs are human data recorded in `review-store.json`; the tooling only projects and
  enforces them — it never signs a review or moves a verdict.
- **Gate C / D4 — Evidence Manifest (`calllint.evidence-manifest.v1`).** A read-only,
  tool-portable projection of a decided Trust Page onto the ADR 0034 evidence discipline —
  "the Decision Receipt's public sibling: same facts, projected." It carries the verdict,
  authority capabilities (shipped `action × resource` vocabulary), completeness, evidence
  level (E0–E6), and digests **verbatim**, and introduces **no** new score, verdict
  vocabulary, or authority model (ADR 0053 §2/§5). Shipped as: a JSON Schema
  (`schemas/evidence-manifest.schema.json`); the portable `EvidenceManifest` type in
  `@calllint/evidence`; `buildEvidenceManifest` + `signEvidenceManifest` /
  `verifyEvidenceManifest` in `@calllint/trust-index` (ed25519 signing reuses
  `@calllint/signature`, no new scheme); a committed `{name}.manifest.json` sibling for
  every baked page; and a read-only serve route
  `GET /v1/public/resources/{ns}/{name}/manifest`. The committed manifest body carries
  `signature: null` and is byte-reproducible, so the committed-tree gate holds and the
  additive change touches no existing page bytes. The signature attests **who emitted the
  projection**, never that the artifact is safe; a live CI signing key / OIDC is a
  deliberate follow-on (sign/verify are shipped and tested but not yet CI-wired).
- **Gate C / D5 — page quality bar + publish-channel gate.** Completes the two missing
  Gate-C per-page fields as pure, deterministic projections rendered into every Trust Page
  sidecar and HTML: a **reproduction command** (`npx calllint scan <source>`, version-
  agnostic, pinned to the observed artifact digest) and a **scan history** (an honest
  single-entry list of the artifact's observation — never a fabricated prior scan). Adds
  the ADR 0053 §4 / §2.6 **publish-channel classifier** (`AUTO_PUBLISH` / `REVIEW_HOLD` /
  `SECURITY_HOLD`) as a pure function over the shipped `verdict` + finding
  `severity`/`blocker` — it introduces no new score and **never moves a verdict**; it only
  routes a page to a channel and fails closed (an unrecognized high-severity REVIEW → held
  for human review). A CI gate test enforces the load-bearing invariant: every served page
  is `AUTO_PUBLISH`, **or** it is a negative that has passed Gate B (dual human sign-off) —
  and the non-`AUTO_PUBLISH` set is exactly the nine committed-signed digests, while the
  whole real Official-MCP-Registry cohort is `AUTO_PUBLISH` (its `supply.unknown-remote`
  REVIEW asserts CallLint's own non-verification, not a claim about the publisher). The
  re-bake is additive only (no existing verdict or digest changed; manifests and index
  untouched). Growing the registry snapshot beyond its committed entries remains a
  network- and human-gated follow-on (a `REVIEW_HOLD` content decision), out of scope here.
- **Gate D / D6 (offline core) — publisher-namespace claim inheritance.** A single
  publisher claim on a reverse-DNS namespace (e.g. `io.github.acme`) now confers the
  `verifiedPublisher` overlay to **every** current and future child resource under that
  namespace (ADR 0047 §3, ADR 0053 §3), instead of one claim per page. The coverage test
  is **exact reverse-DNS segment equality** on the resource's **original** registry name,
  never a string prefix on the flattened page slug — so `io.github.acme` does **not**
  confer to a different account `io.github.acme-evil/*` (a prefix match would have been a
  privilege escalation). Shipped as pure, deterministic additions to `@calllint/trust-index`:
  an additive optional `registryNamespace` field on the claim record (absent ⇒ today's
  exact-resource claim, verbatim), the `registryNamespaceOf` / `namespaceCovers` boundary
  matcher, and a `verifiedPublisherForNamespace` resolver that **fails closed** (no cover,
  ambiguous owners, or a revoked record ⇒ unclaimed) and preserves the existing exact-claim
  behavior. A namespace child surfaces its **own** observed artifact digest (drift-transparent,
  no cross-child leak). A claim still **never alters a verdict** and the overlay stays
  outside the page digest, so the committed tree bakes byte-identically (zero-diff; the
  reproducibility gate holds with no test change). Live domain verification via DNS-TXT /
  `.well-known/calllint-claim`, the verification workflow, OIDC-in-CI, and the "Verify
  publisher ownership" CTA remain a network- and human-gated follow-on (they need a real
  external publisher to publish a record), out of scope here.
- **Phase 2.5-B — first-party funnel events (`calllint.trust-event.v1`), ships dark.** Adds a
  privacy-minimal, first-party analytics contract so the claim funnel can *eventually* be
  measured, wired to nothing yet. Shipped as: a draft-07 schema
  (`schemas/calllint.trust-event.v1.schema.json`, `additionalProperties:false`) with a closed
  event enum (`trust_page_viewed` / `trust_page_to_install` / `app_created_viewed` /
  `claim_cta_clicked`) and no free-text field that could carry a URL, prompt, or secret; the
  `@calllint/trust-event-contract` package whose `sanitizeTrustEvent` **fails closed** (it
  allowlist-rebuilds a fresh object and drops on any forbidden field, oversized input, wrong
  wire tag, off-vocabulary event, or malformed `pageBucket`); a Cloudflare Pages function
  (`apps/web/functions/v1/events/trust.ts`) that hashes the page path server-side (SHA-256, no
  raw path stored) and returns `204`; and an import-free client shim
  (`apps/web/public/embed/trust-events.js`). **Ships dark by construction** (ADR 0055 §2): the
  shim is referenced by **no** page and `apps/web/public/_routes.json` is **not** extended (its
  `include` stays `["/v1/public/*"]`), so `/v1/events/trust` resolves to no Function in
  production — there is no live sink. First-party only, cookie-free, no `localStorage`, no LLM.
  Touches no verdict, page digest, sidecar, or index; going live is a separate ADR-gated step.
- **Phase 2.5-C — deterministic `/trust` lookup surface (`calllint.trust-lookup-index.v1`).**
  A public, human- and machine-usable way to find a baked Trust Page by name. The bake emits
  `trust/lookup-index.json` (a **pure sorted projection** of the same baked entries that
  produce `index.json` — fixed key order, pinned indentation, byte-identical on re-bake, so the
  ADR 0046 §4 reproducibility gate holds) and `trust/lookup.html` (a search UI). Matching is
  **pure client-side string comparison** — exact → prefix → substring, alphabetical within each
  tier — with **no** ranking model, embedding, fuzzy distance, per-keystroke network, cookie, or
  `localStorage` (ADR 0055 §5); it uses `textContent`/`href`, never `innerHTML`, so resource
  names stay inert data. It publishes only what each page already states (name, verdict + the
  boundary-safe public label, artifact digest, observed-at) and is a distinct surface from the
  internal registry listing and the existing API-side `partner-api/src/lookup.ts`. A lookup
  entry can never exist without a matching index entry (the anti-drift invariant its test pins).
- **Phase 2.5-D — fixed verdict-disclaimer line on claimed surfaces (ADR 0055 §1a).** Adds the
  verbatim sentence *"Identity verification does not change the CallLint verdict."* to every
  surface that names a Verified Publisher — the claimed Trust Page, the post-install
  activation page, and the `/trust` lookup callout (via the three renderers in
  `@calllint/trust-index`). **`check:public-copy` check 19 is strengthened, never weakened**: a
  pure addition now *requires* that verbatim line on any page the `Verified Publisher` selector
  marks claimed, else CI fails; the load-bearing `Verified Publisher` guard token is untouched
  and the rename stays deferred (ADR 0055 §1b, which forbids editing the token in isolation to
  make copy pass). The matching proof is in `bake-claim.test.ts` (line present on a claimed
  page, absent on an unclaimed one). All 37 unclaimed pages re-bake byte-identical.
- **Phase 2.5-E — Phase 2.5 signoff (PR-N5).** The evidence-backed acceptance record
  (`artifacts/phase-2.5-signoff/`) that ADR 0055 §7 names as the gate for Phase 2.6: an A→E
  evidence table (each sub-phase → anchor commit → the test/gate that verifies it), an
  invariants-that-held section, an honest landing-state section, and the ordered Aug-1 landing
  runbook (`LANDING.md`). Docs/artifacts only — it merges no branch, enables no sink, renames
  no token, adds no App scope, and starts no phase. Phase 2.5-A (the self-claim dogfood spine,
  #219/#220/#221) is already on `main` at 3/3, verdict + `pageDigest` byte-identical across
  activate→revoke→reactivate.

### Changed

- **ADR 0055 (agent search capture & safe-install gateway boundary) — Proposed → Accepted.**
  The new13 Sprint-0 boundary ADR (PR #218 Proposed → #219 Accepted). It freezes the invariants
  that gate the next arc: the hard-block ordering `Sprint 0 → Phase 2.5 A→B→C→D→E → Phase 2.6
  Sentinel→Search→Hook → Phase 3+` (§7, no front-running); the additive verdict-disclaimer line
  and copy-guard-only-strengthens rule (§1a) with the "Verified Publisher" rename deferred
  (§1b); the deterministic, no-LLM `/trust` lookup and trust-event schemas (§5); and the
  Phase-2.6 boundaries — Sentinel ≤ 2500 bytes as a pure delegator, deterministic lexical Search
  over committed data, and an install Hook that routes through the shipped install-planner and
  **never grants authority or writes host config silently**. Forbids prompt injection, fake
  metrics, mass SEO doorways, and unauthorized/silent config modification. This entry records
  the acceptance; the Phase 2.5 A–E work above implements its non-deferred surfaces.
- **ADR 0054 (claim auto-adoption boundary) — Proposed → Accepted (Option B).** Settles the
  delegated question "do we need the human merge on the claim-refresh PR, or can the system
  auto-adopt?" toward the free, most-automated path: auto-adoption of the **claim overlay**
  is the sanctioned direction. The ADR's non-negotiable prerequisite (guardrail 1 — the
  reproducibility + copy guards must be **required** status checks on `main`) is verified
  **already met**: branch protection lists `build-and-test` as a required check, and that
  aggregator fans in both `committed-tree` (byte-diff, via the vitest suite) and
  `check:public-copy` — so a claim-refresh that fails to re-bake byte-identically or leaks a
  forbidden phrase/PII already **cannot merge**. This change is **documentation only**: it
  records the decision and does **not** flip on live auto-merge or touch branch protection.
  Wiring auto-merge (a diff-scope assertion + `gh pr merge --auto` in
  `trust-verify-claims.yml`) is a bounded follow-on that is a **no-op until the first App
  install** exists (the claim store is empty today). A claim still **never alters a verdict**
  and every change stays a reviewable, revertible PR object (ADR 0053 §3).

## [1.7.3] — 2026-07-22 — Distribution dogfood, ADR 0053 boundary & Trust Index Gate A/B

A distribution-productionization patch. It cuts what accumulated on `main` after 1.7.2:
CallLint ingests **its own** MCP server and runs the first real claim reconcile
(dogfood), the embedded-distribution / autonomous-index boundary is frozen in **ADR
0053**, unclaimed Trust Pages gain a maintainer claim funnel, and the public Trust Index
gains its **Gate A** evidence-quality surfaces (a 100-object coverage & precision audit
and the E0–E6 evidence-level + four-dimension status block) plus the **Gate B**
human-calibration gate. **No change to scan behaviour, the `ScanReport` schema, or the
verdict vocabulary** — every new surface is a read-only projection over already-decided
data; verdicts and authority are carried verbatim (ADR 0053 §2/§5), and no page bytes
change from the Gate-A/Gate-B audit tooling (offline artifacts, ADR 0053 §6).

### Added

- **Self-ingest dogfood + first scheduled claim reconcile (PR #200, #201).** CallLint's
  own MCP server is ingested into the Trust Index as a self-claim
  (`io.github.calllint-calllint`) and the scheduled claim-verification job runs its first
  real reconcile against the GitHub App installed on the `calllint` org.
- **ADR 0053 — embedded-distribution & autonomous-index boundary (PR #203).** Freezes the
  invariants that gate the distribution build: index stays non-LLM / human-gated / never
  executes a target; the Evidence Manifest is a projection onto ADR 0034, never a new
  receipt; a namespace claim states control and never alters a verdict; publication has
  exactly three channels (`AUTO_PUBLISH` / `REVIEW_HOLD` / `SECURITY_HOLD`); the four
  status dimensions never collapse into one number; scale-out is feasibility-gated.
- **Unclaimed-page claim funnel (DX-1, PR #204).** Unclaimed Trust Pages render a
  boundary-safe "Are you the maintainer?" CTA into the public App install funnel; claimed
  pages stay byte-identical and no verdict moves.
- **Gate A / D1 — 100-object coverage & precision audit (PR #205).** An offline audit
  artifact (`packages/resolver/audit/coverage-audit.{json,md}`) projecting the shipped
  100-object evidence benchmark: identity/repo/completeness rates, zero dangerous
  false-SAFE, and an honest coverage matrix that states PyPI/OCI/MCPB/direct-stdio as
  not-yet-covered (UNKNOWN, never SAFE). CI guards it against drift.
- **Gate A / D2 — evidence level (E0–E6) + four-dimension status block (PR #206).** A
  display-only projection on Trust Pages (`evidenceLevel.ts`): the four independent
  dimensions (verdict / evidence completeness / authority / reproducibility) are rendered
  separately and never averaged into a rating (ADR 0053 §5); a config-only page tops out
  at E2, stated honestly.
- **Gate B / D3 — human-calibration gate (`@calllint/trust-index` `calibration.ts` +
  `scripts/calibration-audit.ts`).** A projection over the negative-verdict baked pages
  (BLOCK + high-severity REVIEW) that records dual human sign-offs and asserts the
  `REVIEW_HOLD` exit thresholds (dangerous false-SAFE = 0, blocker precision ≥ 90%,
  byte-identical repeat). It is **closed by construction** — the gate cannot pass until a
  human records two distinct sign-offs; the tooling builds the gate, never the review
  (ADR 0053 §4). Offline audit artifact under `packages/trust-index/calibration/`; wired
  into `ci:local` as `audit:calibration`.

### Fixed

- **Single-prefix `scopeDigest` in claim reconciliation (PR #202).** Corrects a
  double-prefixed scope digest in the claim reconcile path so claim matching is stable.

## [1.7.2] — 2026-07-21 — Distribution breadth, telemetry wiring & release hygiene

A hardening + plumbing patch. It cuts what accumulated on `main` after 1.7.1 — two more
Tier-A install hosts, single-sourced install commands, a formal claim-lifecycle state
machine, and signed maintainer context — and adds three internal advances: the telemetry
emit layer is now **wired into the CLI but dark by default** (byte-identical output, no
network sink), three previously-missing **CI gate workflows** are stood up, and the Trust
Index gains a **publish-eligibility gate for future scale-out** with no change to the
served pages. **No change to scan behaviour, the `ScanReport` schema, or the verdict
vocabulary** — the deterministic engine is unchanged, and telemetry stays fully decoupled
from the verdict path.

### Added

- **Two more Tier-A install hosts (new11 A2, PR #194).** Claude Desktop and VS Code now
  ship audited apply adapters (five Tier-A hosts total: Claude Code, Cursor, Windsurf,
  Claude Desktop, VS Code). Both delegate to the same single audited write engine (atomic
  write → verify → rollback); `calllint integrate` picks them up automatically.
- **Single-sourced install commands (new11 A5, PR #195).** CallLint's own
  install/invocation commands now live in one authoritative `install` block in
  `project-facts.json`, and `check:public-copy` fails on any drift between that source and
  the served site/status copy.
- **Signed maintainer context + drift notification (new11 C-4/C-5, PR #191, ADR 0047).**
- **Telemetry emit layer wired into the CLI, dark by default (new11 §3.5, M1, PR #197).**
  The `@calllint/telemetry-emit` layer is now threaded into the CLI dispatch through one
  central emit site, but the local `cli` tier stays **default-off** (no consent) with the
  default `noopSink` — so CLI output is byte-for-byte identical and **no network sink
  ships**. An additive `TelemetrySignal` a command attaches to its own result drives an
  accurate `decision_*` event (the exit code is not a proxy for the verdict). Turning the
  local tier on requires an explicit first-run consent decision, deliberately not made here.
- **Three CI gate workflows (new11 §9/§14, PR #196).** `schema-compatibility` (a
  consolidated compat + malformed-input gate over the ~10 previously-untested committed
  schemas, every instance a committed fixture or production-builder output),
  `agent-integration-smoke` (wraps the detect→prepare→apply→verify→rollback→idempotence
  tests), and `distribution-smoke` (wraps the npm-pack + MCP stdio smokes). No product code.
- **Trust Index publish-eligibility gate for scale-out (new11 I1, PR #198).**
  `emitAllCohorts` gains an optional expansion cohort: each candidate must clear the §4.7
  publish-eligibility check (eligible ⇒ baked, ineligible ⇒ recorded `incomplete` with the
  failing criteria) before it becomes a public Trust Page. The ADR-locked seed (fixtures +
  the committed registry seed) is grandfathered, and an empty expansion list emits
  byte-identically — the reproducibility gate is unaffected (still 37 pages). The ingestion
  cap (ADR 0038 §6) is now parameterized via `TRUST_INGEST_MAX_ENTRIES`, fail-safe.

### Changed

- Claim lifecycle is now a formal state machine (9 states + 7 re-verify triggers, new11 C-3,
  PR #193), projected fail-closed onto the served publisher flag (only an ACTIVE claim
  serves it).
- The Claude Desktop + VS Code apply adapters and single-sourced install block land the
  five-Tier-A-host distribution surface (new11 A2/A5, PRs #194/#195).

## [1.7.1] — 2026-07-20 — Evidence-refined verdicts, agent-native distribution & 7-host Guard

Beyond the R3 evidence refinement, this patch also ships the **new11 P2
agent-native distribution** layer (agent trigger taxonomy, the `calllint
integrate` command, and a Claude plugin with a recommend-only PreToolUse hook)
and **Wave 3–4** (Guard host breadth 2→7 and full registry-manifest coverage).
None of these change the verdict vocabulary, the `ScanReport` schema, or the
deterministic engine; the hook is advisory-only and never blocks a tool call.

### Added

- **Evidence-refined Trust Page verdicts (new11 R3, ADR 0050).** The Evidence
  Resolution spine is now wired into the bake: resolved remote-endpoint evidence
  closes the *identity* gap that left registry pages UNKNOWN, and the **unchanged**
  deterministic rules re-derive the verdict. A verified-but-unanalyzed remote moves
  **UNKNOWN → REVIEW**, never SAFE (verifying *who* an endpoint is does not analyze
  *what* its tools do — INV1 still holds, nothing is executed). An automated
  invariant asserts no evidence bundle can ever drive a page to SAFE. Network stays
  workflow-only: a new `resolve-evidence` step freezes a committed, PII-free
  evidence snapshot that the bake reads **purely** (byte-identical when absent), so
  the reproducibility gate is unaffected. On the live registry cohort this moved
  **17 of 18 pages from UNKNOWN to REVIEW** (the remaining SAFE page is a
  package-based npm entry, untouched); `false_safe = 0` holds.

- **Agent trigger taxonomy + recommend policy + platform overlays (new11 P2,
  PR-10, ADR 0051).** New `@calllint/agent-triggers` package: a deterministic
  classifier that recognizes config-surface touch points (MCP server lists,
  skill manifests) and maps them to a *recommend* action, with per-platform
  overlays. No LLM, no verdict — it only decides *whether to suggest* running
  `calllint`.
- **`calllint integrate` command (new11 P2, PR-11, ADR 0049/0051).** Detect →
  plan → approve → atomic apply → verify → rollback for wiring CallLint into a
  host, reusing the audited `install-planner` writer and `discovery` host
  detection (no second writer). `integrate` is the canonical name; `init` is a
  retained alias.
- **Claude plugin + recommend-only PreToolUse hook (new11 P2, PR-12, ADR
  0051).** `plugins/calllint/` — a self-contained Claude Code plugin (plugin
  manifest + `secure-agent-install` skill compiled from the canonical skill +
  a pinned `calllint-mcp` dependency) and a `preflight` PreToolUse hook. The
  hook is **advisory / non-blocking by contract**: it always exits 0, never
  emits `permissionDecision`, and stays silent on any parse error — it surfaces
  a recommendation, never alters the agent's control flow. Includes fork-safe
  PR review (no secrets exposed to fork PRs).
- **Guard host breadth 2 → 7 (new11 Wave 3, ADR 0052, refines ADR 0045).**
  `calllint guard` now installs authority-change watchers across seven hosts —
  `git`, `git-pre-push`, `github`, `claude-code`, `copilot`, `gemini`,
  `vscode` — with session-start renderers. ADR 0052 freezes the hook
  event/write-safety contract for the expanded host set.
- **Registry manifest completed to §3.2 coverage + auto-update matrix (new11
  Wave 4, PR #187).** `distribution/registries/registry-manifest.json` now
  covers the full platform set with per-platform ownership method, read-back
  URL, and automated-submission/read-back flags, feeding the release read-back
  workflow.

### Fixed

- **Web: agent-card code examples legibility (#188).** Dark ink on the light
  code block so the examples are readable.

## [1.7.0] — 2026-07-20 — Verified Publisher & the Evidence Resolution spine

**Resolve the evidence, then publish the verdict.** This minor release ships two
things that were designed but unshipped at 1.6.0. First, **I2c — Verified Publisher**:
a maintainer can now *claim* a Trust Page through a least-privilege GitHub App and a
pure, fail-closed Actions reconcile job — a claim adds an *additive* `verifiedPublisher`
overlay and **never** modifies a verdict, severity, or receipt (ADR 0047 + ADR 0048).
Second, the **new11 Evidence Resolution system** (the "spine"): a central evidence model
(Subject / Bundle / Gap with 16 machine-readable gap reason codes) and six read-only
resolvers (npm, GitHub, MCP Registry, domain ownership, tool metadata, remote endpoint)
that turn "we couldn't tell" into a specific, maintainer-actionable reason — enforced by
a 100-object benchmark gate that holds `false_safe = 0`. Around the spine: code-derived
public facts that cannot drift from the engine, a release read-back workflow, and a
privacy-minimizing telemetry *contract* (schema + structural sanitizer + 4-tier defaults;
no emission wired into the offline CLI). **No change to scan behaviour, the `ScanReport`
schema, or the verdict vocabulary** — the deterministic engine is unchanged. Resolvers
**never execute, probe, or vuln-scan** a target (INV1, automated). Trust Pages still say
*"observed at digest D at time T"*, never "certified/verified safe."

### Added — Verified Publisher (I2c; ADR 0047 §2, ADR 0048)

- **Pure maintainer-claim core** (#162) — claim verification + store parsing that fails
  closed on any malformed or unverifiable input; no network in the pure core.
- **Claim store threaded through bake** (#163) — an *additive* `verifiedPublisher`
  overlay on baked Trust Pages; the underlying verdict/evidence bytes are untouched.
- **Serving surface** (#164) — Partner API + `<calllint-trust>` embed + baked HTML expose
  the claim overlay, guarded by the public-copy word lint (no "trusted publisher"/
  "certified" affirmatives leak onto a page).
- **GitHub App + one-click setup** (#165, #166) — least-privilege App manifest (created,
  ID 4322539); human-gated install; no unsupported lifecycle events.
- **Claim-verify Actions job** (#167) — a pure reconcile job (RS256 App-JWT) that closes
  the loop daily; zero-diff and no-op until the App is installed on a matching org/repo.

### Added — new11 P0: Public Trust Foundation (ADR 0049)

- **Priority-execution boundary — ADR 0049** (#168) — records the evidence-first P0–P5
  ordering, the "extend, don't fork" reuse map, and the canonical `integrate` name; plus
  `docs/internal/{current-system-map,evidence-gap-audit}.md`. The gap audit **measured**
  the live Trust Index UNKNOWN split (registry 17 UNKNOWN / 1 SAFE / 0 BLOCK of 18) and
  confirmed the root cause of all 18 external UNKNOWNs is "remote endpoint could not be
  verified" — which set the resolver priority (R6/R4 lead, not npm).
- **Code-derived public facts** (#169) — `project-facts.json` `capabilities.{detectorCount,
  tierAHosts}` are now machine-derived by `scripts/derive-facts.mjs` (`facts:check` /
  `facts:write`) and guarded by `public-facts-consistency.yml`, so a published claim
  cannot drift from the code (INV9). No second facts file.
- **Release read-back** (#170) — `registry-manifest.json` + a pure reconcile core
  (fetch-fail ⇒ `UNREACHABLE`, never a false-clean) + a weekly `release-readback.yml`
  that opens a single deduped issue on drift; least-privilege `issues:write`.
- **Telemetry contract** (#171) — `@calllint/telemetry-contract` (events / tiers /
  structural allowlist sanitizer / resettable non-fingerprint anon-id) +
  `telemetry-event.schema.json` (`additionalProperties:false`) + `docs/privacy/telemetry.md`
  + a `security-boundary.yml` guard. **4-tier defaults**: server-observed + attributed
  install always-on; CI on-with-notice; local interactive CLI opt-in / default-off. This
  is a *contract only* — no emission is wired into the CLI, and it is verdict-decoupled.

### Added — new11 P1: Evidence Resolution system, the spine (ADR 0049 §2, §4)

- **Evidence model** (#172) — `@calllint/evidence` gains Subject / Bundle / Gap types and
  a central enum of **16 gap reason codes** (each `{category, severity, userMessage,
  maintainerAction, retryable}`), extending ADR 0034. Schema-compat tested.
- **npm + GitHub resolvers** (#173) — read-only `evidence/{npm,github}Resolver.ts` plus
  the resolver dispatch/memoize seam; fixtures + a no-exec boundary.
- **MCP Registry + domain-ownership resolvers** (#174) — `evidence/{registry,domain}Resolver.ts`
  with conflict handling and the evidence priority ladder (artifact-bound > registry >
  publisher-signed > repo > inferred; low never overrides high). No WHOIS PII.
- **Tool-metadata + remote-endpoint resolvers** (#175) — `evidence/{tool,remote}Resolver.ts`
  (identity/TLS only; no business calls, probing, or vuln-scan) + the **INV1 no-exec /
  no-probe** automated suite.
- **Trust Index publish eligibility + completeness report** (#176) — extends
  `@calllint/trust-index` with the 6-condition expansion eligibility check, a completeness
  report, and a human-readable UNKNOWN explanation. (Bake→resolver wiring is a follow-up.)
- **100-object benchmark gate** (#177) — `packages/resolver/test/evidence/{corpus,benchmark}.ts`
  + `evidence-fixtures.yml` (`pnpm bench:fixtures`). Enforces ≥90% artifact identity,
  ≥80% repo mapping, ≥70% completeness, every UNKNOWN carries a reason, deterministic
  replay, no secrets/PII/local paths, and **`false_safe = 0`**. Green on 3-OS CI.

### Changed

- Living trackers and the requirements-traceability matrix are reconciled to `main`
  (Sprint 0 + P0 + P1 closed); the documentation index and `new8-execution-status.md`
  now record `calllint@1.6.0` as npm `latest` and I2c as shipped (prior snapshots said
  1.5.1 / "I2c NOT implemented").

### Notes

- The Evidence Resolution spine exists as libraries + a benchmark gate; **wiring it into
  `trust-index` bake** (so the live 17/18 UNKNOWN Trust Pages actually resolve) is the
  next step and is not in this release.

## [1.6.0] — 2026-07-17 — Public Trust Index & Partner Surface

**Publish the verdict, safely.** This minor release ships Phase I: the offline
ingestion plane that bakes reproducible, digest-addressed Trust Pages; those pages
served same-origin at `calllint.com/trust/…`; the first *external* source (the
Official MCP Registry, ingested by a scheduled workflow that opens a PR and never
auto-deploys); a read-only Partner API over the baked pages under `/v1/public/*`;
and a self-contained `<calllint-trust>` web-component embed. The serving plane
carries **no scanner in the deployable by construction** — every dynamic surface
reads only committed static bytes, and the boundary is locked by dep-graph and
src-import tests. Trust Pages state a verdict *"observed at digest D at time T"* and
never "certified/verified safe." No new CLI command, scan behaviour, schema, or
verdict vocabulary — the engine is unchanged. Maintainer claim / Verified Publisher
(I2c) is designed (ADR 0047, Accepted) but not yet implemented.

### Added

- **Phase I / I1a — `@calllint/trust-index` (fixtures-only ingestion)** — the
  offline ingestion plane that bakes reproducible, digest-addressed Trust Pages by
  orchestrating the shipped scan + authority + `prepare` engines (no new verdict
  logic, no new scan). The first cohort is the ADR-locked `GOLDEN_CASES` fixture set
  under the reserved `calllint-fixtures/` namespace; each resource bakes to a JSON
  sidecar + an HTML page under `packages/trust-index/baked/`, plus a
  `calllint.trust-index.v0` index. Pages state a verdict **"observed at digest D at
  time T"** and never "certified/verified safe" (ADR 0038 §2). Malformed configs are
  recorded as `incomplete`, never silently dropped (ADR 0038 completeness).
  Reproducibility is enforced two ways: the whole reuse chain is clock/RNG-free so a
  re-bake is byte-identical, and a committed-tree test fails if the baked artifacts
  drift from a fresh emit (ADR 0046 §4). Serving is a later milestone — this
  milestone is the *only scanner* and touches no request path (ADR 0046 §1/§3).
- **Phase I / I1b-1 — serve baked Trust Pages same-origin (ADR 0046 §4, ADR 0038 §2)** —
  the bake output root moves from `packages/trust-index/baked` to
  `apps/web/public/trust`, the directory the web deploy ships to Cloudflare Pages. The
  committed pages **are** the served pages at `calllint.com/trust/…` — one store, no
  second copy, no scan at serve time. A new `language.ts` becomes the single source of
  truth for the Trust-page forbidden phrases (the affirmative overclaims
  certified/verified/approved/guaranteed safe); `project-facts.json` mirrors it as data
  for the `.mjs` public-copy guard, and a test binds the mirror to the constant so they
  cannot drift. `check:public-copy` gains serving-side checks over the committed bytes.
- **Phase I / I1b-2 — Official MCP Registry ingestion (ADR 0038)** — the first *external*
  Trust Index source. A PII-free, retained Registry snapshot plus a scheduled Actions
  workflow (`trust-ingest.yml`, weekly) that fetches, re-bakes, and **opens a PR** —
  merging is what deploys, so a human reviews before the public sees it (structural
  decoupling, ADR 0038 §3). The network edge (`fetchRegistry.ts`) is workflow-only, keeps
  only active+latest entries, caps at 25 (ADR 0038 §6 — not a crawl), and strips
  contact/keywords. Unmappable or duplicate entries are recorded as `incomplete`, never
  silently dropped. Registry and fixtures bake through one shared baker; the index lists
  both cohorts. Seed snapshot: 18 active → 17 UNKNOWN / 1 SAFE / 0 BLOCK (honest
  UNKNOWN for unresolvable remotes/packages). Two new public-copy checks: no email/PII,
  and completeness (no silent drops).
- **Phase I / I2a — read-only Partner API (`@calllint/partner-api`, ADR 0046 §4-§5,
  ADR 0038 §3-§4)** — the first *dynamic* surface of the serving plane: a pure request
  router over the pre-baked, digest-addressed Trust Pages, deployed as a Cloudflare Pages
  Function at the same origin under `/v1/public/*`. Routes (all GET, read-only):
  `/artifacts/{digest}` (resource by immutable digest), `/resources/{ns}/{name}`
  (resource by canonical name), and `/resources/{ns}/{name}/authority` (the authority
  slice only). Responses use a versioned envelope (`calllint.partner-api.v0`), a strong
  ETag from the page digest with 304 on `If-None-Match`, a CDN cache posture, first-party
  CORS, and uniform JSON errors that leak nothing. The safety invariant is structural,
  not disciplinary: the router's only capability is an `AssetReader` over committed static
  files — it cannot resolve, fetch, or scan, so no scanner is in the deployable by
  construction (locked by a dep-graph test and a src-import test).
- **Phase I / I2b — `<calllint-trust>` web component + reference embed (design §3.2)** —
  a single self-contained browser ESM file (`/embed/calllint-trust.js`, no build step, no
  dependencies, node-import-safe via `typeof` guards) that consumes the Partner API by
  `resource` or `digest`. It renders green only for SAFE, always shows the boundary note,
  and degrades to a no-JS fallback; it imports no scanner. Tests assert the shipped bytes
  (zero drift). Ships with an `example.html` reference embed.
- **Comm-1 — Team Beta landing page + design-partner intake** — the commercialization
  Comm-1 surface, buildable now with no backend. `apps/web/public/team.html` states the
  prescribed free-vs-paid boundary (local CLI stays free forever; Team centralizes shared
  org policy, approvals, receipts, drift evidence, cross-repo inventory) with a $99/org/mo
  willingness-signal price range (not a checkout), and states plainly that Team never
  changes a verdict (the engine stays deterministic and local). A `design-partner.yml`
  issue template doubles as the interview outline; the CTA links to it (triaged in GitHub
  Issues, no backend). Comm-2..4 (Stripe/tiers/credits) stay gate-locked.

## [1.5.1] — 2026-07-16 — Cross-OS Apply E2E & Tier-A Host Expansion

**Prove the writer, then add hosts.** This patch cuts what had accumulated on
`main` after 1.5.0: the single audited config writer is now proven on a real
filesystem across Windows/macOS/Linux, and both Cursor and Windsurf join Claude
Code as Tier-A install hosts on the strength of that gate — reaching the **3
Tier-A hosts** that unblock Phase I. No new command, schema, or verdict
vocabulary — the apply engine and plan format are unchanged.

### Added

- **Cross-OS CI matrix + real-filesystem apply E2E (ADR 0037 §6)** — the single audited
  config writer (`applyPlan` via the production node fs port) is now proven on a real
  filesystem by `tests/e2e/test/apply-engine.e2e.test.ts`: **20 positive + 20
  broken/conflict** cases asserting the on-disk effect (atomic write, backup bytes, O_EXCL
  lock, and no partial write on any fail-closed branch), plus a **measured** corruption-rate
  assertion (0% < 1% — the §6 kill gate computed from the run, not claimed). CI
  (`.github/workflows/ci.yml`) now runs the whole suite on a
  `[ubuntu-latest, macos-latest, windows-latest]` matrix — the literal Win/macOS/Linux E2E
  the Tier-A gate requires. Because the writer is host-agnostic, this makes every Tier-A
  host's apply path honestly gated (Claude Code retroactively covered).
- **Cursor host adapter — Tier A (C5 host expansion, host #2 of Phase I's ≥3)** — `calllint
  trust prepare --host cursor` resolves a target, decides over it, and emits a reversible
  `calllint.install-plan.v1` for Cursor's `.cursor/mcp.json` (project-scoped; `--host-config`
  overrides); `calllint trust apply` then writes the approved change atomically with backup +
  rollback. The adapter delegates apply to the same audited host-agnostic engine as Claude
  Code (no bespoke write logic). Tier A is earned by the real cross-OS apply E2E parametrized
  over the Tier-A hosts (20 positive + 20 broken/conflict each, ubuntu/macOS/windows,
  measured 0% corruption — ADR 0037 §6). (It shipped first at Tier B / plan-only within an
  earlier cycle, then was promoted once the §6 gate was met.)
- **Windsurf host adapter — Tier A (C5 host expansion, host #3 of Phase I's ≥3)** — `calllint
  trust prepare --host windsurf` resolves a target, decides over it, and emits a reversible
  `calllint.install-plan.v1` for Windsurf's `~/.codeium/mcp_config.json` (a single home-relative
  file on every OS, verified against the official Cascade MCP docs; `--host-config` overrides);
  `calllint trust apply` then writes the approved change atomically with backup + rollback,
  delegating to the same audited host-agnostic engine (no bespoke write logic). The one
  Windsurf-specific detail: a remote server is written under `serverUrl` (the Cascade field),
  not `url`. Tier A is earned by the same real cross-OS apply E2E, now parametrized over
  `[claude-code, cursor, windsurf]` (20 positive + 20 broken/conflict each). This also corrects
  the Windsurf discovery path, which previously guessed `%APPDATA%\Windsurf\mcp.json`.
  **Tier-A hosts: 3** (Claude Code + Cursor + Windsurf) — the Phase I gate (≥3) is now met.

### Fixed

- **`trust prepare --host` help + "Known hosts" errors now derive from the adapter
  registry** — the help text hardcoded "cursor (Tier B, plan-only)" and stayed stale
  after Cursor was promoted to Tier A; it now renders each host's tier/capability from
  `HOST_ADAPTERS` (a Tier-A adapter ships `applyPlan` → "applies"), and a new
  `host-help-parity` test binds the rendered help back to the registry so it cannot drift
  again. Copy-only; no behavior change to planning or apply.

## [1.5.0] — 2026-07-16 — Static Toxic-Flow Analysis & Continuous Guard

**See the composition, then keep watching it.** This release ships two layers on
top of the Trust Gateway: Phase F makes a cross-tool toxic *path* a first-class,
evidence-backed object folded into the verdict; Phase H turns a one-off decision
into a standing one with a Continuous Guard that re-decides the authority surface
whenever it changes. Both are pure-static and offline — the target is never
executed. No second verdict vocabulary and no new action/resource enum are
introduced.

### Added — Phase H: Install Guard & Growth

- **`calllint guard` — Continuous Guard (authority-change watch, ADR 0045)** — runs
  the gateway automatically at an authority-*change* moment and is **silent when
  nothing changed** (the retention promise). It reuses the shipped approved-state
  drift (`verify --approved`, ADR 0024) and the `SAFE/REVIEW/BLOCK/UNKNOWN`
  vocabulary — no new drift engine, no new verdict. A changed surface maps onto the
  stable exit codes (`REVIEW=10`, `UNKNOWN=20`, `BLOCK=30`); the guard's *own*
  failure fails closed (non-zero, never a pass). This is distinct from the
  necessity-gated per-call action guard (ADR 0042 / H3), which remains design-only.
- **`calllint guard install --host git|github`** — writes a declarative shim that
  only shells out to `calllint guard`: a git `pre-commit` hook, or the shipped
  drift-gate GitHub Actions workflow. No risk logic is copied into a host artifact.
- **`calllint guard status` / `disable` / `enable`** — one-key disable via
  `CALLLINT_GUARD=0` or `.calllint/guard.json`; a disabled guard exits 0 with a
  visible note (never a silent pass). The roadmap kill gate (noise → authority-delta
  only) is satisfied by construction: delta-only is the default.
- **One-use → persistent conversion prompt on `trust prepare`** — after a *usable*
  (non-BLOCK/UNKNOWN) preparation, the human-readable output offers the exact
  persistence commands (approve · guard install · CI gate · agent rule). It persists
  nothing by default, emits no telemetry, and never appears on `--json`.

### Added — Phase F: Static Toxic-Flow Analysis

**The path is the blocker.** A per-tool scan sees each tool in isolation, but the real
danger is a composition across tools: an untrusted/sensitive source reaching an external
sink. Phase F expresses that path as a first-class, evidence-backed, digest-sealed object
and folds it into the gateway verdict — pure-static, offline, deterministic, target never
executed. It is layered onto the shipped Authority Manifest; it introduces no second
verdict vocabulary and no new top-level command.

- **`trustSource` on `calllint.authority.v0` (ADR 0041)** — an optional, additive 12-value
  trust classification of the data at the head of a capability, derived deterministically
  from the already-captured signals (`read × secret → sensitive.secret`; a config
  `server.command` exec → `trusted.local_project`; anything not establishable → `unknown`).
  Absent or `unknown` reads as *not trusted* (I-04); an `unknown`-classified capability is
  byte-identical to a pre-F manifest.
- **`calllint.flow.v0` + `@calllint/flow-analyzer` (ADR 0040)** — a new sibling object and a
  pure analyzer that builds cross-capability toxic-flow paths (a trust-classified source,
  ordered steps, a terminal sink) over sealed Authority Manifest(s). `steps`/`sink` use the
  shipped closed 9-action × 10-resource authority vocabulary only. Each flow is digest-sealed.
- **CL-FLOW rule catalog (ADR 0040)** — an ordered, first-match rule table: untrusted/
  sensitive → external network (pinned) or financial spend = BLOCK; → unpinned network or
  messaging = REVIEW; an established trusted source → egress = ALLOW; a fail-safe REVIEW
  catch-all closes it so no dangerous composition can fall through to ALLOW. Each BLOCK/ALLOW
  rule ships paired ± fixtures.
- **`TOXIC_FLOW_COMPOSITION` reason code (#13, ADR 0044)** — a flow's `decisionHint` is
  folded into `calllint.decision.v0` as a `reasons` entry, aggregated by the same
  most-severe-verdict rule as every capability reason. A dangerous flow **raises** the
  verdict, never lowers it; an ALLOW flow contributes nothing. The frozen order of the
  original 12 codes (indices 0–11) is unchanged (append-only).
- **`calllint trust prepare --flows`** — surfaces the `calllint.flow.v0` objects behind a
  decision's `TOXIC_FLOW_COMPOSITION` reasons. With `--json`, emits `{ preparation, flows }`.
  No new top-level command — a `prepare` output switch. A remote MCP server with a secret
  env key now composes `sensitive.secret → connect × network` and resolves **BLOCK** end to
  end.
- **Release gate: a dangerous flow never resolves to SAFE (ADR 0040 §4)** — a new corpus
  gate step drives the built CLI over toxic/benign compositions, plus a `tests/invariants`
  property over ≥10 multi-tool snapshots. The 60-case offline corpus (38 real/redacted, 0
  dangerous-false-SAFE, UNKNOWN 10.0%) and its verdict distribution are unchanged.

## [1.4.0] — 2026-07-15 — Evidence Interoperability

**Aggregate, don't impersonate.** CallLint can now attach another scanner's report
to a scan and show it beside its own verdict in a joint Trust Packet — content risk
(the external scanner) and authority risk (CallLint) side-by-side, unmerged, with one
line explaining why they differ. External evidence is provenance-preserved and never
re-scored: it can never move the CallLint verdict, and a degraded or partial content
scan is never treated as a pass. This closes the v1.2.0 Evidence-Interoperability
milestone (B3 + B4); the schema and `evidence import` adapter shipped in 1.3.0-era work
(ADR 0034).

### Added

- **`calllint scan <target> --evidence <file>` (ADR 0034)** — attach an external
  content-scanner report (e.g. SkillSpector JSON/SARIF) to a scan. The envelope is
  imported via `@calllint/evidence` (fail-closed; a missing file is a usage error, an
  unparseable report imports as `completeness: failed`) and attached to the report as an
  optional projection (`evidence?` on `calllint.report.v0` — additive, no schema break).
  `--evidence-format json|sarif` forces the format when auto-detection is ambiguous.
  - **Joint Trust Packet** — the human-readable output gains a *Content scan* vs
    *Authority scan* block plus a "why they differ" line. Machine formats
    (`--json`/`--sarif`) carry the evidence in the report projection.
  - The scan verdict path is byte-identical without `--evidence`; the offline corpus
    (60 / 38 real-redacted / 0 dangerous-false-SAFE / UNKNOWN 10.0%) is unchanged.
- **`agent-trust-bench`** (`packages/fixtures/bench/`) — a reproducible benchmark proving
  SkillSpector (content) and CallLint (authority) are complementary. Four seed cases
  (clean content + broad `$HOME`; clean content + admin OAuth; safe content + auto-payment;
  a partial content scan that is never a pass). Run with `pnpm bench:test` (offline, drives
  the built CLI over committed fixtures; SkillSpector is never executed). Wired into CI and
  the release gate.
- **`secure-agent-install` skill** (`skills/secure-agent-install/`) — an open, neutral,
  installs-nothing-by-default workflow: run SkillSpector on the content, ask CallLint
  whether the requested authority is acceptable (`trust prepare --evidence`), read the
  joint Trust Packet, and install only after approval. Ships host manifests for Claude
  Code / Cursor / Codex and a thin runner. No partnership or "verified" language.
- **`EVIDENCE.md`** — the evidence-interoperability user guide.

## [1.3.0] — 2026-07-14 — Trust Gateway Core

**From scanning to acting — safely.** CallLint gains a read-only Trust Gateway:
resolve an agent-tool target, judge it deterministically, and emit a reversible
install plan. Applying that plan is the *only* thing that ever writes live
config — it re-validates, writes atomically, verifies, and rolls back on
failure — and every approval produces a signed, tamper-evident decision receipt.
The gateway never executes, installs, or connects to the target it judges.

### Added

- **Trust Gateway (Phase G, ADR 0035–0039)** — a deterministic, fail-closed
  pipeline over six sealed digests (artifact → evidence → authority →
  decision/policy → install-plan → receipt). `UNKNOWN` never becomes `SAFE`;
  external evidence can tighten a verdict but never set it alone.
  - `calllint trust prepare <target> [--host <id>] [--evidence <f>] [--write-plan]`
    — read-only: resolve a target (Git URL / dir / SKILL.md / MCP config, branch
    pinned to an immutable commit), judge it, and optionally emit a reversible
    JSON-Patch install plan (`calllint.install-plan.v1`). Never touches live config.
  - `calllint trust show <plan>` / `trust explain <plan>` — inspect a plan.
  - New schemas: `calllint.artifact.v1`, `calllint.authority.v0`,
    `calllint.decision.v0`, `calllint.install-plan.v1`, `calllint.apply-result.v1`.
  - New package `@calllint/install-planner` — plan assembly + the apply engine.
- **Verified Apply Gateway** — `calllint trust apply --plan <file> --approve <plan-digest>`
  is the only writer of live config. TOCTOU re-validation (drift → `PLAN_STALE`),
  config locking, atomic temp→fsync→rename write, backup, idempotency
  (`already_applied`), and automatic rollback on verification failure. Claude
  Code ships at Tier A (the audited write surface).
- **Decision Receipt v1 + gateway drift taxonomy (G7)** — durable proof of an
  approval and a way to detect when the approved state later drifts.
  - New schema `calllint.receipt.v1` (the *decision receipt*): binds the full
    six-digest chain plus the approval, apply result, and expiration. Distinct
    from the scan receipt `calllint.receipt.v0`. See ADR 0039.
  - `calllint trust apply --receipt <file>` writes a decision receipt after an
    apply; `--sign --key <keyfile>` signs it with a local ed25519 keypair
    (reusing `receipt keygen`); `--approver <name>` sets attribution.
  - `calllint trust verify <receipt> [--public-key <keyfile>]` validates a
    receipt read-only: structure, the six digests, the approval binding, expiry,
    and (with a key) the ed25519 signature. It never re-judges, re-scans, or
    executes the target. Exit 0 = valid, 1 = invalid/tampered.
  - Deterministic receipt builder: identical inputs produce byte-identical
    receipts (timestamps and versions are injected, `receiptId` is derived).
  - Gateway drift taxonomy: 9 signals labeled into 4 change classes (artifact,
    authority, evidence, policy) plus `expired` / `signatureChainBroken`
    integrity flags — all classification is pure.

## [1.1.0] — 2026-07-04 — Stream 1: Auto-Discovery

**Zero-config scanning.** CallLint now automatically discovers agent configurations across your system — no manual path configuration required.

### Added

- **Auto-Discovery (Stream 1)** — Zero-config scanning via `calllint scan --auto`
  - New command: `calllint inventory` — list all discovered agent configs
  - New flag: `calllint scan --auto` — discover and scan all agents automatically
  - New flag: `calllint scan --agent <type>` — scan a specific agent type
  - **Supported agents**: Cursor (P0), Claude Code (P0), Claude Desktop (P0), VS Code (P1), Windsurf (P1)
  - Cross-platform path resolution (Windows, macOS, Linux)
  - No manual path configuration required — agents are discovered automatically
  - See ADR 0033 for architecture details
- Example MCP configs for VS Code and Windsurf added to `examples/mcp-configs/`

### Changed

- README Quick Start now shows `scan --auto` as the primary example
- Help text updated to list all 5 supported agent types

## [1.0.1] — 2026-07-02 — Fix: synchronous receipt signing

### Fixed

- **`receipt keygen` / `sign` / signed `verify` no longer hang.** The R6 CLI
  bridged async ed25519 calls to the synchronous command layer with a
  busy-wait spin loop, which starved the event loop so the crypto Promise
  could never resolve — these commands hit their 5s timeout 100% of the time
  in 1.0.0. ed25519 over a fixed 32-byte hash is a pure CPU operation with no
  I/O, so `@calllint/signature` is now fully synchronous (`@noble/ed25519`
  sync API backed by Node's `crypto` sha512) and the CLI calls it directly.
  No receipt schema change (ADR 0032); implementation-only fix.

### Added

- E2E coverage for the signing flow (`keygen → sign → verify`, tamper
  detection, missing-key, double-sign) using a real child process, plus
  synchronous-contract guards in the signature unit tests.

## [1.0.0] — 2026-07-02 — R6: Cloud Signed Receipt Infrastructure

**First 1.0 release.** Activates the signature infrastructure for CallLint receipts,
enabling cryptographically signed receipts that prove provenance and integrity.
Local scan and local receipts remain 100% free. Cloud signing infrastructure is
ready for future service deployment.

### Added

- **Receipt Signature Support (ADR 0032)**
  - Signature field activated in `calllint.receipt.v0` schema
  - `algorithm`, `key_id`, `value`, `signed_at`, `public_key_url` fields
  - Ed25519 deterministic signatures (64 bytes, fast, industry-standard)
  
- **@calllint/signature Package**
  - `generateKeypair()` — generate test ed25519 keypairs
  - `signReceipt()` — sign receipt hash with ed25519
  - `verifyReceipt()` — verify signature cryptographically
  - `exportKeypair()` / `importKeypair()` — JSON serialization
  - 18 tests covering round-trip, tampering detection, edge cases

- **CLI Receipt Commands**
  - `calllint receipt sign <receipt.json> --key <keyfile>` — local signing (dev/test only)
  - `calllint receipt keygen --out <file>` — generate test keypair
  - `calllint receipt verify <receipt.json>` — now includes crypto validation when signature present
  - `--public-key <keyfile>` flag for offline verification

- **@calllint/credits Package (Internal)**
  - `calculateCredits()` — internal metering for signed receipts
  - Formula: base + findings × per_finding × verdict_multiplier
  - 13 tests covering all verdicts, batch calculation, determinism
  - **No public pricing documentation** (infrastructure only)

- **API Design Documentation**
  - `CLOUD_VERIFICATION_API.md` — complete cloud service specification
  - `POST /v1/receipts/sign` — sign receipt endpoint
  - `GET /.well-known/receipt-keys.json` — public key distribution
  - Security model, privacy guarantees, key rotation procedures
  - **Design only** — service deployment out of v1.0.0 scope

### Changed

- Receipt signature field fully specified (was placeholder in v0.8.0)
- `CallLintReceipt` type now includes `signed_at` and `public_key_url` in signature

### Security

- **What signatures prove:** Provenance (CallLint issued this) + Integrity (not modified)
- **What signatures do NOT prove:** Safety, completeness, future/runtime behavior
- **Privacy:** Receipt hash prevents cloud from indexing findings
- **Offline verification:** Anyone can verify with public key from `.well-known/`
- **Key rotation:** 6-month cadence (H1/H2), old keys kept for historical verification

## [0.10.1] — 2026-07-02 — R5 Runtime: Agent Inbox Inspect
- `calllint inbox inspect <normalized-event.json>` command (ADR 0031)
  - Reads normalized agent inbox events (`calllint.agent-inbox-event.v0`)
  - Extracts optional `action_candidate` field
  - Delegates to R4 action analyzer for verdict + findings
  - Supports `--receipt` / `--receipt-out` flags (reuses ADR 0028 receipt schema)
  - Tested against all 12 fixture pairs (6 providers × 2 examples)
- Composition layer only: NO OAuth, NO provider SDKs, NO webhook server, NO mailbox polling
- Closes the inbox → action preflight loop (R5 design → R5 runtime)

## [0.10.0] — 2026-07-02 — R5 Design: Provider-Agnostic Agent Inbox Spec

**Design-only release.** Establishes the schema, adapter contract, and fixture corpus
for normalizing inbox events (email, Slack, Discord) into the unified
`calllint.agent-inbox-event.v0` format. **Zero runtime code** — no CLI command, no
SDK, no OAuth/webhook/mailbox/sending. Future adapter implementations validate
against these fixtures.

### Added

- **Agent Inbox Schema** (`calllint.agent-inbox-event.v0`)
  - `schemas/agent-inbox-event.schema.json` — normalized inbox event from any provider
  - Required fields: `schema_version`, `event_type`, `timestamp`, `source`, `normalized_content`
  - Five `event_type` values: `email.received`, `message.posted`, `mention.detected`,
    `direct_message.received`, `thread.replied`
  - Optional `action_candidate` field embeds a `calllint.action.v0` descriptor,
    enabling inbox events to flow into the R4 action preflight engine

- **Adapter Contract** (`docs/AGENT_INBOX_ADAPTER_CONTRACT.md`)
  - Transformation rules: provider-specific event → normalized schema
  - Required field extraction (timestamp, from, to, attachment hashes)
  - Secret-stripping rules (header keys only, never values)
  - Error handling (malformed events, missing fields)

- **Usage Guide** (`docs/AGENT_INBOX_PREFLIGHT.md`)
  - 3-stage chain: normalize → extract `action_candidate` → `calllint action inspect`
  - Two worked examples: email reply with secret headers → REVIEW verdict;
    invoice → payment candidate → financial action detected
  - When to run preflight, out-of-scope list

- **Fixture Corpus** (6 providers × 2 examples = 12 pairs)
  - Resend, SendGrid, Gmail API, Slack, Discord, SMTP/IMAP
  - Each provider: 1 clean baseline + 1 `action_candidate` chain
  - All 5 `event_type` values exercised across corpus
  - Six `action_candidate` chains proven through R4 analyzer:
    - 2 surface findings (`secrets.env-key`, `action.financial-observed`)
    - 4 are clean (SAFE)

- **Test Suite** (`packages/fixtures/test/agent-inbox.test.ts`)
  - 7 tests: schema invariants, no-secret-leak, raw/normalized pairing,
    event_type coverage, `action_candidate` structural validity
  - Asserts ≥12 normalized fixtures, all 5 event_types present, ≥6 candidates

### Design Decision

- **ADR 0030**: Provider-Agnostic Agent Inbox Spec (Proposed)
  - Reuses `action_candidate` field to embed `calllint.action.v0` descriptors
  - No new verdict logic, no new risk symbols — inbox events are carriers
  - Adapter is a pure function (stateless, idempotent, language-agnostic)

### References

- PR #99: R5 schema + adapter contract + initial fixtures (7c649af)
- PR #101: Expand fixtures to 2/provider + preflight guide (acfc6f7)
- ADR 0030 (Proposed), ADR 0029 (action_candidate reuse), ADR 0028 (receipt schema)
- new5 master plan: R5 / v0.10.0 scope

## [0.9.3] — 2026-07-02 — R4 Complete: Receipt Integration + Full Coverage

### Added

- **R4 Complete: Action receipt generation** via `calllint action inspect --receipt`
  - Integrated ADR 0028 receipt schema for action verdicts
  - Added `--receipt` and `--receipt-out` flags to action command
  - Receipt subject type now supports both `"scan"` and `"action"`
  - Default output: `calllint-action-receipt.json`

- **Complete fixture coverage for all 9 action kinds** (+5 fixtures, 24 total)
  - `email.forward`: positive-clean-forward.json + negative-missing-attachment-hashes.json (was 0, now 2)
  - `message.post`: negative-secret-headers.json (was 1, now 2)
  - `payment.authorize`: positive-small-verified-payment.json (was 1, now 2)
  - `a2a.delegate`: positive-secure-delegate.json (was 2, now 3)
  - All 9 kinds now have ≥1 positive + ≥1 negative fixture

### Changed

- Updated `packages/fixtures/action/README.md` to reflect actual implementation status
  - Removed stale "design phase, no real fixtures yet" text
  - Added coverage matrix: 9 positive + 15 negative = 24 fixtures
  - Documented full directory structure with all fixture names
- Receipt schema (`calllint.receipt.v0`) subject.type enum expanded from `["scan"]` to `["scan", "action"]`
- Action command help text now documents `--receipt` and `--receipt-out` options

### Fixed

- R4 DoD compliance: all action kinds now meet "≥1 positive + ≥1 negative" fixture requirement

## [0.9.2] — 2026-07-02 — R4 Enhanced: Complete Detectors + Fixtures

### Added

- **Complete fixture coverage for all 9 action kinds** (+12 fixtures, 19 total).
  - `github.write`: 3 fixtures (positive create-pr, negative unverified-repo with excessive scopes, negative external-links)
  - `npm.publish`: 3 fixtures (positive clean-publish, negative name-squatting, negative version-float)
  - `cloud.modify`: 3 fixtures (positive small-instance, negative expensive-instance, negative open-all-ports)
  - `account.register`: 3 fixtures (positive clean-registration, negative unverified-service, negative excessive-scopes)

- **Enhanced detectors for all 9 action kinds** (+8 detectors, 13 total).
  - `supply.name-squatting` — Detect npm package name typosquatting (similar to popular packages)
  - `supply.version-float` — Detect unpinned npm versions (^/~ ranges instead of exact)
  - `action.unverified-repository` — GitHub write to unverified repository
  - `action.excessive-github-scopes` — Dangerous GitHub OAuth scopes (delete_repo, admin:org)
  - `action.external-links` — External links in GitHub PR/issues
  - `action.expensive-cloud-resource` — Cloud resource cost detection (>$1000/month)
  - `action.insecure-security-group` — Cloud security group opens all ports (0.0.0.0/0)
  - `action.unverified-service` — Account registration on unverified service
  - `action.excessive-oauth-scopes` — Excessive OAuth scopes for account registration

**Tests:** +9 new tests (529 total, was 520)

**Coverage Matrix:**
- email.reply: 3 fixtures, 3 detectors ✓
- message.post: 1 fixture, 1 detector ✓
- a2a.delegate: 2 fixtures, 2 detectors ✓
- payment.authorize: 1 fixture, 1 detector ✓
- account.register: 3 fixtures, 2 detectors ✓
- github.write: 3 fixtures, 3 detectors ✓
- npm.publish: 3 fixtures, 2 detectors ✓
- cloud.modify: 3 fixtures, 2 detectors ✓
- email.forward: 0 fixtures (shares detectors with email.reply)

## [0.9.1] — 2026-07-02 — R4 Runtime: Action Inspect Command

### Added

- **`calllint action inspect` — Unified External Action Preflight (R4 runtime, ADR 0029).**
  Inspect planned external actions before execution. Takes a `calllint.action.v0` JSON
  descriptor and returns SAFE / REVIEW / BLOCK / UNKNOWN with findings, applying the same
  risk symbols (PROMPT / SUPPLY / FILES / NETWORK / EXEC / ACTION / MONEY / SECRETS) and
  verdict engine as MCP scans. Supports 9 action kinds: `email.reply`, `email.forward`,
  `message.post`, `a2a.delegate`, `payment.authorize`, `account.register`, `github.write`,
  `npm.publish`, `cloud.modify`. Implemented detectors: `action.unverified-attachment`
  (email attachments without SHA-256 hashes), `action.missing-delegate-target` (a2a
  delegation without target), `action.insecure-delegate-target` (HTTP not HTTPS),
  `action.financial-observed` (payment with monetary amount), `secrets.env-key`
  (secret-shaped header keys). Terminal and JSON output modes. Policy support via
  `--policy`. See ADR 0029.

**Usage:**
```bash
calllint action inspect payment.json
calllint action inspect email-reply.json --json
calllint action help
```

**Package:** New `@calllint/action-analyzer` package implements the core analysis logic.

## [0.9.0] — 2026-07-02 — R4 Design Checkpoint (Unified External Action Preflight)

### Added (Design-only, no runtime implementation)

- **`calllint.action.v0` schema — Unified External Action Preflight (ADR 0029).**
  Design checkpoint for R4. Schema defines 9 action kinds (email.reply/forward,
  message.post, a2a.delegate, payment.authorize, account.register, github.write,
  npm.publish, cloud.modify) with kind-specific parameters and metadata. Reuses
  existing risk symbols (PROMPT / SUPPLY / FILES / NETWORK / EXEC / ACTION /
  MONEY / SECRETS) and verdict engine. This release contains the schema
  (`schemas/action.schema.json`), fixture contract (`packages/fixtures/action/`
  with 9 stub directories), and design ADR (local docs) — the `calllint action
  inspect` command implementation is a future release. See ADR 0029.

**Note:** This is a design checkpoint release. The `action inspect` command is
not yet implemented. The schema and fixture structure are provided for review
and integration planning. This version will not be published to npm — use
v0.8.1 for the latest runtime features.

## [0.8.1] — 2026-07-02 — Online registry surface (邻接校准)

### Added

- **Registry-metadata prompt surface under `--online` (ADR 0027).** With
  `--online`, the npm registry's own model-visible text — the resolved version's
  published `description`, and the registry document's `readme` when it already
  carries one — is routed through the *existing* prompt-surface detectors
  (`prompt.poisoning` / `prompt.hidden-instructions`) via the same
  `analyzeDocumentSurfaces` path a local `README`/`SKILL.md` uses (ADR 0015). A
  package whose local config is clean but whose published `description` hides a
  model-directed or obfuscated instruction now surfaces the existing
  `prompt.surface-instructions` finding (PROMPT, S2, REVIEW, non-blocker),
  stamped `source:"online"` + `fetchedAt`, with the surface origin recorded in
  evidence (`registry:<name>#description` / `#readme`). No new detector, reason
  code, or `ScanReport` schema change — only the evidence's surface origin and
  online provenance stamp are new. Per ADR 0006 this online-derived text is
  advisory: it may raise a verdict to REVIEW and never downgrades one or
  manufactures SAFE. **Offline default is unchanged** — with no `--online`,
  nothing here runs and the deterministic verdict is byte-identical. The offline
  60/38 corpus gate (never passes `--online`) is the standing proof of that
  invariance; the online surface is covered by replay fixtures (a real benign
  `description` ⇒ no finding; a real base with a clearly-labelled synthetic poison
  payload ⇒ REVIEW) with no live network in CI. See ADR 0027.

## [0.8.0] — 2026-07-01 — Receipt-first trust layer (new5 R3)

### Added

- **Local receipts — `scan --receipt` + `receipt verify` (new5 R3, ADR 0028).**
  A receipt (`calllint.receipt.v0`) is a small local JSON file that records the
  outcome of a scan: which CallLint version produced which verdict, over which
  input, under which policy/ruleset context, with per-finding references
  (`rule_id`, `severity`, `evidence_path` — never an evidence value). It is a
  pure *reporting layer* over the existing `calllint.report.v0` scan report:
  `verdict`, `risk_counts`, and `finding_refs` are read straight from that
  report — a receipt never re-scans, re-judges, executes a target, contacts the
  network, or reads a secret value (the `trust_boundaries` block is type-locked
  to encode this). `scan --receipt [--receipt-out <file>]` writes the receipt
  *after* the normal scan (unchanged output and exit code; absent flag ⇒
  byte-identical behavior); `receipt verify <file>` structurally validates it
  offline (exit 0 valid / 1 invalid). Hashes reuse `@calllint/fingerprint`. The
  receipt is unsigned — the `signature` field is reserved for a future release
  and never populated. A receipt is not a proof of runtime safety and never
  certifies a tool. Author guide: [`RECEIPTS.md`](RECEIPTS.md). See ADR 0028.
- **GitHub Action — optional `receipt` artifact (new5 R3).** The `calllint`
  Action gains `receipt` (default `false`) and `receipt-file` inputs. When
  `receipt: true` it runs `scan --receipt --receipt-out <file>` and uploads the
  receipt as a build artifact. `receipt: false` leaves the Action's SARIF
  upload, Markdown step summary, and `--ci` gate behavior unchanged — the
  receipt is additional evidence, never a new gate.

### Fixed

- **Receipt schema cites ADR 0028 by number.** `schemas/receipt.schema.json`
  previously referenced `docs/adr/0028-…md`, a path under the gitignored `docs/`
  tree; it now cites "ADR 0028" like the rest of the tracked docs. The
  public-copy guard also now verifies the README corpus numbers against
  `project-facts.json` (previously only the homepage was checked).

## [0.7.0] — 2026-07-01 — Trust badge (Phase 6) + docker inline secret keys

### Added

- **`calllint scan --badge` — Trust badge (Phase 6, ADR 0026).** Emits a
  shields.io *endpoint* JSON badge (`{schemaVersion, label:"CallLint", message,
  color}`) for the aggregate verdict. Like `--sarif`/`--markdown`, it is a new
  projection of the existing `calllint.report.v0` verdict — no `ScanReport`
  schema change, no verdict decision of its own. An MCP author commits
  `calllint-badge.json`, points a shields.io endpoint badge at it, and refreshes
  it in CI. Transparency over false comfort: only `SAFE` is green; `REVIEW`,
  `UNKNOWN`, and `BLOCK` each carry a distinct non-green colour (a `no-green-only`
  test locks this). Author guide: [`badge.md`](badge.md).

### Changed

- **Docker inline `-e` secret keys are now inspected (ADR 0016).** The secret
  detector reads the `env` block *and*, for a `docker` runtime, the env-var keys
  passed inline via `-e KEY[=value]` / `--env KEY[=value]` (never a value;
  `--env-file` is ignored). A credential-shaped var passed inline with no `env`
  block — e.g. `-e GDRIVE_CREDENTIALS_PATH=…` — now emits `secrets.env-key`
  (SECRETS, S2, REVIEW, non-blocker), the secrets-detector analogue of ADR 0012's
  docker bind-mount host-path extraction. Same finding id; no schema change. Only
  verdict delta: corpus `C049` docker inline-cred SAFE → REVIEW (deliberate,
  safe-direction, pre-recorded in the case provenance). Keys are matched by shape,
  so a non-credential inline var (`-e DOCKER_CONTAINER=true`) stays unflagged. See
  ADR 0016.
- **`calllint-mcp@0.1.1` — MCP Registry readiness.** Adds `mcpName`
  (`io.github.calllint/calllint`) to the package so the official MCP Registry can
  verify npm package ownership, and aligns `server.json` to the live registry
  schema (`2025-12-11`, camelCase fields). Published via OIDC + provenance by a
  new dedicated `publish-mcp.yml` workflow (triggered by a `mcp-v*` tag), which
  also submits the entry to the MCP Registry using GitHub OIDC (no stored token).
  `calllint-mcp` is no longer published by `release.yml` — one package per
  workflow. No tool, verdict, or engine change.

## [0.6.0] — 2026-06-29 — Agent rules, approved-state drift gate (L4), and the `calllint-mcp` safety gate

The distribution release. It carries the new4 Layer S–Phase 3 capability core
(capability fingerprint + compact decision + surface extractors) onto the stable
line and builds three layers on top of it, without weakening a single verdict
(corpus floor unchanged: 0 dangerous false-SAFE, UNKNOWN 10.0%).

### Added

- **Agent distribution rules (Phase 3).** `calllint gen-rule --host <h>` emits a
  token-frugal CallLint safety rule for Claude, Cursor, Copilot, Codex, Gemini,
  Windsurf, Cline, and a generic `AGENTS.md` host, from a single source of truth.
- **Approved state + drift gate (Phase 4, L4 — ADR 0024).** `calllint approve`
  records the repo-wide capability surface as `.calllint/approved.json`
  (`calllint.approved.v0`, keyed on the capability fingerprint — distinct from the
  Evidence-layer baseline). `calllint verify --approved` diffs the current surface
  against it; drift never collapses to SAFE. A path-filtered
  `.github/workflows/calllint.yml` runs the gate (`verify --approved --ci`).
- **`calllint-mcp` (Phase 5 — ADR 0025).** A new, separately published MCP server
  exposing CallLint as a static preflight safety gate: tools `scan_mcp_config_path`,
  `scan_mcp_config_json`, `verify_baseline`, `explain_finding`,
  `generate_agent_rule`, `generate_ci_gate_snippet`. Thin wrapper — every tool
  delegates to the engine; zero runtime dependencies; never executes a scanned
  server. First published as `calllint-mcp@0.1.0`.

### Notes

- No `ScanReport` schema, exit-code, verdict, or detector change in this release —
  SAFE is exactly as hard to reach as in 0.5.0. The additions are distribution and
  workflow layers around the existing engine.

## [0.5.0] — 2026-06-29 — PR-gate trifecta + policy guide & override `owner`

The decision-point release. Its core closes the pull-request gate end-to-end
without touching the engine: a `--markdown` renderer, a `scan --changed` git-diff
entry point, and a thin `calllint/calllint@v1` GitHub Action compose the existing
CLI into a PR check. It also ships a policy authoring guide and one additive,
ADR-backed policy-schema field (`owner` on `PolicyOverride`). No `ScanReport`
schema, exit-code, verdict, or detector change — SAFE is exactly as hard to reach
as in `0.4.0`; the only schema movement is the additive `calllint.policy.v0`
`owner` field, which leaves the set of verdicts an override can produce unchanged.

### Added
- **Policy guide (`policy.md`)** + ready-to-copy examples in `examples/policies/`
  (`ci-block-only`, `ci-strict`, `override-timeboxed`), with a validation test
  asserting every shipped example is valid `calllint.policy.v0` (S5). The guide
  describes only verified behavior (CI exit codes and the `BLOCK → REVIEW`
  override); declared-not-read fields are called out as such.
- **`owner` on `PolicyOverride`** — an optional, validated-if-present accountable
  identity (handle/team/email) for a security exception. Recorded and echoed in
  the `policy.applied` diagnostic, never interpreted. Additive, non-breaking
  (ADR 0017-B, `adrs/0017-override-owner-accountability.md`). Schema-additive
  MINOR; the set of verdicts an override can produce is unchanged.
- **`calllint scan --markdown`** — a deterministic, emoji-free Markdown renderer
  for the `ScanReport` (verdict, per-server findings with evidence/impact/fix,
  exit-code legend), derived from the same `calllint.report.v0` the other
  renderers consume. Designed for a PR Step Summary; pipe-safe (table cells are
  escaped). No schema change — it is a view, like `--sarif`/`--html`.
- **CallLint GitHub Action** (`uses: calllint/calllint@v1`) — a thin composite
  action wrapping the published CLI: installs `calllint`, scans the config,
  captures the aggregate verdict as an output, uploads SARIF to Code Scanning,
  writes a Markdown report to the PR Step Summary, and gates the build on the
  verdict. It invents no new gate semantics — the pass/fail decision is the CLI's
  own `--ci` exit code driven by the policy's `ci.failOn` set. Inputs: `target`,
  `version`, `policy`, `online`, `surface-dir`, `sarif`, `step-summary`, `gate`.
  Exercised by an in-repo self-test workflow (`action-selftest.yml`) over SAFE,
  BLOCK report-only, and BLOCK-gates fixtures. Never executes the scanned server.
- **`calllint scan --changed`** — scans only the agent-tool configs that appear
  in the git diff (`git diff --name-only HEAD`), filtered to the known config
  locations (`.cursor/mcp.json`, `.mcp.json`, `mcp.json`, `.claude/settings.json`,
  `.vscode/mcp.json`). The git-diff PR-gate decision point: it cuts reviewer noise
  by skipping unchanged configs and composes with every existing flag (`--ci`,
  `--markdown`, `--json`, `--policy`, `--surface-dir`). No relevant change → a
  no-op exit 0. One changed config behaves exactly like `scan <path>`. For
  multiple, the process exit code is the worst child verdict; `--json` emits a
  JSON array of unchanged `calllint.report.v0` summaries and other formats are
  concatenated. No `ScanReport` schema change. The git diff source is best-effort
  (a non-repo or missing git yields "nothing to scan", never a crash).

## [0.4.0] — Post-stable detector + corpus + prompt-surface

Post-stable detector and corpus work (R2.2 batches 4–6, R3 `diagnostics --json`,
R3-adjacent calibration ADRs, and R4 prompt-surface v0 + local-document increment).
These change verdict behaviour for specific config shapes in the **safe direction**
(they add findings the engine previously missed) and are gated by ADRs, positive +
negative fixtures, unit tests, and a corpus impact pass per the development
contract. No `ScanReport` schema, exit-code, or policy change — SAFE is only
harder to reach.

### Added
- **R3 `calllint diagnostics --json`** — a stable, editor/agent-host-friendly
  machine protocol under its own schema version `calllint.diagnostics.v0`,
  derived purely from an existing `ScanReport` (no new analysis, no verdict
  change, no network). Emits one diagnostic per finding with finding id,
  severity, file + config key-path, observed value, remediation, and verdict
  contribution — including real source line/column for config-mapped evidence.
  This is the geology under any future IDE/agent-host integration, which is why
  it precedes any plugin. See ADR 0013
  (Accepted, implemented).
- **R4 local-document prompt surface** — opt-in `calllint scan --surface-dir <dir>`
  reads a bounded, offline allowlist of project documents (`README.md`, `SKILL.md`,
  `AGENTS.md`, and `package.json` `description`) and runs the prompt-surface scanners
  over them, emitting a project-level `prompt.surface-instructions` (PROMPT, S2,
  REVIEW, non-blocker) finding with a surface path and FP note. Default behaviour is
  unchanged — with no flag, nothing beyond the config is read. Bounded (256 KiB/file,
  named allowlist, no globbing/recursion/symlinks), offline, never executes. The
  `prompt.poisoning` / `prompt.hidden-instructions` scanners were extracted to one
  shared module so the config-metadata and document surfaces flag identically. See
  ADR 0015.
- **R4 prompt-surface v0** — new detector `prompt.hidden-instructions` (PROMPT, S2,
  REVIEW, non-blocker) flags hidden/obfuscated content in the model-visible surface
  (server instructions + provided tool name/description/schema text): zero-width and
  invisible characters, Unicode bidirectional overrides (Trojan-Source class),
  tag-character ASCII smuggling, and embedded HTML/XML comments. Complements the
  existing `prompt.poisoning` literal-phrase blocker by catching its evasion. Static
  shape detection only — never a prompt-injection claim.
  See ADR 0014.
- **`exec.unverified-local-source`** (EXEC, S2, REVIEW, non-blocker) — flags a
  runtime that executes a local script/binary CallLint never inspects (`node
  ./server.js`, `uv run python -m …`, an unrecognized local binary) and that is
  neither a recognized package, a docker image, nor a remote. SAFE is now reachable
  only for recognized, inspectable sources. See
  ADR 0011 (Accepted,
  Direction 2).

### Changed
- **Docker bind-mount host paths are now inspected.** The broad-path detector
  extracts the host side of `--mount type=bind,src=…`/`source=…`, `-v host:container`,
  `--volume`, and inline `--mount=…` forms (drive-letter aware) and runs the
  broad-path check on it (never the container `dst`, never a named volume). A config
  that binds a broad host directory into a container now emits `files.broad-path` →
  BLOCK. Same finding id; no schema change. See
  ADR 0012 (Accepted).
- **Corpus re-verdicts (deliberate, ADR-gated):** `C023` docker bind-mount
  SAFE → BLOCK (ADR 0012); `C035` bare-node and `C040` local-uv-python SAFE → REVIEW
  (ADR 0011 Direction 2). Each case's contract, notes, and `index.json` updated;
  `thisCaseMustNeverBeSafe` set where a blocker now applies.
- **R2.2 corpus → 60 cases** (real/redacted floor 38). Batch 4 (C041–C045): R4
  hidden-instructions seed + real gitlab/sqlite/google-maps/github-remote shapes.
  Batches 5–6 (C046–C060): R4 local-document surface seeds (README/SKILL.md/
  package.json/AGENTS.md via `--surface-dir`) + a clean-surface negative; four more
  real shapes (redis docker-url SAFE, sentry uvx arg-token, gdrive docker-volume SAFE,
  everart docker-secret); and docker mount/volume branch locks
  (`-v`/`--volume`/`--mount=`/`source=` alias/`type=volume`). Acceptance floor
  ratcheted 40/30 → 60/38; dangerous false-SAFE stays 0; UNKNOWN ratio 10.0% (≤ 15%).

### Deferred (recorded, not yet implemented)
- **ADR 0016** — docker `-e KEY[=value]` env keys are not extracted by the secret
  detector (it reads the `env` block, not docker args), so a credential-named var
  passed inline via `-e` with no `env` block is not flagged. A non-blocker
  (REVIEW-class) under-call, the secrets-detector analogue of ADR 0012; anchored by
  corpus case C049. See
  ADR 0016. **(Resolved: implemented in `[Unreleased]` — the extractor now inspects
  docker `-e`/`--env` keys; C049 flips SAFE → REVIEW accordingly.)**


## [0.3.0] — First stable release

First stable release of CallLint, published to the `latest` dist-tag. **No
scanner-semantics change since `0.3.0-rc.1`**: the engine, detectors, verdict
rules, golden expectations, and exit codes are byte-identical — this release
promotes the validated rc.1 to stable and corrects the dist-tag drift. "Stable"
means the **CLI contract, verdict semantics, report schema v0, release chain, and
CI integration are stable** — not that any scanned tool is proven safe (CallLint
is a static, offline, heuristic pre-flight scanner; see `SECURITY.md` /
`LIMITATIONS.md`).

### Changed
- Promoted to the `latest` dist-tag and corrected the known dist-tag drift:
  `latest` now points at `0.3.0` (it had pointed at `0.3.0-preview.0`, published
  before the release workflow derived dist-tags from the version). See
  RELEASE_VERIFICATION.md §1.
- Documented install path moves from `npx calllint@preview` to `npx calllint`
  (the `latest` tag now serves stable).

### Included since the preview line (no behaviour change at promotion)
- **RC-BLK-01 fix** (shipped in `0.3.0-rc.1`): unrecognized or empty MCP server
  shapes resolve to `UNKNOWN`, never a dangerous false-`SAFE`
  (ADR 0010; golden +
  corpus `C031`).
- R2.1 corpus (31 cases, 21 real/redacted), SARIF dogfood, website V3, Trusted
  Publishing with provenance.

## [0.3.0-rc.1] — Stable candidate (RC-BLK-01 fix)

Second release candidate. Fixes a **dangerous false-SAFE** found during the
`0.3.0-rc.0` feedback window while scanning real third-party MCP configs from
public repositories. Published to the **`next`** dist-tag (`npx calllint@next`);
`latest` stays on `0.3.0-preview.0` until stable.

### Fixed
- **Unrecognized / empty server shapes are now UNKNOWN, not SAFE** (RC-BLK-01).
  A server config whose runtime the parser could not recognize — a nested
  `mcpServers.<name>.server.url`, a typo'd key hiding a remote URL, or an empty
  server object — previously resolved to `SAFE` ("no blockers observed") with
  `autonomousUse: allow`. The verdict engine now requires a positively recognized
  source for `SAFE`: any unverifiable source resolves to `UNKNOWN`
  (`packages/risk-engine/src/computeVerdict.ts`). Separately, a config that parses
  but contains **zero servers** (empty `mcpServers`, or a wrong-schema file) now
  aggregates to `UNKNOWN` rather than `SAFE` (`packages/core/src/scanConfig.ts`) —
  "nothing was examined" must not read as "no blockers observed". See
  ADR 0010.

### Added
- Regression coverage for RC-BLK-01: golden fixture
  `unknown-unrecognized-shape.json` (→ UNKNOWN), corpus case
  `C031-unknown-unrecognized-shape` (`thisCaseMustNeverBeSafe`), and unit tests in
  `@calllint/risk-engine` and `@calllint/core`. Corpus is now **31 cases**
  (21 real/redacted), still 0 dangerous false-SAFE.

### Notes
- No detector, exit code, or pre-existing golden verdict changed. The only verdict
  delta is unrecognized/empty shapes moving `SAFE → UNKNOWN` (safe direction).
- The parser does not yet positively recognize a nested/aliased `server.url` as a
  remote; it reaches `UNKNOWN` via the unknown-source path. A pre-existing,
  non-blocking calibration item (an unrecognized local `command` resolving to
  `SAFE`, RC-OBS-02) is recorded for R2.2 and deliberately not changed here.

## [0.3.0-rc.0] — Stable candidate

First release candidate for the stable `0.3.0` line. **No scanner-semantics
change** since preview.1: no detector, verdict, golden expectation, or exit code
was altered. The rc validates the release path end-to-end before `0.3.0` claims
the `latest` dist-tag — release workflow, the dedicated `next` dist-tag, build
provenance, and the `npx` install path. Published to the **`next`** dist-tag
(`npx calllint@next`); `latest` is left on `0.3.0-preview.0` until stable, when
the drift is corrected.

### Added
- **R2.1 corpus** — expanded the calibration corpus to 30 cases, 20 of them
  real-public or redacted-real snapshots with per-case origin metadata, plus a
  `corpus:test:r2-final` gate asserting the R2.1 thresholds (≥30 cases, ≥20
  real/redacted, UNKNOWN ≤ 15%, dangerous false-SAFE = 0).
- **SARIF dogfood** — [`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
  runs CallLint in GitHub Actions; findings appear in Code Scanning. Linked from
  the README and the GitHub Actions integration doc.
- **Website V3** — agent-readable surface (`/llms.txt`, `/agent-instructions.md`,
  `/report-schema.md`, `/security-boundaries.md`), a "For agents" section, and
  corpus-status + release-integrity sections.
- Calibration issue templates and a release-verification doc for the preview
  feedback loop.

### Fixed
- `exec` detector no longer treats an inline `-e` value flag (e.g. `docker run
  -e KEY=val`) as an interpreter inline-eval; precision fix with golden cases.

### Changed
- Release workflow derives the dist-tag in three lanes so a tag can never claim
  the wrong channel: `*-rc.*` → `next`, any other prerelease → `preview`, clean
  semver → `latest`. Release candidates stay off `preview` so preview testers
  are not auto-moved onto an rc.
- `--sarif` exit-code note corrected: it exits 0 on its own (only `--ci` gates),
  so the example workflow drops the unnecessary `|| true`.

## [0.3.0-preview.1] — Interactive polish

### Added
- Tiny "breathing" brand mark on interactive runs — a small CallLint shield with
  a gentle fade pulse, printed to **stderr only**. Strictly suppressed on
  machine output (`--json`/`--sarif`/`--html`/`--compact`), when piped
  (non-TTY), and under `NO_COLOR`, `CI`, `--no-color`, `--no-emoji`, or
  `--stdin`. Purely cosmetic and time-boxed; never delays or fails a command.

## [0.3.0-preview.0] — First public preview

First public preview of CallLint on npm. Static configuration scanner only; does
not execute MCP servers and does not prove runtime safety. Published before the
release workflow derived dist-tags from the version, so it landed on the default
`latest` tag — the dist-tag drift tracked in PROJECT_STATUS "Known issues",
corrected at the first stable release.

### Added
- Public npm preview release (`calllint@0.3.0-preview.0`), installable via
  `npx calllint scan .cursor/mcp.json`.
- **R2.0 seed corpus gate** — `packages/fixtures/corpus/` with 10 calibrated
  cases covering the current finding families, plus a `corpus:test` release gate
  asserting verdict, max risk level, required/forbidden finding kinds, evidence,
  false-positive notes, remediation, and a "dangerous never SAFE" policy.
- Deterministic `--generated-at` support and offline-enforcing corpus run mode.
- Trusted Publishing release workflow (OIDC + provenance; no long-lived
  NPM_TOKEN), publishing the bundled CLI on GitHub Release.
- calllint.com public website (Cloudflare Pages, auto-deployed from `main`).
- GitHub issue templates for false-positive / false-negative / parser edge-case
  reports.

### Changed
- Project license changed from MIT to **Apache-2.0**; added `NOTICE` and
  `TRADEMARKS.md`. The npm tarball ships `LICENSE` and `NOTICE`.
- **Brand transition: MCPGuard → CallLint (v0.3-R0).** The public product is now
  CallLint. This renamed, with no change to scanner semantics:
  - npm package `mcpguard` → `calllint` (unscoped, single bundled CLI)
  - internal workspace scope `@mcpguard/*` → `@calllint/*`
  - CLI binary `mcpguard` → `calllint`
  - cache/baseline directory `.mcpguard/` → `.calllint/`
  - on-disk schema identifiers `mcpguard.{report,baseline,drift,policy}.v0` →
    `calllint.*.v0`
  - policy file `mcpguard.policy.json` → `calllint.policy.json`
  - config input key `x-mcpguard` → `x-calllint`
  - SARIF tool driver name `MCPGuard` → `CallLint`; report titles updated
  - No migration shim: no public release wrote the old paths, so the rename is a
    clean cut.
- README expanded to the full public section set (what it is / checks / does not
  check / install / quick start / example report / rule list / security model /
  limitations / roadmap).
- `CHANGELOG.md` added.

## [0.3-R1] — Distribution readiness

### Added
- Single bundled-CLI distribution: publishable package with an empty runtime
  dependency list, `files: ["dist"]` allowlist, `prepack` rebuild, and npm
  metadata (ADR 0007).
- `scripts/package-smoke.mjs` + `pnpm pack:smoke`: packs the real tarball and
  asserts the manifest, bin/type/shebang, an empty runtime dep list, and a
  self-contained bundle; then installs into an isolated global prefix and runs
  the installed binary.
- `.github/workflows/ci.yml`: typecheck/test/build/smoke/pack:smoke with a
  least-privilege token; never publishes, never executes a scanned server.
- Apache-2.0 `LICENSE` and `NOTICE` (ship in the tarball) and `SECURITY.md`.

### Changed
- `apps/cli` made publishable: dropped `private`, moved `workspace:*` to
  `devDependencies`, bin canonicalized to `dist/index.js`.

## [0.2.1] — Hardening

### Added
- MONEY golden coverage driven end-to-end from a single source of truth.
- `block-observed-payment` golden: observed money-mover + capability → BLOCK.
- Online no-downgrade invariant: findings carry `source`/`fetchedAt`; enrichment
  is advisory and code-enforced never to lower a verdict
  (ADR 0006).
- Windows path/shell regression coverage.
- `LIMITATIONS.md` (trust boundaries) and the release checklist.

### Changed
- Split name-inferred financial risk (`action.financial`, INFERRED → REVIEW)
  from observed money movement (`action.financial-observed`, OBSERVED → BLOCK).

## [0.2.0] — Engine completion

### Added
- Drift detection (`baseline` / `verify`) with rug-pull signal on
  pinned-version changes.
- SARIF 2.1.0 output (GitHub Code Scanning) and a self-contained HTML report.
- `npm:` and `github:` scan targets; opt-in `--online` advisory enrichment.

## [0.1.0] — Foundation

### Added
- pnpm monorepo: config parser, resolver, static analyzer (eight detectors),
  deterministic risk engine (S0–S5 classes, SAFE/REVIEW/BLOCK/UNKNOWN verdicts),
  policy-as-code with a CI gate, stable drift fingerprints, scan pipeline, and a
  terminal/compact/JSON report renderer.
- Golden verdict contract enforced through the built binary.
- CLI: `scan` / `baseline` / `verify` / `explain` / `policy` with documented
  exit codes (0 SAFE · 10 REVIEW · 20 UNKNOWN · 30 BLOCK · 40 DRIFT · 2 usage ·
  3 error).
