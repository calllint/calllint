# Contribution boundary

Why CallLint is open source, why it is maintainer-led, and how external ideas
are handled. This is the rationale behind [CONTRIBUTING.md](../CONTRIBUTING.md)
and [GOVERNANCE.md](../GOVERNANCE.md).

## Why open source

CallLint is Apache-2.0 open source for:

- **transparency** — anyone can read exactly how a verdict is reached,
- **auditability** — security tooling has to be inspectable to be trusted,
- **adoption** — easy to install, run, and reference,
- **agent discoverability** — coding agents can cite an authoritative, readable source.

## Why maintainer-led

The open-source license maximizes trust; it does not mean the roadmap is
crowdsourced. CallLint stays maintainer-led to protect:

- **security semantics** — deterministic verdicts, no LLM in the verdict path,
  no runtime execution of scanned servers,
- **release discipline** — provenance, signing, and dist-tag hygiene,
- **brand trust** — one authoritative implementation and source of truth.

## How external ideas are handled

Issues and discussions are welcome and genuinely useful. For code, maintainers
may reimplement an idea rather than merge an external patch — this keeps
provenance and security semantics under direct control and is not a judgment of
the contributor.

## When DCO or a contributor agreement may be required

There is no CLA or DCO bot today. A maintainer may ask for a DCO `Signed-off-by`
or a separate contributor agreement before merging:

- non-trivial external code,
- corporate contributions,
- contributions affecting the core scanner, release workflow, or security semantics.

For trivial fixes (typos, link fixes, small doc corrections) none of this is
needed.

## Three kinds of external PR

1. **Trivial** (typo, link, small doc fix) — may be merged or reimplemented by a
   maintainer; no agreement needed.
2. **Idea / bug report** (e.g. "this config is misjudged") — best as an issue;
   maintainers typically implement the fix themselves.
3. **Non-trivial code** (detector, parser, risk engine, release workflow,
   schema) — not merged by default; a maintainer may request DCO/CLA,
   reimplement it clean-room, or decline.
