#!/usr/bin/env node
/**
 * Served web structure gate.
 *
 * The defect this exists for: `apps/web/public/styles.css` shipped with an UNCLOSED
 * `.topic-nav {` rule. Under CSS nesting an unclosed rule does not fail loudly — every
 * following top-level rule silently becomes a DESCENDANT of it. `.demo-split` became
 * `.topic-nav .demo-split`, and since `topic-nav` appears zero times in `index.html`, the
 * homepage's entire demo + scenario block rendered with no styling at all. Nothing caught
 * it: browsers recover, the copy gates read text not structure, and the presentation lock
 * measures `apps/web/styles/tokens.css`, a different file.
 *
 * A visual review can only report "this looks wrong". This reports WHERE and WHY, so a
 * structural break is never again diagnosed as a design problem.
 *
 * Checks:
 *   1. Brace balance per stylesheet — depth never goes negative, ends at exactly 0.
 *   2. Every served HTML page's stylesheet <link> resolves to a file that exists.
 *   3. No served HTML references a class that its stylesheets never define, where that
 *      class is one of the LAYOUT CONTRACT classes (grid/card/flex containers). A typo'd
 *      grid class is invisible in review — the element just stacks.
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks failed
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const PUBLIC_ROOT = "apps/web/public"

let exitCode = 0
const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  exitCode = 1
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

/**
 * Strip CSS comments and quoted strings, replacing each with equal-length whitespace so
 * byte offsets (and therefore reported line numbers) stay exact.
 *
 * Required, not defensive: `content: "}"` and `/* } *\/` are both legal CSS and both would
 * register as a closing brace to a naive counter. A counter that miscounts legal CSS gets
 * disabled by the first false positive, which is how a gate stops being enforced.
 */
function blankNonCode(css) {
  const out = Array.from(css)
  let i = 0
  const n = css.length
  while (i < n) {
    const c = css[i]
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2)
      const stop = end === -1 ? n : end + 2
      for (let k = i; k < stop; k++) if (out[k] !== "\n") out[k] = " "
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      let k = i + 1
      while (k < n) {
        if (css[k] === "\\") {
          k += 2
          continue
        }
        if (css[k] === quote || css[k] === "\n") break
        k++
      }
      const stop = Math.min(k + 1, n)
      for (let j = i; j < stop; j++) if (out[j] !== "\n") out[j] = " "
      i = stop
      continue
    }
    i++
  }
  return out.join("")
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length

console.log("Served web structure gate")
console.log("")

// 1. Brace balance for every served stylesheet.
{
  const cssFiles = fs.existsSync(path.join(repoRoot, PUBLIC_ROOT))
    ? fs
        .readdirSync(path.join(repoRoot, PUBLIC_ROOT), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".css"))
        .map((e) => `${PUBLIC_ROOT}/${e.name}`)
        .sort()
    : []
  if (cssFiles.length === 0) fail("no served stylesheet found under apps/web/public — check 1 cannot run")
  for (const rel of cssFiles) {
    const raw = fs.readFileSync(path.join(repoRoot, rel), "utf8")
    const code = blankNonCode(raw)
    let depth = 0
    let opened = 0
    let closed = 0
    /** Stack of offsets of currently-open braces, so an unclosed rule names its own line. */
    const stack = []
    let negativeAt = -1
    for (let i = 0; i < code.length; i++) {
      if (code[i] === "{") {
        depth++
        opened++
        stack.push(i)
      } else if (code[i] === "}") {
        depth--
        closed++
        stack.pop()
        if (depth < 0 && negativeAt === -1) negativeAt = i
      }
    }
    if (negativeAt !== -1) {
      fail(`${rel}: stray '}' at line ${lineOf(raw, negativeAt)} — depth went negative (${opened} open / ${closed} close)`)
      continue
    }
    if (depth !== 0) {
      const at = stack[0]
      const selector = raw.slice(raw.lastIndexOf("\n", at - 1) + 1, at).trim() || "(unknown selector)"
      fail(
        `${rel}: ${depth} unclosed rule(s) (${opened} open / ${closed} close). ` +
          `First unclosed: '${selector}' at line ${lineOf(raw, at)}. ` +
          `Every rule after it is silently nested inside it.`,
      )
      continue
    }
    ok(`${rel}: brace-balanced (${opened} open / ${closed} close)`)
  }
}

/** Served HTML pages, depth 1 (generated trees have their own gates). */
const htmlFiles = fs.existsSync(path.join(repoRoot, PUBLIC_ROOT))
  ? fs
      .readdirSync(path.join(repoRoot, PUBLIC_ROOT), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".html"))
      .map((e) => `${PUBLIC_ROOT}/${e.name}`)
      .sort()
  : []

// 2. Every stylesheet <link> resolves.
{
  let allResolve = true
  let checked = 0
  for (const rel of htmlFiles) {
    const html = fs.readFileSync(path.join(repoRoot, rel), "utf8")
    const re = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi
    let m
    while ((m = re.exec(html)) !== null) {
      const href = /href=["']([^"']+)["']/i.exec(m[0])?.[1]
      if (!href || /^https?:\/\//i.test(href)) continue
      checked++
      const target = path.join(repoRoot, PUBLIC_ROOT, href.replace(/^\//, "").split("?")[0])
      if (!fs.existsSync(target)) {
        fail(`${rel}: stylesheet href does not resolve: ${href}`)
        allResolve = false
      }
    }
  }
  if (allResolve) ok(`all ${checked} local stylesheet link(s) across ${htmlFiles.length} page(s) resolve`)
}

// 3. Layout-contract classes used in HTML must be defined in CSS.
//    Scoped to layout containers on purpose: a missing `.agents-grid-3` silently degrades to
//    a single stacked column, which reads as a design choice rather than a defect. Non-layout
//    classes are excluded — decorative/JS-hook classes legitimately have no rule.
{
  const cssText = fs
    .readdirSync(path.join(repoRoot, PUBLIC_ROOT), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".css"))
    .map((e) => fs.readFileSync(path.join(repoRoot, PUBLIC_ROOT, e.name), "utf8"))
    .join("\n")
  const definedClasses = new Set()
  {
    const re = /\.(-?[_a-zA-Z][\w-]*)/g
    let m
    const code = blankNonCode(cssText)
    while ((m = re.exec(code)) !== null) definedClasses.add(m[1])
  }
  const LAYOUT_CLASS = /(?:^|-)(?:grid|row|col|card|split|stack|flex)(?:-|$)/
  let undefinedFound = false
  let layoutClassCount = 0
  for (const rel of htmlFiles) {
    const html = fs.readFileSync(path.join(repoRoot, rel), "utf8")
    const used = new Set()
    const re = /class=["']([^"']+)["']/gi
    let m
    while ((m = re.exec(html)) !== null) for (const c of m[1].trim().split(/\s+/)) if (c) used.add(c)
    for (const c of [...used].sort()) {
      if (!LAYOUT_CLASS.test(c)) continue
      layoutClassCount++
      if (!definedClasses.has(c)) {
        fail(`${rel}: layout class '.${c}' is used but never defined in any served stylesheet`)
        undefinedFound = true
      }
    }
  }
  if (!undefinedFound) ok(`all ${layoutClassCount} layout-class use(s) resolve to a CSS rule`)
}

console.log("")
if (exitCode === 0) {
  console.log("Served web structure gate: PASS")
} else {
  console.log("Served web structure gate: FAIL — see violations above")
}
process.exit(exitCode)
