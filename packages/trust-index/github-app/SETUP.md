# CallLint Trust — GitHub App setup (one-time, human-gated)

The maintainer-claim mechanism (ADR 0047 + ADR 0048) proves **namespace control** by
having a maintainer install a GitHub App on the org/user that owns an MCP repo. This
is the one step that **cannot** be automated: creating a GitHub App generates a
**private key** and **webhook secret** exactly once, shown only in the browser, and
those must be pasted into the ingestion repo's Actions secrets by a human.

Everything else — verification, the baked flag, the whole serving surface — is already
shipped and dormant (the committed claim store is empty). Nothing here changes a served
page until the verify job (I2c-4) writes the first real record.

## What the App is allowed to do (least privilege — ADR 0048 §3)

- **Repository metadata: read-only** — the *only* permission. Enough to list which
  repos an installation covers and map them to canonical names. **No** code, contents,
  issues, PRs, Actions, secrets, or org-membership access.
- Declares **no** event subscriptions. `installation` / `installation_repositories`
  are lifecycle events GitHub delivers to every App automatically (they are not
  subscribable and are rejected in a manifest's `default_events` when no gating
  permission backs them). Phase I reconciles by **polling installations** anyway.
- `hook_attributes.active: false` — Phase I has **no** live webhook listener; the
  batch verify job reconciles by **polling installations** (ADR 0048 §4), so a missed
  delivery self-heals. The URL is a Phase II placeholder.
- The App collects **no PII**: a claim record holds only a public handle, the
  installation id, digests, and timestamps (ADR 0048 §3, mirrors ADR 0038 §5).

## Steps

1. **Create the App from the manifest (one click).**
   Open `create-app.html` in a browser (double-click the file, or serve the folder).
   Leave the org field blank for a personal-account App, or enter an org login (you
   must be an org owner). Click **Create App on GitHub →**. GitHub shows the manifest
   for confirmation — the permissions must read exactly *Repository metadata:
   Read-only*. Confirm.

   > The manifest posted is a byte-for-byte copy of `app-manifest.json`; a repo test
   > (`github-app.test.ts`) binds the two so they cannot drift.

2. **Capture the credentials GitHub shows once.**
   After creation GitHub shows the **App ID**, lets you **generate a private key**
   (downloads a `.pem`), and shows the **webhook secret** you set (or generate one).
   Do this immediately — the private key is shown only at generation time.

3. **Store the secrets in the ingestion repo (never commit them).**
   ```sh
   # non-secret identifiers → repo variables
   gh variable set CALLLINT_APP_ID    --body "<the numeric App ID>"
   gh variable set CALLLINT_APP_SLUG  --body "calllint-trust"

   # secrets → repo secrets (paste the .pem contents / the webhook secret)
   gh secret set CALLLINT_APP_PRIVATE_KEY   < path/to/calllint-trust.<date>.private-key.pem
   gh secret set CALLLINT_APP_WEBHOOK_SECRET --body "<the webhook secret>"
   ```
   `CALLLINT_APP_PRIVATE_KEY` and `CALLLINT_APP_WEBHOOK_SECRET` are **secrets** (masked,
   never printed). `CALLLINT_APP_ID`/`CALLLINT_APP_SLUG` are non-secret **variables**.

4. **Tell me the App ID + slug** (or just confirm the variables/secrets are set). I'll
   then land I2c-4: the Actions verify job that mints an ephemeral installation token,
   lists installations, writes/refreshes claim records in `claims/claim-store.json`,
   and lets the next bake stamp `verifiedPublisher` onto exactly the claimed pages.

## Boundary

The private key stays only in Actions secrets on the **ingestion** side. The serving
deployable never sees it and makes no trust decision at request time (ADR 0046 §1/§4) —
it only serves the baked flag. Revocation = uninstalling the App: the next poll finds
the installation gone and flips the record to `revoked`, dropping the flag.
