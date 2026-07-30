# ADR 0059 — Install capsule first impression: richer authority surface, reason-code inventory, and a copy-only assist

- Status: Accepted (2026-07-30). Authorizes raising the Human Install capsule's
  authority-fact display cap, surfacing sealed reason codes on the page, rewriting
  acquisition CTA chrome for fewer cold-start steps, and allowing a **whitelist**
  external script whose only job is clipboard copy. Changes **no** verdict path and
  **no** decision-plane input.
- Date: 2026-07-30
- Refines: 0056 (safe-install acquisition projection — this ADR widens what the
  Human Capsule *shows* of an already-selected projection), 0058 (presentation
  control plane — layout caps and L1/L2 copy move under the same plane rules),
  0057 (adoption deep link — command-primary cold start stays primary; deep link
  stays secondary but visually louder)
- Related: 0020 (reason-code vocabulary — the inventory this page now projects)

## Context

Pilot reading of the `/install/**` surface found two first-impression failures that
are not verdict bugs:

1. **Authority inventory looked empty of value.** Most registry remotes share one
   observed consequence (`network_egress`) plus one absence row, so the capsule
   read as a two-line template. The engine still ran its detectors; the page was
   compressing to ≤3 facts by design (new14 §7 / Phase 2.4-B structural gate).
2. **Cold-start adoption still felt like documentation choreography.** The honest
   path is “copy a pinned `npx … --apply` command, paste, type `yes`”. That path
   was present but visually secondary to a brand CTA that only scrolled to the
   command. Visitors who already registered `calllint://` had a quiet text link.

A third request — a tiny one-click **Copy** control — collides with ADR 0056 §7 /
Gate 2.4-B's `no-decision-javascript` check, which refused **any** `<script>`.

## Decision

### 1. Raise the shipped authority-fact display cap from 3 to 5

`SHIPPED_LAYOUT_CAPS.maxAuthorityFacts` becomes **5**. Configuration may still only
**narrow** the cap (ADR 0058 §3); it may never raise it above the shipped constant.

`selectDecisionAuthorities` fills up to five rows: observed authorities first (priority
order), then evidence-supported absences when `completeness === "complete"`, still
never wording absence as “impossible”.

The sealed contract's `authorityDelta` is unchanged in meaning: `adds` remain the
full observed set; `notObserved` remains the full complete-inventory complement.
Display selection is a projection of that evidence, not a second authority model.

### 2. Surface sealed reason codes on the Install page

The Agent Adoption Contract already carries
`publicObservation.reasonCodes` (ADR 0020 projection of findings). The Human
Install page now renders that list (human labels from `REASON_CODE_META`) under
the authority inventory so a visitor can see **what the scan hit**, not only the
compressed consequence vocabulary. This is read-only projection of sealed bytes;
it cannot invent a code the contract does not carry.

### 3. Command-card primary path + louder deep link + colloquial CTA chrome

- Primary visual path for adoptable states: a **command card** (“Copy and run in
  your terminal”) carrying the pinned `npx calllint@… safe-install … --apply`
  command, with a short three-step note (copy → paste → type `yes`).
- The single `data-primary-action` / `.install-cta` control remains exactly one
  (Gate 2.4-B) and still names its target; its job is to land on that command card.
- `calllint://` stays secondary (ADR 0057 — cold start must not depend on a dead
  protocol) but is styled as a clear alternative for visitors who already have
  CallLint registered.

### 4. Allow a whitelist copy-only script; forbid everything else

Gate 2.4-B's JavaScript check becomes:

- **Allowed:** exactly `<script src="/scripts/install-copy.js" defer></script>`
  with an empty body (served from the committed static tree).
- **Forbidden:** any other `src`, any inline script body, any `on*` attribute.

The script may only read a `data-copy-from` target and call
`navigator.clipboard.writeText` (with `document.execCommand('copy')` fallback). It
must not fetch, must not navigate, must not read the contract, and must not
influence installability. CSS still cannot decide; this script still cannot decide —
it only copies bytes the page already printed.

## Consequences

- Presentation schema / `presentation.v1.json` / Phase 2.4-B structural ids update
  (`at-most-five-authority-facts`; JS check renamed to reflect the whitelist).
- Served `/install/**` bytes and `tokens.css` change; human five-second panel
  responses must be re-recorded against the new digests.
- ADR 0056 §7's *intent* (“JS never decides”) holds; the literal “no `<script>`
  substring” rule is deliberately replaced by the whitelist above.
