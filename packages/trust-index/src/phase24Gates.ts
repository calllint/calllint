// ---------------------------------------------------------------------------
// Phase 2.4 Batch 9 — Gate 2.4-A / 2.4-D / 2.4-E / 2.4-F evaluators (new14 §E
// "release boundary"; traceability rows gates 2.4-A, 2.4-D, 2.4-E, 2.4-F).
//
// Same contract as `phase24Eval.ts`, and for the same reason: PURE + deterministic
// MEASUREMENT over already-shipped output. No clock, no RNG, no filesystem, no
// process spawning, no safety computation (INV-2.4-01/10, INV-K). The callers —
// `scripts/phase-2.4-gates.ts` — do all the observing (reading served bytes,
// scanning source, driving the real binary) and hand the OBSERVATIONS in here.
//
// Why the split matters: an evaluator that could read the disk could also be
// tempted to re-derive the thing it is grading. Keeping the observation outside
// means every measure below is a comparison over data the gate cannot influence.
//
// Each gate's shape is identical: a closed set of measures, each a rate that must
// be 1 or a count that must be 0, plus the blockers explaining any failure. A
// gate is PASSED only when every measure meets its floor; there is no partial
// credit and no weighting to tune.
// ---------------------------------------------------------------------------

import type { GateStatus } from "./phase24Eval.js"

/** One all-or-nothing measure. `pass` is the only thing a gate reads. */
export interface GateMeasure {
  readonly id: string
  readonly pass: boolean
  /** What was actually seen, verbatim — the audit trail when `pass` is false. */
  readonly observed: string
}

/** A finished gate: the measures, the derived status, and the human blockers. */
export interface GateResult {
  readonly status: GateStatus
  readonly measures: readonly GateMeasure[]
  readonly blockers: readonly string[]
}

/** Derive a gate from its measures. PASSED iff every measure passed. */
export function decideGate(measures: readonly GateMeasure[], requireAtLeast = 1): GateResult {
  const blockers: string[] = []
  if (measures.length < requireAtLeast) {
    blockers.push(`expected at least ${requireAtLeast} measures, got ${measures.length} — the observation step produced nothing to grade`)
  }
  for (const m of measures) if (!m.pass) blockers.push(`${m.id}: ${m.observed}`)
  return { status: blockers.length === 0 ? "PASSED" : "FAILED", measures, blockers }
}

// --- Gate 2.4-A · one-source consistency ------------------------------------

/**
 * The decision-bearing facts one adoption identity publishes, as read off ONE
 * served surface. Gate 2.4-A's whole claim is that these agree everywhere, so
 * the fields are exactly the ones a human or an agent would act on.
 *
 * `null` means "this surface does not carry that fact" — legitimate for HTML,
 * which renders a label but no machine digest. A null never counts as a
 * mismatch; a WRONG value does. That distinction is the gate: we are proving
 * one source of truth, not demanding every surface repeat every field.
 */
export interface SurfaceFacts {
  /** Which served file this was read from, repo-relative — the audit trail. */
  readonly surface: string
  readonly artifactDigest: string | null
  readonly verdict: string | null
  readonly verdictLabel: string | null
}

/** Every surface that publishes one identity, plus the identity itself. */
export interface IdentitySurfaces {
  readonly canonicalName: string
  readonly surfaces: readonly SurfaceFacts[]
}

const CONSISTENCY_FIELDS = ["artifactDigest", "verdict", "verdictLabel"] as const

/**
 * Measure one identity: for each field, every surface that carries it must carry
 * the SAME value. Returns one measure per identity (not per field) so a
 * 19-identity cohort yields 19 measures — small enough to read, specific enough
 * to debug, because `observed` names the disagreeing surfaces and values.
 */
export function measureIdentityConsistency(id: IdentitySurfaces): GateMeasure {
  const disagreements: string[] = []
  for (const field of CONSISTENCY_FIELDS) {
    const seen = new Map<string, string[]>()
    for (const s of id.surfaces) {
      const v = s[field]
      if (v === null) continue
      const at = seen.get(v)
      if (at) at.push(s.surface)
      else seen.set(v, [s.surface])
    }
    if (seen.size > 1) {
      const detail = [...seen].map(([v, at]) => `${v} @ ${at.join("+")}`).join(" ≠ ")
      disagreements.push(`${field}: ${detail}`)
    }
    if (seen.size === 0) disagreements.push(`${field}: not published by ANY surface`)
  }
  return {
    id: id.canonicalName,
    pass: disagreements.length === 0,
    observed: disagreements.length === 0 ? `${id.surfaces.length} surfaces agree` : disagreements.join(" · "),
  }
}

/**
 * Gate 2.4-A. `expectedSurfacesPerIdentity` is asserted too: a cohort where a
 * surface silently stopped being emitted would otherwise "agree" trivially,
 * which is exactly the regression this gate exists to catch.
 */
export function evaluateOneSourceConsistency(
  identities: readonly IdentitySurfaces[],
  expectedIdentities: number,
  expectedSurfacesPerIdentity: number,
): GateResult {
  const measures: GateMeasure[] = [
    {
      id: "cohort-size",
      pass: identities.length === expectedIdentities,
      observed: `${identities.length} identities (expected ${expectedIdentities})`,
    },
  ]
  for (const id of identities) {
    const thin = id.surfaces.length !== expectedSurfacesPerIdentity
    measures.push(
      thin
        ? {
            id: id.canonicalName,
            pass: false,
            observed: `only ${id.surfaces.length} of ${expectedSurfacesPerIdentity} surfaces observed: ${id.surfaces.map((s) => s.surface).join(", ")}`,
          }
        : measureIdentityConsistency(id),
    )
  }
  return decideGate(measures, expectedIdentities + 1)
}

// --- Gate 2.4-D · local binding ---------------------------------------------

/**
 * One recorded run of the real binary against a DELIBERATELY mismatched target:
 * the operator asserted a digest/version that the served contract does not
 * carry. The gate's floor is that such a run yields no writable plan — and
 * "writable" is measured by the host config on disk, not by what the tool said.
 */
export interface MismatchRun {
  /** Which dimension was falsified: artifact digest, contract digest, version. */
  readonly id: string
  readonly outcome: string
  readonly exitCode: number
  /** Did an approvable plan digest come back? For a mismatch it must not. */
  readonly planDigest: string | null
  /** The decisive fact: did the host config exist afterwards? */
  readonly hostConfigWritten: boolean
  /** Whether the refusal named the falsified dimension, so the operator can act. */
  readonly explains: boolean
}

/**
 * One source-level write site found in the surface under audit. Gate 2.4-D's
 * "direct-writer = 0" is a STRUCTURAL claim about the code, so it is measured by
 * scanning the shipped source rather than by hoping a test would have caught it:
 * a behavioural test can only prove the paths it exercises, while this proves
 * there is no other path to exercise (INV-2.4-03, one writer).
 */
export interface WriteSite {
  readonly file: string
  readonly line: number
  /** The literal destination expression, e.g. `join(scratch, "…")`. */
  readonly destination: string
  /** True when the destination is provably not the host config. */
  readonly allowed: boolean
  readonly why: string
}

/**
 * The terminal outcome an exact-target mismatch must produce. This is the SHIPPED
 * name from the Batch-4 gate (`safeInstall/result.ts`), pinned here so a rename
 * that quietly changed the refusal's identity would fail this gate rather than
 * slip through as a still-plausible-looking string.
 */
export const TARGET_MISMATCH_OUTCOME = "ABORTED_ON_MISMATCH"

/**
 * Gate 2.4-D. Two independent claims, both required:
 *   1. behavioural — every mismatch run refused, wrote nothing, and explained why;
 *   2. structural — the safe-install surface contains no host-config write site,
 *      so the only route to the host config is the shipped apply engine.
 */
export function evaluateLocalBinding(
  runs: readonly MismatchRun[],
  writeSites: readonly WriteSite[],
  expectedRuns: number,
): GateResult {
  const measures: GateMeasure[] = [
    {
      id: "mismatch-matrix-size",
      pass: runs.length === expectedRuns,
      observed: `${runs.length} mismatch runs (expected ${expectedRuns})`,
    },
  ]
  for (const r of runs) {
    const faults: string[] = []
    if (r.hostConfigWritten) faults.push("HOST CONFIG WAS WRITTEN")
    if (r.planDigest !== null) faults.push(`a writable plan digest came back (${r.planDigest.slice(0, 23)}…)`)
    if (r.outcome !== TARGET_MISMATCH_OUTCOME) faults.push(`outcome ${r.outcome} ≠ ${TARGET_MISMATCH_OUTCOME}`)
    if (r.exitCode === 0) faults.push("exit code 0 — a mismatch must not look like success")
    if (!r.explains) faults.push("the refusal did not name the falsified dimension")
    measures.push({
      id: `mismatch/${r.id}`,
      pass: faults.length === 0,
      observed: faults.length === 0 ? `${r.outcome} exit ${r.exitCode}, no plan, nothing written` : faults.join("; "),
    })
  }
  const offenders = writeSites.filter((s) => !s.allowed)
  measures.push({
    id: "safe-install-direct-host-config-writers",
    pass: offenders.length === 0,
    observed:
      offenders.length === 0
        ? `${writeSites.length} write sites audited, all scoped away from the host config (${writeSites.map((s) => s.why).join("; ")})`
        : offenders.map((s) => `${s.file}:${s.line} → ${s.destination}`).join(", "),
  })
  return decideGate(measures, expectedRuns + 2)
}

// --- Gate 2.4-E · one-time setup --------------------------------------------

/**
 * A recorded rollback exercise. The gate asks for more than "rollback ran": it
 * asks that the host config came back BYTE-IDENTICAL to its pre-image, which is
 * the only definition of a rollback an operator can rely on.
 */
export interface RollbackRun {
  readonly id: string
  /** Digest of the host config before apply — the pre-image to restore to. */
  readonly digestBefore: string
  readonly digestAfter: string
  readonly outcome: string
  readonly rolledBack: boolean
  /** Files the operator's workspace gained. Must stay empty (INV-2.4-07). */
  readonly workspaceFiles: readonly string[]
}

/**
 * Gate 2.4-E. `oneTimeSteps` are lifted from the Gate 2.4-G dogfood record
 * rather than re-run, so the two gates cannot disagree about what the shipped
 * one-time flow did — one observation, two gates reading it.
 */
export function evaluateOneTimeSetup(
  oneTimeSteps: readonly { readonly fixture: string; readonly step: string; readonly persistentComponents: readonly string[]; readonly workspaceFiles: readonly string[] }[],
  rollbacks: readonly RollbackRun[],
  expectedRollbacks: number,
): GateResult {
  const withComponents = oneTimeSteps.filter((s) => s.persistentComponents.length > 0)
  const withFiles = oneTimeSteps.filter((s) => s.workspaceFiles.length > 0)
  const measures: GateMeasure[] = [
    {
      id: "one-time-steps-observed",
      pass: oneTimeSteps.length > 0,
      observed: `${oneTimeSteps.length} steps lifted from the Gate 2.4-G dogfood record`,
    },
    {
      id: "persistent-calllint-components-in-one-time-mode",
      pass: withComponents.length === 0,
      observed:
        withComponents.length === 0
          ? "0 across every step"
          : withComponents.map((s) => `${s.fixture}/${s.step}: ${s.persistentComponents.join(",")}`).join(" · "),
    },
    {
      id: "workspace-files-created-in-one-time-mode",
      pass: withFiles.length === 0,
      observed:
        withFiles.length === 0
          ? "0 across every step"
          : withFiles.map((s) => `${s.fixture}/${s.step}: ${s.workspaceFiles.join(",")}`).join(" · "),
    },
    {
      id: "rollback-matrix-size",
      pass: rollbacks.length === expectedRollbacks,
      observed: `${rollbacks.length} rollback runs (expected ${expectedRollbacks})`,
    },
  ]
  for (const r of rollbacks) {
    const faults: string[] = []
    if (!r.rolledBack) faults.push(`rollback did not run (outcome ${r.outcome})`)
    if (r.digestAfter !== r.digestBefore) faults.push(`config NOT restored: before ${r.digestBefore.slice(0, 23)}… after ${r.digestAfter.slice(0, 23)}…`)
    if (r.workspaceFiles.length > 0) faults.push(`workspace gained ${r.workspaceFiles.join(",")}`)
    measures.push({
      id: `rollback/${r.id}`,
      pass: faults.length === 0,
      observed: faults.length === 0 ? `${r.outcome} — pre-image restored byte-identically` : faults.join("; "),
    })
  }
  return decideGate(measures, expectedRollbacks + 4)
}

// --- Gate 2.4-F · continuous-protection conversion --------------------------

/**
 * One shipped offer, plus the text a human would actually see. The gate measures
 * the OFFER OBJECT and the RENDERED TEXT together on purpose: an object that
 * discloses a component the renderer then omits would satisfy either half alone
 * while still deceiving the person deciding.
 */
export interface ConversionObservation {
  /** Which host this offer was built for — the audit trail. */
  readonly host: string
  readonly recommendation: string
  readonly requiresSeparateAuthorization: boolean
  readonly declineOption: string
  readonly disableCommand: string
  readonly disclosureDigest: string
  /** Every disclosed component with the two facts a decision needs. */
  readonly components: readonly { readonly id: string; readonly label: string; readonly artifactPath: string; readonly uninstallCommand: string }[]
  /** What the human sees, verbatim. Measured for disclosure, not for tone. */
  readonly renderedText: string
}

/**
 * Gate 2.4-F. Floors, in the plan's own words: components disclosed = 100%,
 * separate authorization required, `[Not now]` visible, disable/uninstall present.
 *
 * "Disclosed" is deliberately strict — every component's LABEL and its
 * ARTIFACT PATH must appear in the rendered text. A path-free disclosure would
 * let a component be installed somewhere the operator was never shown.
 */
export function evaluateConversion(
  observations: readonly ConversionObservation[],
  expectedHosts: number,
): GateResult {
  const measures: GateMeasure[] = [
    {
      id: "hosts-observed",
      pass: observations.length === expectedHosts,
      observed: `${observations.length} guard hosts (expected ${expectedHosts})`,
    },
  ]
  for (const o of observations) {
    const faults: string[] = []
    if (!o.requiresSeparateAuthorization) faults.push("requiresSeparateAuthorization is false — a one-time setup would authorize persistent protection")
    if (o.declineOption !== "Not now") faults.push(`declineOption is ${JSON.stringify(o.declineOption)}`)
    if (!o.renderedText.includes("[Not now]")) faults.push("[Not now] is not visible in the rendered offer")
    if (!o.disableCommand) faults.push("no disableCommand")
    if (!o.renderedText.includes(o.disableCommand)) faults.push(`disableCommand ${JSON.stringify(o.disableCommand)} is not shown to the human`)
    if (o.components.length === 0) faults.push("no components disclosed — an offer with nothing to disclose cannot be audited")
    if (!o.disclosureDigest.startsWith("sha256:")) faults.push(`disclosureDigest is not a sha256 (${o.disclosureDigest})`)
    for (const c of o.components) {
      if (!c.uninstallCommand) faults.push(`${c.id}: no uninstallCommand`)
      if (!o.renderedText.includes(c.label)) faults.push(`${c.id}: label ${JSON.stringify(c.label)} not disclosed in the rendered offer`)
      if (!o.renderedText.includes(c.artifactPath)) faults.push(`${c.id}: artifactPath ${JSON.stringify(c.artifactPath)} not disclosed in the rendered offer`)
      if (!o.renderedText.includes(c.uninstallCommand)) faults.push(`${c.id}: uninstallCommand not disclosed in the rendered offer`)
    }
    measures.push({
      id: `conversion/${o.host}`,
      pass: faults.length === 0,
      observed:
        faults.length === 0
          ? `${o.recommendation}: ${o.components.length} component(s) fully disclosed, [Not now] visible, disable + uninstall shown`
          : faults.join("; "),
    })
  }
  return decideGate(measures, expectedHosts + 1)
}
