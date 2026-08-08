# Non-goals — MCP 2026-07-28 readiness

Measured 2026-08-08 against `main` @ `b136f44`. A non-goal here is a thing a reader might
reasonably expect this audit to have done. Each row says what was *not* done and why, so an
omission is never mistaken for an oversight.

## Not done in M26-0, by design

| Non-goal | Why |
| --- | --- |
| Advertise 2026-07-28 | `PROTOCOL_VERSION` stays `2024-11-05` (`server.ts:13`). That is today's accurate public state. Claiming otherwise before F1-F8 pass is on new17 §19's forbidden-copy list. |
| Vendor the spec bytes | That is F8 / M26-5. M26-0 is audit-only; `third_party/` remains ABSENT (measured). |
| Write ADR 0062 | Belongs to M26-1, which is blocked by F8. M26-0 consumes no ADR number. |
| Implement `server/discover` | D4. Mandatory to implement under 2026-07-28, but adopting it before the version moves would ship a method for a protocol we do not claim. |
| Read `_meta` | D1. Same reason: the parser change and the version claim must land together. |
| Move any verdict | `computeVerdict` is the sole adjudicator and is a forbidden path for Workstream M. Measured: `git diff --stat -- packages/` is empty for this batch. |
| Change the 13-tool / 19-resource counts | Frozen surface. The INV-M8 work *gates* the resource count; it does not change it. Still 13 and 19 on the wire. |
| Add a runtime dependency | `dependencies` stays `{}`, gated at `mcp-pack-smoke.mjs:67-69`. |
| Fetch the live spec in CI | INV-M4. F1-F7's evidence is a dated manual read recorded in `finality-status.json`, explicitly labelled as not-a-gate. |

## Not goals of Workstream M at all

| Non-goal | Why |
| --- | --- |
| Support the Tasks extension | Every CallLint tool is a synchronous pure delegator (ADR 0025). There is no long-running work to model, and declining an opt-in extension is conformant. D5. |
| HTTP / Streamable transport | stdio only. The `MCP-Protocol-Version` header (D2) has no surface to apply to. Adding a transport is a product decision with its own auth and exposure questions, not a protocol-version chore. |
| Execute, import, start, connect to, or authenticate against a target | Forbidden for both M and T. Quick Scan never runs an unknown server (product principle 6). |
| Adopt 2026-07-28 as a *scanning* capability | The protocol version CallLint speaks and the protocol versions it can *scan configs for* are different questions. This audit covers only the former. |

## Deliberately named, deliberately unsolved

These are open items this batch refuses to invent an answer for. Naming them is the deliverable;
each needs a decision that has no measured basis in the repo yet.

| Item | What is missing |
| --- | --- |
| **T0 (trajectory audit)** cannot be delivered | Its home is `docs/audits/trajectory/**`, and `docs/` is gitignored (`.gitignore:44`; `git ls-files docs/` returns **0** against 152 local `.md` files). The audit could never enter a PR, CI, or another machine. Un-ignoring `docs/` conflicts with a deliberate repo convention, making it a **product decision** outside batch authorization. Note that the tracker marks T0-a/T0-c `🟢 DONE` — that is true only on the authoring machine. |
| **R-9 daily backup** | Still open from ADR 0061 §8.5: needs a destination, a window, and a credential. Out of scope here, recorded so the two open items are not confused. |
| **RG-1…RG-5** (Workstream T restart gate) | 0 of 5 today; ≥2 required. RG-2 is technical (no Host emits complete trajectory facts) and RG-5 definitional (no agreed false-block budget). Neither is closable by code in this repo. |

## Why `artifacts/` and not `docs/`

Measured contrast, and the reason M26-0 is executable while T0 is not:

```
git check-ignore -v artifacts/mcp-2026-07-28/x.json   → NOT ignored
.gitignore:44                                          docs/
```

The six artifacts in this directory are committed bytes, reachable by CI and by every other
machine. An audit that cannot be committed is not an audit; it is a local note.
