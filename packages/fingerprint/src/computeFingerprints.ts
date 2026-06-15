import type {
  Fingerprints,
  Finding,
  NormalizedMcpServer,
  RiskSymbol,
  RuntimeBinding,
} from "@mcpguard/types"
import { hashJson, sha256 } from "./hashJson.js"

export interface FingerprintInput {
  server: NormalizedMcpServer
  binding: RuntimeBinding
  symbols: RiskSymbol[]
  findingIds: string[]
}

/**
 * Compute fingerprints for a scanned server. These let a later scan or runtime
 * detect drift (T11/T12): if the config or risk surface hash changes, the prior
 * verdict no longer applies.
 */
export function computeFingerprints(input: FingerprintInput): Fingerprints {
  const { server, binding, symbols, findingIds } = input

  const targetSpec = {
    command: binding.declaredCommand,
    args: binding.declaredArgs,
    envKeys: [...server.envKeys].sort(),
    remoteUrl: binding.remoteUrl,
  }

  const packageSpec =
    binding.packageName !== undefined
      ? `${binding.packageName}@${binding.packageVersionSpec ?? ""}`
      : undefined

  const riskSurface = {
    symbols: [...symbols].sort(),
    findingIds: [...findingIds].sort(),
  }

  const sourceText =
    server.instructions ??
    (server.providedTools.length > 0 ? JSON.stringify(server.providedTools) : undefined)

  const toolMetadata =
    server.providedTools.length > 0 ? server.providedTools : undefined

  const fp: Fingerprints = {
    configHash: hashJson(server.raw),
    targetSpecHash: hashJson(targetSpec),
    riskSurfaceHash: hashJson(riskSurface),
  }
  if (packageSpec !== undefined) fp.packageSpecHash = sha256(packageSpec)
  if (sourceText !== undefined) fp.sourceHash = sha256(sourceText)
  if (toolMetadata !== undefined) fp.toolMetadataHash = hashJson(toolMetadata)
  return fp
}
