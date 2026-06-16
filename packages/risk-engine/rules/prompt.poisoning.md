# prompt.poisoning

Status: Accepted

Risk: Hidden model-directed instructions in tool metadata (tool poisoning).

Verdict impact: Critical blocker → BLOCK when a tool name, description, input-schema
text, or server instruction contains model-directed phrasing (e.g. "ignore previous
instructions", "do not tell the user", "always call this tool first").

Symbol: PROMPT · Risk class: S2 · Mode: OBSERVED

Observed evidence: provided tool metadata (`x-calllint.tools`) / server instructions.

Why it matters: This metadata reaches the model directly and can hijack autonomous
tool selection or coerce data disclosure. This is the agent-native differentiator —
a vulnerability classic scanners miss.

False positives: Phrases can appear innocently in documentation; review in context.

Fix: Remove model-directed instructions from tool metadata and server instructions.

Golden fixtures:
- block-prompt-poison.json must trigger
- safe-time.json must not trigger
