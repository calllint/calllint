#!/usr/bin/env tsx
/**
 * Phase 2.4 Gate 2.4-B — the five-second-test PANEL RECORDER (new14 §"人类认知").
 *
 * Gate 2.4-B is the one gate an agent cannot close. Its threshold is "≥90% of
 * HUMANS name the target / consequence / action within five seconds", and no
 * amount of code can produce that number honestly. So this script does not
 * measure anything: it ADMINISTERS the session and TRANSCRIBES what a real
 * operator types, into the same store `phase24Eval.ts` already reads.
 *
 * The boundary is enforced structurally, not by promise:
 *   • every response requires interactive stdin — with no TTY the script refuses
 *     rather than defaulting, so a CI run or an agent cannot manufacture a panel;
 *   • `--validate` never writes, and is the mode CI would use;
 *   • the operator's verdict per question is typed, never inferred from anything
 *     the page or this script computes.
 *
 * WHY THE PAGE IS SERVED OVER HTTP (PR P-4b). A five-second test measures a
 * RENDERED page. Since P-4b the emitted page carries `<link rel="stylesheet"
 * href="/styles/tokens.css">` — a ROOTED reference that resolves only against an
 * origin. Opened as a `file://` path it resolves to the filesystem root, 404s,
 * and the page renders with no visual hierarchy at all. That artifact is not what
 * any user sees, so recognition measured against it would not be evidence about
 * the shipped page. This script therefore serves the committed tree itself and
 * PREFLIGHTS that every stylesheet actually resolves, instead of trusting an
 * instruction the operator can silently not follow.
 *
 * Modes:
 *   --validate            check the committed store's integrity. Writes nothing.
 *   --record <slug>       run one participant's session and append the result.
 *   --status              print how far the panel is from the gate's floor.
 *   --serve               serve the committed tree and print the URLs. No writes.
 *
 * Options:
 *   --base <origin>       show the page from this origin instead of an ephemeral
 *                         local server (e.g. https://calllint.com, which also
 *                         proves the deploy matches the committed bytes).
 *
 * Exit codes: 0 ok · 1 invalid store / artifact mismatch · 2 refused (no TTY /
 * bad usage / page unreachable).
 */
import { createHash } from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"
import {
  FIVE_SECOND_QUESTIONS,
  FIVE_SECOND_THRESHOLD,
  FIVE_SECOND_MIN_PANEL,
  measureFiveSecondPanel,
  partitionPanelFreshness,
  stylesheetHrefs,
  auditShownArtifact,
  extractCapsuleAnswers,
  type FiveSecondPanelStore,
  type FiveSecondResponse,
} from "@calllint/trust-index"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..")
const storePath = path.join(repoRoot, "artifacts", "phase-2.4", "five-second-panel-store.json")
/** The served site root — what a browser sees as `/`. */
const publicRoot = path.join(repoRoot, "apps", "web", "public")
const served = path.join(publicRoot, "install")

const sha256 = (b: Buffer | string): string =>
  `sha256:${createHash("sha256").update(b).digest("hex")}`

/** Digest of every served install page, keyed by canonicalSlug (cohort/name). */
function servedPageDigests(): Map<string, string> {
  const out = new Map<string, string>()
  if (!fs.existsSync(served)) return out
  for (const cohort of fs.readdirSync(served)) {
    const dir = path.join(served, cohort)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const name of fs.readdirSync(dir)) {
      const page = path.join(dir, name, "index.html")
      if (fs.existsSync(page)) out.set(`${cohort}/${name}`, sha256(fs.readFileSync(page)))
    }
  }
  return out
}

/** The question wording the operator must read aloud, unchanged between sessions. */
const PROMPTS: Record<(typeof FIVE_SECOND_QUESTIONS)[number], string> = {
  target: "What would be installed?",
  consequence: "What is the most important thing it would be able to do?",
  action: "What would you do next?",
}

const readStore = (): FiveSecondPanelStore => JSON.parse(fs.readFileSync(storePath, "utf8")) as FiveSecondPanelStore

// --- showing the page the way a user sees it ---------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml",
}

/**
 * An ephemeral read-only static server over the COMMITTED tree, bound to
 * loopback on an OS-assigned port. It exists so the operator shows the page the
 * way a browser resolves it (rooted `/styles/...` included) with no external
 * dependency and no build step. No authentication: it is loopback-only, GET-only,
 * and serves exactly the bytes already published at calllint.com.
 */
async function serveCommittedTree(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end()
      return
    }
    const rel = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname)
    let file = path.join(publicRoot, rel)
    // Traversal guard: a resolved path must stay inside the served root.
    if (path.relative(publicRoot, file).startsWith("..")) {
      res.writeHead(403).end()
      return
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html")
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end(`404 ${rel}`)
      return
    }
    const body = fs.readFileSync(file)
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(body.byteLength),
    })
    res.end(req.method === "HEAD" ? undefined : body)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

interface Preflight {
  readonly pageUrl: string
  /** sha256 of the HTML actually fetched — recorded as the response's provenance. */
  readonly shownDigest: string
  readonly stylesheets: readonly string[]
  /** What the page actually says, so the operator grades against it, not memory. */
  readonly answers: Readonly<Record<(typeof FIVE_SECOND_QUESTIONS)[number], string | null>>
}

/**
 * Prove the artifact about to be shown is the artifact we publish, and that it
 * will actually render styled. Three independent facts, each able to fail alone:
 *   1. the page is reachable at the URL a user would visit;
 *   2. its bytes are identical to the committed page (so the measurement is
 *      attributable to a specific, reviewable artifact);
 *   3. every stylesheet it references resolves with non-empty CSS — the check
 *      that a `file://` session, or a deploy that dropped the asset, fails.
 * Refusing here is the point: a session run against an unstyled page would
 * produce numbers that look like evidence and are not.
 */
async function preflight(slug: string, base: string): Promise<Preflight> {
  const pageUrl = `${base.replace(/\/+$/, "")}/install/${slug}/`
  const res = await fetch(pageUrl, { redirect: "follow" })
  if (!res.ok) throw new Error(`${pageUrl} → HTTP ${res.status} (the page a participant would open is not reachable)`)
  const html = Buffer.from(await res.arrayBuffer())
  const servedHtml = html.toString("utf8")
  // Fetch what the rule needs, then let the PURE audit decide.
  const bodies = new Map<string, string | null>()
  for (const href of stylesheetHrefs(servedHtml)) {
    try {
      const css = await fetch(new URL(href, pageUrl).toString(), { redirect: "follow" })
      bodies.set(href, css.ok ? await css.text() : null)
    } catch {
      bodies.set(href, null)
    }
  }
  const audit = auditShownArtifact({
    servedHtml,
    committedHtml: fs.readFileSync(path.join(served, slug, "index.html"), "utf8"),
    stylesheetBodies: bodies,
  })
  if (!audit.ok) throw new Error(`${pageUrl}\n    ${audit.problems.join("\n    ")}`)
  return {
    pageUrl,
    shownDigest: sha256(html),
    stylesheets: audit.stylesheets,
    answers: extractCapsuleAnswers(servedHtml),
  }
}

/**
 * Integrity rules for the committed store. These are about the RECORD, never
 * about whether an answer was right: a store the gate reads must be well-formed,
 * must point at pages we actually serve, and must not let one participant's
 * repeated session inflate the denominator unnoticed.
 */
function validate(store: FiveSecondPanelStore): string[] {
  const errs: string[] = []
  if (store.schema !== "calllint.five-second-panel.v0") errs.push(`unknown schema ${String(store.schema)}`)
  if (!Array.isArray(store.responses)) return [...errs, "responses is not an array"]

  const seen = new Set<string>()
  store.responses.forEach((r, i) => {
    const at = `responses[${i}]`
    if (typeof r.participant !== "string" || r.participant.trim() === "") errs.push(`${at}: empty participant`)
    if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) errs.push(`${at}: at is not an ISO timestamp`)
    // Form only — that a slug was recorded, never whether we still serve it. Whether
    // the page still exists is CURRENCY, not integrity: a response naming a page we
    // have since stopped serving is a true record of a real session, and calling it
    // malformed confuses provenance with currency (ADR 0077 D1). `existsSync` was
    // also the WEAKER reader of that question — blind to a page merely edited —
    // while `partitionPanelFreshness` reports removal and edit alike, and fails
    // closed by excluding both. It stays the single reader of serving state.
    //
    // It also made the store unappendable: `record()` validates the whole
    // prospective store, so three unserved historical subjects refused every new
    // response — the check blocked the ten human sessions that are the only way to
    // close the gate it was guarding.
    if (typeof r.canonicalSlug !== "string" || r.canonicalSlug.trim() === "") {
      errs.push(`${at}: canonicalSlug ${String(r.canonicalSlug)} is not a slug`)
    }
    for (const q of FIVE_SECOND_QUESTIONS) {
      if (typeof r.correct?.[q] !== "boolean") errs.push(`${at}: correct.${q} must be a boolean the operator typed`)
    }
    // Provenance (PR P-4b): which artifact, served from where. Without these a
    // response cannot be checked against the page we serve today.
    if (typeof r.shownFrom !== "string" || !/^https?:\/\//.test(r.shownFrom)) {
      errs.push(`${at}: shownFrom must be the http(s) origin the page was shown from — a file:// session renders unstyled`)
    }
    if (typeof r.shownDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(r.shownDigest)) {
      errs.push(`${at}: shownDigest must be the sha256 of the HTML the participant was shown`)
    }
    const key = `${r.participant} ${r.canonicalSlug}`
    if (seen.has(key)) errs.push(`${at}: duplicate — ${r.participant} already has a recorded session for ${r.canonicalSlug}`)
    seen.add(key)
  })
  return errs
}

/** How far the recorded panel is from the gate's floor. Reports, never rounds up. */
function status(store: FiveSecondPanelStore): string {
  // Only responses whose page still matches what we serve count: recognition is
  // evidence about one artifact, so a moved page invalidates it rather than
  // downgrading it.
  const { fresh, stale } = partitionPanelFreshness(store, servedPageDigests())
  const m = measureFiveSecondPanel({ ...store, responses: fresh })
  const lines = [
    `participants: ${m.participants} (need ≥ ${FIVE_SECOND_MIN_PANEL})`,
    `responses:    ${m.responses}`,
  ]
  if (stale.length > 0) {
    lines.push(
      `stale:        ${stale.length} response(s) measured a page that has since changed — they do not count:`,
      ...stale.map(
        (s) =>
          `  ${s.participant} @ ${s.canonicalSlug} — shown ${s.shownDigest.slice(0, 14)}…, now ${s.currentDigest === null ? "PAGE REMOVED" : `${s.currentDigest.slice(0, 14)}…`}`,
      ),
    )
  }
  for (const q of FIVE_SECOND_QUESTIONS) {
    const r = m.recognition[q]
    lines.push(`  ${q.padEnd(12)} ${r === null ? "no data" : `${(r * 100).toFixed(1)}% (need ≥ ${FIVE_SECOND_THRESHOLD * 100}%)`}`)
  }
  const short = FIVE_SECOND_MIN_PANEL - m.participants
  lines.push(
    m.participants < FIVE_SECOND_MIN_PANEL
      ? `→ PENDING_HUMAN_PANEL: ${short} more participant${short === 1 ? "" : "s"} needed before the 90% claim can be made at all.`
      : "→ panel size met; Gate 2.4-B now turns on the recognition rates above.",
  )
  return lines.join("\n")
}

const ask = (rl: readline.Interface, q: string): Promise<string> => new Promise((res) => rl.question(q, res))

/** Read a strict yes/no. Anything else re-asks — no silent default either way. */
async function askYesNo(rl: readline.Interface, q: string): Promise<boolean> {
  for (;;) {
    const a = (await ask(rl, `${q} [y/n] `)).trim().toLowerCase()
    if (a === "y" || a === "yes") return true
    if (a === "n" || a === "no") return false
    console.log("  please answer y or n — this is the recorded measurement, so it is not defaulted.")
  }
}

async function record(slug: string, baseOverride: string | null): Promise<number> {
  if (!process.stdin.isTTY) {
    console.error("refusing to record without an interactive terminal — Gate 2.4-B data must come from a human, not a pipe.")
    return 2
  }
  const page = path.join(served, slug, "index.html")
  if (!fs.existsSync(page)) {
    console.error(`no served install page for ${slug} (looked for ${path.relative(repoRoot, page)})`)
    return 2
  }
  const store = readStore()
  // Serve the committed tree unless the operator points at a real origin.
  const local = baseOverride === null ? await serveCommittedTree() : null
  const base = baseOverride ?? (local as { origin: string }).origin
  let shown: Preflight
  try {
    shown = await preflight(slug, base)
  } catch (e) {
    await local?.close()
    console.error(`refusing to record — ${(e as Error).message}`)
    return 2
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const participant = (await ask(rl, "participant id (initials or a pseudonym, not a real name): ")).trim()
    if (participant === "") {
      console.error("empty participant id — nothing recorded.")
      return 2
    }
    if (store.responses.some((r) => r.participant === participant && r.canonicalSlug === slug)) {
      console.error(`${participant} already has a recorded session for ${slug} — nothing recorded.`)
      return 2
    }
    console.log(
      [
        "",
        "Protocol:",
        `  1. open   ${shown.pageUrl}`,
        `            (verified: served bytes match the committed page; ${shown.stylesheets.length} stylesheet(s) resolve)`,
        "  2. show it for FIVE seconds, then hide it",
        "  3. ask the three questions below and mark each answer",
        "",
        "  Do not read the page aloud, do not scroll, and do not answer follow-up",
        "  questions before all three are asked — those all leak the answers.",
        "",
        "Grading key — read from THIS page, so 'correct' means the participant named",
        "what the page says. Accept paraphrase; reject a right guess that the page",
        "does not support.",
        `  target      ${shown.answers.target ?? "(absent — do not run this page)"}`,
        `  consequence ${shown.answers.consequence ?? "(absent — do not run this page)"}`,
        `  action      ${shown.answers.action ?? "(absent — do not run this page)"}`,
        "",
      ].join("\n"),
    )
    await ask(rl, "press Enter once the page has been shown and hidden… ")

    const correct: Record<string, boolean> = {}
    for (const q of FIVE_SECOND_QUESTIONS) {
      console.log(`\n  ask: "${PROMPTS[q]}"`)
      correct[q] = await askYesNo(rl, "  did they answer correctly?")
    }
    const response: FiveSecondResponse = {
      participant,
      canonicalSlug: slug,
      // Wall-clock is correct here: this records WHEN a human was actually asked.
      at: new Date().toISOString(),
      correct: correct as FiveSecondResponse["correct"],
      // A local ephemeral port is provenance noise; record the origin's shape, not
      // the port, so the store stays stable across sessions.
      shownFrom: local === null ? new URL(base).origin : "http://127.0.0.1",
      shownDigest: shown.shownDigest,
    }
    const next: FiveSecondPanelStore = { ...store, responses: [...store.responses, response] }
    const errs = validate(next)
    if (errs.length > 0) {
      console.error(`refusing to write — the result would be invalid:\n  ${errs.join("\n  ")}`)
      return 1
    }
    fs.writeFileSync(storePath, JSON.stringify(next, null, 2) + "\n", "utf8")
    console.log(`\nrecorded. ${path.relative(repoRoot, storePath)} now holds ${next.responses.length} response(s).\n`)
    console.log(status(next))
    return 0
  } finally {
    rl.close()
    await local?.close()
  }
}

// --- modes -------------------------------------------------------------------

const argv = process.argv.slice(2)
const store = readStore()
const flagValue = (flag: string): string | null => {
  const i = argv.indexOf(flag)
  if (i === -1) return null
  const v = argv[i + 1]
  return v === undefined || v.startsWith("--") ? null : v
}
const base = flagValue("--base")

if (argv.includes("--serve")) {
  // Keep one server up for a whole session, so several participants can be shown
  // pages without restarting anything. Ctrl-C ends it.
  const { origin } = await serveCommittedTree()
  const slugs = [...servedPageDigests().keys()].sort()
  console.log(`serving the committed tree at ${origin} (loopback only, GET only)\n`)
  console.log(`${slugs.length} install page(s), e.g.`)
  for (const s of slugs.slice(0, 3)) console.log(`  ${origin}/install/${s}/`)
  console.log("\nCtrl-C to stop.")
} else if (argv.includes("--record")) {
  const slug = flagValue("--record")
  if (slug === null) {
    console.error("usage: pnpm eval:phase-2.4:panel:record <canonicalSlug> [--base <origin>]")
    console.error("   e.g. pnpm eval:phase-2.4:panel:record mcp-registry/ai.adeu-adeu")
    process.exit(2)
  }
  process.exit(await record(slug, base))
} else {

  const errs = validate(store)
  if (errs.length > 0) {
    console.error(`${path.relative(repoRoot, storePath)} is invalid:`)
    for (const e of errs) console.error(`  - ${e}`)
    process.exit(1)
  }

  if (argv.includes("--validate")) {
    console.log(`panel store OK — ${store.responses.length} response(s), schema ${store.schema}`)
    // ADR 0077 D3: dropping the `existsSync` integrity rule must not make its subject
    // invisible. Removal and edit are both reported here, and neither is an error:
    // the record is sound, the WORLD moved. What it costs the gate is stated by
    // `--status` and by the committed `human-five-second-test.json`.
    const { fresh, stale } = partitionPanelFreshness(store, servedPageDigests())
    console.log(`  fresh: ${fresh.length} · stale: ${stale.length} (stale responses do not count toward Gate 2.4-B)`)
    for (const s of stale) {
      console.log(
        `  - ${s.participant} @ ${s.canonicalSlug} — ${s.currentDigest === null ? "PAGE NO LONGER SERVED" : "page edited since the session"}`,
      )
    }
    process.exit(0)
  }

  console.log(status(store))
  process.exit(0)
}
