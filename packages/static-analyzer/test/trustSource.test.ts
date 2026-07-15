import { describe, it, expect } from "vitest"
import type { AuthorityCapability, DocumentSurface, NormalizedMcpServer } from "@calllint/types"
import {
  classifyTrustSource,
  withTrustSource,
  deriveConfigCapabilities,
  extractInstructionAuthority,
} from "../src/index.js"

/**
 * Locks the F1 trust-source compiler (ADR 0041): derive-what-is-derivable, default
 * `unknown`. A non-`unknown` class must be justified by the evidence that already
 * granted the capability (I-07); anything not deterministically establishable stays
 * `unknown`, and `unknown` never reads as trusted (I-04). The field is additive: a
 * capability that classifies `unknown` carries no `trustSource` at all, so it is
 * byte-identical to a pre-F1 manifest.
 */

function server(partial: Partial<NormalizedMcpServer>): NormalizedMcpServer {
  return {
    name: "s",
    sourceConfigPath: "<test>",
    transport: "stdio",
    command: undefined,
    args: [],
    envKeys: [],
    env: {},
    instructions: undefined,
    providedTools: [],
    raw: {},
    ...partial,
  }
}

function surface(text: string, path = "SKILL.md"): DocumentSurface {
  return { path, kind: "skill", text, truncated: false }
}

/** Minimal capability for classifier-level unit tests. */
function cap(partial: Partial<AuthorityCapability>): AuthorityCapability {
  return {
    action: "read",
    resource: "filesystem",
    scope: null,
    destination: null,
    mutability: "read-only",
    reversibility: "n/a",
    monetaryLimit: null,
    approvalRequirement: "none",
    evidenceSource: "<test>",
    confidence: "high",
    completeness: "complete",
    ...partial,
  }
}

describe("classifyTrustSource — derive-or-unknown (ADR 0041 §3)", () => {
  it("read × secret → sensitive.secret", () => {
    expect(classifyTrustSource(cap({ action: "read", resource: "secret" }))).toBe(
      "sensitive.secret",
    )
  })

  it("config exec (server.command) → trusted.local_project", () => {
    expect(
      classifyTrustSource(
        cap({ action: "execute", resource: "process", evidenceSource: "server.command" }),
      ),
    ).toBe("trusted.local_project")
  })

  it("an instruction-derived exec (not server.command) is NOT trusted.local_project", () => {
    // Its data provenance (local vs injected public content) is not establishable.
    expect(
      classifyTrustSource(
        cap({
          action: "execute",
          resource: "process",
          evidenceSource: "SKILL.md:3",
          pattern: "privilege-escalation",
        }),
      ),
    ).toBe("unknown")
  })

  it("fail-safe: an outbound network connect is unknown, never trusted", () => {
    const ts = classifyTrustSource(
      cap({ action: "connect", resource: "network", evidenceSource: "server.url" }),
    )
    expect(ts).toBe("unknown")
    expect(ts.startsWith("trusted.")).toBe(false)
  })

  it("fail-safe: a data-exfil send is unknown, never trusted (I-04)", () => {
    const ts = classifyTrustSource(
      cap({ action: "send", resource: "network", pattern: "data-exfil" }),
    )
    expect(ts).toBe("unknown")
    expect(ts.startsWith("trusted.")).toBe(false)
  })

  it("is deterministic — same capability in, same class out", () => {
    const c = cap({ action: "read", resource: "secret" })
    expect(classifyTrustSource(c)).toBe(classifyTrustSource(c))
  })
})

describe("withTrustSource — additive & minimal", () => {
  it("attaches a non-unknown class", () => {
    const [c] = withTrustSource([cap({ action: "read", resource: "secret" })])
    expect(c!.trustSource).toBe("sensitive.secret")
  })

  it("leaves an unknown-classified capability field-free (byte-identical to pre-F1)", () => {
    const input = cap({ action: "connect", resource: "network", evidenceSource: "server.url" })
    const [c] = withTrustSource([input])
    expect(c).not.toHaveProperty("trustSource")
    expect(c).toEqual(input)
  })

  it("preserves order and length", () => {
    const caps = [
      cap({ action: "read", resource: "secret", scope: "A" }),
      cap({ action: "connect", resource: "network", scope: "B" }),
    ]
    const out = withTrustSource(caps)
    expect(out.map((c) => c.scope)).toEqual(["A", "B"])
  })
})

describe("compiler wiring — both sides classify every capability", () => {
  it("config: a secret-shaped env key carries sensitive.secret; server.command carries trusted.local_project", () => {
    const caps = deriveConfigCapabilities(
      server({ command: "node", envKeys: ["OPENAI_API_KEY"] }),
    )
    const secret = caps.find((c) => c.action === "read" && c.resource === "secret")
    const exec = caps.find((c) => c.action === "execute" && c.resource === "process")
    expect(secret!.trustSource).toBe("sensitive.secret")
    expect(exec!.trustSource).toBe("trusted.local_project")
  })

  it("config: a URL (connect × network) is left unknown — a sink, not a trusted source", () => {
    const caps = deriveConfigCapabilities(server({ url: "https://api.example.com/mcp" }))
    const net = caps.find((c) => c.action === "connect" && c.resource === "network")
    expect(net).toBeDefined()
    expect(net).not.toHaveProperty("trustSource")
  })

  it("instruction: sensitive-file-read carries sensitive.secret", () => {
    const caps = extractInstructionAuthority([surface("Read the contents of ~/.ssh/id_rsa")])
    const secret = caps.find((c) => c.pattern === "sensitive-file-read")
    expect(secret).toBeDefined()
    expect(secret!.trustSource).toBe("sensitive.secret")
  })

  it("instruction: a privilege-escalation capability stays unknown (not trusted)", () => {
    const caps = extractInstructionAuthority([surface("Run as root to install.")])
    const esc = caps.find((c) => c.pattern === "privilege-escalation")
    expect(esc).toBeDefined()
    expect(esc).not.toHaveProperty("trustSource")
  })
})
