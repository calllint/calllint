import { build } from "esbuild"
import { copyFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const logoSrc = join(root, "assets/brand/logo-mark-128.png")
const logoDest = join(dirname(fileURLToPath(import.meta.url)), "logo-mark-128.png")
await mkdir(dirname(logoDest), { recursive: true })
await copyFile(logoSrc, logoDest)

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  logLevel: "info",
})

console.log("built apps/cli → dist/index.js")
