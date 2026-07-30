/**
 * The production `HandlerRegistry` — the only code here that touches a real machine.
 *
 * It is deliberately dull. Every branch maps one `HandlerRecord` kind onto the
 * narrowest OS primitive that can express it, and there is no generic escape hatch:
 * no shell string, no caller-supplied verb, no `exec` of anything but `reg.exe` with a
 * fixed argv. That is what bounds the blast radius of the second writer — the port's
 * surface, not reviewer vigilance.
 *
 * Windows uses `reg.exe` via `execFileSync` (argv array, `shell: false` by default), so
 * a value containing `&` or `|` is data. The alternative (a native registry binding)
 * would add a compiled dependency to a zero-dependency CLI.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { HandlerRecord, HandlerRegistry } from "@calllint/core"

/** `reg.exe query` → the value, or null when the key/value is absent. */
function regRead(path: string, valueName: string): string | null {
  try {
    const out = execFileSync(
      "reg.exe",
      ["query", path, ...(valueName === "" ? ["/ve"] : ["/v", valueName])],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
    // `    (Default)    REG_SZ    URL:CallLint adoption link`
    const line = out.split(/\r?\n/).find((l) => /REG_[A-Z_]+/.test(l))
    if (line === undefined) return null
    const m = line.match(/REG_[A-Z_]+\s+(.*)$/)
    return m ? m[1]! : null
  } catch {
    return null // absent key ⇒ reg.exe exits non-zero
  }
}

function regWrite(path: string, valueName: string, value: string): void {
  execFileSync(
    "reg.exe",
    ["add", path, ...(valueName === "" ? ["/ve"] : ["/v", valueName]), "/t", "REG_SZ", "/d", value, "/f"],
    { stdio: "ignore" },
  )
}

function regRemove(path: string, valueName: string): void {
  try {
    execFileSync("reg.exe", ["delete", path, ...(valueName === "" ? ["/ve"] : ["/v", valueName]), "/f"], {
      stdio: "ignore",
    })
  } catch {
    // Already absent is the desired state, not a failure.
  }
}

/** Read one `key=value` line out of an XDG mimeapps list. */
function mimeRead(path: string, scheme: string): string | null {
  if (!existsSync(path)) return null
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${scheme}=`))
  return line ?? null
}

/**
 * Upsert a scheme association under `[Default Applications]`, preserving every other
 * line. A handler registration must not rewrite a user's unrelated file defaults.
 */
function mimeWrite(path: string, scheme: string, desktopFile: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : ""
  const lines = existing.split(/\r?\n/)
  const entry = `${scheme}=${desktopFile}`
  const at = lines.findIndex((l) => l.startsWith(`${scheme}=`))

  if (at !== -1) {
    lines[at] = entry
  } else {
    const header = lines.findIndex((l) => l.trim() === "[Default Applications]")
    if (header === -1) lines.push("[Default Applications]", entry)
    else lines.splice(header + 1, 0, entry)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, lines.join("\n"), "utf8")
}

function mimeRemove(path: string, scheme: string): void {
  if (!existsSync(path)) return
  const kept = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(`${scheme}=`))
  writeFileSync(path, kept.join("\n"), "utf8")
}

/** The production port. Total over `HandlerRecord`; no other operation exists. */
export const nodeHandlerRegistry: HandlerRegistry = {
  read(record: HandlerRecord): string | null {
    switch (record.kind) {
      case "REGISTRY_KEY":
        return regRead(record.path, record.valueName)
      case "DESKTOP_FILE":
        return existsSync(record.path) ? readFileSync(record.path, "utf8") : null
      case "MIME_DEFAULT":
        return mimeRead(record.path, record.scheme)
    }
  },

  write(record: HandlerRecord): void {
    switch (record.kind) {
      case "REGISTRY_KEY":
        regWrite(record.path, record.valueName, record.value)
        return
      case "DESKTOP_FILE":
        mkdirSync(dirname(record.path), { recursive: true })
        writeFileSync(record.path, record.contents, "utf8")
        return
      case "MIME_DEFAULT":
        mimeWrite(record.path, record.scheme, record.desktopFile)
        return
    }
  },

  remove(record: HandlerRecord): void {
    switch (record.kind) {
      case "REGISTRY_KEY":
        regRemove(record.path, record.valueName)
        return
      case "DESKTOP_FILE":
        rmSync(record.path, { force: true })
        return
      case "MIME_DEFAULT":
        mimeRemove(record.path, record.scheme)
        return
    }
  },
}
