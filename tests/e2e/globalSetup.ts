import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"

// Vitest globalSetup: runs exactly once, in the main process, before any test
// worker is spawned. E2E tests execute the built CLI at apps/cli/dist/index.js.
// Previously each E2E file rebuilt it in its own `beforeAll`; under
// file-parallelism those builds raced and one worker could read a
// half-written dist/index.js (observed as a flaky empty-stdout scan). Building
// once here removes the race while still guaranteeing a fresh artifact in CI,
// where `pnpm test` may run before the build step.
//
// It ALSO brackets the whole run with a git-tracked-file mtime snapshot, so that
// "no test writes a committed artifact" is observed over every test rather than
// over a sampled subset, and throws from the teardown if any tracked file moved.
// mtime is the load-bearing choice: a test that corrupts a committed artifact and
// restores it in `finally` (the 2026-08-28 `deriveFacts` flake) leaves identical
// bytes and a CLEAN `git status`, so only the timestamp survives the restore.
//
// The check lives here, and not in a test, because the only thing that can observe
// the whole run is the process that owns it. Two shapes were tried and rejected:
// a test spawning its own vitest child re-runs the suite it is trying to observe
// (measured 15x slower under full-suite CPU contention, hitting a 900s timeout);
// and a test reading a report this teardown writes would necessarily read the
// PREVIOUS run's file, since teardown runs after every test.
// tests/invariants/committed-artifacts-not-scratch-space.invariants.test.ts guards
// that this code stays in place and keeps its fail direction.
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")
export const SCRATCH_REPORT = join(repoRoot, "node_modules", ".cache", "calllint-scratch-space.json")

/** mtimeMs of every git-tracked file, keyed by repo-relative path. */
function snapshot(): Record<string, number> {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  const snap: Record<string, number> = {}
  for (const rel of out.split("\0")) {
    if (!rel) continue
    try {
      snap[rel] = statSync(join(repoRoot, rel)).mtimeMs
    } catch {
      // Tracked-but-absent (sparse checkout, mid-rebase) is not this guard's subject.
    }
  }
  return snap
}

export default function setup(): () => void {
  const cliDir = join(here, "..", "..", "apps", "cli")
  // Snapshot BEFORE the build: the build writes only gitignored dist/, but taking
  // the baseline first means anything it does touch is attributed, not excused.
  const before = snapshot()

  execFileSync(process.execPath, ["./build.mjs"], { cwd: cliDir, stdio: "ignore" })
  const binary = join(cliDir, "dist", "index.js")
  if (!existsSync(binary)) {
    throw new Error(`e2e globalSetup: build did not produce ${binary}`)
  }

  return function teardown(): void {
    const after = snapshot()
    const touched: string[] = []
    for (const [rel, mtime] of Object.entries(after)) {
      if (!(rel in before)) touched.push(`${rel} (appeared)`)
      else if (before[rel] !== mtime) touched.push(rel)
    }
    for (const rel of Object.keys(before)) if (!(rel in after)) touched.push(`${rel} (vanished)`)
    touched.sort()

    mkdirSync(dirname(SCRATCH_REPORT), { recursive: true })
    writeFileSync(
      SCRATCH_REPORT,
      JSON.stringify({ trackedFiles: Object.keys(before).length, touched }, null, 2) + "\n",
    )

    // Throwing here is the only way this can fail the run it observed. A teardown runs
    // AFTER every test, so a test asserting on the report above would necessarily read the
    // PREVIOUS run's file — a guard lagging its subject by one run is not a guard. The cost
    // of throwing is a run-level error with no test name attached, so the message carries
    // the whole finding itself.
    if (touched.length > 0) {
      throw new Error(
        `Committed artifacts are not scratch space: ${touched.length} git-tracked file(s) were ` +
          `modified during this test run.\n` +
          touched.map((t) => `  - ${t}`).join("\n") +
          `\n\nDetected by mtime, so a test that restores the bytes in \`finally\` is still ` +
          `caught — and \`git status\` will be CLEAN. Write to os.tmpdir() instead; see ` +
          `tests/facts/deriveFacts.test.ts for the sandbox pattern.\n` +
          `Report: ${SCRATCH_REPORT}`,
      )
    }
  }
}
