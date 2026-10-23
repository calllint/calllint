---
name: experience-evolution
description: Improve recurring agent work using verified task outcomes, negative evidence, corrections and cost-aware learning. Use for ongoing Git/CI projects, repeat failures, model/tool evaluations, and research strategy reviews. Skip trivial one-off requests.
---

# Experience Evolution — Evidence to Better Decisions (v1.0 repo pilot)

**Mission:** Finish the authorized present task while improving the next comparable decision when there is reusable evidence. The unit of learning is a falsifiable decision rule with an evidence pointer, NOT more chat history, a polished summary or an automatic fine-tune.

## Triggers

Use for recurring projects; regressions or repeated attempts; agent/model/prompt/tool evaluations; user retry/edit/undo signals; experiments; research funnels; CI feedback loops; and decisions about memory, workflows, skills, harnesses or weights. Do not add process to ordinary Q&A or one-off tasks. Users can explicitly invoke this as "use experience-evolution".

## Invariants

1. **Reality first:** Read current branch, owner contracts, tests and raw receipts. Distinguish local from remote, a documented claim from an actual run, and PASS from UNKNOWN/BLOCKED/NOT_RUN.
2. **No known-dead-end reruns:** Consult prior negative evidence. Reopen a failed path only if an assumption, environment, instrument or hypothesis materially changed.
3. **Feedback is not causality:** Edits, retries, undo and failures are observations. Label explanation VERIFIED, HYPOTHESIS or UNKNOWN. When practical, design a test that can discriminate causes.
4. **Fix the cheapest appropriate layer:** Consider context -> scoped memory -> retrieval or skill -> tool contract/workflow -> harness/evaluation -> model selection -> model weights. Do not default to prompt patches or fine-tuning.
5. **One source of truth:** Existing project status, acceptance, fixtures, test receipts and evidence owners remain authoritative. No second project ledger, competing verdict or invented release gate.
6. **Keep privacy and authority invariant:** Do not commit private user content, credentials or sensitive raw traces. Discoverability/resource idleness does NOT authorize use. Do not publish, deploy, merge, touch production, run paid calls, execute remote devices or widen permissions without applicable approval.
7. **Independently check improvements:** Compare equivalent tasks, preserve unseen/negative tests, watch regression and costs; no history rewriting or tailored-fixture-only success claims.
8. **Optimize for information per cost:** Reuse existing Git/CI/replay systems. Do not build an autonomous learning platform, duplicate tracking system or recurring job unless verified value exceeds overhead.

## Workflow

### BEFORE

- Establish exact user goal, authorized scope and current evidence-backed state; defer to repository instructions.
- Read only related prior lessons, negative results, incident cases and active owners.
- Choose the next falsifiable bottleneck and a measurable outcome. State what new evidence would justify retrying a blocked route.

### DURING

- Perform the actual authorized work, not paperwork in its place.
- Preserve traceability: input, revision, environment, action/tool, outcome and existing receipt pointer.
- Separate suggestions, simulations, static CI checks and real-world effects; never claim they are equivalent.

### AFTER (only if reusable)

Classify evidence as OBSERVED, HYPOTHESIS, VERIFIED_LEARNING or INCONCLUSIVE. Select one next treatment: REUSE, FIX, TEST, PIVOT, DEFER or STOP. These labels are advisory and never override project gate verdicts.

Attach a brief lesson to the **existing** owner artifact when it will change future decisions:

- Context / tested revision
- Observed outcome + exact evidence pointer
- Cause: verified / hypothesis / unknown
- Decision rule: under which conditions prefer or avoid which method, and why
- Changed action for the next comparable task
- Counterexample / expiration / rollback trigger
- Before/after validation on comparable evidence, plus unseen check where feasible

Without a validated change in future action there is no verified learning. Promote cross-project rules only after independent cross-case evidence; do not export raw private project data.

### REPORT

First report the task deliverable and evidence limits. If learning mattered, add one concise line: Observed -> Decision change -> Next falsifiable check, with incremental time/token/CI cost. Do not pretend a Skill is automatically executed by CI or that installing it alone produces improvement.

## Pilot evaluation

Using already-saved evidence, compare normal workflow versus skill-guided workflow on matched tasks. Track at least one main task outcome (valid evidence yield, resolution success, semantic quality or repeat-failure avoidance) and one cost/regression outcome. Predeclare sample count and holdout; small sample results remain INCONCLUSIVE, not a global victory.

## Project routing

For tasks in this repository, read [references/PROJECT_ADAPTER.md](references/PROJECT_ADAPTER.md) before selecting a learning target. It is an advisory index only: current repository authorities, active working tree and user approvals take priority. Never assume GitHub main is ahead of an owner's local worktree.
