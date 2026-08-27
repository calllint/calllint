# ADR 0008: De-listing Stays Unreachable Until an Authority Model Binds It

**Status:** Decided (2026-08-27)
**Context:** J2 / `NEW19-21_OPEN_ITEMS` §1.5 — the withdrawal mechanism ships; no caller exists.
**Decides:** The gap stays open **by decision**, and the four conditions that would close it.

---

## Context

R-11 landed `planWithdrawal`, `applyWithdrawal`, and `tx.setSubjectLifecycle`. A subject can be
withdrawn. Nothing can ask for it: no CLI command, no MCP tool, no HTTP route.

`tests/invariants/open-judgements.invariants.test.ts` pins this in **both** directions, and the
second direction is the one that matters. It asserts the mechanism is present — because deleting
it would make "surface withheld" true for the wrong reason and turn the test green while the gap
silently reverted to "no mechanism at all." Then it asserts that no file under
`packages/calllint-mcp/src` or `apps/cli/src` *invokes* any of the three symbols, over a file set
it first proves non-empty, with comments stripped so a note explaining the gap cannot read as the
gap having closed.

`J2b` pins the irreversible half separately: the transition table must still permit
`WITHDRAWN → TOMBSTONED`, while `planWithdrawal` — the automatic planner — must contain
`to: "WITHDRAWN"` and must not name `TOMBSTONED` in executable code. The enforcement point is
the planner, not `applyWithdrawal`, which writes whatever `entry.to` it is handed and has no
opinion about which status that is.

## Decision

**The surface stays withheld.** This is not a backlog item; it is the same rule as the product's
own: a de-listing is a claim-facing authority decision, and exposing it before an authority model
exists is structurally identical to shipping a verdict with no evidence — the thing CallLint
exists to refuse.

Concretely: a caller reachable by an autonomous agent, invoking an operation that removes a
subject's public claim, with no model of who is permitted to ask, is an **irreversible operation
reachable without authority**. The absence of the caller *is* the control.

### The four conditions that would close it

All four, or the surface stays closed:

1. **An authority model that names the decider.** new21's five-layer model is the intended
   vehicle; three layers already ship. What is missing is not vocabulary but a binding from
   *layer* to *who may withdraw this subject*.
2. **Authorization proven at the operation, not the surface.** The check belongs where
   `planWithdrawal` is called into, so a second surface added later cannot bypass it. A check in
   a CLI command is a check one new caller can route around.
3. **A negative control.** A test that proves an *unauthorized* caller is refused. Per this
   repo's dominant fault class, a guard that has never been observed failing is not a guard.
4. **`TOMBSTONED` stays off the automatic path** regardless. Nothing in this ADR licenses an
   automatic tombstone; `J2b` continues to hold after the other three are satisfied.

### What is explicitly not licensed

- A read-only "would this be withdrawn?" preview is **also** withheld. It leaks the same
  claim-facing judgement without the authority model, and it is the natural first step toward
  a caller.
- No exemption for an operator-only path. "Only we can reach it" is a deployment fact, not an
  authorization mechanism, and it is not machine-checkable.

## Consequences

The published state stays *inconsistent in the honest direction*: a subject can be withdrawn only
by someone with direct write access, which means de-listing is slower than listing. That asymmetry
is accepted. The alternative asymmetry — fast, agent-reachable de-listing with no authority model
— removes someone else's public claim, and that error is not recoverable by the party harmed.

## Alternatives rejected

- **Ship the CLI command now, gate it behind a confirmation prompt.** A prompt is a UX control,
  not an authority control; `--yes` exists on every CLI eventually, and a non-interactive caller
  bypasses it by construction.
- **Delete the mechanism until the model is ready.** Loses R-11's measured work and, worse, makes
  the invariant test green for the wrong reason — the exact failure J2's first direction exists
  to catch.
- **Expose it as an MCP tool with a policy check.** Policy decides verdicts about *scanned
  subjects*; it has no vocabulary for *who is asking*. Reusing it here would overload a mechanism
  past what it measures.
