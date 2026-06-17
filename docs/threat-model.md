# CallLint Threat Model (v0.1)

CallLint does not ask "does this package have a vulnerability?" It asks:

> Should an AI agent be allowed to invoke this external capability?

## Agency Risk Model

```
Agency Risk = Agency × Authority × Data Sensitivity × Side Effect × Observability × Reproducibility
```

| Dimension        | Question                       | Risk increases when                          |
| ---------------- | ------------------------------ | -------------------------------------------- |
| Agency           | Will the agent auto-invoke it? | Autonomous use, no human approval            |
| Authority        | How much power does it get?    | shell, files, OAuth, database                |
| Data Sensitivity | What can it read?              | secrets, repo, mail, customer data           |
| Side Effect      | What external change can it cause? | send mail, open PR, edit calendar, pay, delete |
| Observability    | Can the user see what it did?  | hidden tool metadata, silent actions         |
| Reproducibility  | Can the verdict be reproduced? | `@latest`, remote endpoint, dynamic tool list |

## Threat Catalog

| ID  | Threat                                                        |
| --- | ------------------------------------------------------------- |
| T01 | Tool poisoning through metadata                               |
| T02 | Prompt injection through tool descriptions                    |
| T03 | Secret exposure through env / config / output                 |
| T04 | Broad filesystem access                                       |
| T05 | Arbitrary command execution                                   |
| T06 | External network exfiltration                                 |
| T07 | External mutation without confirmation                        |
| T08 | OAuth scope abuse                                             |
| T09 | Unknown remote MCP server                                     |
| T10 | Supply-chain drift through unpinned package                   |
| T11 | TOCTOU: scanned version differs from runtime version          |
| T12 | Rug pull: permission surface changes across versions          |
| T13 | Misleading tool name or description                           |
| T14 | Hidden instructions in comments / unicode / markdown          |
| T15 | Unsafe output passed back into LLM context                    |

## v0.1 coverage

Quick Scan (default) covers, via static evidence only:
T03 (secret env keys), T04 (broad filesystem), T05 (dangerous command),
T09 (unknown remote), T10 (unpinned package), T11 (fingerprint + reproducibility flag),
T01/T02/T13/T14 (prompt-surface scanning of provided metadata), T07 (external mutation).

T06/T08/T12/T15 are partially modeled (inferred risk) and fully realized in
Probe/Deep Scan (v0.2+), which require a sandbox and are out of scope for v0.1.
