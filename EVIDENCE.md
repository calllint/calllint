# Evidence Interoperability

CallLint can ingest another scanner's report as **evidence** and show it beside its own
verdict — without re-scoring it. The design principle is **aggregate, don't impersonate**:
CallLint is a deterministic *authority* layer, not another content scanner, and it never
rewrites another tool's findings into its own verdict.

Two tools, two questions:

- A **content scanner** (e.g. SkillSpector) asks: *is the code malicious?*
- **CallLint** asks: *is the authority this artifact requests acceptable?*

A package can be clean and still request unsafe authority. Evidence interoperability lets
you see both answers at once, unmerged.

Governing decision record: [ADR 0034](adrs/0034-evidence-provider-envelope.md).

## The evidence envelope

`calllint evidence import` normalizes an external report into a
`calllint.evidence-provider.v0` envelope (in `@calllint/evidence`). It keeps the
provider's findings **verbatim** — provider rule ids and severities are never remapped
into CallLint's own — and records provenance: provider, pinned provider version, scan
mode, coverage, completeness, a `rawReportDigest`, and any `degradedReasons`.

```bash
calllint evidence import skillspector-report.json          # JSON (auto-detected)
calllint evidence import skillspector-report.sarif          # SARIF 2.1.0
calllint evidence import report.json --provider skillspector --format json
```

Exit code reflects completeness: `0` complete · `10` partial · `20` degraded/failed ·
`2` usage error.

## Attaching evidence to a scan

`scan --evidence <file>` runs the normal scan (the verdict path is unchanged) and
attaches the imported envelope to the report as a supporting projection.

```bash
calllint scan .cursor/mcp.json --evidence skillspector-report.json
calllint scan mcp.json --evidence report.sarif --evidence-format sarif --json
```

- Without `--evidence`, output is **byte-identical** to today.
- `--evidence-format json|sarif` forces the format when auto-detection is ambiguous.
- The evidence appears as an optional `evidence` field on the JSON report
  (`calllint.report.v0`) — additive, no schema break. Machine consumers get it for free;
  the human output renders a joint Trust Packet.

### The joint Trust Packet

On the human-readable output, attached evidence produces a side-by-side block:

```
Joint Trust Packet
──────────────────
Content scan
  skillspector git:<commit>  scanMode: static  completeness: complete
    2 findings (top severity: high)
    raw report digest: sha256:…
Authority scan
  CallLint 1.4.0  BLOCK  (Blocked by policy)
Why they differ: the content scan found nothing malicious, but CallLint judges the
granted authority itself too broad — clean code can still request unsafe capabilities.
```

The two verdicts are shown **unmerged**, plus one line explaining the difference. That
explained difference is the value: the tools answer different questions, so they can
disagree, and neither overrides the other.

## The boundary (what evidence does NOT do)

These invariants are enforced in code and locked by tests (ADR 0034 §"five invariants"):

1. **No re-score / no rename.** Provider findings and verdicts stay provider-native.
2. **No upgrade.** An external `SAFE`/low-score result never raises a CallLint verdict
   toward SAFE. `scan --evidence` does not feed the verdict at all — the CallLint verdict
   is computed exactly as without evidence.
3. **Fail closed.** Malformed/unparseable input imports as `completeness: failed`; a
   degraded or partial content scan is surfaced as *not a pass*, never dropped.
4. **Never silently ignore a missing scanner.** An absent report is a usage error, not a
   silent success.
5. **Pin the provider version.** SkillSpector has no formal release, so its version is
   pinned to a commit (`git:<commit>`); a missing commit forces `providerVersion: unknown`
   and degrades completeness.

Driving a normalized *decision* from evidence is the Trust Gateway's Authority Manifest
(`trust prepare`), not `scan`.

## Reproducible proof: agent-trust-bench

`packages/fixtures/bench/` holds a small, self-authored benchmark demonstrating the
complementarity, run by `pnpm bench:test` (offline; SkillSpector reports are committed
fixtures, never a live run). See its [README](packages/fixtures/bench/README.md).

## Secure agent install

The open `secure-agent-install` skill (`skills/secure-agent-install/`) wires this into a
human-facing workflow: scan content with SkillSpector, ask CallLint whether the requested
authority is acceptable, read the joint Trust Packet, and install only after approval. It
installs nothing by default.

## Language

CallLint never claims another tool "certified" or "verified" an artifact, and implies no
partnership. Allowed: *evidence imported*, *content scan recorded*, *completeness:
degraded*, *authority decision*. A `SAFE` verdict means "no blockers observed under current
evidence" — not a proof of runtime safety.
