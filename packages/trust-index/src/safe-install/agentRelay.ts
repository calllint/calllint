// ---------------------------------------------------------------------------
// Workstream P PR P-5 — the AGENT RELAY copy slice (new15 §20.2 `AgentRelayCopy`;
// ADR 0058 §1 L1 / §6). PURE data: types + frozen defaults, no I/O, no consumer here.
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
// agent stops, asks, or proceeds. Nothing in this file is read by a decision path — the one
// wired slot lands in a `notes[]` array beside an outcome that was already decided.
//
// ONE SLOT OF SIX IS WIRED, and that ratio is the honest state, not an oversight.
// `guardOffer` templates a sentence the MCP guard tool already emits, so it has a real
// consumer today. The five decision-relay slots (`headline`, `reason`, `adds`,
// `notObserved`, `approvalQuestion`) template a surface NO code produces yet: a repo-wide
// search for those names outside this file, the schema, and their tests finds nothing. So
// they are declared here with their shipped wording and classified code-owned in
// `CODE_OWNED_SLOTS`, which means a document that configures one gets a NAMED lock failure
// instead of silent acceptance. P-6's preview harness is where they get a consumer.
//
// The schema declares SIX slots against new15 §5's four. That gap is RECORDED, not
// reconciled — reconciling it means moving a schema file, which this batch does not do.
// ---------------------------------------------------------------------------

/**
 * The six relay slots the schema declares (`$defs.agentRelayCopy`).
 *
 * Total by type so `ResolvedPresentation.agentRelay` can be handed to a consumer whole,
 * the same guarantee every other resolved slice carries: a caller never checks for a
 * missing slot, because a missing slot resolves to its shipped default.
 */
export interface AgentRelayCopy {
  /** Decision-relay: the summary line an agent leads with. NO CONSUMER YET (P-6). */
  readonly headline: string
  /** Decision-relay: why the verdict came out as it did. NO CONSUMER YET (P-6). */
  readonly reason: string
  /** Decision-relay: what the install would add. NO CONSUMER YET (P-6). */
  readonly adds: string
  /** Decision-relay: what was NOT observed — absence framing. NO CONSUMER YET (P-6). */
  readonly notObserved: string
  /** Decision-relay: the question put to the operator. NO CONSUMER YET (P-6). */
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
 * The five decision-relay defaults are the wording those slots WOULD carry once a
 * consumer exists. They are shipped now rather than left blank because a default is what
 * makes the slot fail open (INV-P3), and because a reviewer comparing the catalog to the
 * code needs something concrete to compare against.
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
 * Relay slots with a real consumer today.
 *
 * Named here, beside the type, so the resolver's `WIRED_SLOTS` table reuses this rather
 * than restating a literal — the same reason `WIRED_SECTION_TITLES` lives beside the
 * section titles. A slot moves into this array in the PR that gives it a consumer, and
 * the resolver's totality test is what forces the two to move together.
 */
export const WIRED_AGENT_RELAY: readonly (keyof AgentRelayCopy)[] = ["guardOffer"]

/** Every slot the schema declares, in schema order — the classification domain. */
export const AGENT_RELAY_SLOTS: readonly (keyof AgentRelayCopy)[] = [
  "headline",
  "reason",
  "adds",
  "notObserved",
  "approvalQuestion",
  "guardOffer",
]
