/**
 * `calllint url-handler` end-to-end through `run()`, with the OS port injected.
 *
 * The interesting half is `open`, which is the one CallLint surface any web page can
 * invoke once registered. Those tests assert that a hostile link produces a NAMED
 * refusal and that the printed command never contains a write flag — the two claims the
 * "one click is still safe" argument rests on.
 */
import { describe, it, expect } from "vitest"
import { run } from "../src/run.js"
import { EXIT } from "../src/args.js"
import { computeAdoptionRewrite } from "../src/commands/urlHandler.js"
import { FORBIDDEN_ARGS, type HandlerRecord, type HandlerRegistry } from "@calllint/core"

const DIGEST_RE = /plan digest: (sha256:[0-9a-f]{64})/

function key(r: HandlerRecord): string {
  return r.kind === "REGISTRY_KEY" ? `${r.path}::${r.valueName}` : r.path
}

function memRegistry() {
  const store = new Map<string, string>()
  const registry: HandlerRegistry = {
    read: (r) => store.get(key(r)) ?? null,
    write: (r) =>
      void store.set(
        key(r),
        r.kind === "REGISTRY_KEY" ? r.value : r.kind === "DESKTOP_FILE" ? r.contents : `${r.scheme}=${r.desktopFile}`,
      ),
    remove: (r) => void store.delete(key(r)),
  }
  return { registry, store }
}

function deps(overrides: Partial<Parameters<typeof run>[1]["urlHandler"] & object> = {}, registry?: HandlerRegistry) {
  const mem = memRegistry()
  return {
    cwd: "/repo",
    readStdin: () => "",
    now: 0,
    generatedAt: "2026-07-30T00:00:00.000Z",
    urlHandler: {
      platform: "linux" as NodeJS.Platform,
      home: "/home/u",
      binPath: "/usr/local/bin/calllint",
      registry: registry ?? mem.registry,
      detectHost: () => "cursor" as string | null,
      ...overrides,
    },
    _store: mem.store,
  }
}

describe("url-handler — availability and usage", () => {
  it("refuses when no OS port is injected rather than guessing the machine", () => {
    const r = run(["url-handler", "status"], { cwd: "/repo", readStdin: () => "", now: 0, generatedAt: "x" })
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("no OS registry port")
  })

  it("prints help with no subcommand", () => {
    const r = run(["url-handler"], deps())
    expect(r.exitCode).toBe(EXIT.OK)
    expect(r.stdout).toContain("calllint url-handler")
    expect(r.stdout).toContain("never writes a host config")
  })

  it("rejects an unknown subcommand", () => {
    const r = run(["url-handler", "frobnicate"], deps())
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain('unknown subcommand "frobnicate"')
  })
})

describe("url-handler register — plan-first, approval-gated", () => {
  it("plans without writing, and prints the digest to approve", () => {
    const d = deps()
    const r = run(["url-handler", "register"], d)
    expect(r.exitCode).toBe(EXIT.OK)
    expect(r.stdout).toContain("Nothing was written")
    expect(r.stdout).toMatch(DIGEST_RE)
    expect(d._store.size).toBe(0)
  })

  it("--apply without --approve refuses and writes nothing", () => {
    const d = deps()
    const r = run(["url-handler", "register", "--apply"], d)
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("Missing --approve")
    expect(d._store.size).toBe(0)
  })

  it("a wrong approval digest writes nothing", () => {
    const d = deps()
    const r = run(["url-handler", "register", "--apply", "--approve", `sha256:${"0".repeat(64)}`], d)
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("does not match")
    expect(d._store.size).toBe(0)
  })

  it("registers with the correct digest, then reports ALREADY_APPLIED and REGISTERED status", () => {
    const d = deps()
    const digest = run(["url-handler", "register"], d).stdout.match(DIGEST_RE)![1]!

    const applied = run(["url-handler", "register", "--apply", "--approve", digest], d)
    expect(applied.exitCode).toBe(EXIT.OK)
    expect(applied.stdout).toContain("REGISTERED")
    expect(d._store.size).toBe(2)

    expect(run(["url-handler", "status"], d).stdout).toContain("REGISTERED")
    expect(run(["url-handler", "register", "--apply", "--approve", digest], d).stdout).toContain("ALREADY_APPLIED")
  })

  it("unregister removes what register wrote", () => {
    const d = deps()
    const digest = run(["url-handler", "register"], d).stdout.match(DIGEST_RE)![1]!
    run(["url-handler", "register", "--apply", "--approve", digest], d)

    const r = run(["url-handler", "unregister", "--apply", "--approve", digest], d)
    expect(r.stdout).toContain("UNREGISTERED")
    expect(d._store.size).toBe(0)
  })
})

describe("url-handler on macOS — an honest refusal, not a silent no-op", () => {
  it("status reports UNSUPPORTED with the cause and exits 0", () => {
    const r = run(["url-handler", "status"], deps({ platform: "darwin" }))
    expect(r.exitCode).toBe(EXIT.OK)
    expect(r.stdout).toContain("UNSUPPORTED on darwin")
    expect(r.stdout).toContain("CFBundleURLTypes")
  })

  it("register refuses and writes nothing", () => {
    const d = deps({ platform: "darwin" })
    const r = run(["url-handler", "register"], d)
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("cannot register on darwin")
    expect(d._store.size).toBe(0)
  })

  it("an unsupported platform id is refused rather than planned", () => {
    const r = run(["url-handler", "status"], deps({ platform: "aix" as NodeJS.Platform }))
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("platform aix is not supported")
  })
})

describe("url-handler open — the hostile-input surface", () => {
  it("prints the reviewable command and never a write flag", () => {
    const r = run(
      ["url-handler", "open", `calllint://adoption/mcp-registry/ac.tandem-docs-mcp@0.3.2?artifact=sha256:${"a".repeat(64)}`],
      deps(),
    )
    expect(r.exitCode).toBe(EXIT.OK)
    expect(r.stdout).toContain("calllint safe-install --contract https://calllint.com/install/")
    expect(r.stdout).toContain("--host cursor")
    expect(r.stdout).toContain("--expect-artifact-digest")
    expect(r.stdout).not.toContain("--apply")
    expect(r.stdout).not.toContain("--approve")
  })

  it("resolves the contract origin from CallLint's own constant, not the link", () => {
    const r = run(["url-handler", "open", "calllint://adoption/mcp-registry/x"], deps())
    expect(r.stdout).toContain("https://calllint.com/install/mcp-registry/x/index.json")
  })

  it.each([
    ["a foreign scheme", "https://evil.example/x", "NOT_AN_ADOPTION_URI"],
    ["the banned safe-install spelling", "calllint://safe-install/mcp-registry/x", "NOT_AN_ADOPTION_URI"],
    ["path traversal", "calllint://adoption/../../etc/passwd", "MALFORMED_SLUG"],
    ["shell metacharacters", "calllint://adoption/mcp-registry/x;rm -rf /", "MALFORMED_SLUG"],
    ["command substitution", "calllint://adoption/mcp-registry/$(id)", "MALFORMED_SLUG"],
    ["a bad digest", "calllint://adoption/mcp-registry/x?artifact=nope", "MALFORMED_DIGEST"],
    ["an unknown parameter", "calllint://adoption/mcp-registry/x?apply=true", "UNKNOWN_QUERY_PARAM"],
    ["an empty target", "calllint://adoption/", "EMPTY_TARGET"],
  ])("refuses %s, naming the reason", (_label, uri, reason) => {
    const r = run(["url-handler", "open", uri], deps())
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain(reason)
    expect(r.stdout).toBe("")
  })

  it("refuses when no applyable host is present rather than dead-ending later", () => {
    const r = run(["url-handler", "open", "calllint://adoption/mcp-registry/x"], deps({ detectHost: () => null }))
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("no supported agent host detected")
  })

  it("requires a uri", () => {
    const r = run(["url-handler", "open"], deps())
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("Missing <uri>")
  })

  it("writes nothing at all — open is read-only", () => {
    const d = deps()
    run(["url-handler", "open", "calllint://adoption/mcp-registry/x"], d)
    expect(d._store.size).toBe(0)
  })
})

/**
 * The local edge (ADR 0057 §6). `--apply` is a decision the MACHINE makes about a plan
 * the link already passed validation for — it is never a value the link supplied. These
 * assert that boundary from both sides: the flag appears only under every stated
 * precondition, and nothing link-derived ever carries a forbidden arg.
 */
describe("computeAdoptionRewrite — continuing a click into the prompt", () => {
  const TTY = { detectHost: () => "cursor" as string | null, stdinIsTty: true }
  const URI = "calllint://adoption/mcp-registry/x"

  it("rewrites an ok resolution into the safe-install argv plus a local --apply", () => {
    const argv = computeAdoptionRewrite(["url-handler", "open", URI], TTY)
    expect(argv).not.toBeNull()
    expect(argv?.[0]).toBe("safe-install")
    expect(argv).toContain("--host")
    expect(argv?.at(-1)).toBe("--apply")
  })

  it("never rewrites without a real TTY — a pipe cannot be asked for approval", () => {
    // Without this, `yes | calllint url-handler open <uri>` is a non-interactive
    // auto-apply wearing interactive clothes.
    expect(computeAdoptionRewrite(["url-handler", "open", URI], { ...TTY, stdinIsTty: false })).toBeNull()
  })

  it.each([
    ["a different command", ["scan", "open", URI]],
    ["a different subcommand", ["url-handler", "register", URI]],
    ["a missing uri", ["url-handler", "open"]],
  ])("leaves %s alone", (_label, argv) => {
    expect(computeAdoptionRewrite(argv, TTY)).toBeNull()
  })

  it.each([
    ["a foreign scheme", "https://evil.example/x"],
    ["the banned spelling", "calllint://safe-install/mcp-registry/x"],
    ["path traversal", "calllint://adoption/../../etc/passwd"],
    ["an unknown parameter", "calllint://adoption/mcp-registry/x?apply=true"],
  ])("refuses to rewrite %s, so the refusal keeps its named path", (_label, uri) => {
    expect(computeAdoptionRewrite(["url-handler", "open", uri], TTY)).toBeNull()
  })

  it("does not rewrite when no host is applyable", () => {
    expect(computeAdoptionRewrite(["url-handler", "open", URI], { ...TTY, detectHost: () => null })).toBeNull()
  })

  it("every link-derived member still passes FORBIDDEN_ARGS; only the edge adds a flag", () => {
    // The security property in one assertion: the ONLY forbidden arg in the produced argv
    // is the one appended locally, after dispatch already validated the rest. If a future
    // edit let a link contribute `--approve` or `--host-config`, this fails.
    const argv = computeAdoptionRewrite(["url-handler", "open", `${URI}?artifact=sha256:${"a".repeat(64)}`], TTY)
    expect(argv).not.toBeNull()
    const forbidden = (argv ?? []).filter((a) => FORBIDDEN_ARGS.includes(a))
    expect(forbidden).toEqual(["--apply"])
    // `--approve` skips the human entirely. It must be unreachable from any link path.
    expect(argv).not.toContain("--approve")
  })

  it("the rewrite is exactly what `open` prints, plus --apply — one resolver, no drift", () => {
    const printed = run(["url-handler", "open", URI], deps()).stdout
    const argv = computeAdoptionRewrite(["url-handler", "open", URI], TTY) ?? []
    for (const arg of argv.slice(0, -1)) expect(printed).toContain(arg)
  })
})
