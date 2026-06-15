/**
 * A server config normalized out of any supported source (cursor/claude/inline).
 * Tolerant by design: unknown fields are preserved in `raw`.
 */
export interface NormalizedMcpServer {
  name: string
  sourceConfigPath: string
  transport: "stdio" | "sse" | "http" | "unknown"
  command?: string
  args: string[]
  envKeys: string[]
  /** Original env map (values may be redacted upstream; keys are what matter). */
  env: Record<string, string>
  url?: string
  raw: unknown
}
