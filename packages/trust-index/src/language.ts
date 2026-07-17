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
 * affirmative two-word claims are.
 */
export const TRUST_PAGE_FORBIDDEN_PHRASES = [
  "certified safe",
  "verified safe",
  "calllint approved",
  "calllint-approved",
  "guaranteed safe",
] as const
