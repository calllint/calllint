import { copyFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const app = dirname(fileURLToPath(import.meta.url))
const root = join(app, "..", "..", "..")
const brand = join(root, "assets", "brand")
const pub = join(app, "..", "public")

const files = [
  ["favicon-32.png", "favicon.png"],
  ["logo-mark-128.png", "logo-mark-128.png"],
  ["logo-mark-256.png", "logo-mark-256.png"],
  ["logo-og-512.png", "og-image.png"],
  ["logo-mark-256.png", "logo.png"],
]

await mkdir(pub, { recursive: true })
for (const [src, dest] of files) {
  await copyFile(join(brand, src), join(pub, dest))
}

// The L0 token plane (Workstream P PR P-4b). Authored in apps/web/styles/ — outside
// public/ — and copied in, so the served tree stays a build OUTPUT: the same split the
// brand images above use. Editing the served copy directly is what this arrangement is
// meant to make pointless, and the presentation lock byte-compares the two so a
// hand-edit under public/ fails CI instead of silently becoming the served bytes.
//
// mkdir with recursive is required and not incidental: this is the first synced asset
// that lands in a SUBDIRECTORY of public/, so on a clean checkout the destination
// directory does not exist and copyFile alone would throw ENOENT.
const styles = [["tokens.css", join("styles", "tokens.css")]]
for (const [src, dest] of styles) {
  await mkdir(join(pub, dirname(dest)), { recursive: true })
  await copyFile(join(app, "..", "styles", src), join(pub, dest))
}

// ADR 0059 — copy-only assist. Authored outside public/, synced in (same split as tokens).
const scripts = [["install-copy.js", join("scripts", "install-copy.js")]]
for (const [src, dest] of scripts) {
  await mkdir(join(pub, dirname(dest)), { recursive: true })
  await copyFile(join(app, src), join(pub, dest))
}

console.log(
  `synced ${files.length} brand asset(s) + ${styles.length} stylesheet(s) + ${scripts.length} script(s) → apps/web/public`,
)
