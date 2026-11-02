# ADR 0101: ACH name boundaries and scheduled ingest validation

Status: Accepted
Date: 2026-11-02

## Context

Scheduled `trust-ingest` runs 40326005245 and 41311023595 failed before opening
a PR. At 500 records, the latter reported 18 failed tests in four files:

- `@achromat-ai/mcp-server` matched the `ach` fragment in `financialAction.ts`.
  Evidence refinement made the false financial inference a high-severity REVIEW,
  correctly stopped by the existing Gate-B publication gate.
- Gate S2 tests assumed the current cohort was below 500. Their report-store
  override isolated compiler reports but still read the growing production census.
- The self-claim lifecycle test required a new observation's artifact digest to
  equal a historical claim's observed digest after the upstream artifact changed.

Usage run 41203355002 failed on `301` plus `x-calllint-report: absent` immediately
after deployment. On 2026-11-02 the same immutable deployment URL,
`https://f467ad69.calllint-usage-report.pages.dev/`, returned `301` plus `present`.
Absence was temporary; the old observation cannot establish whether the asset
lookup returned a non-200 status or threw. The entry collapsed both into `absent`
and allowed that negative response to be cached for an hour.

## Decisions

1. Interpret ACH as a delimited acronym, including snake case and camel case,
   rather than arbitrary letters inside unrelated words. Retain every financial
   hint, severity, observed payment blocker, and all golden expectations. Other
   financial hints keep their existing matching. Paired package/tool fixtures
   cover real ACH names and unrelated names. This corrects the name heuristic;
   it does not exempt a publisher or allow a held page through the publication gate.
2. Isolate the two census reads in the S2 child-process test harness to a retained
   sub-threshold subset, while executing the real gate with the real sidecars.
   Production gains no bypass or threshold override. Current-census assertions
   recognize `threshold reached`; the dated creation census remains unchanged.
3. Assert a fresh lifecycle against the current artifact and the committed overlay
   against the committed historical claim. Do not rewrite claim history to pass a
   test. Claims still never affect verdicts or page digests.
4. Supersede ADR 0092's assumption that `301+absent` cannot be transient. Retry
   that observation on the immutable deployment URL within the existing finite
   window, reading the header again each time. Persistent absence still fails;
   only `301+present` passes. HTTP 200, missing headers, and unknown responses
   still fail immediately. Never cache a negative asset observation. Public
   host gating and the report's confidentiality requirements are unchanged.

## Validation

Regression tests must fail on the old detector and usage probe. Exercise a
500-record candidate offline, including an updated CallLint artifact and the
Achromat record, through the bake, derived writers, and deterministic preflight.
Run the Node 20.20.2 repository gates. No scanned server is executed, installed,
or contacted; registry metadata reads are ingestion-plane observations only.

Remote scheduling, deployment, publication, and human Gate-B sign-off remain
separate acceptance boundaries; local checks do not imply those actions occurred.
