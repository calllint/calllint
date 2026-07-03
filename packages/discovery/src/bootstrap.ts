/**
 * Bootstrap: Auto-register P0 agent extractors.
 *
 * This file is imported by index.ts so that P0 extractors are automatically
 * registered when the package is imported. This provides zero-config discovery
 * for the most common agents.
 *
 * P1+ extractors will be added in future stages (Stage 4+).
 */

import { registry } from "./registry.js"
import { CursorExtractor } from "./extractors/cursor.js"
import { ClaudeCodeExtractor } from "./extractors/claude-code.js"
import { ClaudeDesktopExtractor } from "./extractors/claude-desktop.js"

/**
 * Register P0 agent extractors (most common agents).
 *
 * These are auto-registered on package import to provide zero-config discovery.
 * Users can still manually register additional extractors if needed.
 */
function bootstrapP0Extractors(): void {
  // P0: Cursor
  registry.register(new CursorExtractor())

  // P0: Claude Code
  registry.register(new ClaudeCodeExtractor())

  // P0: Claude Desktop
  registry.register(new ClaudeDesktopExtractor())
}

// Auto-register P0 extractors on module load
bootstrapP0Extractors()

/**
 * Export for testing (allows tests to verify bootstrap ran).
 */
export { bootstrapP0Extractors }
