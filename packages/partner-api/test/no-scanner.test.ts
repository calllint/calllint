import { describe, it, expect } from "vitest"
import { readFile, readdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, "..")

// Packages that can resolve/fetch/scan/execute — none may enter the serving
// deployable (ADR 0046 §4: "no scanner in the deployable", made structural).
const SCANNER_PKGS = [
  "@calllint/core",
  "@calllint/static-analyzer",
  "@calllint/resolver",
  "@calllint/risk-engine",
  "@calllint/flow-analyzer",
  "@calllint/online",
  "@calllint/evidence",
  "@calllint/discovery",
  "@calllint/config-parser",
  "@calllint/install-planner",
  "@calllint/signature",
  "@calllint/fixtures",
  "@calllint/trust-index",
]

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, d.name)
    if (d.isDirectory()) out.push(...(await walk(p)))
    else if (d.name.endsWith(".ts")) out.push(p)
  }
  return out
}

describe("partner-api is scanner-free (ADR 0046 §4, ADR 0038 §3)", () => {
  it("declares no scanner package as a dependency", async () => {
    const pkg = JSON.parse(await readFile(resolve(pkgRoot, "package.json"), "utf8"))
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    for (const s of SCANNER_PKGS) expect(deps, `dep on ${s}`).not.toContain(s)
    // The one allowed dep is the shared type vocabulary (no runtime engine).
    expect(pkg.dependencies).toEqual({ "@calllint/types": "workspace:*" })
  })

  it("imports no scanner package anywhere in src", async () => {
    const files = await walk(resolve(pkgRoot, "src"))
    for (const f of files) {
      const text = await readFile(f, "utf8")
      for (const s of SCANNER_PKGS) {
        expect(text.includes(`"${s}"`) || text.includes(`'${s}'`), `${f} imports ${s}`).toBe(false)
      }
    }
  })
})
