# Private usage report operations

The daily `usage-report` workflow generates an operator report, retains it as a
private artifact, deploys it to Pages, and checks the Cloudflare Access gate.
The generator is `scripts/generate-usage-report.mjs`; the workflow is
`.github/workflows/usage-report.yml`.

## Read the two outcomes separately

- **Data sources:** the generator writes an actual source-status table to the
  Actions summary and emits a warning when npm, D1, or registry evidence is
  unavailable. `source_status=complete` means all report sources were read;
  `degraded` means some figures remain unobserved. Offline sources are `skipped`.
- **Deployment and privacy:** the workflow must still deploy successfully and
  pass its existing Access, report-presence, and public-content checks. A source
  warning does not bypass these checks. Deployment success alone does not prove
  the data is complete or prove authenticated access to the production alias.

Incomplete reports remain permitted by the existing new18 §25/§28 contract.
Missing observations must render as em dashes, never invented zeros. All four
D1 aggregate reads must succeed and have valid result shapes before the D1
source is marked available. A successfully queried empty database can report
zero; a failed query cannot.

## Credential contract

The workflow currently uses repository secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. `deploy-web` also uses that token secret. Local Claude
settings are not read by GitHub Actions; updating or rolling a local key does
not update the repository secret.

For the account owning `calllint-usage-report` and `calllint-usage`, the token
needs **Cloudflare Pages: Edit** and **D1: Read** for this workflow. D1 query
also accepts D1 Write, but report generation does not require that broader
permission. Preserve any other permissions needed by the other workflow while
the credential is shared. Do not grant token-management or Access-management
rights just to make report diagnostics work.

Check Account Resources, client IP restrictions and TTL as well as permission
names. Standard GitHub-hosted runners do not provide a fixed source IP. A local
allowlist is not evidence that the scheduled runner is authorized. If an IP
allowlist is required, use a runner with controlled egress and allow that
egress; do not silently remove the restriction.

Use a distinct automation token when separating CI from local administration.
Creating another GitHub secret containing the same token does not create an
independent identity. This code change does not provision a new Cloudflare
principal or change the current account policy.

## Rotation and acceptance

1. Inspect the Cloudflare token's permissions, account scope, restrictions and
   expiration before changing it. An account token is verified via
   `/accounts/{account_id}/tokens/verify`; `active` alone does not establish
   access to Pages or D1. Token verification does not test client IP filtering.
2. Verify the Pages project request and a read-only query against the actual
   configured D1 database. Do not print the token, copy it into repository
   files, or pass real credentials to regression fixtures.
3. Update the repository secret through a protected input channel. Re-read
   current local settings at the time of an authorized sync; do not reuse a key
   captured before a roll. If the token value is unchanged and only its
   permissions changed, a secret rewrite is unnecessary.
4. Run `gh workflow run usage-report.yml --repo calllint/calllint --ref main`.
   Require the source table to say complete, a successful Pages deployment,
   and passing Access/report-presence checks. A green degraded run is partial
   recovery, not acceptance of complete data.
5. Check the next scheduled run after the change. Record the run URL and
   revision. A manual success establishes current operation, not a guarantee
   that future token edits, expiry or account-policy changes cannot break it.

For HTTP 401/403 or provider codes 9109/10000/7403, inspect credential identity,
resource permissions and restrictions. Do not assume all these codes mean
expiry, and do not mask persistent authorization errors with retries. If access
regresses after a successful run, inspect Cloudflare audit history to identify
the actual policy change instead of attributing it from a status code alone.

## October 2026 incident evidence

- [Oct 13](https://github.com/calllint/calllint/actions/runs/38413727136): D1 and
  deployment succeeded on `9c3abf9`.
- [Oct 15 after secret replacement](https://github.com/calllint/calllint/actions/runs/38754619042):
  D1 and deployment both succeeded. This rules out the claim that the replacement
  lacked D1 access from its creation.
- [Oct 16](https://github.com/calllint/calllint/actions/runs/38896074958): D1 and
  Pages authorization failed again. The exact intervening Cloudflare policy
  change was not readable with the available token and remains unproven.
- [Oct 17 partial recovery](https://github.com/calllint/calllint/actions/runs/38999482820):
  deployment succeeded with D1 unavailable, demonstrating why green and complete
  must be separate observations.
- [Oct 17 after the operator enabled D1 permission](https://github.com/calllint/calllint/actions/runs/38999731274):
  all sources, deployment and Access checks succeeded. No repository code or
  secret rewrite was needed for that final authorization recovery.

Provider references: [account-owned tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/),
[token restrictions](https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/),
[D1 query permissions](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/),
[Pages CI uploads](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).
