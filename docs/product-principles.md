# CallLint Product Principles

1. **Verdict first, score second.** The first thing a developer sees is SAFE / REVIEW /
   BLOCK / UNKNOWN, not a 0–100 number.
2. **UNKNOWN is not SAFE.** Insufficient evidence is itself a risk in an agent toolchain.
3. **Evidence is mandatory.** Every finding carries `what / where / why / impact / fix /
   confidence`, and is tagged Observed or Inferred.
4. **Deterministic rules decide verdicts.** The risk engine is pure and testable.
5. **The LLM explains, it does not judge.** No "AI says safe."
6. **Safe by default.** Quick Scan never executes unknown servers, never reads real
   secrets, never calls destructive tools.
7. **Reproducibility is surfaced.** Unpinned packages and unverifiable remotes lower the
   reproducibility level, and the report says so.
8. **Fix-first UX.** Every blocker comes with a safer config the user can copy.
9. **Restraint over flash.** Four state colors (green/amber/red/gray), dense terminal
   cards, stable JSON enums. No rainbow gradients. Emoji is a renderer detail; the JSON
   is emoji-free.
10. **Risk assessment, not public conviction.** We say "observed high-risk behavior,"
    never "this package is malware," unless we have direct evidence.
