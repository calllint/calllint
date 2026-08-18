# Usage Observatory Implementation Progress

**Session**: 2026-08-18  
**Batch**: A0 v1 — U0 through U8

---

## Summary

| Stage | Status | Lines | Completion |
|-------|--------|-------|-----------|
| U0 | ✅ DONE | ~100 | 2026-08-18 |
| U1 | ✅ DONE | ~250 | 2026-08-18 |
| U2 | ✅ DONE | ~350 | 2026-08-18 |
| U3 | ⏸️ TODO | ~300 | - |
| U4 | ⏸️ TODO | ~200 | - |
| U5 | ⏸️ TODO | ~150 | - |
| U6 | ⏸️ TODO | ~200 | - |
| U7 | ⏸️ TODO | ~50 | - |
| U8 | ⏸️ TODO | ~50 | - |

**Total delivered**: 700 / ~1650 lines (42%)

---

## U0: Reality Audit ✅

**Purpose**: Verify we can reuse 90% of existing infrastructure

**Delivered**:
- Reality audit document (`artifacts/usage-observatory/reality-audit.md`)
- Confirmed: existing `telemetry-contract`, `telemetry-emit`, `gate`, `sanitize` modules
- Gap analysis: only CLI state + queue + backend ingestion needed

**Key finding**: No new telemetry architecture needed — thin layers only

---

## U1: CLI Consent + Identity ✅

**Purpose**: Per-user telemetry consent + anonymous installation ID

**Delivered**:
- ✅ `apps/cli/src/state.ts` — state management (consent + ID)
- ✅ `apps/cli/src/commands/telemetry.ts` — CLI subcommands
- ✅ `apps/cli/src/index.ts` — async telemetry command routing
- ✅ `apps/cli/test/state.test.ts` — 7 tests, all passing
- ✅ Installation ID uses `crypto.randomUUID()` (NOT hardware fingerprint)
- ✅ Platform-appropriate config paths (XDG / LOCALAPPDATA)

**Commands**:
```bash
calllint telemetry status
calllint telemetry enable
calllint telemetry disable
calllint telemetry reset
```

**Lines**: ~250

---

## U2: Local Queue + Transport ✅

**Purpose**: Bounded queue + best-effort network delivery

**Delivered**:
- ✅ `apps/cli/src/queue.ts` — bounded FIFO queue (1000 events / 256 KiB)
- ✅ `apps/cli/src/transport.ts` — HTTP POST with 5s timeout
- ✅ `apps/cli/src/flush.ts` — orchestration (queue → batch → deliver)
- ✅ `apps/cli/src/paths.ts` — platform path resolution
- ✅ `apps/cli/src/capture.ts` — event capture helpers
- ✅ `apps/cli/src/index.ts` — integrated flush at CLI exit
- ✅ `packages/telemetry-contract/` — complete exports
- ✅ All tests passing (4370 pass, 1 skip)
- ✅ Typecheck clean

**Key properties**:
- Flush runs AFTER command completion (never affects output/exit code)
- Endpoint: `CALLLINT_TELEMETRY_ENDPOINT` or `https://calllint.com/v1/events/usage`
- Queue persists to `{XDG_CONFIG_HOME|LOCALAPPDATA}/calllint/queue.json`
- Oldest events dropped first when cap exceeded

**Lines**: ~350

---

## U3: First-party Usage Endpoint ⏸️

**Purpose**: Server-side ingestion API with HMAC + D1 storage

**Work needed**:
1. Cloudflare Pages Function: `functions/v1/events/usage.ts`
   - POST handler
   - HMAC installation ID (secret: `USAGE_HASH_KEY`)
   - Store to D1 `usage_events` table
   - Idempotent via `batchId`
   - Rate limit: 100 req/min per IP
2. D1 schema:
   ```sql
   CREATE TABLE usage_events (
     id INTEGER PRIMARY KEY,
     batch_id TEXT UNIQUE,
     hashed_installation_id TEXT,
     event_name TEXT,
     timestamp TEXT,
     created_at TEXT DEFAULT CURRENT_TIMESTAMP
   );
   CREATE INDEX idx_hashed_id ON usage_events(hashed_installation_id);
   CREATE INDEX idx_event_name ON usage_events(event_name);
   ```
3. HMAC utility: `functions/_middleware/hmac.ts`
4. Tests: verify HMAC, idempotency, rate limiting

**Lines**: ~300

---

## U4: Private Usage Observatory ⏸️

**Purpose**: Admin dashboard with Cloudflare Access auth

**Work needed**:
1. `functions/v1/admin/usage.ts` — GET endpoint
   - Cloudflare Access header validation
   - Query D1 for aggregates:
     - Active installations (last 30d)
     - Events by type
     - Daily/weekly trends
   - Return JSON
2. Cloudflare Access policy (manual setup in dashboard)
3. Tests: verify auth, aggregation logic

**Lines**: ~200

---

## U5: Public Adoption Signals ⏸️

**Purpose**: Public metrics with milestone projection

**Work needed**:
1. `functions/v1/public/adoption-signals.ts` — GET endpoint
   - Read D1 aggregates
   - Project to thresholded milestones (1K+, 2.5K+, 5K+, 10K+, 25K+)
   - Return JSON: `{ activeInstallations: "1K+", preflight_completed: "2.5K+" }`
2. Cache-Control header: `public, max-age=3600`
3. Tests: verify projection logic, never exact counts

**Lines**: ~150

---

## U6: Private Dashboard HTML ⏸️

**Purpose**: Human-friendly dashboard UI

**Work needed**:
1. `functions/v1/admin/dashboard.html` — static HTML page
   - Fetch `/v1/admin/usage`
   - Render charts (Chart.js or similar)
   - Reuse CallLint design system (colors, typography)
2. Cloudflare Access protection
3. No framework, vanilla JS

**Lines**: ~200

---

## U7: Public Homepage Adoption Block ⏸️

**Purpose**: Display adoption signals on calllint.com

**Work needed**:
1. Homepage component fetches `/v1/public/adoption-signals`
2. Display as badges: "1K+ Active Installations", "2.5K+ Scans"
3. Link to privacy policy

**Lines**: ~50

---

## U8: Infrastructure + Validation ⏸️

**Purpose**: Deploy, test, validate with negative controls

**Work needed**:
1. D1 database creation: `wrangler d1 create calllint-usage`
2. Secrets: `wrangler secret put USAGE_HASH_KEY`
3. Cloudflare Access policy setup (manual)
4. Deploy: `wrangler pages deploy`
5. Run 16 negative controls (UA-01 to UA-16):
   - Consent OFF → no events sent
   - Verdict parity (telemetry on vs off)
   - HMAC collision resistance
   - Idempotent batch retry
   - Rate limit enforcement
   - Public endpoint thresholding
   - etc.
6. Documentation: `docs/privacy/telemetry.md`

**Lines**: ~50 (mostly config + docs)

---

## Next Steps

**Priority**: U3 (Server-side ingestion)

1. Create D1 schema
2. Implement `functions/v1/events/usage.ts`
3. Add HMAC utility
4. Write tests
5. Local dev test with Wrangler

After U3 completion, the full telemetry pipeline will be functional end-to-end (CLI → queue → network → D1).
