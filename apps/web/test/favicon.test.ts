import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

// Run the production build script in a minimal isolated checkout. Never delete
// or corrupt tracked public assets: the suite observes their mtimes as well.
function withBuild(run: (script: string, icon: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "calllint-favicon-build-"))
  try {
    for (const path of ["assets/brand", "apps/web/scripts", "apps/web/styles"]) {
      const source = fileURLToPath(new URL(`../../../${path}`, import.meta.url))
      mkdirSync(join(root, path, ".."), { recursive: true })
      cpSync(source, join(root, path), { recursive: true })
    }
    run(join(root, "apps/web/scripts/sync-assets.mjs"), join(root, "apps/web/public/favicon.ico"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function build(script: string) {
  execFileSync(process.execPath, [script], { stdio: "pipe", timeout: 15_000 })
}

it("the real web build recreates missing or corrupt icons with deterministic bytes", () => {
  withBuild((script, icon) => {
    const expected = readFileSync(fileURLToPath(new URL("../public/favicon.ico", import.meta.url)))
    expect(existsSync(icon)).toBe(false)
    build(script)
    expect(readFileSync(icon)).toEqual(expected)
    writeFileSync(icon, "corrupt icon")
    build(script)
    expect(readFileSync(icon)).toEqual(expected)
    build(script)
    expect(readFileSync(icon)).toEqual(expected)
  })
})

it("a successful build without the icon writer is detected (negative control)", () => {
  withBuild((script, icon) => {
    const source = readFileSync(script, "utf8")
    const mutant = source.replace(/^await writeFile\(join\(pub, "favicon\.ico"\).*$/m, "")
    expect(mutant).not.toBe(source)
    writeFileSync(script, mutant)
    build(script)
    expect(existsSync(icon)).toBe(false)
  })
})

it("the browser fallback is a valid ICO containing the canonical 32px brand PNG", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)))
  const ico = read("../public/favicon.ico")
  const png = read("../../../assets/brand/favicon-32.png")
  expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0])
  expect([...ico.subarray(6, 10)]).toEqual([32, 32, 0, 0])
  expect(ico.readUInt16LE(10)).toBe(1)
  expect(ico.readUInt16LE(12)).toBe(32)
  expect(ico.readUInt32LE(14)).toBe(png.length)
  expect(ico.readUInt32LE(18)).toBe(22)
  expect(ico.subarray(22)).toEqual(png)
  expect(read("../public/favicon.png")).toEqual(png)
})
