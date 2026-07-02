# Agent Inbox Fixtures (R5 / v0.10.0 Design)

Provider fixture examples for `calllint.agent-inbox-event.v0` normalization.

**Status:** Design phase (R5). These fixtures demonstrate the adapter contract —
each provider's raw event structure paired with its normalized form.

## Purpose

Each fixture pair shows one transformation:
- `*.raw.json` — the provider's native event structure (illustrative)
- `*.normalized.json` — the corresponding `calllint.agent-inbox-event.v0` output

These validate the adapter contract in `docs/AGENT_INBOX_ADAPTER_CONTRACT.md`.

## Coverage

| Provider | Event | Files |
|----------|-------|-------|
| Resend | email.received | resend/email-received.{raw,normalized}.json |
| SendGrid | email.received (inbound parse) | sendgrid/inbound-parse.{raw,normalized}.json |
| Gmail API | email.received (push) | gmail-api/push-notification.{raw,normalized}.json |
| Slack | mention.detected | slack/mention-detected.{raw,normalized}.json |
| Discord | message.posted | discord/direct-message.{raw,normalized}.json |
| SMTP/IMAP | email.received (generic) | smtp-imap/generic-headers.{raw,normalized}.json |

**6 provider patterns, 12 files (6 raw + 6 normalized).**

## Invariants (enforced by tests)

Every `*.normalized.json` must:
1. Have `schema_version: "calllint.agent-inbox-event.v0"`
2. Have required fields: `event_type`, `timestamp`, `source`, `normalized_content`
3. Have `source.provider` (never credentials)
4. Have `normalized_content.from`
5. When `has_attachments: true` → have `attachment_hashes` (non-empty)
6. Contain NO secrets (only `header_keys`, never header values)
7. Have valid ISO-8601 `timestamp`
8. Use only enum `event_type` values

## Secret Safety

**Raw fixtures** may show provider structures that include header value placeholders
(e.g. `"Authorization": "Bearer REDACTED"`) to demonstrate what adapters must strip.

**Normalized fixtures** NEVER contain:
- Header values (only `header_keys` array of names)
- Full message bodies (only `body_length`)
- Attachment bytes (only `attachment_hashes`)
- API tokens or credentials

## References

- `schemas/agent-inbox-event.schema.json` — Schema definition
- `docs/AGENT_INBOX_ADAPTER_CONTRACT.md` — Transformation rules
- `docs/r5-agent-inbox-design.md` — R5 design overview
