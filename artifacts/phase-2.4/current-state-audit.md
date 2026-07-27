# Phase 2.4 Current-State Audit (PR 2.4-0 — reality binding)

**Purpose.** new14ref's execution plan §2/§27 forbids trusting any path name in the plan
until Batch 0 binds it to the current repo. This audit is that binding: it identifies each
of the nine required current-state anchors, and records the six stop-condition verdicts.
Machine-readable companion: [`current-path-bindings.json`](./current-path-bindings.json).

**Baseline (verified by code/npm/git, not memory, 2026-07-27):** `calllint@1.7.3` = npm
`latest` = `project-facts.json.stableVersion`. `main` HEAD `89a90ed` (#229), tag `v1.7.3`,
tree clean. MCP surface = **8 tools**. Reality wins over any `new14ref/` prose (integration
§1). This PR changes **no product code**.

---

## The nine required identifications (execution plan §21 Batch 0)

| # | Required anchor | Bound real path | How verified |
|---|---|---|---|
| 1 | One current baked evidence type | `packages/trust-index/src/bakeTrustPage.ts` (`BakedTrustPage`) | file present; `emitCohort.ts` consumes one object |
| 2 | One current Trust Gateway prepare service | `packages/core/src/gateway/prepare.ts` | file present; re-decides locally |
| 3 | One current apply writer | `packages/install-planner/src/applyEngine.ts` (writes via `ConfigFs`/`fsPort.ts`) | only `nodeFsPort.ts` imports `node:fs` |
| 4 | Current CLI router | `apps/cli/src/commands/**` (21 command modules incl. `trust.ts`, `integrate.ts`, `guard.ts`) | `ls` of commands dir |
| 5 | Current MCP tool registry | `packages/calllint-mcp/src/tools.ts` (8 tools, ADR 0025 pure delegators) | `pack:smoke:mcp` asserts exactly 8 |
| 6 | Current Host matrix | `packages/install-planner/src/adapters/{claudeCode,claudeDesktop,cursor,vscode,windsurf}.ts` | `ls` of adapters dir (5) |
| 7 | Current public-copy guard | `scripts/check-public-copy.mjs` (`pnpm check:public-copy`) | referenced in `package.json:36,44` |
| 8 | Current web event endpoint | `calllint.trust-event.v1` (`schemas/calllint.trust-event.v1.schema.json` + `apps/web/public/embed/trust-events.js`) | schema + client seam present |
| 9 | Current version source | `project-facts.json.stableVersion` = `1.7.3` | grep of file |

All nine anchors resolve to files that exist today. No anchor is invented.

---

## Stop-condition verdicts (execution plan §2.1)

Phase 2.4 MUST stop and file a finding if **any** condition holds. All six are **FALSE**,
so Phase 2.4 is architecturally unblocked. None was "worked around" — each was checked.

| Stop condition | Verdict | Evidence |
|---|:--:|---|
| More than one Trust Gateway writer exists | **FALSE** | Across `packages/install-planner/src/**`, only `nodeFsPort.ts` imports `node:fs`; `applyEngine.ts` writes solely through the injected `ConfigFs` port. One writer. |
| `trust apply` does not delegate to one audited apply service | **FALSE** | `applyEngine.ts` is the single audited service (revalidate → backup → atomic write → re-read + verify → rollback). |
| Page JSON and HTML are not generated from one baked object | **FALSE** | `emitCohort.ts:141-142` pushes the `.json` sidecar and `.html` page from the same `BakedTrustPage` in one loop iteration. |
| CLI and MCP maintain separate verdict semantics | **FALSE** | Every MCP tool delegates to `@calllint/core` (`tools.ts:2-22`), with "NO scoring" in the MCP layer per the ADR-0025 header. The CLI consumes the same core. |
| Current host adapters lack a stable exact-target representation | **FALSE** | Five adapters each produce an exact per-host target; there is no generic template fallback (an unsupported host is honestly unsupported, INV-2.4-08). |
| The output tree cannot host `/install/**` without a second deployment path | **FALSE** | `apps/web/public/` is one committed static tree served by one workflow (`deploy-web.yml`) to Cloudflare Pages; `apps/web/public/install/**` is one additional subtree, no new plane. |

---

## Genuinely-new files (confirmed absent today)

The five pure projection files, two schemas, the CLI orchestrator, and the `/install/**` +
`.well-known/calllint.json` outputs are all confirmed **not present** on `main` — they are
net-new, created in Batches 1–5/8 (see `genuinelyNewFiles` in the bindings JSON). This
confirms Phase 2.4 adds thin layers, not a rebuild.

---

## Conclusion

Every path new14ref names is bound to a real file (EXTEND/DELEGATE/REUSE) or is a named
net-new file with a fixed owner package (NEW). All six stop-conditions are FALSE. The ADR
boundary (`adrs/0056-safe-install-acquisition-projection.md`) is written. **PR 2.4-0 is
complete once `pnpm ci:local` is green** — it introduces no code change, so no verdict, no
served byte, and no schema moves.
