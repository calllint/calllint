/**
 * The artifact states R-5 will compile evidence FROM.
 *
 * A WHITELIST, and that is the whole design decision. `ArtifactStatus` (`subject.ts:114`) has FIVE
 * members: `RESOLVED` / `FETCHED` / `UNAVAILABLE` / `UNSUPPORTED` / `REJECTED`. Two of them mean
 * "we hold no bytes" for different reasons — `UNAVAILABLE` is tried-and-failed
 * (`tarInspect.ts:62`: "never to `UNAVAILABLE`, which means we could not obtain bytes at all") and
 * `UNSUPPORTED` is never-attempted, a package type R-3 does not understand. Compiling an
 * observation from either would attribute findings to bytes that were never in hand, which is the
 * Observed/Inferred fusion ADR 0061 exists to prevent.
 *
 * A blacklist is what makes that reachable. "Not RESOLVED, not REJECTED" reads as complete and
 * leaves TWO gaps, and the count is why the list is written positively: authoring this file I first
 * read three states off the transition table, then four, and the real number is five — a blacklist
 * would have been wrong both times, silently, in the admitting direction.
 *
 * So the enumeration is positive: `FETCHED` alone. Every other state — including any state added
 * later — is refused by default rather than admitted by omission. Controls #57 / #58 / #59 / #66
 * present `RESOLVED`, `REJECTED`, `UNAVAILABLE` and `UNSUPPORTED`; the last two are the ones a
 * blacklist would let through.
 *
 * Deliberately shaped like `ARTIFACT_RESOLUTION_INPUT_STATUSES` (same file's `:81`), which is the
 * mirror-image gate for R-4: that one admits `RESOLVED` and `UNAVAILABLE` and excludes `FETCHED`
 * so a warm store does not re-download. R-5 admits exactly the state R-4 excludes, because
 * "bytes we already hold" is R-4's reason to skip and R-5's reason to work.
 */
import type { ArtifactStatus } from "./subject.js"

export const EVIDENCE_COMPILATION_INPUT_STATUSES: readonly ArtifactStatus[] = Object.freeze([
  "FETCHED",
])

/** Whether an artifact in this state has verified bytes R-5 may read. */
export function isEvidenceCompilable(status: ArtifactStatus): boolean {
  return EVIDENCE_COMPILATION_INPUT_STATUSES.includes(status)
}
