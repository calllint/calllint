#!/usr/bin/env node
/**
 * Print (or automate when credentialed) brand avatar uploads for GitHub org + npm.
 *
 * GitHub org avatars cannot be uploaded via REST API — use the web UI or Gravatar.
 * npm profile avatars are also web-only unless you use the npm website.
 *
 * Usage:
 *   node scripts/set-brand-avatars.mjs          # print upload checklist + open paths
 *   node scripts/set-brand-avatars.mjs --open   # open upload pages (Windows/macOS/Linux)
 */
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const githubAvatar = join(root, "assets/brand/github-org-avatar.png")
const npmAvatar = join(root, "assets/brand/npm-org-avatar.png")

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

for (const p of [githubAvatar, npmAvatar]) {
  if (!existsSync(p)) {
    fail(`missing ${p} — run: pnpm brand:assets`)
  }
}

const steps = `
CallLint brand avatar upload checklist
======================================

Prepared files (square, ready to upload):
  GitHub org:  ${githubAvatar}
  npm profile: ${npmAvatar}

1) GitHub organization avatar (calllint)
   → https://github.com/organizations/calllint/settings/profile
   → Under profile picture: "Upload new picture"
   → Select: assets/brand/github-org-avatar.png

2) npm publisher avatar (shows beside calllint on npmjs.com)
   → https://www.npmjs.com/settings/profile
   → Avatar → Upload
   → Select: assets/brand/npm-org-avatar.png
   (If calllint is an npm org, use https://www.npmjs.com/settings/calllint/profile instead.)

3) npm package README logo
   → Shipped in the calllint tarball as logo-mark-128.png (no action needed after publish).

Note: GitHub/npm do not expose avatar upload via CLI without browser login.
`

console.log(steps.trim())

if (process.argv.includes("--open")) {
  const urls = [
    "https://github.com/organizations/calllint/settings/profile",
    "https://www.npmjs.com/settings/profile",
  ]
  for (const url of urls) {
    try {
      if (process.platform === "win32") {
        execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore" })
      } else if (process.platform === "darwin") {
        execFileSync("open", [url], { stdio: "ignore" })
      } else {
        execFileSync("xdg-open", [url], { stdio: "ignore" })
      }
    } catch {
      console.log(`Open manually: ${url}`)
    }
  }
}
