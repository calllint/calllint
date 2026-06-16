import { copyFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const brand = join(root, "assets", "brand")
const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public")

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
console.log("synced brand assets → apps/web/public")
