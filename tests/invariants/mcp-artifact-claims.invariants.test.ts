import { describe, expect, it } from "vitest"
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
 */
function expectResolvedViaAmendment(
  resolved: { value: unknown; via: string | null },
  obj: Amendable,
  field: string,
  why: string,
): void {
  expect(
    resolved.via,
    `${field}: no amendment block supplies it, so the STALE top-level value ${JSON.stringify(
      resolved.value,
    )} would be read as current. ${why} Amendment keys present: ${JSON.stringify(
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
    expect(
      servedAt.via,
      "with two amendments supplying `servedAt`, the NEWEST must win — the older one points at a docblock line",
    ).toBe("amendedByM26-4")
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
    expect(keys.length, "currentState is the object that carries two amendments — if it stops, this test is vacuous").toBeGreaterThan(1)
    expect(keys).toEqual(["amendedByM26-4", "amendedByM26-3"])

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
