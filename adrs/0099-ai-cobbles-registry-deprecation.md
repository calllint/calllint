# ADR 0099 - An upstream deprecation explains the `ai.cobbles/cobbles` departure

- **Status**: Accepted
- **Date**: 2026-10-20
- **Relates to**: ADR 0084, ADR 0085, ADR 0088, ADR 0095, ADR 0098

## Context

The scheduled trust refresh in PR #379 advanced the served registry cohort from 400 entries
to 450. The previous cohort, at snapshot revision `3b226543`, included
`ai.cobbles/cobbles` as version `1.0.0` with status `active`. The snapshot fetched on
2026-10-19 omits it. `pnpm gate:s0:identity` found that one subject absent from the new
cohort and failed because no ADR recorded the departure.

The CI job has no live Registry source view, so its classifier correctly reports the cause
as `unknown`. That is a limit of the offline measurement, not evidence that the source cause
is unknown. The exact-name Official MCP Registry record was checked separately.

## Decision

Record this as an upstream-deprecated departure, consistent with ADR 0095. The Registry now
marks the `ai.cobbles/cobbles` version `1.0.0` as `deprecated` and `isLatest: true`. Its
status message says the Robells task board moved to `io.robells/robells`, the old
`api.cobbles.ai/mcp` endpoint was retired on 2026-08-02, and the `ai.cobbles` namespace is
reserved for a separate platform that will be republished when it ships. The replacement
`io.robells/robells` is currently `active` and `isLatest`.

- `ai.cobbles/cobbles` was **de-listed from the served cohort after the Registry marked it
  deprecated**.

This records the observed source status and cohort departure. It does not infer publisher
intent, make a safety judgement, or claim that the old endpoint was probed. The ingestion
continues to include only `active` + `isLatest` records; no subject is restored by this ADR.
CI remains offline and will continue to report its source classification as `unknown` while
the acknowledgement makes this observed event explicit. `UNKNOWN` remains distinct from
`SAFE`.

## Evidence

- Previous retained snapshot, revision `3b226543`: `ai.cobbles/cobbles`, version `1.0.0`,
  status `active`.
- Refreshed retained snapshot in commit `4ff7b7f7`: fetched at
  `2026-10-19T13:04:27.000Z`, 450 entries, with `ai.cobbles/cobbles` absent.
- Official MCP Registry exact-name versions endpoint, checked 2026-10-20:
  <https://registry.modelcontextprotocol.io/v0/servers/ai.cobbles%2Fcobbles/versions>
  returned HTTP 200 with version `1.0.0`, status `deprecated`, `isLatest: true`, and
  `statusChangedAt: 2026-10-17T09:41:50.483886Z`. The official status message identifies
  the move to `io.robells/robells` and the retirement of the old endpoint.
- Official MCP Registry search for `io.robells/robells`, checked 2026-10-20, returned that
  identity with status `active` and `isLatest: true`.
- Failing CI run: PR #379, `ledger-authenticity`, run
  <https://github.com/calllint/calllint/actions/runs/39258336169/jobs/118079202178>.
  The gate reported one unacknowledged departure, while the 450-entry count met the ratchet
  floor of 450.
