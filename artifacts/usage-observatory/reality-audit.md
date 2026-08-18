# Usage Observatory Reality Audit (U0)

## Base Context
- **Branch**: feat/usage-observatory  
- **Base Commit**: 3a0368a9f2db4657a1536d1cf44ff25425f8145c  
- **Status**: Clean working tree

## Existing Telemetry Infrastructure

### 1. Event Contract (`@calllint/telemetry-contract`)

**What exists**:
- Closed vocabulary: `ALLOWED_EVENTS` (install_completed, preflight_completed, decision_*, trust_page_*, etc.)
- Forbidden fields: `FORBIDDEN_FIELDS` (rawConfig, command, secret, fileContents, userPrompt, findingEvidenceText)
- Sources: cli, ci, server, install
- Results: SAFE, REVIEW, BLOCK, UNKNOWN
- Event version: 1.0.0

**Anonymous Installation ID**:
- Contract: `makeInstallationId(randomUuid)` → `cli-anon-{uuid}`
- NO hardware fingerprint (explicitly prohibited)
- Validation: `isValidInstallationId()`, `assertNotFingerprint()`
- Documented contract in code, but `docs/privacy/telemetry.md` does NOT exist yet

**Sanitizer**:
- `sanitizeEvent()`: allowlist-only output, throws on forbidden fields
- `bucketDuration()`: collapses ms → coarse buckets
- Structural guarantee: forbidden field can never reach output

**Status**: ✅ Complete, production-ready
**Reuse**: YES — this is the single source of truth

### 2. Emitter (`@calllint/telemetry-emit`)

**What exists**:
- `createEmitter({ source, sink?, consented?, env? })` — the wired path
- Forces every event through `sanitizeEvent()` before sink
- Three sinks:
  - `noopSink` (DEFAULT) — discards everything, no storage, no network
  - `jsonlFileSink(path)` — local JSONL append, best-effort
  - `memorySink()` — in-memory, for tests
- Gate: `shouldEmit(source, gateState)` — honors tier policy + CALLLINT_TELEMETRY kill-switch
- Emit outcome: `{ status: "emitted" | "gated" | "dropped" }`
- NEVER throws to caller

**Network Boundary**:
- NO network sink provided
- `security-boundary.yml` asserts this package imports no network module
- Network transport is deliberately out of scope for this package

**Status**: ✅ Complete, production-ready
**Reuse**: YES — CLI will continue using this architecture
**Amendment**: Need to add a network transport OUTSIDE this package (in CLI layer)

### 3. CLI Telemetry Seam (`apps/cli/src/telemetry.ts`)

**What exists**:
- "Wired, DARK" — plumbing exists, but gated OFF by default
- Production: `consented: false` + `noopSink`
- `TelemetrySignal` interface — commands report verdict/event without leaking config/evidence
- `emitCommandSignal()` — best-effort, never affects CLI behavior
- `buildCliEmitter()` — env-injected, testable

**Current state**:
- No CLI commands to enable/disable/status
- No persistent consent storage
- No installation ID generation at runtime
- No network delivery

**Status**: ✅ Architecture complete, implementation DARK
**Reuse**: YES — extend with enable/disable/status commands + state storage
**Amendment**: Add consent commands, state file, optional network flush

### 4. Web Functions (`apps/web/functions/`)

**What exists**:
- `v1/public/[[path]].ts` — dynamic public API handler
- `v1/events/trust.ts` — trust event ingestion (currently DARK)
- Trust middleware

**Routes** (`_routes.json`):
```json
{
  "version": 1,
  "include": ["/v1/public/*", "/v1/events/trust", "/trust/*"],
  "exclude": []
}
```

**Status**: ✅ Routing infrastructure exists
**Reuse**: YES — add new routes for usage ingestion, admin API, public adoption
**Amendment**: 
  - Add `/v1/events/usage` (POST) — telemetry batch ingestion
  - Add `/v1/admin/usage` (GET) — private observatory, Cloudflare Access protected
  - Add `/v1/public/adoption-signals` (GET) — public thresholded metrics
  - Update `_routes.json` to include new routes

### 5. Cloudflare Infrastructure

**Wrangler config**: NOT FOUND (no wrangler.toml in repo)
**D1**: Not configured
**Secrets**: Not configured
**Access**: Not configured

**Status**: ❌ Infrastructure does not exist yet
**Reuse**: N/A
**Amendment**: Need to create:
  - D1 database binding: `CALLLINT_USAGE_DB`
  - Secret: `USAGE_HASH_KEY` (HMAC key for installation ID hashing)
  - Cloudflare Access configuration for `/admin/*` and `/v1/admin/*`
  - D1 migrations in repository

### 6. Tests

**Existing tests**:
- `packages/telemetry-contract/test/` — sanitize, schema, tiers, installation ID
- `packages/telemetry-emit/test/` — emitter, gate
- `apps/cli/test/telemetry-wiring.test.ts` — CLI integration
- No web function tests for usage endpoints (they don't exist yet)

**Status**: ✅ Core telemetry is well-tested
**Reuse**: YES — existing tests provide foundation
**Amendment**: Add tests for:
  - CLI consent commands
  - Usage batch ingestion
  - HMAC identity transformation
  - Admin API
  - Public adoption API
  - Milestone projection
  - Negative controls (UA-01 through UA-16)

### 7. Documentation

**Existing**:
- Code comments reference `docs/privacy/telemetry.md`
- NO such file exists yet

**Status**: ❌ Missing
**Amendment**: Create `docs/privacy/telemetry.md` with complete privacy policy

### 8. Homepage / Public UI (`apps/web/public/`)

**What exists**:
- `index.html` — main homepage
- `styles.css` — design system (`.site-header`, `.section`, `.feature`, `.verdict-grid`, etc.)
- `agents.html` — agents page
- Existing design tokens: `--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--brand`, `--radius`

**Status**: ✅ Design system complete and mature
**Reuse**: YES — adoption signals block will reuse existing styles
**Amendment**: Add one restrained social-proof block to homepage

### 9. Scripts / Checks

**Existing**:
- `scripts/check-public-copy.mjs` — validates public-facing copy consistency
- `scripts/check-telemetry-boundary.mjs` — SEARCH RESULT: not found

**Status**: ⚠️ Partially exists
**Amendment**: May need to create `check:telemetry-boundary` if referenced in package.json

### 10. Project Facts (`project-facts.json`)

**Current**:
- `stableVersion`: "1.8.0"
- No usage/adoption metrics stored here
- Single source of truth for public product facts

**Status**: ✅ Stable, should NOT store dynamic usage numbers
**Reuse**: Keep separate — usage is measured projection, not static fact
**Amendment**: NONE — usage metrics belong in separate API, not in project facts

## Search Results: Additional Context

### Analytics Engine / D1 References
- NO existing Analytics Engine usage found
- NO existing D1 usage found
- NO existing Cloudflare Access configuration found

### trust_page_* Events
- `trust_page_viewed` and `trust_page_to_install` are in `ALLOWED_EVENTS`
- Currently DARK (like all telemetry)
- These will automatically light up when telemetry is enabled

### Existing CALLLINT_TELEMETRY Kill-Switch
- Honored by gate logic
- Environment-based override
- Still active in new implementation

## Reuse vs. New Implementation

### REUSE (Don't Duplicate):
1. ✅ `@calllint/telemetry-contract` — use as-is
2. ✅ `@calllint/telemetry-emit` — use as-is
3. ✅ `apps/cli/src/telemetry.ts` — extend, don't rewrite
4. ✅ Event vocabulary — closed, don't expand
5. ✅ Installation ID contract — use `makeInstallationId(crypto.randomUUID())`
6. ✅ Sanitizer — use `sanitizeEvent()` server-side too
7. ✅ Design system — reuse `styles.css` for all UI
8. ✅ Routing infrastructure — extend `_routes.json`

### NEW (Missing Pieces):
1. ❌ CLI consent commands (`telemetry enable/disable/status/reset`)
2. ❌ CLI state storage (consent + anonymousInstallationId)
3. ❌ CLI network transport (batched flush to `/v1/events/usage`)
4. ❌ Server ingestion endpoint (`/v1/events/usage`)
5. ❌ D1 database + schema
6. ❌ HMAC identity transformation (server-side)
7. ❌ Private admin API (`/v1/admin/usage`)
8. ❌ Private dashboard HTML
9. ❌ Cloudflare Access protection
10. ❌ Public adoption API (`/v1/public/adoption-signals`)
11. ❌ Milestone projection logic
12. ❌ Homepage adoption block
13. ❌ Privacy documentation (`docs/privacy/telemetry.md`)
14. ❌ Infrastructure setup (D1, secrets, Access)
15. ❌ Comprehensive tests for new surfaces
16. ❌ Negative controls (UA-01 to UA-16)

## Canonical Metric Semantics (Authoritative)

### Private Observatory Metrics:
1. **Active installations (30d)**: Distinct consenting anonymous installations with ≥1 `preflight_completed` in selected range
2. **Preflights completed**: Total `preflight_completed` events observed
3. **Preflights needing attention**: `decision_review` + `decision_block` + `decision_unknown`
4. **Preflights / active**: Ratio when denominator > 0

### Public Terminology:
- "Recorded preflight checks" (NOT "users protected")
- "Preflights needing attention" (NOT "threats stopped")
- "MCP servers observed" (from Registry, not telemetry)

### NEVER Publicly Claim:
- "X users" from installation counts
- "attacks prevented"
- "malware blocked"
- "incidents prevented"

## Amendment Summary

| Component | Status | Action |
|-----------|--------|--------|
| Telemetry contract | ✅ Complete | Reuse as-is |
| Emitter | ✅ Complete | Reuse as-is |
| CLI seam | ✅ Architecture done | Add consent commands + state |
| Web routing | ✅ Infrastructure exists | Add 3 new routes |
| D1 / infrastructure | ❌ Missing | Create from scratch |
| Private dashboard | ❌ Missing | Build with existing design system |
| Public adoption API | ❌ Missing | Build with threshold logic |
| Homepage block | ❌ Missing | Add restrained social-proof |
| Privacy docs | ❌ Missing | Write `docs/privacy/telemetry.md` |
| Tests | ⚠️ Partial | Extend for new surfaces |

## Execution Readiness

**Can proceed**: YES  
**Blockers**: NONE  
**Next stage**: U1 — CLI Consent + Identity

---
**Audit complete**: 2026-08-18  
**Auditor**: Claude Code (Opus 5)  
**Architecture verdict**: Reuse existing telemetry bones, add thin layers for consent/transport/storage/projection
