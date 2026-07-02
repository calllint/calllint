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

| Provider | Examples | event_types | action_candidate kinds |
|----------|----------|-------------|------------------------|
| Resend | 2 | email.received | — , email.reply |
| SendGrid | 2 | email.received, thread.replied | — , email.forward |
| Gmail API | 2 | email.received | — , email.reply (secret headers) |
| Slack | 2 | mention.detected, thread.replied | — , message.post |
| Discord | 2 | message.posted, direct_message.received | — , a2a.delegate |
| SMTP/IMAP | 2 | email.received | — , payment.authorize |

**6 provider patterns, 12 fixture pairs (12 raw + 12 normalized).**

The corpus exercises **all 5 schema `event_type` values** and feeds **6 distinct
`action_candidate` kinds** into the R4 engine. The first fixture of each provider
is a plain normalized event; the second carries an `action_candidate` proving the
inbox→action chain.

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
9. When an `action_candidate` is present → it is a structurally valid
   `calllint.action.v0` descriptor (schema_version + known kind + parameters)

The suite also asserts corpus-level coverage: **all 5 `event_type` values** appear,
and **≥6 `action_candidate`s** are present. `packages/fixtures/test/agent-inbox.test.ts`
verifies each candidate flows into the real R4 analyzer.

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
