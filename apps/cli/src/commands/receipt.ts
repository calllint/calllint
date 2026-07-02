import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { verifyReceipt } from "@calllint/core"
import type { CallLintReceipt } from "@calllint/core"
import {
  generateKeypair,
  signReceipt as signReceiptCrypto,
  verifyReceipt as verifyReceiptCrypto,
  exportKeypair,
  importKeypair,
} from "@calllint/signature"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

export interface ReceiptDeps {
  cwd: string
}

/**
 * `calllint receipt <subcommand>`
 *
 * Subcommands:
 * - verify <file>: Validate receipt structure and signature (if present)
 * - sign <receipt> --key <keyfile>: Sign a receipt locally (dev/test only)
 * - keygen --out <file>: Generate a test ed25519 keypair (dev/test only)
 *
 * All crypto here is synchronous (a pure CPU op over a fixed 32-byte hash), so
 * this command — like every other CallLint command — is a synchronous function
 * returning a CommandResult. See ADR 0032 and @calllint/signature.
 */
export function receiptCommand(args: ParsedArgs, deps: ReceiptDeps): CommandResult {
  const sub = args.positionals[0]

  switch (sub) {
    case "verify":
      return receiptVerify(args, deps)
    case "sign":
      return receiptSign(args, deps)
    case "keygen":
      return receiptKeygen(args, deps)
    default:
      return {
        stdout: "",
        stderr: [
          "Usage: calllint receipt <subcommand>",
          "",
          "Subcommands:",
          "  verify <receipt.json>              Validate receipt structure and signature",
          "  sign <receipt.json> --key <file>   Sign receipt locally (development only)",
          "  keygen --out <file>                Generate test keypair (development only)",
        ].join("\n"),
        exitCode: EXIT.USAGE,
      }
  }
}

/**
 * `calllint receipt verify <file>` — Validate receipt structure and signature (if present).
 *
 * - Structural validation (ADR 0028): schema version, required fields, hash formats
 * - Cryptographic validation (ADR 0032): if signature field present, verify ed25519 signature
 *
 * Exit 0 = valid, 1 = invalid
 */
function receiptVerify(args: ParsedArgs, deps: ReceiptDeps): CommandResult {
  const file = args.positionals[1]
  if (!file) {
    return {
      stdout: "",
      stderr: "Usage: calllint receipt verify <receipt.json> [--public-key <keyfile>]",
      exitCode: EXIT.USAGE,
    }
  }

  let raw: string
  try {
    raw = readFileSync(resolve(deps.cwd, file), "utf8")
  } catch (e) {
    return {
      stdout: "",
      stderr: `Could not read receipt ${file}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }

  // Parse first: malformed JSON is an invalid receipt
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    const msg = `receipt is not valid JSON: ${e instanceof Error ? e.message : String(e)}`
    if (flagBool(args.flags, "json")) {
      return {
        stdout: JSON.stringify({ valid: false, errors: [msg], signed: false }, null, 2),
        exitCode: 1,
      }
    }
    return { stdout: "", stderr: `CallLint receipt: invalid\n  - ${msg}`, exitCode: 1 }
  }

  // Step 1: Structural validation
  const structResult = verifyReceipt(parsed)
  if (!structResult.valid) {
    if (flagBool(args.flags, "json")) {
      return {
        stdout: JSON.stringify(structResult, null, 2),
        exitCode: 1,
      }
    }
    const lines = ["CallLint receipt: invalid", ...structResult.errors.map((e) => `  - ${e}`)]
    return { stdout: "", stderr: lines.join("\n"), exitCode: 1 }
  }

  const receipt = parsed as CallLintReceipt

  // Step 2: Cryptographic validation (if signature present)
  if (receipt.signature) {
    return verifySignature(receipt, args, deps)
  }

  // No signature: valid unsigned receipt
  if (flagBool(args.flags, "json")) {
    return {
      stdout: JSON.stringify(
        {
          valid: true,
          receipt_id: receipt.receipt_id,
          schema_version: receipt.schema_version,
          verdict: receipt.verdict,
          signed: false,
        },
        null,
        2
      ),
      exitCode: EXIT.OK,
    }
  }

  const stdout = [
    "✓ CallLint receipt: valid",
    `  Receipt ID: ${receipt.receipt_id}`,
    `  Schema: ${receipt.schema_version}`,
    `  Verdict: ${receipt.verdict}`,
    `  Signature: unsigned local receipt`,
  ].join("\n")
  return { stdout, exitCode: EXIT.OK }
}

/**
 * Verify a signed receipt's ed25519 signature and format the result.
 *
 * The public key must be supplied locally via `--public-key <keyfile>` (a JSON
 * file with a base64url `public_key`). Fetching keys from a `public_key_url`
 * over the network is intentionally out of scope here — CallLint verification
 * stays offline (ADR 0032 §5.3).
 */
function verifySignature(receipt: CallLintReceipt, args: ParsedArgs, deps: ReceiptDeps): CommandResult {
  const sig = receipt.signature!
  const publicKeyUrl = sig.public_key_url || "https://calllint.com/.well-known/receipt-keys.json"

  const publicKeyFlag = args.flags["public-key"]
  if (!publicKeyFlag || typeof publicKeyFlag !== "string") {
    return {
      stdout: "",
      stderr: [
        "Receipt has a signature but no public key was provided.",
        `  Signature key_id: ${sig.key_id}`,
        `  Public key URL:   ${publicKeyUrl}`,
        "",
        "Verify offline by passing the public key:",
        "  calllint receipt verify <receipt.json> --public-key <keyfile>",
      ].join("\n"),
      exitCode: EXIT.ERROR,
    }
  }

  let publicKey: string
  try {
    const keyJson = JSON.parse(readFileSync(resolve(deps.cwd, publicKeyFlag), "utf8"))
    publicKey = keyJson.public_key as string
    if (typeof publicKey !== "string") {
      throw new Error("key file has no string 'public_key' field")
    }
  } catch (e) {
    return {
      stdout: "",
      stderr: `Could not read public key from ${publicKeyFlag}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }

  const cryptoResult = verifyReceiptCrypto(receipt as unknown as Record<string, unknown>, publicKey)

  if (flagBool(args.flags, "json")) {
    return {
      stdout: JSON.stringify(
        {
          valid: cryptoResult.valid,
          receipt_id: receipt.receipt_id,
          schema_version: receipt.schema_version,
          verdict: receipt.verdict,
          signed: true,
          signature: {
            valid: cryptoResult.valid,
            key_id: sig.key_id,
            algorithm: sig.algorithm,
            signed_at: sig.signed_at,
            error: cryptoResult.error,
          },
        },
        null,
        2
      ),
      exitCode: cryptoResult.valid ? EXIT.OK : 1,
    }
  }

  if (!cryptoResult.valid) {
    const lines = [
      "✗ CallLint receipt: signature INVALID",
      `  Receipt ID: ${receipt.receipt_id}`,
      `  Signature key: ${sig.key_id}`,
      `  Error: ${cryptoResult.error || "signature verification failed"}`,
    ]
    return { stdout: "", stderr: lines.join("\n"), exitCode: 1 }
  }

  const stdout = [
    "✓ CallLint receipt: valid",
    `  Receipt ID: ${receipt.receipt_id}`,
    `  Schema: ${receipt.schema_version}`,
    `  Verdict: ${receipt.verdict}`,
    `  Signature: valid (key: ${sig.key_id})`,
    `  Signed at: ${sig.signed_at}`,
  ].join("\n")
  return { stdout, exitCode: EXIT.OK }
}

/**
 * `calllint receipt sign <receipt.json> --key <keyfile>` — Sign a receipt locally.
 *
 * Development/testing only. Production signing requires cloud service API key.
 */
function receiptSign(args: ParsedArgs, deps: ReceiptDeps): CommandResult {
  const receiptFile = args.positionals[1]
  const keyFile = args.flags["key"]
  const outFile = ((args.flags["out"] as string | undefined) || receiptFile) as string

  if (!receiptFile || !keyFile || typeof keyFile !== "string") {
    return {
      stdout: "",
      stderr: [
        "Usage: calllint receipt sign <receipt.json> --key <keyfile> [--out <output>]",
        "",
        "Sign a receipt locally (development/testing only).",
        "Production signing requires cloud service: calllint scan --sign",
      ].join("\n"),
      exitCode: EXIT.USAGE,
    }
  }

  // Read receipt
  let unsignedReceipt: Record<string, unknown>
  try {
    unsignedReceipt = JSON.parse(readFileSync(resolve(deps.cwd, receiptFile), "utf8"))
  } catch (e) {
    return {
      stdout: "",
      stderr: `Could not read receipt ${receiptFile}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }

  if (unsignedReceipt.signature) {
    return {
      stdout: "",
      stderr: "Receipt already has a signature field. Cannot sign again.",
      exitCode: EXIT.ERROR,
    }
  }

  // Read keypair
  let keypair: ReturnType<typeof importKeypair>
  try {
    const keyJson = JSON.parse(readFileSync(resolve(deps.cwd, keyFile), "utf8"))
    keypair = importKeypair(keyJson)
  } catch (e) {
    return {
      stdout: "",
      stderr: `Could not read key file ${keyFile}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }

  try {
    const signature = signReceiptCrypto(unsignedReceipt, keypair)
    const signedReceipt = { ...unsignedReceipt, signature }
    writeFileSync(resolve(deps.cwd, outFile), JSON.stringify(signedReceipt, null, 2) + "\n", "utf8")

    const stdout = [
      "✓ Receipt signed successfully",
      `  Key ID: ${signature.key_id}`,
      `  Algorithm: ${signature.algorithm}`,
      `  Signed at: ${signature.signed_at}`,
      `  Output: ${outFile}`,
    ].join("\n")
    return { stdout, exitCode: EXIT.OK }
  } catch (e) {
    return {
      stdout: "",
      stderr: `Signing failed: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }
}

/**
 * `calllint receipt keygen --out <file>` — Generate a test ed25519 keypair.
 *
 * Development/testing only. Production keys are managed by cloud service.
 */
function receiptKeygen(args: ParsedArgs, deps: ReceiptDeps): CommandResult {
  const outFile = args.flags["out"]

  if (!outFile || typeof outFile !== "string") {
    return {
      stdout: "",
      stderr: [
        "Usage: calllint receipt keygen --out <file>",
        "",
        "Generate a test ed25519 keypair (development/testing only).",
        "Production keys are managed by cloud service.",
      ].join("\n"),
      exitCode: EXIT.USAGE,
    }
  }

  const keyId = ((args.flags["key-id"] as string | undefined) || "calllint-dev-2026-h2") as string

  try {
    const keypair = generateKeypair(keyId)
    const exported = exportKeypair(keypair)
    writeFileSync(resolve(deps.cwd, outFile), JSON.stringify(exported, null, 2) + "\n", "utf8")

    const stdout = [
      "✓ Keypair generated successfully",
      `  Key ID: ${keyId}`,
      `  Algorithm: ed25519`,
      `  Output: ${outFile}`,
      "",
      "⚠️  Development/testing only. Do NOT use for production.",
    ].join("\n")
    return { stdout, exitCode: EXIT.OK }
  } catch (e) {
    return {
      stdout: "",
      stderr: `Keygen failed: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }
}
