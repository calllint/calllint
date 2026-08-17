/**
 * The serving plane's executable code must have a typechecker — and it must be THIS one.
 *
 * WHY THIS FILE EXISTS. `apps/web/functions/**` sat outside the root tsconfig's `include`
 * (`apps/*&#47;src/**&#47;*.ts`), so the three Pages Functions had no compile-time observer at all. That was
 * measured, not inferred: appending `const x: number = "string"` to the I2a adapter left
 * `pnpm typecheck` at EXIT 0. A Pages Function also gets no runtime observation short of a deploy,
 * so the two absences compounded into this repo's dominant fault class — a guard that cannot see its
 * subject.
 *
 * `apps/web/functions/tsconfig.json` closes it. This file guards the closure, because the fix has
 * exactly one silent failure mode: the config keeps passing while it stops *covering* something. A
 * narrowed `include`, a moved file, or a new function added beside the existing three would each
 * leave `tsc` at EXIT 0 having checked less than it should. So the covered set is derived from disk
 * and compared against the config's actual file list — never against a hardcoded list of three
 * names, which is the shape ADR 0089 D2 rejects.
 *
 * The premise block asserts the INSTRUMENT: that this test can still find the functions and the
 * config, so the coverage assertions below cannot pass for want of a subject.
 */
import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolve, dirname, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, "..", "..")
const FUNCTIONS_DIR = resolve(ROOT, "apps", "web", "functions")
const FUNCTIONS_TSCONFIG = resolve(FUNCTIONS_DIR, "tsconfig.json")

/** Every `.ts` file under the functions dir, found by walking it — not by naming them. */
function functionSources(dir: string = FUNCTIONS_DIR, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    if (statSync(full).isDirectory()) {
      functionSources(full, acc)
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      acc.push(full)
    }
  }
  return acc
}

/** The files tsc itself reports for a project — the config's real coverage, not its stated intent. */
function filesSeenByProject(tsconfigPath: string): string[] {
  const out = execFileSync(
    process.execPath,
    [resolve(ROOT, "node_modules", "typescript", "lib", "tsc.js"), "-p", tsconfigPath, "--listFiles", "--noEmit"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".ts"))
    .map((l) => resolve(l))
}

const norm = (p: string) => relative(ROOT, p).split(sep).join("/")

describe("the premise: this test can still see its subjects (the instrument, not the behaviour)", () => {
  it("finds the functions directory and at least the three known Pages Functions", () => {
    const found = functionSources().map(norm)
    // A floor, not an equality: new functions are expected, disappearance is not.
    expect(found.length).toBeGreaterThanOrEqual(3)
    for (const known of [
      "apps/web/functions/trust/_middleware.ts",
      "apps/web/functions/v1/events/trust.ts",
      "apps/web/functions/v1/public/[[path]].ts",
    ]) {
      expect(found, `${known} must still be discoverable — if it moved, update this guard`).toContain(known)
    }
  })

  it("finds the functions tsconfig, and it is a separate project from the root", () => {
    const cfg = JSON.parse(readFileSync(FUNCTIONS_TSCONFIG, "utf8"))
    expect(cfg.compilerOptions?.noEmit).toBe(true)
    // DOM is the reason this is separate: the root project must NOT gain it.
    expect(cfg.compilerOptions?.lib).toContain("DOM")
    const rootCfg = JSON.parse(readFileSync(resolve(ROOT, "tsconfig.json"), "utf8"))
    expect(
      (rootCfg.compilerOptions?.lib ?? []).includes("DOM"),
      "the root project must stay DOM-free, or fetch-shaped mistakes typecheck in Node packages",
    ).toBe(false)
  })
})

describe("every Pages Function is covered by a typechecker (the gap this closes)", () => {
  it("checks every .ts file under apps/web/functions, with none left unobserved", () => {
    const onDisk = functionSources().map(norm).sort()
    const seen = new Set(filesSeenByProject(FUNCTIONS_TSCONFIG).map(norm))
    const unobserved = onDisk.filter((f) => !seen.has(f))
    expect(
      unobserved,
      `these Pages Functions have NO typechecker — a type error in them would not fail the build: ${unobserved.join(", ")}`,
    ).toEqual([])
  })

  it("is reachable from `pnpm typecheck`, so CI runs it without a workflow edit", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"))
    const typecheck: string = pkg.scripts?.typecheck ?? ""
    expect(typecheck).toMatch(/typecheck:functions/)
    expect(pkg.scripts?.["typecheck:functions"] ?? "").toMatch(/apps\/web\/functions\/tsconfig\.json/)
  })

  it("the root project still does NOT cover them, which is why the separate project must exist", () => {
    // If the root config ever grows to include them, this guard's premise changes and the
    // separate project may be redundant. Fail loudly rather than keep a stale second source.
    const rootCfg = JSON.parse(readFileSync(resolve(ROOT, "tsconfig.json"), "utf8"))
    const include: string[] = rootCfg.include ?? []
    expect(
      include.some((p) => p.includes("functions")),
      "the root tsconfig now mentions functions — reconcile the two projects instead of running both",
    ).toBe(false)
  })
})
