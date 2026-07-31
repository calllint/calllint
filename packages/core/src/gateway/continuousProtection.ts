/**
 * Continuous-protection conversion (ADR 0056 §7 / INV-2.4-07; new14 Batch 8) — the
 * ONE source of truth for the post-success Guard offer, shared verbatim by the CLI
 * orchestrator (`calllint safe-install`) and the MCP `calllint_enable_continuous_guard`
 * tool, so neither surface can invent its own component list or uninstall story.
 *
 * PURE + DETERMINISTIC: types + total functions over the shipped Guard host matrix.
 * No I/O, no clock, no network — the caller's edge supplies whether Guard is already
 * installed and whether an org policy pre-authorized the conversion.
 *
 * This module NEVER writes and NEVER enables anything. A one-time protected setup does
 * not imply permission to install a persistent component (INV-2.4-07), so the only
 * thing computed here is a *disclosure*: every persistent component enumerated with the
 * exact artifact it creates, the command that installs it, and the command that removes
 * it — plus a digest over that disclosure so a second, explicit human approval can name
 * the exact component set it reviewed. Enabling stays a separate operator action through
 * the shipped `calllint guard install` writer (INV-2.4-03: no second writer).
 */
import { hashJson } from "@calllint/fingerprint"

/** The wire tag — the contract is the tag, not the filename (ADR 0043/0055 §5). */
export const CONTINUOUS_PROTECTION_OFFER_SCHEMA = "calllint.continuous-protection-offer.v1" as const

/**
 * How the conversion should be surfaced. Never a silent enable:
 *   ASK_AFTER_SUCCESS    value first, commitment second — offer it, default to [Not now].
 *   AUTO_ENABLE_BY_POLICY an org policy already pre-authorized persistent protection.
 *   ALREADY_PROTECTED    Guard is installed for this host; do not re-offer (no nagging).
 */
export type ContinuousProtectionRecommendation =
  | "ASK_AFTER_SUCCESS"
  | "AUTO_ENABLE_BY_POLICY"
  | "ALREADY_PROTECTED"

/**
 * One persistent CallLint component. `uninstallCommand` is mandatory by type — a
 * component whose removal cannot be stated is a component that must not be offered.
 */
export interface PersistentComponent {
  /** Stable id used in `persistentComponents[]` of the result envelope. */
  readonly id: string
  readonly label: string
  /** Repo-relative artifact the component creates. */
  readonly artifactPath: string
  /** Whether CallLint owns the file outright, or it lives in a user-owned config. */
  readonly posture: "dedicated" | "shared"
  readonly installCommand: string
  readonly uninstallCommand: string
}

/**
 * The shipped Guard host matrix (`apps/cli/src/commands/guard.ts` GUARD_HOSTS, ADR
 * 0045/0052). Mirrored here as data — not re-implemented — because the CLI command
 * module is not importable from a package. A drift test pins this list against the
 * shipped one, so a new Guard host cannot silently go undisclosed.
 */
export const GUARD_HOST_IDS = [
  "git",
  "git-pre-push",
  "github",
  "copilot",
  "claude-code",
  "gemini",
  "vscode",
] as const
export type GuardHostId = (typeof GUARD_HOST_IDS)[number]

interface GuardArtifactFacts {
  readonly label: string
  readonly artifactPath: string
  readonly posture: "dedicated" | "shared"
}

/** Byte-for-byte the artifact facts the shipped `guard install` writer produces. */
const GUARD_ARTIFACTS: Readonly<Record<GuardHostId, GuardArtifactFacts>> = {
  git: { label: "git pre-commit hook", artifactPath: ".git/hooks/pre-commit", posture: "dedicated" },
  "git-pre-push": { label: "git pre-push hook", artifactPath: ".git/hooks/pre-push", posture: "dedicated" },
  github: { label: "GitHub Actions drift-gate workflow", artifactPath: ".github/workflows/calllint.yml", posture: "dedicated" },
  copilot: { label: "Copilot CLI sessionStart hook", artifactPath: ".github/hooks/calllint.json", posture: "dedicated" },
  "claude-code": { label: "Claude Code SessionStart hook", artifactPath: ".claude/settings.json", posture: "shared" },
  gemini: { label: "Gemini CLI SessionStart hook", artifactPath: ".gemini/settings.json", posture: "shared" },
  vscode: { label: "VS Code folderOpen guard task", artifactPath: ".vscode/tasks.json", posture: "shared" },
}

export function isGuardHostId(v: string | null | undefined): v is GuardHostId {
  return v !== null && v !== undefined && (GUARD_HOST_IDS as readonly string[]).includes(v)
}

/**
 * Disclose one persistent component. A `shared`-posture host is disclosed honestly:
 * `guard install` prints a fragment to merge and refuses to clobber a user-owned file,
 * so its removal is a hand edit, not a CallLint command (INV-2.4-08 — never claim an
 * automated removal that does not exist).
 */
export function persistentComponentFor(host: GuardHostId): PersistentComponent {
  const a = GUARD_ARTIFACTS[host]
  return {
    id: `calllint-guard:${host}`,
    label: a.label,
    artifactPath: a.artifactPath,
    posture: a.posture,
    installCommand: `calllint guard install --host ${host}`,
    uninstallCommand:
      a.posture === "dedicated"
        ? `rm ${a.artifactPath}`
        : `remove the CallLint guard entry from ${a.artifactPath} by hand`,
  }
}

/** The offer disclosure. `components` is exhaustive for the hosts in scope. */
export interface ContinuousProtectionOffer {
  readonly schema: typeof CONTINUOUS_PROTECTION_OFFER_SCHEMA
  readonly recommendation: ContinuousProtectionRecommendation
  /** Machine-stable reason for the recommendation; never marketing prose. */
  readonly reason: string
  /** Always true: a one-time setup never authorizes persistent protection (INV-2.4-07). */
  readonly requiresSeparateAuthorization: true
  readonly components: readonly PersistentComponent[]
  /** What Guard does once enabled — capability facts, not claims about the target. */
  readonly capabilities: readonly string[]
  /** Digest over the disclosed component set; a second approval names this exact value. */
  readonly disclosureDigest: string
  /** The literal decline affordance — `[Not now]` must always be available. */
  readonly declineOption: "Not now"
  /** How to turn it off after enabling, without removing files. */
  readonly disableCommand: string
  /**
   * The wording this offer renders with — TOTAL, resolved at offer time (PR P-5).
   *
   * On the offer rather than a second render parameter, so the render stays a pure
   * function of one value and Gate 2.4-F observes exactly the strings a human sees. It is
   * deliberately NOT part of `disclosureDigest`: the approval token names the component
   * set, so configured copy provably cannot move a digest a human already reviewed.
   */
  readonly copy: GuardOfferCopy
}

/**
 * What Guard does once enabled. Facts about CallLint's own re-decision loop only — it
 * re-decides the approved authority surface and is silent when nothing changed. It
 * never executes, starts or connects to a scanned server (INV-2.4-09 / ADR 0003).
 */
const GUARD_CAPABILITIES: readonly string[] = [
  "re-decide the approved agent-tool authority surface when a session starts",
  "detect authority drift against the approved baseline",
  "re-check upgrades of already-approved tools",
  "refuse a tampered install plan (approval is bound to the exact plan digest)",
]

/**
 * The three CONFIGURABLE strings in the Guard offer (new15 §6.2 PR P-5; ADR 0058 §1 L1).
 *
 * Authored here, beside the render that consumes them, so ONE module owns both the
 * default wording and the template it must reproduce. The presentation resolver imports
 * these rather than restating them, which is what makes "the catalog restates the shipped
 * defaults" a checkable claim instead of two lists that happen to agree.
 *
 * WHAT IS DELIBERATELY ABSENT, and why each absence is load-bearing:
 *
 *   • `declineLabel`. The schema declares it; this type does not. `declineOption` is typed
 *     as the literal `"Not now"` and Gate 2.4-F compares it as a literal, so letting
 *     configuration reach it would let a legal config edit fail a security gate — or force
 *     the gate to grade the configured value, i.e. configuration weakening its own floor
 *     (INV-2.4-07). The render derives the token from the literal-typed field instead, so
 *     `[Not now]` is STRUCTURAL rather than a string a document could forget.
 *
 *   • The disclosure block. `offerBody` is the capabilities LEAD-IN only. The
 *     separate-decision sentence, the per-component creates/remove/enable lines,
 *     `disable later:`, `disclosure:` and the two closing "nothing persistent was
 *     installed" lines are disclosure, not copy — INV-2.4-07 depends on that framing
 *     staying visible, so configuration must not be able to remove it.
 *
 *   • Per-host labels. `GUARD_ARTIFACTS[host].label` stays sole owner of the seven
 *     per-host strings: `$defs.guardConversion` is closed at four properties, so a
 *     per-host slot is a schema change and belongs to a PR licensed to make one.
 */
export interface GuardOfferCopy {
  /** The offer's heading line. */
  readonly offerHeadline: string
  /** The lead-in above the capability bullets. Rendered indented; author it unindented. */
  readonly offerBody: string
  /** The affirmative affordance, rendered inside `[...]`. */
  readonly acceptLabel: string
}

/** The shipped wording. Byte-for-byte what `renderContinuousProtectionOffer` emitted before P-5. */
export const DEFAULT_GUARD_OFFER_COPY: GuardOfferCopy = Object.freeze({
  offerHeadline: "Protect future agent-tool changes",
  offerBody: "CallLint can:",
  acceptLabel: "Enable continuous protection",
})

/**
 * Fill a partial copy record to a total one, per slot.
 *
 * Per-slot rather than all-or-nothing for the same reason the presentation resolver is
 * (ADR 0058 §5 INV-P3): supplying two of three slots must not blank the third. The check
 * is deliberately thin — a non-empty string, nothing more — because the reviewable rules
 * on what a configured string may SAY (length, markup, banned phrases) live in the
 * content plane's validator and resolver. This is the structural floor beneath them, so
 * the offer type can be total even when an edge hands over junk.
 */
export function resolveGuardOfferCopy(partial?: Partial<GuardOfferCopy>): GuardOfferCopy {
  if (partial === undefined) return DEFAULT_GUARD_OFFER_COPY
  const pick = (k: keyof GuardOfferCopy): string => {
    const v = partial[k]
    return typeof v === "string" && v.trim() !== "" ? v : DEFAULT_GUARD_OFFER_COPY[k]
  }
  return {
    offerHeadline: pick("offerHeadline"),
    offerBody: pick("offerBody"),
    acceptLabel: pick("acceptLabel"),
  }
}

export interface ContinuousProtectionInput {
  /** Hosts to disclose. Unknown ids are rejected by the caller, never guessed. */
  readonly hosts: readonly GuardHostId[]
  /** Guard already installed for these hosts (edge-supplied; no disk read here). */
  readonly alreadyInstalled?: boolean
  /** An org policy pre-authorized persistent protection (edge-supplied). */
  readonly preAuthorizedByPolicy?: boolean
  /**
   * Configured offer wording (edge-supplied, PR P-5). OPTIONAL and per-slot, so every
   * existing call site keeps compiling and renders exactly what it rendered before.
   * Only the bake/gate edge reads a config document; an installed binary never does.
   */
  readonly copy?: Partial<GuardOfferCopy>
}

/**
 * Compute the post-success offer. Deterministic in its input; the recommendation can
 * only ever *ask* or record an existing authorization — it can never itself authorize.
 */
export function continuousProtectionOffer(
  input: ContinuousProtectionInput,
): ContinuousProtectionOffer {
  const components = input.hosts.map(persistentComponentFor)
  const recommendation: ContinuousProtectionRecommendation = input.alreadyInstalled
    ? "ALREADY_PROTECTED"
    : input.preAuthorizedByPolicy
      ? "AUTO_ENABLE_BY_POLICY"
      : "ASK_AFTER_SUCCESS"
  const reason = input.alreadyInstalled
    ? "guard_already_installed_for_host"
    : input.preAuthorizedByPolicy
      ? "org_policy_pre_authorized_persistent_protection"
      : "future_tool_changes_not_currently_guarded"
  return {
    schema: CONTINUOUS_PROTECTION_OFFER_SCHEMA,
    recommendation,
    reason,
    requiresSeparateAuthorization: true,
    components,
    capabilities: GUARD_CAPABILITIES,
    disclosureDigest: disclosureDigest(components),
    declineOption: "Not now",
    disableCommand: "calllint guard disable",
    copy: resolveGuardOfferCopy(input.copy),
  }
}

/**
 * Digest over the disclosed component set — the token a second explicit approval names.
 * Bound to the components ONLY (not the recommendation or the reason), so the digest a
 * human reviewed stays valid regardless of how the offer was surfaced, and changes the
 * moment the component set does.
 */
export function disclosureDigest(components: readonly PersistentComponent[]): string {
  return hashJson({
    schema: CONTINUOUS_PROTECTION_OFFER_SCHEMA,
    components: components.map((c) => ({
      id: c.id,
      artifactPath: c.artifactPath,
      posture: c.posture,
      installCommand: c.installCommand,
      uninstallCommand: c.uninstallCommand,
    })),
  })
}

/**
 * The human offer block — the ONE rendering, so the CLI transcript and any agent-facing
 * summary disclose the same facts. Deliberately shaped so the dark-pattern red line is
 * structurally visible: nothing is pre-selected, `[Not now]` is always printed, and every
 * component appears with its uninstall command BEFORE the enable command (INV-2.4-07).
 */
export function renderContinuousProtectionOffer(offer: ContinuousProtectionOffer): string {
  if (offer.recommendation === "ALREADY_PROTECTED") {
    return [
      "Continuous protection: already enabled for this host.",
      `  disable: ${offer.disableCommand}`,
    ].join("\n")
  }
  const lines = [
    "",
    offer.copy.offerHeadline,
    "",
    `  ${offer.copy.offerBody}`,
    ...offer.capabilities.map((c) => `    • ${c}`),
    "",
    // NOT configurable: the separate-decision framing is what INV-2.4-07 rests on, so a
    // config document must not be able to soften or drop it.
    "  This installs persistent components (a separate decision from the install above):",
  ]
  for (const c of offer.components) {
    // The human-readable label leads; the stable id follows in parentheses. Showing
    // only the id would make the person consenting decode `calllint-guard:vscode`
    // to work out what they are agreeing to.
    lines.push(`    ${c.label} (${c.id})`)
    lines.push(`      creates:   ${c.artifactPath}${c.posture === "shared" ? " (merged into your own config)" : ""}`)
    lines.push(`      remove:    ${c.uninstallCommand}`)
    lines.push(`      enable:    ${c.installCommand}`)
  }
  lines.push("")
  // Both exits must be visible BEFORE the decision: `disable` stops the behaviour
  // without touching files, `remove` (above, per component) takes the files back
  // out. Disclosing only removal makes turning it off look harder than it is.
  lines.push(`  disable later: ${offer.disableCommand}`)
  lines.push(`  disclosure: ${offer.disclosureDigest}`)
  // The decline token is DERIVED from `offer.declineOption`, whose type is the literal
  // `"Not now"`. Interpolating it rather than typing it again is what makes `[Not now]`
  // structurally unmissable: no configured string, and no future edit to this template,
  // can print the affirmative affordance without printing the decline one beside it.
  const accept = `[${offer.copy.acceptLabel}]`
  const decline = `[${offer.declineOption}]`
  lines.push(
    offer.recommendation === "AUTO_ENABLE_BY_POLICY"
      ? `  ${accept}  (pre-authorized by org policy)   ${decline}`
      : `  ${accept}   ${decline}`,
  )
  lines.push("")
  lines.push("  Nothing persistent was installed by the step above, and nothing is")
  lines.push("  installed by this offer. Run the enable command yourself to opt in.")
  return lines.join("\n")
}
