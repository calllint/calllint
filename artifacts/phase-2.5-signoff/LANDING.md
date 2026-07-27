# Phase 2.5 — Landing checklist (Aug-1 window)

> **Post-land update (2026-07-27): this runbook is complete.** It was executed ahead of the
> Aug-1 window — the repo is public, so GitHub Actions runners are free and no quota hold
> applied. B→C→D→E landed on `main` in the order below via PRs #222–#225 (tip `d4c7acc`),
> and `pnpm audit:self-claim` re-run on `main` confirmed 3/3. **Phase 2.6 (Sentinel →
> Search → Hook) subsequently shipped** via PRs #226–#228 (tip `95587aa`). The checklist
> below is retained as the historical runbook.

The Phase 2.5 stack is built and `ci:local`-green locally. Remote landing is deferred to
the Aug-1 quota-refresh window. This is the exact, ordered runbook. **Do not** front-run
the order — ADR 0055 §7 fixes A→B→C→D→E, and the merge order below preserves it.

## Preconditions
- Quota window open (Aug-1 refresh).
- **Merge #222 first** if still open (per the prior deferral note), before this stack.
- `gh` authenticated; `build-and-test` is the required check on each PR.

## Stack (local, linear off `main`)
```
main → bd73514 (B) → c045492 (C) → db651bb (D) → <E commit> (E signoff)
```

## Landing order (one PR per sub-phase, squash-merged, gated on build-and-test)

1. **B — trust events** (`feat/phase-2.5-b-trust-events`, already on origin at `bd73514`)
   - `git push -u origin feat/phase-2.5-b-trust-events` (already pushed; re-push if rebased)
   - `gh pr create --body-file /tmp/pr-b.md` → wait `build-and-test` → `gh pr merge --squash --delete-branch`
2. **C — /trust lookup** (`feat/phase-2.5-c-trust-lookup`, rebased onto B → `c045492`)
   - Because C was rebased, push with lease: `git push --force-with-lease -u origin feat/phase-2.5-c-trust-lookup`
   - PR base = `main` (after B merges) → wait green → squash-merge
3. **D — publisher copy** (`feat/phase-2.5-d-publisher-copy` → `db651bb`)
   - `git push -u origin feat/phase-2.5-d-publisher-copy` → PR → wait green → squash-merge
4. **E — signoff** (`feat/phase-2.5-e-signoff`, this branch)
   - `git push -u origin feat/phase-2.5-e-signoff` → PR → wait green → squash-merge

## After E lands green on `main`
- Phase 2.5 is operationally signed off → **Phase 2.6 unblocks** (Sentinel → Search → Hook,
  ADR 0055 §3/§4; the four other tools stay deferred per §6).
- Re-run `pnpm audit:self-claim` on `main` to confirm 3/3 still holds post-merge.

## Guardrails during landing (unchanged)
- No direct push to `main`; feature branch → PR → squash only.
- Squash-merge only with explicit human authorization in the landing task.
- Do not widen `.claude/settings.json`; do not publish to npm.
- `deploy-web` is path-filtered to `apps/web/**`: **C and D touch `apps/web/public/trust/**`,
  so their merges to `main` WILL trigger a web deploy** — expected (served pages change). B
  also touches `apps/web/**` (CF function + shim, shipping dark). E (artifacts-only) will
  not. Confirm each deploy is intended before merging.
