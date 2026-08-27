/**
 * Pages advanced-mode entry for the `calllint-usage-report` project — closes §29's
 * ungated-`pages.dev` hole (U-1) at the deploy, not at the account edge.
 *
 * THE DEFECT. Cloudflare Access binds to a HOSTNAME, not to a project. The policy on
 * `usage.calllint.com` therefore leaves the SAME deployment world-readable at
 * `calllint-usage-report.pages.dev` the moment a deploy lands — measured 2026-08-26:
 * HTTP 200, 2666 bytes, all three report row labels present, and no `x-robots-tag`
 * (that header ships on PREVIEW hostnames only), so the in-page noindex meta was the
 * sole crawler backstop there.
 *
 * WHY THIS FILE AND NOT A BULK REDIRECT. Both close it. Cloudflare offers no switch to
 * delete a project's `pages.dev` hostname (verified against the Pages docs 2026-08-26),
 * so the documented options are an account-level Bulk Redirect or a second Access
 * application on `*.pages.dev`. Both are account-level objects, reachable only by a
 * credential this pipeline deliberately does not hold — see
 * `artifacts/authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md` ("the report is
 * not worth that token"). A redirect that ships INSIDE the deployment needs only the
 * `Pages:Edit` scope CI already has, is version-controlled, and is driven by real tests
 * in `test/pages-entry.test.ts` rather than by a screenshot of a dashboard. The two are
 * complementary, not exclusive: a Bulk Redirect added later short-circuits at the edge
 * and this file becomes the second layer.
 *
 * WHY `_worker.js` AND NOT `_redirects`. `_redirects` rules match PATHS. The subject here
 * is the HOST, so there is no rule to write — something must run per-request. Advanced
 * mode also guarantees the platform routes EVERY request through this file, so the
 * decision cannot be bypassed by a `_routes.json` default.
 *
 * WHY 301 AND NOT 403. A permanent redirect is browser-cached hard, which is exactly
 * right for a hostname that must never serve this report again, and it keeps an operator's
 * old bookmark working — it lands them on the Access sign-in for the gated host instead of
 * on an error. 403 would close the hole equally but strand the bookmark.
 *
 * WHY `robots.txt` IS EXEMPT. Redirecting it would send a crawler to a gated host and
 * leave this hostname with NO `Disallow` at all — and per the measurement above there is
 * no `x-robots-tag` here to fall back on. Serving the committed `robots.txt` verbatim
 * replaces the noindex meta that the redirect removes. It carries no report content.
 *
 * WHY THE LIVENESS HEADER. The deploy probe's check 3 fetches `$DEPLOYMENT_URL`, itself a
 * `*.pages.dev` name, and read HTTP 200 as "a deployment is really serving" — the check
 * whose absence hid a user-visible 502. After this file that request 301s, and a redirect
 * alone proves only that code ran, not that the report exists behind it. So the redirect
 * carries `x-calllint-report: present|absent`, derived by asking the asset server for the
 * document. One word, no report content, and it makes check 3 stronger than the 200 it
 * replaces: it now distinguishes "gated" from "dead" on the redirect path too.
 */

/** The only hostname Access protects. Everything else redirects here. */
export const CANONICAL_HOST = "usage.calllint.com"

/**
 * The host decision, as a pure function so every branch is driven by a test rather than
 * discovered by a consumer. Returns null to mean "serve the asset unchanged".
 *
 * @param {string} hostname
 * @param {string} pathname
 * @returns {{ location: string } | null}
 */
export const redirectTarget = (hostname, pathname) => {
  if (hostname === CANONICAL_HOST) return null
  // See the header: this file is the sole `Disallow` source on a non-canonical host.
  if (pathname === "/robots.txt") return null
  return { location: `https://${CANONICAL_HOST}${pathname}` }
}

/** @type {{ fetch: (request: Request, env: { ASSETS: { fetch: (r: Request | string) => Promise<Response> } }) => Promise<Response> }} */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const target = redirectTarget(url.hostname, url.pathname)

    // The canonical (Access-protected) host, and `robots.txt` everywhere: serve the
    // committed bytes verbatim. `ASSETS.fetch` is used rather than a bare pass-through
    // for the reason apps/web/functions/trust/_middleware.ts records — it is documented
    // to return the asset server's own response, so its status is a fact about a
    // committed file and not an inference about undocumented fallthrough.
    if (target === null) return env.ASSETS.fetch(request)

    // Ask the asset server whether the report is actually there. A redirect proves this
    // code ran; only this answers "is anything behind it?" — the distinction whose
    // absence hid a 502. Never throws the request away: any failure reads `absent`.
    let present = "absent"
    try {
      const probe = await env.ASSETS.fetch(new URL("/index.html", url).toString())
      if (probe.status === 200) present = "present"
    } catch {
      present = "absent"
    }

    return new Response(null, {
      status: 301,
      headers: {
        location: target.location,
        // Not report content — one word, so §29's "must not be world-readable" holds.
        "x-calllint-report": present,
        "x-robots-tag": "noindex, nofollow, noarchive",
        "cache-control": "public, max-age=3600",
      },
    })
  },
}
