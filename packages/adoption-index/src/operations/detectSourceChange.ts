/**
 * detectSourceChange — decide whether a mirror run changed anything the served tree is a
 * function of, and which §16.2 tier that change reaches.
 *
 * PURE. No clock, no filesystem, no database, no network. Every input is passed in and the
 * only output is a verdict, which is what makes the decision testable over its whole input
 * space rather than only along the paths a fixture happens to reach. The I/O — reading the
 * prior checkpoint, computing the cohort digest, advancing the checkpoint — lives in
 * `refreshFromMirror`, at the edge. This is the same observer/evaluator split the
 * presentation plane uses: measurement in `src/`, effects at the bin.
 *
 * WHY NOT A COUNT. `PersistResult` already splits `inserted` from `unchanged`, so
 * `inserted === 0` looks like a ready-made "nothing changed" and it is the shortcut this
 * file exists to refuse. It is unsound in exactly one direction, and it is the direction
 * that ships a wrong page: when upstream WITHDRAWS a server, the run inserts no row, so the
 * count says "unchanged" while the cohort that feeds the bake has lost an entry. The mirror
 * is append-only (there is no DELETE anywhere in this package), so its memory of a withdrawn
 * subject outlives the withdrawal and a count can never see the difference.
 *
 * WHY THE DIGEST IS OVER THE PROJECTED COHORT. Three candidates, two of them wrong:
 *
 *   - the raw mirror rows: `last_seen_at` is refreshed on every unchanged observation, so
 *     the digest moves on every run and the detector never skips. A detector that never
 *     skips delivers nothing.
 *   - the whole projected snapshot: it carries `fetchedAt`, which is the run's one clock
 *     read, so again every run is "changed" for the same reason.
 *   - the projected ENTRIES: exactly the population the served tree is derived from, and
 *     free of both the storage bookkeeping and the clock. That is the honest key.
 *
 * WHY THE PRIOR DIGEST COMES FROM DURABLE STATE. The comparison is against
 * `source_checkpoints.snapshot_digest` as read back before the run, never against something
 * this run computed. A digest compared only against itself detects nothing, and the failure
 * is silent because the code still looks like a comparison.
 */

/** Why a run is (or is not) a change. Ordered from cheapest to most consequential. */
export type ChangeReason =
  /** Prior digest present and identical: upstream did not move. The skippable case. */
  | "NO_CHANGE"
  /** No prior digest on the checkpoint — a first run, or a store rebuilt from scratch. */
  | "NO_PRIOR_DIGEST"
  /** The cohort digest moved: at least one entry was added, removed, or rewritten. */
  | "COHORT_DIGEST_MOVED"
  /**
   * A subject the mirror still considers current was NOT observed in this run's stream.
   * Never skippable, and reported separately from a digest move because the remedy differs:
   * a digest move is handled by reprojecting, a withdrawal needs a lifecycle decision this
   * batch deliberately does not make (see `absentFromSource` below).
   */
  | "SOURCE_WITHDRAWAL"

/**
 * Which §16.2 rebuild tiers a change reaches.
 *
 * All seven tiers were declared at once, in R-2, so the shape would be the canonical one from the
 * start even while six of them were unmeasurable. R-3 through R-7 then filled five in, and ONE is
 * still unmeasured here: `presentation`, which belongs to the presentation plane. (R-2's original
 * "the six this batch cannot compute" is inverted in place rather than deleted — the count moved,
 * the reasoning did not.)
 *
 * The `null`-vs-`false` distinction is what let that happen incrementally without any tier ever
 * lying: `false` asserts "no rebuild needed", which is a claim requiring a measurement, while `null`
 * says "not measured here". A partial fan-out that reads as complete is precisely the drift that
 * makes a later batch trust a field nothing ever wrote — so an unfilled tier stays `null`, and a
 * filled one is `null` on any run that skipped the work.
 */
export interface RebuildScope {
  /** §16.2 source-payload-only ⇒ canonicalize (maybe presentation). Owned by THIS batch. */
  canonicalize: boolean
  /**
   * identity ⇒ subject/search/projections. RESOLVED, R-3 (do not restore the `null` default).
   *
   * Measured, not assumed: it is `true` exactly when the run resolved an identity layer, and
   * it stays `null` on `NO_CHANGE` — a skipped run resolved nothing, so `false` would assert a
   * measurement that never happened. That asymmetry is the same one the six tiers below rest on.
   */
  identity: boolean | null
  /**
   * artifact ⇒ fetch/inspect/evidence/decision/all projections. RESOLVED, R-4 (do not restore
   * the `null` default).
   *
   * Measured exactly like `identity`: `true` when the run actually resolved an artifact layer,
   * `null` on `NO_CHANGE` because a skipped run measured nothing, and `null` — never `false` —
   * when the caller passed no artifact port at all. Controls #27 and #28 measure both halves.
   */
  artifact: boolean | null
  /**
   * evidence ⇒ decision/all projections. RESOLVED, R-5 (do not restore the `null` default).
   *
   * Measured exactly like `identity` and `artifact`, and the third repetition is the point: the
   * asymmetry is now a PATTERN three tiers deep rather than a special case. `true` when the run
   * actually compiled an evidence layer, `null` on `NO_CHANGE`, and `null` — never `false` — when
   * the caller passed no evidence port. Controls #61 and #62 measure both halves.
   */
  evidence: boolean | null
  /**
   * decision ⇒ contracts/search/human page. RESOLVED, R-7 (do not restore the `null` default).
   *
   * Measured exactly like the three above, and the fourth repetition means the asymmetry is the
   * file's rule rather than three coincidences: `true` when the run actually compiled an adoption
   * record (a record always carries a decision — `decisionDigest` is the one mid-chain digest the
   * schema forbids to be null, because UNKNOWN is a decision), `null` on `NO_CHANGE`, and `null` —
   * never `false` — when the caller passed no record port. Controls (k1) and (k2) measure both.
   */
  decision: boolean | null
  /**
   * semantic-contract ⇒ Agent contract/MCP committed data. RESOLVED, R-7 (do not restore the
   * `null` default).
   *
   * NOT the same measurement as `decision`, which is why it is a separate tier rather than an alias
   * of it: `semanticContractDigest` IS nullable in the record, so a run can compile a record — and
   * therefore a decision — while sealing no contract. It is `true` only when the compiled record
   * actually carried a `semanticContractDigest`, `null` on `NO_CHANGE`, and `null` when no record
   * port was passed. A control that fuses the two tiers must fail.
   */
  semanticContract: boolean | null
  /** presentation ⇒ human HTML only. Owned by the presentation plane (Workstream P). */
  presentation: boolean | null
}

export interface SourceChangeInput {
  /**
   * `source_checkpoints.snapshot_digest` as read back from the store BEFORE this run.
   * `null` on a first run or a store rebuilt from scratch.
   */
  priorSnapshotDigest: string | null
  /** `hashJson` over the projected cohort's entries — never over the snapshot envelope. */
  nextSnapshotDigest: string
  /** Native ids the mirror considers current that this run's stream did NOT contain. */
  absentFromSource: readonly string[]
  /**
   * Whether this run actually resolved an identity layer (R-3). OPTIONAL, and absent means
   * `null` rather than `false`: a caller that cannot measure it must not be able to assert
   * "no identity rebuild needed" by saying nothing, which is what a non-optional boolean
   * defaulting to `false` would let it do.
   */
  identityResolved?: boolean
  /**
   * Whether this run actually resolved an artifact layer (R-4). OPTIONAL for the same reason
   * `identityResolved` is: a run with no artifact port measured nothing, and absence must read
   * as `null` rather than as the assertion "no artifact rebuild needed". Control #27 defaults it
   * to `false` and observes a no-port run make exactly that unmeasured claim.
   */
  artifactResolved?: boolean
  /**
   * Whether this run actually compiled an evidence layer (R-5). OPTIONAL for the same reason the
   * two above are. Control #61 defaults it to `false` and observes a no-port run assert "no
   * evidence rebuild needed" about a layer nothing measured.
   */
  evidenceCompiled?: boolean
  /**
   * Whether this run actually compiled an adoption record (R-7), which is the same thing as having
   * reached a decision: `decisionDigest` is the one mid-chain digest `assertDigestChain` refuses to
   * let be null, because UNKNOWN is a decision. OPTIONAL for the same reason the three above are.
   */
  decisionCompiled?: boolean
  /**
   * Whether the record this run compiled actually carried a `semanticContractDigest` (R-7).
   *
   * A SECOND flag rather than a reuse of `decisionCompiled`, because the two measure different
   * things and the record schema says so: `semanticContractDigest` is nullable, `decisionDigest` is
   * not. So a run can compile a record — reaching a decision — while sealing no contract, and the
   * caller must be able to report that honestly instead of being forced to claim both or neither.
   */
  semanticContractSealed?: boolean
}

export interface SourceChangeVerdict {
  changed: boolean
  reason: ChangeReason
  rebuild: RebuildScope
  /**
   * Carried through verbatim so the caller can log and report it without re-deriving the
   * set. Empty on every non-withdrawal verdict.
   */
  absentFromSource: readonly string[]
}

/**
 * Nothing to rebuild. Every non-`canonicalize` tier stays `null`, never `false` — the five that are
 * now measurable included, because a skipped run measured none of them.
 *
 * FROZEN, and every branch below returns a SPREAD of it rather than the object itself. These
 * are module-level constants shared by every verdict in the process, so handing one back by
 * reference would let a single caller that wrote `verdict.rebuild.identity = true` — which is
 * exactly what a later batch filling in its own tier would reach for — silently rewrite every
 * verdict computed afterwards. The freeze makes that write throw instead of corrupting, and
 * the spread gives each caller a scope it actually owns. Neither alone is enough: the freeze
 * without the spread turns a reasonable caller into a crash, and the spread without the freeze
 * leaves the next branch added here free to reintroduce the sharing unnoticed.
 */
const NO_REBUILD: RebuildScope = Object.freeze({
  canonicalize: false,
  identity: null,
  artifact: null,
  evidence: null,
  decision: null,
  semanticContract: null,
  presentation: null,
})

/** §16.2's source-payload tier, the one this batch can honestly compute. */
const CANONICALIZE: RebuildScope = Object.freeze({ ...NO_REBUILD, canonicalize: true })

/**
 * Decide the run's verdict.
 *
 * A withdrawal is checked FIRST and independently of the digest. It usually coincides with a
 * digest move — a withdrawn subject normally drops out of the cohort too — but it does not
 * have to: a subject past the cohort cap can vanish upstream without changing the cap-limited
 * entries at all. Ordering the withdrawal check first means the more consequential fact is
 * the one reported, and the run is never skipped on the strength of a digest that happens to
 * be stable for an unrelated reason.
 *
 * Every branch that is not provably unchanged returns `changed: true`. That is the
 * conservative direction: an unnecessary rebuild costs time, a missed one ships a stale page.
 */
export function detectSourceChange(input: SourceChangeInput): SourceChangeVerdict {
  // R-3's tier, resolved once for every CHANGED branch below. `undefined` stays `null`: the
  // caller could not measure it, and a caller's silence must never read as "nothing to do".
  // Spread onto a fresh object every time — `CANONICALIZE` is frozen and shared by every
  // verdict in the process, so assigning onto it would rewrite verdicts already returned.
  const identity = input.identityResolved ?? null
  const artifact = input.artifactResolved ?? null
  const evidence = input.evidenceCompiled ?? null
  const decision = input.decisionCompiled ?? null
  const semanticContract = input.semanticContractSealed ?? null
  const changedScope: RebuildScope = {
    ...CANONICALIZE,
    identity,
    artifact,
    evidence,
    decision,
    semanticContract,
  }

  if (input.absentFromSource.length > 0) {
    return {
      changed: true,
      reason: "SOURCE_WITHDRAWAL",
      rebuild: { ...changedScope },
      absentFromSource: input.absentFromSource,
    }
  }

  if (input.priorSnapshotDigest === null) {
    return { changed: true, reason: "NO_PRIOR_DIGEST", rebuild: { ...changedScope }, absentFromSource: [] }
  }

  if (input.priorSnapshotDigest !== input.nextSnapshotDigest) {
    return { changed: true, reason: "COHORT_DIGEST_MOVED", rebuild: { ...changedScope }, absentFromSource: [] }
  }

  // NO_CHANGE keeps ALL FIVE measured tiers at `null` from `NO_REBUILD`, deliberately, even when the
  // caller passed any of them as `true`. The run was skipped; nothing about those layers was
  // re-measured, and `false` would be a claim with no measurement behind it. Control #28 passes
  // `artifactResolved: true` with an unmoved digest and requires the tier to stay `null`; #62 does the
  // same for `evidenceCompiled`, and (k2) for `decisionCompiled` + `semanticContractSealed`.
  return { changed: false, reason: "NO_CHANGE", rebuild: { ...NO_REBUILD }, absentFromSource: [] }
}

/** One line for a run log. Kept here so the bin does not re-derive the phrasing. */
export function describeSourceChange(v: SourceChangeVerdict): string {
  switch (v.reason) {
    case "NO_CHANGE":
      return "no change (cohort digest unmoved) — rebuild skipped"
    case "NO_PRIOR_DIGEST":
      return "no prior cohort digest (first run or rebuilt store) — full reproject"
    case "COHORT_DIGEST_MOVED":
      return "cohort digest moved — reproject"
    case "SOURCE_WITHDRAWAL":
      return (
        `source withdrawal: ${v.absentFromSource.length} current subject(s) absent from this run ` +
        // "de-listing is NOT applied by this batch" was true from R-2 until R-11 and is now false:
        // `refreshFromMirror` applies the plan through `applyWithdrawal` right after the identity
        // commit. Inverted in place rather than left as a stale caveat, because a message that
        // under-reports what the run DID is the kind of drift a reader trusts by default.
        `(${v.absentFromSource.join(", ")}) — reproject; de-listing applied to the subject plane (R-11)`
      )
  }
}
