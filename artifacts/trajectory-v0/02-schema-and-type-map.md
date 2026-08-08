# 02 — Schema and type map

Answers T0 questions 4 and 5, and carries the schema-side half of question 1.

**Status: extension `CONTRADICTED`, canonical serialization `PARTIAL`.**

## Q4 — does the Receipt support extension?

The question expects `EXISTS` or `ABSENT`. The measured answer is neither: extension is **actively
forbidden, and there is a gate that fails when it is attempted**.

| Claim | Binding | Measured |
| --- | --- | --- |
| Schemas are closed by default | `for f in schemas/*.json; grep -q '"additionalProperties": false'` | **29 of 30** carry it |
| The one exception is not ours | `schemas/sarif-schema-2.1.0.json` | Vendored upstream SARIF 2.1.0. **29/29** of CallLint's own schemas are closed |
| A gate asserts rejection, not just the flag | [tests/schema/schema-compatibility.test.ts:56-58](../../tests/schema/schema-compatibility.test.ts#L56-L58) | Asserts three things per schema, the third verbatim: *"`additionalProperties:false` schemas reject an unknown key (no silent extra)"* |

The distinction between the flag and the gate is the finding. A flag alone could be removed from
one schema in a diff nobody reads closely. The gate validates a **real** artifact — a committed
fixture or the output of the production builder — then asserts a malformed instance is rejected and
an unknown key is rejected. So "the receipt does not support extension" is not a convention here;
it is a measured, enforced property.

**Consequence for a Trajectory design.** Any design that wants to carry a new field on an existing
receipt has exactly two legal moves: change the schema (which for the stable schemas requires an
ADR, per the repository contract) or carry the field somewhere else. There is no third path where a
consumer tolerates an unknown key — the gate would red. That is worth knowing *before* a design
assumes additive extension is cheap.

## Q5 — is there canonical serialization?

**`PARTIAL`,** and the partiality is precise enough to state exactly.

What exists, at [packages/fingerprint/src/hashJson.ts:31-45](../../packages/fingerprint/src/hashJson.ts#L31-L45):

```
stableStringify(value)  →  JSON.stringify(sortValue(value))
sortValue               →  recursively sorts object keys; maps arrays element-wise; returns scalars as-is
hashJson(value)         →  sha256(stableStringify(value))
```

So **key ordering is canonical, recursively, and array order is preserved** (arrays are ordered
data, not sets — `sortValue` maps rather than sorts them, which is correct and worth noting because
a reader might expect otherwise).

What is *not* canonicalized, because `JSON.stringify` decides it:

| Aspect | Behaviour | Why it matters |
| --- | --- | --- |
| Number formatting | JS number→string (`1e21`, `-0` → `0`) | Two inputs that differ only in numeric encoding hash the same; two that a different language would encode differently would hash differently |
| Unicode | No normalization form applied | NFC and NFD forms of the same string are different digests |
| `undefined` / functions | Dropped by `JSON.stringify` | A field set to `undefined` and an absent field are indistinguishable |
| Absent vs `null` | Distinguished (`null` serializes) | Asymmetric with the row above |

None of these is a defect: within one Node process hashing its own objects, `stableStringify` is
sufficient and is used consistently. It becomes a question only if a trajectory digest must be
reproduced by a *different* implementation — at which point "canonical serialization" would need
to mean RFC 8785 / JCS, and the repo does not have that.

There are two byte-level digest functions beside it, and the reason is recorded in the source:
`sha256` passes `"utf8"` to `update`, which is **"correct for text and silently wrong for binary"**
([hashJson.ts:11-16](../../packages/fingerprint/src/hashJson.ts#L11-L16)), so `sha256Bytes` exists
for artifacts. They agree on their overlap, which a test asserts. A trajectory design hashing
anything that is not text must use the byte form.

## The 30 schemas

Grouped by what they describe, since the flat list is not informative on its own:

| Group | Files | Note |
| --- | --- | --- |
| Decision + receipt | `decision`, `decision-receipt`, `receipt`, `action`, `authority-manifest`, `artifact-identity`, `install-plan`, `flow` | The implemented request/decision path of [01](01-current-guard-semantics.md) |
| Evidence model | `evidence-bundle`, `evidence-gap`, `evidence-manifest`, `evidence-provider`, `evidence-subject` | Five schemas; evidence is a first-class plane, not a field |
| Adoption index (`calllint.*.v1`) | 12 files, `adoption-record` … `trust-lookup-index` | The v1.4 Adoption mainline — see [08](08-v1.4-adoption-conflict-map.md) |
| Interop / outbound | `sarif-schema-2.1.0`, `telemetry-event`, `registry-listing`, `agent-inbox-event` | `sarif` is vendored upstream |

**No schema describes a guard request or a guard decision.** Confirmed by name over the full list.
This is the schema-side restatement of [01](01-current-guard-semantics.md)'s finding.

## What this chapter does not claim

- Whether the four "stable" schemas named in the repository contract are the four this list would
  guess. `docs/new16-new17-integration.md:404` refers to them by category only, and no committed
  file enumerates them. `schema:compat` covers all **30**. Chapter [08](08-v1.4-adoption-conflict-map.md)
  records the four inferred from the digest chain and labels the inference as inference.
- No judgement on whether `additionalProperties: false` is the right default. It is measured as
  the default and as gated; whether a trajectory field justifies an ADR is a T1 question.
