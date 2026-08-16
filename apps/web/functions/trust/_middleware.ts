/**
 * Cloudflare Pages middleware — ADR 0085 D3.2, the JSON half of the absence answer.
 *
 * D3.1 (a root `404.html`) fixes the STATUS for every unmatched path at once. It cannot fix the
 * CONTENT-TYPE: a machine client asking for `/trust/mcp-registry/<name>.json` would receive that
 * HTML page with a 404, and `JSON.parse` throwing is still the only signal it gets — which is the
 * accidental failure mode ADR 0085 §5 measured, merely with a better status code. D3.2 is
 * specifically about that: "a machine consumer must be able to tell 'no such subject' from
 * 'malformed response'".
 *
 * WHY MIDDLEWARE AND NOT `_routes.json` ALONE. `_routes.json` patterns match path prefixes, not
 * filename extensions — there is no `*.json` rule to write. Something must run for the subtree and
 * decide per-request.
 *
 * WHY `env.ASSETS.fetch` AND NOT `context.next()`. `next()` is documented as "passes the request
 * through to the next Function or to the asset server"; what it returns for a path with NO asset is
 * not specified — whether the body is the custom `404.html` and whether the status is 404 at all.
 * `ASSETS.fetch` is documented to run the project's header and redirect rules and to return the
 * asset server's own response, so its `res.ok` is a fact about a committed file rather than an
 * inference about undocumented fallthrough. Building the absence answer on an unverified platform
 * behaviour would reproduce this ADR's own fault class: a guard that cannot observe its subject.
 *
 * WHY THIS FILE HOLDS NO POLICY. Which absences answer in JSON, and what that document says, is
 * `absentPathOutcome` in `@calllint/partner-api` — a pure function with tests. A Pages Function can
 * only be observed by deploying it, so a rule expressed as a branch in here is a rule whose wrong
 * answer is invisible until a consumer hits it. Same reason the I2a adapter next door is thin, and
 * the same reason `acknowledgementClears` was lifted out of `gate-s0.ts` in D2.
 *
 * PASSTHROUGH IS THE DEFAULT AND THE COMMON CASE. All 300 baked pages exist; the overwhelming
 * majority of requests here hit a committed file and are returned verbatim, headers and all. This
 * middleware adds a decision only where the asset server had none to make.
 */
import { absentPathOutcome } from "@calllint/partner-api"

interface Env {
  ASSETS: { fetch: (input: Request | string | URL) => Promise<Response> }
}
interface Ctx {
  request: Request
  env: Env
  next: () => Promise<Response>
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const { request, env } = context

  // Only GET/HEAD can be answered from committed bytes. Anything else is not this
  // middleware's business; hand it to the platform rather than inventing a verdict for it.
  if (request.method !== "GET" && request.method !== "HEAD") return context.next()

  const url = new URL(request.url)
  const asset = await env.ASSETS.fetch(request)

  // A committed file exists — serve exactly what the asset server produced. The baked page's own
  // cache posture, content-type and ETag are correct and are not re-derived here.
  if (asset.status !== 404) return asset

  const outcome = absentPathOutcome(url.pathname)

  // An HTML absence is already right: the asset server resolved the nearest `404.html` and set the
  // status. Re-deriving it here would be a second source of truth for the same page.
  if (outcome.kind === "html") return asset

  const { response } = outcome
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers: response.headers,
  })
}
