import { describe, it, expect } from "vitest"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import {
  extractOpenClaw,
  extractHermes,
  parseHermesYaml,
  buildFingerprint,
} from "../src/index.js"
import { resolveRuntimeBinding } from "@calllint/resolver"
import {
  analyzeServerConfig,
  detectMessagingSend,
  detectOauthScope,
  detectGatewayRuntime,
} from "@calllint/static-analyzer"
import type { NormalizedMcpServer } from "@calllint/types"

function ctx(server: NormalizedMcpServer) {
  return { server, binding: resolveRuntimeBinding(server) }
}

function server(over: Partial<NormalizedMcpServer> = {}): NormalizedMcpServer {
  return {
    name: "demo",
    sourceConfigPath: "x",
    transport: "stdio",
    command: "npx",
    args: ["-y", "demo-mcp@1.2.3"],
    envKeys: [],
    env: {},
    providedTools: [],
    raw: {},
    ...over,
  }
}

describe("OpenClaw gateway extractor (P2.5)", () => {
  it("tags a `openclaw mcp add -- npx` snippet as gateway_runtime", () => {
    const g = extractOpenClaw("openclaw mcp add demo -- npx -y demo-mcp@1.2.3")
    expect(g.kind).toBe("gateway_runtime")
    expect(g.servers[0]!.args).toContain("demo-mcp@1.2.3")
  })

  it("handles a bare gateway command with no downstream package", () => {
    const g = extractOpenClaw("openclaw serve")
    expect(g.kind).toBe("gateway_runtime")
    expect(g.servers).toHaveLength(1)
    expect(g.servers[0]!.raw).toMatchObject({ gateway: "openclaw" })
  })

  it("throws on unrelated text", () => {
    expect(() => extractOpenClaw("hello world")).toThrow()
  })
})

describe("Hermes gateway extractor (P2.5)", () => {
  const YAML = `
mcp_servers:
  demo:
    command: "npx"
    args: ["-y", "demo-mcp@1.2.3"]
  remote:
    url: "https://api.example.com/mcp"
    oauth:
      scopes: ["read:all", "admin"]
other_key: 1
`
  it("parses mcp_servers with command/args/url/oauth", () => {
    const parsed = parseHermesYaml(YAML)
    expect(Object.keys(parsed)).toEqual(["demo", "remote"])
    expect(parsed.demo!.args).toEqual(["-y", "demo-mcp@1.2.3"])
    expect(parsed.remote!.url).toBe("https://api.example.com/mcp")
    expect(parsed.remote!.oauthScopes).toEqual(["read:all", "admin"])
  })

  it("emits gateway_runtime servers; oauth surfaces on raw", () => {
    const g = extractHermes(YAML)
    expect(g.kind).toBe("gateway_runtime")
    expect(g.servers).toHaveLength(2)
    const remote = g.servers.find((s) => s.name === "remote")!
    expect(remote.raw).toMatchObject({ gateway: "hermes", oauth: { scopes: ["read:all", "admin"] } })
  })
})

describe("messagingSend detector (P2.6 #8 / ADR 0021)", () => {
  it("fires on a known messaging package", () => {
    const f = detectMessagingSend(ctx(server({ args: ["-y", "@org/server-slack@1.0.0"] })))
    expect(f).toHaveLength(1)
    expect(f[0]!.id).toBe("action.messaging-send")
  })

  it("fires OBSERVED on a send_email tool descriptor", () => {
    const f = detectMessagingSend(
      ctx(server({ providedTools: [{ name: "send_email", description: "send an email" }] })),
    )
    expect(f[0]!.mode).toBe("OBSERVED")
  })

  it("does not fire on a plain time server", () => {
    expect(detectMessagingSend(ctx(server({ args: ["-y", "server-time@1.0.0"] })))).toEqual([])
  })
})

describe("oauthScope detector (P2.6 #10 / ADR 0022)", () => {
  it("UNKNOWN when oauth present but no scope declared", () => {
    const f = detectOauthScope(ctx(server({ raw: { oauth: {} } })))
    expect(f).toHaveLength(1)
    expect(f[0]!.mode).toBe("INFERRED")
  })

  it("REVIEW (OBSERVED) on a broad scope", () => {
    const f = detectOauthScope(ctx(server({ raw: { oauth: { scopes: ["admin"] } } })))
    expect(f[0]!.mode).toBe("OBSERVED")
    expect(f[0]!.severity).toBe("high")
  })

  it("no finding for a narrow declared scope", () => {
    expect(detectOauthScope(ctx(server({ raw: { oauth: { scopes: ["read:profile"] } } })))).toEqual([])
  })

  it("no finding when there is no oauth metadata", () => {
    expect(detectOauthScope(ctx(server()))).toEqual([])
  })
})

describe("gatewayRuntime detector (P2.6 #12 / ADR 0023)", () => {
  it("fires when raw.gateway is set", () => {
    const f = detectGatewayRuntime(ctx(server({ raw: { gateway: "hermes" } })))
    expect(f).toHaveLength(1)
    expect(f[0]!.id).toBe("runtime.gateway")
  })

  it("does not fire on a plain server", () => {
    expect(detectGatewayRuntime(ctx(server()))).toEqual([])
  })
})

describe("fingerprint effects from gateway/oauth (ADR 0019/0022/0023)", () => {
  it("gateway kind adds gateway_runtime effect; oauth raw adds oauth_scope", () => {
    const s = server({ raw: { gateway: "hermes", oauth: { scopes: ["admin"] } } })
    const fp = buildFingerprint({
      server: s,
      binding: resolveRuntimeBinding(s),
      findings: analyzeServerConfig(s),
      origin: "workspace",
      kind: "gateway_runtime",
    })
    expect(fp.kind).toBe("gateway_runtime")
    expect(fp.effects).toContain("gateway_runtime")
    expect(fp.effects).toContain("oauth_scope")
  })
})

describe("no per-host risk engine exists (P2.5 invariant)", () => {
  it("no *Risk.ts file lives under extract/mappings", () => {
    const dir = join(__dirname, "..", "src", "extract", "mappings")
    const files = readdirSync(dir)
    expect(files.filter((f) => /Risk\.ts$/i.test(f))).toEqual([])
  })
})
