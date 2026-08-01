// ---------------------------------------------------------------------------
// Workstream P PR P-5/P-6 — the AGENT RELAY copy slice (new15 §20.2 `AgentRelayCopy`;
// ADR 0058 §1 L1 / §6). PURE: types, frozen defaults, and one pure composer. No I/O.
//
// WHY THIS IS A SEPARATE FILE, AND WHY IT IS DELIBERATELY THIN.
//
// new15 §5 draws one line and draws it hard: `AgentProtocolPolicy` — the goal, the steps,
// what an agent must ask before, what it must stop on, what it may never shortcut — is
// CODE, governed by schema and ADR, and `RESERVED_KEYS` rejects every one of those names
// at any depth in a content document. `AgentRelayCopy` is the other side: wording an agent
// ECHOES. Keeping the two in separate modules is what makes "不能混在一个 JSON 里" a
// structural fact rather than a naming convention — there is no file here that could grow
// a protocol key without a reviewer noticing which module it landed in.
//
// ADR 0058 §6's floor applies to every slot below: relay copy may never add or remove a
// protocol TRIGGER. A slot may change how a fact is worded; it may never change whether an
// agent stops, asks, or proceeds. Nothing in this file is read by a decision path — every
// slot lands in a `notes[]` array beside an outcome that was already decided.
//
// ALL SIX SLOTS ARE WIRED as of P-6. `guardOffer` has templated the MCP guard tool's
// sentence since P-5; the five decision-relay slots now compose into the MCP
// `prepare_safe_install` result's `notes[]` through `composeRelayNotes` below. The composer
// is FACT-GATED, which is the whole reason the surface is honest: each sentence pairs relay
// wording with a machine fact read off the sealed contract, and a sentence whose fact is
// absent is NOT EMITTED. The relay surface is therefore a projection of the contract — it
// cannot state a fact the contract does not carry, the same discipline the CLI's
// `approvalPreview` follows ("cannot describe a write the plan does not contain").
//
// THE 6-VS-4 RECONCILIATION (new15 §5 names four relay slots; the schema declares six).
// The gap is a SUPERSET, not a mismatch, and the extras are not invented copy — each names
// a field the sealed contract already carries:
//   • `adds`        → `authorityDelta.adds` (measured non-empty on 17 of 19 served identities)
//   • `notObserved` → `authorityDelta.notObserved`, itself gated on
//                     `publicObservation.completeness === "complete"` by the contract builder
// So §5's four are the MINIMUM, and the rule that keeps the superset honest is enforced
// rather than asserted: EVERY relay slot must name a contract field or a plan fact as its
// basis, and a slot whose basis is absent must not be emitted. A seventh slot with no basis
// fails that check. Nothing is deleted and no `$defs` block moves.
//
// CONFIGURABILITY LIMIT, RECORDED RATHER THAN IMPLIED. Configuration reaches these
// sentences at BUILD TIME ONLY — `apps/cli` and `packages/calllint-mcp` both declare empty
// runtime dependencies (esbuild inlines their sources) and the content catalog ships in no
// `files` list, so editing the catalog cannot change an already-installed binary. That is
// the identical limit `guardOffer` has carried since P-5. What the catalog CAN do is be
// measured: the presentation lock proves the committed document restates these defaults
// verbatim, so a reworded catalog turns the lock red instead of silently disagreeing with
// the shipped binary.
// ---------------------------------------------------------------------------

/**
 * The six relay slots the schema declares (`$defs.agentRelayCopy`).
 *
 * Total by type so `ResolvedPresentation.agentRelay` can be handed to a consumer whole,
 * the same guarantee every other resolved slice carries: a caller never checks for a
 * missing slot, because a missing slot resolves to its shipped default.
 */
export interface AgentRelayCopy {
  /**
   * Decision-relay: the summary line an agent leads with.
   * BASIS: `publicObservation.verdict` + `publicLabel`. Always present once a contract
   * resolved, so this sentence is unconditional.
   */
  readonly headline: string
  /**
   * Decision-relay: why the verdict came out as it did.
   * BASIS: `publicObservation.reasonCodes` + `evidenceLevel` — the reason codes are named
   * from the contract, never paraphrased into new claims.
   */
  readonly reason: string
  /**
   * Decision-relay: what the install would add.
   * BASIS: `authorityDelta.adds`. Emitted ONLY when that array is non-empty — an "adds"
   * sentence with nothing to add would be decoration, not a projection.
   */
  readonly adds: string
  /**
   * Decision-relay: what was NOT observed — absence framing.
   * BASIS: `authorityDelta.notObserved`, gated on
   * `publicObservation.completeness === "complete"` exactly as the contract builder gates
   * it. When the inventory is partial, silence is a GAP, not evidence of absence, so the
   * sentence must not appear (§4.1: never over-trust silence).
   */
  readonly notObserved: string
  /**
   * Decision-relay: the question put to the operator.
   * BASIS: a computed `planDigest`. Without one there is no exact plan to approve, so the
   * question would invite approval of something unnamed.
   */
  readonly approvalQuestion: string
  /**
   * WIRED. The sentence the MCP `calllint_enable_continuous_guard` tool pushes into its
   * `notes[]` — see `packages/calllint-mcp/src/tools.ts`. It states that the tool
   * installed nothing and that enabling is a separate operator action from a terminal.
   *
   * Configurable WORDING, not configurable MEANING: the tool's `enabled: false` and
   * `requiresSeparateAuthorization: true` fields are typed and set in code, so a
   * configured string can restate this fact differently but cannot make it untrue, and
   * cannot cause the tool to install anything (ADR 0058 §6).
   */
  readonly guardOffer: string
}

/**
 * The shipped wording. `guardOffer` is byte-for-byte the literal the MCP guard tool
 * emitted before P-5 — the tool now composes from here, so the two cannot drift apart.
 *
 * The five decision-relay defaults are the wording `composeRelayNotes` prefixes each
 * machine fact with. They shipped at P-5 before a consumer existed — unchanged here, so
 * wiring them adds a consumer without moving a single byte of copy.
 */
export const DEFAULT_AGENT_RELAY_COPY: AgentRelayCopy = Object.freeze({
  headline: "CallLint decided this agent-tool install before anything ran",
  reason: "the verdict follows from observed authority, not from reputation",
  adds: "this install adds the authority surface listed in the contract",
  notObserved: "absence of evidence is recorded as absence, never as safety",
  approvalQuestion: "approve this exact plan, or stop and review the evidence?",
  guardOffer:
    "this tool installed nothing: enabling persistent protection is a separate operator action, run from a terminal",
})

/**
 * Relay slots with a real consumer today — all six as of P-6.
 *
 * Named here, beside the type, so the resolver's `WIRED_SLOTS` table reuses this rather
 * than restating a literal — the same reason `WIRED_SECTION_TITLES` lives beside the
 * section titles. A slot moves into this array in the PR that gives it a consumer, and
 * the resolver's totality test is what forces the two to move together: wiring a slot here
 * without deleting its `CODE_OWNED_SLOTS` entry puts it in both tables, which fails by name.
 */
export const WIRED_AGENT_RELAY: readonly (keyof AgentRelayCopy)[] = [
  "headline",
  "reason",
  "adds",
  "notObserved",
  "approvalQuestion",
  "guardOffer",
]

/** Every slot the schema declares, in schema order — the classification domain. */
export const AGENT_RELAY_SLOTS: readonly (keyof AgentRelayCopy)[] = [
  "headline",
  "reason",
  "adds",
  "notObserved",
  "approvalQuestion",
  "guardOffer",
]

/**
 * The machine facts a relay sentence may be built on — the BASIS set of decision 7.
 *
 * Every field is read off the sealed contract or the computed plan by the caller; nothing
 * here is composed, inferred, or defaulted. A field that is absent stays absent: `null` and
 * `[]` are real answers, and the composer treats them as "no basis" rather than filling in.
 */
export interface RelayFacts {
  /** `publicObservation.verdict` — the shipped CLI verdict token. */
  readonly verdict: string | null
  /** `publicObservation.publicLabel` — the shipped public wording for that verdict. */
  readonly publicLabel: string | null
  /** `publicObservation.reasonCodes` — sealed reason codes, in contract order. */
  readonly reasonCodes: readonly string[]
  /** `publicObservation.evidenceLevel`. */
  readonly evidenceLevel: string | null
  /** `publicObservation.completeness` — gates the `notObserved` sentence. */
  readonly completeness: "complete" | "partial" | null
  /** `authorityDelta.adds[].authority` — gates the `adds` sentence. */
  readonly adds: readonly string[]
  /** `authorityDelta.notObserved` — the high-authority complement. */
  readonly notObserved: readonly string[]
  /** The computed plan digest — gates the `approvalQuestion` sentence. */
  readonly planDigest: string | null
}

/** How many authorities a relay sentence names before it summarises the remainder. */
const RELAY_NAMED_LIMIT = 3

/** Name a bounded list of tokens, summarising any remainder rather than truncating silently. */
function nameSome(tokens: readonly string[]): string {
  const named = tokens.slice(0, RELAY_NAMED_LIMIT).join(", ")
  const rest = tokens.length - RELAY_NAMED_LIMIT
  return rest > 0 ? `${named} (+${rest} more)` : named
}

/**
 * Compose the decision-relay `notes[]` sentences from resolved copy + sealed facts.
 *
 * PURE, and deliberately gated. Each sentence is relay WORDING followed by the machine FACT
 * it relays, so a reader can always see what the sentence is a projection of; a sentence
 * whose fact is absent is not emitted at all. That is what makes the surface unable to
 * overstate the contract:
 *
 *   • headline         — always (a resolved contract always has a verdict)
 *   • reason           — always (reason codes may be empty; the evidence level is not)
 *   • adds             — iff `facts.adds` is non-empty
 *   • notObserved      — iff `completeness === "complete"` AND `notObserved` is non-empty
 *   • approvalQuestion — iff a `planDigest` exists
 *
 * `guardOffer` is NOT composed here: it belongs to a different tool's outcome and is pushed
 * by that tool directly, which is why it was already wired at P-5.
 *
 * Nothing in this function can move a verdict, a next action, or a protocol trigger — it
 * receives already-decided facts and returns strings (ADR 0058 §6).
 */
export function composeRelayNotes(
  copy: AgentRelayCopy,
  facts: RelayFacts,
): readonly string[] {
  const notes: string[] = []

  if (facts.verdict) {
    const label = facts.publicLabel ? ` (${facts.publicLabel})` : ""
    notes.push(`${copy.headline}: ${facts.verdict}${label}`)
  }

  if (facts.evidenceLevel || facts.reasonCodes.length > 0) {
    const codes =
      facts.reasonCodes.length > 0
        ? `reason codes ${nameSome(facts.reasonCodes)}`
        : "no blocking reason codes"
    const evidence = facts.evidenceLevel ? `, evidence ${facts.evidenceLevel}` : ""
    notes.push(`${copy.reason}: ${codes}${evidence}`)
  }

  if (facts.adds.length > 0) {
    notes.push(`${copy.adds}: ${nameSome(facts.adds)}`)
  }

  // The completeness gate is the contract builder's own gate, restated. When the authority
  // inventory is partial the contract leaves `notObserved` empty for exactly this reason,
  // so the sentence would have nothing to relay AND would read as reassurance.
  if (facts.completeness === "complete" && facts.notObserved.length > 0) {
    notes.push(`${copy.notObserved}: not observed — ${nameSome(facts.notObserved)}`)
  }

  if (facts.planDigest) {
    notes.push(`${copy.approvalQuestion} (plan ${facts.planDigest.slice(0, 23)}…)`)
  }

  return notes
}
