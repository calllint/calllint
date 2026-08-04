/**
 * npmArtifactAdapter — the one adapter R-4 ships, for the one package type the corpus declares.
 *
 * The corpus (`snapshots/official-mcp-registry.json`, 19 entries) declares exactly two packages
 * and both are `registryType: "npm"`. The other four members of `RESOLVABLE_PACKAGE_TYPES`
 * (pypi, oci, nuget, mcpb) have no artifact to resolve here, so shipping adapters for them would
 * be code with no measurement behind it — the "shipped-not-wired" shape the audit graded PARTIAL.
 * Each is additive and its own PR when a source declares one.
 *
 * The integrity mapping and the floating-version resolution are PORTED from
 * `packages/resolver/src/evidence/npmResolver.ts:113-177`, not re-derived, because §10 says one
 * behaviour has one implementation. It is a port rather than an import because that module
 * returns `ResolverOutcome` — evidence items and coded gaps against a `PackageSpec` — and calling
 * it here would mean synthesizing a spec, then re-parsing its evidence items back into metadata.
 * The two shapes are recorded as one comment per ported rule so a reviewer can diff them, and the
 * rules themselves are tested here independently.
 */
import type { StoredArtifactVersion } from "../storage/store.js"
import type {
  ArtifactAdapter,
  ArtifactFetchContext,
  ArtifactMetadataResult,
} from "./artifactAdapter.js"

/** The public registry. A constant, not configuration: a swap is a supply-chain decision. */
export const NPM_REGISTRY = "https://registry.npmjs.org"

export const npmArtifactAdapter: ArtifactAdapter = {
  packageType: "npm",

  async resolveMetadata(
    artifact: StoredArtifactVersion,
    ctx: ArtifactFetchContext,
  ): Promise<ArtifactMetadataResult> {
    const name = artifact.packageIdentifier
    if (name.length === 0) {
      return { ok: false, failure: "MALFORMED_METADATA", detail: "empty package identifier" }
    }

    // Ported: scoped names are single-encoded — `@scope/pkg` -> `@scope%2fpkg`. `encodeURIComponent`
    // on the whole name would also escape the leading `@`, which the registry does not accept.
    const url = `${NPM_REGISTRY}/${name.replace(/\//g, "%2f")}`

    let doc: unknown
    try {
      const response = await fetchWithTimeout(ctx, url, { accept: "application/json" })
      if (response.status === 404) {
        return { ok: false, failure: "PACKAGE_NOT_FOUND", detail: `404 for "${name}"` }
      }
      if (!response.ok) {
        return { ok: false, failure: "NETWORK_UNAVAILABLE", detail: `HTTP ${response.status} for "${name}"` }
      }
      doc = await response.json()
    } catch (err) {
      // Never throws: a registry is untrusted input and one bad document must not lose the cohort.
      return { ok: false, failure: "NETWORK_UNAVAILABLE", detail: describe(err) }
    }

    if (!isRecord(doc)) {
      return { ok: false, failure: "MALFORMED_METADATA", detail: "packument is not an object" }
    }

    // Ported: a packument with no name or no versions is a missing package, not a malformed one.
    const docName = typeof doc.name === "string" ? doc.name : undefined
    const versions = isRecord(doc.versions) ? doc.versions : {}
    if (docName === undefined || Object.keys(versions).length === 0) {
      return { ok: false, failure: "PACKAGE_NOT_FOUND", detail: `"${name}" not present in registry` }
    }

    // Ported: a spec is floating when absent, `latest`, or range-bearing; floating pins to the
    // `latest` dist-tag. `artifact.version` is the version R-3 recorded from the source record.
    const distTags = isRecord(doc["dist-tags"]) ? doc["dist-tags"] : {}
    const latest = typeof distTags.latest === "string" ? distTags.latest : undefined
    const spec = artifact.version ?? ""
    const floating = spec.length === 0 || spec === "latest" || /[\^~><*]/.test(spec)
    const resolvedVersion = floating ? latest : spec
    const versionDoc =
      resolvedVersion !== undefined && isRecord(versions[resolvedVersion])
        ? (versions[resolvedVersion] as Record<string, unknown>)
        : undefined

    if (resolvedVersion === undefined || versionDoc === undefined) {
      return {
        ok: false,
        failure: "ARTIFACT_VERSION_UNRESOLVED",
        detail: floating
          ? `no "latest" dist-tag to pin "${name}"`
          : `version "${spec}" of "${name}" not published`,
      }
    }

    const dist = isRecord(versionDoc.dist) ? versionDoc.dist : {}

    // Ported verbatim: prefer SRI `dist.integrity`, else synthesize `sha1:` from `dist.shasum`.
    // The synthesized shape is why `integrityClaim.ts` parses `<alg>:<hex>` as well as SRI.
    const integrity =
      typeof dist.integrity === "string"
        ? dist.integrity
        : typeof dist.shasum === "string"
          ? `sha1:${dist.shasum}`
          : undefined

    const tarballUrl = typeof dist.tarball === "string" ? dist.tarball : undefined
    if (tarballUrl === undefined) {
      return {
        ok: false,
        failure: "MALFORMED_METADATA",
        detail: `no dist.tarball for "${name}@${resolvedVersion}"`,
      }
    }
    if (!isHttpsUrl(tarballUrl)) {
      // Fails closed on a downgrade. A packument is attacker-influenceable content, so an
      // `http://` or `file://` tarball URL is refused rather than followed.
      return {
        ok: false,
        failure: "MALFORMED_METADATA",
        detail: `dist.tarball is not https for "${name}@${resolvedVersion}": ${tarballUrl}`,
      }
    }

    if (integrity === undefined) {
      // Ported coded gap. Without a claim there is nothing to verify against, and R-4 stores only
      // verified bytes — so this is `UNAVAILABLE`, not a silent unverified `FETCHED`.
      return {
        ok: false,
        failure: "ARTIFACT_DIGEST_UNAVAILABLE",
        detail: `no dist integrity/shasum for "${name}@${resolvedVersion}"`,
      }
    }

    return {
      ok: true,
      metadata: { packageRegistry: NPM_REGISTRY, resolvedVersion, tarballUrl, integrity },
    }
  },
}

/**
 * Download artifact bytes under a hard size cap.
 *
 * Exported separately from the adapter because it is Phase B, and the two phases are kept apart
 * on purpose: a metadata read and a blob download are different risk classes with different
 * failure modes. It is generic over registries (any https URL + caps), so a second adapter reuses
 * it rather than writing a second downloader.
 *
 * The cap is enforced while streaming, before the buffer is assembled, so an oversized response
 * is abandoned mid-flight rather than after it has been fully materialized. Control #24 removes
 * the cap and observes an oversized fixture become `FETCHED`.
 */
export type ArtifactDownload =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly failure: "NETWORK_UNAVAILABLE" | "ARTIFACT_TOO_LARGE"; readonly detail: string }

export async function downloadArtifact(url: string, ctx: ArtifactFetchContext): Promise<ArtifactDownload> {
  if (!isHttpsUrl(url)) {
    return { ok: false, failure: "NETWORK_UNAVAILABLE", detail: `refusing non-https artifact URL: ${url}` }
  }
  try {
    const response = await fetchWithTimeout(ctx, url, { accept: "application/octet-stream" })
    if (!response.ok) {
      return { ok: false, failure: "NETWORK_UNAVAILABLE", detail: `HTTP ${response.status} for ${url}` }
    }

    // A declared length over the cap is refused before a single byte is read.
    const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10)
    if (Number.isSafeInteger(declared) && declared > ctx.maxArtifactBytes) {
      return {
        ok: false,
        failure: "ARTIFACT_TOO_LARGE",
        detail: `content-length ${declared} exceeds ${ctx.maxArtifactBytes}`,
      }
    }

    const body = response.body
    if (body === null) {
      // No stream to meter (a stub, or a 204). Buffer whole, then check — correct because
      // `arrayBuffer` on an absent body cannot exceed the cap by more than the cap itself.
      const whole = new Uint8Array(await response.arrayBuffer())
      if (whole.length > ctx.maxArtifactBytes) {
        return {
          ok: false,
          failure: "ARTIFACT_TOO_LARGE",
          detail: `${whole.length} bytes exceeds ${ctx.maxArtifactBytes}`,
        }
      }
      return { ok: true, bytes: whole }
    }

    const chunks: Uint8Array[] = []
    let total = 0
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > ctx.maxArtifactBytes) {
        // Stop reading AND tell the server, so a bomb costs us the cap and not the whole stream.
        await reader.cancel().catch(() => {})
        return {
          ok: false,
          failure: "ARTIFACT_TOO_LARGE",
          detail: `exceeds ${ctx.maxArtifactBytes} bytes`,
        }
      }
      chunks.push(value)
    }
    return { ok: true, bytes: concat(chunks, total) }
  } catch (err) {
    return { ok: false, failure: "NETWORK_UNAVAILABLE", detail: describe(err) }
  }
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * `fetch` with a timeout, so a registry that accepts a connection and then stalls cannot hang
 * the ingestion run. `AbortSignal.timeout` is Node 18+; all three CI legs are Node 20.
 */
async function fetchWithTimeout(
  ctx: ArtifactFetchContext,
  url: string,
  headers: { accept: string },
): Promise<Response> {
  return ctx.fetchImpl(url, {
    headers: { accept: headers.accept, "user-agent": "calllint-adoption-index" },
    signal: AbortSignal.timeout(ctx.requestTimeoutMs),
  })
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
