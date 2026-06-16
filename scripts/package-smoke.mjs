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
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs"
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

  console.log("package-smoke: PASS")
} finally {
  rmSync(work, { recursive: true, force: true })
}
