/**
 * GET /v1/public/adoption-signals — public thresholded metrics
 *
 * Privacy: Never returns exact counts, only milestone thresholds
 * Milestones: 1K+, 2.5K+, 5K+, 10K+, 25K+, 50K+, 100K+, 250K+, 500K+, 1M+
 */

interface Env {
  USAGE_DB: D1Database
}

interface AdoptionSignals {
  activeInstallations: string
  totalScans: string
  lastUpdated: string
}

const MILESTONES = [
  1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
  1_000_000,
]

/**
 * Project an exact count to the highest milestone it exceeds.
 * Examples: 1234 → "1K+", 5678 → "5K+", 999 → "<1K"
 */
function projectToMilestone(count: number): string {
  if (count < MILESTONES[0]) return "<1K"

  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    if (count >= MILESTONES[i]) {
      const milestone = MILESTONES[i]
      if (milestone >= 1_000_000) {
        return `${milestone / 1_000_000}M+`
      }
      return `${milestone / 1_000}K+`
    }
  }

  return "<1K"
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context

  // Query active installations (last 30 days)
  const activeInstallationsResult = await env.USAGE_DB.prepare(
    "SELECT count FROM active_installations"
  ).first<{ count: number }>()

  const activeCount = activeInstallationsResult?.count ?? 0

  // Query total scans (preflight_completed events)
  const totalScansResult = await env.USAGE_DB.prepare(
    `SELECT COUNT(*) as count
     FROM usage_events
     WHERE event_name = 'preflight_completed'`
  ).first<{ count: number }>()

  const scanCount = totalScansResult?.count ?? 0

  // Project to milestones
  const signals: AdoptionSignals = {
    activeInstallations: projectToMilestone(activeCount),
    totalScans: projectToMilestone(scanCount),
    lastUpdated: new Date().toISOString(),
  }

  return new Response(JSON.stringify(signals, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600", // 1 hour cache
      "Access-Control-Allow-Origin": "*",
    },
  })
}
