# ADR 0102: Observed upstream registry departures on 2026-11-02

Status: Accepted
Date: 2026-11-02
Scope: Record observed cohort departures under ADR 0084 D4; no gate or verdict change.

## Evidence

The 500-record refresh in run 41372557647 retained 448 previous subjects and
admitted 52. PR #389's identity gate correctly rejected the unacknowledged loss
of GreenLight despite the cohort count rising from 450 to 500.

The following observations were read directly from the Official MCP Registry
on 2026-11-02. No MCP server or publisher endpoint was executed or contacted.
The Registry's status messages are upstream statements, not runtime probes.

- `ai.agentlookups/greenlight` was de-listed from the active cohort: the
  [official record](https://registry.modelcontextprotocol.io/v0/servers?search=ai.agentlookups%2Fgreenlight&limit=100)
  reports version `1.0.0`, `isLatest: true`, `status: deprecated`, and
  `statusChangedAt: 2026-10-26T20:15:18.12136Z`. The upstream message describes
  closure on 2026-09-28 because answer correctness could not be maintained.
- `ai.b77/fibalo` was de-listed from the active cohort: the
  [official records](https://registry.modelcontextprotocol.io/v0/servers?search=ai.b77%2Ffibalo&limit=100)
  report version `1.1.0`, `isLatest: true`, `status: deprecated`, and
  `statusChangedAt: 2026-10-27T17:02:43.105833Z`. The upstream message records a
  move to `de.fibalo/mcp`. Version `1.0.0` is also deprecated and is not latest.

## Decision and limits

Record these two current departures in the existing ADR acknowledgement channel.
The refresh's exclusion of non-active records follows the existing selection
contract; neither missing subject is explained by this run's increased cap.
ADR 0086's earlier cap-eviction observation for Fibalo remains historical and
does not describe this later upstream deprecation.

The offline identity leg can still report the cause as UNKNOWN because it does
not consult the live source. This record supplies the separately observed source
evidence; it does not turn that offline classifier into a network observation.
No identity check, retention rule, ratchet floor, fixture expectation, or Gate-B
publication requirement is changed. A future reactivation or a different
departure cause requires a fresh review of the source evidence.
