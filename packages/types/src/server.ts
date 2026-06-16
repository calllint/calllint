/**
 * Tool metadata a user may paste alongside a server config (under `x-calllint.tools`).
 * This is the model-visible surface we scan for poisoning — we never fetch it live.
 */
export interface ProvidedToolMetadata {
  name?: string
  description?: string
  /** Free-form schema description text, if provided. */
  inputSchemaText?: string
}

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
  /** Optional server-level instructions text, if provided. */
  instructions?: string
  /** Tool metadata explicitly provided by the user for scanning. */
  providedTools: ProvidedToolMetadata[]
  raw: unknown
}
