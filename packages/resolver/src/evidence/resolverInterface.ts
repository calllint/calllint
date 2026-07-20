/**
 * Evidence-resolver interface (new11 P1 §4.2 — row E2) — the contract every
 * resolver in @calllint/resolver implements.
 *
 * A resolver is a PURE-EDGE function: `(subject, ctx) -> Promise<ResolverResult>`.
 * All I/O is behind the injected fetchers on `ResolverContext`; the resolver
 * itself never touches the clock, the filesystem, or a child process (INV1).
 *
 * Hard rules (all tested):
 *   - A resolver NEVER throws to signal a failed resolution. A missing or
 *     unreachable signal becomes a coded EvidenceGap (fail-closed).
 *   - A resolver NEVER executes, probes, or side-effects the target. It only
 *     reads identity/metadata over the injected fetchers.
 *   - Output is deterministic for a given (subject, injected responses).
 */
import type {
  EvidenceSubject,
  ResolverResult,
  SubjectType,
} from "@calllint/evidence"

/**
 * Injectable JSON fetcher. Structurally identical to `@calllint/online`'s
 * `FetchJson`, defined locally so the resolver does not depend on the heavier
 * online package (which would form a workspace dependency cycle). The CLI edge's
 * one real fetch function satisfies both by structural typing.
 */
export type FetchJson = (url: string) => Promise<unknown>
/** Injectable text fetcher; resolves to undefined on 404. Mirrors online's `FetchText`. */
export type FetchText = (url: string) => Promise<string | undefined>

/**
 * The injected capabilities a resolver may use. The CLI edge supplies real
 * network fetchers + its `generatedAt` clock reading; tests inject fakes.
 * There is deliberately NO exec/spawn/fs capability here — that absence is the
 * enforcement of INV1 at the type level.
 */
export interface ResolverContext {
  /** Fetch + parse JSON from a URL. Rejects on network failure. */
  fetchJson: FetchJson
  /** Fetch text (e.g. a well-known file). Resolves to undefined on 404. */
  fetchText: FetchText
  /** ISO timestamp injected by the edge, for any time-stamped evidence. */
  resolvedAt: string
}

/** One resolver: resolves a single subject into a ResolverResult, never throws. */
export interface EvidenceResolver {
  /** Stable id stamped on every item/gap it produces, e.g. "R1:npm". */
  readonly id: string
  /** The subject types this resolver can handle. */
  readonly handles: readonly SubjectType[]
  resolve(subject: EvidenceSubject, ctx: ResolverContext): Promise<ResolverResult>
}
