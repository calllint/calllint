/**
 * Bootstrap: Auto-register agent extractors.
 *
 * This file is imported by index.ts so that extractors are automatically
 * registered when the package is imported. This provides zero-config discovery.
 *
 * P0 extractors (Cursor, Claude Code, Claude Desktop): Most common agents
 * P1 extractors (VS Code, Windsurf): Added in Stage 4
 */

import { registry } from "./registry.js"
import { CursorExtractor } from "./extractors/cursor.js"
import { ClaudeCodeExtractor } from "./extractors/claude-code.js"
import { ClaudeDesktopExtractor } from "./extractors/claude-desktop.js"
import { VSCodeExtractor } from "./extractors/vscode.js"
import { WindsurfExtractor } from "./extractors/windsurf.js"

/**
 * Register P0 + P1 agent extractors.
 *
 * These are auto-registered on package import to provide zero-config discovery.
 * Users can still manually register additional extractors if needed.
 */
function bootstrapExtractors(): void {
  // P0: Most common agents
  registry.register(new CursorExtractor())
  registry.register(new ClaudeCodeExtractor())
  registry.register(new ClaudeDesktopExtractor())

  // P1: Additional major agents (Stage 4)
  registry.register(new VSCodeExtractor())
  registry.register(new WindsurfExtractor())
}

// Auto-register extractors on module load
bootstrapExtractors()

/**
 * Export for testing (allows tests to verify bootstrap ran).
 */
export { bootstrapExtractors }
