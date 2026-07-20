/**
 * R5 — Tool Metadata Resolver (new11 P1 §4.3 row E7). PURE-EDGE.
 *
 * Resolves a `tool` subject from a STATIC tool manifest (id = manifest URL). It
 * reads declared metadata only — tool names, annotations, side-effect/authority
 * hints, input schema presence — and MUST NOT execute the target server (§4.3,
 * INV1). The only I/O is one `fetchJson` of the manifest URL.
 *
 * Authority normalization (§4.3): the four MCP hint flags (readOnlyHint,
 * destructiveHint, idempotentHint, openWorldHint) are folded into one
 * `authority.scope` value {read-only | read-write | destructive}. If any hint is
 * absent the scope is only partly known → AUTHORITY_SCOPE_INCOMPLETE (degrading).
 *
 * Fail-closed: fetch throws→NETWORK_UNAVAILABLE(retryable); non-object→
 * MALFORMED_METADATA; no tools array→TOOL_METADATA_UNAVAILABLE(degrading).
 */
import { makeGap } from "@calllint/evidence"
import type { EvidenceGap, EvidenceItem, EvidenceSubject, ResolverResult } from "@calllint/evidence"
import type { EvidenceResolver, ResolverContext } from "./resolverInterface.js"

const ID = "R5:tool"
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Fold MCP hint flags into one scope; report whether all four were declared. */
export function normalizeAuthority(annotations: Record<string, unknown>): {
  scope: "read-only" | "read-write" | "destructive"
  complete: boolean
} {
  const present = HINTS.filter((h) => typeof annotations[h] === "boolean")
  const complete = present.length === HINTS.length
  if (annotations.destructiveHint === true) return { scope: "destructive", complete }
  if (annotations.readOnlyHint === true) return { scope: "read-only", complete }
  return { scope: "read-write", complete }
}

async function resolve(subject: EvidenceSubject, ctx: ResolverContext): Promise<ResolverResult> {
  let doc: unknown
  try {
    doc = await ctx.fetchJson(subject.id)
  } catch {
    return {
      resolver: ID,
      status: "retryable-failure",
      items: [],
      gaps: [
        makeGap("NETWORK_UNAVAILABLE", "tool manifest was unreachable", {
          missingFields: ["tool.name"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  if (!isRecord(doc)) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("MALFORMED_METADATA", "tool manifest was not a JSON object", { triedResolvers: [ID] }),
      ],
    }
  }

  const tools = Array.isArray(doc.tools) ? doc.tools : undefined
  if (!tools || tools.length === 0) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("TOOL_METADATA_UNAVAILABLE", "manifest declares no static tools", {
          missingFields: ["tool.name"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  const items: EvidenceItem[] = []
  const gaps: EvidenceGap[] = []
  let anyIncompleteAuthority = false
  let anyMissingSchema = false

  // Repository/registry tier: these are declared, not artifact-bound.
  items.push({ field: "tool.count", value: String(tools.length), tier: "repository", source: ID })

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i]
    if (!isRecord(t)) continue
    const name = typeof t.name === "string" ? t.name : `tool[${i}]`
    items.push({ field: `tool.${i}.name`, value: name, tier: "repository", source: ID })

    const annotations = isRecord(t.annotations) ? t.annotations : {}
    const { scope, complete } = normalizeAuthority(annotations)
    items.push({ field: `tool.${i}.authority`, value: scope, tier: "repository", source: ID })
    if (!complete) anyIncompleteAuthority = true

    // Input schema presence is a declared-metadata signal (never executed).
    if (isRecord(t.inputSchema)) {
      items.push({ field: `tool.${i}.inputSchema`, value: "declared", tier: "repository", source: ID })
    } else {
      anyMissingSchema = true
    }
  }

  if (anyIncompleteAuthority) {
    gaps.push(
      makeGap("AUTHORITY_SCOPE_INCOMPLETE", "one or more tools omit MCP authority hints", {
        missingFields: ["tool.authority"],
        triedResolvers: [ID],
      }),
    )
  }
  if (anyMissingSchema) {
    gaps.push(
      makeGap("TOOL_METADATA_UNAVAILABLE", "one or more tools declare no input schema", {
        missingFields: ["tool.inputSchema"],
        triedResolvers: [ID],
      }),
    )
  }

  return { resolver: ID, status: gaps.length === 0 ? "complete" : "partial", items, gaps }
}

/** R5 — the Tool Metadata Resolver singleton. Reads declared metadata; never executes. */
export const toolResolver: EvidenceResolver = { id: ID, handles: ["tool"], resolve }
