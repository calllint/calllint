# RC feedback protocol

How `0.3.0-rc.0` is validated before `0.3.0` ships to `latest`. This is the
human-in-the-loop window the [stable release gate](./STABLE_RELEASE_GATE.md)
depends on: the gate's boxes are checked *using* what this protocol collects.

CallLint never executes a scanned server, and this protocol never asks anyone to
run one. No telemetry is involved (see
[ADR 0009](./adr/0009-optional-telemetry.md)); feedback is collected manually and
recorded by hand.

## Goal of the window

An rc is a *stable candidate*, not a feature release. The window exists to prove
the release path and the verdicts hold up on real, non-author inputs before the
package claims the default `latest` tag.

Target coverage (minimum, not a quota to pad):

- **5–10** real or semi-real MCP configs (Cursor `.cursor/mcp.json`, Claude
  Desktop `claude_desktop_config.json`, generic MCP, public-repo configs).
- **3–5** CI / SARIF runs (`--ci`, `--sarif` into GitHub Code Scanning).
- At least **1** input that is not from the author's own projects.
- Coverage across `npx calllint@next` install on more than one OS where possible.

"Semi-real" is fine: your own other projects, a friend's config, a public repo's
committed MCP config. The point is inputs the author did not craft as fixtures.

## Redaction rules (before anything is written down or kept)

A config only enters notes or the corpus **after** redaction:

- **No secret values.** Replace token/key/password values with `REDACTED`.
  (CallLint reads key *names*, never values — keep it that way in artifacts too.)
- **No private filesystem paths.** Replace home dirs / internal mounts with a
  placeholder (`/path/to/project`).
- **No internal URLs or hostnames.** Replace with the upstream's own example
  domain or a placeholder.
- **No customer, employer, or person names.**
- **No repository names** that are not already public.

If a config cannot be redacted without destroying what made it interesting, it
does **not** get stored — record the observation in prose instead.

## Classifying each piece of feedback

Every scan result or report gets exactly one primary classification:

| Class | Meaning | Typical action |
|-------|---------|----------------|
| `no-action` | Verdict and evidence are correct and clear. | Note it; move on. |
| `docs` | Behaviour is right but a doc/message confused the user. | Open a docs issue. |
| `parser-edge` | A config shape parsed wrong or not at all. | File with a minimal repro. |
| `false-positive` | A finding fires where it should not. | Calibrate detector; add golden + corpus case. |
| `false-negative` | A real risk was missed. | Assess severity (see blockers); calibrate. |
| `corpus-candidate` | A good, redactable real case worth regression-locking. | Queue for R2.2. |
| `policy-tuning` | Default policy threshold felt wrong for a real workflow. | Discuss; do not weaken silently. |

Never weaken a detector, golden, or corpus expectation just to make a case pass
(CLAUDE.md): fix the parser, the fixture, or — if a rule is genuinely wrong —
write an ADR first.

## Blockers for stable (any one open ⇒ do not promote to `latest`)

- **Any unresolved dangerous false-SAFE** — a dangerous config that resolves to
  SAFE. This is the hard line; the corpus gate also enforces it.
- `npx calllint@next` install failure on a supported platform.
- Provenance / signature verification failure (`npm audit signatures`).
- SARIF dogfood failure ([`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
  red, or alerts stop appearing in Code Scanning).
- Corpus gate failure (`corpus:test` or `corpus:test:r2-final` not green).

A false-negative that is *not* a dangerous false-SAFE (e.g. a documented,
lower-severity miss like the C023 docker `--mount` case) is **not** an automatic
blocker — it is recorded on the case and scheduled, not hidden.

## Recording: `docs/RC_FEEDBACK_LOG.md`

Keep one append-only log. Suggested template:

```markdown
# RC feedback log — 0.3.0-rc.0

## <id> — <host kind> — <date>
- source: real-public | redacted-real | semi-real | author-other-project
- redaction: done | n/a (give the gist of what was masked)
- command: npx calllint@next scan <redacted target> [flags]
- verdict: SAFE | REVIEW | BLOCK | UNKNOWN  (findings: <ids>)
- classification: no-action | docs | parser-edge | false-positive |
  false-negative | corpus-candidate | policy-tuning
- dangerous false-SAFE? : NO | YES (→ stable blocker)
- notes: <what happened, did the user understand the verdict and next step>
- follow-up: <issue link / corpus-candidate id / none>
```

## Exit criteria for the window

- Target coverage met.
- **Zero** open stable blockers (above).
- Every `false-positive` / `false-negative` either resolved or explicitly
  recorded with a scheduled follow-up.
- Valid `corpus-candidate` entries queued for R2.2.
- CHANGELOG / release notes updated for anything that shipped as a fix.

When all of these hold and the [stable gate](./STABLE_RELEASE_GATE.md) is fully
checked, `0.3.0` is cleared to ship to `latest`.
