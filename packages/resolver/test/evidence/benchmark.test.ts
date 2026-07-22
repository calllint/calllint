/**
 * P1-G — the benchmark acceptance gate (new11 §P1-acceptance / §4.7 / §10.3).
 *
 * Runs the fixed 100-object corpus through the REAL P1_RESOLVERS with recorded
 * fetch maps (no live network) and asserts every §P1 threshold:
 *   - 100 objects, covering npm/github/registry/domain/remote/tool
 *   - identity success ≥90%, repo mapping ≥80%, completeness ≥70% (over resolvable)
 *   - every non-clean bundle has a reason code AND an explainUnknown cause
 *   - false-SAFE = 0 (nothing not-expected-clean resolves clean)
 *   - conflicting evidence never reads clean
 *   - deterministic replay (same inputs → identical bundle)
 *   - every resolver output validates against evidence-bundle.schema.json
 *   - no secret / email / local-path leaks in any published (clean) bundle
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, it, expect } from "vitest"
import {
  isCleanlyResolved,
  explainUnknown,
  mergeResults,
  type EvidenceBundle,
} from "@calllint/evidence"
import { P1_RESOLVERS } from "../../src/evidence/index.js"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"
import { buildCorpus, type CorpusObject } from "./corpus.js"
import { runCoverageAudit } from "./coverageAudit.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", p), "utf8"))
const ajv = new Ajv({ allErrors: true })
ajv.addSchema(read("evidence-subject.schema.json"))
ajv.addSchema(read("evidence-gap.schema.json"))
const validateBundle = ajv.compile(read("evidence-bundle.schema.json"))

/** Build a ResolverContext from an object's recorded fetch maps. */
function ctxFor(obj: CorpusObject): ResolverContext {
  return {
    fetchJson: async (url: string) => {
      if (url in obj.json) return obj.json[url]
      throw new Error(`no recorded json for ${url}`)
    },
    fetchText: async (url: string) => (url in obj.text ? obj.text[url] : undefined),
    resolvedAt: "2026-07-20T00:00:00.000Z",
  }
}

/** Resolve one corpus object: conflict objects go straight through mergeResults. */
async function resolveObj(obj: CorpusObject): Promise<EvidenceBundle> {
  if (obj.conflict) return mergeResults(obj.subject, obj.conflict)
  const { resolveSubject } = await import("../../src/evidence/resolveSubject.js")
  return resolveSubject(obj.subject, P1_RESOLVERS, ctxFor(obj))
}

/** Per-subject-type identity anchors (module-scoped: used by the gate + the audit binding). */
const ANCHORS = ["identity.name", "repo.url", "domain.owner", "endpoint.url", "tool.count"]

/** Structural leak guard for a value that would enter the public Index (§4.7). */
const LEAK = new RegExp(
  [
    "<script", // HTML/script injection
    "javascript:", // dangerous URL scheme
    "file://", // local file URL
    "-----BEGIN", // PEM / private-key header
    "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", // email (PII)
    "(^|[\\\\/])\\.\\.([\\\\/]|$)", // path traversal
    "[A-Za-z]:\\\\", // windows local path
  ].join("|"),
)

describe("P1-G benchmark gate", () => {
  const corpus = buildCorpus()

  it("is exactly 100 objects across all six subject types", () => {
    expect(corpus).toHaveLength(100)
    const types = new Set(corpus.map((o) => o.subject.subjectType))
    for (const t of ["npm-package", "github-repo", "mcp-registry-entry", "domain", "remote-endpoint", "tool"]) {
      expect(types.has(t as never)).toBe(true)
    }
  })

  it("meets every acceptance threshold on one recorded pass", async () => {
    const bundles = await Promise.all(corpus.map(resolveObj))
    const rows = corpus.map((o, i) => ({ o, b: bundles[i]! }))

    // Every bundle validates against the schema.
    for (const { b } of rows) expect(validateBundle(b), JSON.stringify(validateBundle.errors)).toBe(true)

    // Every non-clean bundle carries a reason code AND an explainable cause.
    for (const { b } of rows) {
      if (!isCleanlyResolved(b)) {
        expect(b.gaps.length).toBeGreaterThan(0)
        expect(explainUnknown(b).cause).not.toBe("clean")
      }
    }

    // false-SAFE = 0: nothing we did not mark expectClean resolves clean.
    for (const { o, b } of rows) {
      if (!o.expectClean) expect(isCleanlyResolved(b), `${o.id} unexpectedly clean`).toBe(false)
    }

    // Conflicting evidence never reads clean, and reports the conflict cause.
    for (const { o, b } of rows) {
      if (o.conflict) {
        expect(isCleanlyResolved(b)).toBe(false)
        expect(explainUnknown(b).cause).toBe("conflicting-evidence")
      }
    }

    // Rates over the resolvable, non-conflict, non-malicious sample.
    const sample = rows.filter((r) => r.o.resolvable && !r.o.conflict && !r.o.malicious)
    // An object's identity anchor depends on its type (ANCHORS, module-scoped above):
    // package/registry → identity.name, repo → repo.url, domain → domain.owner,
    // remote → endpoint.url, tool → tool.count.
    const idOk = sample.filter((r) => r.b.items.some((i) => ANCHORS.includes(i.field)))
    const repoRows = sample.filter((r) => r.o.repoExpected)
    const repoOk = repoRows.filter((r) => r.b.items.some((i) => i.field === "repo.url"))
    const complete = sample.filter((r) => isCleanlyResolved(r.b))
    expect(idOk.length / sample.length).toBeGreaterThanOrEqual(0.9)
    expect(repoOk.length / repoRows.length).toBeGreaterThanOrEqual(0.8)
    expect(complete.length / sample.length).toBeGreaterThanOrEqual(0.7)

    // No secret/email/local-path leak in any clean (publishable) bundle.
    for (const { b } of rows.filter((r) => isCleanlyResolved(r.b))) {
      for (const item of b.items) expect(LEAK.test(item.value), `leak in ${item.field}=${item.value}`).toBe(false)
    }
  })

  it("is deterministic: two passes yield identical bundles", async () => {
    const a = await Promise.all(corpus.map(resolveObj))
    const b = await Promise.all(corpus.map(resolveObj))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it("no resolver throws on any corpus object (incl. malicious)", async () => {
    for (const o of corpus) {
      await expect(resolveObj(o)).resolves.toBeTruthy()
    }
  })

  // Gate A / PR-D1: the coverage-audit REPORT is a projection over this SAME corpus
  // and SAME resolvers. Bind them so the report can never drift from the gate: the
  // audit's aggregate rates must equal the gate's own inline-computed rates, and the
  // audit must independently agree the thresholds pass. (ADR 0053: report, not a
  // second harness.)
  it("coverage-audit report agrees with the gate (no divergence)", async () => {
    const bundles = await Promise.all(corpus.map(resolveObj))
    const rows = corpus.map((o, i) => ({ o, b: bundles[i]! }))
    const sample = rows.filter((r) => r.o.resolvable && !r.o.conflict && !r.o.malicious)
    const idOk = sample.filter((r) => r.b.items.some((i) => ANCHORS.includes(i.field)))
    const repoRows = sample.filter((r) => r.o.repoExpected)
    const repoOk = repoRows.filter((r) => r.b.items.some((i) => i.field === "repo.url"))
    const complete = sample.filter((r) => isCleanlyResolved(r.b))

    const audit = await runCoverageAudit()
    expect(audit.objectCount).toBe(100)
    expect(audit.rates.sampleSize).toBe(sample.length)
    expect(audit.rates.identityRate).toBe(idOk.length / sample.length)
    expect(audit.rates.repoRate).toBe(repoOk.length / repoRows.length)
    expect(audit.rates.completenessRate).toBe(complete.length / sample.length)
    expect(audit.rates.falseSafeCount).toBe(0)
    expect(audit.pass).toBe(true)
    expect(audit.deterministic).toBe(true)
    // Honest gap: four registry/transport classes are stated as not-yet-covered.
    expect(audit.uncoveredClasses).toEqual(["pypi-package", "oci-image", "mcpb-bundle", "direct-stdio"])
  })
})
