/**
 * Pack-smoke for the `calllint-mcp` package (Phase 5 / ADR 0025). Mirrors
 * package-smoke.mjs for the CLI: builds the real npm tarball, asserts the
 * shipped surface and empty runtime deps, and drives the built server over
 * stdio to prove initialize / tools/list / tools/call work from the published
 * artifact. Never executes a scanned server — only inspects configs statically.
 *
 * Usage: node scripts/mcp-pack-smoke.mjs
 */
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..")
const pkgDir = join(repoRoot, "packages", "calllint-mcp")
const nodeDir = dirname(process.execPath)

function npmCli() {
  const candidates = [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ]
  return candidates.find((c) => existsSync(c))
}
function runNpm(args, opts) {
  const cli = npmCli()
  if (cli) return execFileSync(process.execPath, [cli, ...args], opts)
  return execFileSync("npm", args, opts)
}

const ALLOWED = new Set(["package.json", "README.md", "LICENSE", "NOTICE", "server.json", "dist/index.js"])
const FORBIDDEN_SUBSTRINGS = ["src/", "test/", "tests/", "build.mjs", ".claude", "node_modules", "tsconfig"]

function fail(msg) {
  console.error(`✗ mcp-pack-smoke: ${msg}`)
  process.exit(1)
}
function ok(msg) {
  console.log(`✓ ${msg}`)
}

const work = mkdtempSync(join(tmpdir(), "calllint-mcp-pack-"))
try {
  // 1. Pack the real tarball.
  const raw = runNpm(["pack", "--json", "--pack-destination", work], { cwd: pkgDir, encoding: "utf8" })
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start === -1 || end === -1) fail(`npm pack --json produced no JSON array:\n${raw}`)
  const meta = JSON.parse(raw.slice(start, end + 1))[0]
  ok(`packed ${meta.filename} (${meta.files.length} files, ${meta.size} bytes)`)

  // 2. Manifest must be a subset of the allowlist (no src/test/etc.).
  const shipped = meta.files.map((f) => f.path.replace(/\\/g, "/"))
  for (const path of shipped) {
    if (!ALLOWED.has(path)) fail(`unexpected file in tarball: ${path}`)
    for (const bad of FORBIDDEN_SUBSTRINGS) if (path.includes(bad)) fail(`forbidden path: ${path}`)
  }
  if (!shipped.includes("dist/index.js")) fail("missing dist/index.js")
  ok(`manifest clean: ${shipped.join(", ")}`)

  // 3. package.json surface.
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"))
  if (pkg.name !== "calllint-mcp") fail(`name should be calllint-mcp, got ${pkg.name}`)
  if (Object.keys(pkg.dependencies ?? {}).length !== 0) {
    fail(`runtime dependencies must be empty, found: ${Object.keys(pkg.dependencies).join(", ")}`)
  }
  if (JSON.stringify(pkg.dependencies ?? {}).includes("workspace:")) fail("workspace:* survived into deps")
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["calllint-mcp"]
  if (!bin || !bin.replace(/^\.\//, "").startsWith("dist/index.js")) fail(`bin should be dist/index.js, got ${bin}`)
  ok("package.json: publishable, bin correct, empty runtime deps, no workspace:*")

  // 4. Built bundle is self-contained with a shebang.
  const distPath = join(pkgDir, "dist", "index.js")
  if (!existsSync(distPath)) fail("dist/index.js not built — run pnpm build first")
  const dist = readFileSync(distPath, "utf8")
  if (!dist.startsWith("#!")) fail("dist/index.js missing node shebang")
  if (/@calllint\//.test(dist)) fail("unresolved @calllint/* import in bundle (not self-contained)")
  ok("dist/index.js has shebang and is self-contained")

  // 5. Drive the server over stdio: initialize, tools/list (=6), tools/call BLOCK.
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "scan_mcp_config_json",
        arguments: {
          json: JSON.stringify({
            mcpServers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "/"] } },
          }),
        },
      },
    },
  ]
  const input = requests.map((r) => JSON.stringify(r)).join("\n") + "\n"
  const res = spawnSync(process.execPath, [distPath], { input, encoding: "utf8", timeout: 30000 })
  if (res.status !== 0 && res.status !== null) fail(`server exited ${res.status}: ${res.stderr}`)
  const lines = res.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const init = lines.find((l) => l.id === 1)
  if (init?.result?.protocolVersion == null) fail("initialize did not return a protocolVersion")
  const list = lines.find((l) => l.id === 2)
  if (list?.result?.tools?.length !== 6) fail(`tools/list expected 6 tools, got ${list?.result?.tools?.length}`)
  const callRes = lines.find((l) => l.id === 3)
  const decision = JSON.parse(callRes.result.content[0].text)
  if (decision[0].verdict !== "BLOCK") fail(`scan_mcp_config_json expected BLOCK, got ${decision[0].verdict}`)
  ok("stdio server: initialize + tools/list(6) + tools/call → BLOCK")

  console.log("mcp-pack-smoke: PASS")
} finally {
  // best-effort cleanup
}
