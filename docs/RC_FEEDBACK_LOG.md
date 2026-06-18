# RC feedback log — 0.3.0-rc.0

Append-only record of redacted validation results for the `0.3.0-rc.0` feedback
window. Process, redaction rules, classification, and the stable-blocking
criteria live in [RC_FEEDBACK_PROTOCOL.md](./RC_FEEDBACK_PROTOCOL.md). This file
is only the log.

Install under test: `npx calllint@next` (currently `0.3.0-rc.0`).

## Window status

- RC version: `0.3.0-rc.0` (published to the `next` dist-tag, signed provenance)
- Target coverage: 5–10 real / semi-real MCP configs · 3–5 CI / SARIF runs ·
  ≥ 1 non-author input
- Open stable blockers: **0**
- Unresolved dangerous false-SAFE: **0**

Promote to stable only when target coverage is met, every blocker is closed, and
the [stable gate](./STABLE_RELEASE_GATE.md) is fully checked.

## Release verification (pre-feedback baseline)

Recorded at publish time, before external feedback — these are the author's own
post-publish checks, not user feedback entries.

- `npm view calllint dist-tags` → `next: 0.3.0-rc.0`, `preview: 0.3.0-preview.1`,
  `latest: 0.3.0-preview.0` (latest drift fixed at stable, per RELEASE_VERIFICATION §1).
- `npx calllint@next --help` → exit 0.
- `npx calllint@next scan <safe-local mcp.json>` → SAFE; `--json` verdict `SAFE`.
- `npm audit signatures` (clean install) → 1 verified registry signature +
  1 verified attestation.

## Entries

<!-- Copy the block below for each scan. Redact BEFORE pasting (no secrets, no
     private paths, no internal URLs, no customer/person/repo names that are not
     already public). Never store an un-redactable config — record the gist in
     prose instead. -->

<!--
## <id> — <host kind> — <YYYY-MM-DD>
- source: real-public | redacted-real | semi-real | author-other-project
- redaction: done | n/a (what was masked)
- command: npx calllint@next scan <redacted target> [flags]
- verdict: SAFE | REVIEW | BLOCK | UNKNOWN  (findings: <ids>)
- classification: no-action | docs | parser-edge | false-positive |
  false-negative | corpus-candidate | policy-tuning
- dangerous false-SAFE? : NO | YES (→ stable blocker)
- notes: <what happened; did the user understand the verdict and the next step>
- follow-up: <issue link / corpus-candidate id / none>
-->

_No external entries yet — window open._
