import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { existsSync } from "node:fs"

// Vitest globalSetup: runs exactly once, in the main process, before any test
// worker is spawned. E2E tests execute the built CLI at apps/cli/dist/index.js.
// Previously each E2E file rebuilt it in its own `beforeAll`; under
// file-parallelism those builds raced and one worker could read a
// half-written dist/index.js (observed as a flaky empty-stdout scan). Building
// once here removes the race while still guaranteeing a fresh artifact in CI,
// where `pnpm test` may run before the build step.
export default function setup(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const cliDir = join(here, "..", "..", "apps", "cli")
  execFileSync(process.execPath, ["./build.mjs"], { cwd: cliDir, stdio: "ignore" })
  const binary = join(cliDir, "dist", "index.js")
  if (!existsSync(binary)) {
    throw new Error(`e2e globalSetup: build did not produce ${binary}`)
  }
}
