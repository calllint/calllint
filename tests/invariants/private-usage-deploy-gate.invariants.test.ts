/**
 * new18 §29 — the private usage report's DEPLOY POSTURE must stay observable.
 *
 * §29 was fail-closed until 2026-08-24: Cloudflare Access on `usage.calllint.com` could not
 * be verified from CI, so the report shipped as a workflow artifact only. An operator then
 * configured and verified Access (artifacts/authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md),
 * and the workflow gained a deploy step.
 *
 * WHAT THIS FILE EXISTS TO PREVENT. Permitting the deploy re-opened a hole the original
 * fail-closed posture had shut: CI cannot read an Access policy object, so nothing in the
 * pipeline observes whether the gate still exists. If the Access application were deleted
 * tomorrow, the daily cron would keep publishing the operator's figures to a host that now
 * serves them to anyone. The deploy would stay green the whole time.
 *
 * The resolution is NOT to trust the doc — a comment cannot observe a Cloudflare account.
 * It is that the gate's EFFECT is observable with no credentials at all: an unauthenticated
 * GET must land on the Access sign-in page and must not return report content. That is
 * exactly the check the operator ran by hand, and it needs no token, so the workflow runs it
 * on every deploy.
 *
 * So `check-public-copy.mjs` check 24 permits a Cloudflare deploy ONLY alongside that probe,
 * and these tests hold that conditional in place. Without them, the clause is one edit from
 * becoming an unconditional permit — the repo's dominant fault class, a guard that cannot
 * observe its subject.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const GUARD = "scripts/check-public-copy.mjs"
const WORKFLOW = ".github/workflows/usage-report.yml"

/** The real workflow, read once — the production denominator these tests reason about. */
const realWorkflow = readFileSync(path.join(ROOT, WORKFLOW), "utf8")

const VERIFY_STEP = "Verify Access gate is enforcing"
const DEPLOY_TOKEN = "wrangler pages deploy"
const REPORT_TEMPLATE = "apps/usage-worker/src/report.ts"

/** The probe step's shell body — everything between its name and the next step. */
const probeBody = (() => {
  const from = realWorkflow.slice(realWorkflow.indexOf(VERIFY_STEP))
  return from.slice(0, from.indexOf("- name: Summarize"))
})()

/**
 * The deploy step's shell body. Liveness is established HERE, not by probing a hostname, so
 * the deploy's own assertions are part of §29's observability and are pinned below.
 */
const deployBody = (() => {
  const from = realWorkflow.slice(realWorkflow.indexOf("- name: Deploy to usage.calllint.com"))
  return from.slice(0, from.indexOf(`- name: ${VERIFY_STEP}`))
})()

/**
 * Row labels the report ACTUALLY renders. This is the ground truth for "leaked content",
 * and it is read from the template rather than restated here, so a renamed row breaks the
 * assertion instead of silently un-pinning the probe.
 */
const reportLabels = [
  ...readFileSync(path.join(ROOT, REPORT_TEMPLATE), "utf8").matchAll(/label:\s*"([^"]+)"/g),
].map((m) => m[1]!)

/** The alternation the probe greps for, e.g. `CLI package downloads|MCP servers observed`. */
function probeLeakMarkers(): string[] {
  const m = probeBody.match(/grep -qiE '([^']+)'/)
  return m ? m[1]!.split("|") : []
}

describe("private usage deploy gate — §29 stays fail-closed", () => {
  let tmpRoot: string

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "s29-guard-"))
    cpSync(ROOT, tmpRoot, { recursive: true, filter: (src) => !src.includes("node_modules") })
    // The guard imports from node_modules; a junction keeps resolution working in the copy.
    symlinkSync(path.join(ROOT, "node_modules"), path.join(tmpRoot, "node_modules"), "junction")
  })

  afterAll(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
  })

  /** Write a workflow variant into the temp tree, run the guard, capture stdout + exit. */
  function runGuard(workflowContent: string): { stdout: string; exit: number } {
    writeFileSync(path.join(tmpRoot, WORKFLOW), workflowContent, "utf8")
    try {
      const stdout = execFileSync("node", [path.join(tmpRoot, GUARD)], {
        cwd: tmpRoot,
        encoding: "utf8",
      })
      return { stdout, exit: 0 }
    } catch (error: any) {
      return { stdout: `${error.stdout ?? ""}${error.stderr ?? ""}`, exit: error.status ?? 1 }
    }
  }

  /* ── Production denominator ─────────────────────────────────────────────────────────
   * Asserted BEFORE any claim about the guard's behaviour. If the committed workflow
   * stopped containing a deploy, every conditional below would still pass while testing
   * nothing — the vacuous-green failure this repo keeps rediscovering. */

  it("the REAL workflow both deploys and verifies, so the paired clause has a subject", () => {
    expect(realWorkflow).toContain(DEPLOY_TOKEN)
    expect(realWorkflow).toContain(VERIFY_STEP)
  })

  it("the REAL workflow still uploads the artifact — the deploy did not replace it", () => {
    expect(realWorkflow).toContain("actions/upload-artifact")
  })

  /* ── Positive control ──────────────────────────────────────────────────────────────── */

  it("PC: deploy paired with Access verification passes, and says so specifically", () => {
    const { stdout, exit } = runGuard(realWorkflow)
    expect(exit).toBe(0)
    expect(stdout).toContain("Cloudflare deploy with gate verification")
  })

  /* ── Negative controls ─────────────────────────────────────────────────────────────
   * Each removes exactly one property and asserts the guard reds. A guard that cannot
   * fail cannot be trusted when it passes. */

  it("NC-A: a deploy whose verification step was deleted is rejected", () => {
    // Drop the step's name line only — the deploy survives, the observation does not.
    const noVerify = realWorkflow
      .split("\n")
      .filter((line) => !line.includes(VERIFY_STEP))
      .join("\n")
    expect(noVerify).toContain(DEPLOY_TOKEN) // the mutation kept the subject
    const { stdout, exit } = runGuard(noVerify)
    expect(exit).not.toBe(0)
    expect(stdout).toMatch(/no "Verify Access gate is enforcing" step/)
  })

  it("NC-B: a deploy with no verification does NOT also print a passing §29 line", () => {
    const noVerify = realWorkflow
      .split("\n")
      .filter((line) => !line.includes(VERIFY_STEP))
      .join("\n")
    const { stdout } = runGuard(noVerify)
    // The contradictory-checkmark bug: rejecting a state and blessing it in one run.
    expect(stdout).not.toContain("private usage report follows §29")
  })

  it("NC-C: dropping upload-artifact is rejected — the operator must keep a local copy", () => {
    const noArtifact = realWorkflow.replace("actions/upload-artifact@v4", "actions/nothing@v4")
    const { stdout, exit } = runGuard(noArtifact)
    expect(exit).not.toBe(0)
    expect(stdout).toMatch(/no upload-artifact step/)
  })

  it("NC-D: GitHub Pages deploy stays forbidden even with the Access probe present", () => {
    // Access protects the Cloudflare host. It says nothing about a GitHub Pages origin,
    // which is public by construction — so the probe must not launder this path.
    const viaPages = realWorkflow.replace(DEPLOY_TOKEN, "actions/deploy-pages@v4 #")
    const { stdout, exit } = runGuard(viaPages)
    expect(exit).not.toBe(0)
    expect(stdout).toMatch(/deploys to GitHub Pages/)
  })

  it("NC-E: committing the report back to the repo stays forbidden", () => {
    const viaCommit = realWorkflow.replace(DEPLOY_TOKEN, "git commit -m report #")
    const { stdout, exit } = runGuard(viaCommit)
    expect(exit).not.toBe(0)
    expect(stdout).toMatch(/commits back to the repo/)
  })

  /* ── The probe must be able to fail ────────────────────────────────────────────────
   * check 24 can only see that a step NAMED right exists. A step named right that always
   * exits 0 would satisfy the guard and observe nothing, so the probe's own body is
   * asserted here: it must exit non-zero, and it must key on leaked report content. */

  it("the Access probe exits non-zero and keys on the gate's redirect, not just HTTP status", () => {
    expect(probeBody).toContain("exit 1")
    // A 200 from an Access gate is still a 200 — status alone cannot decide this. The gate
    // is identified by its redirect TARGET, which is structural: the 302's own body is a
    // 7-line stub containing neither "sign in" nor the app name.
    expect(probeBody).toContain("cloudflareaccess.com/cdn-cgi/access/login")
  })

  /* ── The leak markers must be real report content ──────────────────────────────────
   * WHAT THIS REPLACED. The old assertion accepted the literals "calllint usage report"
   * or "installation hashes". Measured 2026-08-26: NEITHER appears in a generated report
   * (its title is "CallLint Usage — private"; its rows read "CLI package downloads"),
   * while "calllint usage report" DOES appear on the Access login page as the application
   * name. So the leak check was blind to a real leak and false-positive on the safe case,
   * and the test blessed exactly that. Asserting against the template makes the markers
   * verifiable instead of merely present. */

  it("every leak marker the probe greps for is a row label the report really renders", () => {
    const markers = probeLeakMarkers()
    expect(markers.length).toBeGreaterThan(0) // anti-vacuity: the grep must be found at all
    expect(reportLabels).toContain("CLI package downloads") // the template still has labels
    for (const marker of markers) expect(reportLabels).toContain(marker)
  })

  it("the probe does not key on the Access application name, which is not report content", () => {
    // "CallLint Usage Report (Private)" is rendered by Cloudflare on the sign-in page. A
    // marker matching it fires when the gate is WORKING.
    for (const marker of probeLeakMarkers()) {
      expect(marker.toLowerCase()).not.toBe("calllint usage report")
    }
  })

  /* ── Gated must not be indistinguishable from dead ─────────────────────────────────
   * The 502 an operator hit on 2026-08-26 was invisible to CI because both prior checks
   * pass when Access fronts a project with ZERO deployments: the redirect happens, and no
   * content leaks because there is no content. The probe must therefore also observe that
   * something is served.
   *
   * These three tests assert PROPERTIES of that observation, not the wording of its
   * diagnostics. The predecessor pinned the literal string "no live deployment" and broke
   * when the message was reworded, which taught nothing about whether liveness was still
   * observed. */

  it("the probe checks something is really served, so a 502-behind-the-gate reds", () => {
    // Asserted as a PROPERTY, not as a sentence. The first version of this test pinned the
    // literal "no live deployment" — the exact wording of one error message — so rewording
    // the diagnostic broke it while the property it protects was intact. A test that fails
    // on a synonym is measuring the author's prose, not the guard's behaviour.
    //
    // The property: the probe must fetch the deployment URL that the deploy step published,
    // and must red when that fetch does not serve. Liveness deliberately comes from the
    // deploy's own output rather than from probing a hostname — see the step's comment for
    // the two measurements (Access 302s before authenticating; probing the alias raced it).
    expect(deployBody).toMatch(/deployment_url=.*>>.*GITHUB_OUTPUT/)
    expect(probeBody).toContain("DEPLOYMENT_URL")
    // Not anchored to one line: the curl grew a `-D` header dump when the canonical-host
    // entry landed, and a line break is not a weakening. The property is that this URL is
    // what gets fetched.
    expect(probeBody).toMatch(/curl[\s\S]{0,200}?"\$DEPLOYMENT_URL"/)
    // A dead deployment URL must set fail, not merely print. Both the empty-URL branch and
    // the bad-status branch are asserted, since either alone would let the other pass mute.
    const noUrl = probeBody.slice(probeBody.indexOf("published no deployment URL"))
    expect(noUrl.slice(0, 200)).toMatch(/fail=1/)
    const badStatus = probeBody.slice(probeBody.indexOf("is not serving"))
    expect(badStatus.slice(0, 200)).toMatch(/fail=1/)
  })

  it("liveness requires BOTH the redirect and the report header — a 301 alone is not live", () => {
    // apps/usage-worker/src/pages-entry.js makes the deployment URL 301 instead of serve.
    // A redirect proves only that code RAN. The gated-but-dead 502 state is precisely a
    // redirect with nothing behind it, so `absent` must red.
    const c3 = probeBody.slice(probeBody.indexOf('case "$dcode"'))
    const scoped = c3.slice(0, c3.indexOf("esac"))
    expect(scoped).toMatch(/x-calllint-report/i)
    const absent = scoped.slice(scoped.indexOf('"$report" = "absent"'))
    expect(absent.slice(0, 300)).toMatch(/fail=1/)
    // A missing header must not be read as live either — unobservable is not a pass.
    expect(scoped).toMatch(/liveness is unobservable/)
  })

  it("a plain 200 on the deployment URL is an ERROR — that is U-1 reopened on the wildcard", () => {
    // The check's old pass condition. Per-deployment hostnames sit under the
    // `*.{project}.pages.dev` wildcard and serve the same report, so a 200 here means the
    // canonical-host entry did not run. Accepting it would close U-1 only on the alias.
    const c3 = probeBody.slice(probeBody.indexOf('case "$dcode"'))
    const scoped = c3.slice(0, c3.indexOf("esac"))
    const twoHundred = scoped.slice(scoped.indexOf("200)"))
    expect(twoHundred.slice(0, 400)).toMatch(/fail=1/)
    // And no branch may fall through to a warning-shaped pass, which is what the wildcard
    // relied on before: `*)` previously printed ::warning and treated the host as live.
    expect(scoped).not.toMatch(/::warning::[^\n]*treating as live/)
  })

  it("the shipped canonical-host entry exists, is wired into the build, and is tested", () => {
    // A guard that cannot observe its subject is this repo's dominant fault class. The
    // probe's check 3 and check 4 both now assume this file ships; assert that it does.
    const entry = readFileSync(path.join(ROOT, "apps/usage-worker/src/pages-entry.js"), "utf8")
    expect(entry).toContain('CANONICAL_HOST = "usage.calllint.com"')
    expect(entry).toMatch(/status:\s*301/)
    // Copied into the deploy root under the name Pages advanced mode requires, and
    // validated BEFORE the write so a bad copy cannot reach a deployment.
    const gen = readFileSync(path.join(ROOT, "scripts/generate-usage-report.mjs"), "utf8")
    expect(gen).toMatch(/_worker\.js/)
    expect(gen).toMatch(/pages-entry\.js/)
    expect(gen.indexOf("pages-entry.js")).toBeLessThan(gen.indexOf("const failures = []"))
    // Driven by real tests, not by inspection of a dashboard.
    expect(existsSync(path.join(ROOT, "apps/usage-worker/test/pages-entry.test.ts"))).toBe(true)
  })

  it("the deploy step asserts wrangler's success marker POSITIVELY, not by absence of error", () => {
    // An empty log satisfies "no error appeared" — the vacuous-green shape this repo keeps
    // rediscovering. So the marker must be required present, and its absence must exit.
    expect(deployBody).toMatch(/if ! grep -q "Deployment complete"/)
    expect(deployBody.slice(deployBody.indexOf("Deployment complete"))).toMatch(/exit 1/)
  })

  it("the §29 exposure check reds on CONTENT, and does not infer liveness from the alias", () => {
    // Once the production pages.dev hostname stops serving this report, absence there is the
    // intended end state — not a fault. Reading it as "no live deployment" (which the probe
    // did until 2026-08-26) reports a CORRECT configuration as the 502 it exists to catch.
    // So the ungated check may only ever object to content being served.
    const s29 = probeBody.slice(probeBody.indexOf("ocode="))
    expect(s29).toContain("serves report content UNGATED")
    // The known-absent codes must be treated as a pass by this check, not as an error.
    expect(s29).toMatch(/elif \[ "\$ocode" = "000" \]/)
    expect(s29.slice(s29.indexOf('elif [ "$ocode" = "000" ]'))).not.toMatch(/fail=1/)
  })

  it("the probe treats an ungated pages.dev origin as an error, not a warning", () => {
    // Access binds to a hostname; it does not follow the project to its pages.dev name.
    const ungated = probeBody.slice(probeBody.indexOf("serves report content UNGATED"))
    expect(ungated).toContain("::error::")
    expect(probeBody).not.toMatch(/::warning::[^\n]*UNGATED/)
  })

  // ─── the deployment hostname propagates, and the retry must not become a blindfold ───
  //
  // ADR 0092. The probe read HTTP 404 from the URL wrangler had just published, 0.14s after
  // "Deployment complete", and called it "a genuine origin fault". Re-probed by hand a day
  // later, that same URL served 301 + report present: the deployment was live, the probe was
  // early. 5 of 20 runs died this way. The fix is a bounded retry — and a bounded retry is
  // one edit away from being the thing the old comment (correctly) warned against, so the
  // shape is pinned here rather than trusted to prose.

  it("retries ONLY the not-yet-there codes, and never the exists-but-wrong ones", () => {
    // Sliced to the loop's own `done`, not to the verdict block: the header extraction sits
    // between them and is legitimately outside the retry gate.
    const fromAttempts = probeBody.slice(probeBody.indexOf("attempts=6"))
    const loop = fromAttempts.slice(0, fromAttempts.indexOf("done"))
    expect(loop, "the retry window must exist").toContain("sleep")
    // The gate condition: retry is entered for absence only.
    for (const code of ["000", "404", "522"]) {
      expect(loop, `HTTP ${code} means "not there" and is retryable`).toContain(`"$dcode" != "${code}"`)
    }
    // 200 (entry did not run → U-1 reopened) and 301-with-absent (gated-but-dead) are the
    // states a sleep would hide. They must not appear as retry conditions at all.
    expect(loop, "a 200 must red on the FIRST read — retrying it is the blindfold").not.toMatch(/\$dcode.{0,12}200/)
    expect(loop, "and the report header must not be consulted inside the retry gate").not.toMatch(/x-calllint-report/i)
  })

  it("an exhausted retry still fails, so the guard keeps its teeth", () => {
    const c3 = probeBody.slice(probeBody.indexOf('case "$dcode"'))
    const scoped = c3.slice(0, c3.indexOf("esac"))
    // Bounded by the branch's own `;;` rather than a character count, so the assertion does
    // not weaken or break when the comment above the echo is reworded.
    const fromAbsent = scoped.slice(scoped.indexOf("000|404|522)"))
    const absent = fromAbsent.slice(0, fromAbsent.indexOf(";;"))
    expect(
      absent,
      "a deployment that never serves must still set fail=1 after the window closes — the retry bounds the wait, it does not forgive the outcome",
    ).toMatch(/fail=1/)
    // Bounded, not unbounded: an infinite retry is a hang, which reads as a green that never arrives.
    expect(probeBody, "the attempt count must be a finite literal").toMatch(/attempts=\d+/)
    expect(probeBody, "and the delay too").toMatch(/delay=\d+/)
  })

  it("exactly one dcode case-statement exists, because a second one steals this file's anchor", () => {
    // Three assertions above locate the verdict block by the FIRST occurrence of that
    // construct. The first draft of the retry loop added a second one; the anchor moved, and
    // those assertions silently began reading the retry loop instead of the verdict. Same
    // read-the-wrong-subject class as the defect being fixed, so it gets a guard, not a note.
    const occurrences = realWorkflow.match(/case "\$dcode"/g) ?? []
    expect(
      occurrences.length,
      'exactly one `case "$dcode"` may appear in usage-report.yml — including inside comments, since the anchor is a byte match and a comment sits ABOVE the code it describes (ADR 0092)',
    ).toBe(1)
  })
})
