import { parseArgs, flagBool } from "./args.js"
import { parseTargetSpec, serverNameForPackage } from "@calllint/core"
import {
  enrichNpmPackage,
  fetchGithubConfig,
  type FetchJson,
  type FetchText,
} from "@calllint/online"
import type { OnlineEnrichment } from "./run.js"

/** Real JSON fetcher over Node's global fetch. */
const realFetchJson: FetchJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

/** Real text fetcher; returns undefined on non-2xx so probing can continue. */
const realFetchText: FetchText = async (url) => {
  const res = await fetch(url)
  if (!res.ok) return undefined
  return res.text()
}

/**
 * Compute --online enrichment for the current argv, if --online is set and the
 * target is npm/github. Returns undefined when there is nothing to do, so the
 * offline path is unaffected. Network errors degrade gracefully to a note.
 */
export async function computeOnlineEnrichment(
  argv: string[],
  deps: {
    fetchJson?: FetchJson
    fetchText?: FetchText
    /** ISO timestamp stamped on online findings; defaults injected by caller. */
    fetchedAt?: string
  } = {},
): Promise<OnlineEnrichment | undefined> {
  const args = parseArgs(argv)
  if (!flagBool(args.flags, "online")) return undefined
  const given = args.positionals[0]
  if (!given) return undefined

  const spec = parseTargetSpec(given)
  const fetchJson = deps.fetchJson ?? realFetchJson
  const fetchText = deps.fetchText ?? realFetchText
  const fetchedAt = deps.fetchedAt ?? new Date().toISOString()

  if (spec.kind === "npm" && spec.packageSpec) {
    const serverName = serverNameForPackage(spec.packageSpec)
    const { findings } = await enrichNpmPackage(spec.packageSpec, fetchJson, fetchedAt)
    return { extraFindings: { [serverName]: findings } }
  }

  if (spec.kind === "github" && spec.repo) {
    const result = await fetchGithubConfig(spec.repo, fetchText, spec.ref ?? "HEAD")
    if (result.text) {
      return {
        inputOverride: {
          text: result.text,
          configPath: `github:${spec.repo}@${result.ref}/${result.foundPath}`,
        },
        note: `fetched ${result.foundPath} @ ${result.ref}`,
      }
    }
    return undefined
  }

  return undefined
}
