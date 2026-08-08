import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

// The R-9 deployment units (ADR 0061 §8.5 worker, §8.6 backup). These bytes are consumed by systemd
// on the worker host, and nothing else in the repo reads them — which is precisely why they need a
// gate here. Every other pin in `.gitattributes` protects a byte that some drift test already
// compares; this directory has no such reader, so a regression in it would surface at deploy time on
// a host no CI job of ours watches.
//
// Two distinct failure modes are measured, because they fail in the same place but for
// unrelated reasons:
//   1. Line endings. `deploy/** text eol=lf` is pinned, but a pin no gate reads is itself
//      unguarded. A CRLF checkout makes the last token of every line carry a trailing \r,
//      so `ExecStart=/usr/bin/pnpm prune:cas` asks systemd to run a binary whose name ends
//      in \r. This asserts the CONSEQUENCE of the pin rather than trusting it, the same way
//      store-schema.test.ts does for the migrations pin.
//   2. Script existence. The units invoke `pnpm` scripts by name. Nothing verified
//      they exist: a rename or typo in package.json leaves a unit pointing at a script
//      that resolves to "command not found" mid-run, after the earlier ExecStart steps have
//      already mutated the store.
//
// THE UNIT LIST IS ENUMERATED FROM THE DIRECTORY, not from literals. §8.5 shipped two units and
// this file named both by hand; §8.6 added two more, and the hand-written list would have gone on
// passing while covering half the directory. A gate whose scope is a constant silently narrows every
// time the thing it guards grows — so the directory is the source of truth, and the counts below are
// vacuity guards against an enumeration that finds nothing.
const repoRoot = new URL("../../", import.meta.url)
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, repoRoot)), "utf8")

const UNIT_DIR = "deploy/adoption-index"
const unitFiles = readdirSync(fileURLToPath(new URL(UNIT_DIR, repoRoot)))
  .filter((name) => name.endsWith(".service") || name.endsWith(".timer"))
  .sort()
  .map((name) => `${UNIT_DIR}/${name}`)

const services = unitFiles.filter((rel) => rel.endsWith(".service"))
const timers = unitFiles.filter((rel) => rel.endsWith(".timer"))

/** Every `ExecStart=` / `ExecStopPost=` line of a unit, in order — what systemd will parse. */
const execLines = (rel: string, directive: string): string[] =>
  read(rel)
    .split("\n")
    .filter((line) => line.startsWith(`${directive}=`))
    .map((line) => line.slice(directive.length + 1).trim())

const WORKER = "deploy/adoption-index/calllint-adoption-worker.service"
const BACKUP = "deploy/adoption-index/calllint-adoption-backup.service"

describe("R-9 deployment units", () => {
  it("enumerates the whole unit directory — the vacuity guard on every test below", () => {
    // Without this, an enumeration that matched nothing would make `it.each([])` a no-op and every
    // per-unit assertion would vanish silently rather than fail. Floors, not equalities: a fifth
    // unit should extend the covered set, never red this line.
    expect(services.length).toBeGreaterThanOrEqual(2)
    expect(timers.length).toBeGreaterThanOrEqual(2)
    // Each timer must have a service of the same stem, or it fires into nothing.
    const stems = (list: string[]) => list.map((rel) => rel.replace(/\.(service|timer)$/, "")).sort()
    expect(stems(timers)).toEqual(stems(services))
  })

  it.each(unitFiles)("%s is LF-only with a trailing newline", (rel) => {
    const bytes = read(rel)
    // Named rather than `.every()`/`not.toContain`: on failure this prints WHICH line holds
    // the \r, which is the whole diagnostic value when a checkout filter is the suspect.
    const withCr = bytes.split("\n").flatMap((line, i) => (line.includes("\r") ? [`${i + 1}: ${JSON.stringify(line)}`] : []))
    expect(withCr).toEqual([])
    expect(bytes.endsWith("\n")).toBe(true)
    expect(bytes.trim().length).toBeGreaterThan(0)
  })

  it.each(services)("%s invokes only pnpm scripts that exist in the root package.json", (rel) => {
    const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}

    // `ExecStopPost=` counts too. The backup unit does its cleanup there precisely so it runs after
    // a failure, which means a typo in it is invisible until the day something else has gone wrong.
    const starts = execLines(rel, "ExecStart")
    const posts = execLines(rel, "ExecStopPost")

    // Vacuity guard. An empty list would make every assertion below trivially true, so a
    // unit that lost its ExecStart lines entirely must fail here rather than pass silently.
    expect(starts.length).toBeGreaterThanOrEqual(1)

    // Only `pnpm` invocations are checked against package.json; a unit may legitimately call another
    // binary (the backup's upload step calls `ossutil`). Those are asserted separately below.
    const pnpmNames = [...starts, ...posts].flatMap((cmd) => {
      const m = /^\S*pnpm\s+(\S+)$/.exec(cmd)
      return m?.[1] === undefined ? [] : [m[1]]
    })
    // Non-vacuity: every unit here runs at least one repo script, so an extraction that silently
    // stopped matching would otherwise leave `missing` empty and green.
    expect(pnpmNames.length).toBeGreaterThanOrEqual(1)

    const missing = pnpmNames.filter((name) => scripts[name] === undefined)
    expect(missing).toEqual([])
  })

  it.each(services)(
    "%s does not set ADOPTION_INDEX_CWD, which would desynchronize a sweep from the writer",
    (rel) => {
      // The steps do not share root-resolution logic, and that asymmetry is the hazard.
      // refreshSnapshot.ts:277 reads a bare `process.cwd()`; pruneCas.ts and backupAdoptionIndex.ts
      // read `ADOPTION_INDEX_CWD ?? process.cwd()`, because they need a test seam. Setting that
      // variable in a unit therefore moves ONLY the sweep, which would have it delete from a tree the
      // ingest step never writes to — reporting a healthy `inspected`/`deleted` count for the wrong
      // directory while the real CAS keeps growing. Failing loudly on an absent tree cannot catch
      // that: the decoy root would exist. `WorkingDirectory` is the correct single lever, and it is
      // shared by every ExecStart, so pin the safe shape rather than relying on remembering it.
      //
      // This is control #123. It is applied per-unit BY ENUMERATION rather than to one named file —
      // a guard bound to a single literal path would have gone green on the backup unit while the
      // hazard it describes applied there identically.
      const unit = read(rel)
      const envLines = unit.split("\n").filter((line) => line.startsWith("Environment="))
      expect(envLines.filter((line) => line.includes("ADOPTION_INDEX_CWD"))).toEqual([])
      // The variable must not arrive through the other door either: `EnvironmentFile=` contents are
      // off-machine, so a unit that reads one must not be assumed clean. Asserting on the file's
      // PATH is not possible here, so this catches an ASSIGNMENT anywhere in the unit, including one
      // smuggled past the `Environment=` filter above by leading whitespace or a `DefaultDependencies`
      // -style directive not yet invented.
      //
      // It matches on `NAME=`, not the bare name, and that is deliberate rather than lax: the backup
      // unit's own comment block explains at length why the variable is NOT set, so a guard rejecting
      // the bare token would go red on the prose arguing FOR the rule — the trap a source scan hits
      // when it reads comments as code. `=` is the character that separates a mention from an act.
      expect(unit.includes("ADOPTION_INDEX_CWD=")).toBe(false)
      expect(unit).toMatch(/^WorkingDirectory=\S+$/m)
    },
  )

  it.each(services)("%s stays within the two paths ProtectSystem=strict allows", (rel) => {
    // Control #122. `ProtectSystem=strict` makes the filesystem read-only except for `ReadWritePaths`,
    // and the host permits exactly two: `/opt/calllint/.var` and the committed snapshots dir. A unit
    // that staged anything elsewhere would fail at deploy time on a host no CI of ours watches — so
    // the set is pinned here, where a CI job does watch.
    const unit = read(rel)
    const allowed = new Set(["/opt/calllint/.var", "/opt/calllint/packages/trust-index/snapshots"])
    const declared = unit
      .split("\n")
      .filter((line) => line.startsWith("ReadWritePaths="))
      .map((line) => line.slice("ReadWritePaths=".length).trim())

    // Vacuity guard: a unit with no ReadWritePaths at all cannot write the store, so an empty list
    // is a broken unit rather than a maximally safe one.
    expect(declared.length).toBeGreaterThanOrEqual(1)
    // The set form, not `.every()`: on failure this prints the offending path instead of `false`.
    expect(declared.filter((p) => !allowed.has(p))).toEqual([])
    expect(unit).toContain("ProtectSystem=strict")
    expect(unit).toContain("ProtectHome=true")
  })

  it.each(services)("%s records no credential VALUE, only key names", (rel) => {
    // Control #126. ADR 0061 §8.2 binds credentials to key names; the values live in a root-only
    // file outside git. A unit that inlined a secret would leak it into every clone of this repo.
    //
    // The assertion is on the SHAPE of `Environment=` lines, not a search for secret-looking text: a
    // scan for high-entropy strings could not fail before a leak had already been committed, and it
    // would print the value when it did. Any `Environment="KEY=…"` whose key names a credential must
    // have an empty value or not exist — the credential arrives via `EnvironmentFile=` alone.
    const unit = read(rel)
    const CREDENTIAL_KEYS = /(SECRET|TOKEN|PASSWORD|ACCESS_KEY|CREDENTIAL|PRIVATE_KEY)/i
    const offending = unit
      .split("\n")
      .filter((line) => line.startsWith("Environment="))
      .map((line) => line.slice("Environment=".length).trim().replace(/^"|"$/g, ""))
      .filter((assignment) => {
        const eq = assignment.indexOf("=")
        if (eq < 0) return false
        const key = assignment.slice(0, eq)
        const value = assignment.slice(eq + 1)
        // Report the KEY only. A failure message must never carry the value it caught.
        return CREDENTIAL_KEYS.test(key) && value.trim() !== ""
      })
      .map((assignment) => assignment.slice(0, assignment.indexOf("=")))

    expect(offending).toEqual([])
  })

  it("the worker runs the CAS retention sweep last, after ingest and projection", () => {
    // Order is load-bearing, not cosmetic: the sweep deletes by mtime, so running it BEFORE
    // the projection could reclaim a blob the projection was about to read. Type=oneshot runs
    // ExecStart lines sequentially and aborts the rest on a non-zero exit, so "last" also
    // means a failed ingest never reaches the deletion step.
    const execStarts = execLines(WORKER, "ExecStart")

    expect(execStarts.length).toBeGreaterThanOrEqual(3)
    expect(execStarts.at(-1)).toMatch(/pnpm\s+prune:cas$/)
    expect(execStarts.filter((c) => /prune:cas$/.test(c))).toHaveLength(1)
    expect(read(WORKER)).toContain("Type=oneshot")
    // BOTH windows must survive in the unit; without one the corresponding sweep falls back to its
    // code default silently, and this file is where the host's chosen windows are recorded. Two
    // assertions rather than one because `prune:cas` sweeps two trees on two different magnitudes
    // (§8.6), and a test that pinned only the days window would have gone green while the hours
    // window — the one added later — drifted out of the unit unnoticed.
    expect(read(WORKER)).toMatch(/^Environment="CAS_RETENTION_DAYS=\d+"$/m)
    expect(read(WORKER)).toMatch(/^Environment="CAS_STAGING_ORPHAN_HOURS=\d+"$/m)
  })

  it("the backup is a SEPARATE unit, never a fourth step on the worker", () => {
    // `Type=oneshot` aborts the remaining ExecStart lines when one fails, so a backup appended to
    // the worker would be skipped exactly when the ingest failed — the moment it matters most. The
    // converse is as bad: a credential failure would fail the ingest unit and poison
    // `prune:cas … failed 0`, the worker's documented success criterion (README:58).
    expect(execLines(WORKER, "ExecStart").filter((c) => /backup/.test(c))).toEqual([])
    expect(execLines(BACKUP, "ExecStart").length).toBeGreaterThanOrEqual(1)
  })

  it("control #127 — the backup sweeps its staging from ExecStopPost, not ExecStart", () => {
    // A staged archive is one full copy of the store per day on the host: the largest single growth
    // surface here, and what the cleanup requirement exists to bound. As a third `ExecStart` the
    // sweep would be SKIPPED after any earlier failure — i.e. exactly when a stale archive is most
    // likely sitting there. `ExecStopPost=` fires on success, failure, and timeout alike.
    const posts = execLines(BACKUP, "ExecStopPost")
    expect(posts.filter((c) => /backup:adoption-index:prune-staging$/.test(c))).toHaveLength(1)
    // And it must NOT be an ExecStart, which is the whole distinction being asserted.
    expect(execLines(BACKUP, "ExecStart").filter((c) => /prune-staging/.test(c))).toEqual([])
  })

  it("the backup timer fires outside the ingest's worst legal window", () => {
    // The worker starts at 02:30 with `TimeoutStartSec=45min`, so a backup inside that window would
    // capture a half-mirrored run: valid SQLite holding a state no complete run ever produced. The
    // gap is asserted in MINUTES rather than pinned to a literal time, so either schedule can move
    // as long as the separation survives.
    const minutesOf = (rel: string): number => {
      const m = /^OnCalendar=\*-\*-\* (\d{2}):(\d{2}):\d{2}$/m.exec(read(rel))
      if (m === null) throw new Error(`no absolute OnCalendar in ${rel}`)
      return Number(m[1]) * 60 + Number(m[2])
    }
    const worker = minutesOf("deploy/adoption-index/calllint-adoption-worker.timer")
    const backup = minutesOf("deploy/adoption-index/calllint-adoption-backup.timer")
    const timeout = /^TimeoutStartSec=(\d+)min$/m.exec(read(WORKER))
    expect(timeout).not.toBeNull()

    const gap = backup - worker
    expect(gap).toBeGreaterThan(Number(timeout?.[1]))
    // Neither timer may carry a `Timezone=`: both are UTC, and a unit that silently shifted with the
    // host's zone could slide the backup into the ingest window without either file changing.
    for (const rel of timers) expect(read(rel)).not.toMatch(/^Timezone=/m)
  })

  it.each(timers)("%s requires its service rather than merely wanting it", (rel) => {
    // A timer whose service is missing should fail loudly at `systemctl enable` time, not fire
    // nightly into nothing.
    expect(read(rel)).toMatch(/^Requires=\S+\.service$/m)
    expect(read(rel)).toContain("Persistent=true")
  })
})
