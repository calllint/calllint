/**
 * The committed-tree reproducibility gate (ADR 0046 §4).
 *
 * The baked pages under `packages/trust-index/baked/` are committed artifacts. This
 * test re-runs the PURE emit and asserts every committed file is byte-identical to a
 * fresh bake. If someone changes the engine, a fixture, or the renderer without
 * re-running `pnpm --filter @calllint/trust-index bake`, this fails — the same
 * guarantee a CI `git diff --exit-code` would give, expressed as a unit test so it
 * runs in the normal suite on all three OSes.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { emitFixtureCohort } from "../src/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const BAKED = resolve(here, "..", "baked")

describe("committed baked tree matches a fresh emit (reproducibility gate)", () => {
  const { files } = emitFixtureCohort()

  it("has a non-trivial number of committed files", () => {
    expect(files.length).toBeGreaterThanOrEqual(20)
  })

  for (const f of files) {
    it(`committed ${f.path} is byte-identical to a fresh bake`, () => {
      const abs = join(BAKED, f.path)
      expect(
        existsSync(abs),
        `missing committed artifact ${f.path} — run \`pnpm --filter @calllint/trust-index bake\``,
      ).toBe(true)
      const onDisk = readFileSync(abs, "utf8")
      expect(
        onDisk,
        `${f.path} is stale — re-run the bake and commit the result`,
      ).toBe(f.content)
    })
  }
})
