# CallLint receipts

A CallLint **receipt** is a small, local JSON file that records the outcome of a
scan: which CallLint version produced which verdict, over which input, under
which policy and ruleset context. It exists so that a pre-flight decision — the
moment before an agent loads or runs a tool — can be **audited later** instead of
vanishing.

This document describes what a receipt **actually is today**, verified against
the CLI, not aspirational behavior.

## What a receipt is

```bash
calllint scan .cursor/mcp.json --receipt
```

That runs the ordinary scan (unchanged output, unchanged exit code) and then
writes `calllint-receipt.json` next to where you ran it:

```json
{
  "schema_version": "calllint.receipt.v0",
  "receipt_id": "clrec_5Kq2…",
  "created_at": "2026-07-01T12:00:00.000Z",
  "tool": { "name": "calllint", "version": "0.8.0" },
  "subject": { "type": "scan", "target": ".cursor/mcp.json" },
  "verdict": "REVIEW",
  "hashes": {
    "input_hash": "sha256:…",
    "policy_hash": "sha256:…",
    "report_hash": "sha256:…",
    "ruleset_hash": "sha256:…"
  },
  "risk_counts": { "safe": 1, "review": 2, "block": 0, "unknown": 0 },
  "finding_refs": [
    { "rule_id": "secrets.env-key", "severity": "medium", "evidence_path": "mcpServers.github.env.GITHUB_TOKEN" }
  ],
  "trust_boundaries": {
    "executed_target": false,
    "network_used": false,
    "llm_in_verdict_path": false,
    "secret_values_read": false
  }
}
```

A receipt is a **reporting layer** over the scan report you already produce. It
adds no analysis and makes no verdict decision of its own: `verdict`,
`risk_counts`, and `finding_refs` are read straight from the scan report. A
receipt is **not** a second scanner and never re-judges a scan.

## What a receipt is not

- It is **not a proof of runtime safety.** A `SAFE` verdict on a receipt means
  "no blockers observed under current evidence" — the same careful meaning it has
  everywhere else in CallLint. `UNKNOWN` is never `SAFE`.
- It does **not certify** a tool. CallLint issues a receipt; it does not "approve"
  or "guarantee" a server.
- It is **unsigned.** A `calllint.receipt.v0` receipt is a local, unsigned
  receipt. The `signature` field is reserved for a future cloud-signing release
  and is never populated today. Its absence is normal, not an error.

## Verifying a receipt

```bash
calllint receipt verify calllint-receipt.json
```

`receipt verify` checks the **structure** of a receipt: schema identity, hash
formats (`sha256:<64 hex>`), integer risk counts, required fields, and the fixed
trust-boundary invariants. It is offline and does no cryptography and no network
access. It exits `0` for a structurally valid receipt and `1` for a malformed or
invalid one. Add `--json` to get the machine-readable result.

Verification confirms a receipt is **well-formed**; it does not re-run the scan
and cannot upgrade a verdict.

## The hashes

| Hash | Covers |
| --- | --- |
| `input_hash` | The scanned config input. |
| `policy_hash` | The effective policy in force during the scan (`{ "policy": "default" }` when none was loaded). |
| `report_hash` | The full `calllint.report.v0` scan report the receipt was derived from. |
| `ruleset_hash` | The ruleset identity. In v0.8 the detectors are pinned to the CLI version, so this is the tool identity `{ tool, version }`. |

Hashes reuse the same `@calllint/fingerprint` hashing (`sha256` / stable JSON) as
the rest of the toolchain, so a receipt's hashes are byte-consistent with the
scan report. `receipt_id` and `created_at` are intentionally non-deterministic
and are **not** covered by any hash.

`input_hash` is computed over the raw config text as read by the CLI. The fully
normalized parser form is not cleanly reachable at the receipt boundary today;
`report_hash` is the authoritative fingerprint of what was actually judged.

## Secret safety

A receipt records finding **references** — `rule_id`, `severity`, and the
`evidence_path` (a key path such as `mcpServers.github.env.GITHUB_TOKEN`). It
never copies an evidence **value**. CallLint does not read secret values during a
scan, and a receipt never introduces one. Receipts also contain no absolute local
filesystem paths.

## In CI

`scan --receipt` composes with the existing PR-gate flags — `--ci` still drives
the exit code, and `--json` / `--sarif` / `--markdown` output is unchanged. A
receipt is an extra artifact you can upload alongside them; it does not change the
gate. See the GitHub Action's `receipt` input for uploading one automatically.

## Boundary summary

A CallLint receipt is a **verifiable local receipt** and **heuristic decision
support**: preflight recorded, policy checked, scan evidence captured. It is
never a certification, never a safety guarantee, and never a second opinion that
re-judges the scan.
