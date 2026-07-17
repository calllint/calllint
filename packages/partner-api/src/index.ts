// @calllint/partner-api — Phase I2a read-only Partner API core.
// A pure router over pre-baked, digest-addressed Trust Pages. No scanner.
export { handleApiRequest } from "./router.js"
export { API_SCHEMA, API_BASE } from "./types.js"
export type { ApiRequest, ApiResponse, AssetReader, ApiEnvelope } from "./types.js"
export { isDigest } from "./lookup.js"
export { baseHeaders, etagFor } from "./http.js"
