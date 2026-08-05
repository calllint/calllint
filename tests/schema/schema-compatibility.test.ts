import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv, { type ValidateFunction } from "ajv"
import { describe, it, expect } from "vitest"

// Producers: every instance under test is either a committed fixture or is built
// by the SAME production builder that ships it, so a schema test can never drift
// from the code that emits the artifact (new11 §14).
import { buildFlows } from "@calllint/flow-analyzer"
import type { AuthorityCapability, AuthorityManifest } from "@calllint/types"
import { hashJson } from "@calllint/fingerprint"
import { scanConfigText, createReceipt } from "@calllint/core"
import type { CreateReceiptInput } from "@calllint/core"
import {
  buildInstallPlan,
  buildDecisionReceipt,
  type InstallPlan,
  type PlanContext,
  type PlanUpstream,
  type ReceiptContext,
} from "@calllint/install-planner"
import type { ApplyResult, TrustDecision } from "@calllint/types"
import { importEvidence } from "@calllint/evidence"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  resolveIdentity,
  toSourceRecord,
  beginCompilerRun,
  compileAdoptionRecord,
  enqueueJobs,
  leaseNextJob,
  toCompilerJobDocument,
  toCompilerRunDocument,
  OFFICIAL_REGISTRY_SOURCE_ID,
  MIGRATIONS_DIRNAME,
  type AdoptionRecordV1,
  type CompilerJobV1,
  type CompilerRunV1,
  type SourceRecordV1,
} from "@calllint/adoption-index"

/**
 * new11 §14 — "Every new schema must have compatibility and malformed-input tests."
 *
 * This consolidated gate closes the coverage hole the trackers flagged: the
 * evidence-model + telemetry + sarif + registry schemas already had dedicated
 * tests, but ~10 other committed schemas under `schemas/` did not. Rather than
 * hand-author instances (which drift), each case validates a REAL artifact — a
 * committed fixture, or the output of the production builder — against its JSON
 * Schema, then asserts three things per schema:
 *   1. a valid instance validates (forward-compat: the schema accepts real output),
 *   2. a malformed instance is rejected (fail-closed),
 *   3. `additionalProperties:false` schemas reject an unknown key (no silent extra).
 *
 * No product code is touched — this is test-only coverage. It never executes a
 * scanned server and reads only committed bytes + pure builders.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCHEMAS_DIR = path.join(repoRoot, "schemas")
const readSchema = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", `${name}.schema.json`), "utf8"))
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"))

// strict:false + no format loading matches the project convention (see
// packages/evidence/test/model-schema.test.ts): the schemas declare
// format:"date-time" as documentation, not a validated constraint.
function compile(schemaName: string): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false })
  return ajv.compile(readSchema(schemaName))
}

// A committed trust-preparation fixture embeds three sealed sub-objects
// (artifact.v1, authority.v0, decision.v0) exactly as the gateway emits them.
const BENCH_PREP = "packages/fixtures/bench/cases/B01-clean-content-broad-home/authority-manifest.json"
const prep = readJson(BENCH_PREP)

// ── builders for schemas that have no committed top-level instance ────────────

function cap(partial: Partial<AuthorityCapability>): AuthorityCapability {
  return {
    action: "read",
    resource: "filesystem",
    scope: null,
    destination: null,
    mutability: "read-only",
    reversibility: "n/a",
    monetaryLimit: null,
    approvalRequirement: "none",
    evidenceSource: "<test>",
    confidence: "high",
    completeness: "complete",
    ...partial,
  }
}

function manifest(capabilities: AuthorityCapability[]): AuthorityManifest {
  const sealed: Omit<AuthorityManifest, "digest"> = {
    schema: "calllint.authority.v0",
    subject: { artifactDigest: `sha256:${"a".repeat(64)}` },
    capabilities,
    limits: { spendPerCall: null, spendTotal: null },
    approval: { required: [] },
    unknowns: [],
    completeness: "complete",
  }
  return { ...sealed, digest: hashJson(sealed) as `sha256:${string}` }
}

function buildOneFlow() {
  const secretSource = cap({
    action: "read",
    resource: "secret",
    scope: "OPENAI_API_KEY",
    evidenceSource: "server.env.OPENAI_API_KEY",
    trustSource: "sensitive.secret",
  })
  const networkSink = cap({
    action: "send",
    resource: "network",
    destination: "evil.example.com",
    evidenceSource: "SKILL.md:12",
    pattern: "data-exfil",
  })
  const flows = buildFlows([manifest([secretSource, networkSink])])
  return flows[0]!
}

const RECEIPT_NOW = "2026-06-01T00:00:00.000Z"
function buildScanReceipt() {
  const text = JSON.stringify({ mcpServers: { svc: { command: "npx", args: ["-y", "some-mcp@1.0.0"] } } })
  const summary = scanConfigText(text, "<inline>", {
    now: Date.parse(RECEIPT_NOW),
    generatedAt: RECEIPT_NOW,
  })
  const input: CreateReceiptInput = {
    toolVersion: "0.8.0",
    subject: { type: "scan", target: "<inline>" },
    inputForHash: text,
    effectivePolicyForHash: { policy: "default" },
    scanReport: summary,
    rulesetForHash: { tool: "calllint", version: "0.8.0" },
  }
  return createReceipt(input, RECEIPT_NOW)
}

const APPROVED = "2026-07-13T00:00:00.000Z"
function buildPlanAndReceipt(): { plan: InstallPlan; decisionReceipt: ReturnType<typeof buildDecisionReceipt> } {
  const authority = { digest: "sha256:" + "c".repeat(64) } as AuthorityManifest
  const decision = {
    digest: "sha256:" + "d".repeat(64),
    policyDigest: "sha256:" + "e".repeat(64),
    verdict: "SAFE",
  } as TrustDecision
  const upstream: PlanUpstream = { artifactDigest: "sha256:" + "a".repeat(64), authority, decision }
  const bytes = JSON.stringify({ mcpServers: {} }, null, 2) + "\n"
  const planCtx: PlanContext = {
    host: "claude-code",
    tier: "A",
    configPath: "/home/u/.claude.json",
    configDigest: hashJson(bytes) as `sha256:${string}`,
    currentConfig: JSON.parse(bytes),
    servers: [{ name: "demo", entry: { command: "node", args: ["s.js"] } }],
    backupPath: "/home/u/.claude.json.calllint-backup-x",
    expiresAt: "2026-07-13T01:00:00.000Z",
  }
  const plan = buildInstallPlan(planCtx, upstream)
  const applyResult: ApplyResult = {
    schema: "calllint.apply-result.v1",
    state: "VERIFIED",
    outcome: "applied",
    planId: plan.planId,
    planDigest: plan.planDigest,
    host: plan.host,
    configPath: plan.operations[0]!.target,
    configDigestBefore: ("sha256:" + "1".repeat(64)) as `sha256:${string}`,
    configDigestAfter: ("sha256:" + "2".repeat(64)) as `sha256:${string}`,
    backupPath: plan.backup.path,
    rolledBack: false,
    notes: ["applied + verified"],
    appliedAt: APPROVED,
  }
  const receiptCtx: ReceiptContext = {
    approvedAt: APPROVED,
    approver: "alice",
    scannerVersion: "1.3.0",
    evidenceDigests: [("sha256:" + "f".repeat(64)) as `sha256:${string}`],
    policyVersion: "policy-2026h2",
  }
  return { plan, decisionReceipt: buildDecisionReceipt(applyResult, plan, receiptCtx) }
}

/**
 * The R-1 mirror's instance comes out of a REAL SQLite store, not out of this file.
 *
 * Control #9 of the R-1 batch is "hand-author a schema instance instead of using store
 * output", and the failure it names is drift from the emitter. A literal typed as
 * `SourceRecordV1` would satisfy the compiler and validate forever, even after the store
 * began writing a different shape — which is precisely the blindness this gate exists to
 * remove. So the record is written through `persistSourceRecords` and read back with
 * `listSourceRecordPayloads`: it survives a JSON round-trip through SQLite, which is where
 * a key-order or `undefined`-vs-absent difference would appear.
 *
 * The store is opened under a temp cwd and closed immediately; INV-R7 keeps every byte it
 * writes under `.var/calllint-adoption-index/`, so nothing lands in the repo.
 */
const REGISTRY_NOW = "2026-08-03T00:00:00.000Z"
async function storedSourceRecord(): Promise<SourceRecordV1> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calllint-schema-compat-"))
  try {
    const paths = resolveIndexPaths(cwd)
    for (const dir of paths.dirs) fs.mkdirSync(dir, { recursive: true })
    const db = await openBetterSqlite3(paths.db)
    const store = AdoptionIndexStore.open({
      cwd,
      migrationsDir: path.join(repoRoot, "packages", "adoption-index", MIGRATIONS_DIRNAME),
      db,
      now: REGISTRY_NOW,
    })
    try {
      // A raw registry item in the shape the official adapter parses. It carries the
      // optional branches on purpose — a package, a remote, and publisher prose — so the
      // validated instance exercises `claimedIdentity` and `untrustedPublisherContent`
      // rather than only the four required keys.
      const raw = {
        server: {
          name: "io.example/schema-compat",
          description: "publisher-supplied prose, quarantined by the envelope",
          version: "2.0.0",
          repository: { url: "https://github.com/example/schema-compat" },
          packages: [
            { registryType: "npm", identifier: "@example/schema-compat", version: "2.0.0", transport: "stdio" },
          ],
          remotes: [{ type: "sse", url: "https://schema-compat.example/sse" }],
        },
        _meta: {
          "io.modelcontextprotocol.registry/official": {
            status: "active",
            isLatest: true,
            publishedAt: "2026-07-01T00:00:00.000Z",
          },
        },
      }
      const record = toSourceRecord(raw as never, REGISTRY_NOW)
      if (record === null) throw new Error("the adapter rejected the fixture item — the producer, not the schema")
      store.transaction((tx) => tx.persistSourceRecords([record], REGISTRY_NOW))
      const readBack = store.listSourceRecordPayloads(OFFICIAL_REGISTRY_SOURCE_ID)
      if (readBack.length !== 1) throw new Error(`expected exactly one stored record, got ${readBack.length}`)
      return readBack[0]!
    } finally {
      store.close()
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

// ── the coverage table: {schema, a valid instance, a malformed instance} ──────

/**
 * A REAL `CanonicalSubjectV1` and `IdentityConflictV1`, from the shipped resolver.
 *
 * Both schemas sat in `AWAITING_EMITTER` with the reason "no emitter exists yet (control #9)".
 * That reason was true when written and became false when R-3 merged — the excuse block's own
 * contract says "each batch that writes one of these tables removes its entry here in the same
 * PR that adds its emitter", and R-3 and R-4 both shipped a writer without paying that. So two
 * published schemas were graded structurally while a live producer existed to grade them
 * against, which is exactly the gap `EXCUSED_REASONS` is supposed to make impossible.
 *
 * Paid here because THIS PR is the one that needs the answer. Migration 002 makes
 * `canonical_subjects.canonical_slug` nullable in STORAGE while
 * `calllint.canonical-subject.v1` keeps `canonicalSlug` required and non-nullable, and that
 * asymmetry is only safe if the DOCUMENT still always carries a slug. A structural grade cannot
 * see that. This one can: the input is a slug COLLISION, so both subjects come back `CONFLICT`
 * — the exact shape whose row is NULL — and the schema must still accept them.
 *
 * `resolveIdentity` is pure, so no store is opened. Unlike `storedSourceRecord` above there is
 * nothing storage adds to these documents that the resolver does not already produce.
 */
function resolvedIdentityDocuments() {
  const raw = (name: string) => ({
    server: { name, description: "prose", version: "1.0.0" },
    _meta: {
      "io.modelcontextprotocol.registry/official": {
        status: "active",
        isLatest: true,
        publishedAt: "2026-07-01T00:00:00.000Z",
      },
    },
  })
  // The measured real-world case-fold pair, not a synthetic one — see migration 002's header.
  const records = ["io.github.LocalSynapse/LocalSynapse-mcp", "io.github.LocalSynapse/localsynapse-mcp"]
    .map((n) => toSourceRecord(raw(n) as never, REGISTRY_NOW))
    .filter((r): r is SourceRecordV1 => r !== null)
  if (records.length !== 2) throw new Error("the adapter rejected a fixture item — the producer, not the schema")

  const identity = resolveIdentity({ records, sourceId: OFFICIAL_REGISTRY_SOURCE_ID, observedAt: REGISTRY_NOW })
  if (identity.subjects.length !== 2 || identity.conflicts.length !== 1) {
    throw new Error(
      `expected 2 subjects + 1 conflict, got ${identity.subjects.length}/${identity.conflicts.length}`,
    )
  }
  // The property migration 002 depends on, asserted at construction so a regression fails here
  // rather than producing an instance that passes for the wrong reason: a CONFLICT subject's
  // DOCUMENT still carries a non-empty slug even though its ROW will hold NULL.
  const subject = identity.subjects[0]!
  if (subject.identityStatus !== "CONFLICT" || !subject.canonicalSlug) {
    throw new Error(`expected a CONFLICT subject carrying a slug, got ${subject.identityStatus}`)
  }
  return { subject, conflict: identity.conflicts[0]! }
}

/**
 * A REAL `ArtifactVersionV1`, from the same shipped resolver.
 *
 * The third excuse R-6 pays. `calllint.artifact-version.v1` was excused as "R-4 writes
 * artifact_versions; no emitter exists yet" and R-4 MERGED — so the excuse outlived its reason, the
 * same way the two identity schemas above did. It took a measurement to be sure: the obvious probe,
 * `git grep -nE '(INSERT|UPDATE)[^;]*artifact_versions'`, returns NOTHING, because the SQL spans
 * lines and no verb sits on the same line as the table name. A grep-shaped conclusion here would have
 * been "still no emitter", which is false — `resolveIdentity` has emitted these documents since R-3
 * and R-4 gave them their four resolution columns.
 *
 * The document a bare `resolveIdentity` produces is deliberately the WEAK one — `RESOLVED`, with
 * `immutableDigest: null` — and that is the case worth grading. `immutableDigest` is in `required`
 * and is nullable, exactly like `outputManifestDigest` on a run: an artifact we have merely NAMED has
 * no verified bytes, and a schema that demanded a digest would force a lie into the field a later
 * verification compares against. So the instance asserts the pairing rather than picking the
 * comfortable `FETCHED` case, which would leave the nullable branch ungraded.
 */
function resolvedArtifactDocument() {
  const raw = {
    server: {
      name: "io.example/schema-compat",
      description: "prose",
      version: "2.0.0",
      packages: [
        { registryType: "npm", identifier: "@example/schema-compat", version: "2.0.0", transport: "stdio" },
      ],
    },
    _meta: {
      "io.modelcontextprotocol.registry/official": {
        status: "active",
        isLatest: true,
        publishedAt: "2026-07-01T00:00:00.000Z",
      },
    },
  }
  const record = toSourceRecord(raw as never, REGISTRY_NOW)
  if (record === null) throw new Error("the adapter rejected the fixture item — the producer, not the schema")
  const identity = resolveIdentity({
    records: [record],
    sourceId: OFFICIAL_REGISTRY_SOURCE_ID,
    observedAt: REGISTRY_NOW,
  })
  const artifact = identity.artifacts[0]
  if (artifact === undefined) throw new Error("the resolver produced no artifact — the producer, not the schema")
  // Asserted at construction, so a regression fails HERE and names itself rather than producing an
  // instance that validates for a reason nobody chose.
  if (artifact.artifactStatus !== "RESOLVED" || artifact.immutableDigest !== null) {
    throw new Error(
      `expected a RESOLVED artifact with a null digest, got ${artifact.artifactStatus}/${String(artifact.immutableDigest)}`,
    )
  }
  return artifact
}

/**
 * REAL `CompilerJobV1` and `CompilerRunV1` documents, read back out of a real store — R-6's own
 * excuses, paid in the PR that adds the emitter.
 *
 * BOTH GO THROUGH SQLITE rather than being taken from the operations layer's return values, for the
 * reason `storedSourceRecord` does: the round-trip is where a translation error appears. Two are
 * specific to these tables — `metrics` is one TEXT column that `serializeRunMetrics` writes and
 * `parseRunMetrics` reads, and every enum is a `TEXT` column with NO CHECK constraint — so a document
 * built from the in-memory objects would grade the types, not the storage.
 *
 * THE INSTANCES ARE THE AWKWARD ONES ON PURPOSE. The job is `LEASED`, the one state where
 * `leaseOwner`/`leaseExpiresAt` are populated together; the run is `RUNNING`, the state whose
 * `outputManifestDigest` must be present AND null. Grading a `PENDING` job and a `SUCCEEDED` run
 * would leave both of those asymmetries untested, and they are the two the schemas argue for at
 * length.
 *
 * `toCompilerJobDocument` supplies `schema`, which no table has a column for. That projection is the
 * only difference between the row and the document, and `job-schema.test.ts` asserts the row alone
 * fails validation — so this case cannot pass by accident.
 */
async function storedCompilerDocuments(): Promise<{ job: CompilerJobV1; run: CompilerRunV1 }> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calllint-schema-compat-r6-"))
  try {
    const paths = resolveIndexPaths(cwd)
    for (const dir of paths.dirs) fs.mkdirSync(dir, { recursive: true })
    const db = await openBetterSqlite3(paths.db)
    const store = AdoptionIndexStore.open({
      cwd,
      migrationsDir: path.join(repoRoot, "packages", "adoption-index", MIGRATIONS_DIRNAME),
      db,
      now: REGISTRY_NOW,
    })
    try {
      const inputDigest = `sha256:${"1".repeat(64)}`
      enqueueJobs({
        store,
        jobs: [{ jobType: "compile-evidence", subjectKey: "io.example/schema-compat", inputDigest }],
        now: REGISTRY_NOW,
      })
      const leased = leaseNextJob({
        store,
        owner: "schema-compat-worker",
        now: REGISTRY_NOW,
        leaseExpiresAt: "2026-08-03T01:00:00.000Z",
      })
      if (leased === null) throw new Error("nothing was leasable — the producer, not the schema")

      beginCompilerRun({
        store,
        runType: "incremental",
        inputManifestDigest: `sha256:${"a".repeat(64)}`,
        startedAt: REGISTRY_NOW,
      })

      const jobRow = store.listCompilerJobs()[0]
      const runRow = store.listCompilerRuns()[0]
      if (jobRow === undefined || runRow === undefined) throw new Error("the store returned no row to grade")
      if (jobRow.state !== "LEASED" || jobRow.leaseOwner === null || jobRow.leaseExpiresAt === null) {
        throw new Error(`expected a LEASED job with both lease properties set, got ${jobRow.state}`)
      }
      if (runRow.state !== "RUNNING" || runRow.outputManifestDigest !== null) {
        throw new Error(`expected a RUNNING run with a null output manifest, got ${runRow.state}`)
      }
      return { job: toCompilerJobDocument(jobRow), run: toCompilerRunDocument(runRow) }
    } finally {
      store.close()
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

/**
 * A REAL `AdoptionRecordV1`, compiled by R-7 and read back out of `adoption_records`.
 *
 * THE LAST EXCUSE, and the one whose payment this file demanded in writing: the vacuity guard under
 * the cross-check below said "R-7 is the LAST batch entitled to shrink this: when it lands, the list
 * empties, and this guard must be replaced by its inverse … in that same PR". So the excuse is paid
 * here and the guard is inverted below.
 *
 * ROUND-TRIPPED THROUGH SQLITE, like `storedSourceRecord` and `storedCompilerDocuments`, and for a
 * sharper reason than either: `record_json` is the canonical asset and the nine columns beside it are
 * an INDEX into it, so `readAdoptionRecord` is the only path that proves what a projection will
 * actually be handed. `compileAdoptionRecord`'s return value would grade the compiler, which
 * `adoption-record.test.ts` already does.
 *
 * THE UPSTREAM ROWS ARE THE SHIPPED ONES. `resolveIdentity` produces the subject and the artifact,
 * `updateArtifactResolution` moves the artifact to `FETCHED` with a digest, and `recordEvidence`
 * writes the evidence row — so every field of the compiled record traces to a producer rather than to
 * a literal in this file. Only the four digests whose producers live OUTSIDE this package
 * (`decisionDigest` from `@calllint/policy`, `presentationDigest`/`semanticContractDigest` from
 * `@calllint/trust-index`) are passed in as values, which is exactly the injection
 * `compileAdoptionRecord` is designed around: importing them here would invert the dependency the
 * compiler's docblock forbids inverting.
 *
 * THE INSTANCE IS THE FULLY-RESOLVED ONE, on purpose, and it is the harder of the two shapes to get
 * right: seven of the eight digests are non-null and `evidence` is an object, so the schema grades
 * the whole chain rather than a mostly-null record. `pageDigest` is left OMITTED — it is the one
 * property that is neither required nor nullable, so a record carrying an explicit null there would
 * be invalid, and `additionalProperties: false` means an absent key is the only honest spelling of
 * "not baked yet". The malformed twin nulls `decisionDigest`, which is the one mid-chain digest the
 * schema forbids to be null, because UNKNOWN is a decision and it is not SAFE.
 */
async function storedAdoptionRecord(): Promise<AdoptionRecordV1> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calllint-schema-compat-r7-"))
  try {
    const paths = resolveIndexPaths(cwd)
    for (const dir of paths.dirs) fs.mkdirSync(dir, { recursive: true })
    const db = await openBetterSqlite3(paths.db)
    const store = AdoptionIndexStore.open({
      cwd,
      migrationsDir: path.join(repoRoot, "packages", "adoption-index", MIGRATIONS_DIRNAME),
      db,
      now: REGISTRY_NOW,
    })
    try {
      const raw = {
        server: {
          name: "io.example/schema-compat",
          description: "prose",
          version: "2.0.0",
          packages: [
            { registryType: "npm", identifier: "@example/schema-compat", version: "2.0.0", transport: "stdio" },
          ],
        },
        _meta: {
          "io.modelcontextprotocol.registry/official": {
            status: "active",
            isLatest: true,
            publishedAt: "2026-07-01T00:00:00.000Z",
          },
        },
      }
      const record = toSourceRecord(raw as never, REGISTRY_NOW)
      if (record === null) throw new Error("the adapter rejected the fixture item — the producer, not the schema")
      const identity = resolveIdentity({
        records: [record],
        sourceId: OFFICIAL_REGISTRY_SOURCE_ID,
        observedAt: REGISTRY_NOW,
      })
      store.transaction((tx) => {
        tx.persistSourceRecords([record], REGISTRY_NOW)
        tx.persistIdentity(identity)
      })

      const subject = store.listSubjects()[0]
      const resolved = store.listArtifactVersions()[0]
      if (subject === undefined || resolved === undefined) {
        throw new Error("the resolver produced no subject/artifact — the producer, not the schema")
      }

      // Verified bytes, so `artifactDigest` is non-null and `evidenceDigest` may legally follow it.
      // Through the store's own writer, so `ARTIFACT_TRANSITIONS` grades the fixture too.
      const artifactDigest = `sha256:${"a".repeat(64)}`
      const evidenceRowDigest = `sha256:${"b".repeat(64)}`
      const policyDigest = `sha256:${"c".repeat(64)}`
      store.transaction((tx) => {
        tx.updateArtifactResolution({
          artifactVersionId: resolved.artifactVersionId,
          artifactStatus: "FETCHED",
          immutableDigest: artifactDigest,
          registryIntegrity: null,
          cacheKey: artifactDigest,
          lastVerifiedAt: REGISTRY_NOW,
        })
        tx.recordEvidence({
          evidenceDigest: evidenceRowDigest,
          artifactVersionId: resolved.artifactVersionId,
          engineVersion: "1.7.2",
          policyDigest,
          verdict: "UNKNOWN",
          evidenceJson: JSON.stringify({ findings: [{ id: "MCP-EXEC-01", severity: "high" }] }),
          createdAt: REGISTRY_NOW,
        })
      })

      const artifact = store.listArtifactVersions()[0]
      const evidence = store.listEvidenceRecords()[0]
      if (artifact === undefined || evidence === undefined) throw new Error("the store returned no row to compile from")

      const compiled = compileAdoptionRecord({
        subject,
        selectedArtifact: artifact,
        sourcePayloads: store.listLatestSourceRecordPayloads(OFFICIAL_REGISTRY_SOURCE_ID),
        evidence,
        findingCount: 1,
        // The three digests produced outside this package, injected rather than imported.
        decision: { verdict: "REVIEW", decisionDigest: `sha256:${"d".repeat(64)}`, policyDigest },
        presentation: {
          presentationDigest: `sha256:${"e".repeat(64)}`,
          semanticContractDigest: `sha256:${"f".repeat(64)}`,
        },
        hostCompatibility: [{ host: "cursor", tier: "A", installability: "REVIEW_REQUIRED" }],
        lifecycleStatus: "ACTIVE",
      })
      store.transaction((tx) => tx.upsertAdoptionRecord({ record: compiled, updatedAt: REGISTRY_NOW }))

      const readBack = store.readAdoptionRecord(subject.subjectId)
      if (readBack === null) throw new Error("the record did not survive the round trip — the store, not the schema")
      // Asserted at construction so a regression fails HERE and names itself, rather than producing
      // an instance that validates for a reason nobody chose. The three properties this case exists
      // to grade: the chain is fully populated, the findings did NOT leak into the public projection,
      // and `pageDigest` is absent rather than null.
      if (readBack.digests.artifactDigest === null || readBack.digests.evidenceDigest === null) {
        throw new Error("expected a fully-resolved chain; the weak shape leaves the chain ungraded")
      }
      if (JSON.stringify(readBack).includes("MCP-EXEC-01")) {
        throw new Error("the raw findings reached the public record — the compiler, not the schema")
      }
      if ("pageDigest" in readBack.digests) throw new Error("expected pageDigest to be absent, not present")
      return readBack
    } finally {
      store.close()
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

const { plan, decisionReceipt } = buildPlanAndReceipt()
const sourceRecord = await storedSourceRecord()
const { subject: canonicalSubject, conflict: identityConflict } = resolvedIdentityDocuments()
const artifactVersion = resolvedArtifactDocument()
const { job: compilerJob, run: compilerRun } = await storedCompilerDocuments()
const adoptionRecord = await storedAdoptionRecord()

interface Case {
  schema: string
  valid: unknown
  /** A structurally-wrong instance that MUST be rejected. */
  malformed: unknown
}

const CASES: Case[] = [
  {
    schema: "action",
    valid: readJson("packages/fixtures/action/a2a.delegate/positive-secure-delegate.json"),
    malformed: { schema_version: "calllint.action.v0", kind: "not-a-real-kind" },
  },
  {
    schema: "agent-inbox-event",
    valid: readJson("packages/fixtures/agent-inbox/discord/direct-message.normalized.json"),
    malformed: { schema_version: "calllint.agent-inbox-event.v0", event_type: "not.an.event" },
  },
  {
    schema: "artifact-identity",
    valid: prep.artifact,
    malformed: { ...prep.artifact, sourceType: "banana" },
  },
  {
    schema: "authority-manifest",
    valid: prep.authority,
    malformed: { ...prep.authority, completeness: "sometimes" },
  },
  {
    schema: "decision",
    valid: prep.decision,
    malformed: { ...prep.decision, verdict: "MAYBE" },
  },
  {
    schema: "flow",
    valid: buildOneFlow(),
    malformed: { ...buildOneFlow(), risk: "critical" }, // risk must be an object, not a string
  },
  {
    schema: "receipt",
    valid: buildScanReceipt(),
    malformed: { ...buildScanReceipt(), verdict: "PROBABLY_FINE" },
  },
  {
    schema: "decision-receipt",
    valid: decisionReceipt,
    malformed: { ...decisionReceipt, result: "maybe-applied" },
  },
  {
    schema: "install-plan",
    valid: plan,
    malformed: { ...plan, tier: "Z" },
  },
  {
    schema: "evidence-provider",
    valid: importEvidence(
      JSON.stringify({ scanner: "SkillSpector", commit: "a".repeat(40), status: "complete", findings: [] }),
      { format: "json" },
    ),
    malformed: { schema_version: "calllint.evidence-provider.v0", completeness: "totally" },
  },
  {
    // The Evidence Manifest (calllint.evidence-manifest.v1, PR-D4) is a committed,
    // digest-addressed projection — validate a REAL served manifest, so the schema
    // can never drift from the emitter (same discipline as the other cases).
    schema: "evidence-manifest",
    valid: readJson("apps/web/public/trust/calllint-fixtures/block-observed-payment.manifest.json"),
    malformed: { schema: "calllint.evidence-manifest.v1", verdict: "MAYBE" },
  },
  {
    // R-1: the Canonical Adoption Index mirror. `valid` is the record SQLite handed back
    // (see `storedSourceRecord`), so this case fails if the store's output shape ever
    // parts company with the committed schema.
    schema: "calllint.source-record.v1",
    valid: sourceRecord,
    // `unknown` is a real lifecycle state and `active` is real; `live` is neither, and a
    // schema that accepted it would let an unrecognized upstream status read as current.
    malformed: { ...sourceRecord, lifecycle: { ...sourceRecord.lifecycle, status: "live" } },
  },
  {
    schema: "calllint.canonical-subject.v1",
    valid: canonicalSubject,
    // `canonicalSlug: null` is THE malformed case for this PR rather than a generic bad enum.
    // Migration 002 makes the COLUMN nullable; the document must keep refusing it, because that
    // refusal is the whole reason the divergence is confined to storage. If this ever accepted
    // null, `subjectSlugRow`'s translation would be pointless and the published schema would
    // have silently changed meaning.
    malformed: { ...canonicalSubject, canonicalSlug: null },
  },
  {
    schema: "calllint.identity-conflict.v1",
    valid: identityConflict,
    malformed: { ...identityConflict, conflictType: "vibes" },
  },
  {
    // R-4's excuse, paid by R-6 — see `resolvedArtifactDocument` for why a grep said otherwise.
    schema: "calllint.artifact-version.v1",
    valid: artifactVersion,
    // `RESOLVED`/`FETCHED`/`UNAVAILABLE`/`UNSUPPORTED`/`REJECTED` are the five real statuses.
    // `VERIFIED` is the plausible sixth that does not exist, and it is the dangerous kind of
    // wrong: a reader dispatching on it would treat an unfetched artifact as one whose bytes
    // were checked against its claim.
    malformed: { ...artifactVersion, artifactStatus: "VERIFIED" },
  },
  {
    // R-6: the queue row this batch's store writes, read back through SQLite.
    schema: "calllint.compiler-job.v1",
    valid: compilerJob,
    // A MISSPELLED STATE, because the enum is the only structural closure this row has anywhere.
    // `compiler_jobs.state` is `TEXT NOT NULL` with NO CHECK constraint (migration 001:111-138), so
    // SQLite accepts any string; TypeScript is erased at runtime; the schema's `enum` and the store's
    // `assertJobState` are the two things left. `SUCEEDED` is the dangerous kind of wrong — a job
    // that is actually finished matches neither `PENDING` nor any terminal, so it is invisible to
    // both the lease sweep and the completion census rather than loudly broken.
    //
    // MEASURED, and worth stating because the first attempt here was wrong: a HALF-SET LEASE
    // (`leaseExpiresAt: null` with an owner set) is STRUCTURALLY VALID against this schema. The
    // "nullable together" rule is in the schema's prose, but the schema carries no
    // `dependentRequired`/`allOf`, and both properties are independently `["string","null"]`. So that
    // rule is enforced ONLY by `assertLeaseCoherent` on the write path — see `job-lease.test.ts`
    // (controls #88/#89), which is where the guarantee actually lives. Pointing this case at the
    // half-set lease would have asserted a refusal the published schema does not make.
    malformed: { ...compilerJob, state: "SUCEEDED" },
  },
  {
    // R-6: the run record. `valid` is `RUNNING`, so `outputManifestDigest` is present AND null —
    // the asymmetry the schema's description argues for at length.
    schema: "calllint.compiler-run.v1",
    valid: compilerRun,
    // `metrics` carrying a verdict is THE malformed case for this schema. It is closed
    // (`additionalProperties: false`) for a stated reason — so "a run report can never become a
    // second, unaudited place where a decision is made" — and Product Principle 4 is why that
    // matters. A bad `state` enum would also be rejected, but it would not grade the closure, and
    // the closure is the property that keeps verdicts in the rules layer.
    malformed: { ...compilerRun, metrics: { ...compilerRun.metrics, verdict: "SAFE" } },
  },
  {
    // R-7: THE canonical asset. Every page, contract, lookup entry and partner response is a
    // projection of this document, so it is the last schema in this table and the one whose excuse
    // this batch was required to pay.
    schema: "calllint.adoption-record.v1",
    valid: adoptionRecord,
    // A NULL `decisionDigest` is the malformed case, and it is chosen over the easy alternatives (a
    // bad `lifecycle.status`, an unknown key) because it is the one the schema argues for: the digest
    // set makes exactly this member non-nullable in the middle of a chain whose neighbours ARE
    // nullable, so that a record can never be published without a verdict attached. A record with no
    // decision is the false-SAFE shape — Product Principle 2. `assertDigestChain` refuses it on the
    // write path too (`adoption-digest-chain.test.ts` control (e)); this asserts the PUBLISHED schema
    // refuses it independently, so a future writer that skipped that guard still cannot ship one.
    malformed: { ...adoptionRecord, digests: { ...adoptionRecord.digests, decisionDigest: null } },
  },
]

/**
 * Schemas deliberately WITHOUT a case in this file, each with the reason it is excused.
 *
 * ONE KIND IS LEFT, and the emptying of the other is the point of this batch:
 *
 *   - Covered elsewhere. A dedicated test already validates real output against the schema,
 *     so a second case here would duplicate the coverage rather than add any.
 *   - ~~No emitter yet.~~ EXHAUSTED at R-7. The six Workstream R tables beyond the mirror were
 *     created by R-1's canonical DDL and populated by R-3…R-7; every one now has a writer, so every
 *     one has a real instance above and no entry here. The rule that governed them — control #9's
 *     "a hand-authored instance would pass forever while proving only that this file and the schema
 *     agree with each other", and the obligation that "each batch that writes one of these tables
 *     removes its entry here in the same PR that adds its emitter" — is kept rather than deleted,
 *     because it binds the NEXT schema that lands without a producer. The two batches that did not
 *     pay it on time (R-3, R-4) are recorded at `resolvedIdentityDocuments` and
 *     `resolvedArtifactDocument`; R-7 paid it in its own PR.
 *
 * A REASON THAT WENT STALE, and is corrected here rather than left to read as coverage. The
 * `sarif-schema-2.1.0` entry claimed "vendored; covered by report-renderer/test/sarif-schema.test.ts",
 * and BOTH halves are false as committed: `schemas/sarif-schema-2.1.0.json` is 14 bytes holding the
 * literal text `404: Not Found` (a failed download committed in #114), and that test does not read it
 * — it `fetch`es `json.schemastore.org` at run time. Nothing in the repo reads the file. It is
 * therefore excused as an UNREAD, BROKEN artifact, which is what it is, so the next reader is not
 * told a validator exists where none does. Replacing or deleting the file is a change to committed
 * bytes with its own blast radius (the fetch-based test would need to move offline), so it is named
 * here and left to a batch that can carry it; `EXCUSED_REASONS`'s own directional checks below still
 * force it to stay listed and caseless.
 */
const EXCUSED_REASONS: ReadonlyArray<readonly [string, string]> = [
  ["evidence-bundle", "covered by packages/evidence/test/model-schema.test.ts against real importEvidence output"],
  ["evidence-gap", "covered by packages/evidence/test/model-schema.test.ts"],
  ["evidence-subject", "covered by packages/evidence/test/model-schema.test.ts"],
  ["telemetry-event", "covered by packages/telemetry-contract/test/schema.test.ts"],
  ["registry-listing", "covered by tests/readback/manifestSchema.test.ts"],
  // MEASURED, not assumed — see the docblock above. 14 bytes of `404: Not Found`, read by nothing.
  ["sarif-schema-2.1.0", "NOT a schema: 14 bytes of `404: Not Found` from a failed vendoring in #114, read by no code; SARIF output is graded against the LIVE schemastore.org copy in report-renderer/test/sarif-schema.test.ts"],
  ["calllint.trust-event.v1", "covered by packages/trust-event-contract/test/trust-event-contract.test.ts"],
  ["calllint.trust-lookup-index.v1", "covered by packages/trust-index/test/lookup-index.test.ts"],
  ["calllint.discovery.v1", "covered by packages/trust-index/test/safe-install/committed-install-tree.test.ts"],
  ["calllint.presentation-content.v1", "covered by packages/trust-index/test/safe-install/presentation-content.test.ts"],
  ["calllint.safe-install-result.v1", "covered by packages/trust-index/test/safe-install/projection.test.ts"],
  ["calllint.agent-adoption-contract.v1", "covered by packages/trust-index/test/safe-install/projection.test.ts"],
]
const EXCUSED = new Set(EXCUSED_REASONS.map(([name]) => name))

/**
 * The seven Workstream R schemas — the canonical graph's own documents.
 *
 * Declared as data because the inverse guard at the bottom of this file asserts over ALL of them, not
 * only over R-7's. Every one of the seven now has a writer, so every one must have a real instance
 * case; a future R schema that lands without one fails there rather than sitting excused.
 *
 * `calllint.discovery.v1`, `calllint.trust-lookup-index.v1` and the safe-install documents are NOT
 * here: they are projections OF this graph, produced in `@calllint/trust-index`, and their coverage
 * lives with their producers.
 */
const R_SCHEMAS = new Set([
  "calllint.source-record.v1",
  "calllint.canonical-subject.v1",
  "calllint.identity-conflict.v1",
  "calllint.artifact-version.v1",
  "calllint.compiler-job.v1",
  "calllint.compiler-run.v1",
  "calllint.adoption-record.v1",
])

describe("schema compatibility — every committed schema accepts real output + rejects malformed", () => {
  for (const c of CASES) {
    describe(`${c.schema}.schema.json`, () => {
      const validate = compile(c.schema)

      it("accepts a valid instance produced by the shipping code/fixture", () => {
        const ok = validate(c.valid)
        if (!ok) console.error(c.schema, validate.errors)
        expect(ok).toBe(true)
      })

      it("rejects a malformed instance (fail-closed)", () => {
        expect(validate(c.malformed)).toBe(false)
      })

      it("rejects an unknown top-level property when additionalProperties:false", () => {
        const schema = readSchema(c.schema)
        if (schema.additionalProperties === false && c.valid && typeof c.valid === "object") {
          const withExtra = { ...(c.valid as Record<string, unknown>), __unexpected__: 1 }
          expect(validate(withExtra)).toBe(false)
        }
      })
    })
  }

  it("covers every schema under schemas/ that carries a versioned instance", () => {
    // DERIVED from the directory, not declared. The previous form of this check listed the
    // 11 covered names and asserted each was covered — which is a tautology over `CASES`:
    // it could not fail when a NEW schema landed, and measurably did not (R-1's seven files
    // appeared with every gate green). The enumeration now starts from `schemas/`, so an
    // added file is uncovered until it is either given a case or explicitly excused below.
    // Every `*.json`, not only `*.schema.json`: the vendored `sarif-schema-2.1.0.json` carries
    // the shorter suffix, so a filter on `.schema.json` would silently exempt any future file
    // that landed the same way. Both suffixes reduce to the same stem.
    const covered = new Set(CASES.map((c) => c.schema))
    const onDisk = fs
      .readdirSync(SCHEMAS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/(?:\.schema)?\.json$/, ""))
      .sort()

    const uncovered = onDisk.filter((s) => !covered.has(s) && !EXCUSED.has(s))
    expect(uncovered).toEqual([])

    // The excuse list is itself checked, in both directions. An entry naming a schema that
    // no longer exists is stale, and an entry that has since gained a case is a leftover
    // exemption — either one would quietly widen the hole this test closes.
    const disk = new Set(onDisk)
    for (const [name, reason] of EXCUSED_REASONS) {
      expect(disk.has(name), `${name} is excused but not present under schemas/`).toBe(true)
      expect(covered.has(name), `${name} is excused AND has a case — drop the excuse`).toBe(false)
      expect(reason.length).toBeGreaterThan(20)
    }
    // The set is non-trivial in both parts, so neither an empty dir read nor an
    // excuse-everything list can make the assertion above pass vacuously.
    expect(onDisk.length).toBeGreaterThan(25)
    expect(covered.size).toBeGreaterThan(10)
    // The widened filter is load-bearing: assert it actually reaches the one file that does
    // not carry the `.schema.json` suffix, so a narrowing of it fails here rather than
    // silently dropping that file out of the enumeration's domain.
    expect(disk.has("sarif-schema-2.1.0")).toBe(true)
  })

  /**
   * THE BACKLOG, NOW EMPTY — and the guard below is its INVERSE, as the previous version of this
   * block required in writing.
   *
   * What this list was: the Workstream R schemas whose tables no batch populated yet. "Excused from
   * an instance case" must not mean "unmeasured", so each got a structural grade — compiles under
   * Ajv, fail-closed, `schema` const matching its filename — because a typo there is otherwise found
   * by the batch that writes the table, several batches later.
   *
   * It started at six and shrank as each writer landed. R-3's two left with the nullable-slug PR,
   * R-6 took `compiler-job`/`compiler-run` (it was their emitter) and `artifact-version` (R-4's had
   * already shipped and the excuse outlived it). `calllint.adoption-record.v1` was the LAST entry,
   * and R-7 is its emitter, so the list is empty.
   *
   * WHY IT STAYS DECLARED AT ZERO LENGTH RATHER THAN BEING DELETED. The old vacuity guard read
   * `expect(AWAITING_EMITTER.length).toBeGreaterThan(0)`, and it named its own successor: "R-7 is the
   * LAST batch entitled to shrink this: when it lands, the list empties, and this guard must be
   * replaced by its inverse (both lists are empty AND every schema on disk has a case) in that same
   * PR." Deleting the list would satisfy the letter of that and lose the mechanism: the NEXT schema
   * that lands without a producer needs somewhere to go, and an empty array with a live assertion on
   * its emptiness is what forces the choice to be explicit — either give the schema a real case, or
   * add it here and watch the inverse guard fail until the structural grade is restored.
   *
   * THE INVERSE IS A STRONGER CLAIM, not a weaker one. `> 0` said "the backlog is non-empty";
   * `=== 0` says "the backlog is empty" AND — this is the half that has teeth — "every schema on disk
   * is either cased or excused for a reason that is not control #9". A list emptied by deleting the
   * coverage would fail the second half.
   */
  const AWAITING_EMITTER: readonly string[] = []

  describe("Workstream R schemas awaiting an emitter — structural grade only", () => {
    for (const name of AWAITING_EMITTER) {
      it(`${name}: compiles, is fail-closed, and self-identifies`, () => {
        const schema = readSchema(name)
        // Compiling is the load-bearing part: Ajv rejects a malformed schema, so this
        // catches a bad `pattern` or a misspelled keyword that would otherwise sit inert.
        const validate = compile(name)
        expect(schema.additionalProperties).toBe(false)
        expect(schema.$id).toBe(`https://calllint.com/schemas/${name}.schema.json`)
        // The `schema` discriminator must equal the filename stem, or a reader that
        // dispatches on it loads the wrong validator.
        expect(schema.properties?.schema?.const).toBe(name)
        expect(schema.required).toContain("schema")
        // Fail-closed, asserted rather than assumed: an empty object is missing every
        // required key, so a schema that accepted it would validate nothing at all.
        expect(validate({})).toBe(false)
        expect(validate({ schema: name })).toBe(false)
      })
    }

    it("the backlog is EMPTY, and every schema on disk is cased or excused for another reason", () => {
      // HALF ONE: the backlog is empty, in both of its spellings. The `for` above therefore
      // registers no `it`, which is the honest consequence of every table having a writer.
      expect(AWAITING_EMITTER).toHaveLength(0)
      const byControl9 = EXCUSED_REASONS.filter(([, r]) => r.includes("control #9")).map(([n]) => n).sort()
      expect(byControl9).toEqual([])

      // HALF TWO, which is what makes half one non-vacuous. Emptying `AWAITING_EMITTER` by DELETING
      // the coverage instead of adding an emitter is the failure mode the old guard warned about, and
      // it is caught here: every schema on disk must now be reachable as either a real case or an
      // excuse whose reason is NOT "no emitter yet". Re-derived from the directory rather than reusing
      // the sets above, so this assertion cannot be satisfied by a change to those declarations alone.
      const covered = new Set(CASES.map((c) => c.schema))
      const onDisk = fs
        .readdirSync(SCHEMAS_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/(?:\.schema)?\.json$/, ""))
      expect(onDisk.length).toBeGreaterThan(25)
      for (const name of onDisk) {
        expect(covered.has(name) || EXCUSED.has(name), `${name} is neither cased nor excused`).toBe(true)
      }
      // And the specific schema this batch owns is on the CASED side, not the excused one — the
      // assertion the previous guard could not make, and the one a future reader will check first.
      expect(covered.has("calllint.adoption-record.v1")).toBe(true)
      expect(EXCUSED.has("calllint.adoption-record.v1")).toBe(false)
      // Every Workstream R schema, not only R-7's: this is the batch that closes the whole set, so
      // the claim is asserted over all seven rather than over the one that happened to be last.
      for (const name of onDisk.filter((n) => R_SCHEMAS.has(n))) {
        expect(covered.has(name), `${name} is a Workstream R schema and must have a real instance case`).toBe(true)
      }
      // VACUITY GUARD on that loop: a mistyped name in `R_SCHEMAS` would make it iterate zero times.
      expect(onDisk.filter((n) => R_SCHEMAS.has(n))).toHaveLength(R_SCHEMAS.size)
    })
  })
})
