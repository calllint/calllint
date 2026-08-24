# ADR 0001 — Add one distribution state, not new20 §4's six

- **Date:** 2026-08-23
- **Status:** Accepted
- **Scope:** `apps/web/data/distribution-surfaces.json` and its schema; the 29 projections
  generated from it; `scripts/check-harness-distribution.mjs` (HD-05)

## Context

new20 §4 asks for a `surfaceStatus` field with six values covering the lifecycle of a
distribution channel. The same document's §3, and §4's own closing line, forbid introducing
new databases or additional lifecycle systems.

Those two instructions conflict only if §4 is read as *a new field*. Read as *a required
capability*, they do not: the SSOT already carried a state enum on exactly the same
semantic axis — can CallLint be discovered on this shelf — with four members
(`AVAILABLE`, `AUDIT_REQUIRED`, `READY_NOT_SUBMITTED`, `PENDING_UPSTREAM`).

The concrete defect that prompted the work was narrower than a missing lifecycle. Four
channels carried a `blocker` while recorded as `READY_NOT_SUBMITTED` or `AUDIT_REQUIRED`.
The projections print those as "Not yet submitted" and "Listing not yet verified" — both
read as *pending work* — directly beside a blocker saying the channel is impossible or was
explicitly declined. The blocker text did reach the host pages, so a human reading a whole
row got the truth; but `state` is the field machines consume, and
`agent-discovery-index.json` did not carry `blocker` at all. The single missing concept was
"this channel is closed", not six gradations of openness.

## Decision

Add exactly one enum member, `BLOCKED`, and make the contradiction unrepresentable:

1. `BLOCKED` added to `definitions.primitive.properties.state.enum` and to
   `PUBLIC_STATE_LABELS` (public label: "Not available here").
2. The four contradictory channels reclassified to `BLOCKED`.
3. `blocker` projected into `agent-discovery-index.json` and declared in its published
   schema — that consumer is the one that cannot ask a follow-up question, and it was the
   one told least.
4. **HD-05** enforces agreement in both directions: a channel with a `blocker` must be
   `BLOCKED`, and a `BLOCKED` channel must record a `blocker`.

No new field, no second lifecycle, no new database.

Both directions of HD-05 are load-bearing. `blocker ⇒ BLOCKED` stops a known-impossible
channel from reading as pending. `BLOCKED ⇒ blocker` stops `BLOCKED` from becoming a
verdict with no recorded reason — the same evidence-free claim pointed the other way, which
is the thing the verdict vocabulary exists to prevent.

## Consequences

- `READY_NOT_SUBMITTED` now has zero records. It remains a legal enum member: it is a
  reachable state for a channel whose materials are ready and whose submission has not been
  made, which is the state most of the nine actionable rows will pass through.
- The state vocabulary stays internal and is never printed to humans (§20). Both leak guards
  now derive it from `definitions.primitive.properties.state.enum` rather than hardcoding a
  list. This was the real structural fix: a hand-copied allowlist cannot fail loudly when
  the enum grows — it can only under-report. Verified by injecting an enum member the guards
  had never seen and seeding it into both protected planes; both went red.
- Five of the six values §4 named are not represented, and if a future channel genuinely
  needs one, this ADR is the thing to revisit. The claim here is not that four-plus-one is
  the complete vocabulary — it is that adding unpopulated states would have created a
  lifecycle no record exercised, which §3 forbids and which no guard could validate.

## Alternatives rejected

**Implement §4 literally.** Six values, four of them with no records and no consumer. An
enum member no record uses cannot be checked by any guard, so it is documentation wearing a
schema's clothes — and it would have been the second lifecycle §3 rules out.

**Leave the blockers as prose on host pages.** This was the status quo. It is honest to a
human who reads the whole row and silently misleading to everything else, which is the
larger audience.

**Drop `blocker` and encode the reason in the state name.** Four states would become a
dozen (`BLOCKED_UPSTREAM_POLICY`, `BLOCKED_OUR_DECISION`, …), pushing free-form reasons into
an enum. The reason is prose; it belongs in a prose field. Keeping them separate is also
what lets HD-05 check one against the other.
