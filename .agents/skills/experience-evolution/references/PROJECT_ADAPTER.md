# Experience Evolution: CallLint adapter

This is an advisory index for the v1.0 repository pilot, not a security policy,
status ledger, verdict source, release gate, or automatic CI integration.
Resolve paths below from the CallLint repository root. Current instructions,
code, tests and explicit user authorization take precedence.

## Authority and scope

- `CLAUDE.md`: deterministic verdicts, static non-execution, evidence requirements,
  unchanged golden expectations, ADR boundaries and the pinned local toolchain.
- `AGENTS.md`: detector/fixture discipline, quality gates, release and governance.
- `README.md`: current product boundary and visible limitations.
- `CONTRIBUTING.md` and `SECURITY.md`: redaction, provenance and responsible reports.
- `adrs/0034-evidence-provider-envelope.md`: evidence is not a decision; incomplete
  or clean provider evidence cannot clear CallLint authority findings.
- `adrs/0035-automated-trust-gateway-authority-manifest.md`: fixed authority
  vocabulary, digest binding, pure normalization and fail-closed unknowns.

`PROJECT_STATUS.md` is absent at pilot baseline `abbc6f42c56dc49155883870171789c79b8025b2`.
Do not fabricate it or substitute an artifact for project authority. The original
checkout also has ignored, local-only `docs/` material that is absent from this
verified Git tree. Do not copy it or rely on it as a portable adapter dependency;
use the tracked contracts and ADRs above.

No LLM may enter the verdict path. Never execute, install or connect to a scanned
MCP server. UNKNOWN is not SAFE. Do not lower detector sensitivity, change golden
or corpus expectations to hide failures, or revise the established risk model.
Schema-breaking or risk-model changes require the repository's ADR process.

## Existing evidence owners

- `packages/static-analyzer/src/detectors/broadFilesystemPath.ts` and
  `packages/static-analyzer/test/detectors.test.ts`: broad filesystem arguments,
  Docker host-source extraction and paired workspace/named-volume controls.
- `packages/static-analyzer/src/instructionAuthority.ts` and
  `packages/static-analyzer/test/instructionAuthority.test.ts`: deterministic
  instruction capability extraction; capability inventory is not a verdict.
- `packages/core/src/gateway/authority.ts` and
  `packages/core/test/gateway-authority.test.ts`: manifest completeness, unknowns,
  digest verification and failure-state preservation.
- `packages/fixtures/golden/`: existing positive/negative safety floor, including
  `block-windows-user-profile.json` and `safe-windows-workspace.json`.
- `packages/fixtures/corpus/README.md`, `packages/fixtures/corpus/index.json` and
  `packages/fixtures/corpus/cases/`: provenance, execution restrictions and fixed
  verdict/finding contracts. C055-C060 cover Docker bind and named-volume forms.
- `packages/fixtures/bench/README.md` and `packages/fixtures/bench/cases/`: B01-B04
  distinguish clean content from elevated authority and partial evidence.
- `scripts/run-corpus.mjs`, `scripts/run-bench.mjs`, `apps/cli/src/index.ts` and
  `vitest.config.ts`: use the actual built CLI and existing test harness.

## Bounded experiment protocol

1. Record the exact revision, dirty state, Node/pnpm versions and raw receipts.
   Follow `CLAUDE.md` for Node 20.20.2; do not trust a stale PATH example.
2. Select saved cases before observing new results; predeclare sample count,
   negative controls and holdout. Compare identical inputs and generated-at time.
3. Classify the failing layer: input/argument parsing, detector, evidence
   completeness, authority normalization, deterministic policy, or test harness.
   Require a discriminating reproduction before proposing a repair.
4. Prefer the narrowest existing parser/detector fix that preserves the risk
   model. Each proposed rule needs positive and negative fixtures and a unit
   test. Preserve raw evidence, impact and fix; never relabel a miss as SAFE.
5. During this installation-only pilot, leave production detectors, policy,
   schemas and fixture expectations unchanged. Any repair simulation belongs
   outside the worktree and must be labeled diagnostic, not implemented.
6. Reuse existing passing cases. Retry a failed route only after a named premise
   changes. Distinguish content-clean/authority-risk disagreement from a false
   positive, and partial-provider evidence from permission to proceed.
7. Run the required gates from `AGENTS.md`: `pnpm typecheck`, `pnpm test`,
   `pnpm build`, `pnpm corpus:test`, `pnpm corpus:test:r2-final`; add
   `pnpm bench:test` for the authority comparison. Read failures, not only exits.
8. Report before/after behavior, negative/holdout results, incremental commands
   and wall time. Small samples and a single unblinded operator do not establish
   causal workflow improvement: label that claim INCONCLUSIVE. Installing the
   Skill alone does not improve scanner verdicts or make CI execute the Skill.

Attach reusable lessons to the existing affected test/fixture or approved task
receipt, not a parallel project tracker. Keep private traces and unreported
security reproducers out of public commits. Expire a lesson when its revision,
parser assumptions or counterexample no longer holds. This pilot authorizes
neither release publication, PR merge, deployment nor actual security-policy edits.
