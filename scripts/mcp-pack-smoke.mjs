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

  // 5. Drive the server over stdio: initialize, tools/list (=13), tools/call BLOCK,
  //    resources/list (= every committed contract) + resources/read (verbatim contract),
  //    server/discover (M26-2 / ADR 0064 — upstream MUST implement).
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
    { jsonrpc: "2.0", id: 4, method: "resources/list" },
    { jsonrpc: "2.0", id: 5, method: "resources/templates/list" },
    // id 6 belongs to the second spawn's resources/read below, so discover takes 7.
    { jsonrpc: "2.0", id: 7, method: "server/discover" },
  ]
  const input = requests.map((r) => JSON.stringify(r)).join("\n") + "\n"
  const res = spawnSync(process.execPath, [distPath], { input, encoding: "utf8", timeout: 30000 })
  if (res.status !== 0 && res.status !== null) fail(`server exited ${res.status}: ${res.stderr}`)
  const lines = res.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const init = lines.find((l) => l.id === 1)
  if (init?.result?.protocolVersion == null) fail("initialize did not return a protocolVersion")
  if (init?.result?.capabilities?.resources == null) fail("initialize did not advertise the resources capability")
  const list = lines.find((l) => l.id === 2)
  if (list?.result?.tools?.length !== 13) fail(`tools/list expected 13 tools, got ${list?.result?.tools?.length}`)

  // The count above is necessary and NOT sufficient. Measured on this branch before this check
  // existed: renaming the served `calllint_verify_tool_install` to `...installX` while leaving the
  // cardinality at 13 kept `pack:smoke:mcp` at EXIT 0, and its own success line still printed
  // `tools/list(13)` — the wire served a tool that does not exist and the gate called it fine.
  // That is the INV-M8 resources defect (3 of 19 served, everything green) reproduced on the tools
  // side, where the record claimed this guard was the STRONGER of the two.
  //
  // `tools.test.ts` does catch that rename, so this is a gate-strength gap and not an unguarded
  // surface. But every in-package assertion reads the SOURCE array, and this is the only check that
  // reads the WIRE of the built, packed bundle — the same reason the resource set-equality below
  // cannot be delegated to `resources.test.ts`.
  //
  // The expected NAMES are derived from the tool table, keyed on the same anchor Gate 2.4-H uses
  // (phase-2.4-gates.ts), so the two sides cannot drift into agreeing on a wrong surface. Unlike the
  // resource count, the literal 13 stays: it is a frozen PRODUCT surface, not a function of the
  // bundle (see line 129).
  //
  // The capture is `[^"]+` and deliberately NOT `[a-z_]+`: with the tight class, control #198
  // (renaming a served tool to `...installX`) red on "captured 12 names" instead of naming the
  // renamed tool — the guard fired, but on the wrong claim, so the failure message pointed at the
  // scan rather than at the drift. On today's bytes both classes capture the same 13 names, so the
  // looser one costs no precision and lets each assertion fail for its own reason.
  const toolsSrcPath = join(pkgDir, "src", "tools.ts")
  const declaredToolNames = [...readFileSync(toolsSrcPath, "utf8").matchAll(/^ {4}name: "([^"]+)",$/gm)].map(
    (m) => m[1],
  )
  // Vacuity guard: if the regex captures nothing (an indent change, a reformat), both sets are
  // empty and the set equality below passes by meaning nothing. Pin the count BEFORE the set claim.
  if (declaredToolNames.length !== 13) {
    fail(`tool-table scan captured ${declaredToolNames.length} names, expected 13 — ${toolsSrcPath}`)
  }
  const servedToolNames = list.result.tools.map((t) => t.name).sort()
  const expectedToolNames = [...declaredToolNames].sort()
  const missingTools = expectedToolNames.filter((n) => !servedToolNames.includes(n))
  const extraTools = servedToolNames.filter((n) => !expectedToolNames.includes(n))
  if (missingTools.length > 0 || extraTools.length > 0) {
    fail(`tools/list name set drifted from the tool table — missing: [${missingTools}], extra: [${extraTools}]`)
  }

  const callRes = lines.find((l) => l.id === 3)
  const decision = JSON.parse(callRes.result.content[0].text)
  if (decision[0].verdict !== "BLOCK") fail(`scan_mcp_config_json expected BLOCK, got ${decision[0].verdict}`)

  // resources/list must expose EVERY committed adoption contract; templates must advertise the
  // scheme. Closes INV-M8 (new16-new17-integration §2.4): the resource count was documented as
  // 19 but only ever checked for `> 0`, so the surface could shrink silently. Measured on this
  // branch before the fix: mutating `server.ts`'s `resources/list` to `RESOURCES.slice(0, 3)`
  // served 3 of 19 contracts — 84% of the surface gone — while 220 test files / 3548 tests and
  // this very script all passed, printing `resources(3)` on its own success line.
  //
  // The expected count is DERIVED from the committed bundle, never hardcoded. A frozen `19`
  // would go red the moment a 20th contract lands, i.e. exactly when the gate's own goal is met.
  // (Contrast the tool count on line 112: 13 is a frozen PRODUCT surface, so a literal is right
  // there. The resource count is a FUNCTION of the bundle, so it must be read from the bundle.)
  //
  // This is the only check that spans the whole chain. Every in-package assertion sits on one
  // side of it: `resources.test.ts` compares RESOURCES to COMMITTED_CONTRACT_SLUGS, but RESOURCES
  // is `.map()`-derived from those slugs, so that equality is a tautology; and the drift test
  // compares the bundle to the baked sidecars, which cannot see a wire that ignores the bundle.
  const bundlePath = join(pkgDir, "src", "data", "adoption-contracts.json")
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"))
  const bundleSlugs = Object.keys(bundle?.contracts ?? {})
  // Vacuity guard: with an empty bundle every assertion below is trivially true, and an empty
  // bundle is itself the failure (esbuild inlines this file, so a lost bundle is a lost surface).
  if (bundleSlugs.length === 0) fail(`committed bundle exposes no contracts: ${bundlePath}`)

  const resList = lines.find((l) => l.id === 4)
  const resources = resList?.result?.resources
  if (!Array.isArray(resources)) fail("resources/list did not return a resources array")
  if (resources.length !== bundleSlugs.length) {
    fail(`resources/list served ${resources.length} of ${bundleSlugs.length} committed contracts`)
  }
  if (!resources.every((r) => typeof r.uri === "string" && r.uri.startsWith("calllint://adoption/"))) {
    fail("resources/list returned a non-adoption URI")
  }
  // Set equality, not just the count: a same-sized set of different slugs is also a broken
  // surface. Named difference on both sides, so a failure prints WHICH slug moved.
  const servedSlugs = resources.map((r) => r.uri.slice("calllint://adoption/".length)).sort()
  const expectedSlugs = [...bundleSlugs].sort()
  const missing = expectedSlugs.filter((s) => !servedSlugs.includes(s))
  const extra = servedSlugs.filter((s) => !expectedSlugs.includes(s))
  if (missing.length > 0 || extra.length > 0) {
    fail(`resources/list slug set drifted from the bundle — missing: [${missing}], extra: [${extra}]`)
  }
  const tmplList = lines.find((l) => l.id === 5)
  const templates = tmplList?.result?.resourceTemplates
  if (!Array.isArray(templates) || templates.length === 0) fail("resources/templates/list returned no templates")

  // server/discover — M26-2 / ADR 0064. Upstream declares it MUST implement
  // (third_party/mcp-spec/2026-07-28/schema.ts:657), so the 7th request proves the method answers
  // from the PUBLISHED TARBALL, not only in unit tests. That distinction has bitten this surface
  // before: INV-M8's 3-of-19 truncation was a wire defect that 3548 unit tests could not see.
  //
  // The five field names are DiscoverResult's `required` array, asserted as a set difference so a
  // missing field prints its own name. `tests/invariants/mcp-spec-vendor.invariants.test.ts` reads
  // that array off the digest-locked schema.json and checks server.ts against it; here the names
  // are restated deliberately, because this script must run against a tarball with no repo beside
  // it — the vendor gate is what keeps this list honest.
  const disc = lines.find((l) => l.id === 7)
  if (disc?.result == null) fail("server/discover returned no result — upstream declares it MUST implement")
  const discMissing = ["cacheScope", "capabilities", "resultType", "supportedVersions", "ttlMs"].filter(
    (k) => !(k in disc.result),
  )
  if (discMissing.length > 0) fail(`server/discover omitted DiscoverResult required fields: [${discMissing}]`)
  if (disc.result.resultType !== "complete") fail(`server/discover resultType should be complete, got ${disc.result.resultType}`)
  // The public claim, checked at the distribution boundary — in the SHIPPED bundle, which is the
  // only place this can be measured. M26-4 (ADR 0066) makes the claim: both revisions are served
  // in parallel, each whole. Order is asserted, not just membership — as the ADVERTISED fallback
  // preference, which must agree with what the server actually does with absence. Negative control
  // #156: reversing the source array reds three assertions but changes no served revision, because
  // `servedAt` is `requested ?? PROTOCOL_VERSION` and never indexes this array. Oldest-first is
  // therefore what keeps the advertisement honest about today's clients staying on today's shapes.
  const advertised = disc.result.supportedVersions
  const ADVERTISED_EXPECTED = ["2024-11-05", "2026-07-28"]
  if (JSON.stringify(advertised) !== JSON.stringify(ADVERTISED_EXPECTED)) {
    fail(
      `server/discover must advertise exactly ${JSON.stringify(ADVERTISED_EXPECTED)} in order, got ${JSON.stringify(advertised)}`,
    )
  }
  // One server, two methods describing it: a drift between these would be invisible to a check
  // that read only one of them.
  if (JSON.stringify(disc.result.capabilities) !== JSON.stringify(init.result.capabilities)) {
    fail("server/discover capabilities differ from initialize's")
  }

  // resources/read the first advertised contract → must return verbatim JSON text.
  const readReq = { jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: resources[0].uri } }
  const res2 = spawnSync(process.execPath, [distPath], {
    input: [requests[0], readReq].map((r) => JSON.stringify(r)).join("\n") + "\n",
    encoding: "utf8",
    timeout: 30000,
  })
  const read = res2.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((l) => l.id === 6)
  const contents = read?.result?.contents
  if (!Array.isArray(contents) || contents.length === 0) fail("resources/read returned no contents")
  const contract = JSON.parse(contents[0].text)
  if (typeof contract?.contract?.contractDigest !== "string") fail("resources/read did not return a valid adoption contract")

  // ---------------------------------------------------------------------------
  // M26-4 (ADR 0066): the SECOND revision, measured on the same tarball.
  //
  // Every request above declares nothing, so together they prove the legacy shapes ship
  // unchanged. That is half the claim. This batch declares 2026-07-28 and proves the other half
  // reaches the wire: the envelope appears, and the removed handshake is refused. Without it the
  // bundle could serve one revision correctly and the other not at all — the same class of gap as
  // INV-M8, where a wire defect passed every unit test.
  const META_KEY = "io.modelcontextprotocol/protocolVersion"
  const atNew = (id, method, params = {}) => ({
    jsonrpc: "2.0",
    id,
    method,
    params: { ...params, _meta: { [META_KEY]: "2026-07-28" } },
  })
  const statelessReqs = [
    atNew(10, "tools/list"),
    atNew(11, "resources/list"),
    atNew(12, "initialize"),
    atNew(13, "ping"),
  ]
  const res3 = spawnSync(process.execPath, [distPath], {
    input: statelessReqs.map((r) => JSON.stringify(r)).join("\n") + "\n",
    encoding: "utf8",
    timeout: 30000,
  })
  const sLines = res3.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  // The envelope, on the two cacheable results. Values are asserted, not just presence: a `ttlMs`
  // this batch did not intend would be a freshness promise with no `listChanged` to revoke it.
  for (const id of [10, 11]) {
    const r = sLines.find((l) => l.id === id)?.result
    if (r == null) fail(`no result for stateless request ${id}`)
    if (r.resultType !== "complete") fail(`stateless ${id} resultType: ${JSON.stringify(r.resultType)}`)
    if (r.ttlMs !== 0) fail(`stateless ${id} ttlMs must be 0, got ${JSON.stringify(r.ttlMs)}`)
    if (r.cacheScope !== "private") fail(`stateless ${id} cacheScope: ${JSON.stringify(r.cacheScope)}`)
  }
  // The payload must be identical across revisions — the envelope wraps, it does not reshape.
  const sTools = sLines.find((l) => l.id === 10)?.result?.tools
  if (sTools?.length !== 13) fail(`tools/list at 2026-07-28 expected 13 tools, got ${sTools?.length}`)
  const sResources = sLines.find((l) => l.id === 11)?.result?.resources
  if (sResources?.length !== bundleSlugs.length) {
    fail(`resources/list at 2026-07-28 served ${sResources?.length} of ${bundleSlugs.length}`)
  }
  // The removed handshake, refused with METHOD_NOT_FOUND naming the revision.
  for (const id of [12, 13]) {
    const err = sLines.find((l) => l.id === id)?.error
    if (err?.code !== -32601) fail(`stateless ${id} must be -32601, got ${JSON.stringify(err)}`)
    if (!String(err.message).includes("2026-07-28")) {
      fail(`stateless ${id} error must name the revision, got ${JSON.stringify(err.message)}`)
    }
  }
  ok(
    `stdio server: initialize + tools/list(${list.result.tools.length} named) + tools/call → BLOCK + resources(${resources.length}) + read verbatim + server/discover(${advertised.join(",")}) + 2026-07-28 envelope/handshake-refused`,
  )

  console.log("mcp-pack-smoke: PASS")
} finally {
  // best-effort cleanup
}
