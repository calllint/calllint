import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

/**
 * `trust-verify-claims.yml` decides whether to open a PR at all. The step that decides —
 * "Decide whether this refresh carries substance" — is the only thing standing between the
 * operator and a daily PR whose every line is a recomputed clock value (measured on PR #268:
 * 1194 changed lines, 894 `ageDays` + 298 `upstreamAgeDays` + 2 `bakedAt`, zero substantive).
 *
 * So this file EXTRACTS that step's script and RUNS it against throwaway git repos, rather
 * than reading its text. Reading the text is how this repo's guards have failed before: a
 * guard that greps a workflow for a string cannot tell whether the string does anything.
 *
 * The asymmetry under test is the whole point. Suppressing a PR is a decision to show a human
 * NOTHING, so it is only ever correct when the diff is provably inert. Every ambiguous case —
 * an untracked file, a deletion, a path outside the bake, a diff that cannot be read — must
 * resolve to "open the PR". A gate that fails toward silence would hide the very claim change
 * this workflow exists to surface (UNKNOWN is not SAFE).
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "trust-verify-claims.yml")
const STEP_NAME = "Decide whether this refresh carries substance"

/** The named step's `run:` body, dedented. Anchored on the step NAME, not on `set -uo`. */
function extractSubstanceGate(): string {
  const yaml = readFileSync(WORKFLOW, "utf8").replace(/\r\n/g, "\n")
  const at = yaml.indexOf(`- name: ${STEP_NAME}`)
  if (at < 0) {
    throw new Error(
      `the step "${STEP_NAME}" is gone from trust-verify-claims.yml. It is the only thing ` +
        `stopping a daily pure-timestamp PR from arriving with seven unapprovable checks — ` +
        `if it was renamed, update STEP_NAME; do not delete this file.`,
    )
  }
  const runAt = yaml.indexOf("run: |", at)
  const lines = yaml.slice(yaml.indexOf("\n", runAt) + 1).split("\n")
  const body: string[] = []
  for (const line of lines) {
    // The body is indented deeper than the `run:` key; the first shallower non-blank line ends it.
    if (line.trim() !== "" && !line.startsWith("          ")) break
    body.push(line.replace(/^ {10}/, ""))
  }
  const script = body.join("\n").trimEnd()
  if (!script.includes("substantive=")) {
    throw new Error("extracted the step but it no longer sets `substantive` — re-anchor.")
  }
  return script
}

const GATE = extractSubstanceGate()
const tmpRoot = mkdtempSync(join(tmpdir(), "calllint-substance-"))
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }))

const INDEX_JSON = "apps/web/public/trust/index.json"
const CLAIM_STORE = "packages/trust-index/claims/claim-store.json"

/** A baked page shaped like the real one: temporal keys plus content that must not move. */
const baked = (ageDays: number, bakedAt: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      bakedAt,
      cohorts: ["fixtures", "mcp-registry"],
      entries: [
        {
          canonicalName: "mcp-registry/io.github.example-server",
          verdict: "REVIEW",
          freshness: { ageDays, state: "FRESH", cadenceDays: 7 },
          upstreamAgeDays: ageDays + 30,
          ...extra,
        },
      ],
    },
    null,
    2,
  ) + "\n"

interface Run {
  /** exit status of the gate script */
  exit: number
  /** combined stdout+stderr */
  out: string
  /** what the gate wrote to $GITHUB_OUTPUT — the value the `if:` on the PR step reads */
  substantive: boolean | null
}

function runGate(title: string, setup: (dir: string) => void): Run {
  const dir = mkdtempSync(join(tmpRoot, title.replace(/\W/g, "_") + "-"))
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
  mkdirSync(join(dir, "apps", "web", "public", "trust"), { recursive: true })
  mkdirSync(join(dir, "packages", "trust-index", "claims"), { recursive: true })
  writeFileSync(join(dir, INDEX_JSON), baked(0, "2026-08-27T11:02:09.000Z"))
  writeFileSync(join(dir, CLAIM_STORE), JSON.stringify({ records: [] }, null, 2) + "\n")
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir })

  setup(dir)

  // A real $GITHUB_OUTPUT / $GITHUB_STEP_SUMMARY file, so the gate's own `>>` writes land
  // somewhere readable. Asserting on the FILE rather than on stdout is deliberate: the file
  // is what the `if:` expression consumes, and a gate could print the right words while
  // writing the wrong output.
  //
  // They live OUTSIDE the repo under test. Putting them inside it made them untracked files
  // in the tree the gate inspects, and the gate correctly reported "a new file appeared
  // (gh-output)" — a true statement about a fake change, which turned six assertions green
  // for the wrong reason and red for the right one. The harness must not be part of the
  // subject it observes.
  const ioDir = mkdtempSync(join(tmpRoot, "io-"))
  const outFile = join(ioDir, "gh-output")
  const sumFile = join(ioDir, "gh-summary")
  writeFileSync(outFile, "")
  writeFileSync(sumFile, "")

  let out = ""
  let exit = 0
  try {
    out = execFileSync("bash", ["-c", GATE], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: sumFile },
    })
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    exit = err.status ?? 1
    out = (err.stdout ?? "") + (err.stderr ?? "")
  }

  const written = readFileSync(outFile, "utf8")
  const m = written.match(/substantive=(true|false)/)
  return { exit, out, substantive: m ? m[1] === "true" : null }
}

const stage = (dir: string) => execFileSync("git", ["add", "-A"], { cwd: dir })

/** Both index states create-pull-request commits from. The gate must see each. */
const INDEX_STATES: Array<[string, (d: string) => void]> = [
  ["unstaged", () => {}],
  ["staged", stage],
]

describe("claim-refresh substance gate — a PR is opened only for something reviewable", () => {
  it("the gate never exits non-zero: it decides, it does not fail the job", () => {
    // The verify + bake + copy-guard steps already ran and passed by this point. Turning a
    // "nothing to review" verdict into a red run would be the exact anti-pattern this change
    // removes — an operator taught to ignore the colour.
    const r = runGate("clean", () => {})
    expect(r.exit).toBe(0)
  })

  it("a clean tree opens nothing", () => {
    const r = runGate("clean-tree", () => {})
    expect(r.substantive).toBe(false)
    expect(r.out).toMatch(/no diff at all/)
  })

  describe.each(INDEX_STATES)("with the change %s", (_state, apply) => {
    it("a pure ageDays / upstreamAgeDays / bakedAt diff is suppressed — PR #268's exact shape", () => {
      const r = runGate("temporal-only", (d) => {
        writeFileSync(join(d, INDEX_JSON), baked(2, "2026-08-30T09:58:17.726Z"))
        apply(d)
      })
      expect(r.substantive, "every changed line is recomputed from the wall clock").toBe(false)
      expect(r.out).toMatch(/suppressed/)
    })

    it("suppression is PRINTED, so a quiet run cannot pass for no claim activity", () => {
      const r = runGate("suppression-visible", (d) => {
        writeFileSync(join(d, INDEX_JSON), baked(2, "2026-08-30T09:58:17.726Z"))
        apply(d)
      })
      expect(r.out).toMatch(/ageDays/)
      expect(r.out).toMatch(/no claim change/)
    })

    it("a claim-store change opens a PR — the substance the job exists to find", () => {
      const r = runGate("claim-store", (d) => {
        writeFileSync(
          join(d, CLAIM_STORE),
          JSON.stringify({ records: [{ canonicalName: "x", status: "active" }] }, null, 2) + "\n",
        )
        apply(d)
      })
      expect(r.substantive).toBe(true)
      expect(r.out).toMatch(/claim store changed/)
    })

    it("a verdict change alongside the timestamps opens a PR", () => {
      // The failure that matters: a real change RIDING ALONG with churn. A gate that decided
      // on the diff's dominant shape, or on a line count, would suppress this.
      const r = runGate("verdict-with-churn", (d) => {
        const bumped = baked(2, "2026-08-30T09:58:17.726Z").replace('"REVIEW"', '"BLOCK"')
        writeFileSync(join(d, INDEX_JSON), bumped)
        apply(d)
      })
      expect(r.substantive, "a verdict moved — this must never be suppressed").toBe(true)
      expect(r.out).toMatch(/outside the clock-derived keys/)
    })

    it("a verifiedPublisher flag landing opens a PR — the flag this workflow exists to stamp", () => {
      const r = runGate("verified-publisher", (d) => {
        writeFileSync(
          join(d, INDEX_JSON),
          baked(2, "2026-08-30T09:58:17.726Z", { verifiedPublisher: true }),
        )
        apply(d)
      })
      expect(r.substantive).toBe(true)
    })

    it("a moved `observedAt` opens a PR — a stored instant is an observation, not a clock read", () => {
      // `observedAt` / `at` are deliberately NOT in the temporal set: if one moves, something
      // was observed. Only values recomputed from `now` alone may be suppressed.
      const r = runGate("observed-at", (d) => {
        writeFileSync(
          join(d, INDEX_JSON),
          baked(2, "2026-08-30T09:58:17.726Z", { observedAt: "2026-08-30T09:00:00.000Z" }),
        )
        apply(d)
      })
      expect(r.substantive).toBe(true)
    })

    it("a changed cadenceDays opens a PR — policy is not the clock", () => {
      const r = runGate("cadence", (d) => {
        writeFileSync(
          join(d, INDEX_JSON),
          baked(2, "2026-08-30T09:58:17.726Z").replace('"cadenceDays": 7', '"cadenceDays": 14'),
        )
        apply(d)
      })
      expect(r.substantive).toBe(true)
    })

    it("a MODIFIED file outside the baked pages opens a PR, whatever it contains", () => {
      // Committed first, then edited, so `git status` reports a concrete tracked path and the
      // PATH-SCOPE branch is what fires. Left untracked instead, git collapses the directory
      // to `?? scripts/` and the new-file branch wins first — the right verdict via a
      // different route, which is asserted separately below.
      const r = runGate("stray-source", (d) => {
        mkdirSync(join(d, "scripts"), { recursive: true })
        writeFileSync(join(d, "scripts", "gate-s0.ts"), "const S0_REGRESSION_FLOOR = 100\n")
        stage(d)
        execFileSync("git", ["commit", "-qm", "add source"], { cwd: d })
        writeFileSync(join(d, "scripts", "gate-s0.ts"), "const S0_REGRESSION_FLOOR = 250\n")
        apply(d)
      })
      expect(r.substantive, "a bot editing source must always reach a human").toBe(true)
      expect(r.out).toMatch(/outside the baked pages/)
    })

    it("an UNTRACKED file outside the baked pages opens a PR", () => {
      const r = runGate("stray-source-new", (d) => {
        mkdirSync(join(d, "scripts"), { recursive: true })
        writeFileSync(join(d, "scripts", "gate-s0.ts"), "const S0_REGRESSION_FLOOR = 100\n")
        apply(d)
      })
      expect(r.substantive, "a bot writing source must always reach a human").toBe(true)
    })

    it("a DELETED baked page opens a PR — a removal is never clock churn", () => {
      const r = runGate("deletion", (d) => {
        rmSync(join(d, INDEX_JSON))
        apply(d)
      })
      expect(r.substantive).toBe(true)
      expect(r.out).toMatch(/deleted/)
    })
  })

  it("an UNTRACKED new page opens a PR — invisible to `git diff`, which is why status is used", () => {
    // The trust-ingest guard was rewritten for exactly this: `git diff` compares against the
    // INDEX, so an untracked file is invisible to it while create-pull-request commits it.
    const r = runGate("untracked", (d) => {
      writeFileSync(join(d, "apps", "web", "public", "trust", "new-cohort.json"), "{}\n")
    })
    expect(r.substantive).toBe(true)
    expect(r.out).toMatch(/new file appeared/)
  })

  it("a new page that is untracked AND staged still opens a PR", () => {
    const r = runGate("untracked-staged", (d) => {
      writeFileSync(join(d, "apps", "web", "public", "trust", "new-cohort.json"), "{}\n")
      stage(d)
    })
    expect(r.substantive).toBe(true)
  })

  it("the temporal key set is NARROW — it must not grow into a wildcard", () => {
    // A gate whose suppression list grows can suppress anything. Pinned by name so widening
    // it is a deliberate, reviewed edit rather than a quiet one.
    const keys = GATE.match(/TEMPORAL='"\(([^)]+)\)":'/)?.[1]
    expect(keys, "the TEMPORAL declaration moved — re-anchor this assertion").toBeTruthy()
    expect(String(keys).split("|").sort()).toEqual(["ageDays", "bakedAt", "upstreamAgeDays"])
  })

  it("the PR step is actually gated on this decision", () => {
    // The gate could be perfect and wired to nothing. This asserts the `if:` exists on the
    // create-pull-request step and reads THIS step's output.
    const yaml = readFileSync(WORKFLOW, "utf8").replace(/\r\n/g, "\n")
    const prAt = yaml.indexOf("uses: peter-evans/create-pull-request@v7")
    expect(prAt, "the PR step is gone").toBeGreaterThan(-1)
    const stepStart = yaml.lastIndexOf("- name:", prAt)
    const block = yaml.slice(stepStart, prAt)
    expect(block).toMatch(/if:\s*steps\.substance\.outputs\.substantive == 'true'/)
  })

  it("every bot PR falls back to GITHUB_TOKEN when the PAT secret is absent", () => {
    // The PAT exists to make the PR's checks RUN. But `token:` with an unset secret resolves to
    // the empty string, and create-pull-request then fails the step — turning a missing
    // credential into a claim change that never reaches a human. The `|| secrets.GITHUB_TOKEN`
    // is what keeps that failure mode out, so it is pinned rather than left to a reviewer's eye.
    //
    // Both refresh workflows, because they share the branch-and-PR shape and a PAT rolled for
    // one is rolled for both.
    for (const wf of ["trust-verify-claims.yml", "trust-ingest.yml"]) {
      const yaml = readFileSync(join(REPO_ROOT, ".github", "workflows", wf), "utf8")
      const prAt = yaml.indexOf("uses: peter-evans/create-pull-request@v7")
      expect(prAt, `${wf}: the PR step is gone`).toBeGreaterThan(-1)
      const token = yaml.slice(prAt).match(/token:\s*\$\{\{([^}]+)\}\}/)?.[1]
      expect(token, `${wf}: the PR step passes no token: — its checks will park unrun`).toBeTruthy()
      expect(String(token).replace(/\s+/g, " ").trim()).toBe(
        "secrets.TRUST_BOT_PAT || secrets.GITHUB_TOKEN",
      )
    }
  })

  it("the PAT is not the GitHub App credential — metadata:read stays the App's ceiling", () => {
    // A tempting shortcut is to reuse CALLLINT_APP_PRIVATE_KEY here, which would require adding
    // contents+pull_requests write to the App manifest — barred by
    // packages/trust-index/test/github-app.test.ts and by ADR 0048 §3. Asserted here so the
    // shortcut is caught in the workflow, not only in the manifest.
    for (const wf of ["trust-verify-claims.yml", "trust-ingest.yml"]) {
      const yaml = readFileSync(join(REPO_ROOT, ".github", "workflows", wf), "utf8")
      const prBlock = yaml.slice(yaml.indexOf("uses: peter-evans/create-pull-request@v7"))
      expect(prBlock, `${wf}: the App key is being used to open PRs`).not.toMatch(
        /CALLLINT_APP_PRIVATE_KEY/,
      )
    }
  })
})
