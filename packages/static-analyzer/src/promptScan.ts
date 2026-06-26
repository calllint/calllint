import type { Evidence } from "@calllint/types"

/**
 * Model-directed instruction patterns indicative of tool poisoning / prompt
 * injection (T01/T02/T13/T14). The single source of truth shared by the
 * config-metadata prompt detector (prompt.poisoning) and the document-surface
 * detector (prompt.surface-instructions), so both flag the same phrases.
 */
export const POISON_PATTERNS: readonly string[] = [
  "ignore previous instructions",
  "ignore all previous instructions",
  "disregard previous instructions",
  "do not tell the user",
  "do not inform the user",
  "without telling the user",
  "secretly",
  "always call this tool first",
  "call this tool before",
  "before using other tools",
  "before answering",
  "read all files",
  "send the full workspace",
  "include the full workspace",
  "include environment variables",
  "exfiltrate",
  "override system",
  "override the system prompt",
  "you are now",
]

/** Find model-directed phrases in text. Returns matched (lowercased) patterns. */
export function findPoisonPhrases(text: string | undefined): string[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const hits: string[] = []
  for (const pattern of POISON_PATTERNS) {
    if (lower.includes(pattern)) hits.push(pattern)
  }
  return hits
}

/**
 * Hidden / invisible code points, defined by NUMBER (never as literal invisible
 * characters in the source — a security scanner must be auditable and its own
 * source must not contain the bytes it hunts for).
 *
 *   200B ZWSP · 200C ZWNJ · 200D ZWJ · 2060 word joiner · FEFF BOM/ZWNBSP
 */
const INVISIBLE_CODE_POINTS = [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]
/** 202A-202E bidi embeddings/overrides + 2066-2069 isolates (Trojan Source). */
const BIDI_RANGES: [number, number][] = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
]
/** U+E0000–U+E007F tag characters: invisible, can encode ASCII a model reads. */
const TAG_RANGE: [number, number] = [0xe0000, 0xe007f]

function hasInvisible(text: string): boolean {
  for (const ch of text) {
    if (INVISIBLE_CODE_POINTS.includes(ch.codePointAt(0)!)) return true
  }
  return false
}

function inAnyRange(text: string, ranges: [number, number][]): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    for (const [lo, hi] of ranges) {
      if (cp >= lo && cp <= hi) return true
    }
  }
  return false
}

/**
 * Categories of hidden / obfuscated content in text — structural properties a
 * literal-phrase matcher cannot catch (content that reaches a model but is
 * invisible or misleading in a rendered surface). Returns the category labels;
 * NEVER the raw bytes, so a report is safe to render.
 */
export function findHiddenContent(text: string | undefined): string[] {
  if (!text) return []
  const categories: string[] = []
  if (hasInvisible(text)) categories.push("zero-width or invisible characters")
  if (inAnyRange(text, BIDI_RANGES)) {
    categories.push("Unicode bidirectional override controls")
  }
  if (inAnyRange(text, [TAG_RANGE])) {
    categories.push("invisible tag-character ASCII smuggling")
  }
  if (/<!--[\s\S]*?-->/.test(text)) categories.push("embedded HTML/XML comment")
  return categories
}

/** Build a poison-phrase evidence entry (snippet = the matched pattern). */
export function poisonEvidence(
  pattern: string,
  source: { type: Evidence["type"]; path?: string; key: string },
): Evidence {
  return { type: source.type, path: source.path, key: source.key, snippet: pattern }
}

/** Build a hidden-content evidence entry (snippet = the category, never bytes). */
export function hiddenEvidence(
  category: string,
  source: { type: Evidence["type"]; path?: string; key: string },
): Evidence {
  return { type: source.type, path: source.path, key: source.key, snippet: category }
}
