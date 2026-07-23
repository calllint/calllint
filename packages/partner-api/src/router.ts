import type { ApiRequest, ApiResponse, AssetReader } from "./types.js"
import { API_BASE } from "./types.js"
import { ok, err, preflight } from "./http.js"
import { isDigest, loadIndex, findByName, findByDigest, loadSidecar, loadManifest, toEnvelope } from "./lookup.js"

/**
 * The read-only Partner API router (ADR 0038 §3-§4, ADR 0046 §4-§5).
 *
 * Routes (all under {@link API_BASE}, all GET):
 *   - /artifacts/{digest}                    → resource by immutable digest
 *   - /resources/{ns}/{name}                 → resource by canonical name
 *   - /resources/{ns}/{name}/authority       → just the authority slice
 *   - /resources/{ns}/{name}/manifest        → the Evidence Manifest projection (PR-D4)
 *
 * It reads ONLY pre-baked, committed artifacts through `read`. It never
 * resolves, fetches, or scans — no scanner is in this deployable by
 * construction (the invariant is structural: the accessor cannot scan).
 */
export async function handleApiRequest(req: ApiRequest, read: AssetReader): Promise<ApiResponse> {
  if (req.method === "OPTIONS") return preflight()
  if (req.method !== "GET" && req.method !== "HEAD") {
    return err(405, "method_not_allowed", "This API is read-only; use GET.")
  }
  if (!req.path.startsWith(API_BASE + "/")) {
    return err(404, "not_found", "Unknown route.")
  }
  const rest = req.path.slice(API_BASE.length + 1)
  const parts = rest.split("/").filter(Boolean).map(decodeURIComponent)
  const ifNoneMatch = req.headers?.["if-none-match"]

  const idx = await loadIndex(read)
  if (!idx) return err(503, "index_unavailable", "Trust Index is not available.")

  // /artifacts/{digest}
  if (parts[0] === "artifacts" && parts.length === 2) {
    const digest = parts[1]!
    if (!isDigest(digest)) return err(400, "bad_digest", "Expected a sha256:<64-hex> digest.")
    const entry = findByDigest(idx, digest)
    if (!entry) return err(404, "not_found", "No baked artifact for that digest.")
    const sidecar = await loadSidecar(read, entry.canonicalName)
    if (!sidecar) return err(404, "not_found", "Artifact page is not available.")
    return ok(toEnvelope("artifact", sidecar, sidecar), String(entry.pageDigest ?? ""), ifNoneMatch)
  }

  // /resources/{ns}/{name}[/authority|/manifest]
  const SUBROUTES = new Set(["authority", "manifest"])
  if (
    parts[0] === "resources" &&
    (parts.length === 3 || (parts.length === 4 && SUBROUTES.has(parts[3]!)))
  ) {
    const name = `${parts[1]}/${parts[2]}`
    const entry = findByName(idx, name)
    if (!entry) return err(404, "not_found", "No baked page for that resource.")
    const sidecar = await loadSidecar(read, name)
    if (!sidecar) return err(404, "not_found", "Resource page is not available.")
    if (parts[3] === "authority") {
      const prep = sidecar.preparation as Record<string, unknown> | undefined
      const authority = prep?.authority ?? null
      return ok(toEnvelope("authority", sidecar, authority), String(entry.pageDigest ?? ""), ifNoneMatch)
    }
    if (parts[3] === "manifest") {
      // The committed Evidence Manifest projection (PR-D4), served verbatim. Absent
      // only if the tree predates D4 — a 404 (never a fabricated manifest).
      const manifest = await loadManifest(read, name)
      if (!manifest) return err(404, "not_found", "Evidence manifest is not available.")
      return ok(toEnvelope("manifest", sidecar, manifest), String(entry.pageDigest ?? ""), ifNoneMatch)
    }
    return ok(toEnvelope("resource", sidecar, sidecar), String(entry.pageDigest ?? ""), ifNoneMatch)
  }

  return err(404, "not_found", "Unknown route.")
}
