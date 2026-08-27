# ADR 0007: A Reproducible Local Act Can Serve as Public Evidence — Under Four Conditions

**Status:** Decided (2026-08-27)
**Context:** D-1 — `claude-code` / `claude-plugin` has been submitted and verified, and cannot
reach `AVAILABLE` because neither HD-07 arm can represent the evidence that exists.
**Decides:** A third evidence class, `localReproducibleInstall`, and the order in which it lands.

---

## Context

`claude-plugin` is the only channel whose install has been *observed end to end*, and the only
one that cannot be marked `AVAILABLE`. That inversion is the problem this ADR closes.

`scripts/probe-claude-plugin-install.mjs` reproduces all four steps on `claude` 2.1.195:
marketplace add → appears in `marketplace list` → `plugin install` → `plugin list` reports
**enabled**. It was built around one finding that governs its design: **`claude plugin` exits 0
on failure**, so no step may be judged on exit code. Every step is judged on output, and success
is asserted *positively* — the `✔` marker must be present — because empty output satisfies any
negative test.

Meanwhile the channel sits at `AUDIT_REQUIRED`, and both existing HD-07 arms
(`scripts/check-harness-distribution.mjs:389-489`) are **structurally unreachable** for it:

- `upstream: officialMcpRegistry` is the wrong subject. That arm attests our *MCP server*; this
  channel ships a *plugin*. Pointing it here would make the gate green by describing a
  different artifact.
- `liveUrl` has no shelf to point at. Claude Code distribution is "users add this repo as a
  marketplace" — there is no gallery page. The only URL available is our own README, which is
  exactly the self-endorsement defect found in `cursor-plugin` on 2026-08-23 and the reason
  HD-07 exists.

So the state is honest but the *reason* it is honest is a schema limitation, not a missing act.
`definitions.primitive` is `additionalProperties: false`; the evidence is not representable.

## Decision

**A locally reproducible install may serve as evidence for a public `AVAILABLE` claim, if and
only if all four conditions hold:**

1. **A committed probe script**, runnable by a third party, not a transcript of a past run.
2. **Positive assertion.** Success is proven by the presence of an expected marker. A probe that
   concludes from a non-error is not evidence — see the exit-0-on-failure finding above.
3. **A recorded subject version.** The probe names the host binary and version it observed
   (`claude` 2.1.195). An install verified against an unnamed version cannot be re-run.
4. **The absence of a shelf is a stated fact, not an omission.** The projections must say the
   channel has no gallery page, so a consumer never reads a missing `liveUrl` as an oversight.

Condition 4 is what keeps this from becoming a loophole. The claim being made is not "a shelf
lists us"; it is "the documented install path works, and here is the script that shows it." Those
are different claims, and the projections must not blur them.

### What this deliberately does not license

- It does **not** apply to a channel that *has* a shelf. Where a `liveUrl` can exist, its absence
  is a missing submission, and this arm must not paper over it.
- It does **not** accept a probe that runs only in this repo's CI on a preinstalled host.
- It does **not** apply to `PENDING_UPSTREAM`. A third party's queue is not observable locally,
  and a local success says nothing about their decision.

## Consequences

`AVAILABLE` changes meaning for every consumer of the 31 generated projections: it becomes
"reachable by a documented, verified install path," not "listed on a third-party shelf." That is
the reason this ADR precedes the change rather than explaining it afterward.

The mitigation is that the distinction stays *machine-readable*: the evidence class is a schema
field, so a consumer can filter on it. A reader who only accepts shelf listings can still do so.

## Implementation order (each step is unsafe before the one above it)

1. **This ADR.** ✅
2. **Schema field** — `evidence: { class: "localReproducibleInstall", probe, hostVersion, noShelf: true }`
   on `definitions.primitive`, which is `additionalProperties: false` today.
3. **HD-07 third arm** — accepts `AVAILABLE` when the evidence class is present *and* the named
   probe file exists. The arm must red if the probe is deleted, or it is a guard blind to its
   subject.
4. **SSOT flip** — `claude-plugin` → `AVAILABLE`, regenerating all 31 projections.

Reversing 3 and 4 flips the state while the gate still rejects it. Reversing 2 and 3 writes a
field nothing reads — the defect recorded in
[[config-flag-was-published-for-months-unread]].

## Alternatives rejected

- **Leave it `AUDIT_REQUIRED` forever.** Makes the most-verified channel indistinguishable from
  seven never-attempted ones. `AUDIT_REQUIRED` would come to mean "we did not check" and "we
  checked hardest," which destroys the state's information content.
- **Point `liveUrl` at the README anchor.** The 2026-08-23 defect, by name.
- **Widen the `officialMcpRegistry` arm.** Attests the wrong artifact; makes the gate lie about
  *which thing* is distributed.
