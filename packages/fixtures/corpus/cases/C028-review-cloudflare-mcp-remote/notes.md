# C028 — Cloudflare servers via unpinned mcp-remote are REVIEW

**Provenance:** `real-public-snapshot` from [cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare) @ `cb0186135e2f` (README.md (mcp-remote config)), license Apache-2.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real Cloudflare config showing the npx mcp-remote bridge pattern. Documents that mcp-remote <url> reads as unpinned-npx REVIEW, not UNKNOWN — an important behavior to pin.

**Why this verdict (REVIEW, max S1):** Each server runs an unpinned mcp-remote bridge via npx, which is the review-worthy surface; the remote URL is an argument to that local bridge, not a directly-bound remote endpoint.

**Required findings:** `supply.unpinned-package`

**Known false positives:** None expected for this shape.

**Known false negatives / limits:** The actual remote behind mcp-remote is not inspected; only the local bridge package is seen.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.
