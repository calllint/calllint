/**
 * resolveEvidence — the evidence-resolution workflow step (ADR 0050 §4). Runs ONLY
 * in the scheduled `trust-ingest` workflow, never in serving and never in the bake.
 * It is the sole network step for evidence:
 *
 *   1. read the committed registry snapshot (the retained raw input)
 *   2. for every remote endpoint the cohort will scan, run the P1 resolvers over
 *      real fetchers → an EvidenceBundle (identity only; INV1 no-exec/no-probe)
 *   3. write the retained evidence snapshot to EVIDENCE_SNAPSHOT_PATH
 *
 * The bake then reads that committed snapshot PURELY and refines verdicts from it.
 * CI re-bakes from the committed bytes and diffs — the network result is frozen
 * into a reviewable artifact before it can move a single public verdict.
 *
 * Usage:  tsx packages/trust-index/src/resolveEvidence.ts
 *   env:  TRUST_INGEST_NOW (ISO-8601, optional) pins resolvedAt for a reproducible run
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveSubject, P1_RESOLVERS } from "@calllint/resolver"
import type { EvidenceBundle, EvidenceSubject } from "@calllint/evidence"
import { loadSnapshotIfPresent, EVIDENCE_SNAPSHOT_PATH } from "./bake.js"
import { serializeEvidenceSnapshot, type EvidenceSnapshot } from "./evidenceSnapshot.js"

/** Real JSON fetcher over Node's global fetch (rejects on non-2xx). */
const fetchJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}
/** Real text fetcher; resolves to undefined on non-2xx so a resolver can note the gap. */
const fetchText = async (url: string): Promise<string | undefined> => {
  const res = await fetch(url)
  if (!res.ok) return undefined
  return res.text()
}

/** Every distinct remote-endpoint subject the registry cohort will scan (deduped, sorted). */
export function remoteSubjects(snapshot: { entries: { remotes: { url: string }[] }[] }): EvidenceSubject[] {
  const ids = new Set<string>()
  for (const e of snapshot.entries) for (const r of e.remotes) if (r.url) ids.add(r.url)
  return [...ids]
    .sort()
    .map((id) => ({ schema: "calllint.evidence-subject.v0", subjectType: "remote-endpoint", id }))
}

async function main(): Promise<void> {
  const resolvedAt = process.env.TRUST_INGEST_NOW || new Date().toISOString()
  const snapshot = loadSnapshotIfPresent()
  if (!snapshot) {
    // eslint-disable-next-line no-console
    console.log("no registry snapshot present — nothing to resolve")
    return
  }

  const subjects = remoteSubjects(snapshot)
  const ctx = { fetchJson, fetchText, resolvedAt }
  const bundles: EvidenceBundle[] = []
  for (const subject of subjects) {
    // resolveSubject never throws — it returns a bundle carrying coded gaps. A hard
    // network error is a RETRYABLE_FAILURE bundle, which is NOT cleanly resolved, so
    // it leaves the page UNKNOWN (fail-closed) rather than fabricating a verdict.
    bundles.push(await resolveSubject(subject, P1_RESOLVERS, ctx))
  }

  const snap: EvidenceSnapshot = {
    schema: "calllint.evidence-snapshot.v0",
    resolvedAt,
    count: bundles.length,
    bundles,
  }
  mkdirSync(dirname(EVIDENCE_SNAPSHOT_PATH), { recursive: true })
  writeFileSync(EVIDENCE_SNAPSHOT_PATH, serializeEvidenceSnapshot(snap), "utf8")

  const clean = bundles.filter((b) => b.state === "COMPLETE" && b.gaps.length === 0).length
  // eslint-disable-next-line no-console
  console.log(
    `resolved ${bundles.length} remote endpoint(s) @ ${resolvedAt}; ${clean} cleanly resolved → ${EVIDENCE_SNAPSHOT_PATH}`,
  )
}

// Run main() ONLY when executed as a script (tsx src/resolveEvidence.ts), never on
// import — so `remoteSubjects` can be imported (by the bake wiring / tests) without
// firing the network resolution step.
const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedAsScript) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
}
