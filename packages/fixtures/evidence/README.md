# Evidence fixtures (`calllint.evidence-provider.v0`)

Reference inputs for the Evidence Provider adapter (ADR 0034, new7 Phase B / v1.2.0).
Each file is a **raw third-party scanner report**; `calllint evidence import` maps it
into a normalized `calllint.evidence-provider.v0` envelope without re-scoring it.

These fixtures are the golden inputs for `@calllint/evidence` and (later) the joint
Trust Packet benchmark (B4). They are self-authored, SkillSpector-*shaped* samples —
not copied from any real project — so they carry no accusation about anyone's code.

## skillspector/

| File | Represents | Expected envelope | `evidence import` exit |
|------|-----------|-------------------|------------------------|
| `clean.json` | complete scan, no findings | `completeness: complete`, 0 findings | 0 |
| `findings.json` | complete LLM-assisted scan, 2 findings | `scanMode: llm`, findings preserved verbatim | 0 |
| `partial.json` | provider-declared partial scan | `completeness: partial` | 10 |
| `malformed.json` | truncated/invalid JSON | `completeness: failed` (fail-closed) | 20 |
| `report.sarif` | SARIF 2.1.0 export | findings mapped, `completeness: degraded` (SARIF detail loss) | 20 |

## Invariants these fixtures lock (ADR 0034)
- **No re-score / no rename**: `providerSeverity` (`high`/`critical`/`error`) is kept
  verbatim — never mapped into CallLint's S0–S5 or SAFE/REVIEW/BLOCK/UNKNOWN.
- **Fail closed**: `malformed.json` must never import as a pass.
- **No silent detail loss**: `report.sarif` is marked `degraded` because SARIF drops
  fields present in the JSON form.
- **Version pinning**: reports carry a `commit`; a report without one imports as
  `providerVersion: "unknown"` + degraded (see `@calllint/evidence` unit tests).
