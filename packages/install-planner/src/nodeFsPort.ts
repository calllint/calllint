/**
 * Production ConfigFs backed by Node's synchronous fs (ADR 0037). Synchronous is
 * deliberate: a short-lived apply process gets a simpler, race-free temp → fsync
 * → rename with no interleaving, and the CLI edge is already sync. Durability is
 * real here (fsync on temp + backup before rename); the in-memory test port
 * shares the exact same call sequence from the engine.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs"
import { dirname } from "node:path"
import type { ConfigFs } from "./fsPort.js"

export function nodeFsPort(): ConfigFs {
  return {
    exists: (p) => existsSync(p),
    readFile: (p) => readFileSync(p, "utf8"),
    writeFile: (p, data) => writeFileSync(p, data, "utf8"),
    fsync: (p) => {
      // Barrier the file's bytes to disk. Best-effort: some FS/OS combos reject
      // fsync on certain handles — a failed barrier must not abort the apply.
      try {
        const fd = openSync(p, "r+")
        try {
          fsyncSync(fd)
        } finally {
          closeSync(fd)
        }
      } catch {
        /* durability is best-effort; correctness comes from the atomic rename */
      }
    },
    rename: (from, to) => renameSync(from, to),
    remove: (p) => rmSync(p, { force: true }),
    ensureDir: (p) => mkdirSync(dirname(p), { recursive: true }),
    acquireLock: (p) => {
      // O_EXCL makes creation atomic: it throws EEXIST if the lock is held.
      try {
        const fd = openSync(p, "wx")
        closeSync(fd)
        return true
      } catch {
        return false
      }
    },
  }
}
