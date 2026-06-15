/**
 * A scan target can be a config file path, an npm package, or a GitHub repo.
 * npm and github targets are "synthetic": we construct an equivalent MCP config
 * so the same offline pipeline applies. Network fetching (github contents, npm
 * registry metadata) lives in @mcpguard/online and is opt-in via --online.
 */
export type TargetSpecKind = "path" | "npm" | "github"

export interface TargetSpec {
  kind: TargetSpecKind
  /** Original spec string. */
  raw: string
  /** For npm: the package spec (name[@version]). */
  packageSpec?: string
  /** For github: owner/repo. */
  repo?: string
  /** For github: optional ref (branch/tag/sha). */
  ref?: string
}

/**
 * Parse a positional argument into a target spec. `npm:` and `github:` prefixes
 * are explicit; anything else is treated as a filesystem path.
 */
export function parseTargetSpec(arg: string): TargetSpec {
  if (arg.startsWith("npm:")) {
    return { kind: "npm", raw: arg, packageSpec: arg.slice("npm:".length) }
  }
  if (arg.startsWith("github:")) {
    const rest = arg.slice("github:".length)
    // owner/repo[@ref]
    const at = rest.lastIndexOf("@")
    // Guard against scoped-like inputs: a ref @ must come after the slash.
    const slash = rest.indexOf("/")
    if (at > slash && at !== -1) {
      return { kind: "github", raw: arg, repo: rest.slice(0, at), ref: rest.slice(at + 1) }
    }
    return { kind: "github", raw: arg, repo: rest }
  }
  return { kind: "path", raw: arg }
}

/** Derive a stable server name from a package spec (drop version + scope slash). */
export function serverNameForPackage(packageSpec: string): string {
  const noVersion = packageSpec.startsWith("@")
    ? packageSpec.replace(/(@[^/]+\/[^@]+)@.*/, "$1")
    : packageSpec.split("@")[0]!
  return noVersion.replace(/^@/, "").replace(/\//g, "-")
}

/**
 * Synthesize an MCP config (as text) for an npm package, so the offline static
 * pipeline can analyze it exactly as if it were declared in a real config.
 */
export function synthesizeNpmConfig(packageSpec: string): {
  text: string
  configPath: string
} {
  const name = serverNameForPackage(packageSpec)
  const config = {
    mcpServers: {
      [name]: {
        command: "npx",
        args: ["-y", packageSpec],
      },
    },
  }
  return { text: JSON.stringify(config), configPath: `npm:${packageSpec}` }
}
