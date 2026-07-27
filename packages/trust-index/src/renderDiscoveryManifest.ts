// ---------------------------------------------------------------------------
// Phase 2.4 Batch 2 — Safe-install discovery manifest (ADR 0056; §Naming).
//
// PURE + deterministic. Emits `calllint.discovery.v1` at /.well-known/calllint.json:
// a static advertisement of the acquisition surface (the human Install URL template,
// the machine Agent Adoption Contract URL template + media type, the MCP Resource
// template) plus the CLOSED, sorted list of available resources. It is a projection
// of already-public facts — no score, no free text, no verdict, and deliberately NO
// `autoInstallEligible` flag (ADR 0056 open-decision 2: only local/org policy may
// authorize auto-allow; the public surface never carries a "auto-install OK" bit).
// ---------------------------------------------------------------------------

/** The canonical templates + media type (ADR 0056 §Naming — reject draft variants). */
export const DISCOVERY_SCHEMA = "calllint.discovery.v1" as const
export const INSTALL_URL_TEMPLATE = "/install/{canonicalSlug}/" as const
export const CONTRACT_URL_TEMPLATE = "/install/{canonicalSlug}/index.json" as const
export const CONTRACT_MEDIA_TYPE = "application/vnd.calllint.agent-adoption+json;version=1" as const
export const MCP_RESOURCE_TEMPLATE = "calllint://adoption/{slug}[/{version}]" as const

/** One advertised resource — a lean, non-drifting projection of a baked page. */
export interface DiscoveryResourceEntry {
  readonly canonicalName: string
  readonly canonicalSlug: string
}

/**
 * Render `.well-known/calllint.json`. Pure: given the same entries it returns
 * byte-identical bytes (sorted by canonicalSlug, fixed key order, pinned
 * indentation), so a re-bake is stable and the shadow-tree gate holds. Each
 * resource's URLs are derived from the single slug source, so the manifest cannot
 * drift from the emitted `/install/{slug}/` layout.
 */
export function renderDiscoveryManifest(entries: readonly DiscoveryResourceEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.canonicalSlug < b.canonicalSlug ? -1 : a.canonicalSlug > b.canonicalSlug ? 1 : 0,
  )
  const doc = {
    schema: DISCOVERY_SCHEMA,
    installUrlTemplate: INSTALL_URL_TEMPLATE,
    contractUrlTemplate: CONTRACT_URL_TEMPLATE,
    contractMediaType: CONTRACT_MEDIA_TYPE,
    mcpResourceTemplate: MCP_RESOURCE_TEMPLATE,
    resources: sorted.map((e) => ({
      canonicalName: e.canonicalName,
      canonicalSlug: e.canonicalSlug,
      installUrl: `/install/${e.canonicalSlug}/`,
      contractUrl: `/install/${e.canonicalSlug}/index.json`,
    })),
  }
  return JSON.stringify(doc, null, 2) + "\n"
}
