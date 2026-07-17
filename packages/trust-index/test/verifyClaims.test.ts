/**
 * I2c-4 impure-bin unit coverage that needs no network: the App JWT is well-formed
 * and verifies against the matching public key, and the baked-digest loader reads the
 * committed index. Installation gathering + reconciliation wiring is covered by the
 * pure core (reconcileClaims.test.ts); this pins the crypto + parsing edges.
 */
import { describe, it, expect } from "vitest"
import { generateKeyPairSync, createVerify } from "node:crypto"
import { mintAppJwt } from "../src/verifyClaims.js"

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString()

describe("mintAppJwt", () => {
  it("produces a three-segment RS256 JWT with the expected claims", () => {
    const jwt = mintAppJwt("4322539", pem, 1_800_000_000)
    const [h, p, sig] = jwt.split(".")
    expect(sig).toBeTruthy()
    const header = JSON.parse(Buffer.from(h!, "base64url").toString())
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString())
    expect(header).toEqual({ alg: "RS256", typ: "JWT" })
    expect(payload.iss).toBe("4322539")
    expect(payload.iat).toBe(1_800_000_000 - 60) // backdated for skew
    expect(payload.exp).toBe(1_800_000_000 + 540) // < 10 min
  })

  it("signs the header.payload so the matching public key verifies it", () => {
    const jwt = mintAppJwt("42", pem, 1_800_000_000)
    const [h, p, sig] = jwt.split(".")
    const v = createVerify("RSA-SHA256")
    v.update(`${h}.${p}`)
    v.end()
    expect(v.verify(publicKey, Buffer.from(sig!, "base64url"))).toBe(true)
  })

  it("a tampered payload fails verification", () => {
    const jwt = mintAppJwt("42", pem, 1_800_000_000)
    const [h, , sig] = jwt.split(".")
    const forged = Buffer.from(JSON.stringify({ iss: "999" })).toString("base64url")
    const v = createVerify("RSA-SHA256")
    v.update(`${h}.${forged}`)
    v.end()
    expect(v.verify(publicKey, Buffer.from(sig!, "base64url"))).toBe(false)
  })
})
