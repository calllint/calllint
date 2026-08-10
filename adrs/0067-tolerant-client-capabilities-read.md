# ADR 0067 — Reading `clientCapabilities` tolerantly, and turning -32021's absence into a fact

- Status: Accepted (2026-08-10). Reads the second required `_meta` key at 2026-07-28 and
  **changes no behaviour**: same results, same bytes, same verdicts. Changes no schema, no
  verdict, no served byte under `apps/web/public/**`, and neither the tool count (13) nor
  the resource count (19). `packages/calllint-mcp` runtime `dependencies` stays `{}`.
  `PROTOCOL_VERSION` and `SUPPORTED_PROTOCOL_VERSIONS` are untouched.
- Date: 2026-08-10
- Closes: the `clientCapabilities` item carried open by
  [artifacts/mcp-2026-07-28/open-items.md](../artifacts/mcp-2026-07-28/open-items.md)
- Corrects: **0066 §7**, whose framing of the problem was refuted by the same locked bytes
  it cites. See §2 — this is the ADR's main content, not a footnote.
- Refines: 0063 (per-request negotiation — capabilities are read at the same `_meta`, on the
  same per-request discipline), 0064 §5 (which first recorded the key as unread), 0066 §4
  (the "MUST NOT infer" rule this batch shows is isomorphic to per-request revision choice)
- Related: 0060 (**still reserved**, see §1), 0065 (the artifact reader amended here),
  0061 §8.5.1 (the append discipline used on the amendment)

## §1 Numbering: 0067, and 0060 remains reserved

`proposed-file-map.md` carries the standing instruction to re-`ls adrs/` rather than trust
its own line. Executed at authoring time: `adrs/` holds **34** files and tops out at
**0066**, so this ADR is **0067**.

**0060 is still held.** It is reserved for the `propertyNames` defect recorded as
*"RECORDED, NOT FIXED"* at `artifacts/phase-2.4/presentation-plane-audit.json:135`, which a
gate reads. Six ADRs have now been numbered around it.

## §2 0066 §7's framing was wrong, and its own upstream bytes say so

0066 §7 is titled *"`clientCapabilities` stays unread, and the reason got stronger"*. Its
argument, verbatim:

> Both keys. So a strict read at 2026-07-28 would reject a client that declares only the
> version key — and the version key is precisely what a client must send to reach the new
> revision at all. Enforcing the requirement would make the new revision unreachable by the
> minimal request that selects it.

Every sentence there is true. The **framing** is not: it presents the situation as a
conflict between conformance and usability, where reading the key strictly would be correct
but unusable, so we decline to read it. That framing makes tolerance a **deviation** we are
choosing to accept.

Reading further into the same digest-locked schema shows there is no conflict to trade off.
Upstream defines a dedicated error for the missing-capability case,
`$defs.MissingRequiredClientCapabilityError`, whose `error.code` is `const` **-32021** and
whose `error.data` **requires** `requiredCapabilities`. Its semantics, verbatim:

> Returned when processing a request requires a capability the client did not declare in
> `clientCapabilities`.

That is an **on-demand** refusal: it fires when *this particular request* needs a capability
the client did not declare, and it must name which capabilities. It is not a schema-shaped
gate on the presence of a key. `required` puts the key in the object's shape; `-32021`
governs the consequence of what the key does or does not contain — and only when something
actually needs it.

So a tolerant read is **what upstream asks for**, not a concession against it. 0066 §7
measured the `required` array correctly and then reasoned about a rule that lives somewhere
else.

**This is the second batch in a row where a control or a measurement broke an ADR's prose
rather than its code**, and the pair is worth keeping together. In M26-4 the thing refuted
was a *justification* — the ADR gave the wrong mechanism for behaviour that was correct. Here
the thing refuted is a *restatement* — the ADR quoted the right bytes and drew a frame those
bytes do not support. Both survive a green suite, because neither is executable. The lesson
generalises: **an ADR's prose is not covered by its own gates.** The remedy is not more
prose review; it is to make the claim derivable in a gate, which §4 does.

## §3 Decision

At 2026-07-28, read `io.modelcontextprotocol/clientCapabilities` from `params._meta` on
**every** request, and let it decide nothing.

`readClientCapabilities(req)` returns

```ts
interface DeclaredClientCapabilities {
  declared: boolean
  capabilities: Record<string, unknown> | null
}
```

- **Absent key** → `{declared: false, capabilities: null}`. No error, no shape change, no
  verdict movement. The request is served exactly as before.
- **Present and an object** → `{declared: true, capabilities: <the object>}`, including the
  empty object.
- **Present but not an object** (string, number, boolean, array, explicit `null`) →
  `{declared: true, capabilities: null}`. A client bug stays visible as a bug; see §5.

**We never send -32021.** Not as a policy choice — as a consequence. `ClientCapabilities`
carries **no `required` key at all** and five optional members (`elicitation`, `experimental`,
`extensions`, `roots`, `sampling`), with upstream stating *"an empty object means the client
supports no optional capabilities."* None of CallLint's 13 tools needs any of them: they read
committed bytes, run deterministic rules, and return a verdict. There is no elicitation, no
sampling, no roots traversal. `-32021` **requires** `data.requiredCapabilities` — the capabilities
the server needs — and we have none to name. Emitting it would be a false statement about our
own needs, which for a verdict engine is the same class of defect as a false finding.

> **Amended 2026-08-10, after this ADR was merged at `05ee77c`.** The paragraph above first read
> *"`ClientCapabilities` has `required: null`."* Measured against the locked bytes:
> `Object.keys($defs.ClientCapabilities)` is `["description", "properties", "type"]` — the key is
> **absent**, not present-and-null. The conclusion is unchanged and still derivable, but from the
> *absence* of `required`, which is what makes every member optional and `{}` a conformant
> declaration.
>
> Worse, §4.2's gate encoded the same slip in a way that could not catch it:
> `expect(d.ClientCapabilities?.required ?? null).toBeNull()`. The `?? null` maps a **missing
> `ClientCapabilities`** to `null` as well, so the assertion passed whether upstream said "nothing
> is required" or had deleted the definition — `[[absence-makes-a-gate-skip-itself]]`, in the one
> gate whose stated purpose is to *derive* rather than restate. Now: assert the definition exists,
> assert `hasOwnProperty("required")` is `false`, and pin the five member names so upstream adding
> a **required** member cannot pass the absence check. Control #168 (delete `ClientCapabilities`
> from the locked schema) reds with *"the locked schema must define ClientCapabilities at all"*
> where the old form went green.
>
> Third time in this workstream that a claim's *prose* outran its bytes, and the first where the
> ADR doing the correcting committed the same class of error in the same batch — see §2's own
> lesson, which applies to this document.

### §3.1 Why read-but-unused is not dead code

The obvious objection: a function whose result is discarded is dead weight, and the honest
move is to delete it and keep the comment.

The comment is what we are trying to get rid of. "No CallLint tool requires a client
capability" was already true before this batch and already written down — in prose, in ADR
0064 §5, verified by nobody. Prose that nothing reads is exactly the failure this workstream
has now hit twice: in M26-3 a corrected claim reached only the copy something read, and in
§2 above a framing survived because it was not executable.

The read converts three unverified sentences into checkable facts:

1. Both required `_meta` keys have a reader, so a gate can assert on the *presence* of the
   read instead of on the absence of a rejection.
2. `-32021` is absent from `server.ts` **because** no tool needs a capability — derivable
   from `ClientCapabilities` carrying no `required` key in the locked bytes (§4.2), not asserted.
3. The reader is request-scoped, which makes upstream's MUST NOT rule checkable (§4.3).

The call site is `void readClientCapabilities(req)`. The `void` is deliberate: it marks the
discard as intentional so a later reader does not "tidy up" by deleting the call, and it is
the smallest form that keeps the reader on the request path.

## §4 The four gates, and why none substitutes for another

### §4.1 `:599` — the gate that had to be edited by hand

`tests/invariants/mcp-spec-vendor.invariants.test.ts` carried, by design, an assertion that
this batch had to reverse:

```ts
expect(serverSource()).not.toContain("io.modelcontextprotocol/clientCapabilities")
```

It was placed so that landing the read is impossible without editing a named assertion. It
worked. Both keys are now asserted `toContain`, and the title records that the two keys have
**different consequences** rather than one shared requirement.

### §4.2 -32021 derived from locked bytes, then asserted absent from our source

Parses `MissingRequiredClientCapabilityError` out of the schema: the `const` code must be
`[-32021]`, `data.required` must contain `requiredCapabilities`, and `ClientCapabilities` must
exist while carrying **no `required` key**, with its five optional members pinned by name. Only
then does it assert `server.ts` does not contain `32021`. The reason is **derived**, not
restated — the shape `[[prose-justified-constant-is-ungated]]` requires. (This paragraph
described a `required: null` check until 2026-08-10; see §3's amendment for why that form was
both wrong and unable to catch itself.)

The forbidden-token half needs a comment stripper, because the docblock *arguing for* the
rule contains the token. That stripper is guarded two-sidedly (real code still present,
docblock prose gone) so a stripper that ate the file could not pass. This is
`[[source-scan-must-read-code-not-prose]]`, hit again.

### §4.3 Request scope — MUST NOT infer from prior requests

Upstream: *"Servers MUST NOT infer capabilities from prior requests."* `:615` already
asserted that sentence exists in the vendored bytes. Nothing asserted **our** compliance.

This gate asserts the reader takes `req` as a parameter, that the call site passes `req`, that no
module-scope binding is initialized from it, and — added after measurement, see §6.2 — that the
reader is mentioned exactly **twice** in stripped source. The last clause is what has teeth: a
capabilities cache would be a conformance bug that no behavioural test could see, because a
cache returns a plausible value. The first three clauses were measured **insufficient** against a
realistic cache, which is the whole reason the count is there.

Isomorphic to 0066 §4's rule that each request is answered wholly at one revision. Both say:
**no state crosses a request boundary.** Recording them as one rule is the point — the next
`_meta` key inherits it instead of re-deriving it.

### §4.4 `clientInfo` must not reach a verdict path

New, and it guards a property that is currently **true and unguarded**. Upstream, on
`RequestMetaObject.properties["io.modelcontextprotocol/clientInfo"]`:

> Servers SHOULD NOT use it to change their behavior, and SHOULD NOT rely on it for security
> decisions.

For a verdict engine that is not a style note; it is product principles 3/4/5 restated by
upstream. `server.ts` has zero `clientInfo` reads today, so there is nothing to fix — the
gate exists so that a future batch adding one has to argue with a named assertion. Zero
source change, and the sentence is derived from the parsed schema rather than quoted.

Matching that sentence took two wrong probes. Upstream wraps it mid-sentence, and the wrap
survives in **both** vendored forms: as a line break in the `schema.ts` docblock, and as an
escaped `\n` inside the `schema.json` string. `indexOf("rely on it for security")` returns
`-1` against both. The claim was right both times; the probe was searching for a line
upstream never wrote as one line. Assert against the **parsed** description with
`.replace(/\s+/g, " ")`.

## §5 Why `declared` is a separate field from `capabilities`

A single nullable field would be smaller: `capabilities: Record<string, unknown> | null`,
`null` for "nothing useful." It is also wrong, twice over.

**Upstream makes the empty object meaningful.** *"An empty object means the client supports
no optional capabilities"* — that is a client stating its position. A client that sends no
key at all has stated nothing. Collapsing both to `null` answers "did the client tell us?"
incorrectly for `{}`, and `{}` is the conformant way to say "none."

**An explicit `null` is a declaration too.** The first draft of the behavioural test expected
`{declared: false}` for `"clientCapabilities": null` and red. The reader was right: JSON
`null` is a value the client sent, not a key it omitted. The expectation was the defect. This
is `[[assert-which-source-answered]]` in a second shape — not "which source answered" but
"did a source answer at all," and the same fix applies: return the provenance beside the
value and assert the provenance first.

Both sides are asserted. An absence-only test passes when the feature was never built; a
presence-only test passes when the absence path throws.

## §6 Negative controls — what each was measured to catch

Six mutations, each applied to source or artifact (never to a test), run, observed to fail
**by name on its own claim**, then rolled back to a byte-exact tree. Positive control first.

Positive control before any mutation: `pnpm typecheck` clean, `pnpm test` **223 files /
3690 passed | 1 skipped** (baseline 3683, so the new gates add 7 and none replaced an old one).

| # | Mutation | Observed |
|---|---|---|
| 162 | Throw on a missing key instead of returning `declared:false` | 17 red, all four new tests by name |
| 162b | Return -32021 on a missing key (the realistic form of 162) | red on the response body **and** on the source scan |
| 163 | Malformed value → `declared:false` | 1 red, names the offending value |
| 163b | Empty object `{}` → treated as an absence | 1 red, prints `capabilities: {}` |
| 165 | Cache in a module-scope variable, call site replaced | red — but on the **wrong claim**; see §6.2 |
| 165b | Same cache, call site literal **preserved** | **PASSED**. Gate strengthened; see §6.2 |
| 166 | Read `clientInfo` in `server.ts` | red, quoting upstream's SHOULD NOT |
| 167 | Revert `:599` to `not.toContain` | red — gate and implementation interlock |

Note there is no separate 164 row. The plan listed "send -32021" as its own control; executing
162b showed it is the *same* mutation — a server that refuses a missing key refuses it *with*
-32021 — and one mutation trips both the behavioural expectation and §4.2's source scan. Two
plan rows, one measurable change.

### §6.1 Two results worth the space

**163b is why §5 is a section and not a sentence.** Mutating the reader so `{}` returns
`{declared: false}` reds with `capabilities: {}` printed. That is upstream's conformant way to
say "no optional capabilities," so a reader collapsing it to an absence misreports a client that
answered correctly.

**166 needed a written assertion message.** The first form was
`expect(code).not.toContain("clientInfo")`, which reds with
`expected '\n\n\n\nimport ty…' not to contain 'clientInfo'` — a dump of the stripped source with
the claim nowhere in it. Same defect as `[[every-collapses-the-observed-value]]`, different
operator: `not.toContain` on a large haystack prints the haystack, not the finding. Rewritten as
`expect(code.includes("clientInfo"), "<the claim + upstream's sentence>").toBe(false)`.

### §6.2 The control I predicted would pass, passed — after being fixed to be honest

§4.3's gate was authored with three assertions: the reader takes `req`, no module-scope binding
is *initialized from* it, and the call site is `void readClientCapabilities(req)`.

Control 165 red, and I nearly recorded it as a success. It did not fail on the cache. It failed
on `expected '// ---…' to contain 'void readClientCapabilities(req)'` — because my mutation had
*replaced* the call site. The gate caught the edit, not the caching.

So I wrote the mutation a competent implementer would actually write — the cache **beside** an
untouched call site:

```ts
let lastCaps: DeclaredClientCapabilities = { declared: false, capabilities: null }
// ...
void readClientCapabilities(req)                                              // untouched
if (readClientCapabilities(req).declared) lastCaps = readClientCapabilities(req)
```

**All three assertions passed it.** The regex `/^(?:const|let|var)\s+\w+\s*=\s*readClientCapabilities/m`
matches a declaration *initialized from* the reader; this declares with a neutral initializer and
assigns later, inside the handler. And the `void` literal was still there, verbatim.

That is a working per-connection capabilities cache — precisely the conformance bug §4.3 exists
to forbid, and precisely the kind no behavioural test can see, because a cache returns a
plausible value. The gate had a hole exactly the shape of the bug.

What the mutation could not fake is **arity**. The honest implementation mentions the reader
**twice** in stripped code: the declaration, and the one discarded call. Reading a retained value
back requires a third mention. 165b needed four. So a counting assertion was added:

```ts
const mentions = [...serverCode().matchAll(/readClientCapabilities\(/g)].length
expect(mentions, "exactly two mentions … a retained value needs a third to read it back").toBe(2)
```

Re-measured: clean source 42/42; 165b now reds with `expected 4 to be 2`, naming the claim and
printing the observed count.

Two things generalise. First, **a negative control that reds has not necessarily passed** — the
failure has to be on the claim under test, and here a plausible red was the gate detecting its own
edit. The
`[[negative-control-validity-checklist]]` question this adds is: *did the mutation change anything
the gate asserts other than the property?* Second, **a source-shape gate is only as good as the
mutation you tried**, and the mutation to try is the one an implementer would write, not the one
easiest to script. A pattern anchored to how a value is *bound* misses a value that is bound
innocently and assigned later; a count of how many times it is *reached* does not care.

## §7 What this ADR does not decide

- **Does not touch M-OPEN-1 / M-OPEN-3 / M-OPEN-4.** Scope was fixed at `clientCapabilities`
  alone. Those three rows stay open, verbatim, each still needing its own authorization.
- **Does not decide what a capability-requiring tool would do.** If CallLint ever grows a
  tool that needs `sampling` or `elicitation`, that tool must emit `-32021` with
  `requiredCapabilities` naming what it needs, and the §4.2 gate must be edited by hand to
  allow it. The gate is the mechanism that forces that conversation.
- **Does not enforce `required` strictly.** Tolerance is upstream's own design (§2), and the
  authorization for this batch fixed it.
- **Does not read `clientInfo`.** §4.4 adds a gate, not a read.
- **Does not move a verdict.** Nothing in this batch reaches `computeVerdict`.
