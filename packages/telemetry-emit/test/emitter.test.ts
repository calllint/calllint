/**
 * Emitter behavior (new11 §3.5). The load-bearing properties:
 *  - a gated emitter stores nothing (privacy invariant: off ⇒ no side effect);
 *  - an allowed event is sanitized then written to the sink;
 *  - a forbidden field is DROPPED, never thrown (best-effort, caller unaffected);
 *  - the default sink is noop (wired-but-silent resting state).
 */
import { describe, it, expect } from "vitest"
import { createEmitter, memorySink } from "../src/index.js"

describe("createEmitter — gating", () => {
  it("emits nothing for cli without consent", () => {
    const sink = memorySink()
    const emitter = createEmitter({ source: "cli", sink })
    const out = emitter.emit({ eventName: "decision_safe" })
    expect(out.status).toBe("gated")
    expect(sink.events).toHaveLength(0)
  })

  it("emits a sanitized event for a consented cli", () => {
    const sink = memorySink()
    const emitter = createEmitter({ source: "cli", sink, consented: true })
    const out = emitter.emit({ eventName: "decision_block", durationMs: 350 })
    expect(out.status).toBe("emitted")
    expect(sink.events).toHaveLength(1)
    expect(sink.events[0]!.eventName).toBe("decision_block")
    // durationMs is bucketed by the sanitizer, never emitted raw.
    expect(sink.events[0]!.durationBucket).toBe("100-500ms")
    expect("durationMs" in sink.events[0]!).toBe(false)
  })

  it("emits for server by default (no consent needed)", () => {
    const sink = memorySink()
    const emitter = createEmitter({ source: "server", sink })
    expect(emitter.emit({ eventName: "trust_page_viewed" }).status).toBe("emitted")
    expect(sink.events).toHaveLength(1)
  })
})

describe("createEmitter — fail closed, best effort", () => {
  it("DROPS a forbidden field without throwing, and writes nothing", () => {
    const sink = memorySink()
    const emitter = createEmitter({ source: "server", sink })
    const out = emitter.emit({ eventName: "decision_safe", secret: "leak" } as never)
    expect(out.status).toBe("dropped")
    if (out.status === "dropped") expect(out.reason).toMatch(/forbidden field/)
    expect(sink.events).toHaveLength(0)
  })

  it("DROPS an unknown event name without throwing", () => {
    const sink = memorySink()
    const emitter = createEmitter({ source: "server", sink })
    const out = emitter.emit({ eventName: "not_a_real_event" } as never)
    expect(out.status).toBe("dropped")
    expect(sink.events).toHaveLength(0)
  })

  it("defaults to a noop sink (wired but silent)", () => {
    const emitter = createEmitter({ source: "server" })
    // No sink injected → noop. Should report emitted but store nowhere observable.
    expect(emitter.emit({ eventName: "badge_rendered" }).status).toBe("emitted")
  })
})
