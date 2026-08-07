import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// The R-9 worker deployment units (ADR 0061 §8.5). These bytes are consumed by systemd on
// the worker host, and nothing else in the repo reads them — which is precisely why they
// need a gate here. Every other pin in `.gitattributes` protects a byte that some drift
// test already compares; this directory has no such reader, so a regression in it would
// surface at deploy time on a host no CI job of ours watches.
//
// Two distinct failure modes are measured, because they fail in the same place but for
// unrelated reasons:
//   1. Line endings. `deploy/** text eol=lf` is pinned, but a pin no gate reads is itself
//      unguarded. A CRLF checkout makes the last token of every line carry a trailing \r,
//      so `ExecStart=/usr/bin/pnpm prune:cas` asks systemd to run a binary whose name ends
//      in \r. This asserts the CONSEQUENCE of the pin rather than trusting it, the same way
//      store-schema.test.ts does for the migrations pin.
//   2. Script existence. The unit invokes three `pnpm` scripts by name. Nothing verified
//      they exist: a rename or typo in package.json leaves the unit pointing at a script
//      that resolves to "command not found" mid-run, after the earlier ExecStart steps have
//      already mutated the store.
const repoRoot = new URL("../../", import.meta.url)
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, repoRoot)), "utf8")

const UNIT = "deploy/adoption-index/calllint-adoption-worker.service"
const TIMER = "deploy/adoption-index/calllint-adoption-worker.timer"

describe("R-9 worker deployment units", () => {
  it.each([UNIT, TIMER])("%s is LF-only with a trailing newline", (rel) => {
    const bytes = read(rel)
    // Named rather than `.every()`/`not.toContain`: on failure this prints WHICH line holds
    // the \r, which is the whole diagnostic value when a checkout filter is the suspect.
    const withCr = bytes.split("\n").flatMap((line, i) => (line.includes("\r") ? [`${i + 1}: ${JSON.stringify(line)}`] : []))
    expect(withCr).toEqual([])
    expect(bytes.endsWith("\n")).toBe(true)
    expect(bytes.trim().length).toBeGreaterThan(0)
  })

  it("invokes only pnpm scripts that exist in the root package.json", () => {
    const unit = read(UNIT)
    const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}

    // Parse what systemd will parse: every ExecStart line, in order.
    const execStarts = unit
      .split("\n")
      .filter((line) => line.startsWith("ExecStart="))
      .map((line) => line.slice("ExecStart=".length).trim())

    // Vacuity guard. An empty list would make every assertion below trivially true, so a
    // unit that lost its ExecStart lines entirely must fail here rather than pass silently.
    expect(execStarts.length).toBeGreaterThanOrEqual(3)

    const invoked = execStarts.flatMap((cmd) => {
      const m = /^\S*pnpm\s+(\S+)$/.exec(cmd)
      return m?.[1] === undefined ? [] : [m[1]]
    })
    // Every ExecStart is expected to be a pnpm script invocation; if one stops matching the
    // shape above it silently drops out of `invoked` and goes unchecked.
    expect(invoked.length).toBe(execStarts.length)

    const missing = invoked.filter((name) => scripts[name] === undefined)
    expect(missing).toEqual([])
  })

  it("does not set ADOPTION_INDEX_CWD, which would desynchronize the sweep from the writer", () => {
    // The two steps do not share root-resolution logic, and that asymmetry is the hazard.
    // refreshSnapshot.ts:276 reads a bare `process.cwd()`; pruneCas.ts reads
    // `ADOPTION_INDEX_CWD ?? process.cwd()`, because it needs a test seam. Setting that variable
    // in the unit therefore moves ONLY the sweep, which would have it delete from a tree the
    // ingest step never writes to — reporting a healthy `inspected`/`deleted` count for the wrong
    // directory while the real CAS keeps growing. Failing loudly on an absent tree cannot catch
    // that: the decoy root would exist. `WorkingDirectory` is the correct single lever, and it is
    // shared by every ExecStart, so pin the safe shape rather than relying on remembering it.
    const unit = read(UNIT)
    const envLines = unit.split("\n").filter((line) => line.startsWith("Environment="))
    expect(envLines.filter((line) => line.includes("ADOPTION_INDEX_CWD"))).toEqual([])
    // Vacuity guard: the assertion above is trivially true on a unit with no Environment= lines
    // at all, which is also a unit that lost its retention window.
    expect(envLines.some((line) => line.includes("CAS_RETENTION_DAYS"))).toBe(true)
    expect(unit).toMatch(/^WorkingDirectory=\S+$/m)
  })

  it("runs the CAS retention sweep last, after ingest and projection", () => {
    // Order is load-bearing, not cosmetic: the sweep deletes by mtime, so running it BEFORE
    // the projection could reclaim a blob the projection was about to read. Type=oneshot runs
    // ExecStart lines sequentially and aborts the rest on a non-zero exit, so "last" also
    // means a failed ingest never reaches the deletion step.
    const execStarts = read(UNIT)
      .split("\n")
      .filter((line) => line.startsWith("ExecStart="))
      .map((line) => line.slice("ExecStart=".length).trim())

    expect(execStarts.at(-1)).toMatch(/pnpm\s+prune:cas$/)
    expect(execStarts.filter((c) => /prune:cas$/.test(c))).toHaveLength(1)
    expect(read(UNIT)).toContain("Type=oneshot")
  })
})
