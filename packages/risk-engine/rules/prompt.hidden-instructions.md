# prompt.hidden-instructions

Status: Accepted (ADR 0014, R4 prompt surface v0)

Risk: Hidden or obfuscated content in model-visible metadata.

Verdict impact: Non-blocker → REVIEW when server instructions or a provided tool's
name/description/schema text contain hidden/obfuscated content the literal-phrase
matcher (`prompt.poisoning`) cannot catch. Complements `prompt.poisoning` (which
stays a critical blocker for explicit model-directed phrases); both can fire
independently on the same server.

Symbol: PROMPT · Risk class: S2 · Mode: OBSERVED · Severity: medium

Observed evidence: the model-visible surface — `server.instructions` and
`providedTools[].{name,description,inputSchemaText}` (the config's `x-calllint`
tool metadata). Evidence reports the *category* of hidden content and the exact
surface key; it never reproduces the hidden bytes.

Categories detected:
- zero-width / invisible characters (ZWSP/ZWNJ/ZWJ, word joiner, BOM/ZWNBSP);
- Unicode bidirectional override controls (the "Trojan Source" class);
- invisible tag-character ASCII smuggling (U+E0000–U+E007F);
- embedded HTML/XML comments (`<!-- ... -->`).

Why it matters: invisible/obfuscated characters in tool metadata reach the model
but not a human reviewer, so a model-directed instruction can hide from review
while still steering autonomous tool selection. This is the obvious evasion of a
phrase matcher.

Scope (ADR 0014): reads the config's declared tool metadata only. Project
documents (README / SKILL.md / AGENTS.md / package description) are covered by the
sibling `prompt.surface-instructions` detector (ADR 0015, `--surface-dir`), which
reuses this same hidden-content matcher over allowlisted local files. Registry
metadata (the published npm `description`/README) is also covered by
`prompt.surface-instructions`, but only under `--online` (ADR 0027): the fetched
registry text is routed through the same matcher as an additional document
surface. Static shape detection only — it does not claim to detect prompt
injection or infer intent.

False positives: some hidden characters are benign (a BOM, a bidi control in a
legitimate right-to-left language sample, an HTML comment in documentation). The
finding flags that the model-visible text differs from the rendered text; review
the surface in context.

Fix: remove zero-width/bidirectional/tag characters and HTML comments from tool
names, descriptions, schemas, and server instructions; keep model-visible text
identical to what a human reviewer sees.

Golden fixtures:
- review-hidden-instructions.json (HTML comment hiding an instruction) must trigger
- safe-clean-unicode-metadata.json (accented Spanish/German) must not trigger
