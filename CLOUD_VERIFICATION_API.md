# Cloud Verification API Design (R6 / v1.0.0)

**Status:** Design only — not implemented in v1.0.0.

**Purpose:** Define the cloud signing service API for future implementation.

This document specifies the API endpoints and behavior for the CallLint cloud 
signing service. The actual service deployment is out of scope for v1.0.0.

---

## 1. Architecture Overview

```
┌─────────────────┐                    ┌─────────────────────┐
│   User Machine  │                    │   Cloud Service     │
│                 │                    │                     │
│  calllint scan  │                    │  Signing Service    │
│    --receipt    │                    │  ┌───────────────┐  │
│    --sign       │                    │  │ API Gateway   │  │
│        │        │                    │  └───────┬───────┘  │
│        ↓        │                    │          │          │
│  unsigned       │                    │  ┌───────▼───────┐  │
│  receipt.json   │                    │  │ Auth & Meter  │  │
│        │        │                    │  └───────┬───────┘  │
│        │        │   POST /v1/receipts/sign      │          │
│        └────────┼────────────────────────────→  │          │
│                 │   { receipt: {...} }  │  ┌───▼───────┐  │
│                 │                       │  │  Sign Hash │  │
│                 │   ← signed receipt    │  │  (ed25519) │  │
│        ┌────────┼───────────────────────  │  └───────────┘  │
│        │        │                       │  │ KMS/HSM key │  │
│        ↓        │                       │  └─────────────┘  │
│  signed         │                       │                   │
│  receipt.json   │                       └───────────────────┘
└─────────────────┘
```

**Key principles:**
- Cloud is **stateless over verdict** — it signs the receipt hash, never re-scans
- Privacy-first: receipt hash prevents cloud from indexing findings
- Offline verification: anyone can verify with public key from `.well-known/`

---

## 2. Endpoints

### 2.1 Sign Receipt

**Endpoint:** `POST /v1/receipts/sign`

**Description:** Sign an unsigned CallLint receipt. The service validates the 
receipt schema, computes its hash, signs with ed25519, and returns the signed 
receipt.

**Request:**
```json
{
  "receipt": {
    "schema_version": "calllint.receipt.v0",
    "receipt_id": "clrec_abc123...",
    "verdict": "REVIEW",
    "hashes": { "input_hash": "sha256:...", ... },
    ...
  }
}
```

**Headers:**
- `Authorization: Bearer clk_<base64url(128-bit)>` — API key
- `Content-Type: application/json`

**Response (200 OK):**
```json
{
  "receipt": {
    "schema_version": "calllint.receipt.v0",
    "receipt_id": "clrec_abc123...",
    "verdict": "REVIEW",
    "hashes": { "input_hash": "sha256:...", ... },
    ...
    "signature": {
      "algorithm": "ed25519",
      "key_id": "calllint-prod-2026-h2",
      "value": "base64url(64 bytes)",
      "signed_at": "2026-07-02T12:34:56Z",
      "public_key_url": "https://calllint.com/.well-known/receipt-keys.json"
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `invalid_request` | Malformed JSON or missing receipt field |
| 401 | `unauthorized` | Missing or invalid API key |
| 402 | `insufficient_credits` | Account has insufficient credits (see §2.5) |
| 422 | `invalid_receipt` | Receipt schema validation failed or already has signature |
| 429 | `rate_limit_exceeded` | Too many requests (100 req/min per key) |
| 500 | `signing_error` | Internal signing failure |

**Processing steps:**
1. Validate API key → 401 if invalid
2. Check account credits → 402 if insufficient
3. Parse and validate receipt schema → 422 if invalid
4. Check receipt has no existing signature → 422 if present
5. Compute receipt hash: `sha256(stableStringify(receipt))`
6. Sign hash with active ed25519 key
7. Deduct 1 credit from account
8. Return signed receipt

**Rate limits:**
- 100 requests/minute per API key
- Burst: 10 requests/second

---

### 2.2 Public Key Distribution

**Endpoint:** `GET /.well-known/receipt-keys.json`

**Description:** Retrieve active and rotated public keys for signature verification.

**Request:** No body, no authentication required.

**Response (200 OK):**
```json
{
  "keys": [
    {
      "key_id": "calllint-prod-2026-h2",
      "algorithm": "ed25519",
      "public_key": "base64url(32 bytes)",
      "valid_from": "2026-07-01T00:00:00Z",
      "valid_until": null,
      "status": "active"
    },
    {
      "key_id": "calllint-prod-2026-h1",
      "algorithm": "ed25519",
      "public_key": "base64url(32 bytes)",
      "valid_from": "2026-01-01T00:00:00Z",
      "valid_until": "2026-06-30T23:59:59Z",
      "status": "rotated"
    }
  ]
}
```

**Caching:**
- `Cache-Control: public, max-age=3600` (1 hour)
- `ETag` support for conditional requests

**Key status values:**
- `active` — currently used for new signatures
- `rotated` — no longer signs new receipts, but signatures are still valid
- `revoked` — key compromised, all signatures invalid

---

### 2.3 Verification Endpoint (Optional)

**Endpoint:** `GET /v1/receipts/:receipt_id/verify`

**Description:** Online verification convenience endpoint. Returns the signed 
receipt and verification status. **Not required** — offline verification with 
public key from `.well-known/` is the primary method.

**Request:** No body. Receipt ID in URL path.

**Response (200 OK):**
```json
{
  "receipt": { /* full signed receipt */ },
  "verification": {
    "valid": true,
    "key_id": "calllint-prod-2026-h2",
    "signed_at": "2026-07-02T12:34:56Z",
    "key_status": "active"
  }
}
```

**Response (404 Not Found):**
```json
{
  "error": "receipt_not_found",
  "message": "Receipt clrec_xyz not in archive. Offline verification still works."
}
```

**Note:** This endpoint requires the receipt to be in the cloud archive (opt-in, 
future feature). Unsigned receipts and receipts not in the archive return 404.

---

### 2.4 API Key Management (Future)

**Endpoints (not in v1.0.0 scope):**
- `POST /v1/keys` — Create new API key
- `GET /v1/keys` — List account's API keys
- `DELETE /v1/keys/:key_id` — Revoke API key

**API key format:** `clk_<base64url(128-bit)>` (22 chars + prefix)

**Key scopes (future):**
- `receipts:sign` — can sign receipts
- `receipts:verify` — can verify receipts via online endpoint
- `account:read` — can read account info (balance, usage)

---

### 2.5 Credits & Metering (Internal)

**Credit model:** Per-scan metering, not per-scan checkout. Users prepay credits 
or have subscription/enterprise contracts. Each successful sign deducts credits.

**Insufficient credits response (402):**
```json
{
  "error": "insufficient_credits",
  "message": "Account balance: 0 credits. This operation costs 1 credit.",
  "balance": 0,
  "required": 1
}
```

**Note:** Pricing details, purchase flows, and credit amounts are **internal only** 
in v1.0.0 (per R6 constraint). No public pricing documentation.

---

## 3. Security & Trust

### 3.1 What the Signature Proves

**Proves:**
- **Provenance:** CallLint issued this receipt
- **Integrity:** Receipt content has not been modified since signing
- **Non-repudiation:** CallLint cannot deny issuing this receipt

**Does NOT prove:**
- **Safety:** The tool is safe to use (SAFE verdict = "no blockers observed", not guaranteed)
- **Completeness:** All risks were found
- **Future behavior:** The tool won't change after the scan
- **Runtime behavior:** The tool will behave as declared

### 3.2 Privacy

**Data stored in cloud:**
- API key hash (sha256)
- Account metadata (email for billing)
- Credit balance
- Usage log: `(receipt_id, account_id, timestamp, cost)`

**Data NOT stored:**
- Receipt content (findings, target name, policy)
- ScanReport content
- Secret values

**Data in transit:**
- Receipt sent over HTTPS (encrypted)
- Receipt hash computed at cloud
- Signature returned (no plaintext findings logged)

### 3.3 Key Rotation

**Rotation cadence:** Every 6 months (H1 = Jan–Jun, H2 = Jul–Dec)

**Rotation procedure:**
1. Generate new keypair (key_id = `calllint-prod-{year}-{new_half}`)
2. Add to `.well-known/receipt-keys.json` with `status: "active"`
3. Mark old key `status: "rotated"`, set `valid_until`
4. Update signing service to use new key
5. Keep old key in `.well-known/` indefinitely (for old receipt verification)

**Revocation:** If key compromised, mark `status: "revoked"` in `.well-known/` 
immediately. All receipts signed with revoked key are untrusted.

---

## 4. Client Integration

### 4.1 CLI Integration

**Scan with cloud signing:**
```bash
export CALLLINT_API_KEY=clk_...
calllint scan config.json --receipt --sign
```

**Behavior:**
1. Run scan (unchanged)
2. Create unsigned receipt (unchanged)
3. POST unsigned receipt to `/v1/receipts/sign`
4. Write signed receipt to `calllint-receipt.json`

**Error handling:**
- API key missing → warning, unsigned receipt written
- API failure (network, 402, 500) → error exit 1, no receipt written
- 401 unauthorized → error "Invalid API key"
- 402 insufficient credits → error with balance info

### 4.2 Local Verification

**Verify signed receipt offline:**
```bash
calllint receipt verify signed-receipt.json --public-key dev-key.json
```

**Verification steps:**
1. Load receipt
2. Fetch public key (from file or `.well-known/`)
3. Extract signature
4. Compute receipt hash (minus signature field)
5. Verify: `ed25519.verify(hash, signature.value, public_key)`
6. Exit 0 if valid, 1 if invalid

---

## 5. Deployment Architecture (Future)

**Infrastructure (out of v1.0.0 scope):**
- API Gateway: rate limiting, request validation
- Auth service: API key validation, account lookup
- Metering service: credit check, usage logging
- Signing service: KMS/HSM access, ed25519 signing
- Key management: key rotation, `.well-known/` publishing

**Recommended stack:**
- API Gateway: AWS API Gateway / Cloudflare Workers
- Auth: Auth0 / custom JWT service
- Database: PostgreSQL (accounts, keys, usage)
- KMS: AWS KMS / GCP Secret Manager / YubiHSM
- CDN: Cloudflare (for `.well-known/receipt-keys.json`)

**Observability:**
- Metrics: sign requests/sec, latency, error rates
- Logs: API key usage, credit deductions, signing failures
- Alerts: key compromise, high error rate, credit abuse

---

## 6. Future Extensions

### 6.1 Receipt Archive (Opt-in)

Users can opt-in to store receipts in cloud for online verification:
```bash
calllint scan config.json --receipt --sign --archive
```

Receipts stored for 90 days (free tier) or unlimited (paid).

### 6.2 Webhook Notifications

Notify external services when a receipt is signed:
```json
POST {webhook_url}
{
  "event": "receipt.signed",
  "receipt_id": "clrec_...",
  "verdict": "REVIEW",
  "timestamp": "2026-07-02T12:34:56Z"
}
```

### 6.3 Batch Signing

Sign multiple receipts in one request (for CI pipelines):
```json
POST /v1/receipts/sign-batch
{
  "receipts": [ /* array of unsigned receipts */ ]
}
```

---

## 7. References

- ADR 0032: Cloud Signed Receipt Infrastructure
- ADR 0028: Receipt-first Trust Layer
- ADR 0019: CapabilityFingerprint v0 (stableStringify, sha256)
- ed25519: https://ed25519.cr.yp.to/
- RFC 4648 §5: base64url encoding
