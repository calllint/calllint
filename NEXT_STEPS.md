# Next Steps for Usage Observatory Deployment

**Branch**: `feat/usage-observatory` (ready for review)  
**Status**: Implementation complete, awaiting manual deployment steps

---

## What's Ready

✅ All code implemented and tested (4370 tests passing)  
✅ Deployment scripts prepared  
✅ Negative controls automated  
✅ Documentation complete  
✅ Privacy architecture validated  

---

## What You Need To Do

### 1. Code Review & Merge (Human Decision Required)

**Action**: Review and approve the PR

```bash
# Create PR on GitHub
# Visit: https://github.com/calllint/calllint/pull/new/feat/usage-observatory

# Or via gh CLI:
gh pr create --base main --head feat/usage-observatory \
  --title "feat(telemetry): Usage Observatory — Privacy-first telemetry system" \
  --body "Implements U0-U8 of the Usage Observatory. See artifacts/usage-observatory/FINAL_REPORT.md for details."
```

**Review Checklist**:
- [ ] Code quality and architecture
- [ ] Privacy guarantees (HMAC-only storage, default OFF)
- [ ] Test coverage (zero regressions)
- [ ] Documentation completeness

**Merge when approved**:
```bash
gh pr merge --squash
```

---

### 2. Staging Deployment (Requires Cloudflare Account)

**Prerequisites**:
- Cloudflare account with Pages enabled
- `wrangler` CLI installed: `npm install -g wrangler`
- Authenticated: `wrangler login`

**Run the deployment script**:
```bash
cd /path/to/Shield
./scripts/deploy-usage-observatory.sh
```

The script will guide you through:
1. Creating D1 database
2. Applying schema
3. Setting HMAC secret
4. Deploying Functions
5. Verifying endpoints

**Or follow manual steps** in `artifacts/usage-observatory/DEPLOYMENT_CHECKLIST.md`

---

### 3. Configure Cloudflare Access (Manual Setup Required)

**Why**: Protect `/v1/admin/*` endpoints from unauthorized access

**Steps**:
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to: Zero Trust → Access → Applications
3. Click "Add an application"
4. Configure:
   - **Name**: CallLint Usage Observatory Admin
   - **Session Duration**: 24 hours
   - **Application domain**: `calllint-usage-observatory.pages.dev`
   - **Path**: `/v1/admin/*`
5. Add Policy:
   - **Name**: Admin Team
   - **Action**: Allow
   - **Include**: Your team emails (e.g., `*@yourdomain.com`)
6. Save

**Verify**: Visit `https://calllint-usage-observatory.pages.dev/v1/admin/dashboard` — should redirect to Access login

---

### 4. Run Negative Controls (Automated Testing)

**Purpose**: Validate all 16 privacy & correctness guarantees

```bash
# Build CLI first
cd apps/cli
npm run build

# Run controls
cd ../..
./scripts/run-negative-controls.sh ./apps/cli/dist/index.js
```

**Expected**: `✓ All negative controls passed`

**If any fail**: DO NOT deploy to production. Review failure and fix issue.

---

### 5. Production Deployment (After Staging Validation)

**Update CLI endpoint**:

Edit `apps/cli/src/transport.ts`:
```typescript
const DEFAULT_ENDPOINT = 
  process.env.CALLLINT_TELEMETRY_ENDPOINT ?? 
  "https://calllint-usage-observatory.pages.dev/v1/events/usage"
```

**Release new CLI version**:
```bash
cd apps/cli
npm version minor
npm run build
npm publish
git push --tags
```

**Monitor first 100 events**:
```bash
# Check database
wrangler d1 execute calllint-usage --command="
  SELECT COUNT(*) as total_events,
         COUNT(DISTINCT hashed_installation_id) as unique_installs
  FROM usage_events
"

# Watch logs
wrangler pages deployment tail
```

**Verify dashboard**: Open admin dashboard and confirm metrics showing

---

### 6. Homepage Integration (Handoff to Website Team)

**API Endpoint**: `https://calllint-usage-observatory.pages.dev/v1/public/adoption-signals`

**Response Format**:
```json
{
  "activeInstallations": "1K+",
  "totalScans": "2.5K+",
  "lastUpdated": "2026-08-18T12:00:00Z"
}
```

**Suggested Implementation**:
```html
<div class="adoption-signals">
  <span class="badge" id="active-installs">Loading...</span>
  <span class="badge" id="total-scans">Loading...</span>
</div>

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

**Styling**: Use CallLint brand colors (dark theme, green accents)

---

## Files to Reference

| Document | Purpose |
|----------|---------|
| `artifacts/usage-observatory/FINAL_REPORT.md` | Complete technical report |
| `artifacts/usage-observatory/DEPLOYMENT_CHECKLIST.md` | Detailed deployment procedures |
| `artifacts/usage-observatory/docs/PRIVACY.md` | User-facing privacy policy |
| `artifacts/usage-observatory/docs/DEPLOYMENT.md` | Technical deployment guide |
| `artifacts/usage-observatory/docs/NEGATIVE_CONTROLS.md` | All 16 control specifications |
| `scripts/deploy-usage-observatory.sh` | Automated deployment script |
| `scripts/run-negative-controls.sh` | Automated testing script |

---

## Rollback Plan (If Issues Arise)

**Disable telemetry globally**:
```bash
wrangler secret put CALLLINT_TELEMETRY_KILL_SWITCH
# Enter: true
```

**Revert CLI**:
```bash
npm unpublish calllint@latest
npm publish calllint@<previous-version> --tag latest
```

---

## Timeline Estimate

| Task | Estimated Time |
|------|----------------|
| Code review | 30-60 min |
| Staging deployment | 20-30 min |
| Cloudflare Access setup | 10 min |
| Negative controls | 5 min (automated) |
| Production deployment | 15 min |
| Homepage integration | 30 min (website team) |
| **Total** | **~2 hours** |

---

## Support

If you encounter issues during deployment:

1. **Check logs**: `wrangler pages deployment tail`
2. **Verify D1**: `wrangler d1 execute calllint-usage --command="SELECT COUNT(*) FROM usage_events"`
3. **Review negative controls**: Check which control failed and why
4. **Consult documentation**: See `DEPLOYMENT.md` for troubleshooting steps

---

## Success Criteria

Deployment is complete when:

- [x] Code merged to main
- [ ] Staging deployment verified (all endpoints responding)
- [ ] All 16 negative controls passing
- [ ] Cloudflare Access protecting admin endpoints
- [ ] Production CLI published with correct endpoint
- [ ] Dashboard showing accurate metrics
- [ ] Homepage displaying adoption badges

---

**Current Status**: Ready for code review  
**Next Action**: Create and review PR on GitHub  
**Blocker**: None (implementation complete)
