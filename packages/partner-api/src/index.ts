// @calllint/partner-api — Phase I2a read-only Partner API core.
// A pure router over pre-baked, digest-addressed Trust Pages. No scanner.
export { handleApiRequest } from "./router.js"
export { API_SCHEMA, API_BASE } from "./types.js"
export type { ApiRequest, ApiResponse, AssetReader, ApiEnvelope } from "./types.js"
export { isDigest } from "./lookup.js"
export { baseHeaders, etagFor } from "./http.js"
// ADR 0085 D3 — how the static trust plane answers an absence. Exported because the Pages
// adapter is the caller and the rule must be observable without deploying it.
export {
  absentPathOutcome,
  ABSENT_CODE,
  ABSENT_CACHE_CONTROL,
  ABSENT_MESSAGE,
  type AbsentOutcome,
} from "./notFound.js"
