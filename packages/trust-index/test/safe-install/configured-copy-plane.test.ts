/**
 * The configured-copy plane, end to end (PR P-5).
 *
 * The other P-5 suites each grade one seam: `continuousProtection.test.ts` proves the render
 * honours configured copy, `resolve-presentation.test.ts` proves the resolver wires the three
 * previously-dead sections, `presentation-content.test.ts` proves nothing reserved can enter.
 * This file grades the CLAIM the batch is named for, which no single seam can show:
 *
 *   IDENTITY   — the committed catalog resolves DEEP-EQUAL to the shipped code defaults. Not
 *                "equivalent": identical. This is what makes P-5 a no-behavior change.
 *   ZERO BYTES — no resolved guard or relay string appears in ANY committed install page or
 *                sealed contract sidecar. The ADR 0058 §4 license was spent by P-4b and does
 *                not renew, so this is the rule P-5 works under, measured rather than promised.
 *   THE FLOORS — `evaluateConversion` still PASSES on configured observations, and FAILS when
 *                configured copy drops a component label. A gate that graded the configured
 *                surface but could no longer fail would be worse than one that never moved.
 *
 * Anti-vacuity throughout: the containment search carries a positive control proving the
 * reader is reading, and the gate assertions carry a failing case proving the floors bite.
 *
 * Paths are built from SEGMENTS, never a module specifier — ADR 0058 §2 forbids importing the
 * config plane from anywhere under `packages`, the lock's import-boundary scan covers this
 * test tree, and the scan is textual, so even a specifier inside a comment would trip it.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AGENT_RELAY_SLOTS,
  DEFAULT_AGENT_RELAY_COPY,
  PRESENTATION_CONTENT_VERSION,
  WIRED_AGENT_RELAY,
  composeRelayNotes,
  evaluateConversion,
  overrideKey,
  resolvePresentation,
  type ConversionObservation,
  type RelayFacts,
} from "../../src/index.js"
import {
  DEFAULT_GUARD_OFFER_COPY,
  GUARD_HOST_IDS,
  continuousProtectionOffer,
  renderContinuousProtectionOffer,
} from "@calllint/core"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..", "..")

const DOC_PATH = resolve(repoRoot, "apps", "web", "content", "safe-install", "presentation.v1.json")
const doc: unknown = existsSync(DOC_PATH) ? JSON.parse(readFileSync(DOC_PATH, "utf8")) : null

/**
 * The resolved plane, from the RAW document.
 *
 * Deliberately not `loadPresentationIfPresent()`: that returns an already-RESOLVED object, and
 * feeding it back through `resolvePresentation` type-checks while mis-measuring plausibly
 * (`overriddenSlots` collapses, sections appear that no document carries). To measure a
 * DOCUMENT, parse it and pass the raw object exactly once.
 */
const resolved = resolvePresentation(doc as never)

// --- the served corpus, read once ---------------------------------------------

const INSTALL_ROOT = resolve(repoRoot, "apps", "web", "public", "install")

/** Every committed install page and its sealed sidecar, walked from the served tree. */
function servedCorpus(): { slug: string; html: string; json: string }[] {
  if (!existsSync(INSTALL_ROOT)) return []
  const out: { slug: string; html: string; json: string }[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = resolve(dir, entry.name)
      const slug = prefix === "" ? entry.name : `${prefix}/${entry.name}`
      const html = resolve(child, "index.html")
      const json = resolve(child, "index.json")
      if (existsSync(html) && existsSync(json)) {
        out.push({ slug, html: readFileSync(html, "utf8"), json: readFileSync(json, "utf8") })
      } else {
        walk(child, slug)
      }
    }
  }
  walk(INSTALL_ROOT, "")
  return out
}

const served = servedCorpus()

describe("PR P-5 — the committed catalog is byte-for-byte the shipped defaults", () => {
  it("resolves guardConversion DEEP-EQUAL to the code defaults", () => {
    // If this ever fails, P-5 stopped being a no-behavior change: the render would emit
    // different words than the code ships, and every install page would have to be re-baked.
    // Deep equality rather than per-slot containment, so an ADDED slot fails too.
    expect(resolved.guardConversion).toEqual(DEFAULT_GUARD_OFFER_COPY)
  })

  it("resolves agentRelay DEEP-EQUAL to the code defaults", () => {
    expect(resolved.agentRelay).toEqual(DEFAULT_AGENT_RELAY_COPY)
  })

  it("records the three sections as overridden — a document restating a default still counts", () => {
    // The resolver's convention (`mergeSlots`): any present, usable key is recorded, even when
    // the value equals the default. That is what keeps the lock's inert-document clause from
    // firing on this catalog, and it is the reason `overriddenSlots` GREW while
    // `resolvesToDefaults` still holds. Both halves are asserted so neither can be lost.
    const slots = resolved.overriddenSlots
    expect(slots.some((s) => s.startsWith("guardConversion."))).toBe(true)
    expect(slots).toContain("agentRelayCopy.guardOffer")
    expect(slots.some((s) => s.startsWith("overrides.resources."))).toBe(true)
    // Nothing configured is dead, and nothing configured was rejected. The whole point of the
    // batch is that these two lists stay empty for the SHIPPED document while still being
    // capable of reporting — the capability is proven in `resolve-presentation.test.ts`.
    expect(resolved.unwiredSlots).toEqual([])
    expect(resolved.rejectedSlots).toEqual([])
  })

  it("resolves the override to the SHIPPED derived display name", () => {
    // A `displayName` override that differed from the derived value would change 19 sealed
    // contracts' `<title>` and break byte-identity. The catalog restates it, so the override
    // exercises the whole path — encode, merge, apply downstream of the seal — while moving
    // no byte. Asserted against the served page's own <title> rather than a hardcoded string,
    // so the check cannot drift from what actually shipped.
    const keys = Object.keys(resolved.overrides.resources)
    expect(keys.length, "the catalog carries no override, so the path is untested").toBeGreaterThan(0)
    for (const key of keys) {
      const name = resolved.overrides.resources[key]?.displayName
      if (name === undefined) continue
      const page = served.find((p) => overrideKey(p.slug) === key)
      expect(page, `override key ${key} addresses no served page — the encoding is wrong`).toBeDefined()
      expect(page?.html).toContain(name)
    }
  })
})

describe("PR P-5 — the zero-served-byte claim, measured", () => {
  it("reads a non-empty served corpus", () => {
    // The control for everything below: a corpus that read as empty would make every
    // containment assertion pass by finding nothing anywhere.
    expect(served.length).toBeGreaterThan(0)
  })

  it("finds NO resolved guard or relay string in any committed page or sealed contract", () => {
    // The batch's headline claim. It is structural, not a coincidence of the current wording:
    // the guard offer renders to a terminal and the relay line lands in an MCP notes[] array,
    // neither of which is an install page. A hit means a renderer gained a surface it should
    // not have — and because this reads the COMMITTED corpus, it fails on a stale tree too.
    const strings = [
      ...Object.entries(resolved.guardConversion).map(([k, v]) => [`guardConversion.${k}`, v] as const),
      ...Object.entries(resolved.agentRelay).map(([k, v]) => [`agentRelay.${k}`, v] as const),
    ]
    expect(strings.length, "nothing to search for — the slices resolved empty").toBeGreaterThan(0)
    const hits: string[] = []
    for (const [slot, value] of strings) {
      for (const page of served) {
        if (page.html.includes(value)) hits.push(`${slot} in install/${page.slug}/index.html`)
        if (page.json.includes(value)) hits.push(`${slot} in install/${page.slug}/index.json`)
      }
    }
    expect(hits).toEqual([])
  })

  it("positive control: a string that IS served is found by the same reader", () => {
    // Without this, the emptiness above could mean the reader was broken rather than the
    // claim being true — the vacuity trap that motivated the audit's probe rows.
    const found = served.filter((p) => p.html.includes("with CallLint"))
    expect(found.length).toBe(served.length)
    // And the sidecars genuinely differ from the pages, so "searched both" is not one search
    // twice. The sealed contract carries no page chrome.
    expect(served.filter((p) => p.json.includes("with CallLint"))).toEqual([])
  })
})

describe("PR P-6 — the relay surface is a projection, and it is served nowhere", () => {
  /**
   * Relay facts read off a SEALED sidecar, exactly as `runPrepare` reads them off a committed
   * contract. Nothing is composed or defaulted here — a field the sidecar does not carry stays
   * absent, which is what lets the gates below be exercised by real bytes instead of fixtures.
   *
   * `planDigest` is deliberately synthesized: it is the one fact that is NOT in a contract (it
   * is computed per plan), and `planDigest present in any sidecar` measures 0 of 19. Passing a
   * digest here is therefore the honest way to reach the `approvalQuestion` sentence — and the
   * per-slot gate assertions in `packages/calllint-mcp/test/relay-notes.test.ts` grade its
   * absence.
   */
  const factsFromSidecar = (json: string): RelayFacts => {
    const c = JSON.parse(json) as {
      publicObservation?: {
        verdict?: string
        publicLabel?: string
        reasonCodes?: readonly string[]
        evidenceLevel?: string
        completeness?: "complete" | "partial"
      }
      authorityDelta?: { adds?: readonly { authority: string }[]; notObserved?: readonly string[] }
    }
    const obs = c.publicObservation ?? {}
    const delta = c.authorityDelta ?? {}
    return {
      verdict: obs.verdict ?? null,
      publicLabel: obs.publicLabel ?? null,
      reasonCodes: obs.reasonCodes ?? [],
      evidenceLevel: obs.evidenceLevel ?? null,
      completeness: obs.completeness ?? null,
      adds: (delta.adds ?? []).map((a) => a.authority),
      notObserved: delta.notObserved ?? [],
      planDigest: `sha256:${"b".repeat(64)}`,
    }
  }

  it("wires all six slots, with the two tables agreeing", () => {
    // P-5 shipped one wired slot; P-6 wires the other five. Asserted as SET equality against
    // the schema domain rather than a count, so a slot renamed on one side and not the other
    // fails by name instead of still totalling six.
    expect([...WIRED_AGENT_RELAY].sort()).toEqual([...AGENT_RELAY_SLOTS].sort())
    expect(new Set(WIRED_AGENT_RELAY).size).toBe(WIRED_AGENT_RELAY.length)
  })

  it("records all six relay slots as overridden — the catalog reaches every one", () => {
    // P-5 could only assert `agentRelayCopy.guardOffer`, because it was the only slot with a
    // consumer. The catalog now restates all six, and each must be RECORDED as overridden or
    // the resolver silently dropped a key the document carries.
    for (const slot of AGENT_RELAY_SLOTS) {
      expect(resolved.overriddenSlots, `agentRelayCopy.${slot} is not recorded`).toContain(
        `agentRelayCopy.${slot}`,
      )
    }
  })

  it("composes the SAME sentences from the catalog as from the code defaults", () => {
    // The identity assertion above compares the two copy objects; this one compares what they
    // PRODUCE. A resolver that returned the right strings but reordered or dropped a slot would
    // pass the first and fail here, which is why both exist.
    expect(served.length, "no sealed contract to compose from").toBeGreaterThan(0)
    for (const page of served) {
      const facts = factsFromSidecar(page.json)
      expect(
        composeRelayNotes(resolved.agentRelay, facts),
        `install/${page.slug} composes differently from configured copy`,
      ).toEqual(composeRelayNotes(DEFAULT_AGENT_RELAY_COPY, facts))
    }
  })

  it("finds NO composed relay SENTENCE in any committed page or sealed contract", () => {
    // P-5's search covered the six raw slot values. A composed sentence is a different string —
    // slot wording, a separator, and a machine fact — so a renderer that emitted the projection
    // rather than the slot would have slipped past the P-5 search while spending served bytes.
    // Searching what `runPrepare` actually pushes closes that gap.
    //
    // The claim is structural: the sentences land in an MCP `notes[]` array, which is not an
    // install page. Reading the COMMITTED corpus means a stale tree fails too.
    const sentences = new Set<string>()
    for (const page of served) {
      for (const note of composeRelayNotes(resolved.agentRelay, factsFromSidecar(page.json))) {
        sentences.add(note)
      }
    }
    expect(sentences.size, "nothing composed — the search would pass by finding nothing").toBeGreaterThan(0)
    const hits: string[] = []
    for (const sentence of sentences) {
      for (const page of served) {
        if (page.html.includes(sentence)) hits.push(`"${sentence}" in install/${page.slug}/index.html`)
        if (page.json.includes(sentence)) hits.push(`"${sentence}" in install/${page.slug}/index.json`)
      }
    }
    expect(hits).toEqual([])
  })

  it("every emitted sentence names a machine fact from the contract it was composed from", () => {
    // Decision 7's superset rule, graded on real bytes: a relay slot may only be emitted when
    // the sealed contract carries its basis. Each sentence is checked to CONTAIN the field it
    // relays, so relay wording alone can never satisfy the check.
    for (const page of served) {
      const facts = factsFromSidecar(page.json)
      const notes = composeRelayNotes(resolved.agentRelay, facts)
      const find = (slot: keyof typeof DEFAULT_AGENT_RELAY_COPY): string | undefined =>
        notes.find((n) => n.startsWith(DEFAULT_AGENT_RELAY_COPY[slot]))

      // Unconditional, because every sealed contract carries a verdict and an evidence level.
      expect(find("headline"), `install/${page.slug} headline`).toContain(String(facts.verdict))
      expect(find("reason"), `install/${page.slug} reason`).toContain(String(facts.evidenceLevel))

      // Gated. Presence must track the basis in BOTH directions — an omitted sentence whose
      // fact is present is as wrong as an emitted one whose fact is absent.
      expect(find("adds") !== undefined, `install/${page.slug} adds`).toBe(facts.adds.length > 0)
      if (facts.adds.length > 0) expect(find("adds")).toContain(facts.adds[0])

      const notObservedExpected = facts.completeness === "complete" && facts.notObserved.length > 0
      expect(find("notObserved") !== undefined, `install/${page.slug} notObserved`).toBe(notObservedExpected)
      if (notObservedExpected) expect(find("notObserved")).toContain(facts.notObserved[0])

      // `guardOffer` belongs to a different tool's outcome and is pushed by that tool, so the
      // decision-relay composer must never emit it — the seam that keeps the two surfaces apart.
      expect(find("guardOffer"), `install/${page.slug} leaked guardOffer`).toBeUndefined()
    }
  })

  it("the served corpus really does exercise both sides of the `adds` gate", () => {
    // Anti-vacuity for the gate assertions above. Measured on the committed bundle: 17 sidecars
    // carry `adds: [1]` and 2 carry `adds: []`, so the both-directions check has a witness on
    // each side. A corpus that had drifted to one shape would make half of it decorative.
    const withAdds = served.filter((p) => factsFromSidecar(p.json).adds.length > 0)
    expect(withAdds.length, "no sidecar carries adds — the emit side is untested").toBeGreaterThan(0)
    expect(
      served.length - withAdds.length,
      "every sidecar carries adds — the omit side is untested",
    ).toBeGreaterThan(0)
  })
})

describe("PR P-5 — the gate floors bite on the configured surface", () => {
  /** Observations exactly as `observeGateF` builds them, from the resolved plane. */
  const observe = (copy: Partial<typeof DEFAULT_GUARD_OFFER_COPY>): ConversionObservation[] =>
    GUARD_HOST_IDS.map((host) => {
      const offer = continuousProtectionOffer({ hosts: [host], copy })
      return {
        host,
        recommendation: offer.recommendation,
        requiresSeparateAuthorization: offer.requiresSeparateAuthorization,
        declineOption: offer.declineOption,
        disableCommand: offer.disableCommand,
        disclosureDigest: offer.disclosureDigest,
        components: offer.components.map((c) => ({
          id: c.id,
          label: c.label,
          artifactPath: c.artifactPath,
          uninstallCommand: c.uninstallCommand,
        })),
        renderedText: renderContinuousProtectionOffer(offer),
        copySource: "configured",
        disclosureDigestUnderSentinelCopy: offer.disclosureDigest,
      }
    })

  it("PASSES on the configured plane", () => {
    const result = evaluateConversion(observe(resolved.guardConversion), GUARD_HOST_IDS.length)
    expect(result.status, JSON.stringify(result.measures.filter((m) => !m.pass), null, 1)).toBe("PASSED")
  })

  it("FAILS when configured copy hides a component label", () => {
    // The reason grading the configured surface is worth doing at all. A render that dropped a
    // component label would ask for consent to install something it did not name — and before
    // P-5 the gate could not see it, because it graded copy no document could reach.
    //
    // The mutation is applied to the OBSERVATION, not to the copy: `renderContinuousProtection-
    // Offer` correctly refuses to drop a label, which is itself the point — so the only way to
    // present the gate with a label-hiding render is to hand it one directly.
    const observations = observe(resolved.guardConversion)
    const damaged = observations.map((o, i) =>
      i === 0 ? { ...o, renderedText: o.renderedText.replaceAll(o.components[0]!.label, "") } : o,
    )
    const result = evaluateConversion(damaged, GUARD_HOST_IDS.length)
    expect(result.status).toBe("FAILED")
    const failing = result.measures.filter((m) => !m.pass)
    expect(failing).toHaveLength(1)
    // The message names the undisclosed label, which is what makes the gate output actionable
    // rather than just red.
    expect(String(failing[0]?.observed)).toContain(observations[0]!.components[0]!.label)
    expect(String(failing[0]?.observed)).toContain("not disclosed")
  })

  it("FAILS when the decline affordance is missing from the render", () => {
    // INV-2.4-07's floor, now guarding configuration. `[Not now]` must always be present; the
    // gate checks `[${declineOption}]`, so this also proves that check is not comparing a
    // literal that a configured render could satisfy some other way.
    const observations = observe(resolved.guardConversion)
    const damaged = observations.map((o, i) =>
      i === 0 ? { ...o, renderedText: o.renderedText.replaceAll(`[${o.declineOption}]`, "") } : o,
    )
    const result = evaluateConversion(damaged, GUARD_HOST_IDS.length)
    expect(result.status).toBe("FAILED")
    // Attributed, not merely non-passing: exactly one measure fails, and it is the decline
    // one. A bare status check would pass if the mutation happened to trip something else.
    const failing = result.measures.filter((m) => !m.pass)
    expect(failing).toHaveLength(1)
    expect(String(failing[0]?.observed)).toContain("decline affordance")
  })

  it("FAILS when the sentinel-copy digest differs — configured wording reaching the approval token", () => {
    // The measure P-5 added. If configured copy could move `disclosureDigest`, a re-worded
    // offer would invalidate an approval that is materially unchanged, and worse, a changed
    // COMPONENT set could hide behind a copy edit.
    const observations = observe(resolved.guardConversion)
    const damaged = observations.map((o, i) =>
      i === 0 ? { ...o, disclosureDigestUnderSentinelCopy: `sha256:${"0".repeat(64)}` } : o,
    )
    const result = evaluateConversion(damaged, GUARD_HOST_IDS.length)
    expect(result.status).toBe("FAILED")
    const failing = result.measures.filter((m) => !m.pass)
    expect(failing).toHaveLength(1)
    expect(failing[0]?.id).toBe("disclosure-digest-invariant-under-configured-copy")
  })

  it("observes the configured plane for every guard host, with no host lost", () => {
    const observations = observe(resolved.guardConversion)
    expect(observations).toHaveLength(GUARD_HOST_IDS.length)
    expect(observations.every((o) => o.copySource === "configured")).toBe(true)
    // The catalog restates the defaults, so the configured render must be byte-identical to
    // the default one. This is the assertion that makes "zero served bytes" and "the gate reads
    // the plane" hold at the same time — and the only reason `copySource` has to be a recorded
    // field rather than something the gate could infer from the text.
    for (const host of GUARD_HOST_IDS) {
      const configured = renderContinuousProtectionOffer(
        continuousProtectionOffer({ hosts: [host], copy: resolved.guardConversion }),
      )
      const shipped = renderContinuousProtectionOffer(continuousProtectionOffer({ hosts: [host] }))
      expect(configured).toBe(shipped)
    }
  })

  it("the document under test is the committed catalog, not a fixture", () => {
    // Guards the whole file against the quietest failure mode: if `DOC_PATH` ever stopped
    // resolving, every assertion above would run against `DEFAULT_PRESENTATION` and pass while
    // measuring nothing about what shipped.
    expect(doc, `${DOC_PATH} is missing`).not.toBeNull()
    expect((doc as { schema?: string }).schema).toBe(PRESENTATION_CONTENT_VERSION)
  })
})
