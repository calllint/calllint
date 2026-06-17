#!/usr/bin/env node
/** Point this repo at .githooks/ so prepare-commit-msg strips AI attribution. */
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const hook = join(root, ".githooks", "prepare-commit-msg")

if (!existsSync(hook)) {
  console.error("Missing .githooks/prepare-commit-msg")
  process.exit(1)
}

try {
  chmodSync(hook, 0o755)
} catch {
  // Windows may ignore chmod; Git Bash still runs the hook if +x is set in index.
}

execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: root,
  stdio: "inherit",
})

console.log("Git hooks: core.hooksPath=.githooks (AI attribution will be stripped from commits)")
