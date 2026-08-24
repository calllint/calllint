# Cloudflare Access — the one action this repository cannot take

**Status: COMPLETED (2026-08-24).** Cloudflare Access policy is now live at
`usage.calllint.com`.

## What was configured

1. **Pages project**: `calllint-usage-report` (Cloudflare Account ea7bc46b...)
2. **Custom domain**: `usage.calllint.com` (CNAME → calllint-usage-report.pages.dev, proxied)
3. **Access application**: "CallLint Usage Report (Private)" (ID: 1c52421f-9f42-4d7b-9a7a-91a70e135ccd)
4. **Access policy**: Allow, single email rule (`Saintw1022@gmail.com`)
5. **Verification**: unauthenticated `curl https://usage.calllint.com/` returns HTTP 200
   with "Sign in to access Cloudflare Access" gate (2026-08-24 17:xx UTC). The host
   does not serve content without authentication.

new18 §29's fail-closed requirement is now satisfied: a private host exists, Access
protects it, and the incognito test confirms the gate. The workflow can now deploy.

---

## Why CI could not do this

An Access policy is an account-level object. Verifying one requires an API token
with `Access: Organizations, Identity Providers, and Groups — Read`, which is a
strictly larger authority than this pipeline needs to read a D1 table. Granting it
so a workflow could *check* a policy would mean the telemetry pipeline holds a
credential that can enumerate the account's identity configuration. The report is
not worth that token.

So the verification stayed manual. The publish step was held back until an operator
confirmed the gate (this document). A green cron meant "the artifact built", never
"the host is protected" — until now.

---

## What must stay true

- The report keeps `noindex, nofollow, noarchive` and ships its own
  `robots.txt` with `Disallow: /`. Both are asserted by the generator before it
  writes, and by [apps/usage-worker/test/report.test.ts](../../apps/usage-worker/test/report.test.ts).
  Access is the control; those are the backstop for the day Access is misconfigured.
- No public counter, homepage number, or MAU figure is derived from this data
  (§30). Public adoption signals are DEFERRED, not pending.
- The report references no off-host resource, so opening it tells no third party
  that an operator read it. The generator refuses to write a report that does.
- The host is not linked from any nav, sitemap, `llms.txt`, README, or agent
  instruction file (§29). A link is what turns a private host into a discoverable one.
