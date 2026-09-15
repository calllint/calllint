# ADR 0098 - A served cohort departure is recorded when its upstream cause is unavailable

- **Status**: Accepted
- **Date**: 2026-09-15
- **Relates to**: ADR 0084, ADR 0085, ADR 0088

## Context

The trust refresh advanced the served cohort from the previous revision `c4c388ba` to the
current revision. The identity witness found one subject that was present in the previous
cohort but absent from the current served window:

- `ai.aisecuritygateway/mcp-gateway` — **de-listed from the served cohort** between the two
  revisions; the current offline run did not consult the upstream source, so the cause is
  **unknown**.

The subject sorts inside the current served window. Therefore this event is not explained by
our alphabetical cap. The record is an acknowledgement of the observed cohort departure, not
a claim that the publisher withdrew the server and not a safety judgement about it.

## Decision

Record the observed departure in the ADR corpus so the identity gate cannot silently lose it.
Keep the event visible as an unclassified departure whenever the gate reports it. A future run
with a source view may classify the cause; that classification must be recorded separately and
must not be inferred from this acknowledgement.

This acknowledgement does not change the mirror, projection, cap, or verdict semantics. In
particular, `UNKNOWN` remains distinct from `SAFE`, and the subject is not reintroduced into the
served cohort by prose.

## Evidence

- Failing run: trust-ingest PR #362, `ledger-authenticity`, run `34923650003`.
- The gate reported: one subject left cohort `200 → 250`; the subject sorted inside the served
  window and the source was not consulted.
- The refresh completed its source walk and generated the snapshot; this ADR only records the
  identity event required by ADR 0084 D4.
