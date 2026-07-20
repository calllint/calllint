/**
 * Release read-back reconciliation — PURE core (new11 §3.3, PR-03).
 *
 * Given (a) the expected identity, (b) a platform manifest entry, and (c) the
 * OBSERVED facts a fetch adapter returned (or a fetch error), decide a status.
 * No network, no clock, no fs — deterministic and unit-testable with fixtures.
 * The workflow layer (scripts/release-readback.mjs) does the fetching and issue
 * management; this module only judges.
 *
 * A network failure NEVER becomes MATCH (mirrors the engine invariant: a missing
 * signal is not a clean result — new11 §10.2).
 */

/** @typedef {"MATCH"|"STALE"|"MISSING"|"MANUAL_REVIEW"|"UNREACHABLE"|"ERROR"} ReadbackStatus */

export const READBACK_STATUS = /** @type {const} */ ({
  MATCH: "MATCH",
  STALE: "STALE",
  MISSING: "MISSING",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  UNREACHABLE: "UNREACHABLE",
  ERROR: "ERROR",
})

/** True when a status represents drift a human should look at. */
export function isActionable(status) {
  return status === READBACK_STATUS.STALE || status === READBACK_STATUS.MISSING
}

/**
 * Reconcile one platform.
 * @param {object} args
 * @param {{package:string,repository:string,domain:string}} args.expected
 * @param {object} args.platform  one manifest platform entry
 * @param {object} [args.observed] fetch result, e.g. {versionExists, latestVersion, repository}
 * @param {{message:string, reachable?:boolean}} [args.fetchError]
 * @returns {{id:string, status:ReadbackStatus, detail:string, expected?:string, observed?:string}}
 */
export function reconcilePlatform({ expected, platform, observed, fetchError }) {
  const id = platform.id

  // Manual platforms: never auto-fail; surface as a standing manual task.
  if (!platform.supportsAutomatedReadback || platform.manualActionRequired) {
    return { id, status: READBACK_STATUS.MANUAL_REVIEW, detail: "read-back not automatable for this platform; verify manually" }
  }

  // A fetch problem is UNREACHABLE, never MATCH and never STALE.
  if (fetchError) {
    return { id, status: READBACK_STATUS.UNREACHABLE, detail: `could not verify: ${fetchError.message}` }
  }
  if (!observed) {
    return { id, status: READBACK_STATUS.ERROR, detail: "no observed facts and no fetch error (adapter bug)" }
  }

  // npm-style: package must exist and the advertised latest must match expected version.
  if (platform.ownershipMethod === "npm") {
    if (observed.versionExists === false && observed.latestVersion == null) {
      return { id, status: READBACK_STATUS.MISSING, detail: `package "${platform.expectedPackage ?? expected.package}" not found on npm` }
    }
    const want = platform.expectedVersion || expected.version
    if (want && observed.latestVersion && observed.latestVersion !== want) {
      return {
        id,
        status: READBACK_STATUS.STALE,
        detail: `npm latest is ${observed.latestVersion}, expected ${want}`,
        expected: want,
        observed: observed.latestVersion,
      }
    }
    return { id, status: READBACK_STATUS.MATCH, detail: `npm latest ${observed.latestVersion ?? "(present)"} matches` }
  }

  // github-release: a release must exist; its tag should carry the expected version.
  if (platform.ownershipMethod === "github") {
    if (!observed.tagName && !observed.name) {
      return { id, status: READBACK_STATUS.MISSING, detail: "no published GitHub release found" }
    }
    const tag = String(observed.tagName ?? observed.name ?? "")
    const want = platform.expectedVersion || expected.version
    if (want && !tag.includes(want)) {
      return {
        id,
        status: READBACK_STATUS.STALE,
        detail: `latest GitHub release tag "${tag}" does not carry expected version ${want}`,
        expected: want,
        observed: tag,
      }
    }
    return { id, status: READBACK_STATUS.MATCH, detail: `GitHub release ${tag} present` }
  }

  return { id, status: READBACK_STATUS.MANUAL_REVIEW, detail: `no reconciler for ownershipMethod "${platform.ownershipMethod}"` }
}

/**
 * Reconcile every platform and summarize. Pure.
 * @returns {{results:Array, actionable:Array, summary:object}}
 */
export function reconcileAll({ expected, platforms, observations }) {
  const results = platforms.map((platform) =>
    reconcilePlatform({
      expected,
      platform,
      observed: observations?.[platform.id]?.observed,
      fetchError: observations?.[platform.id]?.fetchError,
    }),
  )
  const actionable = results.filter((r) => isActionable(r.status))
  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, /** @type {Record<string,number>} */ ({}))
  return { results, actionable, summary }
}

/** Deterministic marker line so the workflow can find + update ONE issue (dedup). */
export const READBACK_ISSUE_MARKER = "<!-- calllint:release-readback -->"

/** Render a stable issue body (used for dedup + update). Pure. */
export function renderIssueBody({ results, actionable, generatedAtIso }) {
  const lines = [
    READBACK_ISSUE_MARKER,
    "## Release read-back drift",
    "",
    `Automated read-back found ${actionable.length} actionable discrepancy(ies) between the`,
    "declared identity (`distribution/registries/registry-manifest.json`, derived from",
    "`project-facts.json`) and what public listings advertise.",
    "",
    "| Platform | Status | Detail |",
    "| --- | --- | --- |",
    ...results.map((r) => `| ${r.id} | ${r.status} | ${r.detail} |`),
    "",
    `_Generated ${generatedAtIso}. This issue is updated in place, never duplicated._`,
  ]
  return lines.join("\n")
}

