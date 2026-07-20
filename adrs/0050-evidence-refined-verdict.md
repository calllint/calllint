# ADR 0050 — Evidence-Refined Verdict Boundary (new11 P1→bake)

- Status: Accepted
- Date: 2026-07-20
- Refines: 0010 (fail-closed verdict), 0034 (evidence envelope),
  0038 (public trust index boundaries), 0046 (Phase I architecture),
  0049 (priority-execution boundary §4 evidence resolution)

## Context

new11 P1 shipped the Evidence Resolution spine: a Subject/Bundle/Gap model and
six read-only resolvers (`packages/resolver/src/evidence/`) held to a 100-object
benchmark gate (PRs #172–#177). But the spine is not yet wired into the thing it
exists to fix. The measured gap (ADR 0049 §context, `evidence-gap-audit.md`) is
that the live Public Trust Index is **17 UNKNOWN of 18** on real external
objects, and the root cause is **100% uniform**: every UNKNOWN registry object is
a remote MCP server whose endpoint identity the offline scan cannot verify, so
`computeVerdict` fails closed to UNKNOWN at the single rule
`if (!binding.sourceKnown) return "UNKNOWN"` (`risk-engine/computeVerdict.ts`).

Resolving that endpoint's network identity over the network (R6 remote-endpoint;
R4 domain ownership is the stronger tier the ecosystem does not yet expose — see
§1a) closes exactly that gap. The question this ADR settles is **how a
resolved EvidenceBundle may change a baked Trust Page verdict** without violating
two non-negotiable product principles: *deterministic rules decide verdicts* and
*UNKNOWN never auto-upgrades to SAFE* (ADR 0010), and without breaking the bake
reproducibility gate (ADR 0046 §4) or the ingestion/serving decoupling (ADR 0038
§3).

## Decision

**1. Gap-close + re-derive (not evidence-scoring).** Resolved evidence never
carries a verdict and is never a score. It may only *close a specific resolution
gap* in the runtime binding; the **unchanged** deterministic rules then re-derive
the verdict over the now-more-complete binding. Concretely, a remote-endpoint
bundle establishes `sourceKnown: true` for that binding when R6 reached the
endpoint and resolved its **network identity** (`endpoint.url`/`host`/`tls`) with
**no blocking gap** (no `NETWORK_UNAVAILABLE`) and a non-failure state (not
`RETRYABLE_FAILURE` / `UNRESOLVABLE`). Nothing else about the binding or the
findings is invented.

**1a. Network identity, not domain ownership, is the bar (measured decision).**
On the real registry cohort, 18/18 remotes are reachable HTTPS endpoints but
**none** publish a `.well-known/mcp.json` ownership descriptor, so every bundle
is `PARTIAL` with a *degrading* `REMOTE_OWNER_UNVERIFIED` gap. Requiring proven
ownership to leave UNKNOWN would make this mechanism inert on 100% of today's
ecosystem. We instead treat *the endpoint is a real, reachable, TLS-terminated
host we identified* as sufficient to leave UNKNOWN — and carry the unproven
ownership forward as a **stated residual reason** on the REVIEW page, never as an
implied SAFE. Ownership-unverified degrades; only unreachable (a blocking
`NETWORK` gap) or a hard resolver failure keeps the page UNKNOWN (fail-closed).

**2. A closed identity gap is not a clean tool surface.** Verifying *that* a remote
endpoint exists does not analyze *what* its tools do — CallLint still never
executes the target (INV1). So closing the identity gap attaches residual
REVIEW-level reasons — `Remote endpoint domain ownership not verified` (when the
degrading owner gap is present) and always `Remote endpoint identity verified;
tool surface not analyzed`. The re-derived verdict for a verified remote is
therefore **UNKNOWN → REVIEW**, never SAFE. SAFE stays reachable only by the
ordinary rules — source known *and* no findings — which a remote whose tool
surface was not analyzed can never satisfy. This is what keeps `false_safe = 0`.

**3. Refinement can only lower UNKNOWN, never touch a confident verdict.** The
refinement is gated: it applies only when the offline verdict is UNKNOWN *and* the
sole cause was the unverified source. A BLOCK/REVIEW/SAFE page is returned
verbatim (a blocker finding still blocks; evidence never overrides it — this is
the ADR 0010 / new11 §6.1 immutability rule). This is the mirror image of the
`extraFindings` online path, which may only *raise* severity; both preserve
"evidence is advisory, the engine decides."

**4. Resolution is workflow-only; bake stays pure.** Resolvers do network I/O, so
they never run inside `bakeTrustPage` (which must stay clock/RNG/network-free and
byte-reproducible). The scheduled `trust-ingest` workflow resolves each registry
subject, freezes the results into a **committed evidence snapshot**
(`packages/trust-index/snapshots/evidence-snapshot.json`, keyed by subject id =
the endpoint URL = `report.target.source`, PII-free and sorted for byte-stability),
and opens a PR. Bake reads that committed snapshot
**purely** — identical to how it already reads the registry snapshot (ADR 0038
§1). CI re-bakes from the committed snapshot and diffs: the network result is
frozen into a reviewable artifact before it can reach the public.

## Consequences

- Measured result: the registry cohort moves from **17 UNKNOWN + 1 SAFE** to
  **17 REVIEW + 1 SAFE**. Each refined page carries the stated, digest-bound
  reasons ("domain ownership not verified" + "identity verified; tool surface not
  analyzed") — honest and actionable, not an UNKNOWN dead end and not a false SAFE.
  The one SAFE page is a package-based (npm) entry, offline-analyzable, untouched.
- Determinism holds: `(committed snapshot) → (bytes)` is a pure function, so the
  reproducibility diff gate is unaffected.
- An automated invariant test asserts no evidence bundle can drive any page to
  SAFE, and that a blocker page is byte-identical with or without evidence.
- Absent an evidence snapshot, the bake is byte-identical to today (fixtures
  cohort is never resolved), so this change is inert until the workflow runs.
