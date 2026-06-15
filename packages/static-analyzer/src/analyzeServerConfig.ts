import type { Finding, NormalizedMcpServer } from "@mcpguard/types"
import { resolveRuntimeBinding } from "@mcpguard/resolver"
import type { DetectorContext } from "./context.js"
import { detectUnpinnedPackage } from "./detectors/unpinnedPackage.js"
import { detectBroadFilesystemPath } from "./detectors/broadFilesystemPath.js"
import { detectSecretEnvKeys } from "./detectors/secretEnvKeys.js"
import { detectDangerousCommand } from "./detectors/dangerousCommand.js"
import { detectUnknownRemote } from "./detectors/unknownRemote.js"
import { detectPromptPoisoning } from "./detectors/promptPoisoning.js"
import { detectExternalMutation } from "./detectors/externalMutation.js"

export type Detector = (ctx: DetectorContext) => Finding[]

/** All detectors, run in a stable order. */
export const DETECTORS: Detector[] = [
  detectBroadFilesystemPath,
  detectDangerousCommand,
  detectPromptPoisoning,
  detectSecretEnvKeys,
  detectUnpinnedPackage,
  detectUnknownRemote,
  detectExternalMutation,
]

/** Run every detector against one server and return all findings. */
export function analyzeServerConfig(server: NormalizedMcpServer): Finding[] {
  const binding = resolveRuntimeBinding(server)
  const ctx: DetectorContext = { server, binding }
  const findings: Finding[] = []
  for (const detector of DETECTORS) {
    findings.push(...detector(ctx))
  }
  return findings
}
