import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const cliDir = join(repoRoot, "apps", "cli")
const binary = join(cliDir, "dist", "index.js")

/** Run the built binary, capturing stdout + the REAL exit code (0/1/2/3). */
function runBin(args: string[]): { stdout: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, [binary, ...args], {
      encoding: "utf8",
      cwd: repoRoot,
    })
    return { stdout, code: 0 }
  } catch (err) {
    const e = err as { status?: number; stdout?: string }
    return { stdout: e.stdout ?? "", code: e.status ?? 1 }
  }
}

/**
 * End-to-end coverage for the local signing flow (ADR 0032): keygen → sign →
 * verify, plus tamper and missing-key paths. This is the path that a prior
 * busy-wait-for-async implementation deadlocked (keygen/sign never returned);
 * these tests fail loudly if that regression returns, because a real child
 * process would hit its timeout instead of completing in milliseconds.
 */
describe("receipt signing E2E (keygen → sign → verify)", () => {
  let workDir: string
  const keyFile = () => join(workDir, "key.json")
  const receiptFile = () => join(workDir, "r.json")
  const signedFile = () => join(workDir, "signed.json")

  const UNSIGNED_RECEIPT = {
    schema_version: "calllint.receipt.v0",
    receipt_id: "clrec_e2eSignTest0001",
    created_at: "2026-07-02T12:00:00.000Z",
    tool: { name: "calllint", version: "1.0.0" },
    subject: { type: "scan", target: "e2e" },
    verdict: "SAFE",
    hashes: {
      input_hash: "sha256:" + "1".repeat(64),
      policy_hash: "sha256:" + "2".repeat(64),
      report_hash: "sha256:" + "3".repeat(64),
      ruleset_hash: "sha256:" + "4".repeat(64),
    },
    risk_counts: { safe: 1, review: 0, block: 0, unknown: 0 },
    finding_refs: [],
    trust_boundaries: {
      executed_target: false,
      network_used: false,
      llm_in_verdict_path: false,
      secret_values_read: false,
    },
  }

  beforeAll(() => {
    execFileSync(process.execPath, ["./build.mjs"], { cwd: cliDir, stdio: "ignore" })
    expect(existsSync(binary)).toBe(true)
    workDir = mkdtempSync(join(tmpdir(), "calllint-receipt-sign-"))
    writeFileSync(receiptFile(), JSON.stringify(UNSIGNED_RECEIPT, null, 2))
  })

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  it("keygen writes a well-formed ed25519 keypair (and returns promptly)", () => {
    const res = runBin(["receipt", "keygen", "--out", keyFile()])
    expect(res.code).toBe(0)
    expect(res.stdout).toContain("Keypair generated successfully")
    expect(existsSync(keyFile())).toBe(true)

    const key = JSON.parse(readFileSync(keyFile(), "utf8"))
    expect(key.algorithm).toBe("ed25519")
    expect(typeof key.public_key).toBe("string")
    expect(typeof key.private_key).toBe("string")
    // base64url, no padding
    expect(key.public_key).not.toContain("=")
    expect(key.private_key).not.toContain("=")
  })

  it("sign attaches a signature and verify accepts it with the public key", () => {
    const sign = runBin(["receipt", "sign", receiptFile(), "--key", keyFile(), "--out", signedFile()])
    expect(sign.code).toBe(0)
    expect(sign.stdout).toContain("Receipt signed successfully")
    expect(existsSync(signedFile())).toBe(true)

    const signed = JSON.parse(readFileSync(signedFile(), "utf8"))
    expect(signed.signature.algorithm).toBe("ed25519")
    expect(signed.signature.value).toMatch(/^[A-Za-z0-9_-]{86}$/)
    expect(signed.signature.signed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Signing must not alter the receipt body — verdict is copied, never re-judged.
    expect(signed.verdict).toBe("SAFE")

    const verify = runBin(["receipt", "verify", signedFile(), "--public-key", keyFile()])
    expect(verify.code).toBe(0)
    expect(verify.stdout).toContain("valid")
    expect(verify.stdout).toContain("Signature: valid")
  })

  it("verify --json reports a valid signature", () => {
    const verify = runBin(["receipt", "verify", signedFile(), "--public-key", keyFile(), "--json"])
    expect(verify.code).toBe(0)
    const out = JSON.parse(verify.stdout)
    expect(out.valid).toBe(true)
    expect(out.signed).toBe(true)
    expect(out.signature.valid).toBe(true)
    expect(out.signature.algorithm).toBe("ed25519")
  })

  it("detects a tampered receipt (verdict flipped) with exit 1", () => {
    const tampered = join(workDir, "tampered.json")
    const signed = JSON.parse(readFileSync(signedFile(), "utf8"))
    signed.verdict = "BLOCK"
    writeFileSync(tampered, JSON.stringify(signed, null, 2))

    const verify = runBin(["receipt", "verify", tampered, "--public-key", keyFile()])
    expect(verify.code).toBe(1)
  })

  it("a signed receipt without --public-key errors (exit 3), does not hang or pass", () => {
    const verify = runBin(["receipt", "verify", signedFile()])
    // EXIT.ERROR — verification cannot complete without a key; it must NOT
    // silently succeed, and (crucially) must return rather than deadlock.
    expect(verify.code).toBe(3)
  })

  it("refuses to sign a receipt that already has a signature", () => {
    const resign = runBin(["receipt", "sign", signedFile(), "--key", keyFile(), "--out", join(workDir, "double.json")])
    expect(resign.code).toBe(3)
    expect(existsSync(join(workDir, "double.json"))).toBe(false)
  })
})
