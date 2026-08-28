import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

/**
 * The 21 assertions in private-usage-deploy-gate.invariants.test.ts read the retry loop's
 * TEXT. Text is not behaviour: the shipped loop could invert a condition and every one of
 * them would stay green. This file closes that by EXTRACTING the shipped block from
 * usage-report.yml and RUNNING it under a stubbed curl.
 *
 * It exists because the first proof that the retry worked was /d/tmp/loop.sh — a hand-copied
 * reimplementation of the loop, in a scratch directory, run once. A harness that reimplements
 * its subject cannot notice the subject changing, and one outside the repo never runs again.
 * Both are the repo's dominant fault class (a guard that cannot observe its subject), so the
 * fix for the probe is not complete until its own proof lives here and reads the real bytes.
 */

// `.pathname.slice(1)` is a Windows-only spelling — see the file-url note in memory.
const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..")
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "usage-report.yml")

/** The shipped probe's retry+verdict region, dedented, with `$DEPLOYMENT_URL` left intact. */
function extractProbeBlock(): string {
  const yaml = readFileSync(WORKFLOW, "utf8").replace(/\r\n/g, "\n")
  // Anchored on `attempts=`, NOT on `attempts=6`: retuning the window is a legitimate change,
  // and an extractor keyed to the literal value turns that into a whole-file collection error
  // instead of an assertion. The count is DERIVED below (ADR 0089 D2 / 0090) so the tests
  // still measure the real bound whatever it is set to.
  const start = yaml.search(/^ {12}attempts=\d+$/m)
  const endAnchor = yaml.indexOf("            esac", start)
  if (start < 0 || endAnchor < 0) {
    throw new Error(
      "could not locate the retry+verdict region in usage-report.yml. This extractor is " +
        "anchored on an `attempts=<n>` assignment and the closing `esac`; if the probe was " +
        "legitimately restructured, re-anchor it — do NOT delete this file, or the retry " +
        "loses its only behavioural reader.",
    )
  }
  const region = yaml.slice(start, endAnchor + "            esac".length)
  return region
    .split("\n")
    .map((l) => l.replace(/^ {12}/, ""))
    .join("\n")
}

const PROBE = extractProbeBlock()

/** The shipped window size, read from the block itself rather than restated here. */
const ATTEMPTS = Number(/^attempts=(\d+)$/m.exec(PROBE)?.[1])

const tmpRoot = mkdtempSync(join(tmpdir(), "calllint-retry-"))
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }))

interface Run {
  /** exit status of the block: 0 iff it left `fail` at 0 */
  fail: number
  /** how many times the stubbed curl was called */
  calls: number
  out: string
}

/**
 * Run the extracted block with `curl` and `sleep` replaced by shell functions.
 *
 * `codes` is consumed one per call, the last value repeating — so a single-element list means
 * "this code, forever". `header` is what the stub writes as the response headers, i.e. what
 * the shipped `awk` will parse for `x-calllint-report`.
 *
 * The call counter lives in a FILE, not a shell variable: the shipped code calls curl inside
 * `$(...)`, so a variable would be incremented in a subshell and reset on every call. That is
 * not a hypothetical — it is exactly how the original scratch harness went blind, returning
 * codes[0] forever and "passing" the three cases whose expected answer is codes[0].
 */
function runProbe(codes: string[], header = ""): Run {
  const dir = mkdtempSync(join(tmpRoot, "case-"))
  const cnt = join(dir, "n").replace(/\\/g, "/")
  const hdr = join(dir, "hdr").replace(/\\/g, "/")
  writeFileSync(cnt, "0\n")
  writeFileSync(hdr, header)

  // Derived from the shipped window, so retuning `attempts=` never trips it. Its only job is
  // to make a loop that lost its bound fail FAST and legibly: without it, a deleted
  // `-ge "$attempts"` check makes this harness spin until the CI job times out — a guard whose
  // failure mode is a hang burns metered minutes and reports nothing. Measured 2026-08-28.
  const cap = ATTEMPTS + 5
  const script = `
set -uo pipefail
CODES=(${codes.map((c) => `'${c}'`).join(" ")})
curl() {
  local i; i=$(cat '${cnt}')
  echo $((i + 1)) > '${cnt}'
  if [ "$i" -ge ${cap} ]; then
    echo "HARNESS_UNBOUNDED=1"
    echo "HARNESS_FAIL=1"; echo "HARNESS_CALLS=$((i + 1))"
    kill -TERM $$ 2>/dev/null
  fi
  local last=$(( \${#CODES[@]} - 1 ))
  [ "$i" -gt "$last" ] && i="$last"
  # Mimic the real invocation's side effect: -D writes the header file the verdict parses.
  cat '${hdr}' > /tmp/deployment-head.txt
  printf '%s' "\${CODES[$i]}"
}
sleep() { : ; }           # the delay is real in the workflow; waiting for it here proves nothing
DEPLOYMENT_URL='https://stub.example.pages.dev'
fail=0
${PROBE}
echo "HARNESS_FAIL=$fail"
echo "HARNESS_CALLS=$(cat '${cnt}')"
`
  let out = ""
  try {
    out = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000, // second line of defence behind `cap`, in case the block blocks elsewhere
    })
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string }
    out = (err.stdout ?? "") + (err.stderr ?? "")
  }
  const grab = (k: string) => Number(new RegExp(`${k}=(\\d+)`).exec(out)?.[1] ?? NaN)
  return { fail: grab("HARNESS_FAIL"), calls: grab("HARNESS_CALLS"), out }
}

const LIVE = "HTTP/2 301\r\nx-calllint-report: present\r\n\r\n"
const DEAD = "HTTP/2 301\r\nx-calllint-report: absent\r\n\r\n"

describe("the harness can observe what it claims to (controls first)", () => {
  it("advances through the code sequence instead of repeating the first one", () => {
    // The blindness that broke the scratch version: a subshell-local counter returns codes[0]
    // forever. Two DIFFERENT codes whose outcomes differ is the only way to see it.
    const r = runProbe(["404", "200"])
    expect(r.calls, "curl must have been called twice, not once").toBe(2)
    expect(r.out, "the SECOND code must decide the verdict").toContain("did not run")
  })

  it("really executed the shipped block — not an empty string that passes vacuously", () => {
    expect(PROBE, "extraction must yield the loop").toMatch(/^attempts=\d+$/m)
    expect(PROBE, "and the verdict block it guards").toContain('case "$dcode"')
    expect(PROBE.split("\n").length).toBeGreaterThan(30)
  })

  it("the derived window is a real finite bound, so the exhaustion cases cannot go vacuous", () => {
    // A NaN or 0 here would make `calls === ATTEMPTS` trivially unreachable or trivially true.
    expect(ATTEMPTS, "attempts= must parse to a number").not.toBeNaN()
    expect(ATTEMPTS, "and be a bound worth having").toBeGreaterThan(1)
    expect(ATTEMPTS, "an unbounded retry is the sleep-that-hides-a-fault").toBeLessThan(60)
  })

  it("the stubbed header is what the shipped awk parses, so `present` is not hardcoded here", () => {
    expect(runProbe(["301"], LIVE).fail).toBe(0)
    expect(runProbe(["301"], DEAD).fail).toBe(1)
  })
})

describe("retry behaviour, executed against the shipped block", () => {
  it("a first-read 301+present is live and costs exactly one call", () => {
    const r = runProbe(["301"], LIVE)
    expect(r.fail).toBe(0)
    expect(r.calls, "the fast path must not spend retries").toBe(1)
    expect(r.out).toContain("✓ origin: deployment live")
  })

  it("absorbs propagation: 404s then a live 301 succeeds, and SAYS how long it took", () => {
    const r = runProbe(["404", "404", "301"], LIVE)
    expect(r.fail, "propagation is not a fault").toBe(0)
    expect(r.calls).toBe(3)
    expect(r.out, "a creeping delay must stay visible in the log").toMatch(
      new RegExp(`answered on attempt 3 of ${ATTEMPTS}`),
    )
  })

  it("exhausts the window and STILL fails — the retry bounds the wait, not the outcome", () => {
    const r = runProbe(["404"])
    expect(r.fail).toBe(1)
    expect(r.calls, "exactly `attempts` reads, no more").toBe(ATTEMPTS)
    expect(r.out).toMatch(new RegExp(`not serving \\(HTTP 404\\) after ${ATTEMPTS} attempts`))
  })

  it.each([
    ["200", /did not run/, "U-1 reopened on the preview wildcard"],
    ["500", /expected a 301/, "an unknown code is a fault, not a warning"],
  ])("a %s reds on the FIRST read — retrying it would be the blindfold", (code, msg) => {
    const r = runProbe([code, "301"], LIVE)
    expect(r.fail, `${code} means "exists but wrong"`).toBe(1)
    expect(r.calls, "it must NOT be retried — a later 301 may not rescue it").toBe(1)
    expect(r.out).toMatch(msg)
  })

  it("a 301 with the report ABSENT reds on the first read: gated-but-dead is not propagation", () => {
    const r = runProbe(["301", "301"], DEAD)
    expect(r.fail).toBe(1)
    expect(r.calls).toBe(1)
    expect(r.out).toMatch(/NOTHING is behind it/)
  })

  it("a 301 with NO report header is unobservable, so it is not assumed live", () => {
    const r = runProbe(["301"], "HTTP/2 301\r\n\r\n")
    expect(r.fail).toBe(1)
    expect(r.out).toMatch(/liveness is unobservable/)
  })

  it.each(["000", "522"])("%s is retried too — the other two not-there codes", (code) => {
    expect(runProbe([code, "301"], LIVE).fail, `${code} must be retryable`).toBe(0)
    expect(runProbe([code]).calls, "and bounded by the same window").toBe(ATTEMPTS)
  })
})
