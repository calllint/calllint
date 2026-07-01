/** A document surface read alongside an MCP server, for prompt-surface scanning. */
export const DOCUMENT_SURFACE_KINDS = [
  "readme",
  "skill",
  "agents",
  "package-description",
  // Published registry surfaces, fetched only under --online (ADR 0027). The
  // model-visible text an agent's tool list actually renders for a package-backed
  // server, routed through the same prompt-surface detector as local docs.
  "registry-description",
  "registry-readme",
] as const
export type DocumentSurfaceKind = (typeof DOCUMENT_SURFACE_KINDS)[number]

/**
 * A local document surface (README.md / SKILL.md / AGENTS.md / package.json
 * description) read by the CLI and handed to the pure core for prompt-surface
 * scanning (ADR 0015). The core never reads files itself; it only scans the text
 * it is given, keeping analyzers offline and deterministic.
 */
export interface DocumentSurface {
  /** Source path, relative to the surface dir (e.g. "README.md"). */
  path: string
  kind: DocumentSurfaceKind
  /** The text scanned (may be truncated — see `truncated`). */
  text: string
  /** True when the file exceeded the read cap and `text` is a prefix. */
  truncated: boolean
}
