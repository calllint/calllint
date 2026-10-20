/**
 * The release ancestry gate must not buffer an entire GitHub commit response.
 *
 * The commit endpoint includes the changed-file list by default. A generated Trust release
 * can make that response larger than Node's execFileSync default stdout limit, which used to
 * turn a valid ancestry check into ENOBUFS. This test supplies a deliberately oversized
 * response whenever the caller omits --jq; the real gate therefore passes only when it asks
 * gh to project the small objects it actually consumes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, "..", "..")
const SCRIPT = resolve(ROOT, "scripts", "verify-release-ancestry.mjs")
const BASE_SHA = "1111111111111111111111111111111111111111"
const SIDE_SHA = "2222222222222222222222222222222222222222"

let stubDir: string

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), "calllint-release-ancestry-gh-"))
  writeFileSync(
    join(stubDir, "preload.cjs"),
    `const childProcess = require("node:child_process")
const realExecFileSync = childProcess.execFileSync
childProcess.execFileSync = function (file, args, options = {}) {
  if (file !== "gh") return realExecFileSync.call(this, file, args, options)

  const jqIndex = args.indexOf("--jq")
  let output
  const filter = jqIndex === -1 ? "" : args[jqIndex + 1] ?? ""
  const apiPath = args[args.indexOf("api") + 1] ?? ""
  if (filter === "{sha}") {
    output = JSON.stringify({ sha: ${JSON.stringify(BASE_SHA)} })
  } else if (filter === "{status,ahead_by,behind_by}" && apiPath.endsWith(${JSON.stringify(SIDE_SHA)})) {
    output = JSON.stringify({ status: "ahead", ahead_by: 1, behind_by: 0 })
  } else if (filter === "{status,ahead_by,behind_by}") {
    output = JSON.stringify({ status: "identical", ahead_by: 0, behind_by: 0 })
  } else {
    // Missing or widened projections must behave like the default oversized GitHub payload.
    output = JSON.stringify({
      sha: ${JSON.stringify(BASE_SHA)},
      files: Array.from({ length: 50000 }, (_, i) => ({
        filename: "generated/trust-page-" + i + ".html",
        patch: "x".repeat(80),
      })),
    })
  }

  const maxBuffer = options.maxBuffer ?? 1024 * 1024
  if (jqIndex === -1 && Buffer.byteLength(output) <= maxBuffer) {
    throw new Error("regression fixture must exceed execFileSync's default stdout buffer")
  }
  if (Buffer.byteLength(output) > maxBuffer) {
    const error = new Error("spawnSync gh ENOBUFS")
    error.code = "ENOBUFS"
    error.stderr = Buffer.alloc(0)
    throw error
  }
  return options.encoding ? output : Buffer.from(output, "utf8")
}
require("node:module").syncBuiltinESMExports()
`,
  )
})

afterAll(() => rmSync(stubDir, { recursive: true, force: true }))

describe("release ancestry response budget", () => {
  it("projects large GitHub responses before they reach Node", () => {
    const env = {
      ...process.env,
      CALLLINT_REPO: "fixture/large-commit",
      GITHUB_REF_NAME: "fixture-tag",
    }

    const output = execFileSync(
      process.execPath,
      ["--require", join(stubDir, "preload.cjs"), SCRIPT, "--sha", BASE_SHA, "--base", "main"],
      { cwd: ROOT, env, encoding: "utf8", maxBuffer: 64 * 1024 },
    )

    expect(output).toContain("PASS:")
    expect(output).toContain("status=identical")
    expect(output).toContain(`main tip is ${BASE_SHA}`)
  })

  it("still rejects a commit that the base branch does not contain", () => {
    let exitCode = 0
    let output = ""
    try {
      output = execFileSync(
        process.execPath,
        ["--require", join(stubDir, "preload.cjs"), SCRIPT, "--sha", SIDE_SHA, "--base", "main"],
        {
          cwd: ROOT,
          env: { ...process.env, CALLLINT_REPO: "fixture/large-commit" },
          encoding: "utf8",
          maxBuffer: 64 * 1024,
        },
      )
    } catch (err: unknown) {
      const failure = err as { status?: number; stdout?: string; stderr?: string }
      exitCode = failure.status ?? -1
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`
    }

    expect(exitCode, "an unmerged commit must keep the gate closed").toBe(1)
    expect(output).toContain("NOT reachable from main")
    expect(output).toContain("ahead_by=1")
  })
})
