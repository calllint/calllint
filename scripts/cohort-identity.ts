/**
 * ADR 0084 — a count cannot witness a substitution.
 *
 * `gate:s0:regression`'s ratchet is a COUNT (`censusRegistry < S0_REGRESSION_FLOOR`). One record
 * lost against 76 gained nets +75, so the predicate is false and the gate is green while a subject
 * silently leaves the cohort. That is what happened to `agency.goji/goji` between the 2026-08-10 and
 * 2026-08-15 snapshots: de-listed upstream, six served files removed, `--regression` EXIT 0.
 *
 * This module is the IDENTITY witness that sits alongside the count. It compares the committed
 * snapshot's name SET against the name set in the PREVIOUS REVISION OF THAT SAME FILE and reports
 * every name present then and absent now.
 *
 * Three properties, each a decision from the ADR rather than an implementation detail:
 *
 *   D2 — THE RECORD IS GIT HISTORY, NOT A NEW STATE FILE. The snapshot is committed, so every
 *        cohort we ever served is already in one file's history. Reading `git show <rev>:<path>`
 *        means there is no `previous-cohort.json` to hand-edit when a red is inconvenient. A second
 *        copy of a fact the repository already stores is a second thing that can be doctored.
 *
 *   D3 — WHERE HISTORY IS UNREACHABLE THIS REFUSES, IT DOES NOT PASS. A depth-1 clone has no
 *        previous revision, and a run that COULD NOT MEASURE must not print what a run that measured
 *        and found nothing prints (ADR 0082's `{kind}` shape, reused here rather than reinvented —
 *        [[a-boolean-standing-in-for-a-reason]]).
 *
 *   D4 — A DE-LISTING IS REPORTABLE, NOT AUTOMATICALLY WRONGDOING. A publisher pulling their server
 *        is legitimate and will recur. What is illegitimate is it happening UNOBSERVED. So the
 *        result names the lost subjects and lets the caller decide the exit code.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** The one file whose history IS the record of every cohort we ever committed (D2). */
export const SNAPSHOT_PATH = "packages/trust-index/snapshots/official-mcp-registry.json"

function git(...args: readonly string[]): string {
  return execFileSync("git", args as string[], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

/**
 * The outcome shape, deliberately three-valued.
 *
 * `refused` is not a flavour of pass. It carries the reason so a log reader can tell "there was no
 * previous revision to compare against" from "there was one and nothing was lost" — the distinction
 * ADR 0082 exists to preserve, and the one a boolean would destroy.
 */
export type IdentityOutcome =
  | {
      readonly kind: "checked"
      /** Names in the previous revision and absent from the current one. Empty is the good case. */
      readonly lost: readonly string[]
      /** Names absent from the previous revision and present now. Growth; never a fault. */
      readonly gained: readonly string[]
      readonly previousRevision: string
      readonly previousCount: number
      readonly currentCount: number
    }
  | { readonly kind: "refused"; readonly reason: string }

interface SnapshotShape {
  readonly count?: number
  readonly entries?: readonly { readonly name?: unknown }[]
}

/**
 * Registry names from snapshot BYTES.
 *
 * Throws rather than returning `[]` on a shape it does not recognise, and that choice is the point:
 * an empty name set silently makes every comparison vacuous — every name "lost", or with the
 * operands the other way round, nothing ever lost. A census that cannot find its key must fail
 * loudly, not count zero ([[a-census-inherits-its-key-form-blind-spots]]).
 */
export function namesFromSnapshotBytes(raw: string, origin: string): string[] {
  let parsed: SnapshotShape
  try {
    parsed = JSON.parse(raw) as SnapshotShape
  } catch (err) {
    throw new Error(`${origin}: not parseable as JSON — ${(err as Error).message}`)
  }
  const entries = parsed.entries
  if (!Array.isArray(entries)) {
    throw new Error(`${origin}: no \`entries\` array — found keys [${Object.keys(parsed ?? {}).join(", ")}]`)
  }
  const names = entries.map((e) => e?.name).filter((n): n is string => typeof n === "string" && n.length > 0)
  // The abort this repo learned to add the hard way: a wrong field name yields a short list and a
  // confident, WRONG answer. Length equality is what makes the key form falsifiable.
  if (names.length !== entries.length) {
    throw new Error(
      `${origin}: ${entries.length} entries but only ${names.length} usable \`name\` values — ` +
        `the key form is wrong, and a partial name set would make this comparison vacuous`,
    )
  }
  return names
}

/** Is there a previous revision of the snapshot to compare against, and can we read it? */
function previousRevisionOf(snapshotPath: string): { rev: string; raw: string } | { reason: string } {
  try {
    git("rev-parse", "--git-dir")
  } catch {
    return { reason: "not a git repository — no history to compare the cohort against" }
  }

  let shallow = false
  try {
    shallow = git("rev-parse", "--is-shallow-repository").trim() === "true"
  } catch {
    /* older git without the flag; fall through to the log probe, which fails honestly */
  }

  // `-2` because revision 1 is the commit under test. Its parent is the cohort we are comparing to.
  let revs: string[]
  try {
    revs = git("log", "-2", "--format=%H", "--", snapshotPath)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  } catch (err) {
    return { reason: `\`git log\` over ${snapshotPath} failed — ${(err as Error).message}` }
  }

  if (revs.length < 2) {
    return {
      reason: shallow
        ? `SHALLOW CLONE: only ${revs.length} revision(s) of ${snapshotPath} are reachable, so the ` +
          `previous cohort cannot be read. This is a REFUSAL, not a pass — run this check on a ` +
          `job with \`fetch-depth: 0\` (ADR 0084 D3).`
        : `only ${revs.length} revision(s) of ${snapshotPath} exist — there is no previous cohort ` +
          `to compare against yet. Nothing is asserted.`,
    }
  }

  const rev = revs[1]!
  try {
    return { rev, raw: git("show", `${rev}:${snapshotPath}`) }
  } catch (err) {
    return { reason: `\`git show ${rev.slice(0, 8)}:${snapshotPath}\` failed — ${(err as Error).message}` }
  }
}

/**
 * Compare the committed cohort's name set against its own previous revision.
 *
 * Pure-ish by construction: the current bytes are read from disk, the previous from git. Both are
 * parsed by the same function, so a shape change cannot make one side silently empty.
 */
export function checkCohortIdentity(snapshotPath: string = SNAPSHOT_PATH): IdentityOutcome {
  const abs = path.join(repoRoot, snapshotPath)
  if (!existsSync(abs)) {
    return { kind: "refused", reason: `${snapshotPath} not found — nothing to compare` }
  }

  const prev = previousRevisionOf(snapshotPath)
  if ("reason" in prev) return { kind: "refused", reason: prev.reason }

  let currentNames: string[]
  let previousNames: string[]
  try {
    currentNames = namesFromSnapshotBytes(readFileSync(abs, "utf8"), `${snapshotPath} at HEAD`)
    previousNames = namesFromSnapshotBytes(prev.raw, `${snapshotPath} at ${prev.rev.slice(0, 8)}`)
  } catch (err) {
    return { kind: "refused", reason: (err as Error).message }
  }

  const current = new Set(currentNames)
  const previous = new Set(previousNames)

  return {
    kind: "checked",
    // A SET DIFFERENCE, which is the whole correction: `refreshFromMirror.ts:275` already computes
    // `absentFromSource` this way for the mirror path, and the fetchRegistry → snapshot → bake path
    // this snapshot came from had no withdrawal concept at all. Same question, two answers, and the
    // serving plane was asking the path that could not answer ([[assert-which-source-answered]]).
    lost: previousNames.filter((n) => !current.has(n)).sort(),
    gained: currentNames.filter((n) => !previous.has(n)).sort(),
    previousRevision: prev.rev,
    previousCount: previous.size,
    currentCount: current.size,
  }
}

/** Human-readable rendering. Kept next to the check so the message and the measure cannot drift. */
export function formatIdentityOutcome(outcome: IdentityOutcome): string {
  if (outcome.kind === "refused") {
    return `◇ COHORT IDENTITY: REFUSED — ${outcome.reason}`
  }
  const { lost, gained, previousRevision, previousCount, currentCount } = outcome
  const head = `cohort ${previousCount} → ${currentCount} since ${previousRevision.slice(0, 8)}`
  if (lost.length === 0) {
    return `✓ COHORT IDENTITY: no subject left the cohort (${head}, +${gained.length} gained)`
  }
  return (
    `⚠ COHORT IDENTITY: ${lost.length} subject(s) LEFT the cohort (${head}, +${gained.length} gained)\n` +
    lost.map((n) => `    LOST: ${n}`).join("\n") +
    `\n  A count cannot see this: ${lost.length} lost against ${gained.length} gained nets ` +
    `${gained.length - lost.length >= 0 ? "+" : ""}${gained.length - lost.length}, so the ratchet stays green.\n` +
    `  Per ADR 0084 D4 this is REPORTABLE, not automatically a fault: a publisher may legitimately\n` +
    `  pull their server. What is illegitimate is it happening unobserved. Acknowledge it in the ADR.`
  )
}
