# agent-trust-bench

A small, reproducible benchmark that demonstrates **complementarity**: a content
scanner (SkillSpector) and CallLint's authority layer answer *different questions*, so
they can — and should — disagree.

- **SkillSpector** asks: *is the code malicious?*
- **CallLint** asks: *is the authority this artifact requests acceptable?*

Clean, non-malicious code can still request unsafe authority (read the whole home
directory, hold an admin OAuth scope, charge a card). These cases capture exactly those
gaps, plus the fail-closed case where an incomplete content scan is never a pass.

## What each case proves

| Case | Content scan | CallLint authority | The gap |
| --- | --- | --- | --- |
| B01 | clean | BLOCK | broad `$HOME` filesystem authority |
| B02 | clean | REVIEW | admin OAuth scope |
| B03 | clean (LLM-assisted) | BLOCK | auto-payment capability |
| B04 | partial | UNKNOWN | an incomplete scan is not a pass |

## How it runs

`pnpm bench:test` drives the **built** CLI (`apps/cli/dist/index.js`) over each case:

```
calllint scan <input>/mcp.json --evidence <skillspector-report>.json --json
```

and asserts each `expected.json`: CallLint's own authority verdict + required findings,
the attached evidence provider/completeness/findings-count, and the never-SAFE floor.
The gate is offline and deterministic (pinned `--generated-at`); it exits non-zero on any
regression, mirroring `scripts/run-corpus.mjs`.

Regenerate the derived artifacts (`calllint-report.json`, `authority-manifest.json`) after a
config or engine change:

```bash
pnpm build && node scripts/run-bench.mjs --write-artifacts
```

## Provenance & neutrality (hard rules)

- **Self-authored / opt-in fixtures only.** No third-party project is named or accused.
  The configs are synthetic shapes chosen to isolate one authority signal each.
- **SkillSpector reports are committed fixtures, never a live run.** They are
  SkillSpector-*shaped* JSON, pinned to an illustrative commit (`git:<commit>`) per
  ADR 0034's version-pinning rule. CallLint never executes SkillSpector.
- **The scanned MCP server is never executed** — CallLint reads config statically.
- No `certified safe` / `guaranteed secure` / `SkillSpector-verified` / `NVIDIA
  approved` language. The benchmark shows *observed complementarity at a digest*, not an
  endorsement of either tool.

See [ADR 0034](../../../adrs/0034-evidence-provider-envelope.md) and
[EVIDENCE.md](../../../EVIDENCE.md) for the evidence-interoperability contract.
