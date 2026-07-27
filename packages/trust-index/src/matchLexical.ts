/**
 * The single source of truth for the deterministic Trust-lookup matcher (ADR 0055 §4/§5:
 * "deterministic lexical … no LLM, no embedding, no fuzzy"). ONE algorithm, expressed once
 * as a typed function for server callers and once as the browser script text the lookup page
 * inlines — pinned behaviorally identical by `matchLexical.test.ts`, so there is never a
 * "second ranker" that can drift from the page (Product Principle 4/5).
 *
 * The match is pure string comparison: exact match first, then prefix, then substring;
 * alphabetical within each tier. No ranking model, no score, no network, no state. It orders
 * an already-decided set of entries — it NEVER computes or moves a verdict (ADR 0053 §3).
 */

/** The minimum an entry needs to be matched: a name to compare against. */
export interface LexicalNamed {
  canonicalName: string
}

/**
 * Deterministic tiered lexical match over `entries` for `query`. Returns a NEW array (never
 * mutates the input): an empty/blank query yields every entry sorted by name; otherwise the
 * entries whose name exactly equals (tier 0), is prefixed by (tier 1), or contains (tier 2)
 * the lowercased needle, ordered by tier then alphabetically. Generic in the entry type, so
 * the whole entry (with its shipped verdict/label/digest) is carried through verbatim.
 */
export function matchLexical<T extends LexicalNamed>(entries: readonly T[], query: string): T[] {
  const byName = (a: T, b: T): number =>
    a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0
  const needle = query.trim().toLowerCase()
  if (!needle) return entries.slice().sort(byName)
  const tiered: { tier: number; entry: T }[] = []
  for (const entry of entries) {
    const name = String(entry.canonicalName).toLowerCase()
    const tier = name === needle ? 0 : name.indexOf(needle) === 0 ? 1 : name.indexOf(needle) !== -1 ? 2 : -1
    if (tier !== -1) tiered.push({ tier, entry })
  }
  tiered.sort((a, b) => a.tier - b.tier || byName(a.entry, b.entry))
  return tiered.map((t) => t.entry)
}

/**
 * The SAME algorithm as browser script text, inlined verbatim into `LOOKUP_SCRIPT`
 * (`renderLookup.ts`) so the page and `matchLexical` share one definition. It closes over a
 * module-level `entries` (the page's fetched index) and defines `byName` + `match(query)`.
 * Kept byte-for-byte as the page has always shipped — the committed-tree gate pins the emitted
 * `lookup.html`, and `matchLexical.test.ts` proves this text and `matchLexical` agree. Edit the
 * algorithm HERE (both forms together), never one in isolation.
 */
export const LEXICAL_MATCH_BROWSER_JS = `  function byName(a, b) {
    return a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0;
  }

  // Deterministic string match: exact, then prefix, then substring; alphabetical in a tier.
  // Plain substring comparison only — no ranking model and no network call per keystroke.
  function match(query) {
    var needle = query.trim().toLowerCase();
    if (!needle) return entries.slice().sort(byName);
    var tiered = [];
    for (var i = 0; i < entries.length; i++) {
      var name = String(entries[i].canonicalName).toLowerCase();
      var tier = name === needle ? 0 : name.indexOf(needle) === 0 ? 1 : name.indexOf(needle) !== -1 ? 2 : -1;
      if (tier !== -1) tiered.push({ tier: tier, entry: entries[i] });
    }
    tiered.sort(function (a, b) { return a.tier - b.tier || byName(a.entry, b.entry); });
    return tiered.map(function (t) { return t.entry; });
  }`
