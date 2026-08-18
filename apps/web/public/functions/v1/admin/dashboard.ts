/**
 * GET /v1/admin/dashboard — private dashboard HTML
 * Authentication: Cloudflare Access
 */

import dashboardHtml from "./dashboard.html"

export const onRequestGet: PagesFunction = async (context) => {
  const { request } = context

  // Cloudflare Access validation
  const accessEmail = request.headers.get("CF-Access-Authenticated-User-Email")
  if (!accessEmail) {
    return new Response("Unauthorized", { status: 401 })
  }

  return new Response(dashboardHtml, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-cache",
    },
  })
}
