/** Known package-runner commands whose package argument is the real subject. */
const PACKAGE_RUNNERS = new Set(["npx", "pnpm", "yarn", "bunx", "uvx", "pipx"])

/** Shell-ish commands that indicate arbitrary execution. */
export const SHELL_COMMANDS = new Set([
  "bash",
  "sh",
  "zsh",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
])

export interface NpmSpec {
  /** Package name without version, e.g. "@scope/name". */
  name: string
  /** Version spec if present, e.g. "1.0.0" or "latest"; undefined if none. */
  versionSpec?: string
}

/**
 * Parse an npm package argument into name + version spec, handling scoped
 * packages where the leading "@" is part of the name, not a version separator.
 */
export function parseNpmSpec(arg: string): NpmSpec | undefined {
  if (!arg || arg.startsWith("-")) return undefined
  // Don't treat paths or urls as packages.
  if (arg.includes("/") && !arg.startsWith("@")) return undefined
  if (arg.includes("://")) return undefined

  if (arg.startsWith("@")) {
    // scoped: @scope/name[@version]
    const slash = arg.indexOf("/")
    if (slash === -1) return undefined
    const at = arg.indexOf("@", slash)
    if (at === -1) return { name: arg }
    return { name: arg.slice(0, at), versionSpec: arg.slice(at + 1) || undefined }
  }

  const at = arg.indexOf("@")
  if (at <= 0) return { name: arg }
  return { name: arg.slice(0, at), versionSpec: arg.slice(at + 1) || undefined }
}

export function isPackageRunner(command: string | undefined): boolean {
  if (!command) return false
  return PACKAGE_RUNNERS.has(command.toLowerCase())
}

/** A pinned version is an exact semver-ish spec (not "latest", not a range, not absent). */
export function isPinnedVersion(versionSpec: string | undefined): boolean {
  if (!versionSpec) return false
  if (versionSpec === "latest" || versionSpec === "*") return false
  // Ranges are not pinned.
  if (/[\^~><]/.test(versionSpec)) return false
  // Require it to start with a digit (e.g. 1.0.0).
  return /^\d/.test(versionSpec)
}
