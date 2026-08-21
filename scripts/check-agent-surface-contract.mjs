#!/usr/bin/env node
/**
 * §19/§20 + GD-15 agent, human, and crawler surface contract gate.
 *
 * Three audiences read the distribution surfaces, and they have different requirements:
 *
 *   §19 AGENT  — an agent must be able to discover the whole host cohort from
 *                `/llms.txt` without scraping HTML. That requires every agent-facing
 *                document to point at `agent-surfaces.json`, and that file to actually
 *                carry the cohort.
 *
 *   §20 HUMAN  — a person must learn the platform, its support level, and one truthful
 *                action at a glance. The internal support ontology (NATIVE /
 *                CONFIG_SCAN / DISCOVERY_ONLY / DEFERRED) is a codebase enum, not
 *                public copy, so it must not appear as VISIBLE TEXT on a human page.
 *
 *   GD-15 CRAWLER — the sitemap must promise exactly the pages that exist: no dead URL,
 *                and no canonical host page left out.
 *
 * Why this file exists at all: all three properties were satisfied by hand, and none was
 * enforceable — and the third was not even satisfied. The §20 fix lives in a Handlebars
 * template and a generator string; the sitemap was a hand-maintained file that had drifted
 * into advertising 8 deleted pages. The repo's dominant fault class is a guard that cannot
 * observe its subject; the sibling defect is a property with no guard whatsoever. This
 * closes the second kind for these three.
 *
 * MEASUREMENT NOTE — why tags are stripped before searching. `badge-NATIVE` is a
 * legitimate CSS hook and must survive; `>NATIVE<` as rendered text must not. A raw grep
 * cannot tell those apart, and `grep -o` makes it worse by emitting fragments rather than
 * lines, so a following `grep -v "badge-"` filters nothing. So: strip every `<...>` first,
 * then search what remains. What remains is exactly what a human reads.
 *
 * Exit codes:
 *   0  all three contracts hold
 *   1  an agent document lost its pointer, internal ontology reached a human page, or the
 *      sitemap and the served tree disagree
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const PUBLIC = join(repoRoot, 'apps/web/public')

/* The internal support ontology. Free to appear in machine contracts and CSS class
 * names; never as text a human reads. Kept in sync with SUPPORT_CLASSES in
 * check-harness-distribution.mjs and PUBLIC_SUPPORT_LABELS in the generator. */
const INTERNAL_ONTOLOGY = ['NATIVE', 'CONFIG_SCAN', 'DISCOVERY_ONLY', 'DEFERRED']

/* Every agent-facing document. All three, not two: the pointer was present in llms.txt
 * and llms-full.txt but missing from agent-instructions.md, which is the one an agent is
 * most likely to be handed directly. */
const AGENT_DOCS = ['llms.txt', 'llms-full.txt', 'agent-instructions.md']

const MACHINE_SURFACE = 'agent-surfaces.json'

let failed = false
const fail = (m) => (console.error(`❌ ${m}`), (failed = true))
const pass = (m) => console.log(`✅ ${m}`)

console.log('\n=== Agent, Human + Crawler Surface Contract (§19/§20/GD-15) ===\n')

/* ---------- §19: the discovery chain ---------- */

const surfacePath = join(PUBLIC, MACHINE_SURFACE)
if (!existsSync(surfacePath)) {
  fail(`${MACHINE_SURFACE} does not exist — §19 discovery chain has no destination`)
} else {
  const surface = JSON.parse(readFileSync(surfacePath, 'utf8'))
  const agents = Array.isArray(surface.agents) ? surface.agents : []
  if (agents.length === 0) {
    fail(`${MACHINE_SURFACE} carries no agents[] — the chain terminates in an empty file`)
  } else {
    pass(`${MACHINE_SURFACE} publishes ${agents.length} host(s)`)
  }
  // A cohort entry an agent cannot act on is not discovery. Each needs an identity and
  // a declared support level.
  const thin = agents.filter((a) => !a.id || !a.supportClass)
  if (thin.length > 0) {
    fail(`${thin.length} host(s) in ${MACHINE_SURFACE} lack id or supportClass`)
  } else {
    pass(`every host in ${MACHINE_SURFACE} carries id + supportClass`)
  }
}

for (const doc of AGENT_DOCS) {
  const p = join(PUBLIC, doc)
  if (!existsSync(p)) {
    fail(`${doc} does not exist`)
    continue
  }
  if (!readFileSync(p, 'utf8').includes(MACHINE_SURFACE)) {
    fail(`${doc} does not point at ${MACHINE_SURFACE} — an agent reading it would have to scrape HTML`)
  } else {
    pass(`${doc} points at ${MACHINE_SURFACE}`)
  }
}

/* ---------- §20: no internal ontology in human-visible text ---------- */

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ') // attributes (badge-NATIVE, title="...") go with the tag
}

/*
 * Which pages are host pages. Derived from the SSOT, not from the directory listing.
 *
 * `harnesses/deepseek/` is a model-INTENT landing page, deliberately preserved by §6 and
 * hand-maintained — no generator writes it, and `deepseek` is not one of the SSOT's hosts.
 * It documents a model that can be driven through several harnesses, so it has no single
 * support class and must not be made to fake one. Scoping by directory listing swept it in
 * and demanded a label it cannot honestly carry.
 *
 * The leak check (§20) still covers it: an intent page must not print the internal
 * ontology either. Only the label REQUIREMENT is host-scoped.
 */
const ssot = JSON.parse(
  readFileSync(join(repoRoot, 'apps/web/data/distribution-surfaces.json'), 'utf8'),
)
const ssotHostIds = new Set(ssot.hosts.map((h) => h.id))

const harnessDir = join(PUBLIC, 'harnesses')
const humanPages = []
const hostPages = []
if (existsSync(harnessDir)) {
  const hub = join(harnessDir, 'index.html')
  if (existsSync(hub)) humanPages.push(hub)
  for (const entry of readdirSync(harnessDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const page = join(harnessDir, entry.name, 'index.html')
    if (!existsSync(page)) continue
    humanPages.push(page)
    if (ssotHostIds.has(entry.name)) hostPages.push(page)
  }
}

// Anti-vacuity: the label assertion below is scoped to hostPages, so an empty or
// mis-derived host set would make it assert nothing while still printing a checkmark.
if (hostPages.length !== ssotHostIds.size) {
  fail(
    `derived ${hostPages.length} host page(s) but the SSOT declares ${ssotHostIds.size} host(s) — ` +
      `the §20 label assertion would be scoped to the wrong set`,
  )
}

if (humanPages.length === 0) {
  fail('no harness HTML pages found — §20 cannot be measured, so it is not satisfied')
} else {
  const leaks = []
  for (const page of humanPages) {
    const text = visibleText(readFileSync(page, 'utf8'))
    const hits = INTERNAL_ONTOLOGY.filter((t) => new RegExp(`\\b${t}\\b`).test(text))
    if (hits.length > 0) leaks.push(`${relative(repoRoot, page)}: ${hits.join(', ')}`)
  }
  if (leaks.length > 0) {
    fail(
      `internal support ontology is visible to humans on ${leaks.length}/${humanPages.length} page(s):\n` +
        leaks.map((l) => `     - ${l}`).join('\n') +
        `\n   Render the public label (Auto-detects / Scan config / Guide only) instead.`,
    )
  } else {
    pass(`no internal ontology in visible text across ${humanPages.length} human page(s)`)
  }

  // The public labels must actually be present — otherwise a page that simply dropped
  // the support indicator entirely would pass the leak check while telling a human less.
  // Host pages only; see the scoping note above.
  const PUBLIC_LABELS = ['Auto-detects', 'Scan config', 'Guide only']
  const unlabeled = hostPages.filter((p) => {
    const text = visibleText(readFileSync(p, 'utf8'))
    return !PUBLIC_LABELS.some((l) => text.includes(l))
  })
  if (unlabeled.length > 0) {
    fail(
      `${unlabeled.length}/${hostPages.length} host page(s) show no public support label at all: ` +
        unlabeled.map((p) => relative(repoRoot, p)).join(', '),
    )
  } else {
    pass(`every one of ${hostPages.length} host page(s) shows a public support label`)
  }
}

/* ---------- GD-15: the sitemap must promise only what exists ---------- */

/*
 * A sitemap is a promise to crawlers about what exists. The hand-maintained version of this
 * file broke that promise in both directions at once: all 9 of its URLs sat under
 * `/harnesses/deepseek/`, 8 of them the model × harness cartesian pages that 79f3cb8
 * deliberately deleted — so it actively submitted 8 dead URLs, and the plane it submitted
 * was the one the distribution contract forbids — while listing none of the 15 canonical
 * host pages. robots.txt advertised it the whole time.
 *
 * Both directions are checked, because each hides a different failure: a dead URL is a
 * promise about a page that does not exist, and an absent host is a page that exists and
 * cannot be found.
 */
const sitemapPath = join(PUBLIC, 'harnesses/sitemap.xml')
if (!existsSync(sitemapPath)) {
  fail('harnesses/sitemap.xml does not exist, but robots.txt advertises it')
} else {
  const locs = [...readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  if (locs.length === 0) {
    fail('harnesses/sitemap.xml lists no URLs — nothing to verify, so nothing is promised')
  }

  const dead = locs.filter((u) => {
    const rel = u.replace('https://calllint.com', '')
    return ![
      join(PUBLIC, rel, 'index.html'),
      join(PUBLIC, rel),
      join(PUBLIC, rel.replace(/\/$/, '') + '/index.html'),
    ].some((c) => existsSync(c))
  })
  if (dead.length > 0) {
    fail(
      `sitemap advertises ${dead.length}/${locs.length} URL(s) that do not exist:\n` +
        dead.map((u) => `     - ${u}`).join('\n'),
    )
  } else {
    pass(`all ${locs.length} sitemap URL(s) resolve to a served page`)
  }

  const absent = [...ssotHostIds].filter(
    (id) => !locs.some((l) => l.includes(`/harnesses/${id}`)),
  )
  if (absent.length > 0) {
    fail(`${absent.length} SSOT host(s) are absent from the sitemap: ${absent.join(', ')}`)
  } else {
    pass(`all ${ssotHostIds.size} SSOT host(s) appear in the sitemap`)
  }
}

/* ---------- legacy URLs must be forwarded, not merely deleted ----------
 *
 * The sitemap gate above stops us advertising pages we deleted. This is the other half of the
 * same promise, and it points the other way: eight `/harnesses/deepseek/<host>` URLs are live
 * and indexed today, and this cohort replaces them. Deleting a page and retiring the inbound
 * links to it are two obligations; the sitemap covers only the first.
 *
 * PLACEMENT IS AN ASSERTION, NOT A DETAIL. Cloudflare Pages parses `_redirects` only at the
 * output root. A copy under `harnesses/` is not a rule set — it is a text file served at
 * /harnesses/_redirects, i.e. a guard that cannot observe its subject. So this checks both
 * that the real file is present and that the plausible-but-inert one is not.
 */
{
  const redirectsPath = join(PUBLIC, '_redirects')
  const misplaced = join(PUBLIC, 'harnesses/_redirects')

  if (existsSync(misplaced)) {
    fail('apps/web/public/harnesses/_redirects exists — Pages only parses _redirects at the output root, so that file redirects nothing')
  } else {
    pass('no inert _redirects copy outside the output root')
  }

  if (!existsSync(redirectsPath)) {
    fail('apps/web/public/_redirects does not exist — the legacy /harnesses/deepseek/* URLs would 404 with no forwarding')
  } else {
    const rules = readFileSync(redirectsPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))
      .map((l) => {
        const [from, to, code] = l.trim().split(/\s+/)
        return { from, to, code }
      })

    /* Totality in the direction that matters: every legacy path the SSOT records must be
     * forwarded. The reverse direction is not asserted, because the generator emits a second
     * `.html` rule per entry — Pages served each page under both spellings. */
    const declared = ssot.hosts.flatMap((h) => h.legacyPaths ?? [])
    const unforwarded = declared.filter((p) => !rules.some((r) => r.from === p))
    if (unforwarded.length > 0) {
      fail(`${unforwarded.length} SSOT legacyPath(s) have no redirect: ${unforwarded.join(', ')}`)
    } else if (declared.length === 0) {
      fail('no host declares legacyPaths, yet /harnesses/deepseek/* is live in production — the SSOT has lost the history')
    } else {
      pass(`all ${declared.length} SSOT legacyPath(s) are forwarded (${rules.length} rules incl. .html spellings)`)
    }

    /* A redirect into a 404 is worse than the 404 it replaced: it costs a round trip and
     * launders the failure into a page that looks intentional. */
    const intoNothing = rules.filter(
      (r) => !existsSync(join(PUBLIC, r.to.replace(/\/$/, ''), 'index.html')),
    )
    if (intoNothing.length > 0) {
      fail(
        `${intoNothing.length} redirect(s) target a page that is not served:\n` +
          intoNothing.map((r) => `     - ${r.from} → ${r.to}`).join('\n'),
      )
    } else {
      pass(`all ${rules.length} redirect target(s) resolve to a served page`)
    }

    /* A rule whose source is also a live page makes that page unreachable. Pages applies
     * redirects before serving static assets, so this shadows rather than falls through. */
    const shadowing = rules.filter((r) =>
      [join(PUBLIC, r.from), join(PUBLIC, r.from, 'index.html')].some((c) => existsSync(c)),
    )
    if (shadowing.length > 0) {
      fail(
        `${shadowing.length} redirect(s) shadow a page that is still served:\n` +
          shadowing.map((r) => `     - ${r.from}`).join('\n'),
      )
    } else {
      pass('no redirect shadows a live page')
    }

    /* 302 is the Pages default when no code is given, and a temporary redirect leaves the
     * search index pointing at the dead URL indefinitely. */
    const notPermanent = rules.filter((r) => r.code !== '301')
    if (notPermanent.length > 0) {
      fail(`${notPermanent.length} redirect(s) are not 301: ${notPermanent.map((r) => r.from).join(', ')}`)
    } else {
      pass(`all ${rules.length} redirect(s) are 301 (permanent)`)
    }

    /* A model-intent landing page is a preserved surface, not legacy. Redirecting one would
     * delete a page the contract keeps — and would do it invisibly, since the file stays. */
    const preserved = (ssot.modelIntentLandingPages ?? []).map((p) => p.path.replace(/\/$/, ''))
    const clobbered = rules.filter((r) => preserved.includes(r.from.replace(/\/$/, '')))
    if (clobbered.length > 0) {
      fail(`${clobbered.length} redirect(s) clobber a preserved landing page: ${clobbered.map((r) => r.from).join(', ')}`)
    } else {
      pass(`all ${preserved.length} preserved landing page(s) remain directly reachable`)
    }
  }
}

/* ---------- the SSOT's own $schema pointer must resolve, and must validate ----------
 *
 * The same defect as `agent-surfaces.json` below, one layer up and easier to miss: the SSOT
 * declared `"$schema": "./distribution-surfaces.schema.json"` and that file did not exist.
 * Relative pointers do not 404 loudly — nothing fetches them — so the file read as
 * schema-governed while being governed by nothing, and a prior report recorded it as closed.
 *
 * This is the gate that makes the schema load-bearing. Writing the schema is what caught that
 * `priority` is `"P0"` and not an integer, and that `authoritySurfaces` has 12 members rather
 * than the 6 anyone would guess.
 */
{
  const pointer = ssot.$schema
  if (typeof pointer !== 'string') {
    fail('the SSOT declares no $schema — its shape is then whatever the last edit made it')
  } else if (/^https?:\/\//.test(pointer)) {
    fail(`the SSOT $schema is absolute (${pointer}); it must be a repo-relative path that a checkout can resolve offline`)
  } else {
    const schemaFile = join(repoRoot, 'apps/web/data', pointer)
    if (!existsSync(schemaFile)) {
      fail(`the SSOT $schema points at ${pointer}, but ${relative(repoRoot, schemaFile)} does not exist`)
    } else {
      pass(`the SSOT $schema ${pointer} resolves on disk`)

      const { default: Ajv } = await import('ajv')
      const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
      const validate = ajv.compile(JSON.parse(readFileSync(schemaFile, 'utf8')))
      if (validate(ssot)) {
        pass('distribution-surfaces.json validates against its own schema')
      } else {
        const errs = (validate.errors ?? [])
          .slice(0, 8)
          .map((e) => `     - ${e.instancePath || '/'} ${e.message}`)
          .join('\n')
        fail(`distribution-surfaces.json violates its own schema:\n${errs}`)
      }
    }
  }
}

/* ---------- the published $schema pointer must resolve, and must validate ----------
 *
 * `agent-surfaces.json` advertises an absolute `$schema` URL. That pointer was dangling:
 * it named `https://calllint.com/schemas/agent-surfaces.v1.json`, nothing served that path,
 * and no validator read it — so the machine surface claimed to be schema-governed while
 * being governed by nothing. Two separate assertions, because they fail for different
 * reasons: a served-but-wrong schema and a correct-but-404 schema are different bugs.
 *
 * The Pages project is static-only, so a file under `public/` IS its URL; `_routes.json`
 * only routes Functions paths and deliberately does not list this one. */
{
  const surface = JSON.parse(readFileSync(surfacePath, 'utf8'))
  const schemaUrl = surface.$schema

  if (typeof schemaUrl !== 'string' || schemaUrl.length === 0) {
    fail(`${MACHINE_SURFACE} declares no $schema`)
  } else {
    const path = schemaUrl.replace(/^https?:\/\/[^/]+/, '')
    const schemaFile = join(PUBLIC, path)
    if (!existsSync(schemaFile)) {
      fail(`$schema points at ${schemaUrl}, but ${relative(repoRoot, schemaFile)} is not served`)
    } else {
      pass(`$schema ${path} resolves to a served file`)

      /* Validate with the repo's existing ajv rather than hand-rolling checks. `strict:
       * false` because the schema uses draft-07 `format` keywords ajv treats as unknown
       * without a formats package; the structural assertions are what matter here. The
       * no-op logger suppresses ajv's per-keyword "unknown format" chatter, which would
       * otherwise print 8 lines between this gate's two assertions and bury them. */
      const { default: Ajv } = await import('ajv')
      const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
      const validate = ajv.compile(JSON.parse(readFileSync(schemaFile, 'utf8')))
      if (validate(surface)) {
        pass(`${MACHINE_SURFACE} validates against its own published schema`)
      } else {
        const errs = (validate.errors ?? [])
          .slice(0, 8)
          .map((e) => `     - ${e.instancePath || '/'} ${e.message}`)
          .join('\n')
        fail(`${MACHINE_SURFACE} violates its own published schema:\n${errs}`)
      }
    }
  }
}

console.log('')
if (failed) {
  console.error('❌ Agent + human surface contract FAILED')
  process.exit(1)
}
console.log('✅ Agent + human surface contract PASSED')
process.exit(0)