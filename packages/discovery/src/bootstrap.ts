/**
 * Bootstrap: Auto-register agent extractors.
 *
 * This file is imported by index.ts so that extractors are automatically
 * registered when the package is imported. This provides zero-config discovery.
 *
 * P0 extractors (Cursor, Claude Code, Claude Desktop, WorkBuddy): Most common agents
 * P1 extractors (VS Code, Windsurf, Qwen Code): Added in Stage 4 + harness distribution
 * P2 extractors (Cline): Harness distribution — closes the one DISCOVERY_ONLY host
 *   whose page could name no first scan command
 * P3 extractors (OpenClaw): Harness distribution (MCP only)
 */

import { registry } from "./registry.js"
import { CursorExtractor } from "./extractors/cursor.js"
import { ClaudeCodeExtractor } from "./extractors/claude-code.js"
import { ClaudeDesktopExtractor } from "./extractors/claude-desktop.js"
import { VSCodeExtractor } from "./extractors/vscode.js"
import { WindsurfExtractor } from "./extractors/windsurf.js"
import { WorkBuddyExtractor } from "./extractors/workbuddy.js"
import { QwenCodeExtractor } from "./extractors/qwen-code.js"
import { ClineExtractor } from "./extractors/cline.js"
import { KiroExtractor } from "./extractors/kiro.js"
import { GeminiCliExtractor } from "./extractors/gemini-cli.js"
import { CodexExtractor } from "./extractors/codex.js"
import { OpenClawExtractor } from "./extractors/openclaw.js"
import { OpencodeExtractor } from "./extractors/opencode.js"

/**
 * Register P0 + P1 + P3 (harness distribution) agent extractors.
 *
 * These are auto-registered on package import to provide zero-config discovery.
 * Users can still manually register additional extractors if needed.
 */
function bootstrapExtractors(): void {
  // P0: Most common agents
  registry.register(new CursorExtractor())
  registry.register(new ClaudeCodeExtractor())
  registry.register(new ClaudeDesktopExtractor())
  registry.register(new WorkBuddyExtractor())

  // P1: Additional major agents
  registry.register(new VSCodeExtractor())
  registry.register(new WindsurfExtractor())
  registry.register(new QwenCodeExtractor())

  // P2: Harness distribution (Cline CLI + VS Code extension, two config paths)
  registry.register(new ClineExtractor())
  registry.register(new KiroExtractor())
  registry.register(new GeminiCliExtractor())
  registry.register(new CodexExtractor())

  // P3: Harness distribution (MCP coverage only)
  registry.register(new OpenClawExtractor())
  registry.register(new OpencodeExtractor())
}

// Auto-register extractors on module load
bootstrapExtractors()

/**
 * Export for testing (allows tests to verify bootstrap ran).
 */
export { bootstrapExtractors }
