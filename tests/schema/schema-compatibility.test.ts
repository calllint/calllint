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
  OFFICIAL_REGISTRY_SOURCE_ID,
  MIGRATIONS_DIRNAME,
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

const { plan, decisionReceipt } = buildPlanAndReceipt()
const sourceRecord = await storedSourceRecord()
const { subject: canonicalSubject, conflict: identityConflict } = resolvedIdentityDocuments()

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
]

/**
 * Schemas deliberately WITHOUT a case in this file, each with the reason it is excused.
 *
 * Two distinct kinds live here, and the distinction matters:
 *
 *   - Covered elsewhere. A dedicated test already validates real output against the schema,
 *     so a second case here would duplicate the coverage rather than add any.
 *   - No emitter yet. The six Workstream R tables beyond the mirror are created by R-1's
 *     canonical DDL but populated by R-3…R-7. There is no production builder to validate
 *     against, and control #9 forbids the alternative: a hand-authored instance would pass
 *     forever while proving only that this file and the schema agree with each other. The
 *     honest state is "declared, not yet graded" — and each batch that writes one of these
 *     tables removes its entry here in the same PR that adds its emitter.
 */
const EXCUSED_REASONS: ReadonlyArray<readonly [string, string]> = [
  ["evidence-bundle", "covered by packages/evidence/test/model-schema.test.ts against real importEvidence output"],
  ["evidence-gap", "covered by packages/evidence/test/model-schema.test.ts"],
  ["evidence-subject", "covered by packages/evidence/test/model-schema.test.ts"],
  ["telemetry-event", "covered by packages/telemetry-contract/test/schema.test.ts"],
  ["registry-listing", "covered by tests/readback/manifestSchema.test.ts"],
  ["sarif-schema-2.1.0", "the upstream SARIF 2.1.0 schema, vendored; covered by report-renderer/test/sarif-schema.test.ts"],
  ["calllint.trust-event.v1", "covered by packages/trust-event-contract/test/trust-event-contract.test.ts"],
  ["calllint.trust-lookup-index.v1", "covered by packages/trust-index/test/lookup-index.test.ts"],
  ["calllint.discovery.v1", "covered by packages/trust-index/test/safe-install/committed-install-tree.test.ts"],
  ["calllint.presentation-content.v1", "covered by packages/trust-index/test/safe-install/presentation-content.test.ts"],
  ["calllint.safe-install-result.v1", "covered by packages/trust-index/test/safe-install/projection.test.ts"],
  ["calllint.agent-adoption-contract.v1", "covered by packages/trust-index/test/safe-install/projection.test.ts"],
  ["calllint.artifact-version.v1", "R-4 writes artifact_versions; no emitter exists yet (control #9)"],
  ["calllint.adoption-record.v1", "R-7 projects adoption_records; no emitter exists yet (control #9)"],
  ["calllint.compiler-job.v1", "R-6 writes compiler_jobs; no emitter exists yet (control #9)"],
  ["calllint.compiler-run.v1", "R-6 writes compiler_runs; no emitter exists yet (control #9)"],
]
const EXCUSED = new Set(EXCUSED_REASONS.map(([name]) => name))

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
   * The six Workstream R schemas whose tables no batch populates yet. "Excused from an
   * instance case" must not mean "unmeasured": without an emitter there is nothing to
   * validate against, but the schema is still committed bytes that a later batch will build
   * to, so the parts that are checkable without an instance are checked now — it compiles
   * under Ajv, it is fail-closed, and its `schema` const matches its own filename. A typo
   * there is otherwise found by R-6, three batches later.
   */
  const AWAITING_EMITTER = [
    // `calllint.canonical-subject.v1` and `calllint.identity-conflict.v1` LEFT this list when
    // the nullable-slug PR wired R-3's resolver output into a real instance case above. They
    // should have left when R-3 merged — the docblock's "in the same PR that adds its emitter"
    // was not honoured, and a structural-only grade outlived its excuse for two batches.
    "calllint.artifact-version.v1",
    "calllint.adoption-record.v1",
    "calllint.compiler-job.v1",
    "calllint.compiler-run.v1",
  ] as const

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

    it("is exactly the set excused for having no emitter, so a graded schema cannot sit here", () => {
      // Derived cross-check between the two lists above: every entry here must also be
      // excused (else it has a real case and this grade is the weaker duplicate), and every
      // excuse citing control #9 must appear here (else it is excused AND ungraded).
      for (const name of AWAITING_EMITTER) expect(EXCUSED.has(name)).toBe(true)
      const byControl9 = EXCUSED_REASONS.filter(([, r]) => r.includes("control #9")).map(([n]) => n).sort()
      expect(byControl9).toEqual([...AWAITING_EMITTER].sort())
    })
  })
})
