/**
 * GET /v1/admin/usage — private usage metrics
 *
 * Authentication: Cloudflare Access
 * Returns: Aggregate metrics only (no raw events)
 */

interface Env {
  USAGE_DB: D1Database
}

interface UsageMetrics {
  activeInstallations: number
  totalEvents: number
  eventsByName: Record<string, number>
  dailyTrend: Array<{ date: string; events: number; installations: number }>
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context

  // Cloudflare Access validation
  // In production, verify CF-Access-Authenticated-User-Email header
  const accessEmail = request.headers.get("CF-Access-Authenticated-User-Email")
  if (!accessEmail) {
    return new Response("Unauthorized", { status: 401 })
  }

  // Query active installations (last 30 days)
  const activeInstallationsResult = await env.USAGE_DB.prepare(
    "SELECT count FROM active_installations"
  ).first<{ count: number }>()

  const activeInstallations = activeInstallationsResult?.count ?? 0

  // Query total events
  const totalEventsResult = await env.USAGE_DB.prepare(
    "SELECT COUNT(*) as count FROM usage_events"
  ).first<{ count: number }>()

  const totalEvents = totalEventsResult?.count ?? 0

  // Query events by name
  const eventsByNameResults = await env.USAGE_DB.prepare(
    `SELECT event_name, COUNT(*) as count
     FROM usage_events
     WHERE timestamp >= datetime('now', '-30 days')
     GROUP BY event_name`
  ).all<{ event_name: string; count: number }>()

  const eventsByName: Record<string, number> = {}
  for (const row of eventsByNameResults.results ?? []) {
    eventsByName[row.event_name] = row.count
  }

  // Query daily trend (last 30 days)
  const dailyTrendResults = await env.USAGE_DB.prepare(
    `SELECT
       DATE(timestamp) as date,
       COUNT(*) as events,
       COUNT(DISTINCT hashed_installation_id) as installations
     FROM usage_events
     WHERE timestamp >= datetime('now', '-30 days')
     GROUP BY DATE(timestamp)
     ORDER BY date ASC`
  ).all<{ date: string; events: number; installations: number }>()

  const dailyTrend = dailyTrendResults.results ?? []

  const metrics: UsageMetrics = {
    activeInstallations,
    totalEvents,
    eventsByName,
    dailyTrend,
  }

  return new Response(JSON.stringify(metrics, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=300", // 5 min cache
    },
  })
}
