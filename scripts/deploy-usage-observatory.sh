#!/bin/bash
# Usage Observatory Deployment Script
# Run this after manual Cloudflare setup

set -e

echo "════════════════════════════════════════════════════════════════"
echo "  Usage Observatory Deployment"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Check prerequisites
echo "→ Checking prerequisites..."

if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler CLI not found. Install: npm install -g wrangler"
    exit 1
fi

if ! command -v curl &> /dev/null; then
    echo "❌ curl not found"
    exit 1
fi

echo "✓ Prerequisites OK"
echo ""

# Step 1: Create D1 Database (if not exists)
echo "→ Step 1: D1 Database Setup"
echo "   Run manually:"
echo "   wrangler d1 create calllint-usage"
echo "   Then update wrangler.toml with the database_id"
echo ""
read -p "   Press Enter when database is created and wrangler.toml is updated..."

# Step 2: Apply Schema
echo ""
echo "→ Step 2: Applying Database Schema..."
wrangler d1 execute calllint-usage --file=functions/schema.sql
echo "✓ Schema applied"
echo ""

# Step 3: Set Secret
echo "→ Step 3: HMAC Secret Setup"
echo "   Generate a secret: openssl rand -hex 32"
echo "   Then run: wrangler secret put USAGE_HASH_KEY"
echo ""
read -p "   Press Enter when secret is set..."

# Step 4: Deploy Functions
echo ""
echo "→ Step 4: Deploying to Cloudflare Pages..."
wrangler pages deploy public --project-name=calllint-usage-observatory
echo "✓ Deployed"
echo ""

# Step 5: Verify Deployment
echo "→ Step 5: Verifying Deployment..."
echo ""

# Get the deployment URL
echo "   What is your deployment URL?"
read -p "   (e.g., https://calllint-usage-observatory.pages.dev): " DEPLOY_URL

# Test public endpoint
echo ""
echo "   Testing public endpoint..."
RESPONSE=$(curl -s "${DEPLOY_URL}/v1/public/adoption-signals")
if echo "$RESPONSE" | grep -q "activeInstallations"; then
    echo "   ✓ Public API responding"
    echo "   Response: $RESPONSE"
else
    echo "   ❌ Public API not responding correctly"
    echo "   Response: $RESPONSE"
    exit 1
fi

# Test ingestion endpoint with dummy data
echo ""
echo "   Testing ingestion endpoint..."
TEST_BATCH=$(cat <<EOF
{
  "schema": "calllint.telemetry-batch.v0",
  "batchId": "test-deployment-$(date +%s)",
  "events": [{
    "eventVersion": "1.0.0",
    "eventName": "preflight_completed",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "source": "cli",
    "anonymousInstallationId": "cli-anon-00000000-0000-0000-0000-000000000001"
  }]
}
EOF
)

INGEST_RESPONSE=$(curl -s -X POST "${DEPLOY_URL}/v1/events/usage" \
    -H "Content-Type: application/json" \
    -d "$TEST_BATCH")

if echo "$INGEST_RESPONSE" | grep -q '"status":"ok"'; then
    echo "   ✓ Ingestion API responding"
    echo "   Response: $INGEST_RESPONSE"
else
    echo "   ❌ Ingestion API not responding correctly"
    echo "   Response: $INGEST_RESPONSE"
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Deployment Complete!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Next Steps:"
echo "  1. Configure Cloudflare Access for /v1/admin/*"
echo "  2. Run negative controls: ./scripts/run-negative-controls.sh"
echo "  3. Update CLI endpoint: export CALLLINT_TELEMETRY_ENDPOINT=${DEPLOY_URL}/v1/events/usage"
echo ""
echo "Endpoints:"
echo "  • Public API: ${DEPLOY_URL}/v1/public/adoption-signals"
echo "  • Ingestion: ${DEPLOY_URL}/v1/events/usage"
echo "  • Admin Dashboard: ${DEPLOY_URL}/v1/admin/dashboard"
echo "  • Admin API: ${DEPLOY_URL}/v1/admin/usage"
echo ""
