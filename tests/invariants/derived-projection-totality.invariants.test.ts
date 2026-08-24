/**
 * new20 Sprint 4 — two projections that were correct with nothing keeping them correct.
 *
 * Both subjects here had the same shape of defect, and neither was a wrong fact. Measured
 * 2026-08-23: every one of the DeepSeek landing page's 8 host cards AGREED with the SSOT, and
 * all six hand-typed counts in `artifacts/submissions/` were right. What was missing was a
 * writer. A fact with no writer is not a maintained fact; it is a fact that happens to still
 * be true, which is the same shape as `scan --config` staying advertised on 8 surfaces for
 * months while nothing read it. The page and the counts are now generated. This file is what
 * notices if either is pulled back out of the generator.
 *
 * WHY THE DRIFT CHECK IS NOT ENOUGH. `check:distribution-drift` compares emitted bytes to the
 * tree, so it answers "does the file match what the generator would write?" — it cannot answer
 * "does the generator still write it?". Delete `generateModelIntentPages()` and its `emit()`
 * call and the drift check has one fewer file to compare and reports success over the
 * remainder; the floor in `main()` catches a shortfall against `FIXED_PROJECTION_COUNT`, but
 * that constant is in the same file a deletion would edit. So the assertions below are about
 * the *relationship* between the SSOT and the published surfaces, read off disk, with the
 * denominator pinned before every claim.
 *
 * WHAT EACH LAYER CATCHES, for the counts file:
 *   generator (`generateSubmissionCounts`)  throws if the five buckets stop partitioning the
 *                                           shelf channels — a `state` value in no bucket
 *                                           would under-report the to-do list.
 *   drift check                             the emitted bytes are committed and current.
 *   this file                               the numbers in the file equal the SSOT's, and the
 *                                           prose files cite them instead of restating them.
 *                                           Only this layer notices a number typed BACK into
 *                                           README.md, which is how all six got there.
 *
 * THE FIFTH BUCKET AND THE SUBMITTED COLUMN (ADR 0002) arrived after this file did. Both are
 * asserted below, and one of the two clauses involved — `!c.submission` excluding a submitted
 * channel from the to-do list — has NO subject in the shipped SSOT, because every recorded
 * submission currently sits at `PENDING_UPSTREAM`. Dropping the clause changes no byte today.
 * That is precisely the condition this repo's dominant fault class hides in, so the subject is
 * manufactured on a clone rather than waited for.
 *
 * ANTI-VACUITY. Every `for` loop below is preceded by an assertion that its cohort is
 * non-empty, and every regex extraction asserts it matched before comparing. A test that
 * parsed zero cards out of a renamed CSS class, or read zero counts out of a reworded table,
 * would print a checkmark having asserted nothing — the dominant fault class in this repo.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8")
const readJson = (rel: string) => JSON.parse(read(rel))

const SSOT_PATH = "apps/web/data/distribution-surfaces.json"
const COUNTS_PATH = "artifacts/submissions/CHANNEL-COUNTS.md"
const GENERATOR_PATH = "scripts/generate-distribution-surfaces.mjs"

interface Primitive {
  kind: string
  state: string
  blocker?: string
  submission?: { date: string }
}
interface Host {
  id: string
  displayName: string
  canonicalPath: string
  supportClass: string
  truthfulCommands?: string[]
  distributionPrimitives?: Primitive[]
}
interface LandingPage {
  id: string
  path: string
}
interface Ssot {
  hosts: Host[]
  modelIntentLandingPages?: LandingPage[]
}

let ssot: Ssot
let counts: string

beforeAll(() => {
  ssot = readJson(SSOT_PATH)
  counts = read(COUNTS_PATH)
})

/** Pull `| <label> | <n> |` out of the counts file, asserting the row exists first. */
function countRow(label: string): number {
  const re = new RegExp(`^\\|\\s*\\**\`?${label}\`?\\**[^|]*\\|\\s*\\**(\\d+)\\**\\s*\\|`, "m")
  const m = counts.match(re)
  expect(m, `CHANNEL-COUNTS.md has no row for "${label}" — the extraction below is vacuous`).not.toBeNull()
  return Number(m![1])
}

function allChannels(): Array<Primitive & { host: string }> {
  return ssot.hosts.flatMap((h) =>
    (h.distributionPrimitives ?? []).map((p) => ({ host: h.id, ...p })),
  )
}

describe("CHANNEL-COUNTS.md is the SSOT's arithmetic, not a transcription", () => {
  it("reports the two cost classes as the SSOT partitions them", () => {
    const channels = allChannels()
    expect(channels.length, "no channels in the SSOT — every count below is vacuous").toBeGreaterThan(0)

    const verifyOnly = channels.filter((c) => c.kind === "mcp-stdio")
    const shelf = channels.filter((c) => c.kind !== "mcp-stdio")
    // Both cohorts must be non-empty or the class distinction the file draws is untested.
    expect(verifyOnly.length, "no mcp-stdio channels — the verify-only class is untested").toBeGreaterThan(0)
    expect(shelf.length, "no shelf channels — the human-action class is untested").toBeGreaterThan(0)

    expect(countRow("Verify-only")).toBe(verifyOnly.length)
    expect(countRow("Shelf action")).toBe(shelf.length)
    expect(countRow("Total channels")).toBe(channels.length)
  })

  it("partitions the shelf actions exhaustively — the sum is the whole cohort", () => {
    const shelf = allChannels().filter((c) => c.kind !== "mcp-stdio")
    expect(shelf.length).toBeGreaterThan(0)

    const blocked = countRow("BLOCKED")
    const pending = countRow("PENDING_UPSTREAM")
    const live = countRow("AVAILABLE")
    const submitted = countRow("submitted, not yet listed")
    const actionable = countRow("actionable")

    // The claim the file makes out loud. If a new `state` were added and bucketed nowhere,
    // the generator throws — but only when it next runs, and only if someone runs it. This
    // asserts the shipped file's own sum, which is what a reader trusts.
    expect(
      blocked + pending + live + submitted + actionable,
      "the buckets do not sum to the shelf cohort — the to-do count under-reports the work",
    ).toBe(shelf.length)

    expect(blocked).toBe(shelf.filter((c) => c.state === "BLOCKED").length)
    expect(pending).toBe(shelf.filter((c) => c.state === "PENDING_UPSTREAM").length)
    expect(live).toBe(shelf.filter((c) => c.state === "AVAILABLE").length)

    // The file states its own bucket count in prose; a reader comparing that sentence to the
    // table must not find five rows described as four.
    const declared = counts.match(/The (\d+) buckets sum to (\d+)/)
    expect(declared, "the counts file no longer states how many buckets it partitions into").not.toBeNull()
    expect(Number(declared![1]), "the prose bucket count disagrees with the table").toBe(5)
    expect(Number(declared![2]), "the prose shelf total disagrees with the SSOT").toBe(shelf.length)
  })

  it("lists every actionable row, so the tables cannot go stale against the counts", () => {
    const shelf = allChannels().filter((c) => c.kind !== "mcp-stdio")
    /* `!c.submission` mirrors the generator, and it is the clause with no subject in the
     * shipped SSOT: every recorded submission is currently PENDING_UPSTREAM, so dropping it
     * changes nothing today. It is asserted anyway, and the next test manufactures the
     * subject the data does not supply. */
    const actionable = shelf.filter(
      (c) =>
        c.state !== "BLOCKED" &&
        c.state !== "PENDING_UPSTREAM" &&
        c.state !== "AVAILABLE" &&
        !c.blocker &&
        !c.submission,
    )
    expect(actionable.length, "no actionable rows — this control has no denominator").toBeGreaterThan(0)

    const missing = actionable.filter((c) => !counts.includes(`| \`${c.host}\` | \`${c.kind}\` |`))
    expect(missing.map((c) => `${c.host}/${c.kind}`), "actionable rows absent from the table").toEqual([])
  })

  it("prints the submission date in the row, and an em-dash where nobody acted", () => {
    /* The column exists so the human-action axis reaches a human (ADR 0002). Asserting the
     * COLUMN alone would pass over an all-`—` table, so the cohort is pinned first: at least
     * one channel records a date, and that date must appear on that channel's own row. */
    const shelf = allChannels().filter((c) => c.kind !== "mcp-stdio")
    const dated = shelf.filter((c) => c.submission?.date)
    expect(dated.length, "no shelf channel records a submission — the column is untested").toBeGreaterThan(0)

    expect(counts, "the counts tables lost the Submitted column").toContain("| Submitted |")

    for (const c of dated) {
      const row = counts.split("\n").find((l) => l.includes(`| \`${c.host}\` | \`${c.kind}\` |`))
      expect(row, `${c.host}/${c.kind} has no row in CHANNEL-COUNTS.md`).toBeDefined()
      expect(row, `${c.host}/${c.kind}: the row does not carry its submission date`).toContain(
        c.submission!.date,
      )
    }

    // And the untouched channels must say so explicitly rather than leaving a blank cell.
    const untouched = shelf.filter((c) => !c.submission)
    expect(untouched.length, "every shelf channel is submitted — the em-dash case is untested").toBeGreaterThan(0)
    const blankCelled = untouched
      .filter((c) => {
        const row = counts.split("\n").find((l) => l.includes(`| \`${c.host}\` | \`${c.kind}\` |`))
        return row !== undefined && !row.trimEnd().endsWith("| — |")
      })
      .map((c) => `${c.host}/${c.kind}`)
    expect(blankCelled, "these unsubmitted rows do not end in an em-dash cell").toEqual([])
  })

  it("keeps a submitted channel out of the to-do list, on a manufactured subject", () => {
    /* THE CLAUSE WITH NO SUBJECT. Schema arm 4 forbids a submission only under
     * `READY_NOT_SUBMITTED`, so a submitted channel whose listing is still unverified is
     * legally `AUDIT_REQUIRED` — and would land in Actionable, telling a human to submit what
     * is already submitted. That is the duplicate `cline-marketplace-pr`'s note exists to
     * prevent. No shipped record exercises it, so the partition is recomputed here over a
     * cloned SSOT with the subject manufactured, mirroring the generator's own filters.
     *
     * This reimplements those filters rather than importing them, which is the usual
     * objection to a test like this. The alternative is worse: the generator is a 2000-line
     * ESM script with side effects at import. What keeps the two in step is the shell control
     * that runs the real generator over this same mutation (nc-counts, NC-1: actionable 9→8),
     * plus the count assertions above, which read the REAL emitted file. */
    const shelf = allChannels().filter((c) => c.kind !== "mcp-stdio")
    const isActionable = (c: Primitive) =>
      c.state !== "BLOCKED" &&
      c.state !== "PENDING_UPSTREAM" &&
      c.state !== "AVAILABLE" &&
      !c.blocker &&
      !c.submission

    const before = shelf.filter(isActionable)
    expect(before.length, "no actionable channel to manufacture a submission onto").toBeGreaterThan(0)

    const subject = structuredClone(before[0]!)
    expect(isActionable(subject), "the cloned subject is not actionable — the probe is inverted").toBe(true)
    subject.submission = { date: "2026-08-18" }
    expect(
      isActionable(subject),
      "an already-submitted channel still counts as actionable work — the to-do list would " +
        "ask for a duplicate submission",
    ).toBe(false)

    // And it must land in the fifth bucket rather than vanishing from the partition entirely.
    const inFifth =
      subject.state !== "BLOCKED" &&
      subject.state !== "PENDING_UPSTREAM" &&
      subject.state !== "AVAILABLE" &&
      !subject.blocker &&
      Boolean(subject.submission)
    expect(inFifth, "the channel left Actionable and landed in no bucket — the sum would shrink").toBe(true)
  })

  it("keeps the generator's own actionable filter on both axes", () => {
    /* WHY READ THE SOURCE. The test above mirrors the generator's filter, and a mirror cannot
     * notice the original changing: deleting `!c.submission` from the generator emits an
     * IDENTICAL projection today, because every recorded submission is `PENDING_UPSTREAM` and
     * so is excluded by an earlier clause anyway. Measured, not assumed — that mutation was
     * run against this suite and it stayed green, which is the whole reason this test exists.
     * The clause only starts mattering on the first submission recorded against a channel
     * whose listing is unverified, and by then the guard needs to already be in place. Same
     * technique `submission-axis.invariants.test.ts` uses on HD-08, for the same reason the
     * docblock above gives: the drift check answers "do the bytes match?", never "does the
     * generator still write it?". */
    const gen = read(GENERATOR_PATH)
    const start = gen.indexOf("function generateSubmissionCounts")
    expect(start, "generateSubmissionCounts is gone from the generator").toBeGreaterThan(-1)
    const body = gen.slice(start, gen.indexOf("\n}\n", start))

    /* COMMENTS MUST COME OFF FIRST, and this is not hypothetical tidiness. The first draft of
     * this test asserted `body` contained "!c.submission" and stayed GREEN when the clause was
     * deleted from the generator — because the comment explaining the clause also contains the
     * string. It was grepping its own rationale. Any source-reading assertion has to look at
     * code, or it passes on the strength of the prose describing what the code used to do. */
    const code = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n")
    // Self-check: the rationale that fooled the first draft must still be in the comments, or
    // this test has gone vacuous by the explanation being deleted rather than the code fixed.
    expect(
      body.length - code.length,
      "generateSubmissionCounts lost its explanatory comments — the code may be right but the " +
        "reason is gone, and the next reader will delete the clause again",
    ).toBeGreaterThan(200)

    // The actionable filter must exclude a submitted channel...
    expect(
      code,
      "the generator's actionable filter no longer excludes submitted channels — the to-do " +
        "list will ask for a duplicate submission as soon as one is recorded against an " +
        "unverified listing (ADR 0002)",
    ).toContain("!c.submission")
    // ...and the fifth bucket must exist to receive it. Note the partition assertion CANNOT
    // catch this while the bucket is empty: dropping it from the sum still totals the shelf.
    // Measured — that mutation emitted a projection without complaint.
    expect(
      code,
      "the submitted-not-yet-listed bucket is gone from the partition — a submitted channel " +
        "would leave Actionable and land nowhere. The generator's own sum cannot notice while " +
        "the bucket is empty, which is why this is asserted at the source",
    ).toMatch(/buckets = \[[^\]]*submittedElsewhere[^\]]*\]/)
    // The partition must be asserted, not merely computed.
    expect(code, "the generator no longer throws when the buckets stop covering the shelf").toMatch(
      /partition !== shelf\.length/,
    )
    // And no wall clock may reach a byte-compared projection.
    expect(
      code,
      "a wall clock reached generateSubmissionCounts — check:distribution-drift would fail " +
        "every morning on content nobody edited",
    ).not.toMatch(/new Date\(\)|Date\.now\(\)/)
  })

  it("carries the do-not-hand-edit header, so a reader knows where to make the change", () => {
    expect(counts.startsWith("<!-- GENERATED by scripts/generate-distribution-surfaces.mjs")).toBe(true)
  })
})

describe("the prose files cite the counts rather than restating them", () => {
  // This is the assertion with no other layer behind it. The six counts got into README.md by
  // being typed, and nothing objected for as long as they stayed accidentally right.
  const PROSE = [
    "artifacts/submissions/README.md",
    "artifacts/submissions/ROI.md",
    "artifacts/submissions/BLOCKED.md",
  ]

  it("links to CHANNEL-COUNTS.md from each file that used to hold a count", () => {
    for (const rel of PROSE) {
      expect(read(rel), `${rel} no longer points a reader at the derived counts`).toContain(
        "CHANNEL-COUNTS.md",
      )
    }
  })

  it("states no channel total as a bare number in prose", () => {
    const channels = allChannels()
    const shelf = channels.filter((c) => c.kind !== "mcp-stdio")
    const verifyOnly = channels.filter((c) => c.kind === "mcp-stdio")
    /* The four totals a reader would act on. Spelled forms included: "nine" is how five of
     * the six original restatements were written, so a digits-only check would have missed
     * them. Numbers that are NOT totals — ROI ranks (#1..#9), dates, section numbers — are
     * not in this set, which is why it enumerates the totals instead of scanning for digits. */
    const forbidden = new Map<number, string[]>([
      [channels.length, [String(channels.length)]],
      [shelf.length, [String(shelf.length)]],
      [verifyOnly.length, [String(verifyOnly.length)]],
    ])
    const SPELLED: Record<number, string> = {
      1: "one",
      2: "two",
      3: "three",
      4: "four",
      5: "five",
      6: "six",
      7: "seven",
      8: "eight",
      9: "nine",
      10: "ten",
    }
    expect(forbidden.size, "no totals to check — this control is vacuous").toBeGreaterThan(0)

    const hits: string[] = []
    for (const rel of PROSE) {
      const text = read(rel)
      for (const [n] of forbidden) {
        // Only flag a total that appears next to the word it would be a count OF. A bare "14"
        // in a URL or a date is not a claim; "14 shelf" is.
        const near = new RegExp(
          `\\b(${n}|${SPELLED[n] ?? "\\u0000"})\\s+(shelf|channels?|actionable|verify-only)\\b`,
          "i",
        )
        if (near.test(text)) hits.push(`${rel}: restates ${n}`)
      }
    }
    expect(hits, "a count was typed back into prose — it cannot fail when the SSOT grows").toEqual([])
  })
})

describe("the DeepSeek landing page cards every host, from the SSOT", () => {
  let page: string
  let declared: LandingPage

  beforeAll(() => {
    const pages = ssot.modelIntentLandingPages ?? []
    expect(pages.length, "the SSOT declares no landing pages — this block is vacuous").toBeGreaterThan(0)
    const found = pages.find((p) => p.id === "deepseek-hub")
    expect(found, "deepseek-hub is gone from modelIntentLandingPages").toBeDefined()
    declared = found!
    const rel = declared.path.replace(/^\//, "").replace(/\/$/, "")
    page = read(path.posix.join("apps/web/public", rel, "index.html"))
  })

  it("names every host, not a hand-picked subset", () => {
    // The measured defect: 8 of 18 hosts, following no reconstructible rule, and omitting
    // `deepseek-harness` — the one host that actually is DeepSeek.
    expect(ssot.hosts.length, "no hosts in the SSOT").toBeGreaterThan(0)
    const absent = ssot.hosts.filter((h) => !page.includes(`href="${h.canonicalPath}"`))
    expect(absent.map((h) => h.id), "hosts missing a card on the landing page").toEqual([])
  })

  it("prints no command outside truthfulCommands", () => {
    /* The page's cards carry a command each, and HD-01..HD-04/HD-06 audit only
     * `truthfulCommands`. So a literal written here was outside every gate at once. Every
     * `calllint` string in a CARD must be a declared command or the honest-absence form.
     *
     * Scoped to `<code class="small">`, the cards' own element. The cohort sentence above the
     * grid also carries `<code>` spans, but those are illustrative CLI FORMS (`--agent <id>`)
     * from `describeSupportMix`, not a claim about any one host — including them made this
     * assertion fail on a string that is not its subject. The forms are audited where they are
     * written; a per-host claim is what this test is about. */
    const cardCode = [...page.matchAll(/<code class="small">([^<]*)<\/code>/g)].map((m) =>
      // Unescaped before comparison: the page correctly escapes `<path>` in opencode's command
      // to `&lt;path&gt;`, so a raw comparison reports a false positive against the SSOT's own
      // audited text. Decoding keeps this assertion about command PROVENANCE, which is its
      // subject, rather than about HTML encoding, which the escaping test below covers.
      // `?? ""` because group 1 is typed optional; the regex cannot match without it, and an
      // empty string would fail the vacuity assertion below rather than pass silently.
      (m[1] ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
    )
    const printed = cardCode.filter((c) => c.includes("calllint"))
    expect(printed.length, "no commands found in the cards — the extraction is vacuous").toBeGreaterThan(0)

    const allowed = new Set(ssot.hosts.flatMap((h) => h.truthfulCommands ?? []))
    expect(allowed.size, "no truthfulCommands in the SSOT — nothing to compare against").toBeGreaterThan(0)

    const unaccounted = printed.filter(
      (cmd) => !allowed.has(cmd) && !cmd.includes("no scan command yet"),
    )
    expect(unaccounted, "commands on the page trace to no audited SSOT field").toEqual([])
  })

  it("escapes the angle brackets a command placeholder carries", () => {
    /* The counterpart to the decoding above, and not redundant with it: a page that emitted
     * `<path>` raw would let the browser swallow it as an unknown tag, so the visitor reads
     * `calllint scan --config` — a command that is missing its argument and would fail. This is
     * the same defect `describeSupportMix`'s `format` parameter exists to prevent. */
    const withPlaceholder = ssot.hosts.flatMap((h) =>
      (h.truthfulCommands ?? []).filter((c) => c.includes("<")),
    )
    expect(
      withPlaceholder.length,
      "no command carries a placeholder — this control is vacuous",
    ).toBeGreaterThan(0)

    for (const cmd of withPlaceholder) {
      const escaped = cmd.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      // Asserted inside the card element specifically. A page-wide `not.toContain(cmd)` was
      // satisfied by an unrelated occurrence in the cohort sentence, so the mutation that
      // un-escaped this very command left the test green — the guard could not see its subject.
      expect(page, `${cmd} has no card — this assertion has no subject`).toContain(
        `<code class="small">${escaped}</code>`,
      )
      expect(
        page,
        `${cmd} is printed with raw angle brackets — the browser will eat the argument`,
      ).not.toContain(`<code class="small">${cmd}</code>`)
    }
  })

  it("renders the cohort sentence in its HTML form, not its Markdown form", () => {
    /* `describeSupportMix` takes a `format` because the two forms are not interchangeable: the
     * Markdown form wraps code in backticks, which HTML prints literally, and leaves `<id>`
     * raw for the browser to swallow. This page was built calling `'text'` and then escaping
     * the result, which produced exactly both symptoms — literal backticks around
     * `--agent &lt;id&gt;` — and no assertion anywhere objected, which is why the wrong form
     * survived being written. The sentence is the page's only summary of the whole cohort, so
     * a reader who cannot parse it loses the denominator for everything below it. */
    const sentence = page.match(/CallLint tracks \d+ agent harnesses:[^<]*(?:<[^>]+>[^<]*)*?\./)
    expect(sentence, "the cohort sentence is gone from the page").not.toBeNull()

    expect(sentence![0], "the cohort sentence carries literal Markdown backticks").not.toContain("`")
    expect(page, "the cohort sentence's code spans are not marked up as code").toMatch(
      /CallLint tracks \d+ agent harnesses:[\s\S]{0,200}<code>/,
    )
  })

  it("fabricates no scan command for a host that has none", () => {
    /* `--auto` is real and exits 0. Printing it for a host CallLint cannot discover would read
     * as "supported and clean" while discovering nothing — the worst available failure mode,
     * because it is indistinguishable from a pass. */
    const commandless = ssot.hosts.filter((h) => (h.truthfulCommands ?? []).length === 0)
    expect(commandless.length, "every host has a command — this control is vacuous").toBeGreaterThan(0)

    for (const h of commandless) {
      const card = page.slice(page.indexOf(`href="${h.canonicalPath}"`))
      const end = card.indexOf("</div>")
      expect(end, `could not delimit the card for ${h.id}`).toBeGreaterThan(-1)
      expect(
        card.slice(0, end),
        `${h.id} has no truthfulCommands but its card advertises one`,
      ).toContain("no scan command yet")
    }
  })

  it("never states a verdict label bare", () => {
    // §20 / CLAUDE.md: SAFE is "no blockers observed under current evidence", never a
    // guarantee, and UNKNOWN never becomes it on its own. The page says so explicitly.
    if (page.includes("Insufficient evidence")) {
      expect(page, "the page names UNKNOWN's label without denying the upgrade").toMatch(
        /Insufficient evidence[\s\S]{0,300}never becomes/,
      )
    }
    expect(page).not.toMatch(/\bSAFE\b/)
  })

  it("is written by the generator, with an unbuilt page failing loudly", () => {
    /* The builder registry must FAIL on an id it has no builder for. A skipped entry is a
     * declared surface with no file: the sitemap advertises it and `check:agent-surface`
     * asserts it is not redirected, so a 404 would pass both. */
    const src = read(GENERATOR_PATH)
    const start = src.indexOf("function generateModelIntentPages")
    expect(start, "generateModelIntentPages is gone from the generator").toBeGreaterThan(-1)
    const next = src.indexOf("\nfunction ", start + 1)
    const body = src.slice(start, next === -1 ? src.length : next)

    const lookup = body.search(/BUILDERS\[\s*page\.id\s*\]/)
    expect(lookup, "the builder is no longer looked up by the SSOT's page id").toBeGreaterThan(-1)
    // Anchored AFTER the lookup for the reason recorded in activation-contract's probe: an
    // unscoped /throw new Error/ over a body with more than one throw is satisfied by the
    // wrong one, and stays green when the guard under test is deleted.
    expect(
      /throw new Error/.test(body.slice(lookup)),
      "an unknown page id is skipped rather than failing — the SSOT could declare a 404",
    ).toBe(true)
  })
})
