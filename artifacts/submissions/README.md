# Submission packages

What a human needs in front of them to list CallLint on a shelf, and nothing more.

Every submission here is a **human action**. new18 §87 (`NO CONTINUOUS EXTERNAL SPAM`) bars the
weekly **watcher** from opening an external PR or issue, submitting a form, emailing or tagging a
maintainer, requesting a reviewer, or retrying a rejected contribution. An agent may prepare these
packages and verify what a shelf already says; the automated watcher may not submit them.

Note the scope: §87 binds the watcher, not the repository. §89 sets
`MAX_NEW_EXTERNAL_SUBMISSIONS = 3` and §90 lists the eight conditions under which one bounded
external write is permitted. These rows stay human because each needs a browser session, an
account, or an install this machine does not have.

## Why this directory exists

The materials were ready for months and the checklist that named them lived in
`docs/MARKETPLACE-SUBMISSION-TRACKER.md`, which `.gitignore:44` excludes along with the
whole `docs/` tree. So the ROI ordering, the recorded blockers, and the per-shelf material
lists were real work that was never in version control: invisible in review, absent from a
fresh clone, and lost on any machine but one. This directory is tracked.

## The two cost classes, which must not be conflated

Channels divide by what a human actually has to do:

| Class | Cost | Who |
|---|---|---|
| **Verify-only** (`mcp-stdio`) | Read-only confirmation that the host consumes the Official MCP Registry. The registry entry is **already live** — nothing is submitted. | Agent-safe (GET only) |
| **Shelf action** (a distinct listing surface) | An actual submission to a separate marketplace. | **Human only** |

**The counts live in [`CHANNEL-COUNTS.md`](CHANNEL-COUNTS.md)**, which is generated from the
SSOT. They are deliberately not repeated here: every count in this directory used to be
hand-typed, and a hand-typed count cannot fail when a channel is added — it just quietly
under-reports the work left, since nobody revisits a paragraph when appending a row.

A host documenting stdio MCP support is **not** the same fact as that host consuming the
Official MCP Registry. That distinction is why `mcp-stdio` channels sit at
`AUDIT_REQUIRED` rather than `AVAILABLE`: the claim is unverified, not the support absent.

## Of the shelf actions

[`CHANNEL-COUNTS.md`](CHANNEL-COUNTS.md) partitions them and lists each row by host and
channel:

- **`BLOCKED`** — a recorded blocker makes them impossible or explicitly rejected.
  They are not a to-do and have no package here. See [`BLOCKED.md`](BLOCKED.md).
- **`PENDING_UPSTREAM`** — `cline` has an open PR; a second would be a duplicate.
- **actionable** — ordered by ROI in [`ROI.md`](ROI.md).

## Layout

```
artifacts/submissions/
├── README.md          # this file
├── MATERIALS.md        # the shared package: identity, copy, assets. Cite, don't retype.
├── HUMAN-STEPS.md      # the numbered steps only a human can take, with every agent-safe
│                       #   pre-flight already run and its result recorded
├── ROI.md              # what to do next, and why in that order
├── BLOCKED.md          # what NOT to attempt, with the reason
└── <platform>/         # one directory per shelf that takes a submission
    └── SUBMISSION.md   # where to go, what to paste, how to record the outcome
```

One directory per shelf that actually takes a submission — which is fewer than the
actionable row count in [`CHANNEL-COUNTS.md`](CHANNEL-COUNTS.md), because three actionable
rows take no package at all: `mcp-registry-discovery` is verify-only,
`kiro-workspace-config` is engineering work, and `qwen-extension-conversion` converts an
artifact that must land upstream first. [`ROI.md`](ROI.md) says which is which.

## Recording an outcome

Edit **only** the SSOT, then regenerate. Never hand-edit a projection —
`check:distribution-drift` compares every one byte-for-byte and reports the total itself,
so the count is not repeated here either.

```bash
# 1. edit apps/web/data/distribution-surfaces.json  (state, and liveUrl if it went live)
node scripts/generate-distribution-surfaces.mjs   # rewrites every projection
pnpm check:distribution-drift                     # must report N/N, none missing
pnpm check:harness-distribution                   # HD-05: blocker <=> BLOCKED
```

The state vocabulary is internal and never printed to users (§20); its single source of
truth is `definitions.primitive.properties.state.enum` in
`apps/web/data/distribution-surfaces.schema.json`. Read it there rather than copying it
here — a hand-copied enum cannot fail loudly when the enum grows.
