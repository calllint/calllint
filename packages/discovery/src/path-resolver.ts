import { resolve, join, isAbsolute } from "node:path"
import { existsSync, statSync } from "node:fs"

/**
 * Resolve a path that may contain ~ or be relative to CWD.
 *
 * @param path - Path to resolve (may be relative, absolute, or ~-prefixed)
 * @param cwd - Current working directory
 * @returns Absolute path
 */
export function resolvePath(path: string, cwd: string): string {
  // Handle ~/ or ~ prefix
  if (path.startsWith("~/") || path === "~") {
    const home = process.env.HOME || process.env.USERPROFILE
    if (!home) {
      throw new Error("Could not resolve home directory (HOME/USERPROFILE not set)")
    }
    return join(home, path.slice(2))
  }

  // Handle absolute paths
  if (isAbsolute(path)) {
    return path
  }

  // Handle relative paths
  return resolve(cwd, path)
}

/**
 * Check if a path exists and is a regular file.
 *
 * @param path - Absolute path to check
 * @returns true if path exists and is a regular file
 */
export function isRegularFile(path: string): boolean {
  try {
    if (!existsSync(path)) {
      return false
    }
    const stats = statSync(path)
    return stats.isFile()
  } catch {
    return false
  }
}

/**
 * Check if a file is small enough to be a config (< 10MB).
 *
 * @param path - Absolute path to check
 * @returns true if file size < 10MB
 */
export function isReasonableSize(path: string): boolean {
  try {
    const stats = statSync(path)
    const maxSize = 10 * 1024 * 1024 // 10MB
    return stats.size < maxSize
  } catch {
    return false
  }
}

/**
 * Validate that a path is safe to check (exists, is file, reasonable size).
 *
 * @param path - Absolute path to validate
 * @returns true if path passes all validation checks
 */
export function validateConfigPath(path: string): boolean {
  return isRegularFile(path) && isReasonableSize(path)
}
