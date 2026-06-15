import type { Policy } from "@mcpguard/types"

export function defaultPolicy(): Policy {
  return {
    schemaVersion: "mcpguard.policy.v0",
    defaults: {
      unknownSource: "deny",
      unpinnedPackage: "warn",
      broadFilesystemAccess: "deny",
      arbitraryCommandExecution: "deny",
      promptPoisoning: "deny",
      externalMutation: "warn",
      financialAction: "deny",
    },
    ci: {
      failOn: ["BLOCK", "UNKNOWN"],
      failOnReview: false,
    },
    allowedSources: [
      "npm:@modelcontextprotocol/*",
      "github:modelcontextprotocol/*",
    ],
    allowedPaths: ["${workspaceFolder}"],
    overrides: [],
  }
}

/** Pretty-printed default policy file content for `policy init`. */
export function defaultPolicyJson(): string {
  return JSON.stringify(defaultPolicy(), null, 2) + "\n"
}
