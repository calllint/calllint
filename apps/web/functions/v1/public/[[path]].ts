// Cloudflare Pages Function — the I2a Partner API adapter (ADR 0046 §4-§5).
//
// This file is intentionally thin: ALL logic lives in the typechecked, tested,
// scanner-free `@calllint/partner-api` core. The adapter's only job is to bridge
// the platform (Request + the static `ASSETS` binding) to the pure router.
//
// The router is given exactly one capability — read a committed static file via
// the ASSETS binding. It cannot resolve, fetch a target, or scan; "no scanner in
// the serving deployable" (ADR 0038 §3) therefore holds by construction.
import { handleApiRequest, type AssetReader } from "@calllint/partner-api"

interface Env {
  ASSETS: { fetch: (input: Request | string | URL) => Promise<Response> }
}
interface Ctx {
  request: Request
  env: Env
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const { request, env } = context
  const url = new URL(request.url)

  // Read-only accessor over committed static artifacts (never scans).
  const read: AssetReader = async (relPath) => {
    const assetUrl = new URL("/" + relPath.replace(/^\/+/, ""), url.origin)
    const res = await env.ASSETS.fetch(assetUrl.toString())
    if (!res.ok) return null
    return await res.text()
  }

  const api = await handleApiRequest(
    { method: request.method, path: url.pathname, headers: { "if-none-match": request.headers.get("if-none-match") ?? undefined } },
    read,
  )
  return new Response(api.body, { status: api.status, headers: api.headers })
}
