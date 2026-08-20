# Cloudflare Access — the one action this repository cannot take

**Status: BLOCKED ON OPERATOR.** Nothing here is optional, and nothing here can be
automated from CI.

new18 §29 is fail-closed: if Cloudflare Access cannot be programmatically verified,
the usage report is **not published anywhere**. That is the state today. The report
is built daily by [.github/workflows/usage-report.yml](../../.github/workflows/usage-report.yml)
and uploaded as a workflow artifact named `usage-report`, retained 14 days. An
artifact is readable only by someone who can already read this repository's Actions,
so it needs no Access policy of its own.

This file exists to record the smallest unavoidable operator action, and nothing
else. It is deliberately not a deployment guide.

---

## Why CI cannot do this

An Access policy is an account-level object. Verifying one requires an API token
with `Access: Organizations, Identity Providers, and Groups — Read`, which is a
strictly larger authority than this pipeline needs to read a D1 table. Granting it
so a workflow could *check* a policy would mean the telemetry pipeline holds a
credential that can enumerate the account's identity configuration. The report is
not worth that token.

So the verification stays manual, and the publish step stays absent until it is
done. A green cron here means "the artifact built", never "the host is protected".

---

## The action

Only needed **if and when** you decide to serve this report from a host rather than
download it from Actions. If you are content reading the artifact, there is nothing
to do and this file can stay as it is indefinitely — that is a legitimate permanent
end state, not a deferral.

1. Create the private host (a Pages project or a Worker route). Do not add it to
   any nav, sitemap, `llms.txt`, README, or agent instruction file — §29 lists
   those surfaces explicitly, and a link is what turns a private host into a
   discoverable one.
2. Put a Cloudflare Access policy in front of the **whole** host, not a path:
   - Application: the hostname, path `/*`
   - Policy: Allow, and one rule only — `Emails` containing exactly the operator
     addresses that should read usage figures.
   - Session duration: short enough that a stolen browser session expires.
3. Confirm it from a signed-out context: an incognito window must land on the
   Access login page, never on the report.
4. Only after (3) succeeds, add a publish step to the workflow. Until then the
   `upload-artifact` step is the last step by design.

## What must stay true afterwards

- The report keeps `noindex, nofollow, noarchive` and ships its own
  `robots.txt` with `Disallow: /`. Both are asserted by the generator before it
  writes, and by [apps/usage-worker/test/report.test.ts](../../apps/usage-worker/test/report.test.ts).
  Access is the control; those are the backstop for the day Access is misconfigured.
- No public counter, homepage number, or MAU figure is derived from this data
  (§30). Public adoption signals are DEFERRED, not pending.
- The report references no off-host resource, so opening it tells no third party
  that an operator read it. The generator refuses to write a report that does.

## What this file is not

It is not evidence that Access is configured. Nobody should read the existence of
this document as a completed step. If someone needs to know whether the private
host is protected, the only answer this repository can honestly give is: **it does
not know, which is why the report is still an artifact.**
