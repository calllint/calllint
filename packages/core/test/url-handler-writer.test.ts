/**
 * The registration writer, exercised through an in-memory `HandlerRegistry`.
 *
 * The load-bearing tests are the refusals and the rollback. A writer that only works
 * on the happy path is not a writer this repo can ship: the interesting question is
 * what the machine looks like AFTER a failure, and "absence" has to be restorable as
 * a state, not approximated with an empty value.
 */
import { describe, it, expect } from "vitest"
import { planUrlHandler } from "../src/gateway/urlHandlerPlan.js"
import type { HandlerRecord } from "../src/gateway/urlHandlerPlan.js"
import {
  applyUrlHandler,
  unregisterUrlHandler,
  urlHandlerStatus,
  planDigest,
  type HandlerRegistry,
} from "../src/gateway/urlHandlerWriter.js"

const LINUX = { platform: "linux" as const, binPath: "/usr/local/bin/calllint", home: "/home/u" }

function key(r: HandlerRecord): string {
  return r.kind === "REGISTRY_KEY" ? `${r.path}::${r.valueName}` : r.path
}

/** The value a record would store, mirroring the writer's own `desiredValue`. */
function valueOf(r: HandlerRecord): string {
  return r.kind === "REGISTRY_KEY" ? r.value : r.kind === "DESKTOP_FILE" ? r.contents : `${r.scheme}=${r.desktopFile}`
}

/**
 * In-memory registry. `refuseWrite` simulates a write that reports success but does
 * not take — the failure `verify` exists to catch. It receives the incoming value so a
 * test can refuse a specific write (e.g. a RESTORE) without depending on the writer's
 * internal read ordering.
 */
function memRegistry(
  seed: Record<string, string> = {},
  refuseWrite?: (r: HandlerRecord, incoming: string) => boolean,
) {
  const store = new Map<string, string>(Object.entries(seed))
  const registry: HandlerRegistry = {
    read: (r) => store.get(key(r)) ?? null,
    write: (r) => {
      if (refuseWrite?.(r, valueOf(r))) return // silently no-op
      store.set(key(r), valueOf(r))
    },
    remove: (r) => void store.delete(key(r)),
  }
  return { registry, store }
}

describe("applyUrlHandler — refusals write nothing", () => {
  it("refuses a mismatched approval digest and writes nothing", () => {
    const plan = planUrlHandler(LINUX)
    const { registry, store } = memRegistry()
    const r = applyUrlHandler(plan, "sha256:wrong", registry)
    expect(r.outcome).toBe("APPROVAL_MISMATCH")
    expect(r.written).toEqual([])
    expect(store.size).toBe(0)
  })

  it("refuses on an unsupported platform and writes nothing", () => {
    const plan = planUrlHandler({ ...LINUX, platform: "darwin" })
    const { registry, store } = memRegistry()
    const r = applyUrlHandler(plan, planDigest(plan), registry)
    expect(r.outcome).toBe("UNSUPPORTED_PLATFORM")
    expect(r.detail).toContain("CFBundleURLTypes")
    expect(store.size).toBe(0)
  })
})

describe("applyUrlHandler — the happy path and idempotency by effect", () => {
  it("registers every planned record", () => {
    const plan = planUrlHandler(LINUX)
    const { registry, store } = memRegistry()
    const r = applyUrlHandler(plan, planDigest(plan), registry)
    expect(r.outcome).toBe("REGISTERED")
    expect(r.written).toHaveLength(2)
    expect(store.size).toBe(2)
  })

  it("reports ALREADY_APPLIED on a second run without rewriting", () => {
    const plan = planUrlHandler(LINUX)
    const { registry } = memRegistry()
    applyUrlHandler(plan, planDigest(plan), registry)
    const again = applyUrlHandler(plan, planDigest(plan), registry)
    expect(again.outcome).toBe("ALREADY_APPLIED")
    expect(again.written).toEqual([])
  })

  it("status is read-only and reports the missing records by name", () => {
    const plan = planUrlHandler(LINUX)
    const { registry, store } = memRegistry()
    const before = urlHandlerStatus(plan, registry)
    expect(before.registered).toBe(false)
    expect(before.missing).toHaveLength(2)
    expect(store.size).toBe(0) // status wrote nothing

    applyUrlHandler(plan, planDigest(plan), registry)
    expect(urlHandlerStatus(plan, registry).registered).toBe(true)
  })
})

describe("applyUrlHandler — rollback restores absence, not emptiness", () => {
  it("restores a previously-absent record by REMOVING it when verification fails", () => {
    const plan = planUrlHandler(LINUX)
    if (!plan.supported) throw new Error("unreachable")
    // The second record's write silently does not take ⇒ verify must fail.
    const { registry, store } = memRegistry({}, (r) => r.kind === "MIME_DEFAULT")

    const r = applyUrlHandler(plan, planDigest(plan), registry)
    expect(r.outcome).toBe("VERIFY_FAILED_ROLLED_BACK")
    expect(r.detail).toContain("all records restored")
    // Both records were absent before, so both must be ABSENT now — a blanked value
    // would leave a half-registered handler behind.
    expect(store.size).toBe(0)
  })

  it("restores a pre-existing value rather than the planned one", () => {
    const plan = planUrlHandler(LINUX)
    if (!plan.supported) throw new Error("unreachable")
    const desktop = plan.records.find((x) => x.kind === "DESKTOP_FILE")!
    const { registry, store } = memRegistry(
      { [key(desktop)]: "PRIOR CONTENTS" },
      (r) => r.kind === "MIME_DEFAULT",
    )

    const r = applyUrlHandler(plan, planDigest(plan), registry)
    expect(r.outcome).toBe("VERIFY_FAILED_ROLLED_BACK")
    expect(store.get(key(desktop))).toBe("PRIOR CONTENTS")
  })

  it("reports ROLLBACK_INCOMPLETE, naming the record it could not restore", () => {
    const plan = planUrlHandler(LINUX)
    if (!plan.supported) throw new Error("unreachable")
    const desktop = plan.records.find((x) => x.kind === "DESKTOP_FILE")!

    // The genuinely-incomplete case needs the desktop record WRITABLE on the forward
    // pass (destroying its prior value) and UNWRITABLE during the restore. Keying that
    // off the INCOMING VALUE is what makes it robust: the only write that carries
    // "PRIOR" is the restore. A phase flag driven by reads does not work here — the
    // writer reads every record twice (idempotency check, then prior-state capture)
    // before it writes anything, so the flag would already be set on the forward pass.
    const { registry, store } = memRegistry({ [key(desktop)]: "PRIOR" }, (r, incoming) => {
      if (r.kind === "MIME_DEFAULT") return true // forward write never takes ⇒ verify fails
      return incoming === "PRIOR" // i.e. the restore of the desktop record
    })

    const r = applyUrlHandler(plan, planDigest(plan), registry)
    expect(r.outcome).toBe("VERIFY_FAILED_ROLLBACK_INCOMPLETE")
    expect(r.detail).toContain("could not restore")
    expect(r.detail).toContain(desktop.path)
    // Honest about the residue: the desktop record is left holding the planned value.
    expect(store.get(key(desktop))).not.toBe("PRIOR")
  })
})

describe("unregisterUrlHandler", () => {
  it("removes every record and is idempotent", () => {
    const plan = planUrlHandler(LINUX)
    const { registry, store } = memRegistry()
    applyUrlHandler(plan, planDigest(plan), registry)

    const r = unregisterUrlHandler(plan, planDigest(plan), registry)
    expect(r.outcome).toBe("UNREGISTERED")
    expect(store.size).toBe(0)

    expect(unregisterUrlHandler(plan, planDigest(plan), registry).outcome).toBe("ALREADY_APPLIED")
  })

  it("refuses a mismatched approval digest and removes nothing", () => {
    const plan = planUrlHandler(LINUX)
    const { registry, store } = memRegistry()
    applyUrlHandler(plan, planDigest(plan), registry)
    const r = unregisterUrlHandler(plan, "sha256:wrong", registry)
    expect(r.outcome).toBe("APPROVAL_MISMATCH")
    expect(store.size).toBe(2)
  })
})

describe("planDigest", () => {
  it("moves when the plan moves, so an approval cannot be replayed onto a different plan", () => {
    const a = planDigest(planUrlHandler(LINUX))
    const b = planDigest(planUrlHandler({ ...LINUX, binPath: "/other/calllint" }))
    expect(a).not.toBe(b)
  })

  it("is stable for an identical plan", () => {
    expect(planDigest(planUrlHandler(LINUX))).toBe(planDigest(planUrlHandler(LINUX)))
  })
})
