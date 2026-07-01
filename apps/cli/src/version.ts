import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * The running CLI's own version, read from its `package.json` at runtime.
 *
 * Resolved from `import.meta.url` so it is correct in every context:
 *   - dev (`tsx src/index.ts`)  → this file at apps/cli/src → ../package.json
 *   - bundle (`dist/index.js`)  → esbuild preserves import.meta.url → ../package.json
 *   - published npm package     → node_modules/calllint/package.json
 *
 * Never hardcoded: a receipt's `tool.version` must reflect the binary that
 * produced it. On any read failure we return "unknown" rather than crash — a
 * receipt is opt-in, and an unknown version is visible rather than misleading.
 */
export function resolveToolVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "unknown"
  } catch {
    return "unknown"
  }
}
