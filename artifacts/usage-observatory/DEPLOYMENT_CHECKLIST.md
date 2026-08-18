# Usage Observatory - Production Deployment Checklist

## Pre-Deployment (Code Review)

- [ ] Review PR: `feat/usage-observatory` → `main`
- [ ] Verify all tests passing (4370 tests)
- [ ] Check no regressions introduced
- [ ] Approve privacy architecture review
- [ ] Merge to main

## Staging Deployment

### 1. Create Cloudflare D1 Database

```bash
# Create database
wrangler d1 create calllint-usage

# Output will show:
# database_id = "xxxx-xxxx-xxxx-xxxx"

# Update wrangler.toml with the database_id
```

**Update**: [wrangler.toml](../wrangler.toml) line 7

### 2. Apply Database Schema

```bash
cd /path/to/Shield
wrangler d1 execute calllint-usage --file=functions/schema.sql
```

**Verify**:
```bash
wrangler d1 execute calllint-usage --command="SELECT name FROM sqlite_master WHERE type='table'"
# Should show: usage_events
```

### 3. Set HMAC Secret

```bash
# Generate secret
openssl rand -hex 32

# Set in Cloudflare
wrangler secret put USAGE_HASH_KEY
# Paste the generated secret when prompted
```

**Store secret safely** in password manager for team access.

### 4. Deploy Functions to Cloudflare Pages

```bash
# Deploy
wrangler pages deploy public --project-name=calllint-usage-observatory

# Note the deployment URL
# e.g., https://calllint-usage-observatory.pages.dev
```

**Set environment variable**:
```bash
export USAGE_OBSERVATORY_URL="https://calllint-usage-observatory.pages.dev"
```

### 5. Configure Cloudflare Access

Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Zero Trust → Access

**Create Application**:
- Name: `CallLint Usage Observatory Admin`
- Session Duration: `24 hours`
- Application domain: `calllint-usage-observatory.pages.dev`
- Path: `/v1/admin/*`

**Add Policy**:
- Name: `Admin Team`
- Action: `Allow`
- Include: `Emails ending in @yourdomain.com` (or specific emails)

### 6. Run Negative Controls

```bash
# Build CLI first
cd apps/cli
npm run build

# Run controls
cd ../..
chmod +x scripts/run-negative-controls.sh
./scripts/run-negative-controls.sh ./apps/cli/dist/index.js
```

**Expected**: All 16 controls pass (0 failures)

**If any fail**:
1. Review failure reason in output
2. Fix issue
3. Re-run controls
4. DO NOT proceed to production until all pass

### 7. Verify Staging Endpoints

**Public API** (no auth):
```bash
curl https://calllint-usage-observatory.pages.dev/v1/public/adoption-signals
```
Expected: `{"activeInstallations":"<1K","totalScans":"<1K","lastUpdated":"..."}`

**Ingestion API**:
```bash
curl -X POST https://calllint-usage-observatory.pages.dev/v1/events/usage \
  -H "Content-Type: application/json" \
  -d '{
    "schema": "calllint.telemetry-batch.v0",
    "batchId": "test-'$(date +%s)'",
    "events": [{
      "eventVersion": "1.0.0",
      "eventName": "preflight_completed",
      "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "source": "cli",
      "anonymousInstallationId": "cli-anon-00000000-0000-0000-0000-000000000001"
    }]
  }'
```
Expected: `{"status":"ok","received":1,"stored":1}`

**Admin Dashboard** (requires Cloudflare Access):
- Open in browser: https://calllint-usage-observatory.pages.dev/v1/admin/dashboard
- Should redirect to Access auth flow
- After auth, dashboard should load with metrics

**Admin API**:
```bash
# Must be authenticated via browser first, then use cookies
curl -H "CF-Access-Authenticated-User-Email: your@email.com" \
  https://calllint-usage-observatory.pages.dev/v1/admin/usage
```

### 8. Staging Sign-off

- [ ] All negative controls passed
- [ ] Public API responding correctly
- [ ] Ingestion API accepting events
- [ ] Events visible in D1 database
- [ ] Admin dashboard loads (auth required)
- [ ] Admin API returns metrics

## Production Deployment

### 1. Update CLI Default Endpoint

**Edit**: [apps/cli/src/transport.ts](../apps/cli/src/transport.ts)

```typescript
const DEFAULT_ENDPOINT = 
  process.env.CALLLINT_TELEMETRY_ENDPOINT ?? 
  "https://calllint-usage-observatory.pages.dev/v1/events/usage"
```

**Commit**:
```bash
git add apps/cli/src/transport.ts
git commit -m "feat(telemetry): set production endpoint"
git push origin main
```

### 2. Release New CLI Version

```bash
# Bump version
npm version minor -m "feat: telemetry system (v%s)"

# Build
npm run build

# Publish
npm publish

# Tag release
git tag v$(node -p "require('./package.json').version")
git push --tags
```

### 3. Monitor First 100 Events

**Check ingestion rate**:
```bash
wrangler d1 execute calllint-usage --command="
  SELECT COUNT(*) as total, 
         COUNT(DISTINCT hashed_installation_id) as unique_installs
  FROM usage_events
"
```

**Check for errors**:
```bash
wrangler pages deployment tail
```

**Verify dashboard**:
- Open https://calllint-usage-observatory.pages.dev/v1/admin/dashboard
- Check active installations > 0
- Check total events increasing
- Verify event types showing

### 4. Production Sign-off

- [ ] CLI published with production endpoint
- [ ] First 100 events received without errors
- [ ] Dashboard showing accurate metrics
- [ ] Public API returning thresholded values
- [ ] No PII in database (spot check)
- [ ] Cloudflare Access working correctly

## Post-Deployment

### 1. Homepage Integration (U7 Handoff)

**Endpoint**: `GET https://calllint-usage-observatory.pages.dev/v1/public/adoption-signals`

**Response**:
```json
{
  "activeInstallations": "1K+",
  "totalScans": "2.5K+",
  "lastUpdated": "2026-08-18T12:34:56Z"
}
```

**Suggested HTML** (for website team):
```html
<section class="adoption-signals">
  <h3>Join the Community</h3>
  <div class="badges">
    <span class="badge" id="active-installs">Loading...</span>
    <span class="badge" id="total-scans">Loading...</span>
  </div>
</section>

<script>
fetch('https://calllint-usage-observatory.pages.dev/v1/public/adoption-signals')
  .then(r => r.json())
  .then(data => {
    document.getElementById('active-installs').textContent = 
      `${data.activeInstallations} Active Installations`;
    document.getElementById('total-scans').textContent = 
      `${data.totalScans} Scans Completed`;
  });
</script>
```

### 2. Documentation Updates

- [ ] Update main README with telemetry opt-in instructions
- [ ] Link to privacy policy in CLI help text
- [ ] Publish blog post about privacy-first telemetry
- [ ] Update release notes

### 3. Ongoing Monitoring

**Weekly checks**:
- Dashboard metrics review
- D1 database size monitoring
- Error rate in Cloudflare logs
- Public API response times

**Monthly maintenance**:
```bash
# Clean up old events (>90 days)
wrangler d1 execute calllint-usage --command="
  DELETE FROM usage_events 
  WHERE timestamp < datetime('now', '-90 days')
"
```

## Rollback Plan

If critical issues arise:

1. **Disable telemetry globally**:
   ```bash
   wrangler secret put CALLLINT_TELEMETRY_KILL_SWITCH
   # Set value: "true"
   ```

2. **Revert CLI to previous version**:
   ```bash
   npm unpublish calllint@latest
   npm publish calllint@<previous-version> --tag latest
   ```

3. **Investigate and fix**

4. **Re-enable after verification**

## Sign-offs

- [ ] **Engineering Lead**: Code review approved
- [ ] **DevOps**: Staging deployment verified
- [ ] **Privacy Officer**: Privacy guarantees validated
- [ ] **Product Manager**: Production deployment approved

---

**Deployment Date**: _______________  
**Deployed By**: _______________  
**Verified By**: _______________
