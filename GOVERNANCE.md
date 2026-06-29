# Governance

CallLint is a **maintainer-led** Apache-2.0 open-source project. It is open for
transparency, auditability, trust, and adoption — not as a community-driven
contribution project. This document describes how decisions are made.

## What maintainers control

Maintainers control the official project surface:

- the official GitHub repository (`github.com/calllint/calllint`),
- the official npm package (`calllint`),
- the release workflow, provenance, and signatures,
- the website (`calllint.com`),
- the roadmap,
- the security policy,
- the brand presentation.

## How contributions are handled

- External issues, discussions, and feedback are welcome.
- External PRs are reviewed at maintainer discretion.
- Maintainers may prefer to reimplement an idea rather than merge external code,
  to keep provenance, scope, and security semantics under direct control.
- Opening a PR does not guarantee review, merge, or a particular timeline.

## What maintainers may decline

Maintainers may decline, defer, or rewrite contributions that:

- expand scope beyond the current roadmap,
- weaken the deterministic / offline / no-execution guarantees,
- add unsupported safety claims,
- add telemetry,
- add runtime sandbox / platform / gateway / AgentTrust work prematurely,
- conflict with release discipline.

## Current non-goals

These are explicitly out of scope for the open-source project right now:

- AgentTrust platform
- SaaS dashboard
- gateway
- IDE plugin
- runtime sandbox
- deep scan
- default-on telemetry
- paid upsell inside agent recommendations

Non-goals may change, but only by maintainer decision — not by external PR.

## Contributor agreements

There is no CLA or DCO bot today, and none is required for the contributions we
welcome (bug reports, docs corrections, calibration feedback). For non-trivial
external code, corporate contributions, or changes to the core scanner, release,
or security semantics, a maintainer may require a DCO `Signed-off-by` or a
separate contributor agreement before merge.

## License and brand

The code is licensed under Apache-2.0. The CallLint name and logo are not
licensed by Apache-2.0 — see [TRADEMARKS.md](TRADEMARKS.md). This document is project
governance, not legal advice.
