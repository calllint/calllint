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
    // Run async verification synchronously by blocking
    let cryptoResult: Awaited<ReturnType<typeof verifyReceiptCrypto>> | null = null
    let errorMsg: string | null = null

    try {
      // Block on the async call
      const promise = verifySignature(receipt, args)
      // Use a simple blocking pattern - wait for promise to resolve
      let done = false
      promise.then(
        (r) => {
          cryptoResult = r
          done = true
        },
        (e) => {
          errorMsg = e instanceof Error ? e.message : String(e)
          done = true
        }
      )

      // Busy wait (not ideal but keeps run() synchronous)
      const start = Date.now()
      while (!done && Date.now() - start < 5000) {
        // spin
      }

      if (!done) {
        return {
          stdout: "",
          stderr: "Signature verification timed out",
          exitCode: EXIT.ERROR,
        }
      }

      if (errorMsg) {
        return {
          stdout: "",
          stderr: `Signature verification failed: ${errorMsg}`,
          exitCode: EXIT.ERROR,
        }
      }

      if (!cryptoResult) {
        return {
          stdout: "",
          stderr: "Signature verification failed (no result)",
          exitCode: EXIT.ERROR,
        }
      }

      return formatVerifyResult(receipt, cryptoResult, args)
    } catch (e) {
      return {
        stdout: "",
        stderr: `Signature verification error: ${e instanceof Error ? e.message : String(e)}`,
        exitCode: EXIT.ERROR,
      }
    }
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
 * Verify signature cryptographically
 */
async function verifySignature(
  receipt: CallLintReceipt,
  args: ParsedArgs
): Promise<{ valid: boolean; key_id?: string; error?: string }> {
  const sig = receipt.signature!

  // Fetch public key from signature.public_key_url or default
  const publicKeyUrl =
    sig.public_key_url || "https://calllint.com/.well-known/receipt-keys.json"

  let publicKey: Uint8Array | string

  // For local/dev receipts, try to read public key from --public-key flag
  const publicKeyFlag = args.flags["public-key"]
  if (publicKeyFlag && typeof publicKeyFlag === "string") {
    try {
      const keyJson = JSON.parse(readFileSync(publicKeyFlag, "utf8"))
      publicKey = keyJson.public_key as string
    } catch (e) {
      throw new Error(
        `Could not read public key from ${publicKeyFlag}: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  } else {
    // For cloud receipts, would fetch from public_key_url
    // For now, return error asking for --public-key flag
    throw new Error(
      `Receipt has signature but public key not available.\n` +
        `Signature key_id: ${sig.key_id}\n` +
        `Public key URL: ${publicKeyUrl}\n\n` +
        `To verify locally, provide public key with --public-key <keyfile>\n` +
        `Example: calllint receipt verify receipt.json --public-key dev-key.json`
    )
  }

  return await verifyReceiptCrypto(receipt as any, publicKey)
}

function formatVerifyResult(
  receipt: CallLintReceipt,
  cryptoResult: { valid: boolean; key_id?: string; error?: string },
  args: ParsedArgs
): CommandResult {
  const sig = receipt.signature!

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
  let receiptRaw: string
  try {
    receiptRaw = readFileSync(resolve(deps.cwd, receiptFile), "utf8")
  } catch (e) {
    return {
      stdout: "",
      stderr: `Could not read receipt ${receiptFile}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }

  let unsignedReceipt: any
  try {
    unsignedReceipt = JSON.parse(receiptRaw)
  } catch (e) {
    return {
      stdout: "",
      stderr: `Receipt is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
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
  let keyJson: any
  try {
    const keyRaw = readFileSync(resolve(deps.cwd, keyFile), "utf8")
    keyJson = JSON.parse(keyRaw)
  } catch (e) {
    return {
      stdout: "",
      stderr: `Could not read key file ${keyFile}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }

  let keypair: ReturnType<typeof importKeypair>
  try {
    keypair = importKeypair(keyJson)
  } catch (e) {
    return {
      stdout: "",
      stderr: `Invalid keypair format: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }

  // Sign synchronously by blocking
  let signature: any = null
  let errorMsg: string | null = null

  const promise = signReceiptCrypto(unsignedReceipt, keypair)
  let done = false
  promise.then(
    (sig: any) => {
      signature = sig
      done = true
    },
    (e: any) => {
      errorMsg = e instanceof Error ? e.message : String(e)
      done = true
    }
  )

  const start = Date.now()
  while (!done && Date.now() - start < 5000) {
    // busy wait
  }

  if (!done) {
    return {
      stdout: "",
      stderr: "Signing timed out",
      exitCode: EXIT.ERROR,
    }
  }

  if (errorMsg) {
    return {
      stdout: "",
      stderr: `Signing failed: ${errorMsg}`,
      exitCode: EXIT.ERROR,
    }
  }

  if (!signature) {
    return {
      stdout: "",
      stderr: "Signing failed (no result)",
      exitCode: EXIT.ERROR,
    }
  }

  try {
    const signedReceipt = { ...unsignedReceipt, signature }
    const outPath = resolve(deps.cwd, outFile)
    writeFileSync(outPath, JSON.stringify(signedReceipt, null, 2) + "\n", "utf8")

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
      stderr: `Failed to write signed receipt: ${e instanceof Error ? e.message : String(e)}`,
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

  // Generate synchronously by blocking
  let keypair: any = null
  let errorMsg: string | null = null

  const promise = generateKeypair(keyId)
  let done = false
  promise.then(
    (kp: any) => {
      keypair = kp
      done = true
    },
    (e: any) => {
      errorMsg = e instanceof Error ? e.message : String(e)
      done = true
    }
  )

  const start = Date.now()
  while (!done && Date.now() - start < 5000) {
    // busy wait
  }

  if (!done) {
    return {
      stdout: "",
      stderr: "Keygen timed out",
      exitCode: EXIT.ERROR,
    }
  }

  if (errorMsg) {
    return {
      stdout: "",
      stderr: `Keygen failed: ${errorMsg}`,
      exitCode: EXIT.ERROR,
    }
  }

  if (!keypair) {
    return {
      stdout: "",
      stderr: "Keygen failed (no result)",
      exitCode: EXIT.ERROR,
    }
  }

  try {
    const exported = exportKeypair(keypair)
    const outPath = resolve(deps.cwd, outFile)
    writeFileSync(outPath, JSON.stringify(exported, null, 2) + "\n", "utf8")

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
      stderr: `Failed to write keypair: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }
}
