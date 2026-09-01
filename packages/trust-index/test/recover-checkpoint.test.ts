/**
 * The wedge remedy, tested against the wedge it exists for.
 *
 * `assertUsableCheckpoint` refuses a `RUNNING` checkpoint — correctly: `beginRun` writes `RUNNING`
 * before any fetch, so a killed process leaves it, and resuming would skip records that run may not
 * have persisted. What was missing was the way OUT. Nothing in the repo cleared `RUNNING`, so a
 * single hard kill wedged a persistent store permanently and every later ingest exited 1 at the same
 * line, with a message that named no remedy.
 *
 * These tests drive the REAL store, not a stand-in, and assert the property that matters: after the
 * remedy, `assertUsableCheckpoint` — the actual guard the ingest hits — no longer throws. Asserting
 * only "status became FAILED" would restate the implementation and would not notice if the guard's
 * own notion of terminal ever moved.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import {
  AdoptionIndexStore,
  MIGRATIONS_DIRNAME,
  OFFICIAL_REGISTRY_SOURCE_ID,
  assertUsableCheckpoint,
  openBetterSqlite3,
  resolveIndexPaths,
} from "@calllint/adoption-index"

const T0 = "2026-09-01T00:16:06.000Z"
const temps: string[] = []

function migrationsDir(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "adoption-index", MIGRATIONS_DIRNAME)
}

async function freshStore(): Promise<{ cwd: string; store: AdoptionIndexStore }> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-recover-cp-"))
  temps.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const d of paths.dirs) mkdirSync(d, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  return { cwd, store: AdoptionIndexStore.open({ cwd, migrationsDir: migrationsDir(), db, now: T0 }) }
}

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..")

/** Run the real bin against `cwd`, the way an operator does. `--import tsx`, as `scripts/` tests do. */
function runBin(cwd: string): string {
  const script = resolve(repoRoot, "packages", "trust-index", "src", "recoverCheckpoint.ts")
  return execFileSync(process.execPath, ["--import", "tsx", script], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ADOPTION_INDEX_CWD: cwd },
  })
}

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe("recover-checkpoint unwedges a crashed store", () => {
  it("turns the crash state into a terminal one, and the real guard stops refusing", async () => {
    const { cwd, store } = await freshStore()

    // The crash, exactly as `source-mirror.test.ts:502` simulates it: beginRun writes RUNNING and
    // the process dies before failRun.
    store.beginRun(OFFICIAL_REGISTRY_SOURCE_ID, T0)
    expect(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).status).toBe("RUNNING")
    expect(() => assertUsableCheckpoint(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID))).toThrow(
      /did not reach a terminal state/,
    )
    const wedged = store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID)
    store.close()

    const out = runBin(cwd)
    expect(out).toContain("RUNNING -> FAILED")

    const db = await openBetterSqlite3(resolveIndexPaths(cwd).db)
    const reopened = AdoptionIndexStore.open({ cwd, migrationsDir: migrationsDir(), db, now: T0 })
    try {
      const after = reopened.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID)
      // THE PROPERTY THAT MATTERS: the guard the ingest actually hits no longer refuses.
      expect(() => assertUsableCheckpoint(after)).not.toThrow()
      expect(reopened.allRunsTerminal()).toBe(true)

      // The watermark must NOT have moved. Clearing it would convert the next incremental into a
      // full read; advancing it would skip the records the refusal exists to protect.
      expect(after.updatedSince).toBe(wedged.updatedSince)
      expect(after.cursor).toBe(wedged.cursor)
    } finally {
      reopened.close()
    }
  })

  it("is re-runnable: a terminal checkpoint is reported, not changed", async () => {
    const { cwd, store } = await freshStore()
    store.beginRun(OFFICIAL_REGISTRY_SOURCE_ID, T0)
    store.failRun(OFFICIAL_REGISTRY_SOURCE_ID, "SOURCE_FETCH_FAILED")
    store.close()

    const out = runBin(cwd)
    expect(out).toContain("already terminal")

    const db = await openBetterSqlite3(resolveIndexPaths(cwd).db)
    const reopened = AdoptionIndexStore.open({ cwd, migrationsDir: migrationsDir(), db, now: T0 })
    try {
      // The original error code survives: the remedy must not overwrite the diagnosis of a run that
      // failed for a real reason.
      expect(reopened.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).lastErrorCode).toBe("SOURCE_FETCH_FAILED")
    } finally {
      reopened.close()
    }
  })

  it("leaves a never-run source alone rather than inventing a failure", async () => {
    const { cwd, store } = await freshStore()
    expect(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).status).toBe("IDLE")
    store.close()

    const out = runBin(cwd)
    expect(out).toContain("the next run may start")
    expect(out).not.toContain("-> FAILED")

    const db = await openBetterSqlite3(resolveIndexPaths(cwd).db)
    const reopened = AdoptionIndexStore.open({ cwd, migrationsDir: migrationsDir(), db, now: T0 })
    try {
      expect(reopened.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).status).toBe("IDLE")
    } finally {
      reopened.close()
    }
  })
})

describe("the refusal names its remedy (control)", () => {
  it("`assertUsableCheckpoint`'s RUNNING message names a runnable command", () => {
    let message = ""
    try {
      assertUsableCheckpoint({
        sourceId: "s",
        cursor: null,
        updatedSince: null,
        snapshotDigest: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        status: "RUNNING",
        lastErrorCode: null,
      })
    } catch (err) {
      message = String(err)
    }

    // A refusal that states no way out is one an operator cannot act on.
    expect(message).toContain("recover-checkpoint:trust-index")

    // AND THE COMMAND MUST EXIST. A message naming a script nobody wired is the defect one level
    // up — the remedy reads as runnable and is not. Asserted against the manifest, so deleting the
    // script reds here rather than at an operator's prompt.
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string | undefined> }
    const named = [...message.matchAll(/`pnpm ([a-z0-9:.-]+)`/g)].map((m) => m[1])
    expect(named.length, "the message must name at least one command").toBeGreaterThan(0)
    for (const cmd of named) {
      expect(pkg.scripts[cmd!], `the message names \`pnpm ${cmd}\`, which package.json must define`).toBeTypeOf(
        "string",
      )
    }
  })
})
