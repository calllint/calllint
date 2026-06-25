/**
 * A best-effort source-position index for a JSON config. Maps a dot-joined key
 * path (e.g. "mcpServers.filesystem.args") to the 1-based line/column of that
 * KEY in the source text. Used to enrich finding evidence with real editor
 * positions AFTER the verdict is decided — it never affects parsing or verdicts.
 *
 * This is a standalone scanner, not a replacement for JSON.parse: the verdict
 * path still parses strictly. It is deliberately tolerant — on anything it cannot
 * scan it returns whatever it has gathered so far rather than throwing, so a
 * position lookup simply misses (the field stays null) instead of breaking a scan.
 *
 * No third-party dependency: the engine bundle stays free of third-party code.
 */

export interface SourcePosition {
  /** 1-based line. */
  line: number
  /** 1-based column. */
  column: number
}

export type PositionIndex = Record<string, SourcePosition>

interface Cursor {
  text: string
  i: number
  line: number
  col: number
}

function peek(c: Cursor): string {
  return c.text[c.i] ?? ""
}

function advance(c: Cursor): string {
  const ch = c.text[c.i] ?? ""
  c.i++
  if (ch === "\n") {
    c.line++
    c.col = 1
  } else {
    c.col++
  }
  return ch
}

function skipWhitespace(c: Cursor): void {
  while (c.i < c.text.length) {
    const ch = peek(c)
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") advance(c)
    else break
  }
}

/** Consume a JSON string token (cursor must be on the opening quote). */
function readString(c: Cursor): string {
  advance(c) // opening quote
  let out = ""
  while (c.i < c.text.length) {
    const ch = advance(c)
    if (ch === "\\") {
      const esc = advance(c)
      if (esc === "n") out += "\n"
      else if (esc === "t") out += "\t"
      else if (esc === "r") out += "\r"
      else if (esc === "u") {
        let hex = ""
        for (let k = 0; k < 4; k++) hex += advance(c)
        const code = Number.parseInt(hex, 16)
        out += Number.isNaN(code) ? "" : String.fromCharCode(code)
      } else out += esc
    } else if (ch === '"') {
      break
    } else {
      out += ch
    }
  }
  return out
}

/** Skip any JSON value, recording object-key positions under `pathPrefix`. */
function skipValue(c: Cursor, index: PositionIndex, pathPrefix: string): void {
  skipWhitespace(c)
  const ch = peek(c)
  if (ch === "{") {
    scanObject(c, index, pathPrefix)
  } else if (ch === "[") {
    scanArray(c, index, pathPrefix)
  } else if (ch === '"') {
    readString(c)
  } else {
    // number, true, false, null — read until a structural/whitespace boundary.
    while (c.i < c.text.length) {
      const n = peek(c)
      if (n === "," || n === "}" || n === "]" || n === " " || n === "\t" || n === "\n" || n === "\r") break
      advance(c)
    }
  }
}

function scanArray(c: Cursor, index: PositionIndex, pathPrefix: string): void {
  advance(c) // [
  for (;;) {
    skipWhitespace(c)
    const ch = peek(c)
    if (ch === "]" || ch === "") {
      if (ch === "]") advance(c)
      return
    }
    if (ch === ",") {
      advance(c)
      continue
    }
    skipValue(c, index, pathPrefix)
  }
}

function scanObject(c: Cursor, index: PositionIndex, pathPrefix: string): void {
  advance(c) // {
  for (;;) {
    skipWhitespace(c)
    const ch = peek(c)
    if (ch === "}" || ch === "") {
      if (ch === "}") advance(c)
      return
    }
    if (ch === ",") {
      advance(c)
      continue
    }
    if (ch !== '"') {
      // Unexpected token — bail out of this object tolerantly.
      advance(c)
      continue
    }
    // Record the key position (1-based line/column of the opening quote).
    const keyLine = c.line
    const keyCol = c.col
    const key = readString(c)
    const path = pathPrefix ? `${pathPrefix}.${key}` : key
    if (!(path in index)) index[path] = { line: keyLine, column: keyCol }

    skipWhitespace(c)
    if (peek(c) === ":") advance(c)
    skipValue(c, index, path)
  }
}

/**
 * Build a position index from JSON source text. Returns an empty index for
 * non-object roots or unscannable input (best-effort: never throws).
 */
export function buildPositionIndex(text: string): PositionIndex {
  const index: PositionIndex = {}
  const c: Cursor = { text, i: 0, line: 1, col: 1 }
  try {
    skipWhitespace(c)
    if (peek(c) === "{") scanObject(c, index, "")
    else if (peek(c) === "[") scanArray(c, index, "")
  } catch {
    // Tolerant: return whatever was gathered before the failure.
  }
  return index
}
