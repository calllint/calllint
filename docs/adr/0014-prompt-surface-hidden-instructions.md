# ADR 0014: R4 Prompt Surface v0 — flag hidden/obfuscated model-visible instructions

Status: Accepted (recorded and implemented 2026-06-25)

## Context

ROADMAP R4 ("Prompt Surface expansion") calls to extend prompt-surface risk
"beyond tool metadata to README / SKILL.md / tool schema descriptions / server
instructions / package description / registry metadata", framed as **"flags
prompt-surface risk"**, never "detects prompt injection" — static shape detection,
not a runtime proof, every finding carrying a surface path and a false-positive
note.

Two facts about today's engine bound what an honest v0 can do:

1. **The only model-visible surface the pipeline actually has is the config's own
   tool metadata.** `NormalizedMcpServer` (`packages/types/src/server.ts`) carries
   `instructions` and `providedTools[].{name,description,inputSchemaText}`,
   populated by `normalizeMcpServers.ts` from the config's `x-calllint` block (or a
   top-level `instructions`). It does **not** carry README, SKILL.md, package
   description, or registry metadata — nothing in `config-parser`, `resolver`, or
   `core` reads any file beyond the config, and `--online` enrichment reads
   registry metadata only downstream and advisory-only. Surfacing README/SKILL/
   package/registry text would require **new input plumbing** (a fetch/read stage,
   a new evidence provenance, a new offline/online boundary) — a materially larger
   change than a detector.

2. **The existing prompt detector matches literal phrases only.**
   `detectPromptPoisoning` (`prompt.poisoning`) scans the same surface for a fixed
   list of lowercased English phrases ("ignore previous instructions", "do not tell
   the user", …). Any obfuscation that preserves the intent but breaks the literal
   string — zero-width characters splitting a word, a Unicode bidi/override control,
   tag-character ASCII smuggling, or instructions buried in an HTML comment — slips
   past it. That is the obvious bypass of a phrase matcher, and it is a *shape* an
   honest static check can detect without claiming to "understand" intent.

The roadmap's broader surface list (README/SKILL/package/registry) is therefore
aspirational against the current engine. This ADR picks the honest v0 scope: a new
detector over the **surface the engine already has**, flagging a structural
property (hidden/obfuscated content) rather than re-listing phrases — and
explicitly defers the new-surface plumbing.

## Decision

Introduce a new detector `detectHiddenInstructions` emitting finding id
`prompt.hidden-instructions`, over the same model-visible surface
`detectPromptPoisoning` reads (`server.instructions` and
`providedTools[].{name,description,inputSchemaText}`). It flags **hidden or
obfuscated content in model-visible text**, a class the literal phrase matcher
cannot catch:

- **Invisible / non-printing characters** in model-visible text: zero-width space/
  joiner/non-joiner (U+200B–U+200D), word joiner (U+2060), BOM/ZWNBSP (U+FEFF).
- **Unicode bidirectional controls** (U+202A–U+202E, U+2066–U+2069) — the
  "Trojan Source" override class, which can hide or reorder visible text.
- **Tag-character ASCII smuggling** (U+E0000–U+E007F) — invisible tag chars that
  encode ASCII a model may still read.
- **HTML/XML comments** (`<!-- ... -->`) embedded in instruction/description text —
  content invisible in a rendered surface but present in what reaches the model.

Verdict role: **REVIEW, non-blocker** (symbol PROMPT, S2, OBSERVED, medium
confidence). It is a weaker, broader signal than `prompt.poisoning` (which stays a
critical blocker for explicit model-directed phrases): hidden content is suspicious
and worth a human's eyes, but its mere presence is not proof of an attack, so it
does not hard-stop. Both can fire on the same server independently.

Every finding carries:
- a **surface path** (`evidence.key` = the exact surface, e.g.
  `tools.save_note.description` or `instructions`), exactly as `prompt.poisoning`
  does; and
- a **false-positive note** (e.g. a legitimate RTL language sample, or an HTML
  comment in documentation).

Evidence never reproduces the hidden bytes verbatim; it reports the *category* of
hidden content and the surface, so a report is safe to render.

## Explicitly out of scope (deferred)

- README, SKILL.md, package description, and registry metadata as new prompt
  surfaces. These need new input plumbing (read/fetch + provenance + offline/online
  boundary) and are a separate, larger phase. Recording the boundary here keeps v0
  honest: CallLint flags prompt-surface risk **in the config's declared tool
  metadata**, and does not yet read external docs.
- Any claim of "prompt-injection detection". This is static shape detection of
  hidden/obfuscated content. It cannot and does not assert intent.

## Consequences / required work

- New detector `packages/static-analyzer/src/detectors/hiddenInstructions.ts` +
  finding id `prompt.hidden-instructions`, registered in `DETECTORS` and exported.
- A **positive** golden fixture (a tool description with a zero-width-split hidden
  instruction → REVIEW) and a **negative** fixture (clean unicode-bearing text, e.g.
  an accented description, → SAFE), plus unit tests.
- A synthetic corpus case (`prompt-surface` riskTheme) pinning the REVIEW verdict —
  synthetic because, like `prompt.poisoning`, this reads inline tool metadata that
  real config snapshots almost never declare (tools are discovered at connect time,
  which CallLint never does).
- Docs: rule doc under `packages/risk-engine/rules/`, README rule list, ROADMAP R4
  marked v0-done with the new-surface plumbing called out as the remaining R4 work.
- No change to `ScanReport`, verdict semantics, exit codes, or existing findings.

## Reason

This is the honest intersection of the R4 intent and the engine's real
capabilities: it extends prompt-surface coverage with a genuinely new detection
class (obfuscation/hiding) over the surface we already have, instead of either
overpromising a README/registry reader the pipeline cannot truthfully back, or
shipping a second phrase list that adds little over `prompt.poisoning`. Recording
the deferred surface keeps the scope claim ("flags prompt-surface risk in declared
tool metadata") exactly matched to what ships.

## Related

- ROADMAP R4 (`docs/ROADMAP.md`).
- `detectPromptPoisoning` / `prompt.poisoning` — the literal-phrase sibling this
  complements (`packages/static-analyzer/src/detectors/promptPoisoning.ts`).
- `packages/types/src/server.ts` — the model-visible surface both detectors read.
- ADR 0006 (online enrichment is advisory) — why registry metadata is not a verdict
  input today.
