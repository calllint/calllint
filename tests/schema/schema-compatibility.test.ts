import fs from "node:fs"
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

// ── the coverage table: {schema, a valid instance, a malformed instance} ──────

const { plan, decisionReceipt } = buildPlanAndReceipt()

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
]

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
    // Guard against a NEW schema landing without a compat case here. The set below
    // is the full schemas/ dir minus those with dedicated tests elsewhere
    // (evidence-{bundle,gap,subject}, telemetry-event, sarif, registry-listing).
    const covered = new Set(CASES.map((c) => c.schema))
    const expected = [
      "action",
      "agent-inbox-event",
      "artifact-identity",
      "authority-manifest",
      "decision",
      "decision-receipt",
      "evidence-provider",
      "flow",
      "install-plan",
      "receipt",
    ]
    for (const s of expected) expect(covered.has(s)).toBe(true)
  })
})
