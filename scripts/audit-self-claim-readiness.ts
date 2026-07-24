#!/usr/bin/env tsx
/**
 * Phase 2.5-A self-claim readiness audit (new13 §Phase-2.5-A; ADR 0055 §7).
 *
 * A PURE-fs cross-check that the in-code self-claim coordinates (`SELF_CLAIM` in
 * `packages/trust-index/src/selfClaimDogfood.ts`) still agree with COMMITTED reality —
 * the claim store, the registry snapshot, and the baked served page — and an HONEST
 * report of how far the three-leg production dogfood has actually progressed.
 *
 * It reads only committed inputs through the SHIPPED loaders (no re-implementation, no
 * network, no clock). It reports the lifecycle as N/3:
 *   • activate  — proven when the committed store has exactly one active record for
 *     CallLint's namespace AND the served page carries the matching verifiedPublisher.
 *   • revoke    — proven only when the human has uninstalled the App and the verify job
 *     has committed the flip to `revoked` (a revoked audit record present).
 *   • reactivate— proven only when the human has re-installed and a FRESH active record
 *     (a later verifiedAt) has been committed alongside the revoked audit trail.
 * Today the honest answer is 1/3 (activate only). This script exists so that answer is
 * MACHINE-checked, not asserted from memory — and so a real revoke/reactivate landing in
 * the committed store is detected and reported the moment it happens.
 *
 * It is a REPORT, not a gate: it exits 0 while the dogfood is legitimately partial
 * (1/3), because a still-open lifecycle is the true state, not a build failure. It exits
 * 1 ONLY on a genuine integrity fault: an in-code/committed coordinate DRIFT, an
 * ambiguous (>1 active) self-claim, or a served page whose overlay disagrees with the
 * store — any of which would mean the dogfood is reasoning about the wrong thing.
 *
 * Usage:  tsx scripts/audit-self-claim-readiness.ts
 * Exit:   0 = report emitted (any legitimate N/3);  1 = integrity fault.
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  loadClaimStoreIfPresent,
  loadSnapshotIfPresent,
  DEFAULT_OUT,
} from "../packages/trust-index/src/bake.js"
import { registryRepoIndex, repoKey } from "../packages/trust-index/src/reconcileClaims.js"
import { SELF_CLAIM } from "../packages/trust-index/src/selfClaimDogfood.js"
import type { ClaimRecord } from "../packages/trust-index/src/claim.js"

/** Accumulated integrity faults — any one makes the dogfood unsound, so we exit 1. */
const faults: string[] = []
/** Human-readable report lines. */
const report: string[] = []
const ok = (m: string) => report.push(`  ✓ ${m}`)
const info = (m: string) => report.push(`  · ${m}`)
const fault = (m: string) => {
  faults.push(m)
  report.push(`  ✗ ${m}`)
}

// ── 1. The committed store, read through the shipped loader ───────────────────────────
const store = loadClaimStoreIfPresent()
const selfRecords = store.records.filter((r) => r.canonicalName === SELF_CLAIM.canonicalName)
const active = selfRecords.filter((r) => r.status === "active")
const revoked = selfRecords.filter((r) => r.status === "revoked")

// ── 2. Coordinate drift: in-code SELF_CLAIM must match the committed active record ─────
// (When there is no active record — e.g. mid-revoke — this check is skipped for owner/
// installationId, since there is nothing active to match; the lifecycle section reports it.)
if (active.length === 1) {
  const a = active[0] as ClaimRecord
  if (a.owner !== SELF_CLAIM.account) {
    fault(`store active owner ${JSON.stringify(a.owner)} ≠ in-code SELF_CLAIM.account ${JSON.stringify(SELF_CLAIM.account)}`)
  } else {
    ok(`active record owner matches in-code coordinate (${a.owner})`)
  }
  if (a.installationId !== SELF_CLAIM.installationId) {
    fault(`store installationId ${a.installationId} ≠ in-code SELF_CLAIM.installationId ${SELF_CLAIM.installationId} — a re-install mints a NEW id; update SELF_CLAIM in the same change`)
  } else {
    ok(`active record installationId matches in-code coordinate (${a.installationId})`)
  }
} else if (active.length > 1) {
  fault(`ambiguous self-claim: ${active.length} active records for ${SELF_CLAIM.canonicalName} — verifiedPublisherFor fails closed, but the store should never hold >1 active per namespace`)
}

// ── 3. The registry snapshot proves the page exists to be claimed ──────────────────────
const snapshot = loadSnapshotIfPresent()
if (!snapshot) {
  fault("no committed registry snapshot — there is nothing to claim; run ingest first")
} else {
  const idx = registryRepoIndex(snapshot)
  const key = repoKey(SELF_CLAIM.repo.owner, SELF_CLAIM.repo.name)
  const mapped = idx.get(key)
  if (mapped !== SELF_CLAIM.canonicalName) {
    fault(`snapshot maps ${key} → ${JSON.stringify(mapped)} but in-code canonicalName is ${JSON.stringify(SELF_CLAIM.canonicalName)}`)
  } else {
    ok(`snapshot maps ${key} → ${SELF_CLAIM.canonicalName} (control proof intact)`)
  }
}

// ── 4. The served page's overlay must agree with the committed store ───────────────────
const sidecarPath = join(DEFAULT_OUT, `${SELF_CLAIM.canonicalName}.json`)
if (!existsSync(sidecarPath)) {
  fault(`served page ${SELF_CLAIM.canonicalName}.json is absent — the page must be baked to be claimed`)
} else {
  const sc = JSON.parse(readFileSync(sidecarPath, "utf8")) as {
    verdict?: string
    pageDigest?: string
    verifiedPublisher?: { owner: string; verifiedAt: string; observedArtifactDigest: string }
  }
  info(`served verdict = ${sc.verdict}, pageDigest = ${sc.pageDigest}`)
  if (active.length === 1) {
    const a = active[0] as ClaimRecord
    if (!sc.verifiedPublisher) {
      fault("store has an active self-claim but the served page shows NO verifiedPublisher overlay (bake is stale — re-bake)")
    } else if (sc.verifiedPublisher.owner !== a.owner || sc.verifiedPublisher.verifiedAt !== a.verifiedAt || sc.verifiedPublisher.observedArtifactDigest !== a.artifactDigest) {
      fault(`served overlay ${JSON.stringify(sc.verifiedPublisher)} disagrees with the committed active record (owner ${a.owner}, verifiedAt ${a.verifiedAt}, digest ${a.artifactDigest}) — re-bake`)
    } else {
      ok("served verifiedPublisher overlay byte-agrees with the committed active record")
    }
  } else if (sc.verifiedPublisher) {
    fault(`served page shows a verifiedPublisher overlay but the store has ${active.length} active records — fail-closed expects none`)
  }
}

// ── 5. Honest lifecycle progress (activate / revoke / reactivate), N/3 ─────────────────
// Legs are proven from committed EVIDENCE, never assumed. `verifiedAt` ISO strings sort
// lexicographically, so "a revoked record older than the newest active" ⇒ reactivation.
const legActivate = active.length === 1
const legRevoke = revoked.length >= 1
const newestActiveAt = active.map((r) => r.verifiedAt).sort().at(-1)
const oldestRevokedAt = revoked.map((r) => r.verifiedAt).sort().at(0)
const legReactivate = legActivate && legRevoke && !!newestActiveAt && !!oldestRevokedAt && newestActiveAt > oldestRevokedAt
const done = [legActivate, legRevoke, legReactivate].filter(Boolean).length

report.push("")
report.push(`Lifecycle progress: ${done}/3`)
report.push(`  ${legActivate ? "✓" : "○"} activate    — one active record + matching served overlay`)
report.push(`  ${legRevoke ? "✓" : "○"} revoke      — a revoked audit record present (needs the HUMAN GitHub-UI App uninstall + the verify job)`)
report.push(`  ${legReactivate ? "✓" : "○"} reactivate  — a fresh active record newer than the revoked one (needs the HUMAN re-install + the verify job)`)
if (done < 3) {
  report.push("")
  report.push("  The remaining legs are gated on a HUMAN action Claude Code cannot perform:")
  report.push(`  uninstall then re-install the CallLint GitHub App (id ${SELF_CLAIM.appId}) on the`)
  report.push(`  \`${SELF_CLAIM.account}\` account. The offline proof that the verdict + page digest`)
  report.push("  never move across all three legs is already machine-checked by")
  report.push("  packages/trust-index/test/self-claim-dogfood.test.ts. See")
  report.push("  artifacts/phase-2.5-self-claim/README.md for the human runbook.")
}

// ── Emit ───────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-console
console.log(`\nSelf-claim readiness audit (${SELF_CLAIM.canonicalName})\n${"─".repeat(60)}`)
// eslint-disable-next-line no-console
console.log(report.join("\n"))
if (faults.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${faults.length} integrity fault(s) — the dogfood is reasoning about the wrong state.`)
  process.exit(1)
}
// eslint-disable-next-line no-console
console.log(`\nNo integrity faults. Lifecycle ${done}/3 is the honest, committed state.\n`)
