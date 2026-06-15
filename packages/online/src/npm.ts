import type { Finding } from "@mcpguard/types"

/**
 * Injectable JSON fetcher. The real implementation (Node fetch) is supplied by
 * the CLI; tests inject a fake. Keeping the network behind an interface is what
 * lets the rest of MCPGuard stay pure, deterministic, and offline.
 */
export type FetchJson = (url: string) => Promise<unknown>

/** The npm registry facts we care about for one package version. */
export interface NpmFacts {
  name: string
  /** Whether the resolved version exists in the registry. */
  versionExists: boolean
  /** install/preinstall/postinstall scripts present on the resolved version. */
  installScripts: string[]
  /** Deprecation message, if the version is deprecated. */
  deprecated?: string
  /** dist-tag "latest"; lets us flag drift when a floating spec is used. */
  latestVersion?: string
  /** The version we resolved against (the requested one, or latest). */
  resolvedVersion?: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function parseSpec(packageSpec: string): { name: string; version?: string } {
  if (packageSpec.startsWith("@")) {
    const slash = packageSpec.indexOf("/")
    const at = packageSpec.indexOf("@", slash)
    if (at === -1) return { name: packageSpec }
    return { name: packageSpec.slice(0, at), version: packageSpec.slice(at + 1) || undefined }
  }
  const at = packageSpec.indexOf("@")
  if (at <= 0) return { name: packageSpec }
  return { name: packageSpec.slice(0, at), version: packageSpec.slice(at + 1) || undefined }
}

const INSTALL_SCRIPT_KEYS = ["preinstall", "install", "postinstall"]

/**
 * Fetch npm registry metadata for a package spec and distill it into facts.
 * Network failures and missing packages are reported as facts (versionExists:
 * false) rather than thrown, so the caller can always produce a report.
 */
export async function fetchNpmFacts(
  packageSpec: string,
  fetchJson: FetchJson,
): Promise<NpmFacts> {
  const { name, version } = parseSpec(packageSpec)
  const url = `https://registry.npmjs.org/${name.replace(/\//g, "%2f")}`

  let doc: unknown
  try {
    doc = await fetchJson(url)
  } catch {
    return { name, versionExists: false, installScripts: [] }
  }
  if (!isRecord(doc)) return { name, versionExists: false, installScripts: [] }

  const distTags = isRecord(doc["dist-tags"]) ? doc["dist-tags"] : {}
  const latestVersion = typeof distTags.latest === "string" ? distTags.latest : undefined

  const versions = isRecord(doc.versions) ? doc.versions : {}
  const isFloating = !version || version === "latest" || /[\^~><*]/.test(version)
  const resolvedVersion = isFloating ? latestVersion : version
  const versionDoc =
    resolvedVersion && isRecord(versions[resolvedVersion])
      ? (versions[resolvedVersion] as Record<string, unknown>)
      : undefined

  if (!versionDoc) {
    return { name, versionExists: false, installScripts: [], latestVersion, resolvedVersion }
  }

  const scripts = isRecord(versionDoc.scripts) ? versionDoc.scripts : {}
  const installScripts = INSTALL_SCRIPT_KEYS.filter(
    (k) => typeof scripts[k] === "string" && (scripts[k] as string).length > 0,
  )
  const deprecated =
    typeof versionDoc.deprecated === "string" ? versionDoc.deprecated : undefined

  return {
    name,
    versionExists: true,
    installScripts,
    deprecated,
    latestVersion,
    resolvedVersion,
  }
}

/**
 * Map npm facts into findings. Pure and deterministic. These are OBSERVED (we
 * read the real registry) with higher confidence than the name-based offline
 * heuristics. Every finding is stamped `source: "online"` and carries the
 * `fetchedAt` timestamp so reports can show — and reviewers can audit — that
 * the finding depends on network metadata. Online findings are advisory: they
 * may add risk but the verdict engine never lets them downgrade a verdict.
 */
export function findingsFromNpmFacts(facts: NpmFacts, fetchedAt: string): Finding[] {
  const findings: Finding[] = []
  const stamp = <T extends Finding>(f: T): T => ({ ...f, source: "online", fetchedAt })

  if (!facts.versionExists) {
    findings.push(stamp({
      id: "supply.version-not-found",
      title: "Package version not found in registry",
      severity: "high",
      blocker: false,
      symbol: "SUPPLY",
      riskClass: "S1",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "package-metadata",
      evidence: [{ type: "package-metadata", key: "registry", value: facts.name }],
      impact:
        "The requested package version does not exist on the npm registry, so the configured server cannot be verified or may resolve to something unexpected.",
      fix: "Pin to a published, existing version of the package.",
    }))
    return findings
  }

  if (facts.installScripts.length > 0) {
    findings.push(stamp({
      id: "supply.install-scripts",
      title: "Package runs install scripts",
      severity: "high",
      blocker: false,
      symbol: "EXEC",
      riskClass: "S4",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "package-metadata",
      evidence: facts.installScripts.map((s) => ({
        type: "package-metadata",
        key: "script",
        value: s,
      })),
      impact:
        "npm install/postinstall scripts execute arbitrary code on the host at install time, before the agent ever invokes a tool.",
      fix: "Review the install scripts, or install with --ignore-scripts and vendor the package.",
      falsePositiveNote:
        "Many legitimate packages use postinstall for native builds; review what the script does.",
    }))
  }

  if (facts.deprecated) {
    findings.push(stamp({
      id: "supply.deprecated",
      title: "Package version is deprecated",
      severity: "medium",
      blocker: false,
      symbol: "SUPPLY",
      riskClass: "S1",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "package-metadata",
      evidence: [{ type: "package-metadata", key: "deprecated", value: facts.deprecated }],
      impact:
        "A deprecated package may be unmaintained and miss security fixes.",
      fix: "Migrate to the maintained successor or a supported version.",
    }))
  }

  return findings
}

/**
 * One-shot helper: fetch facts and return findings for a package spec.
 * `fetchedAt` is the ISO timestamp stamped on every online finding (injected
 * for determinism; the CLI passes its `generatedAt`).
 */
export async function enrichNpmPackage(
  packageSpec: string,
  fetchJson: FetchJson,
  fetchedAt: string,
): Promise<{ facts: NpmFacts; findings: Finding[] }> {
  const facts = await fetchNpmFacts(packageSpec, fetchJson)
  return { facts, findings: findingsFromNpmFacts(facts, fetchedAt) }
}
