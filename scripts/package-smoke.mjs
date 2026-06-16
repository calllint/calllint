#!/usr/bin/env node
/**
 * Package artifact smoke (R1-3).
 *
 * Builds the real npm tarball for the publishable CLI package, then asserts the
 * *shipped surface* matches ADR 0007: a minimal, allowlisted artifact whose bin
 * entry is an executable, self-contained Node bundle. This never publishes and
 * never executes a scanned server — it only inspects what `npm pack` would ship.
 *
 * Checks:
 *   1. `npm pack` produces a tarball (prepack rebuilds dist first).
 *   2. The manifest is exactly { package.json, README.md, dist/index.js } —
 *      no src, tests, fixtures, build.mjs, .claude, caches, or node_modules.
 *   3. package.json: name/bin/type/files/empty-runtime-deps are correct and no
 *      workspace:* specifier survives into the published surface.
 *   4. The unpacked dist/index.js starts with the Node shebang and is a
 *      self-contained bundle (no unresolved @mcpguard/* imports).
 *
 * Usage: node scripts/package-smoke.mjs
 * Exits 0 on success, non-zero with a clear message on the first failure.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..")
const cliDir = join(repoRoot, "apps", "cli")

// Drive npm through its JS entrypoint with the current node binary. This avoids
// the Windows npm.cmd / PATHEXT problem and needs no shell, so there is no
// command-injection surface from the temp path we pass in. The standard npm
// layout ships npm-cli.js next to the node install.
function npmCli() {
  const nodeDir = dirname(process.execPath)
  const candidates = [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ]
  return candidates.find((c) => existsSync(c))
}

function runNpm(args, opts) {
  const cli = npmCli()
  if (cli) return execFileSync(process.execPath, [cli, ...args], opts)
  // Fallback: bare `npm` on PATH (POSIX CI where the layout differs).
  return execFileSync("npm", args, opts)
}

const ALLOWED = new Set(["package.json", "README.md", "dist/index.js"])
const FORBIDDEN_SUBSTRINGS = [
  "src/",
  "test/",
  "tests/",
  "build.mjs",
  ".claude",
  "node_modules",
  ".mcpguard",
  "tsconfig",
]

function fail(msg) {
  console.error(`✗ package-smoke: ${msg}`)
  process.exit(1)
}
function ok(msg) {
  console.log(`✓ ${msg}`)
}

const work = mkdtempSync(join(tmpdir(), "mcpguard-pack-"))
try {
  // 1. Pack the real tarball into an isolated dir. --json gives us the manifest
  //    npm itself computed, so we assert against npm's own view of the surface.
  const raw = runNpm(
    ["pack", "--json", "--pack-destination", work],
    { cwd: cliDir, encoding: "utf8" },
  )
  // The prepack lifecycle (build.mjs) writes progress to stdout ahead of npm's
  // JSON. Build output contains no brackets, so the tarball manifest is the one
  // top-level JSON array — slice it out rather than trust the whole stream.
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start === -1 || end === -1) fail(`npm pack --json produced no JSON array:\n${raw}`)
  const meta = JSON.parse(raw.slice(start, end + 1))[0]
  const tarball = join(work, meta.filename)
  if (!existsSync(tarball)) fail(`tarball not created at ${tarball}`)
  ok(`packed ${meta.filename} (${meta.files.length} files, ${meta.size} bytes)`)

  // 2. Manifest must equal the allowlist exactly.
  const shipped = meta.files.map((f) => f.path.replace(/\\/g, "/"))
  for (const path of shipped) {
    if (!ALLOWED.has(path)) fail(`unexpected file in tarball: ${path}`)
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      if (path.includes(bad)) fail(`forbidden path in tarball: ${path}`)
    }
  }
  for (const required of ALLOWED) {
    if (!shipped.includes(required)) fail(`missing required file: ${required}`)
  }
  ok(`manifest is exactly ${[...ALLOWED].join(", ")}`)

  // 3. Published package.json surface.
  const pkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"))
  if (pkg.bin?.mcpguard !== "./dist/index.js") fail(`bin.mcpguard != ./dist/index.js (got ${pkg.bin?.mcpguard})`)
  if (pkg.type !== "module") fail(`type != module (got ${pkg.type})`)
  if (pkg.private) fail("package is still private:true — cannot publish")
  const runtimeDeps = Object.keys(pkg.dependencies ?? {})
  if (runtimeDeps.length !== 0) fail(`runtime dependencies must be empty, found: ${runtimeDeps.join(", ")}`)
  const depsJson = JSON.stringify(pkg.dependencies ?? {})
  if (depsJson.includes("workspace:")) fail("workspace:* specifier survived into runtime dependencies")
  ok("package.json: publishable, bin correct, empty runtime deps, no workspace:*")

  // Unpack and validate the actual shipped bundle. Run tar *inside* the work
  // dir with a relative tarball name: a `C:\...` absolute path makes GNU tar
  // treat the drive letter as a remote host. cwd-relative avoids that on every
  // tar flavor.
  execFileSync("tar", ["-xzf", meta.filename], { cwd: work, stdio: "ignore" })
  const shippedBin = join(work, "package", "dist", "index.js")
  if (!existsSync(shippedBin)) fail("dist/index.js missing after unpack")
  const code = readFileSync(shippedBin, "utf8")
  const firstLine = code.split("\n", 1)[0]
  if (firstLine !== "#!/usr/bin/env node") fail(`shebang missing/wrong: ${JSON.stringify(firstLine)}`)
  if (/from\s+["']@mcpguard\//.test(code) || /require\(["']@mcpguard\//.test(code)) {
    fail("bundle has unresolved @mcpguard/* imports — not self-contained")
  }
  ok("shipped dist/index.js has node shebang and is self-contained")

  // 5. Isolated global install + real run. Install the tarball into a throwaway
  //    prefix that shares nothing with the workspace node_modules, then run the
  //    binary it installs from an empty cwd — so a pass proves a *consumer's*
  //    install resolves and runs, not the dev tree. We execute the installed
  //    bin's JS via node for cross-platform determinism (no npm.cmd shim), but
  //    still assert the bin shim file was created so bin wiring is covered.
  const prefix = join(work, "prefix")
  mkdirSync(prefix, { recursive: true })
  runNpm(
    ["install", "-g", tarball, "--prefix", prefix, "--no-audit", "--no-fund"],
    { cwd: work, stdio: "ignore" },
  )

  // npm's global layout differs by platform.
  const installedPkgJson = [
    join(prefix, "node_modules", "@mcpguard", "cli", "package.json"),
    join(prefix, "lib", "node_modules", "@mcpguard", "cli", "package.json"),
  ].find((p) => existsSync(p))
  if (!installedPkgJson) fail("installed package not found under the isolated prefix")
  ok("tarball installs into an isolated prefix")

  const binShim = [
    join(prefix, "mcpguard"),
    join(prefix, "mcpguard.cmd"),
    join(prefix, "bin", "mcpguard"),
  ].find((p) => existsSync(p))
  if (!binShim) fail("mcpguard bin shim was not created on install")
  ok(`bin shim created (${binShim.replace(prefix, "<prefix>")})`)

  const installedBin = join(dirname(installedPkgJson), "dist", "index.js")
  if (!existsSync(installedBin)) fail("installed dist/index.js missing")
  // Run from an empty dir so nothing can resolve back into the repo tree.
  const runDir = join(work, "run")
  mkdirSync(runDir, { recursive: true })
  const blockFixture = join(repoRoot, "packages", "fixtures", "golden", "block-filesystem.json")

  function runInstalled(args) {
    try {
      const stdout = execFileSync(process.execPath, [installedBin, ...args], {
        cwd: runDir,
        encoding: "utf8",
      })
      return { stdout, code: 0 }
    } catch (err) {
      return { stdout: err.stdout ?? "", code: typeof err.status === "number" ? err.status : 1 }
    }
  }

  const help = runInstalled(["--help"])
  if (help.code !== 0 || !help.stdout.includes("USAGE") || !help.stdout.includes("mcpguard")) {
    fail(`--help: expected exit 0 with USAGE/mcpguard, got code ${help.code}`)
  }
  ok("installed mcpguard --help → exit 0, prints usage")

  const scan = runInstalled(["scan", blockFixture, "--no-emoji"])
  if (scan.code !== 0 || !scan.stdout.includes("BLOCK")) {
    fail(`scan (no --ci): expected exit 0 reporting BLOCK, got code ${scan.code}`)
  }
  ok("installed mcpguard scan <block> → exit 0, reports BLOCK")

  const json = runInstalled(["scan", blockFixture, "--json"])
  let parsed
  try {
    parsed = JSON.parse(json.stdout)
  } catch {
    fail("scan --json did not emit valid JSON")
  }
  if (parsed.verdict !== "BLOCK") fail(`scan --json: expected verdict BLOCK, got ${parsed.verdict}`)
  ok("installed mcpguard scan --json → valid JSON, verdict BLOCK")

  const ci = runInstalled(["scan", blockFixture, "--ci", "--no-emoji"])
  if (ci.code !== 30) fail(`scan --ci on BLOCK: expected exit 30, got ${ci.code}`)
  ok("installed mcpguard scan --ci <block> → exit 30")

  console.log("package-smoke: PASS")
} finally {
  rmSync(work, { recursive: true, force: true })
}
