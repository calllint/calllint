# WorkBuddy / CodeBuddy Native Presence

## Status

**State:** NO_PUBLIC_CHANNEL

## Official Sources Audited

1. **Product Page:** https://cloud.tencent.com/product/workbuddy
   - Found: Product marketing, feature descriptions
   - NOT found: Developer submission portal, MCP marketplace, plugin directory

2. **GitHub Search (TencentCloud org):**
   ```bash
   gh search repos --owner TencentCloud "workbuddy OR codebuddy"
   ```
   - Result: `[]` (no official repositories found)

3. **Search Terms:** "workbuddy mcp", "workbuddy marketplace", "workbuddy plugin submission", "codebuddy developer"
   - No public submission mechanism discovered

## Marketplace Existence

WorkBuddy/CodeBuddy may have:
- An internal marketplace visible to users
- A curated set of MCP/plugin integrations

However:
- No public API for third-party submission
- No public GitHub repository accepting contributions
- No documented developer submission workflow
- No public form or portal

## Decision

Per H9.8.2:

> If official sources expose a marketplace but no public submission contract:
>   state exactly: NO_PUBLIC_CHANNEL
>
> Do not:
>   - scrape private endpoints
>   - reverse-engineer submission APIs
>   - email Tencent
>   - post forum messages
>   - open random GitHub issues
>   - submit through unrelated contact forms

**Conclusion:** No legitimate public submission path exists.

## Alternative Considered

Contacting Tencent through:
- Official support channels
- Developer relations email
- Product feedback forms

**Rejected:** Per H9.8.2, this would be unsolicited outbound contact, not a public programmatic submission mechanism.

## External Action

**None.** No submission, no contact, no issue.

## Operator Action Required

If Tencent/WorkBuddy later publishes a public MCP submission channel, CallLint can be submitted at that time.

## Notes

WorkBuddy discovery is implemented in CallLint (packages/discovery/src/extractors/workbuddy.ts) and harness pages exist (apps/web/public/harnesses/deepseek/workbuddy.html). The MCP discovery capability is present; only the native marketplace submission is blocked due to lack of public channel.
