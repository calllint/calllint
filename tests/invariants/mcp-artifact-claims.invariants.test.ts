import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// The FIRST machine reader of `artifacts/mcp-2026-07-28/**`.
//
// Before this file, all three artifacts in that directory had ZERO code readers. Measured:
// `grep -rn "artifacts/mcp-2026-07-28" --include=*.ts --include=*.mjs` returned exactly one hit,
// and it was a COMMENT. `finality-status.json`, `protocol-delta-matrix.json` and `open-items.md`
// were cited as prose by tests that assert against the VENDORED BYTES, never against the artifact.
//
// That gap is not hypothetical, and this is the finding that made the batch worth doing: the
// over-precise removal-clock claim ("earliest removal is the first revision on or after
// 2027-07-28") was FOUND and GATED in `finality-status.json` by
// `mcp-spec-vendor.invariants.test.ts:180` — and survived verbatim in `protocol-delta-matrix.json`
// D6, because nothing read that file. A correction only reaches the copy that something reads.
//
// M-OPEN-2 in `artifacts/mcp-2026-07-28/open-items.md` specified this fix in advance, for
// "whichever batch adds the first reader", including the part that is easy to get wrong: resolve
// the amendment chain and assert the resolution, and do NOT overwrite the stale top-level fields.
// Overwriting them would destroy the append record and the falsified-claim history that made M26-5
// worth doing. So this gate reads the chain; it never asks the artifact to be rewritten.
//
// NOTHING HERE OPENS A SOCKET (INV-M4), and nothing here is derived from a live page.
//
// THREE LAYERS, each a claim the other two cannot make:
//   1. AMENDMENT RESOLUTION — a reader that takes the obvious top-level key gets a value that is
//      now false. Both sides are asserted, so the naive read is a red, not a silent wrong answer.
//   2. POINTER TRUTH — every `path:line` the artifact cites must still point at what it claims.
//      Line numbers drift silently; `currentState.servedAt` was pointing at a BLANK LINE.
//   3. CROSS-CONSISTENCY — an artifact claim must not contradict the digest-locked bytes. Derived
//      from those bytes, never restated from the artifact, or the gate would agree with the error.
const repoRoot = new URL("../../", import.meta.url)

/**
 * Read a repo-relative text file, with CRLF normalized to LF.
 *
 * The normalization here is DEFENSIVE, not load-bearing — and saying so is the point, because the
 * first draft of this docblock claimed the opposite and was wrong about the repo.
 *
 * Measured with `git check-attr text eol`, not assumed:
 *   - `artifacts/mcp-2026-07-28/**` IS pinned `text eol=lf` (`.gitattributes:112`), added by M26-0
 *     for exactly this reason — the comment there names the windows-latest-alone trap.
 *   - `third_party/**` is pinned too (`.gitattributes:149`), plus a sha256 lock and a `\r` counter.
 *   - `packages/calllint-mcp/src/server.ts` is `unspecified` — the one unpinned file read below.
 *
 * So on a windows-latest checkout only `server.ts` arrives CRLF, and negative control #154 (strip
 * this `.replace` AND convert `server.ts` to CRLF, i.e. reproduce that checkout exactly) leaves the
 * suite 8/8 GREEN. Not luck, and measured rather than inferred: every assertion over that file is
 * `\r`-blind by construction — two are `\s`-tolerant regexes, and `assertPointer` uses `toContain`
 * on a single line, where a trailing `\r` sits past the match. The shape that WOULD break is an
 * exact `toBe` on a line, which nothing here does.
 *
 * The normalization stays anyway, for one reason: the next assertion added to this gate does not
 * inherit that tolerance, and ADR 0064 §6.2 was paid for by a gate that sliced un-normalized source,
 * got -1 from `indexOf`, silently widened its own scope via `slice(start, -1)`, and reported a defect
 * in the wrong method. Normalizing at the reader makes that class unreachable here instead of
 * relying on every future assertion being accidentally `\r`-tolerant.
 *
 * The general rule from §6.2 is unchanged and still correct — a gate that searches or slices an
 * unpinned file must normalize first, and the deciding line is digest-locked-or-pinned vs not. What
 * was wrong was this file's claim about WHICH SIDE `artifacts/**` falls on.
 */
const readText = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, repoRoot)), "utf8").replace(/\r\n/g, "\n")

const readJson = <T>(rel: string): T => JSON.parse(readText(rel)) as T

const ARTIFACT_DIR = "artifacts/mcp-2026-07-28"
const VENDOR_DIR = "third_party/mcp-spec/2026-07-28"

interface Amendable {
  readonly [key: string]: unknown
}

/**
 * Match an amendment key in EITHER casing the two artifacts actually use.
 *
 * Measured, because assuming one casing is what made the first draft of this gate wrong:
 * `finality-status.json` writes `verdictAmendedByM26-5` (field-prefixed, capital A) and
 * `protocol-delta-matrix.json` writes `amendedByM26-1` / `amendedByM26-3` (bare, lowercase a).
 * A `/AmendedByM26-/` regex matches only the first, so every matrix lookup fell through to the
 * TOP-LEVEL STALE VALUE and reported success. That is the exact failure mode M-OPEN-2 exists to
 * forbid, and the only reason it surfaced here is that the assertions below check `via` — the
 * source that answered — and not just the value.
 */
const AMENDMENT_KEY = /^(?:\w+A|a)mendedByM26-/
const BATCH_NO = /M26-(\d+)/

/**
 * Amendment keys on one object, NEWEST BATCH FIRST, ordered numerically.
 *
 * Both halves of that sentence were wrong in the first version of this helper, which sorted
 * lexicographically ascending. M26-4 is what exposed it, because `currentState` became the first
 * object in either artifact to carry TWO amendments (`amendedByM26-3`, `amendedByM26-4`) that both
 * supply the same field:
 *
 *   - ASCENDING made the OLDEST amendment win. `servedAt` resolved to M26-3's `server.ts:171`
 *     instead of M26-4's `:325`, i.e. the gate read a superseded pointer as current.
 *   - LEXICOGRAPHIC breaks at the tenth batch: `["M26-3","M26-4","M26-10","M26-2"].sort()` puts
 *     `M26-10` FIRST. Nothing has reached M26-10 yet, so this is fixed now, while it is a
 *     one-line change and not a debugging session.
 *
 * The first defect is the dangerous one, and it is dangerous in a specific way worth naming:
 * `expectResolvedViaAmendment` would have stayed GREEN, because `via` was non-null — an amendment
 * did answer, just the wrong one. [[assert-which-source-answered]] in a sharper form than the
 * memory records it: checking THAT a non-obvious source answered is not the same as checking that
 * the CURRENT one did. What actually caught it is layer 2 asserting the cited line's CONTENT, since
 * `server.ts:171` is a docblock line. An `assertPointer` that only checked the line exists would
 * have passed on the stale pointer.
 *
 * Unparseable keys are surfaced rather than coerced: `Number(undefined)` is `NaN`, every comparison
 * against it is false, and the key would drift to an arbitrary position while the regex still
 * matched it. So they sort LAST and are asserted against in "amendment keys resolve newest-first".
 */
const batchNoOf = (key: string): number => {
  const m = BATCH_NO.exec(key)
  return m === null ? Number.NEGATIVE_INFINITY : Number(m[1])
}

const amendmentKeysOf = (obj: Amendable): readonly string[] =>
  Object.keys(obj)
    .filter((k) => AMENDMENT_KEY.test(k))
    .sort((a, b) => batchNoOf(b) - batchNoOf(a) || a.localeCompare(b))

const asBlock = (v: unknown): Amendable | null =>
  v !== null && typeof v === "object" ? (v as Amendable) : null

/**
 * Resolve one append-amended field to its CURRENT value.
 *
 * The append discipline these artifacts use (ADR 0061 §8.5.1, new17 §three) keeps a falsified claim
 * verbatim and adds a nested amendment block saying "read this as current". That preserves the
 * history, and it puts the STALE value at the obvious key — so the correct read is the non-obvious
 * one. This helper is the shape M-OPEN-2 prescribed: prefer the amendment, fall back to the top
 * level only when no amendment exists.
 *
 * Returns the amendment key it used (or null), so a caller can assert WHICH source answered rather
 * than only what the answer was — an assertion that cannot tell those apart passes for the wrong
 * reason the moment an amendment is deleted.
 */
function resolveAmended(
  obj: Amendable,
  field: string,
): { value: unknown; via: string | null } {
  for (const key of amendmentKeysOf(obj)) {
    const block = asBlock(obj[key])
    if (block !== null && field in block) {
      return { value: block[field], via: key }
    }
  }
  return { value: obj[field], via: null }
}

/**
 * Find the amendment that SUPERSEDES `field` without restating it.
 *
 * Kept separate from `resolveAmended` on purpose, because the artifacts do both and the difference
 * is load-bearing. Measured: `D6.amendedByM26-3` carries a replacement `change` and `owner`, while
 * `summary.amendedByM26-1` carries NO `allBlockedBy` key — it supersedes the claim in prose and
 * leaves nothing to read in its place. Folding the two into one helper would make a superseded-only
 * claim indistinguishable from an unamended one, which is the same conflation M-OPEN-2 objects to.
 *
 * The `supersedes` string names its target in backticks, so that is what this matches.
 */
function supersededBy(obj: Amendable, field: string): string | null {
  for (const key of amendmentKeysOf(obj)) {
    const block = asBlock(obj[key])
    const supersedes = block?.supersedes
    if (typeof supersedes === "string" && supersedes.includes(`\`${field}\``)) return key
  }
  return null
}

/**
 * Assert that `field` resolved through an amendment, printing the ABSENCE when it did not.
 *
 * `expect(via).toMatch(AMENDMENT_KEY)` is the obvious form and it is a bad one: when no amendment
 * exists `via` is `null`, and vitest reports `.toMatch() expects to receive a string, but got
 * object` — a complaint about the matcher's ARGUMENT TYPE that names neither the field nor the
 * amendment that went missing. Negative control #150 (delete `verdictAmendedByM26-5` wholesale)
 * produced exactly that: red on the right test, with a message that would send the next reader to
 * the wrong place. So the null case is separated and named, and only then is the key shape checked.
 *
 * The message prints the stale value that WOULD have been read as current, because that value is
 * the actual consequence of the missing amendment — [[every-collapses-the-observed-value]] applied
 * to an absence rather than to a boolean. Control #151 (a `resolveAmended` that ignores amendments)
 * is what demonstrates the payoff: five reds, each printing the exact stale claim a naive reader
 * would have believed.
 *
 * `undefined` is reported as ABSENT-AT-TOP-LEVEL rather than printed raw, and this distinction was
 * bought by control #157 (delete F5's `amendedByM26-8`). That control red on the right assertion,
 * but its message read `the STALE top-level value undefined would be read as current` — which is a
 * false sentence twice over: F5's unamended source is not absent, it lives NESTED at
 * `evidence.source`, and no reader would have read `undefined` as anything. `resolveAmended` knows
 * only the flat shape (§6 of ADR 0068), so a raw print of its fallback describes the resolver's
 * blind spot as if it were the record's content. Naming the absence and the two places a value can
 * live sends the next reader to the shape question instead of to a phantom missing field.
 */
function expectResolvedViaAmendment(
  resolved: { value: unknown; via: string | null },
  obj: Amendable,
  field: string,
  why: string,
): void {
  const stale =
    resolved.value === undefined
      ? `ABSENT-AT-TOP-LEVEL (an unamended \`${field}\` lives nested, e.g. evidence.${field} — resolveAmended reads only the flat key)`
      : `the STALE top-level value ${JSON.stringify(resolved.value)}`
  expect(
    resolved.via,
    `${field}: no amendment block supplies it, so ${stale} would be read as current. ${why} Amendment keys present: ${JSON.stringify(
      amendmentKeysOf(obj),
    )}`,
  ).not.toBeNull()
  expect(resolved.via, `${field}: amendment key has an unrecognized shape`).toMatch(AMENDMENT_KEY)
}

describe("M26-3 — the mcp-2026-07-28 artifacts have a reader, and it resolves the amendment chain", () => {
  it("finality-status.json: the CURRENT verdict comes from the amendment, not the top-level key", () => {
    const status = readJson<Amendable>(`${ARTIFACT_DIR}/finality-status.json`)

    // The naive read, asserted EXPLICITLY as stale. This is the half that makes the layer a gate
    // rather than a restatement: if a future batch "tidies" the artifact by overwriting the
    // top-level fields, this reds and says the append record was destroyed — which M-OPEN-2
    // forbids for a reason (it is where the falsified-claim history lives).
    expect(
      status.productionChangesAllowed,
      "the top-level value must stay verbatim-stale — overwriting it destroys the append record (M-OPEN-2)",
    ).toBe(false)
    expect(status.verdict).toBe("PENDING_FINAL")

    // The resolved read: what a correct consumer must conclude today.
    const allowed = resolveAmended(status, "productionChangesAllowed")
    const verdict = resolveAmended(status, "verdict")
    expectResolvedViaAmendment(
      allowed,
      status,
      "productionChangesAllowed",
      "All eight finality gates PASS as of M26-5, so a reader taking the top level concludes the opposite of the truth.",
    )
    expect(allowed.value).toBe(true)
    expectResolvedViaAmendment(
      verdict,
      status,
      "verdict",
      "M26-5 moved the verdict to FINALITY_MET_NOT_IMPLEMENTED.",
    )
    expect(verdict.value).toBe("FINALITY_MET_NOT_IMPLEMENTED")

    // And the amendment must say what it supersedes. An amendment that silently replaces a value
    // is the same hazard as an overwrite, one level down.
    const amendment = status.verdictAmendedByM26_5 ?? status["verdictAmendedByM26-5"]
    expect(
      amendment,
      "the amendment block must exist under a verdictAmendedByM26-* key",
    ).toBeTruthy()
    expect(JSON.stringify(amendment)).toContain("supersedes")
  })

  it("finality-status.json: every original nonClaim is superseded, and the replacements hold", () => {
    // `nonClaims` had ZERO readers until this test — measured, `grep -rn nonClaims --include=*.ts
    // --include=*.mjs` returned only the artifact itself. All three entries went false at M26-4
    // and nothing would have said so. That is M26-3's own finding recurring ONE FIELD AWAY from
    // the reader M26-3 installed: a reader covers the fields it names, and the fields beside them
    // keep drifting. Adding a reader is not a property of a file, it is a property of a field.
    const status = readJson<Amendable>(`${ARTIFACT_DIR}/finality-status.json`)

    const original = status.nonClaims as readonly string[] | undefined
    expect(Array.isArray(original), "finality-status.json must keep its original nonClaims[]").toBe(true)
    expect(original?.length, "all three original entries must stay verbatim (M-OPEN-2)").toBe(3)
    // The one that names support, asserted verbatim — this is the sentence M26-4 falsified.
    expect(original?.[0]).toContain("does NOT support MCP 2026-07-28")

    const amended = resolveAmended(status, "nonClaims")
    // `nonClaims` is superseded WITHOUT a replacement under the same key: the amendment carries
    // `nonClaimsNow`, deliberately renamed so a consumer cannot read the new list as the old one.
    // So `resolveAmended` answers `via: null` here, and that is correct — the assertion is on
    // `supersededBy`, the same distinction `summary.allBlockedBy` needed.
    expect(
      amended.via,
      "nonClaims is superseded in prose with a RENAMED replacement; a same-key value would be a different claim",
    ).toBeNull()
    const via = supersededBy(status, "nonClaims")
    expect(
      via,
      `nonClaims must be superseded — all three entries are false as of M26-4. Amendment keys present: ${JSON.stringify(
        amendmentKeysOf(status),
      )}`,
    ).toMatch(AMENDMENT_KEY)

    const block = asBlock(status[via as string])
    const now = block?.nonClaimsNow as readonly string[] | undefined
    expect(Array.isArray(now), "the amendment must carry a replacement list under `nonClaimsNow`").toBe(
      true,
    )
    expect(now?.length, "a superseding list must not be empty — that would claim everything").toBeGreaterThan(0)

    // DERIVED, not taken on the artifact's word. Entry 1 said support is not claimed; the source
    // must now show the second revision in the supported set, or the supersede is itself false.
    const server = readText("packages/calllint-mcp/src/server.ts")
    expect(
      server,
      "nonClaims[0] is declared false, so the supported set must actually carry the second revision",
    ).toMatch(/SUPPORTED_PROTOCOL_VERSIONS[^=]*=[\s\S]{0,200}STATELESS_PROTOCOL_VERSION/)
    expect(server).toMatch(/STATELESS_PROTOCOL_VERSION\s*=\s*"2026-07-28"/)

    // And the replacement list must not quietly re-assert what was just retired. A future batch
    // copying entry 1 forward would reinstate a false claim under a new key.
    const reasserted = (now ?? []).filter((s) => /does NOT support MCP 2026-07-28/.test(s))
    expect(reasserted, "the replacement list must not re-assert the retired non-claim").toEqual([])

    // The two things still genuinely unclaimed must survive: F5/F6's unvendored basis, and the
    // no-execution floor. Named, so a replacement list that drops them reds.
    const joined = (now ?? []).join("\n")
    expect(joined, "F5/F6's unvendored basis is still a real limitation (M-OPEN-1)").toMatch(/F5 and F6/)
    expect(joined, "the no-execution floor is a product principle, not a batch detail").toMatch(
      /never executes|Deep Scan/,
    )
  })

  it("all eight finality gates pass, and F5/F6 still rest on unvendored pages", () => {
    const status = readJson<Amendable>(`${ARTIFACT_DIR}/finality-status.json`)
    const gates = status.gates as readonly Amendable[] | undefined
    expect(Array.isArray(gates), "finality-status.json must carry a gates[] array").toBe(true)
    const rows = gates ?? []
    expect(rows.length).toBe(8)

    // Set form, not `.every()`: a boolean collapse prints "expected false to be true" and names
    // nothing ([[every-collapses-the-observed-value]]). This prints the offending gate ids.
    const notPassing = rows
      .filter((g) => g.status !== "PASS")
      .map((g) => `${String(g.id)}=${String(g.status)}`)
    expect(notPassing, "every finality gate must read PASS").toEqual([])
  })
})

describe("M26-3 — every path:line an artifact cites must still point at what it claims", () => {
  /**
   * Assert that a `path:line` pointer resolves to a line CONTAINING `expected`.
   *
   * Asserting only that the line exists would be satisfied by a blank line, which is exactly the
   * defect this layer was written to catch: `currentState.servedAt` read `server.ts:61`, line 61 is
   * blank, and the real location is line 171. So the assertion is on the line's CONTENT, and the
   * failure message prints what actually sits there.
   */
  function assertPointer(pointer: string, expected: string, label: string): void {
    const match = /^(.+):(\d+)$/.exec(pointer)
    expect(match, `${label}: "${pointer}" must be a path:line pointer`).not.toBeNull()
    const [, path, lineNo] = match as RegExpExecArray
    const lines = readText(path as string).split("\n")
    const n = Number(lineNo)
    expect(n, `${label}: line number must be within ${path} (${lines.length} lines)`).toBeLessThanOrEqual(
      lines.length,
    )
    const actual = lines[n - 1] ?? ""
    expect(
      actual,
      `${label}: ${pointer} should contain ${JSON.stringify(expected)}, but that line reads ${JSON.stringify(actual)}`,
    ).toContain(expected)
  }

  it("protocol-delta-matrix currentState points at the version constant and where it is served", () => {
    const matrix = readJson<Amendable>(`${ARTIFACT_DIR}/protocol-delta-matrix.json`)
    const state = matrix.currentState as Amendable

    // The stale top level, asserted verbatim — same discipline as the finality-status layer above.
    // All four of these fields were true when written and all four are now superseded.
    expect(state.advertised, "the top-level value must stay verbatim-stale (M-OPEN-2)").toBe(
      "2024-11-05",
    )
    expect(state.unchangedByThisBatch).toBe(true)

    // Every one of them resolves through the chain. `source` and `advertised` did NOT, until M26-4
    // amended them and this gate red on `source` — with the message that made the cause obvious:
    // `server.ts:13 should contain 'PROTOCOL_VERSION = "2024-11-05"', but that line reads "// ---"`.
    // That red is the gate working: M26-3 predicted it in this artifact's own amendment prose ("a
    // batch that moves a `path:line` an artifact cites will red there, and the fix is to append an
    // amendment, never to edit the pointer in place"), and the prediction came true on the first
    // run after the implementation landed. Reading the top level here would have re-created exactly
    // the hazard layer 1 exists to forbid, one field over.
    const advertised = resolveAmended(state, "advertised")
    expectResolvedViaAmendment(
      advertised,
      state,
      "advertised",
      "M26-4 (ADR 0066) made the public claim, so a single-revision answer is no longer the whole set.",
    )
    // Both revisions named, and the ORDER asserted. The order is an advertisement that must agree
    // with the fallback rather than the fallback itself — negative control #156 measured that
    // reversing the source array reds three assertions but moves no client, because `servedAt`
    // reads `PROTOCOL_VERSION` directly. Oldest-first is what keeps the artifact's description
    // consistent with what today's clients, none of which send `_meta`, actually receive.
    expect(String(advertised.value)).toContain("2024-11-05")
    expect(String(advertised.value)).toContain("2026-07-28")
    expect(
      String(advertised.value).indexOf("2024-11-05"),
      "the legacy revision must be named FIRST — an undeclared request is served at it",
    ).toBeLessThan(String(advertised.value).indexOf("2026-07-28"))

    const source = resolveAmended(state, "source")
    expectResolvedViaAmendment(
      source,
      state,
      "source",
      "This batch's docblocks moved `const PROTOCOL_VERSION` from line 13 to 29.",
    )
    assertPointer(String(source.value), 'PROTOCOL_VERSION = "2024-11-05"', "currentState.source")

    // `servedAt` is amended TWICE (M26-3 → :171, M26-4 → :325), which is what forced
    // `amendmentKeysOf` to order newest-first. Ascending order resolved to M26-3's now-stale :171
    // while `expectResolvedViaAmendment` stayed green, because an amendment DID answer — just not
    // the current one. Only the content assertion below caught it.
    const servedAt = resolveAmended(state, "servedAt")
    expectResolvedViaAmendment(
      servedAt,
      state,
      "servedAt",
      "The recorded line number drifted when M26-2 hoisted INSTRUCTIONS/CAPABILITIES above the switch, and again when M26-4 added its docblocks.",
    )
    // Amended THREE times now (M26-3 → :171, M26-4 → :335, M26-6 → :418), and the newest must
    // win each time. This literal is the one place a batch that moves this pointer has to edit by
    // hand; it is deliberate, and it is paired with the content assertion below, which is what
    // actually caught the ascending-order bug when `via` alone stayed plausible.
    expect(
      servedAt.via,
      "with three amendments supplying `servedAt`, the NEWEST must win — the older ones point at unrelated lines",
    ).toBe("amendedByM26-6")
    assertPointer(String(servedAt.value), "protocolVersion: PROTOCOL_VERSION", "currentState.servedAt")

    // The claim `unchangedByThisBatch: false` is DERIVED, not taken on the artifact's word: the
    // supported set must actually carry the second revision now.
    const unchanged = resolveAmended(state, "unchangedByThisBatch")
    expectResolvedViaAmendment(
      unchanged,
      state,
      "unchangedByThisBatch",
      "M26-4 changed the served surface, so `true` is no longer a description of this file.",
    )
    expect(unchanged.value).toBe(false)
    expect(
      readText("packages/calllint-mcp/src/server.ts"),
      "the artifact says the surface changed; the source must show the second revision in the supported set",
    ).toMatch(/SUPPORTED_PROTOCOL_VERSIONS[^=]*=[\s\S]{0,200}STATELESS_PROTOCOL_VERSION/)
  })

  it("amendment keys resolve newest-first, numerically, and every key parses", () => {
    // The guard on `amendmentKeysOf`'s ORDER, sited once and non-vacuously. Without it the
    // ordering fix above is a silent behaviour with no assertion, and the ascending-order bug it
    // replaced was green everywhere except one content check.
    const matrix = readJson<Amendable>(`${ARTIFACT_DIR}/protocol-delta-matrix.json`)
    const state = matrix.currentState as Amendable
    const keys = amendmentKeysOf(state)
    expect(keys.length, "currentState is the object that carries the amendment stack — if it stops, this test is vacuous").toBeGreaterThan(1)
    // Asserted as ORDER, not as a fixed list. The earlier form hardcoded
    // `["amendedByM26-4","amendedByM26-3"]`, which red on M26-6 for adding a third amendment —
    // i.e. it doubled as a change-detector for a claim `:413` already makes with a name on it.
    // What belongs here is the property `amendmentKeysOf` exists to provide: strictly descending
    // batch numbers, whatever the stack's height. A batch that appends correctly should not have
    // to edit this line; one that breaks the ordering still reds.
    expect(keys).toEqual([...keys].sort((a, b) => batchNoOf(b) - batchNoOf(a)))
    expect(batchNoOf(keys[0]!), "the newest amendment must sort first").toBeGreaterThan(batchNoOf(keys[keys.length - 1]!))

    // The tenth-batch trap, on synthetic keys because no real object has reached M26-10. A
    // lexicographic sort puts `M26-10` first among these; a numeric one puts it first too but for
    // the right reason — so the discriminating case is `M26-2` vs `M26-10`, asserted by position.
    const synthetic = amendmentKeysOf({
      "amendedByM26-2": {},
      "amendedByM26-10": {},
      "amendedByM26-3": {},
      other: {},
    })
    expect(synthetic).toEqual(["amendedByM26-10", "amendedByM26-3", "amendedByM26-2"])

    // Every amendment key in BOTH artifacts must carry a parseable batch number. An unparseable
    // one still matches `AMENDMENT_KEY`, sorts to the end, and would make resolution order
    // arbitrary — so it is named here rather than tolerated.
    const unparseable: string[] = []
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object") return
      for (const [k, v] of Object.entries(node)) {
        if (AMENDMENT_KEY.test(k) && !Number.isFinite(batchNoOf(k))) unparseable.push(k)
        walk(v)
      }
    }
    for (const f of ["finality-status.json", "protocol-delta-matrix.json"]) {
      walk(readJson<unknown>(`${ARTIFACT_DIR}/${f}`))
    }
    expect(unparseable, "every amendedByM26-* key must carry a numeric batch").toEqual([])
  })

  it("D3's falsified premise is amended, and the error code it said was missing exists", () => {
    const matrix = readJson<{ deltas: readonly Amendable[] }>(
      `${ARTIFACT_DIR}/protocol-delta-matrix.json`,
    )
    const d3 = matrix.deltas.find((r) => r.id === "D3") as Amendable
    expect(d3, "the matrix must carry a D3 row").toBeTruthy()

    // The original `why` is a PRESENT-TENSE claim that the error set has no version-mismatch
    // member. M26-1 shipped one. Kept verbatim (append discipline), so the gate asserts the
    // amendment exists rather than asserting the stale text is gone.
    expect(String(d3.why)).toContain("has no version-mismatch member")
    const why = resolveAmended(d3, "why")
    expectResolvedViaAmendment(
      why,
      d3,
      "why",
      "M26-1 shipped ERR.UNSUPPORTED_PROTOCOL_VERSION, which falsifies this present-tense claim.",
    )

    // Derived from source, not restated: the code the row said was absent.
    expect(readText("packages/calllint-mcp/src/server.ts")).toMatch(
      /UNSUPPORTED_PROTOCOL_VERSION:\s*-32022/,
    )
  })

  it("every delta owner that named a spent blocker is amended, and D6's re-measure is discharged", () => {
    const matrix = readJson<{ deltas: readonly Amendable[]; summary: Amendable }>(
      `${ARTIFACT_DIR}/protocol-delta-matrix.json`,
    )

    // `(blocked by F8)` is spent — F8 went PASS at M26-5. The summary already carries the
    // amendment that supersedes every such suffix; assert it, so deleting it reds.
    const spent = matrix.deltas
      .filter((r) => /blocked by F8/.test(String(r.owner)))
      .map((r) => String(r.id))
    expect(spent, "F8-blocked owners are expected to remain verbatim").toEqual(["D1", "D3", "D4"])

    // Superseded WITHOUT a replacement value: `summary.amendedByM26-1` names `allBlockedBy` in its
    // `supersedes` prose and carries no `allBlockedBy` key of its own. Asked via `resolveAmended`
    // this would answer `via: null` and hand back the stale top-level string — indistinguishable
    // from "never amended". So the claim asserted here is the one the artifact actually makes.
    expect(
      supersededBy(matrix.summary, "allBlockedBy"),
      "summary.allBlockedBy must be superseded — F8 is PASS as of M26-5",
    ).toMatch(AMENDMENT_KEY)
    expect(
      resolveAmended(matrix.summary, "allBlockedBy").via,
      "allBlockedBy is superseded in prose only; a replacement value would be a different claim",
    ).toBeNull()

    // D6's owner was an IOU written by the artifact itself: "re-measure at M26-1". That batch
    // merged, so the IOU is due. This assertion is what makes it impossible to leave due again.
    const d6 = matrix.deltas.find((r) => r.id === "D6") as Amendable
    expect(String(d6.owner)).toContain("re-measure at M26-1")
    const owner = resolveAmended(d6, "owner")
    expectResolvedViaAmendment(
      owner,
      d6,
      "owner",
      "D6's owner named a re-measure at M26-1; that batch has merged, so the IOU is due.",
    )
    expect(String(owner.value)).toContain("DISCHARGED")
    expect(String(owner.value)).toContain("DISCHARGED")
  })
})

describe("M26-3 — an artifact claim must not contradict the digest-locked bytes", () => {
  /**
   * The deprecation table, sliced from the locked snapshot with BOTH bounds asserted.
   *
   * ADR 0064 §6.2: an unguarded `indexOf`/`slice` pair silently measures the wrong region when a
   * delimiter is missing. These bytes are eol-pinned and digest-locked, so CRLF cannot reach them —
   * but the bound assertions cost nothing and the failure they produce names the missing heading
   * instead of quietly returning a widened slice.
   */
  function deprecatedRows(): readonly string[] {
    const text = readText(`${VENDOR_DIR}/deprecated.snapshot.md`)
    const start = text.indexOf("## Deprecated")
    const end = text.indexOf("## Removed")
    expect(start, "deprecated.snapshot.md must carry a `## Deprecated` heading").toBeGreaterThan(-1)
    expect(end, "deprecated.snapshot.md must carry a `## Removed` heading after `## Deprecated`").toBeGreaterThan(
      start,
    )
    return text
      .slice(start, end)
      .split("\n")
      .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/.test(line))
      .slice(1)
  }

  it("D6 must not state a single uniform removal date — F7's forwardObligation forbids it", () => {
    // This is the finding that justified the whole batch. `finality-status.json` recorded a uniform
    // "first revision on or after 2027-07-28", F7's own amendment declared that copy must NOT state
    // a single uniform removal date, and `mcp-spec-vendor.invariants.test.ts:180` gated it there.
    // D6 carried the identical over-statement and NOTHING read it.
    //
    // Measured from the locked bytes, never restated from the artifact: some rows carry the date and
    // some do not. Asserting the date on every row would encode the over-precise claim into this
    // gate and make it agree with the error it exists to prevent.
    const UNIFORM_DATE = "First revision released on or after 2027-07-28"
    const rows = deprecatedRows()
    const dated = rows.filter((r) => r.includes(UNIFORM_DATE))
    expect(dated.length).toBeGreaterThanOrEqual(1)
    expect(
      dated.length,
      "the removal clock is NOT uniform — asserting otherwise would gate the over-statement",
    ).toBeLessThan(rows.length)

    const matrix = readJson<{ deltas: readonly Amendable[] }>(
      `${ARTIFACT_DIR}/protocol-delta-matrix.json`,
    )
    const d6 = matrix.deltas.find((r) => r.id === "D6") as Amendable
    const change = resolveAmended(d6, "change")
    expectResolvedViaAmendment(
      change,
      d6,
      "change",
      `The locked bytes carry ${dated.length} dated rows out of ${rows.length}, so a single uniform date is contradicted by measurement.`,
    )
    // The amendment must name the non-uniform clocks, not merely soften the sentence — and the
    // clocks are DERIVED from the locked bytes here, never hardcoded. A literal `SEP-2596` would
    // have been satisfied by naming a SEP rather than a clock: negative control #153 reduced the
    // amendment to "all 6 rows … the clock IS uniform" and that assertion still printed only
    // `expected '6 features deprecated; Removed sectio…' to contain 'SEP-2596'` — a missing
    // substring, naming neither the uniform-date claim nor the 4-of-6 that refutes it.
    const clockOf = (row: string): string => {
      const cells = row.split("|").map((c) => c.trim()).filter((c) => c.length > 0)
      return cells[cells.length - 1] ?? ""
    }
    // Strip the URL parens so an amendment may elide a long link (`(…/pull/2577)`) and still pass;
    // the longest URL-free run is what identifies the clock.
    const clockFragment = (cell: string): string =>
      cell
        .split(/\(https:\/\/[^)]*\)/)
        .map((part) => part.trim())
        .sort((a, b) => b.length - a.length)[0] ?? ""

    const offClock = rows.filter((r) => !r.includes(UNIFORM_DATE))
    expect(offClock.length, "there must be off-clock rows, else this test is vacuous").toBe(
      rows.length - dated.length,
    )
    const claim = String(change.value)
    for (const row of offClock) {
      const fragment = clockFragment(clockOf(row))
      expect(fragment.length, `an off-clock row yielded no fragment: ${row}`).toBeGreaterThan(8)
      // The fragment must discriminate: if it also appeared in a dated row it would prove nothing.
      expect(
        dated.filter((d) => d.includes(fragment)).length,
        `fragment ${JSON.stringify(fragment)} also appears in a dated row, so it cannot witness a non-uniform clock`,
      ).toBe(0)
      expect(
        claim,
        `D6's resolved \`change\` must name the off-clock removal condition ${JSON.stringify(
          fragment,
        )}, derived from ${VENDOR_DIR}/deprecated.snapshot.md where ${dated.length} of ${rows.length} rows carry ${JSON.stringify(
          UNIFORM_DATE,
        )} and ${offClock.length} do not. The claim on record instead reads: ${JSON.stringify(claim)}`,
      ).toContain(fragment)
    }

    // And F7's obligation, which the amendment answers to, must still be recorded.
    const status = readText(`${ARTIFACT_DIR}/finality-status.json`)
    expect(status).toContain("must not state a single uniform removal date")
  })

  it("the two non-2027 clocks are exactly the ones the amendment cites", () => {
    const rows = deprecatedRows()
    const undated = rows.filter(
      (r) => !r.includes("First revision released on or after 2027-07-28"),
    )
    // Named rather than counted: a bare `length === 2` passes if upstream swaps which rows are
    // relative, which is the change most worth failing on.
    expect(undated.length).toBe(2)
    const text = undated.join("\n")

    // `Follows Sampling`, NOT `Follows Sampling (SEP-2577)`. The rendered page shows the latter;
    // the locked bytes carry a markdown LINK — `Follows Sampling ([SEP-2577](https://…/pull/2577))`.
    // The first draft of this gate asserted the rendered form and reded, which is the mis-transcription
    // class the M26-5 digest lock exists to catch, committed against the lock itself.
    //
    // Measured for discriminating power rather than assumed: `Follows Sampling` matches exactly 1 of
    // the 6 rows, while a bare `SEP-2577` matches 4 and would pass without distinguishing anything.
    expect(text).toContain("Follows Sampling")
    expect(text).toContain("Three months after SEP-2596 reaches Final")

    // The link form itself, asserted so a future re-vendor that flattens links to rendered text
    // reds here rather than quietly making the fragment above ambiguous.
    expect(text).toMatch(/Follows Sampling \(\[SEP-2577\]\(https:\/\/[^)]+\)\)/)
  })

  it("D2 stays n/a because no HTTP transport exists to be affected", () => {
    // The HTTP+SSE deprecation cites `/specification/2024-11-05/...` — the revision this server
    // actually advertises — so "not affected" is a claim worth deriving rather than assuming.
    // Derived: no transport-bearing construct exists anywhere in the package's source.
    const matrix = readJson<{ deltas: readonly Amendable[] }>(
      `${ARTIFACT_DIR}/protocol-delta-matrix.json`,
    )
    const d2 = matrix.deltas.find((r) => r.id === "D2") as Amendable
    expect(d2.affectsCallLint).toBe(false)

    const server = readText("packages/calllint-mcp/src/server.ts")
    const code = server
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n")
    // A source scan must read code, not prose ([[source-scan-must-read-code-not-prose]]): the
    // docblocks in this file discuss HTTP and would red an unfiltered scan.
    const found = ["createServer(", "http.", "https.", "express", "EventSource", ".listen("].filter(
      (needle) => code.includes(needle),
    )
    expect(found, "calllint-mcp is stdio-only; an HTTP construct would make D2 live").toEqual([])
  })
})

/**
 * M26-7. `M-OPEN-1` records that F5 and F6 "rest on unvendored pages" and prescribes vendoring two
 * more pages BEFORE any assertion can be written. Measured 2026-08-10: three of the four claims its
 * fix shape names are already in the digest-locked `schema.json`, and the fourth is provable as an
 * ABSENCE in the same file. So the expensive, authorization-requiring half was never the blocker.
 *
 * That fix shape had no reader either — the same defect M26-3 was written to fix one level up. The
 * `it()` at :311 even carries "F5/F6 still rest on unvendored pages" in its TITLE while its body
 * asserts only that eight gates read PASS. A title is prose.
 *
 * This block is the reader. It does NOT close M-OPEN-1: F5/F6 still carry a URL in
 * `evidence.source`, and changing that is a separate authorized edit. What it does is make the
 * refutation executable, so the next batch cannot re-derive it and cannot be misdirected by the
 * original fix shape.
 */
describe("M26-7 — M-OPEN-1's fix shape is refuted from the locked bytes it says are insufficient", () => {
  interface SchemaDefs {
    readonly $defs: Record<string, Record<string, unknown>>
  }

  const lockedSchema = (): SchemaDefs => readJson<SchemaDefs>(`${VENDOR_DIR}/schema.json`)

  /** Collapse upstream's mid-sentence wraps. They survive in BOTH vendored forms (ADR 0067 §4.4). */
  const norm = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ")

  it("the locked schema is parsed and non-degenerate before any absence is asserted", () => {
    // [[absence-makes-a-gate-skip-itself]]. Two of the assertions below are absences (zero task
    // defs, no `required` key). An absence measured against an empty or unparsed object passes
    // trivially, so the shape of the haystack is asserted FIRST and everything else depends on it.
    const defs = lockedSchema().$defs
    expect(defs, "the locked schema must carry a $defs object").toBeTypeOf("object")
    expect(
      Object.keys(defs).length,
      "155 defs as locked; a different count means the vendored bytes moved and every absence below must be re-measured",
    ).toBe(155)
  })

  it("F5 claim 1/3 — the per-request _meta version key is in the locked bytes, not on a page", () => {
    const meta = lockedSchema().$defs.RequestMetaObject as {
      readonly required?: readonly string[]
      readonly properties?: Record<string, unknown>
    }
    expect(meta, "$defs.RequestMetaObject must exist").toBeTypeOf("object")
    expect(
      [...(meta.required ?? [])].sort(),
      "both _meta keys are required at 2026-07-28 — this is F5's 'per-request version declaration', locked",
    ).toEqual([
      "io.modelcontextprotocol/clientCapabilities",
      "io.modelcontextprotocol/protocolVersion",
    ])
  })

  it("F5 claim 2/3 — the MCP-Protocol-Version header requirement is in the locked bytes", () => {
    // The claim M-OPEN-1 says needs the transport page vendored. It is a sentence inside the
    // version key's own description, and it carries the 400 consequence with it.
    const meta = lockedSchema().$defs.RequestMetaObject as {
      readonly properties: Record<string, { readonly description?: string }>
    }
    const desc = norm(meta.properties["io.modelcontextprotocol/protocolVersion"]?.description)
    expect(
      desc.includes("MUST match the `MCP-Protocol-Version` header"),
      `the header requirement must be derivable from the locked schema, not from an unvendored page. Observed description: ${desc.slice(0, 200)}`,
    ).toBe(true)
    expect(
      desc.includes("MUST return a `400 Bad Request`"),
      "and its consequence travels with it, which is what makes the claim normative rather than descriptive",
    ).toBe(true)
  })

  it("F5 claim 3/3 — UnsupportedProtocolVersionError pins -32022 under allOf, not properties", () => {
    // The trap this gate exists to hold still: the first probe of this def read
    // `properties.error.properties.code` and returned `undefined`, which reads exactly like
    // "upstream does not pin the code". The real path is `properties.error.allOf[1].properties`.
    // [[resolved-vs-raw-presentation-doc]] — suspect the probe before the source.
    const def = lockedSchema().$defs.UnsupportedProtocolVersionError as {
      readonly properties: {
        readonly error: { readonly allOf?: readonly Record<string, unknown>[] }
      }
    }
    expect(def, "$defs.UnsupportedProtocolVersionError must exist").toBeTypeOf("object")

    const allOf = def.properties.error.allOf ?? []
    expect(
      allOf.length,
      "the error member is composed with allOf; a gate indexing `properties` directly reads undefined and mistakes it for an absence",
    ).toBe(2)

    const constrained = allOf.find((branch) => "properties" in branch) as
      | { readonly properties: Record<string, { readonly const?: unknown }> }
      | undefined
    expect(constrained, "one allOf branch must carry the constrained properties").toBeTypeOf("object")
    expect(
      constrained?.properties.code?.const,
      "-32022 is pinned upstream — the same constant server.ts serves as ERR.UNSUPPORTED_PROTOCOL_VERSION",
    ).toBe(-32022)
  })

  it("F6 — tasks are absent from core entirely, which is stronger than the extension page's prose", () => {
    // F6's recorded observation is "tasks are an EXTENSION: a core-only implementation is conformant
    // without them". That is provable here as an absence, and an absence in the locked bytes is a
    // stronger form of the claim than a page saying so.
    const raw = readText(`${VENDOR_DIR}/schema.json`)
    const defs = lockedSchema().$defs

    const taskDefs = Object.keys(defs).filter((k) => /task/i.test(k))
    expect(taskDefs, "core defines NO task type — that absence is F6's evidence").toEqual([])
    expect(
      raw.includes("tasks/"),
      "and no task method namespace appears anywhere in the locked bytes",
    ).toBe(false)

    // The single case-insensitive hit is an EXAMPLE extension identifier. Pinned so that a future
    // re-vendor introducing real task semantics reds here instead of silently satisfying the
    // absence assertions above with a renamed def.
    const hits = [...raw.matchAll(/task/gi)]
    expect(
      hits.length,
      "exactly one `task` occurrence, and it is an example identifier inside ServerCapabilities.extensions",
    ).toBe(1)
    expect(
      norm((defs.ServerCapabilities as { properties: Record<string, { description?: string }> })
        .properties.extensions?.description),
      "the sole occurrence is an illustrative extension key, which is itself the proof tasks are opt-in",
    ).toContain('io.modelcontextprotocol/tasks')
  })

  it("what M-OPEN-1 genuinely still needs is AUTH, and only auth", () => {
    // The other half of an honest refutation: name what vendoring WOULD buy. F5's requirement line
    // reads "transport / auth / cache semantics". Cache is covered by CacheableResult; transport is
    // covered by the header sentence above; auth is not covered at all. A refutation that only
    // listed the wins would be as misleading as the fix shape it corrects.
    const raw = readText(`${VENDOR_DIR}/schema.json`)
    const defs = lockedSchema().$defs

    expect(
      defs.CacheableResult,
      "cache semantics ARE locked — $defs.CacheableResult carries cacheScope and the TTL hint",
    ).toBeTypeOf("object")

    const authDefs = Object.keys(defs).filter((k) => /auth|oauth/i.test(k))
    expect(
      authDefs,
      "no auth type is defined in core — this is the ONE part of F5 that a page vendoring would actually add",
    ).toEqual([])
    expect(
      [...raw.matchAll(/oauth/gi)].length,
      "the single oauth occurrence is an example extension identifier, not a definition",
    ).toBe(1)

    // And the reason the auth gap is not urgent, derived rather than assumed: no HTTP transport
    // exists to authenticate. Asserted in its own right at "D2 stays n/a" above; re-derived here so
    // this conclusion does not depend on reading that test's title.
    const code = readText("packages/calllint-mcp/src/server.ts")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n")
    expect(
      ["createServer(", ".listen(", "Authorization", "Bearer "].filter((n) => code.includes(n)),
      "stdio-only and unauthenticated by construction, so the auth gap bears on no claim CallLint makes today",
    ).toEqual([])
  })

  it("M-OPEN-1's original text and its M26-7 refutation both stay verbatim through the close", () => {
    // The row closes at M26-8, and closing it must not consume either earlier layer. The original
    // fix shape is what M26-7 refuted; M26-7's refutation is what M26-8 executed. A close that
    // rewrote either one would leave the closing note asserting a history nothing else records.
    const items = readText(`${ARTIFACT_DIR}/open-items.md`)
    const start = items.indexOf("## M-OPEN-1")
    const end = items.indexOf("## M-OPEN-2")
    expect(start, "open-items.md must carry an M-OPEN-1 heading").toBeGreaterThan(-1)
    expect(end, "and an M-OPEN-2 heading after it").toBeGreaterThan(start)
    const row = items.slice(start, end)

    expect(
      row.includes("**Status:** OPEN. Narrowed by M26-5, not closed."),
      "the ORIGINAL status line stays verbatim below the close — a deleted claim is indistinguishable from one never made",
    ).toBe(true)
    expect(
      row.includes("amended by M26-7"),
      "and the refutation is recorded as an APPEND (ADR 0061 §8.5.1), not by rewriting the fix shape",
    ).toBe(true)
    expect(
      row.includes("CLOSED 2026-08-10 (M26-8, ADR 0068)"),
      "M26-8 satisfied this row's own revised condition ('half 1 landing'), so the close is stated in the row",
    ).toBe(true)
  })

  /**
   * The assertion that replaced a guard which could not have observed its own subject.
   *
   * The version this supersedes counted `https://modelcontextprotocol.io` in F5/F6's **top-level**
   * `evidence.source` and required exactly 2, with the message *"when that changes, THIS assertion is
   * the one that must be edited by hand."* Measured at M26-8, that instruction was unfollowable as
   * written: append discipline **freezes** `evidence.source`, so the count is 2 both before and after
   * half 1 lands. The three states it can distinguish are
   *
   *   half 1 not done      -> top-level is a URL -> 2 -> PASS
   *   half 1 done          -> top-level is a URL -> 2 -> PASS   <- indistinguishable
   *   top level OVERWRITTEN -> < 2 -> RED
   *
   * i.e. it reds only on the action M-OPEN-2 **forbids** and is blind to the one M26-8 was authorized
   * to perform. The generalization worth keeping: on an append-only record, a guard bound to the
   * top-level field watches the wrong layer — it measures whether the history was destroyed, never
   * whether the claim advanced. [[assert-which-source-answered]] one level up from where that memory
   * puts it, since here BOTH layers must be asserted and for opposite reasons.
   */
  it("F5/F6 now resolve to the locked schema through an amendment, with the URLs retained", () => {
    const status = readJson<{ gates: readonly Amendable[] }>(`${ARTIFACT_DIR}/finality-status.json`)
    const rows = status.gates.filter((g) => g.id === "F5" || g.id === "F6")
    expect(rows.map((g) => String(g.id)), "both rows must be present before either is resolved").toEqual([
      "F5",
      "F6",
    ])

    for (const gate of rows) {
      const id = String(gate.id)

      // Layer 1 — the append record survives. This is what the superseded guard measured, kept
      // because it is a real requirement, just not the one the row's closure turns on.
      const top = String((gate.evidence as { source?: string } | undefined)?.source ?? "")
      expect(
        top,
        `${id}: the original URL must stay verbatim — overwriting it to "fix" the source destroys the append record (M-OPEN-2 forbids exactly this)`,
      ).toContain("https://modelcontextprotocol.io")

      // Layer 2 — the CURRENT source is the locked file, and it answered from an amendment. `via` is
      // asserted before the value: a value-only check passes if a future batch overwrites the top
      // level, which is the failure mode layer 1 exists to catch, and the two must not be able to
      // pass for each other's reasons.
      const resolved = resolveAmended(gate, "source")
      expectResolvedViaAmendment(
        resolved,
        gate,
        "source",
        `${id} rests on digest-locked bytes as of M26-8 (M-OPEN-1 half 1); a reader taking the top level concludes the evidence is still an unvendored page.`,
      )
      expect(
        String(resolved.value),
        `${id}: the current source must name the locked schema, not a page`,
      ).toContain(`${VENDOR_DIR}/schema.json`)
    }

    // And the digest the amendments cite is DERIVED, not trusted. An amendment naming a file is only
    // as good as the bytes it pins: without this, a re-vendor could change schema.json while both
    // rows kept citing the old digest, and every assertion above would still pass.
    const actual = createHash("sha256")
      .update(readFileSync(fileURLToPath(new URL(`${VENDOR_DIR}/schema.json`, repoRoot))))
      .digest("hex")
    // Set form over both rows rather than a loop with a fallback sentinel: a missing digest must
    // print AS a missing digest, and `cited?.[1] ?? <sentinel>` would quietly compare against the
    // sentinel instead — the same "an absence answered and looked like a value" shape this file
    // guards against everywhere else.
    const digests = rows.map((gate) => {
      const cited = /sha256 ([0-9a-f]{8,})/.exec(String(resolveAmended(gate, "source").value))
      return `${String(gate.id)}=${cited === null ? "NO-DIGEST-CITED" : cited[1]}`
    })
    expect(
      digests.filter((d) => d.endsWith("NO-DIGEST-CITED")),
      "each amendment must cite a sha256 prefix for the file it names, or the file reference pins nothing",
    ).toEqual([])
    expect(
      digests.filter((d) => !actual.startsWith(String(d.split("=")[1]))),
      `every cited digest must be a prefix of the file's ACTUAL sha256 ${actual}`,
    ).toEqual([])
  })

  /**
   * The end state the batch was authorized to produce, asserted as a property rather than a title.
   *
   * The test at :311 carries "F5/F6 still rest on unvendored pages" in its NAME while its body only
   * checks eight `PASS` — flagged at M26-7 as *"a title is prose."* Half 1 makes that title false,
   * and the honest repair is not to edit the string: it is to assert the thing the title was gesturing
   * at, in a form that can fail. So this enumerates, per gate, whether its CURRENT evidence source is
   * a committed file or a URL.
   *
   * Two gates legitimately resolve to neither a locked file nor a page, and both are named rather
   * than filtered: F8's evidence is `"this repository"` (its subject IS the vendoring), and F1/F2/F3
   * cite the versioning pages whose content is locked in `schema.ts`/`schema.json` under DIFFERENT
   * gates. Asserting "all eight name a file" would therefore be false; asserting the exact split is
   * what makes a regression visible.
   */
  it("the eight gates' current sources partition exactly as M26-8 leaves them", () => {
    const status = readJson<{ gates: readonly Amendable[] }>(`${ARTIFACT_DIR}/finality-status.json`)
    const gates = status.gates
    expect(gates.length, "eight finality gates").toBe(8)

    /**
     * The two shapes a gate's `source` can take, and why this cannot be one lookup.
     *
     * Measured when the first draft of this assertion reported `F1=FILE` for three gates that plainly
     * cite URLs. An UNAMENDED source lives one level down at `evidence.source`; an AMENDED one is
     * flat inside the amendment block (`amendedByM26-8.source`). `resolveAmended(gate, "source")`
     * finds the amended shape and, for the rest, falls back to `gate["source"]` — which does not
     * exist. `String(undefined)` is `"undefined"`, that does not match `/^https?:/`, and the gate was
     * silently CLASSIFIED as FILE.
     *
     * That is worse than a wrong answer: an absent field produced a *category*, so the three gates
     * that most need to read URL read FILE, and the end-state assertion would have certified
     * "everything rests on committed bytes" from three missing keys. Hence `MISSING` is its own
     * outcome here — a value that cannot be read must never fall into either real bucket.
     */
    const sourceOf = (g: Amendable): { value: string; via: string | null } => {
      const amended = resolveAmended(g, "source")
      if (amended.via !== null) return { value: String(amended.value), via: amended.via }
      const nested = (g.evidence as { source?: unknown } | undefined)?.source
      return { value: typeof nested === "string" ? nested : "", via: null }
    }

    const split = gates.map((g) => {
      const { value } = sourceOf(g)
      const kind = value === "" ? "MISSING" : /^https?:/.test(value) ? "URL" : "FILE"
      return `${String(g.id)}=${kind}`
    })
    // Printed as a set so a drift names the gate that moved, not just a count
    // ([[every-collapses-the-observed-value]]).
    expect(
      split,
      "F5/F6 moved from URL to FILE at M26-8; F1/F2/F3 still cite versioning pages (their CONTENT is locked under F1/F2/F3's own vendor gate), F8's subject is the repository itself. MISSING means a gate carries no readable source at all",
    ).toEqual([
      "F1=URL",
      "F2=URL",
      "F3=URL",
      "F4=FILE",
      "F5=FILE",
      "F6=FILE",
      "F7=URL",
      "F8=FILE",
    ])

    // The claim the user's end-state actually rests on: every gate has a TEST reading it, which is a
    // different property from its `source` naming a file. Derived from the two invariant files'
    // titles rather than asserted as a number, so adding a gate without a reader reds here.
    const titles = [
      readText("tests/invariants/mcp-spec-vendor.invariants.test.ts"),
      readText("tests/invariants/mcp-artifact-claims.invariants.test.ts"),
    ].join("\n")
    // `F2` is named MID-title (`it("F1/F2 — the revision string is upstream's own…`), so anchoring the
    // id to the start of the title misses it and reports a gate as unread when it is not. Measured,
    // not guessed at: the first draft anchored `it("${id}` and returned `["F2"]`. The id must be
    // matched wherever it appears in the title, bounded so `F1` cannot satisfy `F11` later.
    const unread = gates
      .map((g) => String(g.id))
      .filter((id) => !new RegExp(`it\\("[^"]*\\b${id}\\b`).test(titles) && id !== "F8")
    expect(
      unread,
      "every F-row except F8 must be named by at least one it() title; F8 is asserted by the whole vendor file existing (SOURCE.json digests), not by one test",
    ).toEqual([])
  })
})
