# Submission packages

What a human needs in front of them to list CallLint on a shelf, and nothing more.

Every submission here is a **human action**. new18 §22 makes the distribution watcher
read-only toward the outside world: GET only, no credentials, no form posts, no external PR
or issue creation, no maintainer contact. An agent may prepare these packages and verify
what a shelf already says; it may not submit them.

## Why this directory exists

The materials were ready for months and the checklist that named them lived in
`docs/MARKETPLACE-SUBMISSION-TRACKER.md`, which `.gitignore:44` excludes along with the
whole `docs/` tree. So the ROI ordering, the recorded blockers, and the per-shelf material
lists were real work that was never in version control: invisible in review, absent from a
fresh clone, and lost on any machine but one. This directory is tracked.

## The two cost classes, which must not be conflated

The SSOT holds 31 channels. They divide by what a human actually has to do:

| Class | Count | Cost | Who |
|---|---|---|---|
| **Verify-only** (`mcp-stdio`) | 17 | Read-only confirmation that the host consumes the Official MCP Registry. The registry entry is **already live** — nothing is submitted. | Agent-safe (GET only) |
| **Shelf action** (a distinct listing surface) | 14 | An actual submission to a separate marketplace. | **Human only** |

A host documenting stdio MCP support is **not** the same fact as that host consuming the
Official MCP Registry. That distinction is why `mcp-stdio` channels sit at
`AUDIT_REQUIRED` rather than `AVAILABLE`: the claim is unverified, not the support absent.

## Of the 14 shelf actions

- **4 are `BLOCKED`** — a recorded blocker makes them impossible or explicitly rejected.
  They are not a to-do and have no package here. See [`BLOCKED.md`](BLOCKED.md).
- **1 is `PENDING_UPSTREAM`** — `cline` has an open PR; a second would be a duplicate.
- **9 are actionable**, ordered by ROI in [`ROI.md`](ROI.md).

## Layout

```
artifacts/submissions/
├── README.md          # this file
├── MATERIALS.md        # the shared package: identity, copy, assets. Cite, don't retype.
├── ROI.md              # what to do next, and why in that order
├── BLOCKED.md          # what NOT to attempt, with the reason
└── <platform>/         # one directory per shelf that takes a submission
    └── SUBMISSION.md   # where to go, what to paste, how to record the outcome
```

Six directories, not nine. Three of the nine actionable rows take no submission package:
`mcp-registry-discovery` is verify-only, `kiro-workspace-config` is engineering work, and
`qwen-extension-conversion` converts an artifact that must land upstream first. [`ROI.md`](ROI.md)
says which is which.

## Recording an outcome

Edit **only** the SSOT, then regenerate. Never hand-edit a projection — there are 29 of
them and `check:distribution-drift` compares every one byte-for-byte.

```bash
# 1. edit apps/web/data/distribution-surfaces.json  (state, and liveUrl if it went live)
node scripts/generate-distribution-surfaces.mjs   # rewrites all 29 projections
pnpm check:distribution-drift                     # must report 29/29
pnpm check:harness-distribution                   # HD-05: blocker <=> BLOCKED
```

The state vocabulary is internal and never printed to users (§20); its single source of
truth is `definitions.primitive.properties.state.enum` in
`apps/web/data/distribution-surfaces.schema.json`. Read it there rather than copying it
here — a hand-copied enum cannot fail loudly when the enum grows.
