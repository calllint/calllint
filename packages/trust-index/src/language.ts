/**
 * The public Trust Page language boundary (ADR 0038 §2 — non-negotiable).
 *
 * A Trust Page states a verdict "observed at digest D at time T" under a stated
 * completeness. It must NEVER assert that a server is certified, verified,
 * approved, or guaranteed safe — CallLint reports observations, not endorsements.
 *
 * This is the single source of truth for the forbidden set. It is enforced in two
 * places that must never drift:
 *   • the reproducibility test asserts no rendered page contains any of these;
 *   • `scripts/check-public-copy.mjs` (a plain .mjs guard that cannot import TS)
 *     reads a mirror of this list from `project-facts.json` and scans the committed
 *     served pages — a repo-level test binds the mirror to this constant.
 *
 * These are the AFFIRMATIVE overclaims, matched case-insensitively. A disclaimer
 * that *denies* a guarantee ("not a certification … or a guarantee of safety") is
 * correct, required copy — so the word "guarantee" is not blanket-banned; only the
 * affirmative two-word claims are. Note "certified" is banned but is NOT a substring
 * of "certification" (certifi-ED vs certifi-CATION), so the required disclaimer that
 * DENIES a certification is unaffected.
 *
 * The claim-surface additions (ADR 0048 §6): a maintainer claim asserts NAMESPACE
 * CONTROL, never safety. "certified" and "trusted publisher" would blur control into
 * a safety endorsement, so they are forbidden on any page (including a claimed one);
 * the allowed copy is "Verified Publisher — controls github.com/{org}".
 */
export const TRUST_PAGE_FORBIDDEN_PHRASES = [
  "certified safe",
  "verified safe",
  "calllint approved",
  "calllint-approved",
  "guaranteed safe",
  "certified",
  "trusted publisher",
] as const

/**
 * The Safe-install acquisition-surface forbidden set (Phase 2.4; ADR 0056 §2.5 /
 * new14-integration §2.5). The Install page/contract is an ACQUISITION surface — one
 * sentence from becoming a second verdict ("Safe to install", "CallLint approved") or a
 * dark-pattern install trap (INV-2.4-07). This extends, never replaces, the Trust-Page
 * set: an Install surface must pass BOTH lists.
 *
 * Two failure modes are banned here:
 *   • overclaim — copy that reads as a verdict/endorsement CallLint never earned
 *     ("safe to install", "no risk", "one-click install with no review", "automatically
 *     protected forever");
 *   • coercion / manipulative fear copy — the dark-pattern language INV-2.4-07 forbids
 *     ("continue dangerously", "hackers may steal", "protect forever"). Loss-framing is
 *     limited to true, neutral facts, so these affirmative manipulations are forbidden.
 *
 * Matched case-insensitively, exactly like the Trust-Page set. "Safe-install" as an
 * internal route/feature-family name is NOT here — only the visible overclaim/coercion
 * phrases are (integration §2.5). The visible decision language stays the four shipped
 * verdict labels plus the two honest states (No supported install plan · Run local
 * pre-flight).
 */
export const SAFE_INSTALL_FORBIDDEN_PHRASES = [
  "safe to install",
  "certified safe",
  "verified safe",
  "calllint approved",
  "calllint-approved",
  "guaranteed secure",
  "automatically protected forever",
  "protected forever",
  "no risk",
  "one-click install with no review",
  "continue dangerously",
  "hackers may steal",
] as const
