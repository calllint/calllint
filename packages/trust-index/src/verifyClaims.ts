/**
 * `verifyClaims.ts` — the IMPURE half of I2c-4 (ADR 0048 §2/§4). Runs ONLY in the
 * Actions ingestion plane. It mints an ephemeral GitHub App token, asks GitHub which
 * accounts installed the App and which repos each installation covers, then hands that
 * view to the PURE `reconcileClaims` core and commits the resulting claim store. It
 * NEVER serves a request and NEVER touches a verdict (ADR 0046 §1, 0047 §1/§6).
 *
 * Auth (no dependency): a short-lived RS256 JWT signed with the App private key via
 * Node `crypto`, exchanged per-installation for an installation access token. The
 * private key comes only from an Actions secret (CALLLINT_APP_PRIVATE_KEY); it is
 * never logged and never leaves this process.
 *
 * The only permission the App holds is `metadata: read` (ADR 0048 §3), enough to list
 * installations and their repositories — nothing else.
 *
 * Usage:  tsx packages/trust-index/src/verifyClaims.ts
 *   env:  CALLLINT_APP_ID, CALLLINT_APP_PRIVATE_KEY   (GH_API optional, for tests)
 */
import { createSign } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { reconcileClaims, type InstallationView, type CoveredRepo } from "./reconcileClaims.js"
import { registryRepoIndex } from "./reconcileClaims.js"
import { loadSnapshotIfPresent, loadClaimStoreIfPresent, CLAIM_STORE_PATH, DEFAULT_OUT } from "./bake.js"
import { join } from "node:path"

const GH_API = process.env.GH_API ?? "https://api.github.com"

/** base64url without padding — the JWT segment encoding. */
function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Mint a GitHub App JWT (RS256), valid for a short window. `iat` is backdated 60s to
 * tolerate clock skew and `exp` is +9 min (GitHub's max is 10). PURE given (id, key,
 * nowSec) — exported so its shape is unit-testable without the network.
 */
export function mintAppJwt(appId: string, privateKeyPem: string, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: appId }))
  const signer = createSign("RSA-SHA256")
  signer.update(`${header}.${payload}`)
  signer.end()
  const sig = b64url(signer.sign(privateKeyPem))
  return `${header}.${payload}.${sig}`
}

async function gh<T>(path: string, token: string, method: "GET" | "POST" = "GET"): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "calllint-trust-verify",
    },
  })
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

interface GhInstallation {
  id: number
  account: { login: string } | null
}
interface GhRepo {
  name: string
  owner: { login: string }
}

/**
 * Gather the live installation view via the GitHub App API. Paginates installations,
 * mints a per-installation token, and lists the repos that installation covers.
 * Impure (network). The `now` used for JWT freshness is the caller's `Date.now()`.
 */
export async function gatherInstallations(appId: string, privateKeyPem: string): Promise<InstallationView[]> {
  const jwt = mintAppJwt(appId, privateKeyPem, Math.floor(Date.now() / 1000))
  const views: InstallationView[] = []

  // metadata:read installations — page through until a short page.
  for (let page = 1; ; page++) {
    const installs = await gh<GhInstallation[]>(`/app/installations?per_page=100&page=${page}`, jwt)
    for (const inst of installs) {
      const account = inst.account?.login
      if (!account) continue
      // Exchange the App JWT for this installation's token, then list its repos.
      const tok = await gh<{ token: string }>(`/app/installations/${inst.id}/access_tokens`, jwt, "POST")
      const repos = await listAllRepos(tok.token)
      views.push({ installationId: inst.id, account, repos })
    }
    if (installs.length < 100) break
  }
  return views
}

async function listAllRepos(instToken: string): Promise<CoveredRepo[]> {
  const out: CoveredRepo[] = []
  for (let page = 1; ; page++) {
    const body = await gh<{ repositories: GhRepo[] }>(`/installation/repositories?per_page=100&page=${page}`, instToken)
    for (const r of body.repositories) out.push({ owner: r.owner.login, name: r.name })
    if (body.repositories.length < 100) break
  }
  return out
}

/** Read `canonicalName → artifactDigest` from the committed baked index. */
export function loadBakedDigests(indexPath = join(DEFAULT_OUT, "index.json")): Map<string, `sha256:${string}`> {
  const idx = JSON.parse(readFileSync(indexPath, "utf8")) as {
    entries: { canonicalName: string; status: string; artifactDigest?: string }[]
  }
  const m = new Map<string, `sha256:${string}`>()
  for (const e of idx.entries) {
    if (e.status === "baked" && e.artifactDigest) m.set(e.canonicalName, e.artifactDigest as `sha256:${string}`)
  }
  return m
}

async function main(): Promise<void> {
  const appId = process.env.CALLLINT_APP_ID
  const privateKey = process.env.CALLLINT_APP_PRIVATE_KEY
  if (!appId || !privateKey) throw new Error("CALLLINT_APP_ID and CALLLINT_APP_PRIVATE_KEY are required")

  const snapshot = loadSnapshotIfPresent()
  if (!snapshot) throw new Error("no committed snapshot — run ingest first so pages exist to claim")
  const previous = loadClaimStoreIfPresent()
  const installations = await gatherInstallations(appId, privateKey)

  const next = reconcileClaims({
    previous,
    installations,
    repoIndex: registryRepoIndex(snapshot),
    bakedDigests: loadBakedDigests(),
    now: new Date().toISOString(),
  })

  writeFileSync(CLAIM_STORE_PATH, JSON.stringify(next, null, 2) + "\n", "utf8")
  const active = next.records.filter((r) => r.status === "active").length
  // eslint-disable-next-line no-console
  console.log(`verified ${installations.length} installation(s) → ${active} active claim(s), ${next.records.length} record(s)`)
}

// Only run when invoked directly (not when imported by a test).
if (process.argv[1] && process.argv[1].endsWith("verifyClaims.ts")) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
