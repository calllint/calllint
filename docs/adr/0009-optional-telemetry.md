# ADR 0009: Optional Anonymous Telemetry and Public Metrics

Status: Accepted

## Context

CallLint's trust root is that it is **offline-first, deterministic, and never
reports anything about the configs it scans**. The CLI does not phone home; a
scan touches the network only behind an explicit `--online` flag, and even then
only to read public registry/repo metadata (ADR 0006).

There is a recurring product temptation to add a usage counter — "N scans run",
"N risky configs flagged" — and surface it on the website as social proof. Done
naively (default-on reporting of scan events) this would **directly break the
trust root**: a security tool that silently exfiltrates how often and on what
you run it is not offline-first, whatever the payload.

We need a decision recorded *now*, before any telemetry code is tempting to add,
so the boundary is a deliberate ADR and not an accident.

## Decision

1. **No telemetry in `0.3.0` (and no telemetry until a separate ADR supersedes
   this one).** The CLI stays offline by default. No scan event, count, or ping
   is emitted. `--online` remains the only network path and is unrelated to
   usage reporting.

2. **The website shows only verifiable, repo-grounded evidence metrics** — e.g.
   corpus case count, real/redacted snapshot count, dangerous false-SAFE count,
   UNKNOWN ratio, Trusted-Publishing/provenance status. Every number must trace
   to a checked-in artifact (`docs/R2_CALIBRATION.md`, the gate docs). **No live
   scan counter.**

3. **If telemetry is ever implemented, it is opt-in and aggregate-only**, under
   the requirements and field allowlist below, and only after a follow-up ADR
   records that the demand and the design are real.

## Rules

### Requirements for any future telemetry

1. Default **off**.
2. Enabled only by an **explicit** `--telemetry` flag or `CALLLINT_TELEMETRY=1`.
3. First opt-in run prints exactly what is and is not sent, and how to disable.
4. **Aggregated counts only** — no per-scan record that could re-identify a
   config or user.
5. Trivial opt-out; opting out is permanent until re-enabled.
6. Documented in a privacy notice shipped with the CLI and on the website.

### Field allowlist (the *only* fields a future event may carry)

- `toolVersion`
- `reportSchemaVersion`
- `verdict` (SAFE / REVIEW / BLOCK / UNKNOWN)
- `findingFamilies` — coarse categories only (e.g. `files`, `prompt`), never
  full finding evidence
- `hostKind` — only if the user explicitly chooses to include it
- `timestampBucket` — a day bucket, not an exact timestamp
- an anonymous install/session id — only if separately approved in the future ADR

### Never sent (hard denylist)

raw config · file paths · env var names or values · command args · URLs ·
tokens or secrets · repository names · usernames · machine identifiers · finding
evidence strings.

### Website wording

- **Allowed** (only after telemetry actually exists): "opt-in scans reported",
  "risky configs flagged in opt-in scans".
- **Disallowed** at all times: "risks prevented", "users protected", "threats
  blocked", "certified safe", "zero false positives" — each asserts a causal or
  absolute claim CallLint cannot prove.

## Reason

Recording the boundary as an accepted decision means telemetry can only ever be
added *deliberately*, with consent and an aggregate-only shape, by a future ADR
that supersedes this one. Until then the offline-first guarantee is protected by
design, and the public surface leans on auditable evidence instead of growth
numbers. A future implementation sketch (CLI opt-in UX, minimal event shape,
aggregate-only storage) is captured in `docs/v0.2.5next.md` §9 for reference; it
is **not** a commitment to build.
