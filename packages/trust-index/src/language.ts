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
