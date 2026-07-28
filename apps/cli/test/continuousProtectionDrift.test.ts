/**
 * Drift guard for the Batch 8 continuous-protection disclosure (INV-2.4-07).
 *
 * `@calllint/core` mirrors the shipped Guard host matrix as data, because the CLI command
 * module is not importable from a package. That mirror is only safe if it cannot silently
 * fall behind: a new Guard host, or a moved artifact path, must fail here rather than ship
 * an offer that under-discloses what gets installed.
 *
 * The assertion is made against the shipped writer's own source text (guard.ts), so the
 * test fails on the real thing rather than on a second copy of the same assumption.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { GUARD_HOST_IDS, persistentComponentFor } from "@calllint/core"

const GUARD_SRC = readFileSync(join(import.meta.dirname, "..", "src", "commands", "guard.ts"), "utf8")

/** The shipped GUARD_HOSTS tuple, read straight out of the writer. */
function shippedGuardHosts(): string[] {
  const block = /const GUARD_HOSTS = \[([\s\S]*?)\] as const/.exec(GUARD_SRC)
  expect(block, "GUARD_HOSTS tuple not found in guard.ts — the mirror cannot be verified").toBeTruthy()
  return [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

describe("continuous-protection disclosure mirrors the shipped Guard matrix", () => {
  it("discloses exactly the hosts `guard install` supports — no more, no fewer", () => {
    expect([...GUARD_HOST_IDS].sort()).toEqual(shippedGuardHosts().sort())
  })

  it("names the artifact path the shipped writer actually creates", () => {
    // guardArtifact() builds paths with join("a","b"); compare on the segments so the
    // assertion is platform-independent.
    for (const host of GUARD_HOST_IDS) {
      const segments = persistentComponentFor(host).artifactPath.split("/")
      for (const seg of segments) {
        expect(GUARD_SRC, `guard.ts does not mention "${seg}" for host ${host}`).toContain(`"${seg}"`)
      }
    }
  })

  it("agrees with the shipped writer about which hosts are shared-config", () => {
    // A `shared` posture is what makes the removal a hand edit; getting it wrong would
    // promise an automated uninstall that does not exist.
    const shared = GUARD_HOST_IDS.filter((h) => persistentComponentFor(h).posture === "shared")
    expect([...shared].sort()).toEqual(["claude-code", "gemini", "vscode"])
    for (const host of shared) {
      const re = new RegExp(`case "${host}":[\\s\\S]{0,400}?posture: "shared"`)
      expect(GUARD_SRC, `guard.ts does not mark ${host} as shared posture`).toMatch(re)
    }
  })
})
