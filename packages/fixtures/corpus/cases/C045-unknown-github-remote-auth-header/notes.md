# C045 — GitHub remote MCP (http) with an Authorization Bearer header (UNKNOWN)

## What this is

The remote `http` variant from `github/github-mcp-server` `README.md` @ `6830c4d39426`
(MIT): a `type: "http"` server at `https://api.githubcopilot.com/mcp/` with an inline
`Authorization: Bearer ${input:github_mcp_pat}` header.

## Verdict: UNKNOWN

A recognized remote endpoint is uninspectable by construction — CallLint never
connects to it — so the verdict is UNKNOWN, never SAFE (ADR 0010). The host
`api.githubcopilot.com` is allowlisted, so `supply.unknown-remote` does **not** fire:
this is UNKNOWN with **zero** findings, driven purely by the `sourceKnown` gate.
`thisCaseMustNeverBeSafe: true` guards against a future regression flipping a remote
to SAFE.

## What this pins (the remote/header matrix)

- **C025** — same host, no header → UNKNOWN, 0 findings.
- **C045 (this)** — same host, **with** an `Authorization: Bearer` header → UNKNOWN,
  0 findings. An inline auth header on an allowlisted remote does not by itself add
  a finding or change the verdict.
- **C026** — GitHub *Enterprise* host (non-allowlisted) → UNKNOWN **with**
  `supply.unknown-remote`.

## Limitations

CallLint does not treat the `Authorization` header value as a secret env key (it is
a header, not an `env` entry, and the value is a placeholder). The remote is
uninspectable, so UNKNOWN is honest regardless of the header.

## Provenance / redaction

- Source: `github/github-mcp-server` @ `6830c4d39426`, `README.md` (remote http
  variant). License MIT.
- No redaction: verbatim documentation, normalized only to a valid JSON root.
  `${input:github_mcp_pat}` is upstream's own VS Code input placeholder.
